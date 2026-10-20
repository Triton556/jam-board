use jam_core::*;
fn setup() -> (tempfile::TempDir, Store) {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(dir.path().join("jam.db")).unwrap();
    (dir, s)
}
#[test]
fn desktop_identity_is_a_human_and_actor_cannot_be_supplied() {
    let (_d, s) = setup();
    assert!(!s.app_state().unwrap().has_jam);
    s.seed_demo().unwrap();
    let danil = s.current_member().unwrap();
    assert_eq!(danil.handle, "danil");
    let task = s
        .create_current_task(CreateTask {
            title: "From window".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(task.task.created_by, danil.id);
    let mira = s
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.handle == "mira")
        .unwrap()
        .member;
    s.set_current_member(&mira.id).unwrap();
    let moved = s
        .move_current_task(&task.task.key, "review", None, None)
        .unwrap();
    assert_eq!(moved.updated_by, mira.id);
    assert_eq!(s.list_activity(None, Some(1)).unwrap()[0].actor.id, mira.id);
    assert!(serde_json::from_str::<CreateTask>(r#"{"title":"Spoof","actor":"codex"}"#).is_err());
    let a = s.identify_agent("Codex", "codex").unwrap();
    assert!(s.set_current_member(&a.id).is_err());
    s.set_setting("current_member_id", &a.id).unwrap();
    assert!(
        s.create_current_task(CreateTask {
            title: "No".into(),
            ..Default::default()
        })
        .is_err()
    );
    assert!(s.app_state().unwrap().current_member.is_none());
    s.join_as_human("New teammate").unwrap();
    let m = s.current_member().unwrap();
    assert_eq!(m.name, "New teammate");
    assert_eq!(m.kind, "human");
}
#[test]
fn board_read_is_not_limited_to_the_mcp_page_size() {
    let (_d, s) = setup();
    s.create_jam("Large board", None, None, None, "UTC", "Danil")
        .unwrap();
    for i in 0..251 {
        s.create_current_task(CreateTask {
            title: format!("Task {i}"),
            ..Default::default()
        })
        .unwrap();
    }
    let tasks = s.list_board_tasks().unwrap();
    assert_eq!(tasks["todo"].len(), 251);
    assert_eq!(tasks["todo"].first().unwrap().key, "JB-1");
    assert_eq!(tasks["todo"].last().unwrap().key, "JB-251");
}
#[test]
fn all_board_tasks_are_grouped_ordered_and_have_counts() {
    let (_d, s) = setup();
    s.seed_demo().unwrap();
    let board = s.list_board_tasks().unwrap();
    assert_eq!(board.len(), 5);
    assert_eq!(board.values().map(Vec::len).sum::<usize>(), 32);
    for (status, tasks) in board {
        assert!(
            tasks
                .iter()
                .all(|t| t.status == status && t.archived_at.is_none())
        );
        assert!(tasks.windows(2).all(|p| p[0].position <= p[1].position));
    }
    let t = s
        .create_current_task(CreateTask {
            title: "New".into(),
            ..Default::default()
        })
        .unwrap();
    let actor = s.current_member().unwrap();
    s.add_comment(&actor.id, &t.task.key, "A note").unwrap();
    assert_eq!(
        s.list_board_tasks().unwrap()["todo"]
            .iter()
            .find(|task| task.key == t.task.key)
            .unwrap()
            .comment_count,
        1
    );
    s.archive_task(&actor.id, &t.task.key, None).unwrap();
    assert_eq!(
        s.list_board_tasks()
            .unwrap()
            .values()
            .map(Vec::len)
            .sum::<usize>(),
        32
    );
}
#[test]
fn onboarding_and_theme_validation() {
    let (_d, s) = setup();
    let mut input = NewJamInput {
        name: "Jam".into(),
        theme: None,
        starts_at: "2026-10-19T00:00:00Z".into(),
        ends_at: "2026-10-21T00:00:00Z".into(),
        timezone: "UTC".into(),
        your_name: "Danil".into(),
    };
    input.ends_at = input.starts_at.clone();
    assert!(s.onboard(input.clone()).is_err());
    input.ends_at = "2026-10-21T00:00:00Z".into();
    assert!(s.onboard(input).unwrap().current_member.is_some());
    s.set_theme("dark").unwrap();
    assert_eq!(s.app_state().unwrap().theme, "dark");
    assert!(s.set_theme("purple").is_err());
}
