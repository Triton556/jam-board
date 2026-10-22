use jam_core::*;

struct Fixture {
    _dir: tempfile::TempDir,
    store: Store,
    human: Member,
    brain: Member,
    worker: Member,
    epic: Epic,
    story: Story,
}
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("execution.db")).unwrap();
    let (_, human) = store
        .create_jam("Execution fixture", None, None, None, "UTC", "Human")
        .unwrap();
    let brain = store.identify_agent("Brain", "codex").unwrap();
    let worker = store.identify_agent("Worker", "codex").unwrap();
    let epic = store
        .create_epic(
            &human.id,
            NewEpic {
                title: "Epic".into(),
                goal_md: Some("Goal".into()),
                done_when_md: Some("Verified result".into()),
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
    let story = add_story(&store, &human, &epic, "Story");
    Fixture {
        _dir: dir,
        store,
        human,
        brain,
        worker,
        epic,
        story,
    }
}
fn add_story(s: &Store, h: &Member, e: &Epic, title: &str) -> Story {
    let story = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: e.key.clone(),
                title: title.into(),
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
    s.set_story_status(&h.id, &story.key, "active", None)
        .unwrap()
}
fn epic(e: &Epic) -> ExecutionScope {
    ExecutionScope {
        kind: ExecutionScopeType::Epic,
        id: e.audit.id.clone(),
    }
}
fn story(s: &Story) -> ExecutionScope {
    ExecutionScope {
        kind: ExecutionScopeType::Story,
        id: s.audit.id.clone(),
    }
}
fn change(s: &Store, h: &Member, scope: ExecutionScope, action: ExecutionAction) -> ExecutionState {
    let expected_revision = s.get_execution(&scope).unwrap().revision;
    s.set_execution(
        &h.id,
        SetExecution {
            scope,
            action,
            expected_revision,
        },
    )
    .unwrap()
}
fn input(story: &Story) -> CreateTask {
    CreateTask {
        story_key: Some(story.key.clone()),
        title: "Task".into(),
        status: Some("ready".into()),
        brief: TaskBrief {
            goal_md: "Goal".into(),
            where_md: "src/feature".into(),
            result_md: "Report evidence".into(),
            changes: vec![Change {
                title: "Change".into(),
                required: "Required".into(),
                ..Default::default()
            }],
            tests: vec![BriefTest {
                setup: "Run checks".into(),
                expected: "Pass".into(),
            }],
            ..Default::default()
        },
        ..Default::default()
    }
}
fn report(key: &str) -> SubmitReport {
    SubmitReport {
        key: key.into(),
        summary_md: "Implemented with evidence".into(),
        changed_files: vec!["src/feature".into()],
        tests: vec![ReportTest {
            name: "check".into(),
            command: "check".into(),
            expected: "Pass".into(),
            actual: "Pass".into(),
            result: "PASS".into(),
        }],
        deviations_md: None,
        not_verified_md: None,
    }
}
fn running(s: &Store, scope: &ExecutionScope) -> bool {
    s.get_execution(scope).unwrap().effective_state == ExecutionEffectiveState::Running
}

#[test]
fn epic_story_inheritance_and_pause_matrix_is_explicit() {
    let f = fixture();
    let s = &f.store;
    let e = epic(&f.epic);
    let a = story(&f.story);
    let b = story(&add_story(s, &f.human, &f.epic, "Second story"));
    assert!(!running(s, &e));
    assert!(!running(s, &a));
    assert_eq!(
        s.get_execution(&a).unwrap().own_state,
        ExecutionOwnState::Inherit
    );
    change(s, &f.human, e.clone(), ExecutionAction::Start);
    assert!(running(s, &a));
    assert!(running(s, &b));
    change(s, &f.human, a.clone(), ExecutionAction::Pause);
    assert!(!running(s, &a));
    assert!(running(s, &b));
    change(s, &f.human, b.clone(), ExecutionAction::Start);
    change(s, &f.human, e.clone(), ExecutionAction::Pause);
    assert!(!running(s, &a));
    assert!(!running(s, &b));
    assert_eq!(
        s.get_execution(&b).unwrap().own_state,
        ExecutionOwnState::Inherit
    );
    assert_eq!(
        s.get_execution(&a).unwrap().own_state,
        ExecutionOwnState::Paused
    );
    change(s, &f.human, b.clone(), ExecutionAction::Start);
    assert!(!running(s, &e));
    assert!(running(s, &b));
    assert_eq!(s.get_execution(&e).unwrap().running_story_count, 1);
    change(s, &f.human, e.clone(), ExecutionAction::Start);
    assert!(!running(s, &a));
    assert!(running(s, &b));
    let stale = s.get_execution(&e).unwrap().revision;
    change(s, &f.human, a.clone(), ExecutionAction::Start);
    assert!(matches!(
        s.set_execution(
            &f.human.id,
            SetExecution {
                scope: e,
                action: ExecutionAction::Pause,
                expected_revision: stale
            }
        ),
        Err(Error::Conflict)
    ));
}
#[test]
fn ready_is_not_permission_and_no_role_or_status_path_bypasses_start() {
    let f = fixture();
    let s = &f.store;
    let t = s.create_task(&f.human.id, input(&f.story)).unwrap();
    assert!(t.task.ready);
    for actor in [&f.human, &f.brain, &f.worker] {
        assert!(matches!(
            s.claim_task(&actor.id, &t.task.key),
            Err(Error::ExecutionRequired(_))
        ));
    }
    let before = s.latest_seq().unwrap();
    for actor in [&f.human, &f.brain] {
        assert!(matches!(
            s.move_task_with_override(
                &actor.id,
                &t.task.key,
                "in_progress",
                None,
                None,
                Some("Cannot bypass permission")
            ),
            Err(Error::ExecutionRequired(_))
        ));
        let mut create = input(&f.story);
        create.status = Some("in_progress".into());
        assert!(matches!(
            s.create_task(&actor.id, create),
            Err(Error::ExecutionRequired(_))
        ));
    }
    assert!(matches!(
        s.update_current_task(TaskEditInput {
            key: t.task.key.clone(),
            expected_updated_at: t.task.updated_at.clone(),
            patch: TaskPatch {
                status: Some("in_progress".into()),
                ..Default::default()
            }
        }),
        Err(Error::ExecutionRequired(_))
    ));
    assert!(matches!(
        s.release_task(&f.human.id, &t.task.key, Some("in_progress")),
        Err(Error::ExecutionRequired(_))
    ));
    assert_eq!(s.latest_seq().unwrap(), before);
    assert!(matches!(
        s.set_execution(
            &f.brain.id,
            SetExecution {
                scope: story(&f.story),
                action: ExecutionAction::Start,
                expected_revision: s.get_execution(&story(&f.story)).unwrap().revision
            }
        ),
        Err(Error::Forbidden(_))
    ));
    change(s, &f.human, story(&f.story), ExecutionAction::Start);
    s.claim_task(&f.worker.id, &t.task.key).unwrap();
    change(s, &f.human, story(&f.story), ExecutionAction::Pause);
    assert!(matches!(
        s.assign_task(&f.human.id, &t.task.key, Some(&f.brain.id)),
        Err(Error::ExecutionRequired(_))
    ));
    let current = s.get_task(&t.task.key).unwrap();
    assert!(matches!(
        s.update_current_task(TaskEditInput {
            key: t.task.key.clone(),
            expected_updated_at: current.task.updated_at,
            patch: TaskPatch {
                assignee_id: Some(Some(f.brain.id.clone())),
                ..Default::default()
            }
        }),
        Err(Error::ExecutionRequired(_))
    ));
    s.move_task(&f.worker.id, &t.task.key, "in_progress", None, None)
        .unwrap();
    s.submit_report(&f.worker.id, report(&t.task.key)).unwrap();
    s.review_task(
        &f.brain.id,
        ReviewTask {
            key: t.task.key.clone(),
            verdict: "changes_requested".into(),
            comments_md: "One more check".into(),
            failed_tests: None,
        },
    )
    .unwrap();
    assert!(matches!(
        s.claim_task(&f.worker.id, &t.task.key),
        Err(Error::ExecutionRequired(_))
    ));
    change(s, &f.human, story(&f.story), ExecutionAction::Start);
    s.claim_task(&f.worker.id, &t.task.key).unwrap();
    s.submit_report(&f.worker.id, report(&t.task.key)).unwrap();
    assert_eq!(s.get_task(&t.task.key).unwrap().reports.len(), 2);
}
#[test]
fn typed_requests_are_idempotent_exact_scope_human_only_and_revocable() {
    let f = fixture();
    let s = &f.store;
    let scope = story(&f.story);
    assert!(
        s.request_execution(
            &f.worker.id,
            RequestExecution {
                scope: scope.clone(),
                reason: "Worker request".into()
            }
        )
        .is_err()
    );
    let q = s
        .ask_user(
            &f.brain.id,
            AskUser {
                scope: Scope {
                    kind: "story".into(),
                    id: f.story.key.clone(),
                },
                title: "Start?".into(),
                body_md: None,
                options: Some(vec![QuestionOption {
                    label: "Start".into(),
                    description: "Generic text is not authorization".into(),
                }]),
                recommended_index: None,
                allow_free_text: None,
                round_label: None,
            },
        )
        .unwrap();
    s.answer_question(
        &f.human.id,
        AnswerQuestion {
            id: q.id,
            answer_index: Some(0),
            answer_text: None,
        },
    )
    .unwrap();
    assert!(!running(s, &scope));
    let ask = || RequestExecution {
        scope: scope.clone(),
        reason: "The plan is ready for your review.".into(),
    };
    let first = s.request_execution(&f.brain.id, ask()).unwrap();
    let before = s.latest_seq().unwrap();
    assert_eq!(
        s.request_execution(&f.brain.id, ask()).unwrap().id,
        first.id
    );
    assert_eq!(s.latest_seq().unwrap(), before);
    assert!(matches!(
        s.resolve_execution_request(
            &f.brain.id,
            ResolveExecutionRequest {
                id: first.id.clone(),
                decision: ExecutionDecision::Approve,
                expected_revision: first.revision.clone()
            }
        ),
        Err(Error::Forbidden(_))
    ));
    change(s, &f.human, scope.clone(), ExecutionAction::Pause);
    assert_eq!(
        s.list_execution_requests(None).unwrap()[0].status,
        ExecutionRequestStatus::Superseded
    );
    assert!(matches!(
        s.resolve_execution_request(
            &f.human.id,
            ResolveExecutionRequest {
                id: first.id,
                decision: ExecutionDecision::Approve,
                expected_revision: first.revision
            }
        ),
        Err(Error::Conflict)
    ));
    let next = s.request_execution(&f.brain.id, ask()).unwrap();
    s.resolve_execution_request(
        &f.human.id,
        ResolveExecutionRequest {
            id: next.id,
            decision: ExecutionDecision::Decline,
            expected_revision: next.revision,
        },
    )
    .unwrap();
    assert!(!running(s, &scope));
    let approved = s.request_execution(&f.brain.id, ask()).unwrap();
    s.resolve_execution_request(
        &f.human.id,
        ResolveExecutionRequest {
            id: approved.id,
            decision: ExecutionDecision::Approve,
            expected_revision: approved.revision,
        },
    )
    .unwrap();
    assert!(running(s, &scope));
    assert!(!running(s, &epic(&f.epic)));
    assert!(serde_json::from_value::<RequestExecution>(serde_json::json!({"scope":{"type":"story","id":f.story.key},"reason":"x","userApproved":true})).is_err());
}
#[test]
fn close_reopen_and_archive_restore_never_resurrect_authority_or_drop_reports() {
    let f = fixture();
    let s = &f.store;
    let e = epic(&f.epic);
    let scope = story(&f.story);
    let t = s.create_task(&f.human.id, input(&f.story)).unwrap();
    change(s, &f.human, e.clone(), ExecutionAction::Start);
    s.claim_task(&f.worker.id, &t.task.key).unwrap();
    s.set_story_status(&f.human.id, &f.story.key, "archived", None)
        .unwrap();
    s.submit_report(&f.worker.id, report(&t.task.key)).unwrap();
    s.set_story_status(&f.human.id, &f.story.key, "active", None)
        .unwrap();
    assert!(running(s, &e));
    assert!(!running(s, &scope));
    s.review_task(
        &f.brain.id,
        ReviewTask {
            key: t.task.key.clone(),
            verdict: "accept".into(),
            comments_md: "Accepted".into(),
            failed_tests: None,
        },
    )
    .unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    s.set_story_status(&f.human.id, &f.story.key, "done", None)
        .unwrap();
    s.set_story_status(&f.human.id, &f.story.key, "active", None)
        .unwrap();
    assert!(!running(s, &scope));
    s.set_epic_status(
        &f.human.id,
        &f.epic.key,
        "done",
        Some("Close scope administratively"),
    )
    .unwrap();
    s.set_epic_status(&f.human.id, &f.epic.key, "active", None)
        .unwrap();
    assert!(!running(s, &e));
    change(s, &f.human, e.clone(), ExecutionAction::Start);
    let project = s.active_jam().unwrap();
    s.reset_jam(&f.human.id, &project.name).unwrap();
    s.restore_project(&project.id).unwrap();
    assert!(!running(s, &e));
    assert!(!running(s, &scope));
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    let exported = s.export_jam().unwrap();
    s.import_jam_json(&f.human.id, &serde_json::to_string(&exported).unwrap())
        .unwrap();
    assert!(
        s.list_execution()
            .unwrap()
            .iter()
            .all(|s| s.effective_state == ExecutionEffectiveState::Paused)
    );
}
#[test]
fn migration_adds_no_grant_but_existing_worker_may_submit_evidence() {
    let f = fixture();
    let s = f.store;
    let t = s.create_task(&f.human.id, input(&f.story)).unwrap();
    change(&s, &f.human, story(&f.story), ExecutionAction::Start);
    s.claim_task(&f.worker.id, &t.task.key).unwrap();
    let path = s.path.clone();
    drop(s);
    let c = rusqlite::Connection::open(&path).unwrap();
    c.execute_batch(
        "DROP TABLE execution_requests;DROP TABLE execution_states;PRAGMA user_version=5;",
    )
    .unwrap();
    drop(c);
    let s = Store::open(&path).unwrap();
    assert!(!running(&s, &story(&f.story)));
    s.submit_report(&f.worker.id, report(&t.task.key)).unwrap();
    assert_eq!(s.get_task(&t.task.key).unwrap().reports.len(), 1);
}

#[test]
fn approvals_stay_on_the_exact_project_during_human_navigation() {
    let f = fixture();
    let s = &f.store;
    let project = s.active_jam().unwrap();
    let pa = s.for_project(&project.id).unwrap();
    let request = pa
        .request_execution(
            &f.brain.id,
            RequestExecution {
                scope: story(&f.story),
                reason: "Please approve this scope".into(),
            },
        )
        .unwrap();
    let (other, human) = s
        .create_jam("Another project", None, None, None, "UTC", "Other human")
        .unwrap();
    let pb = s.for_project(&other.id).unwrap();
    assert!(pb.get_execution(&story(&f.story)).is_err());
    assert!(
        pb.request_execution(
            &f.brain.id,
            RequestExecution {
                scope: story(&f.story),
                reason: "Foreign target".into()
            }
        )
        .is_err()
    );
    assert!(
        pb.resolve_execution_request(
            &human.id,
            ResolveExecutionRequest {
                id: request.id.clone(),
                decision: ExecutionDecision::Approve,
                expected_revision: request.revision.clone()
            }
        )
        .is_err()
    );
    assert!(pb.list_execution_requests(None).unwrap().is_empty());
    pa.resolve_execution_request(
        &f.human.id,
        ResolveExecutionRequest {
            id: request.id,
            decision: ExecutionDecision::Approve,
            expected_revision: request.revision,
        },
    )
    .unwrap();
    assert!(running(&pa, &story(&f.story)));
    assert_eq!(s.active_jam().unwrap().id, other.id);
}
#[test]
fn pause_and_claim_serialize_and_visibility_restore_does_not_resume_work() {
    use std::sync::{Arc, Barrier};
    let f = fixture();
    let s = Arc::new(f.store);
    let t = s.create_task(&f.human.id, input(&f.story)).unwrap();
    let second = s.create_task(&f.human.id, input(&f.story)).unwrap();
    let scope = story(&f.story);
    change(&s, &f.human, scope.clone(), ExecutionAction::Start);
    let barrier = Arc::new(Barrier::new(2));
    // Independent connection pools model a desktop and a separate MCP process.
    let copy = Store::open(&s.path).unwrap();
    let worker = f.worker.id.clone();
    let key = t.task.key.clone();
    let sync = barrier.clone();
    let claim = std::thread::spawn(move || {
        sync.wait();
        copy.claim_task(&worker, &key)
    });
    barrier.wait();
    change(&s, &f.human, scope.clone(), ExecutionAction::Pause);
    let result = claim.join().unwrap();
    assert!(result.is_ok() || matches!(result, Err(Error::ExecutionRequired(_))));
    assert!(matches!(
        s.claim_task(&f.worker.id, &second.task.key),
        Err(Error::ExecutionRequired(_))
    ));
    if s.get_task(&t.task.key).unwrap().task.status != "in_progress" {
        change(&s, &f.human, scope.clone(), ExecutionAction::Start);
        s.claim_task(&f.worker.id, &t.task.key).unwrap();
        change(&s, &f.human, scope.clone(), ExecutionAction::Pause);
    }
    s.archive_task(&f.human.id, &t.task.key, None).unwrap();
    let before = s.get_task(&t.task.key).unwrap().task;
    let restored = s.unarchive_task(&f.human.id, &t.task.key).unwrap();
    assert_eq!(restored.status, before.status);
    assert_eq!(restored.assignee_id, before.assignee_id);
    assert_eq!(restored.review_round, before.review_round);
    assert!(!running(&s, &scope));
    assert!(matches!(
        s.assign_task(&f.human.id, &t.task.key, Some(&f.brain.id)),
        Err(Error::ExecutionRequired(_))
    ));
    // Restoring visibility permits cancellation without authorizing any new work.
    let released = s.release_task(&f.worker.id, &t.task.key, None).unwrap();
    assert_eq!(released.status, "backlog");
    assert!(released.assignee_id.is_none());
    assert!(!running(&s, &scope));
    assert!(matches!(
        s.claim_task(&f.worker.id, &t.task.key),
        Err(Error::ExecutionRequired(_))
    ));
    assert!(matches!(
        s.move_task(&f.human.id, &t.task.key, "in_progress", None, None),
        Err(Error::ExecutionRequired(_))
    ));
}
#[test]
fn demo_and_draft_starts_do_not_implicitly_authorize_claims() {
    let f = fixture();
    let s = &f.store;
    let draft = s
        .create_story(
            &f.human.id,
            NewStory {
                epic_key: f.epic.key.clone(),
                title: "Draft intent".into(),
                ..Default::default()
            },
        )
        .unwrap();
    change(s, &f.human, story(&draft), ExecutionAction::Start);
    let mut create = input(&draft);
    create.status = Some("backlog".into());
    let task = s.create_task(&f.human.id, create).unwrap();
    s.mark_ready(
        &f.human.id,
        &task.task.key,
        Some("Brief approved, intent still in draft"),
    )
    .unwrap();
    assert!(matches!(
        s.claim_task(&f.worker.id, &task.task.key),
        Err(Error::NotReady(_))
    ));
    s.seed_demo().unwrap();
    assert!(
        s.list_execution()
            .unwrap()
            .iter()
            .all(|s| s.effective_state == ExecutionEffectiveState::Paused)
    );
    assert!(
        !s.list_tasks(
            None,
            TaskFilter {
                status: Some(vec!["in_progress".into()]),
                ..Default::default()
            }
        )
        .unwrap()
        .tasks
        .is_empty()
    );
}

#[test]
fn archived_in_progress_still_blocks_project_archive_until_evidence_arrives() {
    let f = fixture();
    let s = &f.store;
    let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
    let scope = story(&f.story);
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    s.claim_task(&f.worker.id, &task.task.key).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Pause);
    s.archive_task(&f.human.id, &task.task.key, None).unwrap();
    let project = s.active_jam().unwrap();
    assert_eq!(s.list_projects(false).unwrap()[0].in_progress_count, 1);
    assert_eq!(s.get_execution(&scope).unwrap().in_progress_count, 1);
    assert_eq!(s.get_execution(&scope).unwrap().ready_count, 0);
    assert!(matches!(
        s.reset_jam(&f.human.id, &project.name),
        Err(Error::Validation { .. })
    ));
    assert_eq!(
        s.get_task(&task.task.key).unwrap().task.status,
        "in_progress"
    );
    assert_eq!(s.active_jam().unwrap().id, project.id);
    s.submit_report(&f.worker.id, report(&task.task.key))
        .unwrap();
    assert_eq!(s.list_projects(false).unwrap()[0].in_progress_count, 0);
    assert_eq!(s.get_execution(&scope).unwrap().in_progress_count, 0);
    s.reset_jam(&f.human.id, &project.name).unwrap();
    s.restore_project(&project.id).unwrap();
    let restored = s.get_task(&task.task.key).unwrap();
    assert_eq!(restored.task.status, "review");
    assert!(restored.task.archived_at.is_some());
    assert_eq!(restored.reports.len(), 1);
}

#[test]
fn grants_and_pending_requests_persist_across_restart_but_old_approvals_stay_revoked() {
    let f = fixture();
    let scope = story(&f.story);
    let path = f.store.path.clone();
    let request = f
        .store
        .request_execution(
            &f.brain.id,
            RequestExecution {
                scope: scope.clone(),
                reason: "Persist the exact requested scope".into(),
            },
        )
        .unwrap();
    drop(f.store);
    let s = Store::open(&path).unwrap();
    let pending = s
        .list_execution_requests(Some(ExecutionRequestStatus::Pending))
        .unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, request.id);
    assert!(!running(&s, &scope));
    s.resolve_execution_request(
        &f.human.id,
        ResolveExecutionRequest {
            id: request.id,
            decision: ExecutionDecision::Approve,
            expected_revision: request.revision,
        },
    )
    .unwrap();
    let revision = s.get_execution(&scope).unwrap().revision;
    drop(s);
    let s = Store::open(&path).unwrap();
    assert!(running(&s, &scope));
    assert_eq!(s.get_execution(&scope).unwrap().revision, revision);
    change(&s, &f.human, scope.clone(), ExecutionAction::Pause);
    let stale = s
        .request_execution(
            &f.brain.id,
            RequestExecution {
                scope: scope.clone(),
                reason: "This request will be superseded".into(),
            },
        )
        .unwrap();
    change(&s, &f.human, epic(&f.epic), ExecutionAction::Pause);
    drop(s);
    let s = Store::open(&path).unwrap();
    assert!(!running(&s, &scope));
    assert!(
        s.list_execution_requests(Some(ExecutionRequestStatus::Pending))
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        s.resolve_execution_request(
            &f.human.id,
            ResolveExecutionRequest {
                id: stale.id,
                decision: ExecutionDecision::Approve,
                expected_revision: stale.revision,
            }
        ),
        Err(Error::Conflict)
    ));
}

#[test]
fn child_actions_supersede_broad_approval_without_canceling_unrelated_sibling_request() {
    let f = fixture();
    let s = &f.store;
    let a = story(&f.story);
    let b = story(&add_story(s, &f.human, &f.epic, "Independent sibling"));
    let e = epic(&f.epic);
    let request = |scope: ExecutionScope| {
        s.request_execution(
            &f.brain.id,
            RequestExecution {
                scope,
                reason: "Approve exactly this scope".into(),
            },
        )
        .unwrap()
    };
    let a_request = request(a.clone());
    let b_request = request(b.clone());
    let e_request = request(e.clone());
    change(s, &f.human, a.clone(), ExecutionAction::Pause);
    let requests = s.list_execution_requests(None).unwrap();
    for superseded in [&a_request.id, &e_request.id] {
        assert_eq!(
            requests
                .iter()
                .find(|r| &r.id == superseded)
                .unwrap()
                .status,
            ExecutionRequestStatus::Superseded
        );
    }
    assert_eq!(
        requests
            .iter()
            .find(|r| r.id == b_request.id)
            .unwrap()
            .status,
        ExecutionRequestStatus::Pending
    );
    s.resolve_execution_request(
        &f.human.id,
        ResolveExecutionRequest {
            id: b_request.id,
            decision: ExecutionDecision::Approve,
            expected_revision: b_request.revision,
        },
    )
    .unwrap();
    assert!(running(s, &b));
    assert!(!running(s, &a));
    assert!(!running(s, &e));
    let pending_epic = request(e.clone());
    change(s, &f.human, e.clone(), ExecutionAction::Pause);
    assert!(!running(s, &b));
    assert!(matches!(
        s.resolve_execution_request(
            &f.human.id,
            ResolveExecutionRequest {
                id: pending_epic.id,
                decision: ExecutionDecision::Approve,
                expected_revision: pending_epic.revision,
            }
        ),
        Err(Error::Conflict)
    ));
    assert_eq!(
        s.get_execution(&a).unwrap().own_state,
        ExecutionOwnState::Paused
    );
    assert_eq!(
        s.get_execution(&b).unwrap().own_state,
        ExecutionOwnState::Inherit
    );
}

#[test]
fn reopening_imported_closed_stories_cannot_inherit_a_new_parent_start() {
    for closed in ["done", "archived"] {
        let f = fixture();
        let s = &f.store;
        s.set_story_status(&f.human.id, &f.story.key, closed, None)
            .unwrap();
        let exported = s.export_jam().unwrap();
        s.import_jam_json(&f.human.id, &serde_json::to_string(&exported).unwrap())
            .unwrap();
        let imported_epic = s.plan_epics().unwrap().remove(0);
        let imported_scope = s
            .list_execution()
            .unwrap()
            .into_iter()
            .find(|state| state.scope.kind == ExecutionScopeType::Story)
            .unwrap()
            .scope;
        let imported_story = s.get_story(&imported_scope.id).unwrap().story;
        // Imports intentionally omit authorization records; the default is inherit.
        assert_eq!(
            s.get_execution(&story(&imported_story)).unwrap().own_state,
            ExecutionOwnState::Inherit
        );
        change(s, &f.human, epic(&imported_epic), ExecutionAction::Start);
        assert!(!running(s, &story(&imported_story)));
        s.set_story_status(&f.human.id, &imported_story.key, "active", None)
            .unwrap();
        assert!(running(s, &epic(&imported_epic)));
        assert!(!running(s, &story(&imported_story)));
        assert_eq!(
            s.get_execution(&story(&imported_story)).unwrap().own_state,
            ExecutionOwnState::Paused
        );
    }
}

#[test]
fn agent_completion_always_requires_independent_review_but_human_manual_done_remains() {
    let f = fixture();
    let s = &f.store;
    let scope = story(&f.story);
    let t = s.create_task(&f.human.id, input(&f.story)).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    s.claim_task(&f.brain.id, &t.task.key).unwrap();
    s.submit_report(&f.brain.id, report(&t.task.key)).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Pause);
    let before = serde_json::to_value(s.get_task(&t.task.key).unwrap()).unwrap();
    let seq = s.latest_seq().unwrap();
    assert!(matches!(
        s.review_task(
            &f.brain.id,
            ReviewTask {
                key: t.task.key.clone(),
                verdict: "accept".into(),
                comments_md: "Self approval".into(),
                failed_tests: None,
            }
        ),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        s.move_task(&f.brain.id, &t.task.key, "done", None, None),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        s.move_task_with_override(
            &f.brain.id,
            &t.task.key,
            "done",
            None,
            None,
            Some("Planner override")
        ),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        s.release_task(&f.brain.id, &t.task.key, Some("done")),
        Err(Error::Forbidden(_))
    ));
    let mut direct = input(&f.story);
    direct.status = Some("done".into());
    assert!(matches!(
        s.create_task(&f.brain.id, direct),
        Err(Error::Forbidden(_))
    ));
    assert_eq!(s.latest_seq().unwrap(), seq);
    assert_eq!(
        serde_json::to_value(s.get_task(&t.task.key).unwrap()).unwrap(),
        before
    );
    // Clearing/reassigning the holder does not erase current-round authorship.
    for assignee in [None, Some(f.worker.id.as_str())] {
        s.assign_task(&f.human.id, &t.task.key, assignee).unwrap();
        assert!(matches!(
            s.review_task(
                &f.brain.id,
                ReviewTask {
                    key: t.task.key.clone(),
                    verdict: "accept".into(),
                    comments_md: "Changed holder".into(),
                    failed_tests: None,
                }
            ),
            Err(Error::Forbidden(_))
        ));
        assert!(matches!(
            s.move_task(&f.brain.id, &t.task.key, "done", None, None),
            Err(Error::Forbidden(_))
        ));
    }
    s.assign_task(&f.human.id, &t.task.key, Some(&f.brain.id))
        .unwrap();
    // Even relinquishing the claim cannot convert an author's evidence to approval.
    s.release_task(&f.brain.id, &t.task.key, None).unwrap();
    assert!(matches!(
        s.move_task(&f.brain.id, &t.task.key, "done", None, None),
        Err(Error::Forbidden(_))
    ));
    assert!(s.get_task(&t.task.key).unwrap().reviews.is_empty());
    s.move_task(&f.human.id, &t.task.key, "done", None, None)
        .unwrap();
    assert_eq!(s.get_task(&t.task.key).unwrap().task.status, "done");
    assert!(
        s.get_task(&t.task.key).unwrap().reviews.is_empty(),
        "manual human completion is not fabricated evidence review"
    );
    let own = s.create_task(&f.human.id, input(&f.story)).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    s.claim_task(&f.human.id, &own.task.key).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Pause);
    s.release_task(&f.human.id, &own.task.key, Some("done"))
        .unwrap();
    assert_eq!(s.get_task(&own.task.key).unwrap().task.status, "done");
    // Human's version-checked patch uses the same explicit manual policy.
    let patched = s.create_task(&f.human.id, input(&f.story)).unwrap();
    s.update_current_task(TaskEditInput {
        key: patched.task.key.clone(),
        expected_updated_at: patched.task.updated_at,
        patch: TaskPatch {
            status: Some("done".into()),
            ..Default::default()
        },
    })
    .unwrap();
    assert_eq!(s.get_task(&patched.task.key).unwrap().task.status, "done");
}

#[test]
fn existing_claim_release_survives_pause_and_archived_task_or_parent_without_new_authority() {
    for archived in ["none", "task", "story", "epic"] {
        for human_recovery in [false, true] {
            let f = fixture();
            let s = &f.store;
            let scope = story(&f.story);
            let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
            change(s, &f.human, scope.clone(), ExecutionAction::Start);
            s.claim_task(&f.worker.id, &task.task.key).unwrap();
            change(s, &f.human, scope.clone(), ExecutionAction::Pause);
            match archived {
                "task" => {
                    s.archive_task(&f.human.id, &task.task.key, None).unwrap();
                }
                "story" => {
                    s.set_story_status(&f.human.id, &f.story.key, "archived", None)
                        .unwrap();
                }
                "epic" => {
                    s.set_epic_status(&f.human.id, &f.epic.key, "archived", None)
                        .unwrap();
                }
                _ => {}
            }
            let before = s.get_task(&task.task.key).unwrap();
            let grant = s.get_execution(&scope).unwrap();
            let seq = s.latest_seq().unwrap();
            assert!(
                s.release_task(&f.brain.id, &task.task.key, None).is_err(),
                "nonholder brain cannot cancel somebody else's claim"
            );
            assert_eq!(s.latest_seq().unwrap(), seq);
            let actor = if human_recovery {
                &f.human.id
            } else {
                &f.worker.id
            };
            let released = s.release_task(actor, &task.task.key, None).unwrap();
            assert_eq!(released.status, "backlog");
            assert!(released.assignee_id.is_none());
            assert_eq!(released.archived_at, before.task.archived_at);
            assert_eq!(released.review_round, before.task.review_round);
            let after = s.get_task(&task.task.key).unwrap();
            assert_eq!(after.story.status, before.story.status);
            assert_eq!(after.epic.status, before.epic.status);
            assert!(after.reports.is_empty());
            assert!(after.reviews.is_empty());
            assert_eq!(s.get_execution(&scope).unwrap().revision, grant.revision);
            assert!(!running(s, &scope));
            let events = s.list_changes_since(seq, None).unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].action, "task.released");
            assert!(s.claim_task(&f.worker.id, &task.task.key).is_err());
            let project = s.active_jam().unwrap();
            s.reset_jam(&f.human.id, &project.name).unwrap();
        }
    }
}

#[test]
fn archived_claim_recovery_to_ready_preserves_readiness_validation() {
    for archived in ["task", "story", "epic"] {
        let f = fixture();
        let s = &f.store;
        let scope = story(&f.story);
        let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
        change(s, &f.human, scope.clone(), ExecutionAction::Start);
        s.claim_task(&f.worker.id, &task.task.key).unwrap();
        change(s, &f.human, scope.clone(), ExecutionAction::Pause);
        match archived {
            "task" => {
                s.archive_task(&f.human.id, &task.task.key, None).unwrap();
            }
            "story" => {
                s.set_story_status(&f.human.id, &f.story.key, "archived", None)
                    .unwrap();
            }
            "epic" => {
                s.set_epic_status(&f.human.id, &f.epic.key, "archived", None)
                    .unwrap();
            }
            _ => unreachable!(),
        }
        let old = s.get_task(&task.task.key).unwrap().task;
        let result = s.release_task(&f.worker.id, &task.task.key, Some("ready"));
        if archived == "story" {
            assert!(matches!(result, Err(Error::NotReady(_))));
            let current = s.get_task(&task.task.key).unwrap().task;
            assert_eq!(current.status, old.status);
            assert_eq!(current.assignee_id, old.assignee_id);
        } else {
            let released = result.unwrap();
            assert_eq!(released.status, "ready");
            assert!(released.assignee_id.is_none());
            assert_eq!(released.archived_at, old.archived_at);
        }
        assert!(!running(s, &scope));
    }
}

#[test]
fn native_release_confirmation_cannot_clear_reassigned_reclaimed_or_reported_work() {
    for changed in ["reassigned", "reclaimed", "reported"] {
        let f = fixture();
        let s = &f.store;
        let scope = story(&f.story);
        let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
        change(s, &f.human, scope.clone(), ExecutionAction::Start);
        let claimed = s.claim_task(&f.worker.id, &task.task.key).unwrap();
        let confirmed = ReleaseClaim {
            key: task.task.key.clone(),
            expected_updated_at: claimed.task.updated_at,
        };
        match changed {
            "reassigned" => {
                s.assign_task(&f.human.id, &task.task.key, Some(&f.brain.id))
                    .unwrap();
            }
            "reclaimed" => {
                s.release_task(&f.worker.id, &task.task.key, Some("ready"))
                    .unwrap();
                s.claim_task(&f.worker.id, &task.task.key).unwrap();
            }
            "reported" => {
                s.submit_report(&f.worker.id, report(&task.task.key))
                    .unwrap();
            }
            _ => unreachable!(),
        }
        change(s, &f.human, scope.clone(), ExecutionAction::Pause);
        let before = serde_json::to_value(s.get_task(&task.task.key).unwrap()).unwrap();
        let seq = s.latest_seq().unwrap();
        assert!(matches!(
            s.release_current_task(confirmed),
            Err(Error::Conflict)
        ));
        assert_eq!(s.latest_seq().unwrap(), seq);
        assert_eq!(
            serde_json::to_value(s.get_task(&task.task.key).unwrap()).unwrap(),
            before
        );
        let current = s.get_task(&task.task.key).unwrap().task;
        let released = s
            .release_current_task(ReleaseClaim {
                key: current.key.clone(),
                expected_updated_at: current.updated_at,
            })
            .unwrap();
        assert_eq!(released.status, "backlog");
        assert!(released.assignee_id.is_none());
        assert_eq!(released.updated_by, f.human.id);
        assert!(!running(s, &scope));
        assert!(
            s.submit_report(&f.worker.id, report(&task.task.key))
                .is_err(),
            "late report cannot attach to a released claim"
        );
        assert!(matches!(
            s.release_current_task(ReleaseClaim {
                key: released.key,
                expected_updated_at: released.updated_at
            }),
            Err(Error::WrongStatus(_))
        ));
    }
}

#[test]
fn native_release_is_project_pinned_and_preserves_archived_work_evidence() {
    let f = fixture();
    let s = &f.store;
    let project = s.active_jam().unwrap();
    let captured = s.selected_snapshot().unwrap();
    let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
    let scope = story(&f.story);
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    s.claim_task(&f.worker.id, &task.task.key).unwrap();
    s.submit_report(&f.worker.id, report(&task.task.key))
        .unwrap();
    s.review_task(
        &f.brain.id,
        ReviewTask {
            key: task.task.key.clone(),
            verdict: "changes_requested".into(),
            comments_md: "Another round".into(),
            failed_tests: None,
        },
    )
    .unwrap();
    let current = s.claim_task(&f.worker.id, &task.task.key).unwrap().task;
    s.set_epic_status(&f.human.id, &f.epic.key, "archived", None)
        .unwrap();
    let revision = s.get_execution(&scope).unwrap().revision;
    let input = ReleaseClaim {
        key: current.key,
        expected_updated_at: current.updated_at,
    };
    let (other, _) = s
        .create_jam(
            "Other visible project",
            None,
            None,
            None,
            "UTC",
            "Other human",
        )
        .unwrap();
    assert!(
        s.selected_snapshot()
            .unwrap()
            .release_current_task(input.clone())
            .is_err(),
        "a new visible project cannot act on a foreign task"
    );
    let released = captured.release_current_task(input).unwrap();
    assert_eq!(released.jam_id, project.id);
    assert_eq!(
        released.updated_by, f.human.id,
        "captured project's human, not the later selected project's human"
    );
    assert_eq!(released.status, "backlog");
    assert!(released.assignee_id.is_none());
    assert_eq!(s.active_jam().unwrap().id, other.id);
    let detail = captured.get_task(&task.task.key).unwrap();
    assert_eq!(detail.reports.len(), 1);
    assert_eq!(detail.reviews.len(), 1);
    assert_eq!(detail.task.review_round, 1);
    assert_eq!(detail.epic.status, "archived");
    assert_eq!(captured.get_execution(&scope).unwrap().revision, revision);
    assert!(!running(&captured, &scope));
    assert!(
        captured
            .submit_report(&f.worker.id, report(&task.task.key))
            .is_err()
    );
}

#[test]
fn only_native_human_can_cancel_unassigned_in_progress_after_archival() {
    for archived in ["none", "task", "story", "epic"] {
        let f = fixture();
        let s = &f.store;
        let scope = story(&f.story);
        let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
        change(s, &f.human, scope.clone(), ExecutionAction::Start);
        s.move_task(&f.human.id, &task.task.key, "in_progress", None, None)
            .unwrap();
        change(s, &f.human, scope.clone(), ExecutionAction::Pause);
        match archived {
            "task" => {
                s.archive_task(&f.human.id, &task.task.key, None).unwrap();
            }
            "story" => {
                s.set_story_status(&f.human.id, &f.story.key, "archived", None)
                    .unwrap();
            }
            "epic" => {
                s.set_epic_status(&f.human.id, &f.epic.key, "archived", None)
                    .unwrap();
            }
            _ => {}
        }
        let current = s.get_task(&task.task.key).unwrap().task;
        assert!(current.assignee_id.is_none());
        assert!(s.release_task(&f.brain.id, &task.task.key, None).is_err());
        let confirmed = ReleaseClaim {
            key: current.key.clone(),
            expected_updated_at: current.updated_at.clone(),
        };
        s.set_setting("current_member_id", &f.brain.id).unwrap();
        assert!(
            s.release_current_task(confirmed.clone()).is_err(),
            "native identity cannot be an agent"
        );
        s.set_setting("current_member_id", &f.human.id).unwrap();
        let released = s.release_current_task(confirmed).unwrap();
        assert_eq!(released.status, "backlog");
        assert!(released.assignee_id.is_none());
        assert_eq!(released.archived_at, current.archived_at);
        assert!(!running(s, &scope));
        assert!(s.get_task(&task.task.key).unwrap().reports.is_empty());
        let project = s.active_jam().unwrap();
        s.reset_jam(&f.human.id, &project.name).unwrap();
    }
}

#[test]
fn concurrent_native_release_and_report_serialize_without_losing_evidence() {
    use std::sync::{Arc, Barrier};
    let f = fixture();
    let s = &f.store;
    let scope = story(&f.story);
    let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    let current = s.claim_task(&f.worker.id, &task.task.key).unwrap().task;
    change(s, &f.human, scope.clone(), ExecutionAction::Pause);
    let worker_store = Store::open(&s.path).unwrap().selected_snapshot().unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let sync = barrier.clone();
    let worker = f.worker.id.clone();
    let key = task.task.key.clone();
    let reported = std::thread::spawn(move || {
        sync.wait();
        worker_store.submit_report(&worker, report(&key))
    });
    barrier.wait();
    let released = s.release_current_task(ReleaseClaim {
        key: current.key,
        expected_updated_at: current.updated_at,
    });
    let reported = reported.join().unwrap();
    let detail = s.get_task(&task.task.key).unwrap();
    match (released, reported) {
        (Ok(_), Err(Error::Forbidden(_))) => {
            assert_eq!(detail.task.status, "backlog");
            assert!(detail.reports.is_empty());
            assert!(detail.task.assignee_id.is_none());
        }
        (Err(Error::Conflict), Ok(_)) => {
            assert_eq!(detail.task.status, "review");
            assert_eq!(detail.reports.len(), 1);
            assert_eq!(
                detail.task.assignee_id.as_deref(),
                Some(f.worker.id.as_str())
            );
        }
        result => panic!("release/report did not serialize safely: {result:?}"),
    }
    assert!(!running(s, &scope));
}

#[test]
fn report_contract_has_no_claim_token_so_callers_must_reread_after_reclaim() {
    let f = fixture();
    let s = &f.store;
    let scope = story(&f.story);
    let task = s.create_task(&f.human.id, input(&f.story)).unwrap();
    change(s, &f.human, scope.clone(), ExecutionAction::Start);
    let current = s.claim_task(&f.worker.id, &task.task.key).unwrap().task;
    let payload = report(&task.task.key);
    s.release_current_task(ReleaseClaim {
        key: current.key,
        expected_updated_at: current.updated_at,
    })
    .unwrap();
    assert!(matches!(
        s.submit_report(&f.worker.id, payload.clone()),
        Err(Error::Forbidden(_))
    ));
    s.mark_ready(&f.human.id, &task.task.key, None).unwrap();
    s.claim_task(&f.worker.id, &task.task.key).unwrap();
    // Current API authenticates the holder and status/round, not an individual
    // claim epoch. After this same identity legitimately reclaims, it cannot
    // distinguish an old payload from new evidence. This documents the boundary,
    // not a freshness guarantee: callers must reread their current claim/context.
    let accepted = s.submit_report(&f.worker.id, payload).unwrap();
    assert_eq!(accepted.round, 0);
    assert_eq!(s.get_task(&task.task.key).unwrap().task.status, "review");
}
