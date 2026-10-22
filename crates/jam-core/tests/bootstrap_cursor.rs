//! Fictional cold bootstrap and inclusive recovery contracts; no execution grants.
use jam_core::*;
use serde_json::json;

fn wait(s: &Store, actor: &str, cursor: i64) -> ChangesWait {
    s.wait_for_changes(
        actor,
        serde_json::from_value(json!({
            "cursor": cursor, "excludeSelf": false, "includeProject": true, "timeoutSeconds": 1
        }))
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn empty_scoped_cursor_interleaving_and_saved_foreign_high_water() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path().join("fictional.db")).unwrap();
    let (a, ha) = s
        .create_jam("Fictional A", None, None, None, "UTC", "Human A")
        .unwrap();
    // create_jam emits a creation event; model a valid restored/imported empty
    // history only in this disposable fictional database.
    rusqlite::Connection::open(&s.path)
        .unwrap()
        .execute("DELETE FROM activity WHERE jam_id=?", [&a.id])
        .unwrap();
    let pa = s.for_project(&a.id).unwrap();
    assert_eq!(pa.project_activity_context().unwrap().1, 0);
    let (b, hb) = s
        .create_jam("Fictional B", None, None, None, "UTC", "Human B")
        .unwrap();
    let pb = s.for_project(&b.id).unwrap();
    pb.set_status(&hb.id, "Foreign first", None).unwrap();
    assert_eq!(pa.project_activity_context().unwrap().1, 0);
    pa.set_status(&ha.id, "First A", None).unwrap();
    let a_cursor = pa.project_activity_context().unwrap().1;
    pb.set_status(&hb.id, "Foreign latest", None).unwrap();
    for selection in [&a.id, &b.id, &a.id, &b.id] {
        s.select_project(selection).unwrap();
        let (identity, cursor) = pa.project_activity_context().unwrap();
        assert_eq!(identity.id, a.id);
        assert_eq!(cursor, a_cursor);
        assert!(cursor < s.latest_seq().unwrap());
    }
    let page = wait(&pa, &ha.id, 0);
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].seq, a_cursor);
    let saved = page.next_cursor;
    assert!(saved > pa.project_activity_context().unwrap().1);
    let empty = wait(&pa, &ha.id, saved);
    assert!(empty.timed_out);
    assert_eq!(empty.next_cursor, saved); // Do not replace a valid saved cursor with project max.
    pa.set_status(&ha.id, "After checkpoint", None).unwrap();
    assert_eq!(wait(&pa, &ha.id, saved).events.len(), 1);
}

#[test]
fn capture_before_baseline_then_inclusive_bounded_replay_misses_no_sequence() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path().join("fictional.db")).unwrap();
    let (a, h) = s
        .create_jam("Fictional baseline", None, None, None, "UTC", "Human")
        .unwrap();
    let s = s.for_project(&a.id).unwrap();
    s.set_status(&h.id, "Existing backlog", None).unwrap();
    let saved_unprocessed = 0;
    let captured = s.project_activity_context().unwrap().1;
    s.set_status(&h.id, "After capture before baseline", None)
        .unwrap();
    let _first_read = s.get_project().unwrap();
    s.set_status(&h.id, "Between baseline reads", None).unwrap();
    let baseline = s.list_members().unwrap();
    assert!(baseline.iter().any(|m| m.member.id == h.id));
    s.set_status(&h.id, "After baseline", None).unwrap();
    for n in 0..205 {
        s.set_status(&h.id, &format!("Fictional replay {n}"), None)
            .unwrap();
    }
    let count = s.activity_count().unwrap();
    let expected = s.list_changes_since(captured, None).unwrap();
    let mut checkpoint = captured;
    let mut observed = Vec::new();
    loop {
        let page = wait(&s, &h.id, checkpoint);
        assert!(page.events.len() <= 100);
        observed.extend(page.events.iter().map(|e| e.seq)); // Handle before checkpoint.
        checkpoint = page.next_cursor;
        if page.timed_out {
            break;
        }
    }
    assert_eq!(observed, expected.iter().map(|e| e.seq).collect::<Vec<_>>());
    assert_eq!(observed.len(), 208);
    assert_eq!(s.activity_count().unwrap(), count); // Reads/waits emit no activity/grants.
    let recovery = wait(&s, &h.id, saved_unprocessed);
    assert!(recovery.events.iter().any(|e| e.seq == captured)); // Existing recovery retains older backlog.
    assert!(!observed.contains(&captured)); // Fresh baseline is not historical audit.
}
