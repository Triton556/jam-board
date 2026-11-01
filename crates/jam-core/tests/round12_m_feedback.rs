use jam_core::*;
use serde_json::{Value, json};

fn fixture() -> (tempfile::TempDir, Store, String) {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fixture.db")).unwrap();
    let (_, h) = s
        .create_jam("Moodboard", None, None, None, "UTC", "Human")
        .unwrap();
    (d, s, h.id)
}
fn reference(s: &Store, h: &str) -> RefItem {
    s.add_reference(
        h,
        AddReference {
            kind: ReferenceKind::Link,
            url: Some("https://example.test/image".into()),
            ..Default::default()
        },
    )
    .unwrap()
}
fn feedback(s: &Store, h: &str, id: &str, mut input: Value) -> Result<RefItem> {
    input["itemId"] = json!(id);
    s.set_reference_verdict(h, serde_json::from_value(input).unwrap())
}

#[test]
fn verdict_reason_partial_updates_clear_limits_and_noop_events() {
    let (_d, s, h) = fixture();
    let item = reference(&s, &h);
    let id = &item.audit.id;
    assert!(feedback(&s, &h, id, json!({})).is_err());
    let reason = feedback(&s, &h, id, json!({"verdictNote":"  Light\nand shape  "})).unwrap();
    assert_eq!(reason.verdict_note.as_deref(), Some("Light\nand shape"));
    assert_eq!(reason.verdict, None);
    let kept = feedback(&s, &h, id, json!({"verdict":"keep"})).unwrap();
    assert_eq!(kept.verdict, Some(ReferenceVerdict::Keep));
    assert_eq!(kept.verdict_note, reason.verdict_note);
    let count = s.activity_count().unwrap();
    feedback(
        &s,
        &h,
        id,
        json!({"verdict":"keep","verdictNote":"Light\nand shape"}),
    )
    .unwrap();
    assert_eq!(s.activity_count().unwrap(), count);
    assert!(feedback(&s, &h, id, json!({"verdictNote":"x".repeat(501)})).is_err());
    feedback(
        &s,
        &h,
        id,
        json!({"verdict":"reject","verdictNote":"x".repeat(500)}),
    )
    .unwrap();
    for value in [Value::Null, json!(""), json!("   ")] {
        let clear = feedback(&s, &h, id, json!({"verdict":null,"verdictNote":value})).unwrap();
        assert_eq!(clear.verdict, None);
        assert_eq!(clear.verdict_note, None);
    }
    let agent = s.identify_agent("Fixture", "codex").unwrap();
    assert!(matches!(
        feedback(&s, &agent.id, id, json!({"verdict":"keep"})),
        Err(Error::Forbidden(_))
    ));
    let note = s
        .add_reference(
            &h,
            AddReference {
                kind: ReferenceKind::Note,
                title: Some("Note".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        matches!(feedback(&s,&h,&note.audit.id,json!({"verdictNote":"reason"})),Err(Error::Validation{field,reason}) if field=="itemId" && reason=="Notes cannot be rated")
    );
}

#[test]
fn source_origin_and_ancestry_validation_share_create_and_update_paths() {
    let (_d, s, h) = fixture();
    let first = reference(&s, &h);
    let second = reference(&s, &h);
    for url in [
        "file:///secret",
        "https://user:pass@example.test/a",
        "https://example.test/a b",
        "https://",
    ] {
        let patch = serde_json::from_value(json!({"sourceUrl":url})).unwrap();
        assert!(s.update_reference(&h, &first.audit.id, patch).is_err());
        assert!(
            s.add_reference(
                &h,
                AddReference {
                    kind: ReferenceKind::Link,
                    url: Some("https://example.test".into()),
                    source_url: Some(url.into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
    }
    let updated=s.update_reference(&h,&second.audit.id,serde_json::from_value(json!({"sourceUrl":"https://example.test/source","origin":"generated","derivedFrom":first.audit.id})).unwrap()).unwrap();
    assert_eq!(updated.origin, Some(ReferenceOrigin::Generated));
    for (id, parent) in [
        (&first.audit.id, &first.audit.id),
        (&first.audit.id, &second.audit.id),
    ] {
        assert!(
            s.update_reference(
                &h,
                id,
                serde_json::from_value(json!({"derivedFrom":parent})).unwrap()
            )
            .is_err()
        );
    }
    let cleared = s
        .update_reference(
            &h,
            &second.audit.id,
            serde_json::from_value(json!({"sourceUrl":null,"origin":null,"derivedFrom":null}))
                .unwrap(),
        )
        .unwrap();
    assert!(
        cleared.source_url.is_none() && cleared.origin.is_none() && cleared.derived_from.is_none()
    );
    s.update_reference(
        &h,
        &second.audit.id,
        serde_json::from_value(json!({"derivedFrom":first.audit.id})).unwrap(),
    )
    .unwrap();
    s.archive_reference(&h, &first.audit.id).unwrap();
    s.add_reference(
        &h,
        AddReference {
            kind: ReferenceKind::Link,
            url: Some("https://example.test/variation".into()),
            derived_from: Some(second.audit.id.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        s.update_reference(
            &h,
            &second.audit.id,
            serde_json::from_value(json!({"derivedFrom":first.audit.id})).unwrap()
        )
        .is_err()
    );
    let project = s.active_jam().unwrap();
    let pinned = s.for_project(&project.id).unwrap();
    let (_, other) = s
        .create_jam("Other", None, None, None, "UTC", "Other human")
        .unwrap();
    let foreign = reference(&s, &other.id);
    assert!(
        pinned
            .update_reference(
                &h,
                &second.audit.id,
                serde_json::from_value(json!({"derivedFrom":foreign.audit.id})).unwrap()
            )
            .is_err()
    );
    assert!(
        serde_json::from_value::<AddReference>(
            json!({"kind":"link","url":"https://example.test","copiedFrom":"id"})
        )
        .is_err()
    );
}

#[test]
fn ancestry_allows_one_hundred_links_and_refuses_one_hundred_and_one_without_writes() {
    let (_d, s, h) = fixture();
    let rows = (0..101).map(|_| reference(&s, &h)).collect::<Vec<_>>();
    let subject = reference(&s, &h);
    let c = rusqlite::Connection::open(&s.path).unwrap();
    for index in 0..100 {
        c.execute(
            "UPDATE ref_items SET derived_from=? WHERE id=?",
            rusqlite::params![rows[index + 1].audit.id, rows[index].audit.id],
        )
        .unwrap();
    }
    s.update_reference(
        &h,
        &subject.audit.id,
        serde_json::from_value(json!({"derivedFrom":rows[1].audit.id})).unwrap(),
    )
    .unwrap();
    let count = s.activity_count().unwrap();
    assert!(
        matches!(s.update_reference(&h,&subject.audit.id,serde_json::from_value(json!({"derivedFrom":rows[0].audit.id})).unwrap()),Err(Error::Validation{field,reason}) if field=="derivedFrom" && reason=="This would create a derivation loop")
    );
    assert_eq!(s.activity_count().unwrap(), count);
}
