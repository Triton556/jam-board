use jam_core::*;
use serde_json::json;
fn setup() -> (tempfile::TempDir, Store, String) {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fixture.db")).unwrap();
    let (_, h) = s
        .create_jam("Review", None, None, None, "UTC", "Human")
        .unwrap();
    (d, s, h.id)
}
fn frame(s: &Store, h: &str, title: &str) -> RefFrame {
    s.create_canvas_frame(h, serde_json::from_value(json!({"title":title})).unwrap())
        .unwrap()
}
fn add(s: &Store, h: &str, f: &RefFrame) -> RefItem {
    s.add_reference(
        h,
        AddReference {
            kind: ReferenceKind::Link,
            url: Some("https://example.test/image".into()),
            frame_id: Some(f.id.clone()),
            ..Default::default()
        },
    )
    .unwrap()
}
fn keep(s: &Store, h: &str, i: &RefItem) {
    s.set_reference_verdict(
        h,
        serde_json::from_value(json!({"itemId":i.audit.id,"verdict":"keep","verdictNote":"Light"}))
            .unwrap(),
    )
    .unwrap();
}
#[test]
fn send_review_counts_hash_change_resend_permissions_and_empty_frame() {
    let (_d, s, h) = setup();
    let f = frame(&s, &h, "Sky");
    assert!(s.send_reference_review(&h, &f.id).is_err());
    let item = add(&s, &h, &f);
    let _ = add(&s, &h, &f);
    keep(&s, &h, &item);
    let sent = s.send_reference_review(&h, &f.id).unwrap().review.unwrap();
    assert_eq!(sent.total, 2);
    assert_eq!(sent.keep, 1);
    assert_eq!(sent.unrated, 1);
    assert_eq!(sent.comments, 1);
    assert_eq!(sent.sent_by.as_deref(), Some("Human"));
    assert!(!sent.changed_since_sent);
    let event = s
        .activity_page(ActivityQuery::default())
        .unwrap()
        .into_iter()
        .find(|e| e.action == "reference.review_sent")
        .unwrap();
    assert_eq!(event.payload["itemIds"], json!([item.audit.id]));
    assert_eq!(event.payload["comments"], 1);
    assert_eq!(event.payload["frameTitle"], "Sky");
    s.set_reference_verdict(
        &h,
        serde_json::from_value(json!({"itemId":item.audit.id,"verdict":"reject"})).unwrap(),
    )
    .unwrap();
    assert!(
        s.list_ref_frames().unwrap()[0]
            .review
            .as_ref()
            .unwrap()
            .changed_since_sent
    );
    assert!(
        !s.send_reference_review(&h, &f.id)
            .unwrap()
            .review
            .unwrap()
            .changed_since_sent
    );
    let before = s.activity_count().unwrap();
    s.send_reference_review(&h, &f.id).unwrap();
    assert_eq!(s.activity_count().unwrap(), before + 1);
    let a = s.identify_agent("Fixture", "codex").unwrap();
    assert!(matches!(
        s.send_reference_review(&a.id, &f.id),
        Err(Error::Forbidden(_))
    ));
}
#[test]
fn collect_kept_sections_share_assets_reset_feedback_and_keep_original_on_archive() {
    let (d, s, h) = setup();
    let first = frame(&s, &h, "First");
    let second = frame(&s, &h, "Second");
    let path = d.path().join("image.png");
    std::fs::write(&path, b"fixture").unwrap();
    let asset = s
        .add_reference(
            &h,
            AddReference {
                kind: ReferenceKind::Asset,
                file_path: Some(path.to_string_lossy().into()),
                frame_id: Some(first.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    keep(&s, &h, &asset);
    let link = add(&s, &h, &second);
    keep(&s, &h, &link);
    let input: CollectKeptInput = serde_json::from_value(
        json!({"requestId":"collect","sourceFrameIds":[second.id,first.id]}),
    )
    .unwrap();
    let result = s.collect_kept_references(&h, input.clone()).unwrap();
    assert_eq!(result.frame.w, 1080.);
    assert_eq!(result.sections[0].title, "Second");
    assert_eq!(result.sections[1].title, "First");
    assert_eq!(result.item_ids.len(), 2);
    let rows = s.list_references(None, None, None).unwrap();
    let copies = rows
        .iter()
        .filter(|i| i.frame_id.as_deref() == Some(&result.frame.id))
        .collect::<Vec<_>>();
    assert_eq!(copies.len(), 4);
    let headers = copies
        .iter()
        .filter(|i| i.kind == "note")
        .collect::<Vec<_>>();
    assert_eq!(headers.len(), 2);
    assert!(
        headers
            .iter()
            .all(|i| i.w == 1032. && i.h == 48. && i.caption_md.is_empty())
    );
    let copied = copies
        .iter()
        .find(|i| i.copied_from.as_deref() == Some(&asset.audit.id))
        .unwrap();
    assert_eq!(copied.asset_id, asset.asset_id);
    assert_eq!(
        s.asset_usage(asset.asset_id.as_deref().unwrap())
            .unwrap()
            .canvas
            .len(),
        2
    );
    assert!(copied.verdict.is_none() && copied.verdict_note.is_none());
    for header in &headers {
        assert!(
            copies
                .iter()
                .filter(|i| i.kind != "note")
                .all(|i| header.y + header.h <= i.y || header.y >= i.y + i.h)
        );
    }
    s.archive_reference(&h, &copied.audit.id).unwrap();
    assert!(path.exists());
    assert!(
        s.list_references(None, None, None)
            .unwrap()
            .iter()
            .any(|i| i.audit.id == asset.audit.id)
    );
    assert_eq!(
        s.collect_kept_references(&h, input).unwrap().frame.id,
        result.frame.id
    );
    let empty = frame(&s, &h, "Empty");
    assert!(
        s.collect_kept_references(
            &h,
            serde_json::from_value(json!({"requestId":"empty","sourceFrameIds":[empty.id]}))
                .unwrap()
        )
        .is_err()
    );
}
