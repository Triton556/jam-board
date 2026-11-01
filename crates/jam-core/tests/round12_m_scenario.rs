use jam_core::*;
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};
#[test]
fn forty_images_six_frames_twenty_verdicts_three_reasons_and_review_events_without_polling() {
    let d = tempfile::tempdir().unwrap();
    let s = Arc::new(Store::open(d.path().join("fixture.db")).unwrap());
    let (_, h) = s
        .create_jam("Moodboard scenario", None, None, None, "UTC", "Human")
        .unwrap();
    let a = s.identify_agent("Fixture brain", "fixture").unwrap();
    let frames = (0..6)
        .map(|i| {
            s.create_canvas_frame(
                &h.id,
                serde_json::from_value(json!({"title":format!("Section {i}")})).unwrap(),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let source = d.path().join("image.png");
    std::fs::write(&source, b"synthetic image bytes").unwrap();
    let mut ids = vec![];
    for batch in 0..2 {
        let items=(0..20).map(|i|json!({"kind":"asset","filePath":source,"copy":true,"title":format!("Image {}",batch*20+i),"frameId":frames[(batch*20+i)%6].id,"sourceUrl":format!("https://example.test/{}",batch*20+i),"origin":"found"})).collect::<Vec<_>>();
        let result = s
            .add_references(
                &a.id,
                serde_json::from_value(json!({"requestId":format!("batch-{batch}"),"items":items}))
                    .unwrap(),
            )
            .unwrap();
        assert!(result.failed.is_empty());
        ids.extend(result.created.into_iter().map(|i| i.id));
    }
    let mut expected = BTreeMap::new();
    for (i, id) in ids.iter().take(20).enumerate() {
        let verdict = if i % 2 == 0 { "keep" } else { "reject" };
        let note = if [0, 7, 14].contains(&i) {
            Some(format!("Reason {i}"))
        } else {
            None
        };
        let mut input = json!({"itemId":id,"verdict":verdict});
        if let Some(note) = &note {
            input["verdictNote"] = json!(note);
        }
        s.set_reference_verdict(&h.id, serde_json::from_value(input).unwrap())
            .unwrap();
        expected.insert(id.clone(), (verdict.to_owned(), note));
    }
    let cursor = s.latest_seq().unwrap();
    let agent = a.id.clone();
    let waiter_store = s.clone();
    rusqlite::Connection::open(&s.path)
        .unwrap()
        .execute(
            "UPDATE project_members SET last_seen_at='2000-01-01T00:00:00Z' WHERE member_id=?",
            [&agent],
        )
        .unwrap();
    let waiter = std::thread::spawn(move || {
        let mut cursor = cursor;
        let mut events = vec![];
        while events.len() < 6 {
            let result=waiter_store.wait_for_changes(&agent,serde_json::from_value(json!({"cursor":cursor,"actions":["reference.review_sent"],"timeoutSeconds":3})).unwrap()).unwrap();
            assert!(!result.timed_out);
            cursor = result.next_cursor;
            events.extend(result.events);
        }
        events
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let ready=rusqlite::Connection::open(&s.path).unwrap().query_row("SELECT last_seen_at!='2000-01-01T00:00:00Z' FROM project_members WHERE member_id=?",[&a.id],|r|r.get::<_,bool>(0)).unwrap();
        if ready {
            break;
        }
        assert!(Instant::now() < deadline, "long-poll did not start");
        std::thread::sleep(Duration::from_millis(5));
    }
    for frame in &frames {
        s.send_reference_review(&h.id, &frame.id).unwrap();
    }
    let events = waiter.join().unwrap();
    assert_eq!(events.len(), 6);
    assert!(events.iter().all(|e| e.action == "reference.review_sent"));
    let canvas = s
        .get_canvas(serde_json::from_value(json!({"limit":200})).unwrap())
        .unwrap();
    let rated = canvas
        .references
        .iter()
        .filter(|i| !i["verdict"].is_null())
        .collect::<Vec<_>>();
    assert_eq!(rated.len(), 20);
    assert_eq!(
        canvas
            .references
            .iter()
            .filter(|i| !i["verdictNote"].is_null())
            .count(),
        3
    );
    for item in rated {
        let (verdict, note) = &expected[item["id"].as_str().unwrap()];
        assert_eq!(item["verdict"], *verdict);
        assert_eq!(item["verdictNote"], json!(note));
    }
}
