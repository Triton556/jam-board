use jam_core::*;

fn setup() -> (tempfile::TempDir, Store, Member, Member, Member) {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(dir.path().join("jam.db")).unwrap();
    let (_, h) = s
        .create_jam("Test jam", None, None, None, "UTC", "Human")
        .unwrap();
    let a = s.identify_agent("Codex", "codex").unwrap();
    let b = s.identify_agent("Claude", "claude-code").unwrap();
    (dir, s, h, a, b)
}
fn create(s: &Store, a: &Member, name: &str) -> TaskDetail {
    s.create_task(
        &a.id,
        CreateTask {
            title: name.into(),
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn numbering_tags_and_idempotency() {
    let (_d, s, h, _, _) = setup();
    let n = s.activity_count().unwrap();
    let input = CreateTask {
        title: "One".into(),
        idempotency_key: Some("external-1".into()),
        tags: Some(vec![" Art ".into(), "ART".into(), " ui ".into()]),
        ..Default::default()
    };
    let t = s.create_task(&h.id, input.clone()).unwrap();
    assert_eq!(t.task.key, "JB-1");
    assert_eq!(t.task.tags, ["art", "ui"]);
    assert_eq!(s.create_task(&h.id, input).unwrap().task.id, t.task.id);
    assert_eq!(s.activity_count().unwrap(), n + 1);
    assert_eq!(create(&s, &h, "Two").task.key, "JB-2");
    assert!(
        s.create_task(
            &h.id,
            CreateTask {
                title: "".into(),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert_eq!(create(&s, &h, "Three").task.key, "JB-3");
}
#[test]
fn positions_neighbors_and_renumber() {
    let (_d, s, h, _, _) = setup();
    let a = create(&s, &h, "A");
    let b = create(&s, &h, "B");
    let c = create(&s, &h, "C");
    assert_eq!(a.task.position, 1024.0);
    assert_eq!(b.task.position, 2048.0);
    let t = s
        .move_task(
            &h.id,
            &c.task.key,
            "todo",
            Some(&b.task.key),
            Some(&a.task.key),
        )
        .unwrap();
    assert_eq!(t.position, 1536.0);
    assert!(
        s.move_task(
            &h.id,
            &c.task.key,
            "todo",
            Some(&a.task.key),
            Some(&b.task.key)
        )
        .is_err()
    );
    for _ in 0..40 {
        s.move_task(&h.id, &c.task.key, "todo", Some(&b.task.key), None)
            .unwrap();
        let rows = s.list_tasks(None, TaskFilter::default()).unwrap().tasks;
        assert!(
            rows.windows(2)
                .all(|r| r[1].position - r[0].position >= 1e-6)
        );
        s.move_task(&h.id, &a.task.key, "todo", Some(&b.task.key), None)
            .unwrap();
        let rows = s.list_tasks(None, TaskFilter::default()).unwrap().tasks;
        assert!(
            rows.windows(2)
                .all(|r| r[1].position - r[0].position >= 1e-6)
        );
    }
    let rows = s.list_tasks(None, TaskFilter::default()).unwrap().tasks;
    assert!(rows.windows(2).all(|r| r[1].position > r[0].position));
    let seq = s.activity_count().unwrap();
    s.move_task(&h.id, &a.task.key, "review", None, None)
        .unwrap();
    assert_eq!(s.activity_count().unwrap(), seq + 1);
}
#[test]
fn claim_release_all_branches() {
    let (_d, s, h, a, b) = setup();
    for status in STATUSES {
        let t = s
            .create_task(
                &h.id,
                CreateTask {
                    title: status.into(),
                    status: Some(status.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let n = s.activity_count().unwrap();
        let claimed = s.claim_task(&a.id, &t.task.key).unwrap();
        assert_eq!(
            claimed.task.status,
            if ["backlog", "todo"].contains(&status) {
                "in_progress"
            } else {
                status
            }
        );
        assert_eq!(s.activity_count().unwrap(), n + 1);
        s.claim_task(&a.id, &t.task.key).unwrap();
        assert!(
            matches!(s.claim_task(&b.id,&t.task.key),Err(Error::ClaimConflict{holder}) if holder=="Codex")
        );
        assert!(s.release_task(&b.id, &t.task.key, None).is_err());
        assert_eq!(
            s.release_task(&a.id, &t.task.key, None).unwrap().status,
            "todo"
        );
        s.claim_task(&a.id, &t.task.key).unwrap();
        let released = s.release_task(&h.id, &t.task.key, Some("review")).unwrap();
        assert_eq!(released.status, "review");
        assert!(released.assignee_id.is_none());
    }
    let t = create(&s, &h, "Unassigned");
    assert!(s.release_task(&b.id, &t.task.key, None).is_err());
    s.release_task(&h.id, &t.task.key, None).unwrap();
}
#[test]
fn archive_blocks_all_edits_and_human_unarchives() {
    let (_d, s, h, a, b) = setup();
    let t = create(&s, &h, "Archive");
    let key = &t.task.key;
    let n = s.activity_count().unwrap();
    s.archive_task(&a.id, key, Some("Superseded")).unwrap();
    assert_eq!(s.activity_count().unwrap(), n + 1);
    assert_eq!(s.get_task(key).unwrap().comments.len(), 1);
    let errors = [
        s.update_task(
            &a.id,
            UpdateTask {
                key: key.clone(),
                title: Some("No".into()),
                ..Default::default()
            },
        )
        .map(|_| ()),
        s.claim_task(&a.id, key).map(|_| ()),
        s.move_task(&a.id, key, "done", None, None).map(|_| ()),
        s.release_task(&h.id, key, None).map(|_| ()),
        s.add_comment(&a.id, key, "No").map(|_| ()),
        s.archive_task(&a.id, key, None).map(|_| ()),
    ];
    assert!(
        errors
            .into_iter()
            .all(|e| matches!(e, Err(Error::Archived(_))))
    );
    assert!(s.unarchive_task(&b.id, key).is_err());
    s.unarchive_task(&h.id, key).unwrap();
    s.add_comment(&a.id, key, "Restored").unwrap();
}
#[test]
fn feed_cursor_and_external_data_version() {
    let (dir, s, h, _, _) = setup();
    let mut feed = ChangeFeed::open(dir.path().join("jam.db"), s.latest_seq().unwrap()).unwrap();
    assert!(feed.poll().unwrap().is_empty());
    let other = Store::open(dir.path().join("jam.db")).unwrap();
    create(&other, &h, "External");
    assert!(feed.data_changed().unwrap());
    let events = feed.poll().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, "task.created");
    assert!(feed.poll().unwrap().is_empty());
    assert!(!feed.data_changed().unwrap());
}
#[test]
fn validation_nullable_updates_pagination_and_activity() {
    let (_d, s, h, a, _) = setup();
    let t = create(&s, &h, "Task");
    let n = s.activity_count().unwrap();
    s.update_task(
        &h.id,
        UpdateTask {
            key: t.task.key.clone(),
            title: Some("Changed".into()),
            estimate: Some(Some(5)),
            due_at: Some(Some("2026-11-01T10:00:00Z".into())),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(s.activity_count().unwrap(), n + 1);
    let input: UpdateTask =
        serde_json::from_value(serde_json::json!({"key":t.task.key,"estimate":null,"dueAt":null}))
            .unwrap();
    let t = s.update_task(&h.id, input).unwrap();
    assert!(t.task.estimate.is_none());
    assert!(t.task.due_at.is_none());
    assert!(
        s.update_task(
            &h.id,
            UpdateTask {
                key: t.task.key.clone(),
                priority: Some("urgent".into()),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert!(
        s.add_comment(&h.id, &t.task.key, &"x".repeat(4001))
            .is_err()
    );
    let asset = s
        .create_asset(&h.id, "audio", "Wind", "assets/wind.ogg", None)
        .unwrap();
    let n = s.activity_count().unwrap();
    s.link_asset(&h.id, &t.task.key, &asset.id).unwrap();
    assert_eq!(s.activity_count().unwrap(), n + 1);
    create(&s, &h, "Second");
    let page = s
        .list_tasks(
            None,
            TaskFilter {
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(page.next_cursor.is_some());
    let next = s
        .list_tasks(
            None,
            TaskFilter {
                limit: Some(1),
                cursor: page.next_cursor,
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(page.tasks[0].id, next.tasks[0].id);
    let n = s.activity_count().unwrap();
    s.identify_agent("Codex", "codex").unwrap();
    assert_eq!(s.activity_count().unwrap(), n);
    assert_eq!(s.get_member(&a.id).unwrap().kind, "agent");
}
#[test]
fn demo_has_required_shape() {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(d.path().join("jam.db")).unwrap();
    s.seed_demo().unwrap();
    assert_eq!(s.activity_count().unwrap(), 60);
    let b = s.board(None).unwrap();
    let counts = b["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["count"].as_u64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(counts, [6, 9, 6, 4, 7]);
    assert_eq!(s.list_assets(None, None).unwrap().len(), 8);
    assert_eq!(s.list_members().unwrap().len(), 5);
}

#[test]
fn separate_jams_keep_unique_keys_and_active_jam_scope() {
    let (_d, s, h, _, _) = setup();
    let first = create(&s, &h, "First jam task");
    let (j, h2) = s
        .create_jam("Second jam", None, None, None, "UTC", "Another human")
        .unwrap();
    let second = create(&s, &h2, "Second jam task");
    assert_eq!(j.key_prefix, "JB2");
    assert_eq!(second.task.key, "JB2-1");
    assert_eq!(
        s.list_tasks(None, TaskFilter::default())
            .unwrap()
            .tasks
            .len(),
        1
    );
    assert_eq!(
        s.get_task(&first.task.key).unwrap().task.title,
        "First jam task"
    );
}

#[test]
fn dates_are_stored_as_utc() {
    let (_d, s, h, _, _) = setup();
    let t = s
        .create_task(
            &h.id,
            CreateTask {
                title: "Offset date".into(),
                due_at: Some("2026-10-20T10:00:00+10:00".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(t.task.due_at.as_deref(), Some("2026-10-20T00:00:00Z"));
}

#[test]
fn demo_reload_keeps_existing_history_and_60_new_events() {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(d.path().join("jam.db")).unwrap();
    s.seed_demo().unwrap();
    let mut first_feed = ChangeFeed::open(&s.path, 0).unwrap();
    let first = serde_json::to_value(first_feed.poll().unwrap()).unwrap();
    let j = s.seed_demo().unwrap();
    assert_eq!(j.key_prefix, "JB2");
    assert_eq!(j.task_seq, 32);
    assert_eq!(s.activity_count().unwrap(), 120);
    assert_eq!(
        s.list_tasks(None, TaskFilter::default())
            .unwrap()
            .tasks
            .len(),
        32
    );
    let mut feed = ChangeFeed::open(&s.path, 0).unwrap();
    let all = feed.poll().unwrap();
    assert_eq!(serde_json::to_value(&all[..60]).unwrap(), first);
}
