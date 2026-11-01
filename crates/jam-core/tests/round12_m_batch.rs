use jam_core::*;
use rusqlite::Connection;
use serde_json::{Value, json};
fn fixture() -> (tempfile::TempDir, Store, String, String) {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fixture.db")).unwrap();
    let (_, h) = s
        .create_jam("Batch", None, None, None, "UTC", "Human")
        .unwrap();
    let frame = s
        .create_canvas_frame(
            &h.id,
            serde_json::from_value(json!({"title":"Moodboard"})).unwrap(),
        )
        .unwrap();
    (d, s, h.id, frame.id)
}
fn batch(frame: &str, items: Value) -> AddReferencesInput {
    serde_json::from_value(json!({"requestId":"batch","frameId":frame,"items":items})).unwrap()
}
#[test]
fn forty_items_grid_growth_partial_success_dependencies_replay_and_conflict() {
    let (d, s, h, f) = fixture();
    let path = d.path().join("image.png");
    std::fs::write(&path, b"fixture").unwrap();
    let items=(0..40).map(|i|json!({"kind":"asset","filePath":if i==7 { d.path().join("missing.png") } else { path.clone() },"copy":true,"title":format!("Image {i}"),"derivedFrom":if i==9 {Some("#7")} else if i==1 {Some("#0")} else {None}})).collect::<Vec<_>>();
    let input = batch(&f, json!(items));
    let result = s.add_references(&h, input.clone()).unwrap();
    assert_eq!(result.created.len(), 38);
    assert_eq!(result.failed.len(), 2);
    assert_eq!(result.failed[0].index, 7);
    assert_eq!(result.failed[0].field, "filePath");
    assert_eq!(result.failed[1].index, 9);
    assert_eq!(
        result.failed[1].message,
        "derivedFrom points to item #7, which was not created"
    );
    assert_eq!(
        std::fs::read_dir(d.path().join("references"))
            .unwrap()
            .count(),
        38
    );
    let rows = s.list_references(None, None, None).unwrap();
    assert_eq!(rows.len(), 38);
    let second = rows.iter().find(|i| i.title == "Image 1").unwrap();
    assert_eq!(second.derived_from.as_ref(), Some(&result.created[0].id));
    assert!(rows.iter().any(|i| i.x == 544.));
    assert!(rows.iter().any(|i| i.y > 600.));
    assert!(result.frames[0].h > 2000.);
    let activity = s.activity_count().unwrap();
    let replay = s.add_references(&h, input.clone()).unwrap();
    assert!(replay.replayed);
    assert_eq!(
        serde_json::to_value(&replay.created).unwrap(),
        serde_json::to_value(&result.created).unwrap()
    );
    assert_eq!(s.activity_count().unwrap(), activity);
    assert_eq!(
        std::fs::read_dir(d.path().join("references"))
            .unwrap()
            .count(),
        38
    );
    let mut conflict = input;
    conflict.items[0].title = Some("Changed".into());
    assert!(matches!(
        s.add_references(&h, conflict),
        Err(Error::IdempotencyConflict(_))
    ));
}

#[test]
fn one_missing_file_keeps_the_other_thirty_nine_copies() {
    let (d, s, h, frame) = fixture();
    let path = d.path().join("image.png");
    std::fs::write(&path, b"fixture").unwrap();
    let items=(0..40).map(|index|json!({"kind":"asset","filePath":if index==7 {d.path().join("missing.png")} else {path.clone()},"copy":true})).collect::<Vec<_>>();
    let result = s.add_references(&h, batch(&frame, json!(items))).unwrap();
    assert_eq!(result.created.len(), 39);
    assert_eq!(result.failed.len(), 1);
    assert_eq!(result.failed[0].index, 7);
    assert_eq!(result.failed[0].field, "filePath");
    assert_eq!(
        std::fs::read_dir(d.path().join("references"))
            .unwrap()
            .count(),
        39
    );
}
#[test]
fn all_bad_later_ancestry_invalid_item_frame_and_call_level_errors() {
    let (_d, s, h, f) = fixture();
    let input = batch(
        &f,
        json!([{"kind":"link","url":"bad"},{"kind":"link","url":"https://example.test","derivedFrom":"#5"},{"kind":"link","url":"https://example.test","frameId":"missing"}]),
    );
    let result = s.add_references(&h, input.clone()).unwrap();
    assert!(result.created.is_empty());
    assert_eq!(result.failed.len(), 3);
    assert!(s.add_references(&h, input).unwrap().replayed);
    for items in [
        json!([]),
        json!(vec![
            json!({"kind":"link","url":"https://example.test"});
            51
        ]),
    ] {
        let mut input = batch(&f, items);
        input.request_id = "new".into();
        assert!(s.add_references(&h, input).is_err());
    }
    s.archive_ref_frame(&h, &f).unwrap();
    let mut input = batch(&f, json!([{"kind":"link","url":"https://example.test"}]));
    input.request_id = "archived".into();
    assert!(s.add_references(&h, input).is_err());
    assert!(s.list_references(None, None, None).unwrap().is_empty());
}
#[test]
fn forty_valid_items_one_receipt_and_rollback_removes_copies() {
    let (d, s, h, f) = fixture();
    let path = d.path().join("image.png");
    std::fs::write(&path, b"fixture").unwrap();
    let input = batch(
        &f,
        json!(vec![
            json!({"kind":"asset","filePath":path,"copy":true});
            40
        ]),
    );
    Connection::open(&s.path).unwrap().execute_batch("CREATE TRIGGER fail_batch BEFORE INSERT ON ref_items BEGIN SELECT RAISE(ABORT,'database fault'); END;").unwrap();
    assert!(s.add_references(&h, input.clone()).is_err());
    assert_eq!(
        std::fs::read_dir(d.path().join("references"))
            .unwrap()
            .count(),
        0
    );
    Connection::open(&s.path)
        .unwrap()
        .execute_batch("DROP TRIGGER fail_batch;")
        .unwrap();
    let result = s.add_references(&h, input).unwrap();
    assert_eq!(result.created.len(), 40);
    assert!(result.failed.is_empty());
    assert_eq!(
        Connection::open(&s.path)
            .unwrap()
            .query_row(
                "SELECT count(*) FROM write_receipts WHERE tool='add_references'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}
#[test]
fn folder_copies_use_portable_files_and_copy_caps_are_enforced() {
    let d = tempfile::tempdir().unwrap();
    let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
    let handle = m.create(&d.path().join("Board"), "Batch", false).unwrap();
    let s = &handle.store;
    let h = s.current_member().unwrap().id;
    let frame = s
        .create_canvas_frame(
            &h,
            serde_json::from_value(json!({"title":"Frame"})).unwrap(),
        )
        .unwrap();
    let path = d.path().join("candidate.png");
    std::fs::write(&path, b"fixture").unwrap();
    let result = s
        .add_references(
            &h,
            batch(
                &frame.id,
                json!([{"kind":"asset","filePath":path,"copy":true}]),
            ),
        )
        .unwrap();
    assert_eq!(result.created.len(), 1);
    let files = s.list_file_assets(FileAssetQuery::default()).unwrap();
    assert_eq!(files[0].storage_type, "board_file");
    assert!(files[0].stored_path.starts_with("files/"));
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(50 * 1024 * 1024 + 1).unwrap();
    let mut input = batch(
        &frame.id,
        json!([{"kind":"asset","filePath":path,"copy":true}]),
    );
    input.request_id = "large".into();
    assert_eq!(
        s.add_references(&h, input).unwrap().failed[0].field,
        "filePath"
    );
    file.set_len(51 * 1024 * 1024).unwrap();
    let mut input = batch(
        &frame.id,
        json!(vec![
            json!({"kind":"asset","filePath":path,"copy":true});
            10
        ]),
    );
    input.request_id = "cap".into();
    assert!(
        matches!(s.add_references(&h,input),Err(Error::Validation{field,reason}) if field=="items" && reason=="A batch may copy at most 500 MiB")
    );
}
