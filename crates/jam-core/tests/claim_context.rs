//! Fencing regressions use caller-captured context, never the test auto-observe wrappers.
mod support;
use jam_core::*;
use serde_json::json;

struct Fixture {
    dir: tempfile::TempDir,
    store: Store,
    human: Member,
    brain: Member,
    worker: Member,
    other: Member,
    epic: Epic,
    story: Story,
    key: String,
}
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("context.db")).unwrap();
    let (_, human) = store
        .create_jam("Context tests", None, None, None, "UTC", "Human")
        .unwrap();
    let brain = store.identify_agent("Brain", "codex").unwrap();
    let worker = store.identify_agent("Worker", "codex").unwrap();
    let other = store.identify_agent("Other", "codex").unwrap();
    let epic = store
        .create_epic(
            &human.id,
            NewEpic {
                title: "Epic".into(),
                goal_md: Some("Goal".into()),
                done_when_md: Some("Done".into()),
                ..Default::default()
            },
        )
        .unwrap();
    store
        .set_brain(&human.id, &epic.key, &brain.handle)
        .unwrap();
    store
        .set_epic_status(&human.id, &epic.key, "active", None)
        .unwrap();
    let story = store
        .create_story(
            &human.id,
            NewStory {
                epic_key: epic.key.clone(),
                title: "Story".into(),
                outcome_md: Some("Outcome".into()),
                acceptance: Some(vec![Acceptance {
                    id: "a".into(),
                    criterion: "Correct".into(),
                    mandatory: true,
                    check: "Tests".into(),
                }]),
                ..Default::default()
            },
        )
        .unwrap();
    store
        .set_story_status(&human.id, &story.key, "active", None)
        .unwrap();
    support::start_story(&store, &human.id, &story.key);
    let key = store
        .create_task(&human.id, task_input(&story))
        .unwrap()
        .task
        .key;
    Fixture {
        dir,
        store,
        human,
        brain,
        worker,
        other,
        epic,
        story,
        key,
    }
}
fn task_input(story: &Story) -> CreateTask {
    CreateTask {
        title: "Task".into(),
        story_key: Some(story.key.clone()),
        status: Some("ready".into()),
        brief: TaskBrief {
            goal_md: "Goal".into(),
            where_md: "src/feature".into(),
            changes: vec![Change {
                title: "Change".into(),
                required: "Correct result".into(),
                ..Default::default()
            }],
            tests: vec![BriefTest {
                setup: "Run check".into(),
                expected: "Pass".into(),
            }],
            result_md: "Report evidence".into(),
            ..Default::default()
        },
        ..Default::default()
    }
}
fn context(s: &Store, key: &str) -> TaskWriteContext {
    let t = s.get_task(key).unwrap().task;
    TaskWriteContext {
        expected_claim_generation: t.claim_generation,
        expected_updated_at: t.updated_at,
    }
}
fn claim(f: &Fixture, actor: &str) -> TaskDetail {
    f.store
        .claim_task(actor, &f.key, Some(&context(&f.store, &f.key)))
        .unwrap()
}
fn report(key: &str, token: &str) -> SubmitReport {
    SubmitReport {
        key: key.into(),
        expected_claim_generation: token.into(),
        summary_md: "Observed evidence".into(),
        ..Default::default()
    }
}
fn review(s: &Store, key: &str, verdict: &str) -> ReviewTask {
    let d = s.get_task(key).unwrap();
    ReviewTask {
        key: key.into(),
        expected_report_id: d
            .reports
            .iter()
            .find(|r| r.round == d.task.review_round)
            .unwrap()
            .id
            .clone(),
        expected_review_context_revision: d.review_context_revision.unwrap(),
        verdict: verdict.into(),
        comments_md: "Inspected this exact report and context".into(),
        failed_tests: None,
    }
}
fn snapshot(s: &Store, key: &str) -> serde_json::Value {
    json!({"detail":s.get_task(key).unwrap(),"seq":s.latest_seq().unwrap()})
}
fn pause(f: &Fixture) {
    let scope = ExecutionScope {
        kind: ExecutionScopeType::Story,
        id: f.story.audit.id.clone(),
    };
    f.store
        .set_execution(
            &f.human.id,
            SetExecution {
                expected_revision: f.store.get_execution(&scope).unwrap().revision,
                scope,
                action: ExecutionAction::Pause,
            },
        )
        .unwrap();
}
fn reset_and_claim(f: &Fixture, holder: &str) {
    let t = f.store.get_task(&f.key).unwrap().task;
    f.store
        .release_current_task(ReleaseClaim {
            key: f.key.clone(),
            expected_updated_at: t.updated_at,
        })
        .unwrap();
    f.store.mark_ready(&f.human.id, &f.key, None, None).unwrap();
    claim(f, holder);
}

#[test]
fn old_generation_fences_every_covered_mutation_after_repeated_or_different_holder() {
    for different_holder in [false, true] {
        for old_actor in ["worker", "brain"] {
            let f = fixture();
            let s = &f.store;
            claim(&f, &f.worker.id);
            let old = context(s, &f.key);
            reset_and_claim(
                &f,
                if different_holder {
                    &f.other.id
                } else {
                    &f.worker.id
                },
            );
            let before = snapshot(s, &f.key);
            let actor = if old_actor == "worker" {
                &f.worker.id
            } else {
                &f.brain.id
            };
            let results = vec![
                s.claim_task(actor, &f.key, Some(&old)).map(|_| ()),
                s.release_task(actor, &f.key, None, Some(&old.expected_claim_generation))
                    .map(|_| ()),
                s.move_task(actor, &f.key, "backlog", None, None, Some(&old))
                    .map(|_| ()),
                s.mark_ready(actor, &f.key, None, Some(&old)).map(|_| ()),
                s.archive_task(actor, &f.key, None, Some(&old)).map(|_| ()),
                s.update_task(
                    actor,
                    UpdateTask {
                        key: f.key.clone(),
                        expected_claim_generation: old.expected_claim_generation.clone(),
                        expected_updated_at: old.expected_updated_at.clone(),
                        description: Some("Old overwrite".into()),
                        ..Default::default()
                    },
                )
                .map(|_| ()),
                s.update_task_brief(
                    actor,
                    &f.key,
                    BriefPatch {
                        goal_md: Some("Old brief".into()),
                        ..Default::default()
                    },
                    Some(&old),
                )
                .map(|_| ()),
                s.submit_report(actor, report(&f.key, &old.expected_claim_generation))
                    .map(|_| ()),
            ];
            for (index, result) in results.into_iter().enumerate() {
                assert!(
                    matches!(result, Err(Error::StaleClaim)),
                    "holder={different_holder} actor={old_actor} operation={index}: {result:?}"
                );
            }
            assert_eq!(
                snapshot(s, &f.key),
                before,
                "No rejected mutation may append activity or alter evidence"
            );
        }
    }
}

#[test]
fn missing_context_has_no_agent_or_brain_bypass_but_human_manual_policy_remains() {
    let f = fixture();
    let s = &f.store;
    for actor in [&f.worker.id, &f.brain.id] {
        let before = snapshot(s, &f.key);
        let results = vec![
            s.claim_task(actor, &f.key, None).map(|_| ()),
            s.release_task(actor, &f.key, None, None).map(|_| ()),
            s.move_task(actor, &f.key, "backlog", None, None, None)
                .map(|_| ()),
            s.mark_ready(actor, &f.key, None, None).map(|_| ()),
            s.archive_task(actor, &f.key, None, None).map(|_| ()),
            s.update_task_brief(actor, &f.key, BriefPatch::default(), None)
                .map(|_| ()),
        ];
        assert!(
            results.iter().all(
                |r| matches!(r,Err(Error::Validation{field,..})if field=="expectedClaimGeneration")
            ),
            "{results:?}"
        );
        assert_eq!(snapshot(s, &f.key), before);
    }
    s.move_task(&f.human.id, &f.key, "done", None, None, None)
        .unwrap();
    assert!(
        s.get_task(&f.key).unwrap().reviews.is_empty(),
        "Manual Done is not reviewed acceptance"
    );
}

#[test]
fn same_generation_does_not_allow_overwriting_a_newer_task_version() {
    let f = fixture();
    let s = &f.store;
    claim(&f, &f.worker.id);
    let old = context(s, &f.key);
    s.update_current_task(TaskEditInput {
        key: f.key.clone(),
        expected_updated_at: old.expected_updated_at.clone(),
        patch: TaskPatch {
            description_md: Some("Human correction".into()),
            ..Default::default()
        },
    })
    .unwrap();
    assert_eq!(
        context(s, &f.key).expected_claim_generation,
        old.expected_claim_generation
    );
    let before = snapshot(s, &f.key);
    let results = vec![
        s.claim_task(&f.worker.id, &f.key, Some(&old)).map(|_| ()),
        s.move_task(&f.brain.id, &f.key, "backlog", None, None, Some(&old))
            .map(|_| ()),
        s.mark_ready(&f.brain.id, &f.key, None, Some(&old))
            .map(|_| ()),
        s.archive_task(&f.worker.id, &f.key, None, Some(&old))
            .map(|_| ()),
        s.update_task(
            &f.worker.id,
            UpdateTask {
                key: f.key.clone(),
                expected_claim_generation: old.expected_claim_generation.clone(),
                expected_updated_at: old.expected_updated_at.clone(),
                description: Some("stale".into()),
                ..Default::default()
            },
        )
        .map(|_| ()),
        s.update_task_brief(&f.worker.id, &f.key, BriefPatch::default(), Some(&old))
            .map(|_| ()),
    ];
    assert!(
        results.iter().all(|r| matches!(r, Err(Error::Conflict))),
        "{results:?}"
    );
    assert_eq!(snapshot(s, &f.key), before);
    // Evidence is append-only for a live claim: a planning edit need not discard it.
    s.submit_report(&f.worker.id, report(&f.key, &old.expected_claim_generation))
        .unwrap();
}

#[test]
fn claim_freshness_is_task_bound_and_cannot_authorize_paused_work() {
    let f = fixture();
    let s = &f.store;
    let other = s.create_task(&f.human.id, task_input(&f.story)).unwrap();
    let wrong = context(s, &other.task.key);
    assert!(matches!(
        s.claim_task(&f.worker.id, &f.key, Some(&wrong)),
        Err(Error::StaleClaim)
    ));
    pause(&f);
    assert!(matches!(
        s.claim_task(&f.worker.id, &f.key, Some(&context(s, &f.key))),
        Err(Error::ExecutionRequired(_))
    ));
}

#[test]
fn pause_archival_visibility_and_append_history_preserve_live_report_generation() {
    for archive in ["task", "story", "epic"] {
        let f = fixture();
        let s = &f.store;
        let claimed = claim(&f, &f.worker.id);
        s.add_comment(&f.worker.id, &f.key, "Progress only")
            .unwrap();
        pause(&f);
        match archive {
            "task" => {
                s.archive_task(&f.human.id, &f.key, None, None).unwrap();
                s.unarchive_task(&f.human.id, &f.key).unwrap();
                s.archive_task(&f.human.id, &f.key, None, None).unwrap();
            }
            "story" => {
                s.set_story_status(&f.human.id, &f.story.key, "archived", None)
                    .unwrap();
            }
            _ => {
                s.set_epic_status(&f.human.id, &f.epic.key, "archived", None)
                    .unwrap();
            }
        }
        assert_eq!(
            s.get_task(&f.key).unwrap().task.claim_generation,
            claimed.task.claim_generation
        );
        s.submit_report(&f.worker.id, report(&f.key, &claimed.task.claim_generation))
            .unwrap();
        assert_ne!(
            s.get_task(&f.key).unwrap().task.claim_generation,
            claimed.task.claim_generation
        );
    }
}

#[test]
fn archived_holder_can_release_with_live_generation_without_starting_work() {
    let f = fixture();
    let s = &f.store;
    let claimed = claim(&f, &f.worker.id);
    pause(&f);
    s.set_epic_status(&f.human.id, &f.epic.key, "archived", None)
        .unwrap();
    let returned = s
        .release_task(
            &f.worker.id,
            &f.key,
            None,
            Some(&claimed.task.claim_generation),
        )
        .unwrap();
    assert_eq!(returned.status, "backlog");
    assert!(returned.assignee_id.is_none());
    assert_ne!(returned.claim_generation, claimed.task.claim_generation);
}

#[test]
fn stale_review_never_accepts_a_later_report_even_for_the_same_task_and_worker() {
    let f = fixture();
    let s = &f.store;
    let first = claim(&f, &f.worker.id);
    s.submit_report(&f.worker.id, report(&f.key, &first.task.claim_generation))
        .unwrap();
    let old = review(s, &f.key, "accept");
    s.review_task(&f.human.id, review(s, &f.key, "changes_requested"))
        .unwrap();
    let second = claim(&f, &f.worker.id);
    s.submit_report(&f.worker.id, report(&f.key, &second.task.claim_generation))
        .unwrap();
    let before = snapshot(s, &f.key);
    assert!(matches!(
        s.review_task(&f.brain.id, old),
        Err(Error::Conflict)
    ));
    assert_eq!(snapshot(s, &f.key), before);
    s.review_task(&f.brain.id, review(s, &f.key, "accept"))
        .unwrap();
    assert_eq!(s.get_task(&f.key).unwrap().task.status, "done");
}

#[test]
fn review_context_fences_task_story_epic_changes_and_exact_report_id_for_human_and_brain() {
    for scope in ["task", "story", "epic", "report_id"] {
        for human in [false, true] {
            let f = fixture();
            let s = &f.store;
            let claimed = claim(&f, &f.worker.id);
            s.submit_report(&f.worker.id, report(&f.key, &claimed.task.claim_generation))
                .unwrap();
            let mut old = review(s, &f.key, "accept");
            match scope {
                "task" => {
                    s.update_current_task(TaskEditInput {
                        key: f.key.clone(),
                        expected_updated_at: s.get_task(&f.key).unwrap().task.updated_at,
                        patch: TaskPatch {
                            description_md: Some("Revised acceptance context".into()),
                            ..Default::default()
                        },
                    })
                    .unwrap();
                }
                "story" => {
                    s.update_story(
                        &f.human.id,
                        &f.story.key,
                        StoryPatch {
                            outcome_md: Some("New outcome".into()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                }
                "epic" => {
                    s.update_epic(
                        &f.human.id,
                        &f.epic.key,
                        EpicPatch {
                            goal_md: Some("New goal".into()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                }
                _ => old.expected_report_id = "different-report".into(),
            }
            let before = snapshot(s, &f.key);
            assert!(
                matches!(
                    s.review_task(if human { &f.human.id } else { &f.brain.id }, old),
                    Err(Error::Conflict)
                ),
                "{scope} human={human}"
            );
            assert_eq!(snapshot(s, &f.key), before);
        }
    }
}

#[test]
fn generation_changes_on_lifecycle_but_not_same_holder_assignment_or_notes() {
    let f = fixture();
    let s = &f.store;
    let ready = context(s, &f.key);
    let claimed = claim(&f, &f.worker.id).task;
    assert_ne!(claimed.claim_generation, ready.expected_claim_generation);
    let same = s
        .assign_task(&f.human.id, &f.key, Some(&f.worker.id))
        .unwrap();
    assert_eq!(same.claim_generation, claimed.claim_generation);
    s.update_current_task(TaskEditInput {
        key: f.key.clone(),
        expected_updated_at: same.updated_at,
        patch: TaskPatch {
            description_md: Some("Notes".into()),
            ..Default::default()
        },
    })
    .unwrap();
    assert_eq!(
        context(s, &f.key).expected_claim_generation,
        claimed.claim_generation
    );
    let reassigned = s
        .assign_task(&f.human.id, &f.key, Some(&f.other.id))
        .unwrap();
    assert_ne!(reassigned.claim_generation, claimed.claim_generation);
    s.move_task(&f.human.id, &f.key, "ready", None, None, None)
        .unwrap();
    assert_ne!(
        context(s, &f.key).expected_claim_generation,
        reassigned.claim_generation
    );
}

#[test]
fn legacy_live_claim_migrates_and_restarts_without_grant_or_lost_evidence() {
    let f = fixture();
    claim(&f, &f.worker.id);
    pause(&f);
    let path = f.dir.path().join("context.db");
    let before = f.store.get_task(&f.key).unwrap();
    drop(f.store);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE ref_frame_links; ALTER TABLE ref_items DROP COLUMN verdict; ALTER TABLE ref_items DROP COLUMN archived_by; DROP TRIGGER tasks_advance_claim_generation;ALTER TABLE tasks DROP COLUMN claim_generation;PRAGMA user_version=6;").unwrap();
    drop(db);
    for _ in 0..2 {
        let s = Store::open(&path).unwrap();
        let d = s.get_task(&f.key).unwrap();
        assert_eq!(d.task.status, before.task.status);
        assert_eq!(d.task.assignee_id, before.task.assignee_id);
        assert_eq!(d.task.review_round, before.task.review_round);
        assert!(!d.task.claim_generation.is_empty());
        assert_eq!(
            s.get_execution(&ExecutionScope {
                kind: ExecutionScopeType::Story,
                id: f.story.audit.id.clone()
            })
            .unwrap()
            .effective_state,
            ExecutionEffectiveState::Paused
        );
    }
    let s = Store::open(path).unwrap();
    let d = s.get_task(&f.key).unwrap();
    s.submit_report(&f.worker.id, report(&f.key, &d.task.claim_generation))
        .unwrap();
}

#[test]
fn generation_overflow_rolls_back_the_entire_mutation_and_activity() {
    let f = fixture();
    let s = &f.store;
    let db = rusqlite::Connection::open(f.dir.path().join("context.db")).unwrap();
    db.execute(
        "UPDATE tasks SET claim_generation=9223372036854775807 WHERE key=?",
        [&f.key],
    )
    .unwrap();
    let before = snapshot(s, &f.key);
    assert!(matches!(
        s.claim_task(&f.worker.id, &f.key, Some(&context(s, &f.key))),
        Err(Error::Storage(_))
    ));
    assert_eq!(snapshot(s, &f.key), before);
}

#[test]
fn future_imported_planning_versions_still_advance_for_review_context() {
    let f = fixture();
    let s = &f.store;
    let db = rusqlite::Connection::open(f.dir.path().join("context.db")).unwrap();
    db.execute(
        "UPDATE stories SET updated_at='2099-01-01T00:00:00Z' WHERE id=?",
        [&f.story.audit.id],
    )
    .unwrap();
    db.execute(
        "UPDATE epics SET updated_at='2099-01-01T00:00:00Z' WHERE id=?",
        [&f.epic.audit.id],
    )
    .unwrap();
    let e = s
        .update_epic(
            &f.human.id,
            &f.epic.key,
            EpicPatch {
                goal_md: Some("Changed".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let t = s
        .update_story(
            &f.human.id,
            &f.story.key,
            StoryPatch {
                outcome_md: Some("Changed".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(e.audit.updated_at, "2099-01-01T00:00:00.000000001Z");
    assert_eq!(t.audit.updated_at, e.audit.updated_at);
}

#[test]
fn imports_discard_generation_and_keep_legacy_snapshots_readable_without_grants() {
    for omit_field in [false, true] {
        let f = fixture();
        let s = &f.store;
        let claimed = claim(&f, &f.worker.id);
        let mut exported = serde_json::to_value(s.export_jam().unwrap()).unwrap();
        if omit_field {
            exported["tasks"][0]
                .as_object_mut()
                .unwrap()
                .remove("claimGeneration");
        } else {
            exported["tasks"][0]["claimGeneration"] = json!("untrusted imported validator");
        }
        let imported = s
            .import_jam_json(&f.human.id, &exported.to_string())
            .unwrap();
        let pinned = s.for_project(&imported.jam.unwrap().id).unwrap();
        let tasks = pinned.list_tasks(None, TaskFilter::default()).unwrap();
        let t = &tasks.tasks[0];
        assert_ne!(t.id, claimed.task.id);
        assert_ne!(t.claim_generation, claimed.task.claim_generation);
        assert_eq!(t.status, "in_progress");
        assert_eq!(t.assignee_id, claimed.task.assignee_id);
        assert!(
            t.claim_generation.ends_with(":0"),
            "Importer must reset generation, not trust exported metadata"
        );
        let state = pinned
            .get_execution(&ExecutionScope {
                kind: ExecutionScopeType::Story,
                id: t.story_id.clone(),
            })
            .unwrap();
        assert_eq!(state.effective_state, ExecutionEffectiveState::Paused);
        assert!(matches!(
            pinned.submit_report(&f.worker.id, report(&t.key, &claimed.task.claim_generation)),
            Err(Error::StaleClaim)
        ));
        pinned
            .submit_report(&f.worker.id, report(&t.key, &t.claim_generation))
            .unwrap();
    }
}

#[test]
fn independent_store_claim_race_accepts_exactly_one_captured_request() {
    use std::sync::{Arc, Barrier};
    for _ in 0..12 {
        let f = fixture();
        let expected = context(&f.store, &f.key);
        let barrier = Arc::new(Barrier::new(2));
        let joins = (0..2)
            .map(|_| {
                let s = Store::open(f.dir.path().join("context.db")).unwrap();
                let expected = expected.clone();
                let actor = f.worker.id.clone();
                let key = f.key.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    s.claim_task(&actor, &key, Some(&expected))
                })
            })
            .collect::<Vec<_>>();
        let results = joins
            .into_iter()
            .map(|j| j.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|r| matches!(r, Err(Error::StaleClaim)))
                .count(),
            1
        );
        let detail = f.store.get_task(&f.key).unwrap();
        assert_eq!(
            detail
                .history
                .iter()
                .filter(|e| e.action == "task.claimed")
                .count(),
            1
        );
    }
}

#[test]
fn report_and_release_race_never_loses_evidence_or_clears_a_successor_round() {
    use std::sync::{Arc, Barrier};
    for _ in 0..16 {
        let f = fixture();
        let claimed = claim(&f, &f.worker.id);
        pause(&f);
        let barrier = Arc::new(Barrier::new(2));
        let s = Store::open(f.dir.path().join("context.db")).unwrap();
        let b = barrier.clone();
        let key = f.key.clone();
        let actor = f.worker.id.clone();
        let generation = claimed.task.claim_generation.clone();
        let reporting = std::thread::spawn(move || {
            b.wait();
            s.submit_report(&actor, report(&key, &generation))
        });
        let s = Store::open(f.dir.path().join("context.db")).unwrap();
        let b = barrier;
        let key = f.key.clone();
        let actor = f.worker.id.clone();
        let generation = claimed.task.claim_generation;
        let releasing = std::thread::spawn(move || {
            b.wait();
            s.release_task(&actor, &key, None, Some(&generation))
        });
        let d = f.store.get_task(&f.key); // independent reads may race; final assertions use post-join data.
        assert!(d.is_ok());
        match (reporting.join().unwrap(), releasing.join().unwrap()) {
            (Ok(_), Err(Error::StaleClaim)) => {
                let d = f.store.get_task(&f.key).unwrap();
                assert_eq!(d.task.status, "review");
                assert_eq!(d.reports.len(), 1);
            }
            (Err(Error::StaleClaim), Ok(_)) => {
                let d = f.store.get_task(&f.key).unwrap();
                assert_eq!(d.task.status, "backlog");
                assert!(d.reports.is_empty());
                assert!(d.task.assignee_id.is_none());
            }
            result => panic!("Unsafe serialization: {result:?}"),
        }
    }
}

#[test]
fn planning_edit_and_review_race_records_only_the_context_actually_observed() {
    use std::sync::{Arc, Barrier};
    for _ in 0..12 {
        let f = fixture();
        let claimed = claim(&f, &f.worker.id);
        f.store
            .submit_report(&f.worker.id, report(&f.key, &claimed.task.claim_generation))
            .unwrap();
        let decision = review(&f.store, &f.key, "accept");
        let barrier = Arc::new(Barrier::new(2));
        let s = Store::open(f.dir.path().join("context.db")).unwrap();
        let actor = f.brain.id.clone();
        let b = barrier.clone();
        let reviewing = std::thread::spawn(move || {
            b.wait();
            s.review_task(&actor, decision)
        });
        let s = Store::open(f.dir.path().join("context.db")).unwrap();
        let actor = f.human.id.clone();
        let key = f.story.key.clone();
        let editing = std::thread::spawn(move || {
            barrier.wait();
            s.update_story(
                &actor,
                &key,
                StoryPatch {
                    outcome_md: Some("Revised outcome".into()),
                    ..Default::default()
                },
            )
        });
        let result = reviewing.join().unwrap();
        editing.join().unwrap().unwrap();
        let d = f.store.get_task(&f.key).unwrap();
        match result {
            Ok(_) => {
                assert_eq!(d.reviews.len(), 1);
                assert_eq!(d.task.status, "done");
            }
            Err(Error::Conflict) => {
                assert!(d.reviews.is_empty());
                assert_eq!(d.task.status, "review");
            }
            other => panic!("Unexpected review serialization {other:?}"),
        }
    }
}

#[test]
fn native_move_and_ready_reject_old_intents_after_same_or_different_holder_reclaims() {
    for different_holder in [false, true] {
        let f = fixture();
        let s = &f.store;
        let observed = s.get_task(&f.key).unwrap().task;
        claim(&f, &f.worker.id);
        reset_and_claim(
            &f,
            if different_holder {
                &f.other.id
            } else {
                &f.worker.id
            },
        );
        pause(&f);
        let before = snapshot(s, &f.key);
        let board = serde_json::to_value(s.list_board_tasks().unwrap()).unwrap();
        for target in ["backlog", "ready", "in_progress", "done"] {
            assert!(
                matches!(
                    s.move_current_task(
                        &f.key,
                        target,
                        &observed.updated_at,
                        None,
                        None,
                        Some("Older drag or Ready exception")
                    ),
                    Err(Error::Conflict)
                ),
                "{target}, different holder={different_holder}"
            );
        }
        assert!(matches!(
            s.mark_current_task_ready(ReadyInput {
                key: f.key.clone(),
                expected_updated_at: observed.updated_at,
                override_reason: Some("Older Ready decision".into())
            }),
            Err(Error::Conflict)
        ));
        assert_eq!(snapshot(s, &f.key), before);
        assert_eq!(
            serde_json::to_value(s.list_board_tasks().unwrap()).unwrap(),
            board
        );
    }
}

#[test]
fn old_incomplete_readiness_modal_cannot_replace_later_complete_claimed_work() {
    let f = fixture();
    let s = &f.store;
    let ready = s.get_task(&f.key).unwrap().task;
    s.move_current_task(&f.key, "backlog", &ready.updated_at, None, None, None)
        .unwrap();
    s.update_task_brief(
        &f.human.id,
        &f.key,
        BriefPatch {
            goal_md: Some(String::new()),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let opened = s.get_task(&f.key).unwrap().task;
    assert!(!s.check_ready(&f.key).unwrap().ready);
    s.update_task_brief(
        &f.human.id,
        &f.key,
        BriefPatch {
            goal_md: Some("Human clarified this after the modal opened".into()),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    s.mark_current_task_ready(ReadyInput {
        key: f.key.clone(),
        expected_updated_at: s.get_task(&f.key).unwrap().task.updated_at,
        override_reason: None,
    })
    .unwrap();
    claim(&f, &f.worker.id);
    pause(&f);
    let before = snapshot(s, &f.key);
    assert!(matches!(
        s.move_current_task(
            &f.key,
            "ready",
            &opened.updated_at,
            None,
            None,
            Some("Old modal override reason")
        ),
        Err(Error::Conflict)
    ));
    assert_eq!(snapshot(s, &f.key), before);
    assert_eq!(s.get_task(&f.key).unwrap().task.status, "in_progress");
}

#[test]
fn native_stale_version_precedes_round_allocation_and_neighbor_reordering() {
    let f = fixture();
    let s = &f.store;
    let claimed = claim(&f, &f.worker.id);
    s.submit_report(&f.worker.id, report(&f.key, &claimed.task.claim_generation))
        .unwrap();
    let observed = s.get_task(&f.key).unwrap().task;
    let a = s
        .create_task(&f.human.id, task_input(&f.story))
        .unwrap()
        .task;
    let b = s
        .create_task(&f.human.id, task_input(&f.story))
        .unwrap()
        .task;
    let db = rusqlite::Connection::open(&s.path).unwrap();
    db.execute("UPDATE tasks SET position=1024 WHERE id=?", [&a.id])
        .unwrap();
    db.execute("UPDATE tasks SET position=1024.0000001 WHERE id=?", [&b.id])
        .unwrap();
    s.add_comment(
        &f.human.id,
        &f.key,
        "The review context changed after pickup",
    )
    .unwrap();
    let before = snapshot(s, &f.key);
    let board = serde_json::to_value(s.list_board_tasks().unwrap()).unwrap();
    assert!(matches!(
        s.move_current_task(
            &f.key,
            "ready",
            &observed.updated_at,
            Some(&b.key),
            Some(&a.key),
            Some("Old override")
        ),
        Err(Error::Conflict)
    ));
    assert_eq!(snapshot(s, &f.key), before);
    assert_eq!(
        serde_json::to_value(s.list_board_tasks().unwrap()).unwrap(),
        board
    );
    assert_eq!(
        s.get_task(&f.key).unwrap().task.review_round,
        observed.review_round
    );
}

#[test]
fn fresh_native_intents_keep_human_policy_but_not_execution_or_identity_bypasses() {
    let f = fixture();
    let s = &f.store;
    pause(&f);
    let t = s.get_task(&f.key).unwrap().task;
    let before = snapshot(s, &f.key);
    assert!(matches!(
        s.move_current_task(&f.key, "in_progress", &t.updated_at, None, None, None),
        Err(Error::ExecutionRequired(_))
    ));
    assert!(
        matches!(s.move_current_task(&f.key,"backlog","",None,None,None),Err(Error::Validation{field,..})if field=="expectedUpdatedAt")
    );
    assert!(
        matches!(s.mark_current_task_ready(ReadyInput{key:f.key.clone(),expected_updated_at:String::new(),override_reason:None}),Err(Error::Validation{field,..})if field=="expectedUpdatedAt")
    );
    assert_eq!(snapshot(s, &f.key), before);
    // Fresh manual Done is explicitly human policy, not a reviewed acceptance.
    let done = s
        .move_current_task(&f.key, "done", &t.updated_at, None, None, None)
        .unwrap();
    assert_eq!(done.status, "done");
    assert!(s.get_task(&f.key).unwrap().reviews.is_empty());
    let project = s.active_jam().unwrap();
    let captured = s.for_project(&project.id).unwrap();
    captured
        .set_setting(
            &format!("project.{}.current_member_id", project.id),
            &f.worker.id,
        )
        .unwrap();
    let before = snapshot(&captured, &f.key);
    assert!(
        captured
            .move_current_task(&f.key, "backlog", &done.updated_at, None, None, None)
            .is_err()
    );
    assert!(
        captured
            .mark_current_task_ready(ReadyInput {
                key: f.key.clone(),
                expected_updated_at: done.updated_at,
                override_reason: None
            })
            .is_err()
    );
    assert_eq!(snapshot(&captured, &f.key), before);
}

#[test]
fn versioned_native_intent_and_human_identity_stay_pinned_across_project_switch() {
    let f = fixture();
    let s = &f.store;
    let captured = s.selected_snapshot().unwrap();
    let observed = captured.get_task(&f.key).unwrap().task;
    s.create_jam("Second project", None, None, None, "UTC", "Second human")
        .unwrap();
    let second = s
        .create_current_task(CreateTask {
            title: "Unrelated task".into(),
            ..Default::default()
        })
        .unwrap();
    let before = serde_json::to_value(s.get_task(&second.task.key).unwrap()).unwrap();
    let moved = captured
        .move_current_task(&f.key, "backlog", &observed.updated_at, None, None, None)
        .unwrap();
    assert_eq!(moved.jam_id, observed.jam_id);
    assert_eq!(moved.updated_by, f.human.id);
    assert_eq!(
        serde_json::to_value(s.get_task(&second.task.key).unwrap()).unwrap(),
        before
    );
    assert!(matches!(
        captured.move_current_task(
            &second.task.key,
            "ready",
            &second.task.updated_at,
            None,
            None,
            None
        ),
        Err(Error::Forbidden(_))
    ));
}

#[test]
fn native_ready_or_drag_and_worker_claim_races_have_only_serializable_outcomes() {
    use std::sync::{Arc, Barrier};
    for ready in [false, true] {
        for _ in 0..12 {
            let f = fixture();
            let observed = f.store.get_task(&f.key).unwrap().task;
            let worker_context = context(&f.store, &f.key);
            let barrier = Arc::new(Barrier::new(2));
            let s = Store::open(&f.store.path)
                .unwrap()
                .selected_snapshot()
                .unwrap();
            let key = f.key.clone();
            let b = barrier.clone();
            let human = std::thread::spawn(move || {
                b.wait();
                if ready {
                    s.mark_current_task_ready(ReadyInput {
                        key,
                        expected_updated_at: observed.updated_at,
                        override_reason: None,
                    })
                } else {
                    s.move_current_task(&key, "backlog", &observed.updated_at, None, None, None)
                }
            });
            let s = Store::open(&f.store.path)
                .unwrap()
                .selected_snapshot()
                .unwrap();
            let key = f.key.clone();
            let actor = f.worker.id.clone();
            let worker = std::thread::spawn(move || {
                barrier.wait();
                s.claim_task(&actor, &key, Some(&worker_context))
            });
            match (human.join().unwrap(), worker.join().unwrap()) {
                (Ok(_), Err(Error::StaleClaim | Error::Conflict)) => {
                    let t = f.store.get_task(&f.key).unwrap().task;
                    assert_eq!(t.status, if ready { "ready" } else { "backlog" });
                    assert!(t.assignee_id.is_none());
                }
                (Err(Error::Conflict), Ok(_)) => {
                    let t = f.store.get_task(&f.key).unwrap().task;
                    assert_eq!(t.status, "in_progress");
                    assert_eq!(t.assignee_id.as_deref(), Some(f.worker.id.as_str()));
                }
                result => panic!("Stale human intent raced accepted work: {result:?}"),
            }
        }
    }
}
