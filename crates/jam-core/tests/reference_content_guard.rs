use jam_core::*;
use std::sync::{Arc, Barrier};

fn fixture() -> (tempfile::TempDir, Store, String, RefItem) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let store = Store::open(dir.path().join("jam.db")).unwrap();
    store.seed_demo().unwrap();
    let human = store.current_member().unwrap().id;
    let note = store
        .add_reference(
            &human,
            AddReference {
                kind: "note".into(),
                text: Some("A small human idea".into()),
                ..Default::default()
            },
        )
        .unwrap();
    (dir, store, human, note)
}

fn expected(note: &RefItem) -> ReferenceContentExpectation {
    ReferenceContentExpectation {
        title: note.title.clone(),
        caption: note.caption_md.clone(),
    }
}

fn current(store: &Store, id: &str) -> RefItem {
    store
        .reference_canvas()
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.audit.id == id)
        .unwrap()
}

#[test]
fn guarded_note_content_preserves_an_intervening_agent_edit_without_an_event() {
    let (_dir, store, human, original) = fixture();
    let agent = store
        .list_members()
        .unwrap()
        .into_iter()
        .find(|member| member.member.kind == "agent")
        .unwrap()
        .member
        .id;
    let agent_note = store
        .update_reference(
            &agent,
            &original.audit.id,
            ReferencePatch {
                caption: Some("Agent supplied a newer result".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let count = store.activity_count().unwrap();
    assert!(matches!(
        store.update_reference_checked(
            &human,
            &original.audit.id,
            ReferencePatch {
                caption: Some("Human retained local text".into()),
                ..Default::default()
            },
            expected(&original)
        ),
        Err(Error::Conflict)
    ));
    assert_eq!(store.activity_count().unwrap(), count);
    assert_eq!(
        serde_json::to_value(current(&store, &original.audit.id)).unwrap(),
        serde_json::to_value(agent_note).unwrap()
    );
}

#[test]
fn title_only_change_also_refuses_a_stale_caption_patch() {
    let (_dir, store, human, original) = fixture();
    let renamed = store
        .update_reference(
            &human,
            &original.audit.id,
            ReferencePatch {
                title: Some("An intentionally changed heading".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let count = store.activity_count().unwrap();
    assert!(matches!(
        store.update_reference_checked(
            &human,
            &original.audit.id,
            ReferencePatch {
                caption: Some("Stale title context".into()),
                ..Default::default()
            },
            expected(&original)
        ),
        Err(Error::Conflict)
    ));
    assert_eq!(store.activity_count().unwrap(), count);
    assert_eq!(
        serde_json::to_value(current(&store, &original.audit.id)).unwrap(),
        serde_json::to_value(renamed).unwrap()
    );
}

#[test]
fn successful_content_patch_preserves_intervening_tags_and_geometry() {
    let (_dir, store, human, original) = fixture();
    store
        .update_reference(
            &human,
            &original.audit.id,
            ReferencePatch {
                tags: Some(vec!["keep".into()]),
                ..Default::default()
            },
        )
        .unwrap();
    store
        .canvas_geometry(
            &human,
            CanvasGeometry {
                id: original.audit.id.clone(),
                x: 123.,
                y: 234.,
                w: 320.,
                h: 220.,
                z: 2.,
                frame_id: None,
            },
        )
        .unwrap();
    let count = store.activity_count().unwrap();
    let saved = store
        .update_reference_checked(
            &human,
            &original.audit.id,
            ReferencePatch {
                title: Some("Optional heading".into()),
                caption: Some("Updated directly on paper".into()),
                ..Default::default()
            },
            expected(&original),
        )
        .unwrap();
    assert_eq!(saved.title, "Optional heading");
    assert_eq!(saved.caption_md, "Updated directly on paper");
    assert_eq!(saved.tags, vec!["keep"]);
    assert_eq!(
        (saved.x, saved.y, saved.w, saved.h, saved.z),
        (123., 234., 320., 220., 2.)
    );
    assert_eq!(store.activity_count().unwrap(), count + 1);
}

#[test]
fn two_independent_guarded_writers_cannot_both_replace_the_same_content() {
    let (_dir, store, human, original) = fixture();
    // Distinct Store instances also exercise SQLite's transaction boundary,
    // rather than relying only on one Store's in-process writer mutex.
    let other = Store::open(&store.path).unwrap();
    let start = Arc::new(Barrier::new(2));
    let count = store.activity_count().unwrap();
    let run = |writer: Store, text: &'static str| {
        let start = Arc::clone(&start);
        let human = human.clone();
        let original = original.clone();
        std::thread::spawn(move || {
            start.wait();
            writer.update_reference_checked(
                &human,
                &original.audit.id,
                ReferencePatch {
                    caption: Some(text.into()),
                    ..Default::default()
                },
                expected(&original),
            )
        })
    };
    let first = run(store.clone(), "First writer");
    let second = run(other, "Second writer");
    let results = [first.join().unwrap(), second.join().unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(Error::Conflict)))
            .count(),
        1
    );
    let winner = results.into_iter().find_map(Result::ok).unwrap();
    assert_eq!(
        current(&store, &original.audit.id).caption_md,
        winner.caption_md
    );
    assert_eq!(store.activity_count().unwrap(), count + 1);
}

#[test]
fn old_callers_remain_compatible_and_archived_notes_still_refuse_writes() {
    let (_dir, store, human, original) = fixture();
    let saved = store
        .update_reference(
            &human,
            &original.audit.id,
            ReferencePatch {
                caption: Some("Existing caller".into()),
                ..Default::default()
            },
        )
        .unwrap();
    store.archive_reference(&human, &original.audit.id).unwrap();
    let count = store.activity_count().unwrap();
    assert!(matches!(
        store.update_reference_checked(
            &human,
            &original.audit.id,
            ReferencePatch {
                caption: Some("No restore".into()),
                ..Default::default()
            },
            expected(&saved)
        ),
        Err(Error::Archived(_))
    ));
    assert_eq!(store.activity_count().unwrap(), count);
    assert!(
        store
            .reference_canvas()
            .unwrap()
            .items
            .iter()
            .all(|item| item.audit.id != original.audit.id)
    );
}

#[test]
fn expectation_is_a_separate_complete_contract_not_an_mcp_patch_field() {
    let input: ReferenceEditInput = serde_json::from_value(serde_json::json!({
        "itemId": "note-id", "caption": "Existing MCP client"
    }))
    .unwrap();
    assert_eq!(input.item_id, "note-id");
    assert_eq!(input.patch.caption.as_deref(), Some("Existing MCP client"));
    let encoded = serde_json::to_value(input).unwrap();
    assert!(encoded.get("expected").is_none());
    assert!(
        serde_json::from_value::<ReferenceEditInput>(serde_json::json!({
            "itemId": "note-id", "caption": "Unchanged tool contract",
            "expected": { "title": "Note", "caption": "Old text" }
        }))
        .is_err()
    );
    for invalid in [
        serde_json::json!({ "title": "Note" }),
        serde_json::json!({ "caption": "Old text" }),
        serde_json::json!({ "title": "Note", "caption": "Old text", "extra": true }),
    ] {
        assert!(serde_json::from_value::<ReferenceContentExpectation>(invalid).is_err());
    }
}

#[test]
fn guarded_clear_keeps_the_same_note_heading_and_geometry() {
    let (_dir, store, human, original) = fixture();
    let before = store.reference_canvas().unwrap().items.len();
    let events = store.activity_count().unwrap();
    let saved = store
        .update_reference_checked(
            &human,
            &original.audit.id,
            ReferencePatch {
                caption: Some(String::new()),
                ..Default::default()
            },
            expected(&original),
        )
        .unwrap();
    assert_eq!(saved.audit.id, original.audit.id);
    assert_eq!(saved.title, original.title);
    assert_eq!(saved.caption_md, "");
    assert_eq!(
        (saved.x, saved.y, saved.w, saved.h, saved.z),
        (original.x, original.y, original.w, original.h, original.z)
    );
    assert_eq!(saved.audit.archived_at, original.audit.archived_at);
    assert_eq!(store.reference_canvas().unwrap().items.len(), before);
    assert_eq!(store.activity_count().unwrap(), events + 1);
}

#[test]
fn note_creation_accepts_explicit_heading_or_body_but_not_both_blank() {
    let (_dir, store, human, _) = fixture();
    for heading in ["A heading alone", "Note"] {
        let saved = store
            .add_reference(
                &human,
                AddReference {
                    kind: "note".into(),
                    title: Some(heading.into()),
                    text: Some(String::new()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(saved.title, heading);
        assert_eq!(saved.caption_md, "");
    }
    let count = store.reference_canvas().unwrap().items.len();
    let events = store.activity_count().unwrap();
    for title in [None, Some("   ".into())] {
        assert!(
            store
                .add_reference(
                    &human,
                    AddReference {
                        kind: "note".into(),
                        title,
                        text: Some(" \n ".into()),
                        ..Default::default()
                    }
                )
                .is_err()
        );
    }
    assert_eq!(store.reference_canvas().unwrap().items.len(), count);
    assert_eq!(store.activity_count().unwrap(), events);
}

#[test]
fn native_untitled_mode_does_not_relax_legacy_title_validation() {
    let (_dir, store, human, legacy) = fixture();
    assert_eq!(legacy.title, "Note");
    let note = store
        .add_reference_untitled(
            &human,
            AddReference {
                kind: "note".into(),
                text: Some("No heading chosen".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(note.title, "");
    let events = store.activity_count().unwrap();
    assert!(
        store
            .update_reference(
                &human,
                &note.audit.id,
                ReferencePatch {
                    title: Some(String::new()),
                    ..Default::default()
                }
            )
            .is_err()
    );
    assert_eq!(store.activity_count().unwrap(), events);
    assert!(
        store
            .add_reference_untitled(
                &human,
                AddReference {
                    kind: "link".into(),
                    url: Some("https://example.com".into()),
                    ..Default::default()
                }
            )
            .is_err()
    );
    assert!(
        store
            .add_reference_untitled(
                &human,
                AddReference {
                    kind: "note".into(),
                    title: Some("Contradictory heading".into()),
                    text: Some("Body".into()),
                    ..Default::default()
                }
            )
            .is_err()
    );
}
