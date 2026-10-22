mod support;
use jam_core::*;
use std::{sync::Arc, thread, time::Duration};
use support::FreshContext;

fn fixture() -> (tempfile::TempDir, Store, Jam, Member) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("projects.db")).unwrap();
    let (project, human) = store
        .create_jam("First project", None, None, None, "UTC", "Human")
        .unwrap();
    (dir, store, project, human)
}
fn task(s: &Store, h: &Member, title: &str) -> TaskDetail {
    let story = s.default_task_story(&h.id).unwrap();
    s.create_task(
        &h.id,
        CreateTask {
            story_key: Some(story.key),
            title: title.into(),
            ..Default::default()
        },
    )
    .unwrap()
}
#[test]
fn selection_survives_restart_and_scoped_stores_never_retarget() {
    let (_dir, s, a, h) = fixture();
    let first = task(&s, &h, "First task");
    let pinned = s.for_project(&a.key_prefix).unwrap();
    let (b, h2) = s
        .create_jam("Second project", None, None, None, "UTC", "Other human")
        .unwrap();
    let second = task(&s, &h2, "Second task");
    assert_eq!(pinned.active_jam().unwrap().id, a.id);
    assert_eq!(
        pinned
            .list_tasks(None, TaskFilter::default())
            .unwrap()
            .tasks[0]
            .key,
        first.task.key
    );
    assert!(matches!(
        pinned.get_task(&second.task.key),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        pinned.get_story(&second.task.story_key),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        pinned.get_epic(&second.task.epic_key),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        pinned.update_task_fresh(
            &h.id,
            UpdateTask {
                key: second.task.key.clone(),
                title: Some("Wrong project".into()),
                ..Default::default()
            }
        ),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        pinned.select_project(&b.id),
        Err(Error::Forbidden(_))
    ));
    // Backwards-compatible unbound explicit-key reads remain available internally.
    assert_eq!(
        s.get_task(&first.task.key).unwrap().task.title,
        "First task"
    );
    s.select_project(&a.id).unwrap();
    assert_eq!(s.current_member().unwrap().id, h.id);
    assert_eq!(Store::open(&s.path).unwrap().active_jam().unwrap().id, a.id);
    assert_eq!(
        s.list_projects(false)
            .unwrap()
            .iter()
            .filter(|p| p.selected)
            .count(),
        1
    );
}
#[test]
fn project_archive_restore_preserves_individual_task_state_and_boundaries() {
    let (_dir, s, a, h) = fixture();
    let active = task(&s, &h, "Keep active");
    let archived = task(&s, &h, "Keep archived");
    s.archive_task_fresh(&h.id, &archived.task.key, None)
        .unwrap();
    let before = s.export_jam().unwrap();
    let pinned = s.for_project(&a.id).unwrap();
    let (b, _) = s
        .create_jam("Other board", None, None, None, "UTC", "Other human")
        .unwrap();
    s.select_project(&a.id).unwrap();
    let state = s.reset_jam(&h.id, &a.name).unwrap();
    assert_eq!(state.jam.unwrap().id, b.id);
    assert!(matches!(
        pinned.get_task(&active.task.key),
        Err(Error::Archived(_))
    ));
    assert_eq!(s.list_projects(false).unwrap().len(), 1);
    assert_eq!(s.list_projects(true).unwrap().len(), 2);
    assert!(s.select_project(&a.id).is_err());
    let restored = s.restore_project(&a.id).unwrap();
    assert_eq!(restored.jam.unwrap().id, a.id);
    let after = s.export_jam().unwrap();
    assert_eq!(
        serde_json::to_value(before.tasks).unwrap(),
        serde_json::to_value(after.tasks).unwrap()
    );
    assert!(
        s.get_task(&active.task.key)
            .unwrap()
            .task
            .archived_at
            .is_none()
    );
    assert!(
        s.get_task(&archived.task.key)
            .unwrap()
            .task
            .archived_at
            .is_some()
    );
    assert_eq!(pinned.active_jam().unwrap().id, a.id);
    assert_eq!(
        s.list_changes_since(0, None)
            .unwrap()
            .iter()
            .filter(|e| e.action == "jam.restored")
            .count(),
        1
    );
    s.restore_project(&a.id).unwrap();
    assert_eq!(
        s.list_changes_since(0, None)
            .unwrap()
            .iter()
            .filter(|e| e.action == "jam.restored")
            .count(),
        1
    );
    s.reset_jam(&h.id, &a.name).unwrap();
    let other_human = s.current_member().unwrap();
    assert!(!s.reset_jam(&other_human.id, &b.name).unwrap().has_jam);
    assert_eq!(s.restore_project(&a.id).unwrap().jam.unwrap().id, a.id);
}
#[test]
fn shared_identity_has_independent_presence_status_and_membership() {
    let (_dir, s, a, _h) = fixture();
    let pa = s.for_project(&a.id).unwrap();
    let agent = pa.identify_agent("Worker", "codex").unwrap();
    pa.set_status(&agent.id, "Working on A", None).unwrap();
    let (b, _) = s
        .create_jam("Other board", None, None, None, "UTC", "Other human")
        .unwrap();
    assert!(
        s.list_members()
            .unwrap()
            .iter()
            .all(|m| m.member.id != agent.id)
    );
    let pb = s.for_project(&b.id).unwrap();
    let same = pb.identify_agent("Worker", "codex").unwrap();
    assert_eq!(same.id, agent.id);
    assert!(same.status_text.is_empty());
    pb.set_status(&agent.id, "Working on B", None).unwrap();
    assert_eq!(
        pa.get_member(&agent.id).unwrap().status_text,
        "Working on A"
    );
    assert_eq!(
        pb.get_member(&agent.id).unwrap().status_text,
        "Working on B"
    );
    assert_eq!(
        s.list_members()
            .unwrap()
            .iter()
            .find(|m| m.member.id == agent.id)
            .unwrap()
            .member
            .status_text,
        "Working on B"
    );
}
#[test]
fn questions_references_and_waits_are_bound_even_when_human_switches() {
    let (_dir, s, a, h) = fixture();
    let pa = Arc::new(s.for_project(&a.id).unwrap());
    let agent = pa.identify_agent("Worker", "codex").unwrap();
    let q = pa
        .ask_user(
            &agent.id,
            AskUser {
                scope: Scope {
                    kind: "project".into(),
                    id: String::new(),
                },
                title: "Question A".into(),
                body_md: None,
                options: None,
                recommended_index: None,
                allow_free_text: None,
                round_label: None,
            },
        )
        .unwrap();
    let note = pa
        .add_reference(
            &agent.id,
            AddReference {
                kind: "note".into(),
                text: Some("A note".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let cursor = s.latest_seq().unwrap();
    let watcher = {
        let pa = pa.clone();
        let actor = agent.id.clone();
        thread::spawn(move || {
            pa.wait_for_changes(
                &actor,
                ChangesWaitInput {
                    cursor,
                    timeout_seconds: 2,
                    exclude_self: false,
                    epic_key: None,
                    include_project: false,
                    actions: None,
                    actor_kind: None,
                },
            )
            .unwrap()
        })
    };
    let (b, _) = s
        .create_jam("Other board", None, None, None, "UTC", "Other human")
        .unwrap();
    let pb = s.for_project(&b.id).unwrap();
    assert!(matches!(
        pb.wait_for_answer(std::slice::from_ref(&q.id), 0),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(
        pb.update_reference(
            &agent.id,
            &note.audit.id,
            ReferencePatch {
                title: Some("No".into()),
                ..Default::default()
            }
        ),
        Err(Error::Forbidden(_))
    ));
    thread::sleep(Duration::from_millis(30));
    pa.answer_question(
        &h.id,
        AnswerQuestion {
            id: q.id,
            answer_index: None,
            answer_text: Some("For A only".into()),
        },
    )
    .unwrap();
    let result = watcher.join().unwrap();
    assert!(!result.timed_out);
    assert!(
        result
            .events
            .iter()
            .any(|e| e.action == "question.answered")
    );
    assert!(result.events.iter().all(|e| e.action != "jam.updated"));
    assert!(s.selected_events(result.events).unwrap().is_empty());
}
#[test]
fn concurrent_bound_stores_share_pools_without_scope_leakage() {
    let (_dir, s, a, h) = fixture();
    let ta = task(&s, &h, "A");
    let pa = Arc::new(s.for_project(&a.id).unwrap());
    let (b, h2) = s
        .create_jam("B", None, None, None, "UTC", "Other human")
        .unwrap();
    let tb = task(&s, &h2, "B");
    let pb = Arc::new(s.for_project(&b.id).unwrap());
    let workers = [
        (pa, a.id, ta.task.key.clone(), tb.task.key.clone()),
        (pb, b.id, tb.task.key, ta.task.key.clone()),
    ]
    .into_iter()
    .map(|(store, id, own, other)| {
        thread::spawn(move || {
            for n in 0..100 {
                assert_eq!(store.active_jam().unwrap().id, id);
                assert_eq!(store.get_task(&own).unwrap().task.key, own);
                assert!(store.get_task(&other).is_err());
                store
                    .set_setting(&format!("test.{id}"), &n.to_string())
                    .unwrap();
            }
        })
    })
    .collect::<Vec<_>>();
    for worker in workers {
        worker.join().unwrap();
    }
}

#[test]
fn version_four_backfill_retains_data_selection_and_reusable_members() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    let s = Store::open(&path).unwrap();
    let project = s.seed_demo().unwrap();
    let human = s.current_member().unwrap();
    let legacy = task(&s, &human, "Legacy retry");
    let before = s.export_jam().unwrap();
    let agent = s.identify_agent("Legacy worker", "codex").unwrap();
    drop(s);
    let c = rusqlite::Connection::open(&path).unwrap();
    c.execute_batch("DROP TRIGGER tasks_advance_claim_generation; ALTER TABLE tasks DROP COLUMN claim_generation; DROP TABLE execution_requests; DROP TABLE execution_states; DROP TABLE project_members; DROP TABLE task_idempotency; DELETE FROM settings WHERE key='current_project_id' OR key LIKE 'project.%.current_member_id'; PRAGMA user_version=4;").unwrap();
    c.execute(
        "UPDATE tasks SET idempotency_key='legacy-token' WHERE id=?",
        [&legacy.task.id],
    )
    .unwrap();
    c.execute(
        "UPDATE members SET status_text='Legacy status',last_seen_at=?,status_at=? WHERE id=?",
        rusqlite::params![jam_core::now(), jam_core::now(), agent.id],
    )
    .unwrap();
    drop(c);
    let s = Store::open(&path).unwrap();
    assert_eq!(s.active_jam().unwrap().id, project.id);
    assert_eq!(s.export_jam().unwrap().tasks.len(), before.tasks.len());
    assert_eq!(
        s.get_member(&agent.id).unwrap().status_text,
        "Legacy status"
    );
    assert_eq!(s.list_projects(false).unwrap().len(), 1);
    assert_eq!(
        s.create_task(
            &human.id,
            CreateTask {
                title: "Ignored retry".into(),
                idempotency_key: Some("legacy-token".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .task
        .key,
        legacy.task.key
    );
    let seq = s.latest_seq().unwrap();
    drop(s);
    let s = Store::open(&path).unwrap();
    assert_eq!(s.latest_seq().unwrap(), seq);
    assert_eq!(s.list_members().unwrap().len(), 6);
}

#[test]
fn archival_guard_does_not_strand_running_work_or_target_a_new_selection() {
    let (_dir, s, a, h) = fixture();
    let t = task(&s, &h, "Running task");
    s.update_story(
        &h.id,
        &t.task.story_key,
        StoryPatch {
            outcome_md: Some("Exercise archive safety".into()),
            acceptance: Some(vec![Acceptance {
                id: "a".into(),
                criterion: "Safe archive".into(),
                mandatory: true,
                check: "Tests".into(),
            }]),
            ..Default::default()
        },
    )
    .unwrap();
    s.set_story_status(&h.id, &t.task.story_key, "active", None)
        .unwrap();
    support::start_story(&s, &h.id, &t.task.story_key);
    s.move_task_fresh(&h.id, &t.task.key, "in_progress", None, None)
        .unwrap();
    let before = s.activity_count().unwrap();
    let error = s.reset_jam(&h.id, &a.name).unwrap_err().to_string();
    assert!(error.contains("In progress"));
    assert_eq!(s.activity_count().unwrap(), before);
    assert_eq!(s.active_jam().unwrap().id, a.id);
    s.move_task_fresh(&h.id, &t.task.key, "review", None, None)
        .unwrap();
    assert!(!s.reset_jam(&h.id, &a.name).unwrap().has_jam);
    s.restore_project(&a.id).unwrap();
    assert_eq!(s.get_task(&t.task.key).unwrap().task.status, "review");
    let (b, _) = s
        .create_jam(&a.name, None, None, None, "UTC", "Other human")
        .unwrap();
    assert!(matches!(
        s.archive_project(&h.id, &a.id, &a.name),
        Err(Error::Conflict)
    ));
    assert_eq!(s.active_jam().unwrap().id, b.id);
}

#[test]
fn attachments_canvas_activity_and_member_ids_cannot_cross_a_bound_project() {
    let (dir, s, a, ha) = fixture();
    let ta = task(&s, &ha, "Task A");
    let pa = s.for_project(&a.id).unwrap();
    let image = dir.path().join("private-fixture.png");
    std::fs::write(&image, b"fixture").unwrap();
    let asset = pa
        .attach_file(&ha.id, &ta.task.key, image.to_str().unwrap())
        .unwrap();
    let item = pa
        .add_reference(
            &ha.id,
            AddReference {
                kind: "asset".into(),
                file_path: Some(image.to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .unwrap();
    let note = pa
        .add_reference(
            &ha.id,
            AddReference {
                kind: "note".into(),
                text: Some("Note A".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let frame = pa
        .create_ref_frame(
            &ha.id,
            RefFrame {
                id: String::new(),
                jam_id: String::new(),
                epic_id: None,
                title: "Frame A".into(),
                x: 0.,
                y: 0.,
                w: 500.,
                h: 500.,
                color: "blue".into(),
                archived_at: None,
                collapsed: false,
            },
        )
        .unwrap();
    let edge = pa
        .create_ref_edge(&ha.id, &item.audit.id, &note.audit.id, "connection")
        .unwrap();
    pa.set_canvas_viewport(&ha.id, r#"{"x":10,"y":20,"zoom":1}"#)
        .unwrap();
    let (b, hb) = s
        .create_jam("Board B", None, None, None, "UTC", "Human B")
        .unwrap();
    let tb = task(&s, &hb, "Task B");
    let pb = s.for_project(&b.id).unwrap();
    let before = s.latest_seq().unwrap();
    assert!(pb.asset_preview_path(&asset.id).is_err());
    assert!(pb.link_asset(&hb.id, &tb.task.key, &asset.id).is_err());
    assert!(
        pb.attach_file(&hb.id, &ta.task.key, image.to_str().unwrap())
            .is_err()
    );
    assert!(
        pb.unlink_asset(
            &hb.id,
            AssetLink {
                asset_id: asset.id.clone(),
                task_key: ta.task.key.clone()
            }
        )
        .is_err()
    );
    assert!(
        pb.update_asset_fields(
            &hb.id,
            AssetEdit {
                id: asset.id.clone(),
                name: Some("Wrong project".into()),
                kind: None,
                notes: None
            }
        )
        .is_err()
    );
    assert!(pb.reference_media_path(&item.audit.id).is_err());
    assert!(pb.archive_reference(&hb.id, &item.audit.id).is_err());
    assert!(pb.archive_ref_frame(&hb.id, &frame.id).is_err());
    assert!(pb.archive_ref_edge(&hb.id, &edge.id).is_err());
    assert!(
        pb.link_reference(&hb.id, &item.audit.id, &tb.task.key)
            .is_err()
    );
    assert!(
        pb.query_tasks(TaskQuery {
            epic: Some(ta.task.epic_key.clone()),
            ..Default::default()
        })
        .is_err()
    );
    assert!(
        pb.query_tasks(TaskQuery {
            story: Some(ta.task.story_key.clone()),
            ..Default::default()
        })
        .is_err()
    );
    assert!(pb.list_changes_since(0, Some(&ta.task.epic_key)).is_err());
    assert!(pb.get_member(&ha.id).is_err());
    assert!(
        pb.edit_member(
            &hb.id,
            MemberEdit {
                id: ha.id.clone(),
                name: Some("No".into()),
                color: None,
                avatar: None
            }
        )
        .is_err()
    );
    assert!(pb.for_project(&a.id).is_err());
    assert_eq!(pb.list_projects(true).unwrap().len(), 1);
    assert!(pb.canvas_viewport(&ha.id).unwrap().is_none());
    assert_eq!(
        s.latest_seq().unwrap(),
        before,
        "rejected cross-project mutations append no activity"
    );
    assert!(pb.list_assets(None, None).unwrap().is_empty());
    assert!(pb.reference_canvas().unwrap().items.is_empty());
    assert!(
        pb.list_activity(None, None)
            .unwrap()
            .iter()
            .all(|event| event.task_key.as_deref() != Some(&ta.task.key))
    );
    assert!(
        pb.activity_page(ActivityQuery {
            before_seq: None,
            limit: None,
            actor_kind: None
        })
        .unwrap()
        .iter()
        .all(|event| event.task_key.as_deref() != Some(&ta.task.key))
    );
    assert_eq!(
        pa.asset_preview_path(&asset.id).unwrap(),
        Some(image.canonicalize().unwrap())
    );
    assert!(pa.canvas_viewport(&ha.id).unwrap().is_some());
    assert!(
        pa.get_task(&ta.task.key)
            .unwrap()
            .assets
            .iter()
            .any(|a| a.id == asset.id)
    );
}

#[test]
fn delayed_human_identity_change_stays_with_its_captured_project() {
    let (_dir, s, a, ha) = fixture();
    let other = s
        .add_human(&ha.id, "Second human", MEMBER_COLORS[1], None)
        .unwrap();
    let pa = s.for_project(&a.id).unwrap();
    let (b, hb) = s
        .create_jam("Board B", None, None, None, "UTC", "Human B")
        .unwrap();
    pa.set_current_member(&other.id).unwrap();
    assert_eq!(s.active_jam().unwrap().id, b.id);
    assert_eq!(s.current_member().unwrap().id, hb.id);
    assert_eq!(pa.current_member().unwrap().id, other.id);
    s.select_project(&a.id).unwrap();
    assert_eq!(s.current_member().unwrap().id, other.id);
}

#[test]
fn agent_idempotency_tokens_are_project_local_and_atomic() {
    let (_dir, s, a, ha) = fixture();
    let story_a = s.default_task_story(&ha.id).unwrap();
    let pa = s.for_project(&a.id).unwrap();
    let agent = pa.identify_agent("Shared planner", "codex").unwrap();
    let input_a = CreateTask {
        story_key: Some(story_a.key),
        title: "A retry".into(),
        idempotency_key: Some("plan-1".into()),
        ..Default::default()
    };
    let first = pa.create_task(&agent.id, input_a.clone()).unwrap();
    let (b, hb) = s
        .create_jam("Board B", None, None, None, "UTC", "Human B")
        .unwrap();
    let story_b = s.default_task_story(&hb.id).unwrap();
    let pb = s.for_project(&b.id).unwrap();
    let same = pb.identify_agent("Shared planner", "codex").unwrap();
    assert_eq!(agent.id, same.id);
    let input_b = CreateTask {
        story_key: Some(story_b.key),
        title: "B retry".into(),
        ..input_a.clone()
    };
    let second = pb.create_task(&same.id, input_b.clone()).unwrap();
    assert_ne!(first.task.key, second.task.key);
    assert_eq!(first.task.idempotency_key.as_deref(), Some("plan-1"));
    assert_eq!(second.task.idempotency_key.as_deref(), Some("plan-1"));
    let seq = s.latest_seq().unwrap();
    assert_eq!(
        pa.create_task(&agent.id, input_a).unwrap().task.key,
        first.task.key
    );
    assert_eq!(
        pb.create_task(&same.id, input_b).unwrap().task.key,
        second.task.key
    );
    assert_eq!(s.latest_seq().unwrap(), seq);
    let restarted = Store::open(&s.path).unwrap();
    assert_eq!(
        restarted
            .for_project(&a.id)
            .unwrap()
            .create_task(
                &agent.id,
                CreateTask {
                    title: "Ignored".into(),
                    idempotency_key: Some("plan-1".into()),
                    ..Default::default()
                }
            )
            .unwrap()
            .task
            .key,
        first.task.key
    );
}

#[test]
fn pending_change_wait_ends_if_its_pinned_project_is_archived() {
    let (_dir, s, a, ha) = fixture();
    let pa = Arc::new(s.for_project(&a.id).unwrap());
    let agent = pa.identify_agent("Waiting worker", "codex").unwrap();
    let cursor = s.latest_seq().unwrap();
    let watcher = thread::spawn(move || {
        pa.wait_for_changes(
            &agent.id,
            ChangesWaitInput {
                cursor,
                timeout_seconds: 2,
                exclude_self: false,
                epic_key: None,
                include_project: false,
                actions: None,
                actor_kind: None,
            },
        )
    });
    thread::sleep(Duration::from_millis(50));
    s.reset_jam(&ha.id, &a.name).unwrap();
    assert!(matches!(watcher.join().unwrap(), Err(Error::Archived(_))));
}

#[test]
fn assigning_a_shared_profile_joins_the_project_without_copying_presence() {
    let (_dir, s, a, _) = fixture();
    let pa = s.for_project(&a.id).unwrap();
    let agent = pa.identify_agent("Shared assignee", "codex").unwrap();
    pa.set_status(&agent.id, "Only A", None).unwrap();
    let (_, hb) = s
        .create_jam("Board B", None, None, None, "UTC", "Human B")
        .unwrap();
    let t = task(&s, &hb, "Assigned B");
    s.update_current_task(TaskEditInput {
        key: t.task.key,
        expected_updated_at: t.task.updated_at,
        patch: TaskPatch {
            assignee_id: Some(Some(agent.id.clone())),
            ..Default::default()
        },
    })
    .unwrap();
    let joined = s
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.id == agent.id)
        .unwrap();
    assert!(!joined.online);
    assert!(joined.member.status_text.is_empty());
    let direct = pa
        .identify_agent("Directly assigned profile", "codex")
        .unwrap();
    let second = task(&s, &hb, "Direct assignment B");
    s.assign_task(&hb.id, &second.task.key, Some(&direct.id))
        .unwrap();
    let export = s.export_jam().unwrap();
    assert!(export.members.iter().any(|m| m.id == direct.id));
    assert!(export.members.iter().any(|m| m.id == agent.id));
    s.import_jam_json(&hb.id, &serde_json::to_string(&export).unwrap())
        .unwrap();
}
