use jam_core::*;
use serde_json::json;
#[test]
fn canvas_feedback_filters_keep_attached_notes_and_frame_counts() {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fixture.db")).unwrap();
    let (_, h) = s
        .create_jam("Canvas", None, None, None, "UTC", "Human")
        .unwrap();
    let frame = s
        .create_canvas_frame(
            &h.id,
            serde_json::from_value(json!({"title":"Moodboard"})).unwrap(),
        )
        .unwrap();
    let mut items = vec![];
    for i in 0..3 {
        items.push(
            s.add_reference(
                &h.id,
                AddReference {
                    kind: ReferenceKind::Link,
                    url: Some("https://example.test/image".into()),
                    title: Some(format!("Item {i}")),
                    frame_id: Some(frame.id.clone()),
                    ..Default::default()
                },
            )
            .unwrap(),
        );
    }
    for (index, verdict) in [(0, "keep"), (1, "reject")] {
        s.set_reference_verdict(
            &h.id,
            serde_json::from_value(
                json!({"itemId":items[index].audit.id,"verdict":verdict,"verdictNote":"Reason"}),
            )
            .unwrap(),
        )
        .unwrap();
    }
    let note = s
        .add_reference(
            &h.id,
            AddReference {
                kind: ReferenceKind::Note,
                title: Some("Attached".into()),
                frame_id: Some(frame.id.clone()),
                x: Some(items[0].x),
                y: Some(items[0].y),
                ..Default::default()
            },
        )
        .unwrap();
    for (filter, title, notes) in [
        ("keep", "Item 0", 1),
        ("reject", "Item 1", 0),
        ("unrated", "Item 2", 0),
    ] {
        let page = s
            .get_canvas(
                serde_json::from_value(json!({"frameId":frame.id,"verdict":filter})).unwrap(),
            )
            .unwrap();
        assert_eq!(
            page.references
                .iter()
                .filter(|i| i["kind"] != "note")
                .count(),
            1
        );
        assert!(page.references.iter().any(|i| i["title"] == title));
        assert_eq!(
            page.references
                .iter()
                .filter(|i| i["id"] == note.audit.id)
                .count(),
            notes
        );
        assert_eq!(page.frames[0]["review"]["total"], 3);
        assert_eq!(page.frames[0]["review"]["keep"], 1);
        assert_eq!(page.frames[0]["review"]["reject"], 1);
        assert_eq!(page.frames[0]["review"]["unrated"], 1);
        assert_eq!(page.frames[0]["review"]["comments"], 3);
        for field in [
            "verdictNote",
            "sourceUrl",
            "origin",
            "derivedFrom",
            "copiedFrom",
        ] {
            assert!(page.references[0].get(field).is_some());
        }
    }
    let empty = s
        .create_canvas_frame(
            &h.id,
            serde_json::from_value(json!({"title":"Empty","x":frame.x,"y":frame.y})).unwrap(),
        )
        .unwrap();
    s.add_reference(
        &h.id,
        AddReference {
            kind: ReferenceKind::Note,
            title: Some("Overlapping another frame's item".into()),
            frame_id: Some(empty.id.clone()),
            x: Some(items[0].x),
            y: Some(items[0].y),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        s.get_canvas(serde_json::from_value(json!({"frameId":empty.id,"verdict":"keep"})).unwrap())
            .unwrap()
            .references
            .is_empty()
    );
    assert!(
        s.list_ref_frames()
            .unwrap()
            .iter()
            .find(|f| f.id == empty.id)
            .unwrap()
            .review
            .is_none()
    );
}
