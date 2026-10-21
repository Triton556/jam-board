use jam_core::*;
fn store() -> (tempfile::TempDir, Store) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests-v24b");
    std::fs::create_dir_all(&root).unwrap();
    let d = tempfile::tempdir_in(root).unwrap();
    let s = Store::open(d.path().join("jam.db")).unwrap();
    (d, s)
}
#[test]
fn templates_onboard_atomically_with_the_right_dates() {
    for template in ["game_jam", "gamedev", "webapp", "custom"] {
        let (_d, s) = store();
        let state = s
            .onboard(NewJamInput {
                name: "Project".into(),
                theme: None,
                starts_at: "2026-10-20T00:00:00Z".into(),
                ends_at: "2026-10-22T00:00:00Z".into(),
                timezone: "UTC".into(),
                your_name: "Danil".into(),
                template: Some(template.into()),
                milestone_at: Some("2026-11-30T12:00:00Z".into()),
            })
            .unwrap();
        let j = state.jam.unwrap();
        assert_eq!(j.template, template);
        assert_eq!(j.ends_at.is_some(), template == "game_jam");
        assert_eq!(
            j.milestone_at.is_some(),
            matches!(template, "gamedev" | "webapp")
        );
        assert_eq!(s.latest_seq().unwrap(), 1);
        let p = serde_json::to_value(s.get_project().unwrap()).unwrap();
        assert!(p["templateLabel"].is_string());
        assert_eq!(p["jam"]["template"], template);
        assert_eq!(p["template"], template);
        assert_eq!(p["milestoneAt"], p["jam"]["milestoneAt"]);
        assert!(p["tagSuggestions"].is_array());
    }
}
#[test]
fn switch_keeps_used_tags_and_records_exactly_one_project_event() {
    let (_d, s) = store();
    s.seed_demo().unwrap();
    let actor = s.current_member().unwrap();
    let tags = s.list_tags().unwrap();
    let seq = s.latest_seq().unwrap();
    let before = s.list_board_tasks().unwrap();
    let p = s
        .edit_project(
            &actor.id,
            ProjectEditInput {
                template: "webapp".into(),
                name: Some("Lantern web".into()),
                milestone_at: Some("2026-11-30T12:00:00Z".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(p.jam.name, "Lantern web");
    assert_eq!(p.template_label, "Web app");
    assert!(p.tag_suggestions.contains(&"frontend".into()));
    assert!(p.jam.ends_at.is_none());
    assert_eq!(
        serde_json::to_value(tags).unwrap(),
        serde_json::to_value(s.list_tags().unwrap()).unwrap()
    );
    assert_eq!(
        before.values().map(Vec::len).sum::<usize>(),
        s.list_board_tasks()
            .unwrap()
            .values()
            .map(Vec::len)
            .sum::<usize>()
    );
    let events = s.list_changes_since(seq, None).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, "project.updated");
    assert!(
        s.edit_project(
            &actor.id,
            ProjectEditInput {
                template: "bad".into(),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert!(
        s.edit_project(
            &actor.id,
            ProjectEditInput {
                template: "game_jam".into(),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert_eq!(s.latest_seq().unwrap(), seq + 1);
}
