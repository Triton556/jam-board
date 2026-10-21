use jam_core::*;
fn setup() -> (tempfile::TempDir, Store, String) {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(d.path().join("jam.db")).unwrap();
    s.seed_demo().unwrap();
    let actor = s.current_member().unwrap().id;
    (d, s, actor)
}
#[test]
fn assets_links_and_preview_are_scoped_and_each_mutation_has_one_event() {
    let (d, s, actor) = setup();
    let image = d.path().join("registered.png");
    std::fs::write(&image, b"test").unwrap();
    let before = s.latest_seq().unwrap();
    let a = s
        .create_asset(&actor, "sprite", "Player", image.to_str().unwrap(), None)
        .unwrap();
    assert_eq!(s.latest_seq().unwrap(), before + 1);
    assert_eq!(
        s.asset_preview_path(&a.id).unwrap(),
        Some(image.canonicalize().unwrap())
    );
    assert!(s.asset_preview_path(image.to_str().unwrap()).is_err());
    s.link_asset(&actor, "JB-1", &a.id).unwrap();
    assert_eq!(s.latest_seq().unwrap(), before + 2);
    assert_eq!(
        s.assets_with_tasks(AssetQuery {
            kind: Some("sprite".into()),
            text: Some("Player".into())
        })
        .unwrap()
        .iter()
        .find(|x| x.asset.id == a.id)
        .unwrap()
        .tasks[0]
            .key,
        "JB-1"
    );
    s.unlink_asset(
        &actor,
        AssetLink {
            asset_id: a.id.clone(),
            task_key: "JB-1".into(),
        },
    )
    .unwrap();
    assert_eq!(s.latest_seq().unwrap(), before + 3);
    assert!(
        !s.get_task("JB-1")
            .unwrap()
            .assets
            .iter()
            .any(|x| x.id == a.id)
    );
    s.update_asset_fields(
        &actor,
        AssetEdit {
            id: a.id.clone(),
            name: Some("Updated".into()),
            notes: Some("Notes".into()),
            kind: None,
        },
    )
    .unwrap();
    assert_eq!(s.latest_seq().unwrap(), before + 4);
    assert!(s.create_asset(&actor, "invalid", "X", "x", None).is_err());
    assert!(
        s.update_asset_fields(
            &actor,
            AssetEdit {
                id: a.id,
                name: Some("".into()),
                notes: None,
                kind: None
            }
        )
        .is_err()
    );
}
#[test]
fn member_identity_is_immutable_and_statistics_include_work() {
    let (_d, s, actor) = setup();
    let a = s.identify_agent("Codex", "codex").unwrap();
    s.mark_ready(&actor, "JB-1", None).unwrap();
    s.claim_task(&a.id, "JB-1").unwrap();
    let updated = s
        .edit_member(
            &actor,
            MemberEdit {
                id: a.id.clone(),
                name: Some("Helpful Codex".into()),
                color: Some(MEMBER_COLORS[4].into()),
                avatar: None,
            },
        )
        .unwrap();
    assert_eq!(updated.handle, a.handle);
    assert_eq!(updated.client, a.client);
    assert!(
        serde_json::from_value::<MemberEdit>(serde_json::json!({"id":a.id,"handle":"evil"}))
            .is_err()
    );
    assert!(
        s.edit_member(
            &actor,
            MemberEdit {
                id: a.id.clone(),
                name: None,
                color: None,
                avatar: Some("🙂".into())
            }
        )
        .is_err()
    );
    let stats = s
        .members_with_stats()
        .unwrap()
        .into_iter()
        .find(|m| m.member.id == a.id)
        .unwrap();
    assert!(stats.online);
    assert!(stats.working_on.iter().any(|t| t.key == "JB-1"));
    assert_eq!(stats.counts.len(), 5);
}
#[test]
fn activity_pages_filter_before_sequence_without_overlap() {
    let (_d, s, _) = setup();
    let first = s
        .activity_page(ActivityQuery {
            limit: Some(10),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(first.len(), 10);
    assert!(first.windows(2).all(|p| p[0].seq > p[1].seq));
    let second = s
        .activity_page(ActivityQuery {
            before_seq: Some(first.last().unwrap().seq),
            limit: Some(10),
            actor_kind: Some("agent".into()),
        })
        .unwrap();
    assert!(
        second
            .iter()
            .all(|e| e.seq < first.last().unwrap().seq && e.actor.kind == "agent")
    );
    assert!(
        s.activity_page(ActivityQuery {
            actor_kind: Some("invalid".into()),
            ..Default::default()
        })
        .is_err()
    );
}
#[test]
fn snapshot_roundtrip_renumbers_keys_maps_members_and_rejects_corruption() {
    let (_d, s, actor) = setup();
    let snapshot = s.export_jam().unwrap();
    let old_members = snapshot.members.len();
    let old = snapshot.jam.id.clone();
    let raw = serde_json::to_string(&snapshot).unwrap();
    let state = s.import_jam_json(&actor, &raw).unwrap();
    assert_ne!(state.jam.unwrap().id, old);
    let imported = s.export_jam().unwrap();
    assert_eq!(imported.tasks.len(), 22);
    assert_eq!(imported.assets.len(), 8);
    assert_eq!(imported.members.len(), old_members);
    assert!(imported.tasks.iter().all(|t| t.key.starts_with("JB2-")));
    assert_eq!(imported.comments.len(), snapshot.comments.len());
    assert_eq!(imported.links.len(), snapshot.links.len());
    assert_eq!(imported.activity.len(), snapshot.activity.len() + 1);
    assert!(s.import_jam_json(&actor, "{bad}").is_err());
    let invalid_file = s.path.with_file_name("invalid.json");
    std::fs::write(&invalid_file, [255, 254, 0]).unwrap();
    assert!(matches!(
        s.import_jam_file(&actor, &invalid_file),
        Err(Error::Validation { .. })
    ));
    let mut broken = serde_json::to_value(snapshot).unwrap();
    broken["links"][0]["taskId"] = serde_json::json!("missing");
    assert!(matches!(
        s.import_jam_json(&actor, &broken.to_string()),
        Err(Error::Validation { .. })
    ));
}
#[test]
fn archive_jam_keeps_all_records_and_settings_persist() {
    let (_d, s, actor) = setup();
    assert!(s.reset_jam(&actor, "Cozy Jam 48").is_err());
    for task in s
        .list_tasks(
            None,
            TaskFilter {
                status: Some(vec!["in_progress".into()]),
                ..Default::default()
            },
        )
        .unwrap()
        .tasks
    {
        s.release_task(&actor, &task.key, None).unwrap();
    }
    let before = s.export_jam().unwrap();
    assert!(s.reset_jam(&actor, "cozy jam 48").is_err());
    let state = s.reset_jam(&actor, &before.jam.name).unwrap();
    assert!(!state.has_jam);
    let c = rusqlite::Connection::open(&s.path).unwrap();
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        22
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM tasks WHERE archived_at IS NOT NULL",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        c.query_row("SELECT archived FROM jams", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM comments", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        before.comments.len() as i64
    );
    s.set_settings(SettingsPatch {
        theme: Some("dark".into()),
        sound_enabled: Some(true),
        ..Default::default()
    })
    .unwrap();
    let reopened = Store::open(&s.path).unwrap();
    assert_eq!(reopened.get_settings().unwrap().theme, "dark");
    assert!(reopened.get_settings().unwrap().sound_enabled);
}

#[test]
fn board_settings_are_scoped_and_validated() {
    let (_d, s, _actor) = setup();
    let initial = s.get_settings().unwrap();
    assert_eq!(initial.color_by, "epic");
    assert!(!initial.estimates_enabled);
    assert_eq!(initial.wip_limit, 6);
    s.set_settings(SettingsPatch {
        color_by: Some("assignee".into()),
        estimates_enabled: Some(true),
        wip_limit: Some(8),
        ..Default::default()
    })
    .unwrap();
    assert!(s.get_settings().unwrap().estimates_enabled);
    s.seed_demo().unwrap();
    assert!(!s.get_settings().unwrap().estimates_enabled);
    assert_eq!(s.get_settings().unwrap().color_by, "epic");
    assert!(
        s.set_settings(SettingsPatch {
            color_by: Some("rainbow".into()),
            ..Default::default()
        })
        .is_err()
    );
    assert!(
        s.set_settings(SettingsPatch {
            wip_limit: Some(0),
            ..Default::default()
        })
        .is_err()
    );
}
#[test]
fn attachment_is_atomic_and_has_one_event() {
    let (d, s, actor) = setup();
    let path = d.path().join("player.png");
    std::fs::write(&path, b"test").unwrap();
    let seq = s.latest_seq().unwrap();
    let a = s
        .attach_file(&actor, "JB-1", path.to_str().unwrap())
        .unwrap();
    assert_eq!(a.kind, "sprite");
    assert_eq!(a.name, "player");
    assert!(
        s.get_task("JB-1")
            .unwrap()
            .assets
            .iter()
            .any(|v| v.id == a.id)
    );
    assert_eq!(s.latest_seq().unwrap(), seq + 1);
    let count = s.list_assets(None, None).unwrap().len();
    let c = rusqlite::Connection::open(&s.path).unwrap();
    c.execute_batch("CREATE TRIGGER fail_link BEFORE INSERT ON task_assets BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(
        s.attach_file(&actor, "JB-2", path.to_str().unwrap())
            .is_err()
    );
    assert_eq!(s.list_assets(None, None).unwrap().len(), count);
    assert_eq!(s.latest_seq().unwrap(), seq + 1);
    assert!(s.attach_file(&actor, "JB-1", "relative.png").is_err());
}
