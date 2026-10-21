use jam_core::*;
use serde_json::{Value, json};

fn setup() -> (tempfile::TempDir, Store, Member, Member, Member, Story) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.dev-data/release-prep-20261021/core-scenarios");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let s = Store::open(dir.path().join("jam.db")).unwrap();
    let (_, h) = s
        .create_jam("Repairs", None, None, None, "UTC", "Human")
        .unwrap();
    let brain = s.identify_agent("Brain", "other").unwrap();
    let worker = s.identify_agent("Worker", "other").unwrap();
    let e = s
        .create_epic(
            &h.id,
            NewEpic {
                title: "Epic".into(),
                ..Default::default()
            },
        )
        .unwrap();
    s.set_brain(&h.id, &e.key, &brain.handle).unwrap();
    let story = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: e.key,
                title: "Story".into(),
                ..Default::default()
            },
        )
        .unwrap();
    (dir, s, h, brain, worker, story)
}
fn task(s: &Store, h: &Member, story: &Story) -> String {
    s.create_task(
        &h.id,
        CreateTask {
            title: "Incomplete backlog".into(),
            story_key: Some(story.key.clone()),
            ..Default::default()
        },
    )
    .unwrap()
    .task
    .key
}
fn report(key: &str) -> SubmitReport {
    SubmitReport {
        key: key.into(),
        summary_md: "Revised work".into(),
        ..Default::default()
    }
}
fn snapshot(s: &Store, key: &str) -> Value {
    json!({"task":s.get_task(key).unwrap(), "seq":s.latest_seq().unwrap()})
}
fn update(s: &Store, actor: &str, key: &str, patch: TaskPatch) -> Result<TaskDetail> {
    let previous = s.current_member()?.id;
    s.set_setting("current_member_id", actor)?;
    let result = s.update_current_task(TaskEditInput {
        key: key.into(),
        expected_updated_at: s.get_task(key)?.task.updated_at,
        patch,
    });
    s.set_setting("current_member_id", &previous)?;
    result
}
#[test]
fn direct_return_to_work_preserves_evidence_and_can_report_again() {
    for patch in [false, true] {
        let (_d, s, h, brain, worker, story) = setup();
        let key = task(&s, &h, &story);
        s.mark_ready(&h.id, &key, Some("Explicit investigation exception"))
            .unwrap();
        s.claim_task(&worker.id, &key).unwrap();
        let first = s.submit_report(&worker.id, report(&key)).unwrap();
        s.move_task(&h.id, &key, "review", None, None).unwrap();
        assert_eq!(s.get_task(&key).unwrap().task.review_round, 0);
        let before = snapshot(&s, &key);
        assert!(
            s.move_task(&h.id, &key, "in_progress", Some("JB-404"), None)
                .is_err()
        );
        assert_eq!(
            snapshot(&s, &key),
            before,
            "failed move rolls back round and history"
        );
        if patch {
            update(
                &s,
                &h.id,
                &key,
                TaskPatch {
                    status: Some("in_progress".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        } else {
            s.move_task(&h.id, &key, "in_progress", None, None).unwrap();
        }
        // A no-op/repeated move must not allocate a second successor.
        s.move_task(&h.id, &key, "in_progress", None, None).unwrap();
        let second = s.submit_report(&worker.id, report(&key)).unwrap();
        assert_eq!(second.round, 1);
        let detail = s.get_task(&key).unwrap();
        assert_eq!(
            serde_json::to_value(&detail.reports[0]).unwrap(),
            serde_json::to_value(first).unwrap()
        );
        s.review_task(
            &brain.id,
            ReviewTask {
                key: key.clone(),
                verdict: "changes_requested".into(),
                ..Default::default()
            },
        )
        .unwrap();
        s.claim_task(&worker.id, &key).unwrap();
        assert_eq!(s.submit_report(&worker.id, report(&key)).unwrap().round, 2);
        s.review_task(
            &brain.id,
            ReviewTask {
                key: key.clone(),
                verdict: "accept".into(),
                ..Default::default()
            },
        )
        .unwrap();
        s.move_task(&h.id, &key, "in_progress", None, None).unwrap();
        assert_eq!(s.submit_report(&worker.id, report(&key)).unwrap().round, 3);
        assert_eq!(s.get_task(&key).unwrap().reviews.len(), 2);
    }
}
#[test]
fn workers_cannot_bypass_claim_through_public_status_operations() {
    for assigned in [false, true] {
        for operation in ["move", "release"] {
            let (_d, s, h, _brain, worker, story) = setup();
            let key = task(&s, &h, &story);
            if assigned {
                update(
                    &s,
                    &h.id,
                    &key,
                    TaskPatch {
                        assignee_id: Some(Some(worker.id.clone())),
                        ..Default::default()
                    },
                )
                .unwrap();
            }
            assert!(s.claim_task(&worker.id, &key).is_err());
            let before = snapshot(&s, &key);
            let result = match operation {
                "move" => s
                    .move_task(&worker.id, &key, "in_progress", None, None)
                    .map(|_| ()),
                _ => s
                    .release_task(&worker.id, &key, Some("in_progress"))
                    .map(|_| ()),
            };
            assert!(
                result.is_err(),
                "{operation}, assigned={assigned} bypassed claim"
            );
            assert_eq!(snapshot(&s, &key), before);
            assert!(s.submit_report(&worker.id, report(&key)).is_err());
            assert_eq!(snapshot(&s, &key), before);
        }
    }
}
#[test]
fn worker_creation_ownership_and_privileged_planning_are_consistent() {
    let (_d, s, h, brain, worker, story) = setup();
    for status in ["in_progress", "review", "done"] {
        let seq = s.latest_seq().unwrap();
        assert!(
            s.create_task(
                &worker.id,
                CreateTask {
                    title: "Bypass".into(),
                    story_key: Some(story.key.clone()),
                    status: Some(status.into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert_eq!(s.latest_seq().unwrap(), seq);
    }
    let key = task(&s, &h, &story);
    s.move_task(&h.id, &key, "in_progress", None, None).unwrap();
    s.move_task(&brain.id, &key, "backlog", None, None).unwrap();
    assert!(
        s.mark_ready(&worker.id, &key, Some("Worker override"))
            .is_err()
    );
    s.mark_ready(&brain.id, &key, Some("Appointed brain investigation"))
        .unwrap();
    let before = snapshot(&s, &key);
    assert!(
        s.move_task(&worker.id, &key, "in_progress", None, None)
            .is_err(),
        "Ready still needs claim"
    );
    assert_eq!(snapshot(&s, &key), before);
    s.claim_task(&worker.id, &key).unwrap();
    let other = s.identify_agent("Other", "other").unwrap();
    let before = snapshot(&s, &key);
    assert!(s.move_task(&other.id, &key, "review", None, None).is_err());
    // MCP update_task cannot change either status or ownership; its schema rejects both.
    for field in [
        json!({"key":key,"status":"in_progress"}),
        json!({"key":key,"assigneeId":other.id}),
    ] {
        assert!(serde_json::from_value::<UpdateTask>(field).is_err());
    }
    assert!(s.submit_report(&other.id, report(&key)).is_err());
    assert_eq!(snapshot(&s, &key), before);
    s.move_task(&worker.id, &key, "in_progress", None, None)
        .unwrap();
    s.submit_report(&worker.id, report(&key)).unwrap();
    s.review_task(
        &brain.id,
        ReviewTask {
            key,
            verdict: "accept".into(),
            ..Default::default()
        },
    )
    .unwrap();
}
