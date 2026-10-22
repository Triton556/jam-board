use jam_core::*;

fn fixture() -> (tempfile::TempDir, Store, String) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let store = Store::open(dir.path().join("jam.db")).unwrap();
    store.seed_demo().unwrap();
    let human = store.current_member().unwrap().id;
    (dir, store, human)
}

fn round_trip(title: Option<&str>, body: &str, untitled: bool, clear_existing: bool) {
    let (dir, store, human) = fixture();
    let input = AddReference {
        kind: "note".into(),
        title: title.map(str::to_owned),
        text: Some(body.into()),
        tags: Some(vec!["capture".into()]),
        x: Some(117.),
        y: Some(233.),
        ..Default::default()
    };
    let mut original = if untitled {
        store.add_reference_untitled(&human, input)
    } else {
        store.add_reference(&human, input)
    }
    .unwrap();
    if clear_existing {
        original = store
            .update_reference_checked(
                &human,
                &original.audit.id,
                ReferencePatch {
                    title: Some(String::new()),
                    caption: Some(String::new()),
                    ..Default::default()
                },
                ReferenceContentExpectation {
                    title: original.title.clone(),
                    caption: original.caption_md.clone(),
                },
            )
            .unwrap();
    }
    let expected_title = if clear_existing {
        ""
    } else {
        title.unwrap_or(if untitled { "" } else { "Note" })
    };
    let expected_body = if clear_existing { "" } else { body };
    assert_eq!(original.title, expected_title);
    assert_eq!(original.caption_md, expected_body);
    let original_count = store.reference_canvas().unwrap().items.len();
    let original_project = original.audit.jam_id.clone();
    let original_id = original.audit.id.clone();
    drop(store);

    // Verify persisted storage, not just the command's returned object.
    let store = Store::open(dir.path().join("jam.db")).unwrap();
    let reopened = store
        .reference_canvas()
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.audit.id == original_id)
        .unwrap();
    assert_eq!(reopened.title, expected_title);
    assert_eq!(reopened.caption_md, expected_body);
    let exported = store.export_jam().unwrap();
    let exported_note = exported
        .planning
        .as_ref()
        .unwrap()
        .items
        .iter()
        .find(|item| item.audit.id == original_id)
        .unwrap();
    assert_eq!(exported_note.title, expected_title);
    assert_eq!(exported_note.caption_md, expected_body);
    let json = serde_json::to_string(&exported).unwrap();
    let imported_project = store.import_jam_json(&human, &json).unwrap().jam.unwrap();
    assert_ne!(imported_project.id, original_project);
    let imported_canvas = store.reference_canvas().unwrap();
    assert_eq!(imported_canvas.items.len(), original_count);
    let imported = imported_canvas
        .items
        .into_iter()
        .find(|item| item.title == expected_title && item.caption_md == expected_body)
        .unwrap();
    assert_ne!(imported.audit.id, original_id);
    assert_eq!(imported.audit.jam_id, imported_project.id);
    assert_eq!(imported.tags, original.tags);
    assert_eq!(
        (imported.x, imported.y, imported.w, imported.h),
        (original.x, original.y, original.w, original.h)
    );
    let reexported = store.export_jam().unwrap();
    assert_eq!(
        reexported.planning.as_ref().unwrap().items.len(),
        exported.planning.as_ref().unwrap().items.len()
    );
    let reexported_note = reexported
        .planning
        .as_ref()
        .unwrap()
        .items
        .iter()
        .find(|item| item.audit.id == imported.audit.id)
        .unwrap();
    assert_eq!(reexported_note.title, expected_title);
    assert_eq!(reexported_note.caption_md, expected_body);
}

#[test]
fn heading_only_note_survives_storage_and_export_import_without_invented_body() {
    round_trip(Some("An explicit human heading"), "", false, false);
}

#[test]
fn untitled_body_only_note_survives_storage_and_export_import_without_invented_heading() {
    round_trip(
        None,
        "A body without a heading.\nKeep this exact text.",
        true,
        false,
    );
}

#[test]
fn literal_note_heading_is_preserved_in_storage_and_export_import() {
    round_trip(
        Some("Note"),
        "The human deliberately chose the heading Note.",
        false,
        false,
    );
}

#[test]
fn intentionally_cleared_saved_note_survives_storage_and_export_import_as_one_blank_record() {
    round_trip(
        Some("Erase this heading"),
        "Erase this saved body",
        false,
        true,
    );
}

#[test]
fn ordinary_legacy_create_keeps_default_note_heading_through_storage_and_export_import() {
    round_trip(
        None,
        "An old caller still gets its ordinary default heading.",
        false,
        false,
    );
}

#[test]
fn brand_new_blank_native_note_is_still_rejected_without_a_record_or_event() {
    let (_dir, store, human) = fixture();
    let before_count = store.reference_canvas().unwrap().items.len();
    let before_events = store.activity_count().unwrap();
    assert!(matches!(
        store.add_reference_untitled(
            &human,
            AddReference {
                kind: "note".into(),
                text: Some(" \n".into()),
                ..Default::default()
            }
        ),
        Err(Error::Validation { .. })
    ));
    assert_eq!(store.reference_canvas().unwrap().items.len(), before_count);
    assert_eq!(store.activity_count().unwrap(), before_events);
}
