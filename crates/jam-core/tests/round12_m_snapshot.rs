use jam_core::*;
use rusqlite::{Connection, params};

fn populate(s: &Store) -> (String, String) {
    let actor = s.current_member().unwrap().id;
    let frame = s
        .create_canvas_frame(
            &actor,
            serde_json::from_value(serde_json::json!({"title":"Moodboard"})).unwrap(),
        )
        .unwrap();
    let mut items = vec![];
    for title in ["Original", "Variation"] {
        items.push(
            s.add_reference(
                &actor,
                AddReference {
                    kind: ReferenceKind::Link,
                    url: Some("https://example.test/image".into()),
                    title: Some(title.into()),
                    frame_id: Some(frame.id.clone()),
                    ..Default::default()
                },
            )
            .unwrap(),
        );
    }
    let c = Connection::open(&s.path).unwrap();
    c.execute("UPDATE ref_items SET verdict_note='Keep the light',source_url='https://example.test/source',origin='generated',derived_from=?,copied_from=? WHERE id=?", params![items[0].audit.id,items[0].audit.id,items[1].audit.id]).unwrap();
    c.execute("UPDATE ref_frames SET review_sent_at='2026-11-01T01:02:03Z',review_sent_by=?,review_hash='stored-hash' WHERE id=?",params![actor,frame.id]).unwrap();
    (frame.id, items[1].audit.id.clone())
}

#[test]
fn json_round_trip_retains_all_eight_feedback_fields_and_remaps_item_ids() {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fixture.db")).unwrap();
    s.create_jam("Moodboard", None, None, None, "UTC", "Human")
        .unwrap();
    populate(&s);
    let actor = s.current_member().unwrap().id;
    let mut export = s.export_jam().unwrap();
    export.planning.as_mut().unwrap().items.reverse();
    s.import_jam_json(&actor, &serde_json::to_string(&export).unwrap())
        .unwrap();
    let restored = s.export_jam().unwrap().planning.unwrap();
    let original = restored
        .items
        .iter()
        .find(|i| i.title == "Original")
        .unwrap();
    let variation = restored
        .items
        .iter()
        .find(|i| i.title == "Variation")
        .unwrap();
    assert_eq!(variation.verdict_note.as_deref(), Some("Keep the light"));
    assert_eq!(
        variation.source_url.as_deref(),
        Some("https://example.test/source")
    );
    assert_eq!(variation.origin, Some(ReferenceOrigin::Generated));
    assert_eq!(variation.derived_from.as_ref(), Some(&original.audit.id));
    assert_eq!(variation.copied_from.as_ref(), Some(&original.audit.id));
    assert_eq!(
        restored.frames[0].review_sent_at.as_deref(),
        Some("2026-11-01T01:02:03Z")
    );
    assert_eq!(restored.frames[0].review_sent_by.as_ref(), Some(&actor));
    assert_eq!(
        restored.frames[0].review_hash.as_deref(),
        Some("stored-hash")
    );
}

#[test]
fn durable_board_round_trip_retains_feedback_columns_and_tracks_edits() {
    let d = tempfile::tempdir().unwrap();
    let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
    let h = m
        .create(&d.path().join("Board"), "Moodboard", false)
        .unwrap();
    let (frame, item) = populate(&h.store);
    let before = h.store.board_snapshot().unwrap();
    let c = Connection::open(&h.store.path).unwrap();
    c.execute(
        "UPDATE ref_items SET verdict_note='New reason' WHERE id=?",
        [&item],
    )
    .unwrap();
    c.execute(
        "UPDATE ref_frames SET review_hash='new-hash' WHERE id=?",
        [&frame],
    )
    .unwrap();
    let after = h.store.board_snapshot().unwrap();
    assert!(after.board_revision > before.board_revision);
    h.store.flush_board_snapshot().unwrap();
    let folder = h.folder.clone();
    m.close().unwrap();
    drop(h);
    drop(c);
    let recovered = m.recover(&folder, false).unwrap();
    let restored = recovered.store.board_snapshot().unwrap();
    assert_eq!(restored.tables["ref_items"], after.tables["ref_items"]);
    assert_eq!(restored.tables["ref_frames"], after.tables["ref_frames"]);
    assert!(
        !Connection::open(&recovered.store.path)
            .unwrap()
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
}
