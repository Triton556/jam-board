use jam_core::*;
use rusqlite::{Connection, params};

fn populate(store: &Store) -> String {
    let actor = store.current_member().unwrap().id;
    let story = store.default_task_story(&actor).unwrap();
    let task = store
        .create_task(
            &actor,
            CreateTask {
                title: "Камни — 🪨".into(),
                story_key: Some(story.key.clone()),
                tags: Some(vec!["size-M".into(), "design".into(), "alpha".into()]),
                ..Default::default()
            },
        )
        .unwrap();
    let asset = store
        .create_asset(
            &actor,
            "document",
            "Plan",
            "https://example.test/plan",
            None,
        )
        .unwrap();
    let c = Connection::open(&store.path).unwrap();
    c.execute(
        "UPDATE epics SET external_ref='epic-ref' WHERE id=?",
        [&task.epic.audit.id],
    )
    .unwrap();
    c.execute(
        "UPDATE stories SET external_ref='story-ref' WHERE id=?",
        [&story.audit.id],
    )
    .unwrap();
    c.execute(
        "UPDATE tasks SET external_ref='task-ref' WHERE id=?",
        [&task.task.id],
    )
    .unwrap();
    c.execute(
        "UPDATE assets SET archived_at='2026-10-31T00:00:00Z',archived_by=? WHERE id=?",
        params![actor, asset.id],
    )
    .unwrap();
    c.execute("INSERT INTO scope_files(id,jam_id,asset_id,target_type,target_id,created_by,created_at) VALUES('scope',?,?,'story',?,?,'2026-10-31T00:00:00Z')",params![task.task.jam_id,asset.id,story.audit.id,actor]).unwrap();
    task.task.key
}

#[test]
fn v2_export_import_retains_external_refs_scope_files_archive_and_tag_order() {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fictional.db")).unwrap();
    s.create_jam("Snapshot", None, None, None, "UTC", "Human")
        .unwrap();
    let key = populate(&s);
    let export = s.export_jam().unwrap();
    assert_eq!(
        export
            .tasks
            .iter()
            .find(|t| t.key == key)
            .unwrap()
            .external_ref
            .as_deref(),
        Some("task-ref")
    );
    let actor = s.current_member().unwrap().id;
    s.import_jam_json(&actor, &serde_json::to_string(&export).unwrap())
        .unwrap();
    let restored = s.export_jam().unwrap();
    assert_eq!(restored.tasks[0].external_ref.as_deref(), Some("task-ref"));
    assert_eq!(restored.tasks[0].tags, ["size-m", "design", "alpha"]);
    let p = restored.planning.unwrap();
    assert_eq!(p.epics[0].external_ref.as_deref(), Some("epic-ref"));
    assert_eq!(p.stories[0].external_ref.as_deref(), Some("story-ref"));
    assert_eq!(p.scope_files.len(), 1);
    assert_eq!(p.scope_files[0].target_id, p.stories[0].audit.id);
    assert_eq!(p.scope_files[0].asset_id, restored.assets[0].id);
    assert_eq!(
        restored.assets[0].archived_at.as_deref(),
        Some("2026-10-31T00:00:00Z")
    );
    assert_eq!(
        restored.assets[0].archived_by.as_deref(),
        Some(actor.as_str())
    );
}

#[test]
fn folder_snapshot_v4_recovers_round12_fields() {
    let d = tempfile::tempdir().unwrap();
    let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
    let h = m
        .create(&d.path().join("Board"), "Snapshot", false)
        .unwrap();
    let key = populate(&h.store);
    h.store.flush_board_snapshot().unwrap();
    let snapshot = h.store.board_snapshot().unwrap();
    assert_eq!(snapshot.format_version, 4);
    assert_eq!(snapshot.tables["scope_files"].len(), 1);
    m.close().unwrap();
    let folder = h.folder.clone();
    drop(h);
    let recovered = m.recover(&folder, false).unwrap();
    let task = recovered.store.get_task(&key).unwrap();
    assert_eq!(task.task.external_ref.as_deref(), Some("task-ref"));
    assert_eq!(task.story.external_ref.as_deref(), Some("story-ref"));
    assert_eq!(task.epic.external_ref.as_deref(), Some("epic-ref"));
    assert_eq!(task.task.tags, ["size-m", "design", "alpha"]);
    let after = recovered.store.board_snapshot().unwrap();
    assert_eq!(after.tables["scope_files"], snapshot.tables["scope_files"]);
    assert_eq!(after.tables["assets"], snapshot.tables["assets"]);
}

#[test]
fn folder_snapshot_v3_still_recovers() {
    let d = tempfile::tempdir().unwrap();
    let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
    let h = m
        .create(&d.path().join("Board"), "Old snapshot", false)
        .unwrap();
    let actor = h.store.current_member().unwrap().id;
    h.store.default_task_story(&actor).unwrap();
    h.store.flush_board_snapshot().unwrap();
    m.close().unwrap();
    let path = h.folder.join("board.json");
    let folder = h.folder.clone();
    drop(h);
    let mut old: BoardSnapshot = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    old.format_version = 3;
    old.tables.remove("scope_files");
    old.tables.remove("asset_revisions");
    for (table, columns) in [
        ("epics", vec!["external_ref"]),
        ("stories", vec!["external_ref"]),
        ("tasks", vec!["external_ref"]),
        ("assets", vec!["archived_at", "archived_by"]),
        ("activity", vec!["client"]),
        ("task_tags", vec!["position"]),
    ] {
        for row in old.tables.get_mut(table).unwrap() {
            for col in &columns {
                row.remove(*col);
            }
        }
    }
    std::fs::write(path, serde_json::to_vec(&old).unwrap()).unwrap();
    assert_eq!(
        m.recover(&folder, false)
            .unwrap()
            .store
            .list_epics()
            .unwrap()
            .len(),
        1
    );
}
