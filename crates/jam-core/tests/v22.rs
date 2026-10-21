use jam_core::*;
fn setup() -> (tempfile::TempDir, Store) {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(dir.path().join("jam.db")).unwrap();
    s.seed_demo().unwrap();
    (dir, s)
}
#[test]
fn questions_are_scoped_flags_but_ancestor_context_is_preserved() {
    let (_dir, s) = setup();
    let h = s.current_member().unwrap();
    let t = s.get_task("JB-1").unwrap();
    let before = s.get_epic(&t.epic.key).unwrap().open_questions.len();
    let ask = |kind: &str, id: String| AskUser {
        scope: Scope {
            kind: kind.into(),
            id,
        },
        title: "Choose the cue contrast".into(),
        body_md: None,
        options: None,
        recommended_index: None,
        allow_free_text: None,
        round_label: None,
    };
    let q = s.ask_user(&h.id, ask("epic", t.epic.key.clone())).unwrap();
    let fresh = s.get_task("JB-1").unwrap();
    assert!(!fresh.task.needs_info);
    assert!(fresh.ancestor_questions.iter().any(|a| a.id == q.id));
    assert_eq!(
        s.get_epic(&t.epic.key).unwrap().open_questions.len(),
        before + 1
    );
    s.ask_user(&h.id, ask("story", t.story.key.clone()))
        .unwrap();
    assert!(!s.get_task("JB-1").unwrap().task.needs_info);
    let q = s.ask_user(&h.id, ask("task", t.task.key.clone())).unwrap();
    assert!(s.get_task("JB-1").unwrap().task.needs_info);
    let page = s
        .query_tasks(TaskQuery {
            needs_info: Some(true),
            epic: Some(t.epic.key),
            ..Default::default()
        })
        .unwrap();
    assert!(page.tasks.iter().any(|t| t.key == "JB-1"));
    s.answer_question(
        &h.id,
        AnswerQuestion {
            id: q.id,
            answer_index: None,
            answer_text: Some("Keep it steady".into()),
        },
    )
    .unwrap();
    assert!(!s.get_task("JB-1").unwrap().task.needs_info);
}
#[test]
fn atomic_brief_edit_checks_version_validates_and_writes_one_event() {
    let (_dir, s) = setup();
    let before = s.get_task("JB-1").unwrap();
    let seq = s.latest_seq().unwrap();
    let mut brief = before.brief.clone();
    brief.goal_md = "A clear next step".into();
    let input:TaskEditInput=serde_json::from_value(serde_json::json!({"key":"JB-1","expectedUpdatedAt":before.task.updated_at,"title":"Edited together","brief":brief})).unwrap();
    let edited = s.update_current_task(input.clone()).unwrap();
    assert_eq!(edited.task.title, "Edited together");
    assert_eq!(edited.brief.goal_md, "A clear next step");
    assert_eq!(s.latest_seq().unwrap(), seq + 1);
    let event = s.list_changes_since(seq, None).unwrap().pop().unwrap();
    assert_eq!(event.action, "task.brief_updated");
    assert!(
        event.payload["fields"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("goalMd"))
    );
    assert!(matches!(s.update_current_task(input), Err(Error::Conflict)));
    let invalid:TaskEditInput=serde_json::from_value(serde_json::json!({"key":"JB-1","expectedUpdatedAt":edited.task.updated_at,"title":"Must roll back","brief":{"changes":[{"title":"","required":""}]}})).unwrap();
    assert!(matches!(
        s.update_current_task(invalid),
        Err(Error::Validation { .. })
    ));
    assert_eq!(s.get_task("JB-1").unwrap().task.title, "Edited together");
    assert_eq!(s.latest_seq().unwrap(), seq + 1);
}
#[test]
fn planning_lists_archives_clear_brain_and_reorders_transactionally() {
    let (_dir, s) = setup();
    let h = s.current_member().unwrap();
    let e = s.list_epics().unwrap().remove(0);
    assert!(
        s.clear_brain(&h.id, &e.key)
            .unwrap()
            .brain_member_id
            .is_none()
    );
    let worker = s.identify_agent("V22 worker", "other").unwrap();
    assert!(matches!(
        s.clear_brain(&worker.id, &e.key),
        Err(Error::Forbidden(_))
    ));
    let a = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: e.key.clone(),
                title: "One".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let b = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: e.key.clone(),
                title: "Two".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let seq = s.latest_seq().unwrap();
    s.reorder_story(&h.id, &b.key, Some(&a.key)).unwrap();
    assert_eq!(s.latest_seq().unwrap(), seq + 1);
    let rows = s.get_epic(&e.key).unwrap().stories;
    assert!(
        rows.iter().position(|r| r.story.key == b.key)
            < rows.iter().position(|r| r.story.key == a.key)
    );
    assert!(matches!(
        s.reorder_story(&h.id, &b.key, Some("JB-S404")),
        Err(Error::Validation { .. })
    ));
    assert!(s.plan_stories().unwrap().iter().any(|r| r.key == b.key));
    s.set_epic_status(&h.id, &e.key, "archived", None).unwrap();
    assert!(s.plan_epics().unwrap().iter().any(|r| r.key == e.key));
    assert!(!s.list_epics().unwrap().iter().any(|r| r.key == e.key));
}
#[test]
fn sql_readiness_and_hierarchy_filters_match_domain_checks() {
    let (_dir, s) = setup();
    for ready in [true, false] {
        let page = s
            .query_tasks(TaskQuery {
                ready: Some(ready),
                ..Default::default()
            })
            .unwrap();
        assert!(!page.tasks.is_empty());
        for t in page.tasks {
            assert_eq!(s.check_ready(&t.key).unwrap().ready, ready);
            assert_eq!(t.ready, ready);
            assert!(!t.story_key.is_empty());
        }
    }
    let t = s.get_task("JB-7").unwrap();
    let page = s
        .query_tasks(TaskQuery {
            epic: Some(t.epic.key),
            story: Some(t.story.key),
            changes_requested: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.tasks[0].key, "JB-7");
}
