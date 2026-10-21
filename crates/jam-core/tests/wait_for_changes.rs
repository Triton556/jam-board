use jam_core::*;
use serde_json::json;
use std::{
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};

fn setup() -> (tempfile::TempDir, Arc<Store>, Member, Member, Member, Epic) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests-wfc");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let store = Arc::new(Store::open(dir.path().join("jam.db")).unwrap());
    let (_, human) = store
        .create_jam("Wait tests", None, None, None, "UTC", "Human")
        .unwrap();
    let brain = store.identify_agent("Brain", "codex").unwrap();
    let worker = store.identify_agent("Worker", "codex").unwrap();
    let epic = store
        .create_epic(
            &human.id,
            NewEpic {
                title: "Wait scope".into(),
                ..Default::default()
            },
        )
        .unwrap();
    (dir, store, human, brain, worker, epic)
}
fn input(value: serde_json::Value) -> ChangesWaitInput {
    serde_json::from_value(value).unwrap()
}
fn scope(epic: &Epic) -> Option<Scope> {
    Some(Scope {
        kind: "epic".into(),
        id: epic.key.clone(),
    })
}

#[test]
fn existing_events_are_immediate_and_presence_has_no_activity() {
    let (_dir, s, h, brain, _, epic) = setup();
    let cursor = s.latest_seq().unwrap();
    s.set_status(&h.id, "Human edit", scope(&epic)).unwrap();
    let expected = s.list_changes_since(cursor, None).unwrap();
    let count = s.activity_count().unwrap();
    let before = s
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.id == brain.id)
        .unwrap()
        .member
        .last_seen_at;
    let args = input(json!({"cursor":cursor}));
    assert!(args.exclude_self);
    assert!(!args.include_project);
    assert_eq!(args.timeout_seconds, 30);
    let started = Instant::now();
    let result = s.wait_for_changes(&brain.id, args).unwrap();
    assert!(started.elapsed() < Duration::from_millis(250));
    assert!(!result.timed_out);
    assert_eq!(
        serde_json::to_value(&result.events).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    assert!(result.events[0].sentence.contains("Human"));
    assert_eq!(result.next_cursor, s.latest_seq().unwrap());
    assert_eq!(count, s.activity_count().unwrap());
    let after = s
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.id == brain.id)
        .unwrap()
        .member
        .last_seen_at;
    assert!(after > before);
}

#[test]
fn nonmatching_commits_do_not_wake_and_timeout_advances_cursor() {
    let (_dir, s, h, brain, worker, epic) = setup();
    let cursor = s.latest_seq().unwrap();
    let waiter = s.clone();
    let (tx, rx) = mpsc::channel();
    let started = Instant::now();
    let thread = std::thread::spawn(move || {
        tx.send(
            waiter
                .wait_for_changes(
                    &brain.id,
                    input(
                        json!({"cursor":cursor,"actions":["report.submitted"],"timeoutSeconds":2}),
                    ),
                )
                .unwrap(),
        )
        .unwrap();
    });
    std::thread::sleep(Duration::from_millis(100));
    s.set_status(&h.id, "Not a report", scope(&epic)).unwrap();
    s.set_status(&worker.id, "Also not a report", None).unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_millis(600)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    let result = rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(started.elapsed() >= Duration::from_secs(2));
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(result.timed_out);
    assert!(result.events.is_empty());
    assert_eq!(result.next_cursor, s.latest_seq().unwrap());
    thread.join().unwrap();
}

#[test]
fn self_actor_and_epic_filters_include_only_project_humans_when_requested() {
    let (_dir, s, h, brain, worker, epic) = setup();
    let other = s
        .create_epic(
            &h.id,
            NewEpic {
                title: "Other".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let cursor = s.latest_seq().unwrap();
    s.set_status(&brain.id, "Self", scope(&epic)).unwrap();
    s.set_status(&worker.id, "Other epic", scope(&other))
        .unwrap();
    s.set_status(&h.id, "Project human", None).unwrap();
    s.set_status(&worker.id, "Project agent", None).unwrap();
    s.set_status(&worker.id, "Scoped worker", scope(&epic))
        .unwrap();
    s.set_status(&h.id, "Scoped human", scope(&epic)).unwrap();
    for (project, exclude, kind, expected) in [
        (false, true, None, vec!["Scoped worker", "Scoped human"]),
        (
            true,
            true,
            None,
            vec!["Project human", "Scoped worker", "Scoped human"],
        ),
        (false, false, Some("agent"), vec!["Self", "Scoped worker"]),
        (
            true,
            true,
            Some("human"),
            vec!["Project human", "Scoped human"],
        ),
    ] {
        let result = s.wait_for_changes(&brain.id, input(json!({"cursor":cursor,"epicKey":epic.key,"includeProject":project,"excludeSelf":exclude,"actorKind":kind,"actions":["agent.status"]}))).unwrap();
        let texts = result
            .events
            .iter()
            .map(|e| e.payload["text"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(texts, expected);
        assert_eq!(result.next_cursor, s.latest_seq().unwrap());
    }
    let all = s
        .wait_for_changes(&brain.id, input(json!({"cursor":cursor})))
        .unwrap();
    assert_eq!(all.events.len(), 5); // Without epicKey, all project scopes are eligible.
}

#[test]
fn hundred_event_batches_never_skip_matches_or_rewind_future_cursors() {
    let (_dir, s, _, brain, worker, _) = setup();
    let cursor = s.latest_seq().unwrap();
    for i in 0..205 {
        s.set_status(&worker.id, &format!("Step {i}"), None)
            .unwrap();
    }
    s.set_status(&brain.id, "Trailing self event", None)
        .unwrap();
    let mut next = cursor;
    let mut events = Vec::new();
    for count in [100, 100, 5] {
        let result = s
            .wait_for_changes(&brain.id, input(json!({"cursor":next})))
            .unwrap();
        assert_eq!(result.events.len(), count);
        assert!(!result.timed_out);
        next = result.next_cursor;
        events.extend(result.events);
    }
    assert!(events.windows(2).all(|w| w[0].seq < w[1].seq));
    assert_eq!(events.last().unwrap().payload["text"], "Step 204");
    assert_eq!(next, s.latest_seq().unwrap());
    let result = s
        .wait_for_changes(
            &brain.id,
            input(json!({"cursor":next+10,"timeoutSeconds":1})),
        )
        .unwrap();
    assert_eq!(result.next_cursor, next + 10);
    assert!(result.timed_out);
}

#[test]
fn invalid_wait_filters_return_validation() {
    let (_dir, s, _, brain, _, _) = setup();
    for args in [
        json!({"cursor":0,"timeoutSeconds":0}),
        json!({"cursor":0,"timeoutSeconds":61}),
        json!({"cursor":-1}),
        json!({"cursor":0,"actions":["report.unknown"]}),
        json!({"cursor":0,"actorKind":"robot"}),
    ] {
        assert!(matches!(
            s.wait_for_changes(&brain.id, input(args)),
            Err(Error::Validation { .. })
        ));
    }
    assert!(serde_json::from_value::<ChangesWaitInput>(json!({})).is_err());
}
