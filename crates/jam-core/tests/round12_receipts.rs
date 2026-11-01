use jam_core::*;
use rusqlite::Connection;

fn fixture() -> (tempfile::TempDir, Store, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("fictional.db")).unwrap();
    let (_, actor) = store
        .create_jam("Receipts", None, None, None, "UTC", "Human")
        .unwrap();
    (dir, store, actor.id)
}

#[test]
fn epic_story_task_replay_conflict_and_restart_are_atomic() {
    let (_dir, store, actor) = fixture();
    let epic_input = NewEpic {
        request_id: "epic-1".into(),
        title: "Эпик — 🪨".into(),
        ..Default::default()
    };
    let epic = store.create_epic(&actor, epic_input.clone()).unwrap();
    let version = store.folder_session_context().unwrap().board_revision;
    let replay = store.create_epic(&actor, epic_input.clone()).unwrap();
    assert_eq!(replay.key, epic.key);
    assert!(replay.replayed);
    assert_eq!(
        store.folder_session_context().unwrap().board_revision,
        version
    );
    assert!(matches!(
        store.create_epic(
            &actor,
            NewEpic {
                title: "Different".into(),
                ..epic_input
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));

    let story_input = NewStory {
        request_id: "story-1".into(),
        epic_key: epic.key.clone(),
        title: "Story".into(),
        ..Default::default()
    };
    let story = store.create_story(&actor, story_input.clone()).unwrap();
    assert!(
        store
            .create_story(&actor, story_input.clone())
            .unwrap()
            .replayed
    );
    assert!(matches!(
        store.create_story(
            &actor,
            NewStory {
                title: "Different".into(),
                ..story_input
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));

    let input = CreateTask {
        request_id: "task-1".into(),
        story_key: Some(story.key),
        title: "Task".into(),
        ..Default::default()
    };
    let task = store.create_task(&actor, input.clone()).unwrap();
    let path = store.path.clone();
    drop(store);
    // Simulate loss of the caller's response and a fresh process opening the DB.
    let store = Store::open(path).unwrap();
    let version = store.folder_session_context().unwrap().board_revision;
    let replay = store.create_task(&actor, input.clone()).unwrap();
    assert_eq!(replay.task.key, task.task.key);
    assert!(replay.replayed);
    assert_eq!(replay.task.claim_generation, task.task.claim_generation);
    assert_eq!(replay.task.updated_at, task.task.updated_at);
    assert_eq!(
        store.folder_session_context().unwrap().board_revision,
        version
    );
    assert!(matches!(
        store.create_task(
            &actor,
            CreateTask {
                title: "Different".into(),
                ..input
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));
    let c = Connection::open(&store.path).unwrap();
    for table in ["epics", "stories", "tasks"] {
        assert_eq!(
            c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    assert_eq!(
        c.query_row("SELECT count(*) FROM write_receipts", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM task_idempotency", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let rows = c
        .prepare("SELECT result_json FROM write_receipts")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    for row in rows {
        let result: serde_json::Value = serde_json::from_str(&row).unwrap();
        assert!(result.get("id").is_some());
        assert!(result.get("updatedAt").is_some());
        for field in ["title", "brief", "stories", "comments"] {
            assert!(result.get(field).is_none());
        }
    }
}

#[test]
fn question_frame_and_note_replay_without_duplicate_events() {
    let (_dir, store, actor) = fixture();
    let question:AskUser=serde_json::from_value(serde_json::json!({"scope":{"type":"project","id":store.active_jam().unwrap().id},"title":"Keep the image?","requestId":"q-1"})).unwrap();
    let first = store.ask_user(&actor, question.clone()).unwrap();
    let count = store.activity_count().unwrap();
    let replay = store.ask_user(&actor, question.clone()).unwrap();
    assert_eq!(first.id, replay.id);
    assert!(replay.replayed);
    assert_eq!(store.activity_count().unwrap(), count);
    assert!(matches!(
        store.ask_user(
            &actor,
            AskUser {
                title: "Different?".into(),
                ..question
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));

    let frame = || {
        serde_json::from_value::<CanvasFrameCreate>(
            serde_json::json!({"title":"Design","requestId":"frame-1"}),
        )
        .unwrap()
    };
    let first = store.create_canvas_frame(&actor, frame()).unwrap();
    let count = store.activity_count().unwrap();
    let replay = store.create_canvas_frame(&actor, frame()).unwrap();
    assert_eq!(first.id, replay.id);
    assert!(replay.replayed);
    assert_eq!(store.activity_count().unwrap(), count);
    let changed =
        serde_json::from_value(serde_json::json!({"title":"Different","requestId":"frame-1"}))
            .unwrap();
    assert!(matches!(
        store.create_canvas_frame(&actor, changed),
        Err(Error::IdempotencyConflict(_))
    ));

    let note = AddReference {
        request_id: Some("note-1".into()),
        kind: ReferenceKind::Note,
        text: Some("Keep the palette".into()),
        title: Some("Palette".into()),
        ..Default::default()
    };
    let first = store.add_reference(&actor, note.clone()).unwrap();
    let count = store.activity_count().unwrap();
    let replay = store.add_reference(&actor, note.clone()).unwrap();
    assert_eq!(first.audit.id, replay.audit.id);
    assert!(replay.replayed);
    assert_eq!(store.activity_count().unwrap(), count);
    assert!(matches!(
        store.add_reference(
            &actor,
            AddReference {
                text: Some("Different".into()),
                ..note
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));
}

#[test]
fn failed_create_rolls_back_sequence_receipt_and_activity() {
    let (_dir, store, actor) = fixture();
    let before = store.folder_session_context().unwrap().board_revision;
    let input = NewEpic {
        request_id: "retry-after-failure".into(),
        title: "".into(),
        ..Default::default()
    };
    assert!(store.create_epic(&actor, input.clone()).is_err());
    assert_eq!(
        store.folder_session_context().unwrap().board_revision,
        before
    );
    let epic = store
        .create_epic(
            &actor,
            NewEpic {
                title: "Valid".into(),
                ..input
            },
        )
        .unwrap();
    assert_eq!(epic.key, "JB-E1");
    assert!(!epic.replayed);
}

#[test]
fn receipt_namespace_is_per_tool_and_legacy_task_replays_arbitrary_payload() {
    let (_dir, s, h) = fixture();
    let epic = s
        .create_epic(
            &h,
            NewEpic {
                title: "Epic".into(),
                request_id: "shared".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let story = s
        .create_story(
            &h,
            NewStory {
                title: "Story".into(),
                epic_key: epic.key.clone(),
                request_id: "shared".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let task = s
        .create_task(
            &h,
            CreateTask {
                title: "Task".into(),
                story_key: Some(story.key.clone()),
                request_id: "shared".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        s.create_epic(
            &h,
            NewEpic {
                title: "Epic".into(),
                request_id: "shared".into(),
                ..Default::default()
            }
        )
        .unwrap()
        .replayed
    );
    assert!(
        s.create_story(
            &h,
            NewStory {
                title: "Story".into(),
                epic_key: epic.key.clone(),
                request_id: "shared".into(),
                ..Default::default()
            }
        )
        .unwrap()
        .replayed
    );
    let c = Connection::open(&s.path).unwrap();
    c.execute("UPDATE write_receipts SET payload_hash='legacy',result_json=? WHERE actor_id=? AND tool='create_task' AND request_id='shared'",rusqlite::params![serde_json::json!({"id":task.task.id,"key":task.task.key}).to_string(),h]).unwrap();
    let revision = s.folder_session_context().unwrap().board_revision;
    let replay = s
        .create_task(
            &h,
            CreateTask {
                title: "Completely different".into(),
                story_key: Some("nonexistent".into()),
                request_id: "shared".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.task.key, task.task.key);
    assert_eq!(s.folder_session_context().unwrap().board_revision, revision);
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM write_receipts WHERE request_id='shared'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        3
    );
    assert!(matches!(
        s.create_epic(
            &h,
            NewEpic {
                title: "Different".into(),
                request_id: "shared".into(),
                ..Default::default()
            }
        ),
        Err(Error::IdempotencyConflict(_))
    ));
}
