use jam_core::*;
use rusqlite::{Connection, params};
use serde_json::{Value, json};
struct Fixture {
    _dir: tempfile::TempDir,
    s: Store,
    h: String,
    a: String,
    epic: Epic,
    other: Epic,
    task: TaskDetail,
}
fn fixture() -> Fixture {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fixture.db")).unwrap();
    let (_, h) = s
        .create_jam("Inbox", None, None, None, "UTC", "Human")
        .unwrap();
    let a = s.identify_agent("Claude", "fixture").unwrap();
    let story = s.default_task_story(&h.id).unwrap();
    let task = s
        .create_task(
            &h.id,
            CreateTask {
                title: "Task".into(),
                story_key: Some(story.key),
                ..Default::default()
            },
        )
        .unwrap();
    let epic = task.epic.clone();
    let other = s
        .create_epic(
            &h.id,
            NewEpic {
                title: "Other".into(),
                ..Default::default()
            },
        )
        .unwrap();
    Connection::open(&s.path)
        .unwrap()
        .execute("DELETE FROM activity", [])
        .unwrap();
    Fixture {
        _dir: d,
        s,
        h: h.id,
        a: a.id,
        epic,
        other,
        task,
    }
}
fn event(
    f: &Fixture,
    actor: &str,
    action: &str,
    epic: Option<&str>,
    task: Option<&str>,
    payload: Value,
    time: &str,
) -> i64 {
    let c = Connection::open(&f.s.path).unwrap();
    c.execute("INSERT INTO activity(id,jam_id,actor_id,action,task_id,payload,created_at,epic_id) VALUES(?,?,?,?,?,?,?,?)",params![ulid::Ulid::generate().to_string(),f.s.active_jam().unwrap().id,actor,action,task,payload.to_string(),time,epic]).unwrap();
    c.last_insert_rowid()
}
#[test]
fn inbox_whitelist_own_event_rule_and_review_target() {
    let f = fixture();
    for action in [
        "question.asked",
        "question.answered",
        "agent.status",
        "reference.updated",
        "task.brief_updated",
        "reference.linked",
        "epic.updated",
    ] {
        event(
            &f,
            &f.a,
            action,
            None,
            None,
            json!({}),
            "2026-11-01T00:00:00Z",
        );
    }
    for actor in [&f.h, &f.a] {
        event(
            &f,
            actor,
            "task.created",
            Some(&f.epic.audit.id),
            Some(&f.task.task.id),
            json!({}),
            "2026-11-01T00:00:00Z",
        );
    }
    event(
        &f,
        &f.h,
        "reference.review_sent",
        None,
        None,
        json!({"frameId":"frame","frameTitle":"Sky","keep":12,"reject":8,"unrated":0,"comments":3}),
        "2026-11-01T00:01:00Z",
    );
    let page =
        f.s.list_inbox_events(&f.h, InboxEventsQuery::default())
            .unwrap();
    assert_eq!(page.events.len(), 2);
    assert_eq!(page.unread, 2);
    assert_eq!(page.events[0].frame_id.as_deref(), Some("frame"));
    assert!(
        page.events[0]
            .sentence
            .starts_with("You sent the review of Sky")
    );
    assert_eq!(
        page.events[1].task_key.as_deref(),
        Some(f.task.task.key.as_str())
    );
}
#[test]
fn inbox_resolves_reports_by_later_task_review_and_requests_by_exact_id() {
    let f = fixture();
    let task = Some(f.task.task.id.as_str());
    event(
        &f,
        &f.a,
        "report.submitted",
        None,
        task,
        json!({}),
        "2026-11-01T00:00:00Z",
    );
    event(
        &f,
        &f.a,
        "execution.requested",
        None,
        None,
        json!({"requestId":"r1"}),
        "2026-11-01T00:00:00Z",
    );
    event(
        &f,
        &f.a,
        "execution.requested",
        None,
        None,
        json!({"requestId":"r2"}),
        "2026-11-01T00:00:00Z",
    );
    event(
        &f,
        &f.h,
        "review.recorded",
        None,
        task,
        json!({}),
        "2026-11-01T00:01:00Z",
    );
    event(
        &f,
        &f.h,
        "execution.request_resolved",
        None,
        None,
        json!({"requestId":"r1"}),
        "2026-11-01T00:01:00Z",
    );
    let page =
        f.s.list_inbox_events(
            &f.h,
            InboxEventsQuery {
                filter: Some(InboxEventFilter::NeedsAction),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(page.events.len(), 3);
    assert_eq!(page.open_actions, 1);
    assert!(!page.events[0].resolved);
    assert!(page.events[1].resolved && page.events[2].resolved);
    assert!(page.events.iter().all(|e| e.count == 1));
}
#[test]
fn inbox_groups_consecutive_events_by_actor_action_epic_and_ten_minute_gap() {
    let f = fixture();
    for i in 0..40 {
        event(
            &f,
            &f.a,
            "reference.added",
            Some(&f.epic.audit.id),
            None,
            json!({}),
            &format!("2026-11-01T00:00:{i:02}Z"),
        );
    }
    let page =
        f.s.list_inbox_events(&f.h, InboxEventsQuery::default())
            .unwrap();
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].count, 40);
    assert_eq!(page.events[0].sentence, "Claude added 40 references");
    event(
        &f,
        &f.a,
        "reference.added",
        Some(&f.epic.audit.id),
        None,
        json!({}),
        "2026-11-01T00:11:40Z",
    );
    assert_eq!(
        f.s.list_inbox_events(&f.h, InboxEventsQuery::default())
            .unwrap()
            .events
            .len(),
        2
    );
    event(
        &f,
        &f.a,
        "reference.added",
        Some(&f.other.audit.id),
        None,
        json!({}),
        "2026-11-01T00:11:41Z",
    );
    assert_eq!(
        f.s.list_inbox_events(&f.h, InboxEventsQuery::default())
            .unwrap()
            .events
            .len(),
        3
    );
}
#[test]
fn inbox_unread_cap_mark_seen_monotonic_and_paging_covers_every_source_once() {
    let f = fixture();
    let mut seqs = vec![];
    for _ in 0..110 {
        seqs.push(event(
            &f,
            &f.a,
            "reference.added",
            None,
            None,
            json!({}),
            "2026-11-01T00:00:00Z",
        ));
    }
    assert_eq!(
        f.s.list_inbox_events(&f.h, InboxEventsQuery::default())
            .unwrap()
            .unread,
        99
    );
    let mut before = None;
    let mut sources = vec![];
    loop {
        let page =
            f.s.list_inbox_events(
                &f.h,
                InboxEventsQuery {
                    before_seq: before,
                    limit: Some(7),
                    ..Default::default()
                },
            )
            .unwrap();
        for row in page.events {
            sources.extend(row.first_seq..=row.seq);
        }
        before = page.next_before_seq;
        if before.is_none() {
            break;
        }
    }
    sources.sort();
    assert_eq!(sources, seqs);
    assert_eq!(
        f.s.mark_inbox_events_seen(&f.h, seqs[49]).unwrap(),
        seqs[49]
    );
    assert_eq!(f.s.mark_inbox_events_seen(&f.h, seqs[0]).unwrap(), seqs[49]);
    let page =
        f.s.list_inbox_events(&f.h, InboxEventsQuery::default())
            .unwrap();
    assert_eq!(page.unread, 60);
    assert_eq!(page.seen_seq, seqs[49]);
}
