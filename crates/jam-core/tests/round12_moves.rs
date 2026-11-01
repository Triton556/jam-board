use jam_core::*;
use rusqlite::{Connection, params};

fn fixture() -> (tempfile::TempDir, Store, String, Epic, Epic, Story, Story) {
    let d = tempfile::tempdir().unwrap();
    let store = Store::open(d.path().join("fictional.db")).unwrap();
    let (_, actor) = store
        .create_jam("Moves", None, None, None, "UTC", "Human")
        .unwrap();
    let first = store
        .create_epic(
            &actor.id,
            NewEpic {
                title: "First".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let second = store
        .create_epic(
            &actor.id,
            NewEpic {
                title: "Second".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let mut stories = vec![];
    for epic in [&first, &second] {
        stories.push(
            store
                .create_story(
                    &actor.id,
                    NewStory {
                        epic_key: epic.key.clone(),
                        title: "Story".into(),
                        outcome_md: Some("Clear outcome".into()),
                        acceptance: Some(vec![Acceptance {
                            id: "1".into(),
                            criterion: "Check passes".into(),
                            mandatory: true,
                            check: "Run check".into(),
                        }]),
                        ..Default::default()
                    },
                )
                .unwrap(),
        );
    }
    (
        d,
        store,
        actor.id,
        first,
        second,
        stories.remove(0),
        stories.remove(0),
    )
}
fn task(store: &Store, actor: &str, story: &Story) -> TaskDetail {
    store
        .create_task(
            actor,
            CreateTask {
                title: "Task".into(),
                story_key: Some(story.key.clone()),
                brief: TaskBrief {
                    goal_md: "Goal".into(),
                    where_md: "file.rs".into(),
                    changes: vec![Change {
                        title: "Change".into(),
                        required: "Required".into(),
                        ..Default::default()
                    }],
                    tests: vec![BriefTest {
                        setup: "Run fixture".into(),
                        expected: "Pass".into(),
                    }],
                    result_md: "Report".into(),
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .unwrap()
}

#[test]
fn story_move_retains_key_orders_in_destination_records_both_epics_and_replays() {
    let (_d, s, actor, from, to, story, sibling) = fixture();
    let before = s.activity_count().unwrap();
    let input = MoveStoryInput {
        key: story.key.clone(),
        to_epic_key: to.key.clone(),
        before_key: Some(sibling.key),
        after_key: None,
        expected_updated_at: None,
        request_id: "move-story".into(),
    };
    let moved = s.move_story(&actor, input.clone()).unwrap();
    assert_eq!(moved.key, story.key);
    assert_eq!(moved.epic_id, to.audit.id);
    assert_eq!(
        s.plan_stories()
            .unwrap()
            .into_iter()
            .find(|s| s.epic_id == to.audit.id)
            .unwrap()
            .key,
        story.key
    );
    assert_eq!(s.activity_count().unwrap(), before + 2);
    for epic in [&from, &to] {
        let events = s.epic_journal(&epic.key, 0).unwrap();
        let event = events.iter().find(|e| e.action == "story_moved").unwrap();
        assert_eq!(event.payload["fromKey"], from.key);
        assert_eq!(event.payload["toKey"], to.key);
    }
    let version = s.folder_session_context().unwrap().board_revision;
    assert!(s.move_story(&actor, input.clone()).unwrap().replayed);
    assert_eq!(s.folder_session_context().unwrap().board_revision, version);
    assert!(matches!(
        s.move_story(
            &actor,
            MoveStoryInput {
                to_epic_key: from.key,
                ..input
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));
}

#[test]
fn story_statuses_and_inflight_tasks_fail_closed_with_blocking_keys() {
    for status in ["draft", "active", "done", "archived"] {
        let (_d, s, actor, _from, to, story, _sibling) = fixture();
        let c = Connection::open(&s.path).unwrap();
        c.execute(
            "UPDATE stories SET status=? WHERE id=?",
            params![status, story.audit.id],
        )
        .unwrap();
        let result = s.move_story(
            &actor,
            MoveStoryInput {
                key: story.key,
                to_epic_key: to.key,
                before_key: None,
                after_key: None,
                expected_updated_at: None,
                request_id: "move-status".into(),
            },
        );
        assert_eq!(
            result.is_ok(),
            ["draft", "active"].contains(&status),
            "{status}"
        );
    }
    for status in ["in_progress", "review"] {
        let (_d, s, actor, _from, to, story, _sibling) = fixture();
        let task = task(&s, &actor, &story);
        Connection::open(&s.path)
            .unwrap()
            .execute(
                "UPDATE tasks SET status=? WHERE id=?",
                params![status, task.task.id],
            )
            .unwrap();
        let result = s.move_story(
            &actor,
            MoveStoryInput {
                key: story.key,
                to_epic_key: to.key,
                before_key: None,
                after_key: None,
                expected_updated_at: None,
                request_id: "move-blocked".into(),
            },
        );
        assert!(
            matches!(result,Err(Error::WrongStatus(ref reason)) if reason.contains(&task.task.key))
        );
    }
}

#[test]
fn ready_task_moves_to_draft_story_keeps_state_and_reports_story_inactive() {
    let (_d, s, actor, _from, _to, story, destination) = fixture();
    s.set_story_status(&actor, &story.key, "active", None)
        .unwrap();
    let task = task(&s, &actor, &story);
    s.mark_ready(&actor, &task.task.key, None, None).unwrap();
    let before = s.get_task(&task.task.key).unwrap();
    let input = MoveTaskToStoryInput {
        key: before.task.key.clone(),
        to_story_key: destination.key.clone(),
        expected_updated_at: before.task.updated_at,
        expected_claim_generation: before.task.claim_generation,
        request_id: "move-ready".into(),
    };
    let moved = s.move_task_to_story(&actor, input.clone()).unwrap();
    assert_eq!(moved.task.key, before.task.key);
    assert_eq!(moved.task.status, "ready");
    assert_eq!(moved.task.story_id, destination.audit.id);
    assert!(
        s.check_ready(&moved.task.key)
            .unwrap()
            .missing
            .iter()
            .any(|issue| issue.code == "story_inactive")
    );
    assert!(
        moved
            .history
            .iter()
            .any(|e| e.action == "task_moved_to_story"
                && e.payload["fromKey"] == story.key
                && e.payload["toKey"] == destination.key)
    );
    assert!(
        s.move_task_to_story(&actor, input.clone())
            .unwrap()
            .replayed
    );
    assert!(matches!(
        s.move_task_to_story(
            &actor,
            MoveTaskToStoryInput {
                to_story_key: story.key,
                ..input
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));
}

#[test]
fn task_move_rejects_inflight_states_and_stale_context_and_cross_project_parent() {
    for status in ["backlog", "ready", "in_progress", "review", "done"] {
        let (_d, s, actor, _from, _to, story, destination) = fixture();
        let task = task(&s, &actor, &story);
        Connection::open(&s.path)
            .unwrap()
            .execute(
                "UPDATE tasks SET status=? WHERE id=?",
                params![status, task.task.id],
            )
            .unwrap();
        let current = s.get_task(&task.task.key).unwrap();
        let input = MoveTaskToStoryInput {
            key: current.task.key.clone(),
            to_story_key: destination.key,
            expected_updated_at: current.task.updated_at,
            expected_claim_generation: current.task.claim_generation,
            request_id: "move-status".into(),
        };
        let result = s.move_task_to_story(&actor, input);
        assert_eq!(
            result.is_ok(),
            ["backlog", "ready"].contains(&status),
            "{status}"
        );
    }
    let (_d, s, actor, _from, _to, story, destination) = fixture();
    let task = task(&s, &actor, &story);
    let input = MoveTaskToStoryInput {
        key: task.task.key.clone(),
        to_story_key: destination.key,
        expected_updated_at: "stale".into(),
        expected_claim_generation: task.task.claim_generation,
        request_id: "stale-move".into(),
    };
    assert!(matches!(
        s.move_task_to_story(&actor, input),
        Err(Error::Conflict)
    ));
    let first = s.for_project(&s.active_jam().unwrap().id).unwrap();
    s.create_jam("Other", None, None, None, "UTC", "Other human")
        .unwrap();
    let other = s
        .default_task_story(&s.current_member().unwrap().id)
        .unwrap();
    let current = first.get_task(&task.task.key).unwrap();
    assert!(
        first
            .move_task_to_story(
                &actor,
                MoveTaskToStoryInput {
                    key: current.task.key,
                    to_story_key: other.key,
                    expected_updated_at: current.task.updated_at,
                    expected_claim_generation: current.task.claim_generation,
                    request_id: "cross-project".into()
                }
            )
            .is_err()
    );
}

#[test]
fn story_move_checks_captured_version_before_any_write() {
    for expected in [None, Some("current"), Some("stale")] {
        let (_d, s, actor, _from, to, story, _sibling) = fixture();
        let revision = s.folder_session_context().unwrap().board_revision;
        let activity = s.activity_count().unwrap();
        let result = s.move_story(
            &actor,
            MoveStoryInput {
                key: story.key.clone(),
                to_epic_key: to.key,
                before_key: None,
                after_key: None,
                expected_updated_at: expected.map(|value| {
                    if value == "current" {
                        story.audit.updated_at.clone()
                    } else {
                        value.into()
                    }
                }),
                request_id: "guard".into(),
            },
        );
        if expected == Some("stale") {
            assert!(matches!(result, Err(Error::Conflict)));
            assert_eq!(
                s.get_story(&story.key).unwrap().story.audit.updated_at,
                story.audit.updated_at
            );
            assert_eq!(s.folder_session_context().unwrap().board_revision, revision);
            assert_eq!(s.activity_count().unwrap(), activity);
            assert_eq!(
                Connection::open(&s.path)
                    .unwrap()
                    .query_row(
                        "SELECT count(*) FROM write_receipts WHERE request_id='guard'",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                0
            );
        } else {
            assert_eq!(result.unwrap().epic_id, to.audit.id);
        }
    }
}
