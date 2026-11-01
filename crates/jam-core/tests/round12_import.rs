use jam_core::*;
use rusqlite::{Connection, types::ValueRef};
use serde_json::{Value, json};

fn fixture() -> (tempfile::TempDir, Store, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("fictional.db")).unwrap();
    let (_, human) = store
        .create_jam("Imports", None, None, None, "UTC", "Human")
        .unwrap();
    (dir, store, human.id)
}
fn input(request: &str, epics: Value) -> ImportPlanInput {
    serde_json::from_value(json!({"requestId":request,"epics":epics})).unwrap()
}
fn plan(request: &str) -> ImportPlanInput {
    input(
        request,
        json!([
            {"externalRef":"e1","title":"Эпик — 🪨","stories":[
                {"externalRef":"s1","title":"История","outcomeMd":"Original","tasks":[{"externalRef":"t1","title":"Задача 🪨","tags":["Size-M","design"],"description":"Text","goalMd":"Goal"}]},
                {"externalRef":"s2","title":"Second"}
            ]},
            {"externalRef":"e2","title":"Other"}
        ]),
    )
}
fn image(store: &Store, except: &[&str]) -> Vec<String> {
    let c = Connection::open(&store.path).unwrap();
    let tables=c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
    tables
        .into_iter()
        .filter(|table| !except.contains(&table.as_str()))
        .flat_map(|table| {
            c.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap()
                .query_map([], |row| {
                    let values = (0..row.as_ref().column_count())
                        .map(|i| match row.get_ref(i).unwrap() {
                            ValueRef::Null => "NULL".into(),
                            ValueRef::Integer(v) => v.to_string(),
                            ValueRef::Real(v) => v.to_string(),
                            ValueRef::Text(v) => format!("{:?}", String::from_utf8_lossy(v)),
                            ValueRef::Blob(v) => format!("{v:?}"),
                        })
                        .collect::<Vec<_>>();
                    Ok(format!("{table}:{values:?}"))
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap()
        })
        .collect()
}
fn count(store: &Store, table: &str) -> i64 {
    Connection::open(&store.path)
        .unwrap()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn key(store: &Store, reference: &str) -> String {
    store
        .find(FindInput {
            external_refs: Some(vec![reference.into()]),
            ..Default::default()
        })
        .unwrap()[0]
        .key
        .clone()
}

#[test]
fn little_stones_393_dry_run_replay_noop_and_ten_updates() {
    let (_dir, s, h) = fixture();
    let mut epics=(0..58).map(|e|json!({"externalRef":format!("e{e}"),"title":format!("Эпик — {e} 🪨"),"stories":[]})).collect::<Vec<_>>();
    for i in 0..143 {
        epics[i % 58]["stories"]
            .as_array_mut()
            .unwrap()
            .push(json!({"externalRef":format!("s{i}"),"title":format!("Story {i}"),"tasks":[]}));
    }
    for i in 0..192 {
        let story = i % 143;
        epics[story%58]["stories"][story/58]["tasks"].as_array_mut().unwrap().push(json!({"externalRef":format!("t{i}"),"title":format!("Task {i}"),"tags":["size-M","design"]}));
    }
    let mut file = input("ls-1", json!(epics));
    file.dry_run = true;
    let before = image(&s, &[]);
    let preview = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    assert_eq!(preview.counts.created, 393);
    assert!(preview.batch_id.is_none());
    assert_eq!(image(&s, &[]), before);
    file.dry_run = false;
    let applied = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    let mut comparable = applied.clone();
    comparable.batch_id = None;
    comparable.dry_run = true;
    assert_eq!(
        serde_json::to_value(comparable).unwrap(),
        serde_json::to_value(preview).unwrap()
    );
    for (table, expected) in [
        ("epics", 58),
        ("stories", 143),
        ("tasks", 192),
        ("external_sync", 393),
        ("import_batches", 1),
        ("import_batch_items", 393),
        ("write_receipts", 1),
    ] {
        assert_eq!(count(&s, table), expected, "{table}");
    }
    assert_eq!(count(&s, "activity"), 2); // project creation plus one batch event
    assert_eq!(
        s.get_epic(&key(&s, "e0")).unwrap().epic.title,
        "Эпик — 0 🪨"
    );
    let before = image(&s, &[]);
    assert!(
        s.import_plan(&h, file.clone(), ImportSource::Mcp)
            .unwrap()
            .replayed
    );
    assert_eq!(image(&s, &[]), before);
    let mut changed_same_id = file.clone();
    changed_same_id.epics[0].title = "Different".into();
    assert!(matches!(
        s.import_plan(&h, changed_same_id, ImportSource::Mcp),
        Err(Error::IdempotencyConflict(_))
    ));
    file.request_id = "ls-noop".into();
    let revision = s.folder_session_context().unwrap().board_revision;
    for _ in 0..2 {
        let report = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
        assert!(report.no_changes);
        assert!(report.batch_id.is_none());
        assert!(!report.dry_run);
        assert_eq!(report.counts.unchanged, 393);
        assert_eq!(s.folder_session_context().unwrap().board_revision, revision);
        assert_eq!(image(&s, &[]), before);
    }
    let mut changed = 0;
    for epic in &mut file.epics {
        for story in &mut epic.stories {
            if changed < 10 {
                story.title.push_str(" updated");
                changed += 1;
            }
        }
    }
    file.request_id = "ls-ten".into();
    let report = s.import_plan(&h, file, ImportSource::Ui).unwrap();
    assert_eq!(report.counts.updated, 10);
    assert_eq!(report.counts.unchanged, 383);
    let history = s
        .list_import_batches(ImportBatchListInput::default())
        .unwrap();
    assert_eq!(history.len(), 2);
    assert!(matches!(history[0].source, ImportSource::Ui));
    assert_eq!(history[0].counts.updated, 10);
    assert_eq!(history[0].actor.name, "Human");
    let report = s
        .undo_import(
            &h,
            UndoImportInput {
                batch_id: report.batch_id.unwrap(),
                request_id: "undo-ten".into(),
            },
        )
        .unwrap();
    assert_eq!(report.undone, 10);
}

#[test]
fn board_newer_conflict_overwrite_in_work_and_truncated_fields() {
    let (_dir, s, h) = fixture();
    let mut file = plan("first");
    s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    let story_key = key(&s, "s1");
    s.update_story(
        &h,
        &story_key,
        StoryPatch {
            outcome_md: Some("Human edit".into()),
            ..Default::default()
        },
    )
    .unwrap();
    file.request_id = "board-newer".into();
    let before = image(&s, &[]);
    let result = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    assert_eq!(result.skipped[0].reason, "board_newer");
    assert!(result.no_changes);
    assert_eq!(image(&s, &[]), before);
    file.epics[0].stories[0].outcome_md = Some("x".repeat(600));
    file.request_id = "both".into();
    let result = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    assert_eq!(result.counts.conflicts, 1);
    assert_eq!(result.conflicts[0].board_updated_by, h);
    let field = result.conflicts[0]
        .fields
        .iter()
        .find(|f| f.field == "outcomeMd")
        .unwrap();
    assert_eq!(field.board, "Human edit");
    assert_eq!(field.file.as_str().unwrap().chars().count(), 501);
    assert!(field.file.as_str().unwrap().ends_with('…'));
    file.overwrite = vec!["s1".into()];
    file.request_id = "overwrite".into();
    assert_eq!(
        s.import_plan(&h, file.clone(), ImportSource::Mcp)
            .unwrap()
            .counts
            .updated,
        1
    );
    let task_key = key(&s, "t1");
    let c = Connection::open(&s.path).unwrap();
    for status in ["in_progress", "review", "done"] {
        c.execute("UPDATE tasks SET status=? WHERE key=?", [status, &task_key])
            .unwrap();
        file.request_id = format!("in-work-{status}");
        file.overwrite.push("t1".into());
        file.epics[0].stories[0].tasks[0].title = "File edit".into();
        let before = image(&s, &[]);
        let result = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
        assert_eq!(
            result
                .skipped
                .iter()
                .find(|r| r.record.external_ref == "t1")
                .unwrap()
                .reason,
            "task_in_work"
        );
        assert_eq!(image(&s, &[]), before);
        assert_eq!(s.get_task(&task_key).unwrap().task.title, "Задача 🪨");
    }
}

#[test]
fn nested_moves_keep_keys_not_in_file_undo_keeps_changed_item_and_archives_created() {
    let (_dir, s, h) = fixture();
    let mut file = plan("first");
    let first = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    let story_key = key(&s, "s1");
    let task_key = key(&s, "t1");
    let old_epic = s.get_epic(&key(&s, "e1")).unwrap().epic.audit.id;
    let old_story = s.get_task(&task_key).unwrap().task.story_id;
    let mut story = file.epics[0].stories.remove(0);
    let task = story.tasks.remove(0);
    file.epics[0].stories[0].tasks.push(task);
    file.epics[1].stories.push(story);
    file.request_id = "moves".into();
    let moved = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    assert_eq!(moved.counts.moved, 2);
    assert_eq!(key(&s, "s1"), story_key);
    assert_eq!(key(&s, "t1"), task_key);
    let undone = s
        .undo_import(
            &h,
            UndoImportInput {
                batch_id: moved.batch_id.clone().unwrap(),
                request_id: "undo-moves".into(),
            },
        )
        .unwrap();
    assert!(undone.kept.is_empty());
    assert_eq!(s.get_task(&task_key).unwrap().task.story_id, old_story);
    assert_eq!(s.get_story(&story_key).unwrap().story.epic_id, old_epic);
    assert!(matches!(
        s.undo_import(
            &h,
            UndoImportInput {
                batch_id: moved.batch_id.unwrap(),
                request_id: "again".into()
            }
        ),
        Err(Error::AlreadyUndone(_))
    ));
    file.epics.clear();
    file.request_id = "missing".into();
    let before = image(&s, &[]);
    let missing = s.import_plan(&h, file, ImportSource::Mcp).unwrap();
    assert_eq!(missing.counts.not_in_file, 5);
    assert!(missing.no_changes);
    assert_eq!(image(&s, &[]), before);
    s.update_epic(
        &h,
        &key(&s, "e2"),
        EpicPatch {
            title: Some("Human change".into()),
            ..Default::default()
        },
    )
    .unwrap();
    // The move+undo changed versions of its items. The original batch must retain them.
    let result = s
        .undo_import(
            &h,
            UndoImportInput {
                batch_id: first.batch_id.unwrap(),
                request_id: "undo-first".into(),
            },
        )
        .unwrap();
    assert!(
        result
            .kept
            .iter()
            .any(|r| r.key == key(&s, "e2") && r.reason == "changed_after_import")
    );
    assert!(result.undone >= 1);
    assert!(
        s.get_epic(&key(&s, "e1"))
            .unwrap()
            .epic
            .audit
            .archived_at
            .is_some()
    );
}

#[test]
fn link_only_writes_sync_and_receipt_and_then_is_a_true_noop() {
    let (_dir, s, h) = fixture();
    s.create_epic(
        &h,
        NewEpic {
            title: "Existing".into(),
            external_ref: Some("e".into()),
            request_id: "create-existing".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let mut file = input("link", json!([{"externalRef":"e","title":"Existing"}]));
    Connection::open(&s.path)
        .unwrap()
        .execute("UPDATE epics SET position=3072", [])
        .unwrap();
    let before = image(&s, &["external_sync", "write_receipts", "board_meta"]);
    let revision = s.folder_session_context().unwrap().board_revision;
    let result = s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    assert_eq!(result.counts.unchanged, 1);
    assert!(!result.no_changes);
    assert!(result.batch_id.is_none());
    assert_eq!(count(&s, "external_sync"), 1);
    assert_eq!(count(&s, "write_receipts"), 2);
    assert_eq!(count(&s, "import_batches"), 0);
    assert_eq!(
        image(&s, &["external_sync", "write_receipts", "board_meta"]),
        before
    );
    assert_eq!(s.folder_session_context().unwrap().board_revision, revision);
    let before = image(&s, &[]);
    file.request_id = "noop".into();
    assert!(
        s.import_plan(&h, file, ImportSource::Mcp)
            .unwrap()
            .no_changes
    );
    assert_eq!(image(&s, &[]), before);
}

#[test]
fn duplicate_refs_limits_invalid_values_and_failed_move_leave_zero_writes() {
    let (_dir, s, h) = fixture();
    let before = image(&s, &[]);
    let duplicate = input(
        "duplicates",
        json!([{"externalRef":"same","title":"One"},{"externalRef":"same","title":"Two"}]),
    );
    let error = s
        .import_plan(&h, duplicate, ImportSource::Mcp)
        .unwrap_err()
        .to_string();
    assert!(error.contains("epics[0]"));
    assert!(error.contains("epics[1]"));
    assert_eq!(image(&s, &[]), before);
    let too_many = input(
        "limit",
        json!(
            (0..1001)
                .map(|i| json!({"externalRef":format!("e{i}"),"title":"Epic"}))
                .collect::<Vec<_>>()
        ),
    );
    assert!(s.import_plan(&h, too_many, ImportSource::Mcp).is_err());
    assert_eq!(image(&s, &[]), before);
    let mut bad = plan("bad");
    bad.epics[0].stories[0].tasks[0].tags = Some(vec!["x".repeat(25)]);
    assert!(s.import_plan(&h, bad, ImportSource::Mcp).is_err());
    assert_eq!(image(&s, &[]), before);
    assert!(
        serde_json::from_value::<ImportPlanInput>(
            json!({"requestId":"bad","epics":[{"externalRef":"e","title":"X","color":"m7"}]})
        )
        .is_err()
    );
    let mut file = plan("valid");
    s.import_plan(&h, file.clone(), ImportSource::Mcp).unwrap();
    Connection::open(&s.path)
        .unwrap()
        .execute(
            "UPDATE tasks SET status='in_progress' WHERE external_ref='t1'",
            [],
        )
        .unwrap();
    let story = file.epics[0].stories.remove(0);
    file.epics[1].stories.push(story);
    file.epics[0].title = "Will roll back".into();
    file.request_id = "blocked-move".into();
    let before = image(&s, &[]);
    assert!(matches!(
        s.import_plan(&h, file, ImportSource::Mcp),
        Err(Error::WrongStatus(_))
    ));
    assert_eq!(image(&s, &[]), before);
}

#[test]
fn imported_order_changes_only_imported_records_and_project_history_is_isolated() {
    let (_dir, s, h) = fixture();
    let mut file = plan("first");
    let batch = s
        .import_plan(&h, file.clone(), ImportSource::Mcp)
        .unwrap()
        .batch_id
        .unwrap();
    file.epics[0].stories.swap(0, 1);
    file.request_id = "reorder".into();
    let report = s.import_plan(&h, file, ImportSource::Mcp).unwrap();
    assert_eq!(report.counts.updated, 2);
    let stories = s.get_epic(&key(&s, "e1")).unwrap().stories;
    assert_eq!(stories[0].story.external_ref.as_deref(), Some("s2"));
    let (other, other_h) = s
        .create_jam("Other", None, None, None, "UTC", "Other human")
        .unwrap();
    let other = s.for_project(&other.id).unwrap();
    assert!(
        other
            .list_import_batches(ImportBatchListInput::default())
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        other.undo_import(
            &other_h.id,
            UndoImportInput {
                batch_id: batch,
                request_id: "foreign".into()
            }
        ),
        Err(Error::NotFound(_))
    ));
    assert!(
        other
            .list_import_batches(ImportBatchListInput { limit: Some(21) })
            .is_err()
    );
}

#[test]
fn folder_import_dry_run_and_noop_preserve_database_and_published_board() {
    let dir = tempfile::tempdir().unwrap();
    let manager = ProjectManager::new(dir.path().join("fictional-appdata")).unwrap();
    let handle = manager
        .create(&dir.path().join("Board"), "Folder import", false)
        .unwrap();
    let store = &handle.store;
    let human = store.current_member().unwrap().id;
    let mut file = plan("folder-import");
    store
        .import_plan(&human, file.clone(), ImportSource::Mcp)
        .unwrap();
    store.flush_board_snapshot().unwrap();
    let before = image(store, &[]);
    let board = std::fs::read(handle.folder.join("board.json")).unwrap();
    file.request_id = "folder-noop".into();
    assert!(
        store
            .import_plan(&human, file.clone(), ImportSource::Mcp)
            .unwrap()
            .no_changes
    );
    assert_eq!(image(store, &[]), before);
    assert_eq!(
        std::fs::read(handle.folder.join("board.json")).unwrap(),
        board
    );
    file.request_id = "folder-preview".into();
    file.dry_run = true;
    file.epics[0].title = "Preview only".into();
    assert_eq!(
        store
            .import_plan(&human, file, ImportSource::Mcp)
            .unwrap()
            .counts
            .updated,
        1
    );
    assert_eq!(image(store, &[]), before);
    assert_eq!(
        std::fs::read(handle.folder.join("board.json")).unwrap(),
        board
    );
}
