mod support;
use jam_core::*;
use std::sync::Arc;
use support::FreshContext;

fn setup() -> (tempfile::TempDir, Arc<Store>, Member, Member, Member, Story) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests-v21");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let s = Arc::new(Store::open(dir.path().join("jam.db")).unwrap());
    let (_, h) = s
        .create_jam("Lantern workshop", None, None, None, "UTC", "Danil")
        .unwrap();
    let brain = s.identify_agent("Claude", "claude-code").unwrap();
    let worker = s.identify_agent("Codex", "codex").unwrap();
    let e = s
        .create_epic(
            &h.id,
            NewEpic {
                title: "Lantern levels".into(),
                goal_md: Some("A readable lantern puzzle for keyboard players.".into()),
                done_when_md: Some("The bridge can be completed without guessing.".into()),
                ..Default::default()
            },
        )
        .unwrap();
    s.set_brain(&h.id, &e.key, &brain.handle).unwrap();
    s.set_epic_status(&h.id, &e.key, "active", None).unwrap();
    let story = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: e.key,
                title: "Light the bridge".into(),
                outcome_md: Some("The player can cross the bridge using a lantern.".into()),
                acceptance: Some(vec![Acceptance {
                    id: "1".into(),
                    criterion: "Cross the bridge with a keyboard".into(),
                    mandatory: true,
                    check: "Run the bridge playtest".into(),
                }]),
                ..Default::default()
            },
        )
        .unwrap();
    s.set_story_status(&h.id, &story.key, "active", None)
        .unwrap();
    support::start_story(&s, &h.id, &story.key);
    let story = s.get_story(&story.key).unwrap().story;
    (dir, s, h, brain, worker, story)
}
fn brief() -> TaskBrief {
    TaskBrief {
        goal_md: "Let the player identify the next safe tile.".into(),
        where_md: "game/lantern.gd and tests/lantern.test.gd".into(),
        changes: vec![Change {
            title: "Lantern tile cue".into(),
            required: "Highlight only the adjacent safe tile while the lantern is held.".into(),
            keep: "Preserve keyboard bindings and the paper palette.".into(),
            ..Default::default()
        }],
        tests: vec![BriefTest {
            setup: "Hold the lantern beside the first bridge tile.".into(),
            expected: "Exactly the adjacent safe tile lights up.".into(),
        }],
        result_md: "Report changed files, expected/actual tests, deviations and unverified checks."
            .into(),
        ..Default::default()
    }
}
fn create(s: &Store, h: &Member, story: &Story, status: &str) -> TaskDetail {
    s.create_task(
        &h.id,
        CreateTask {
            title: "Lantern tile cue".into(),
            story_key: Some(story.key.clone()),
            status: Some(status.into()),
            brief: brief(),
            ..Default::default()
        },
    )
    .unwrap()
}
#[test]
fn v01_fixture_migrates_without_losing_tasks_and_only_once() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests-v21");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let path = dir.path().join("jam.db");
    std::fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/v0.1.db"),
        &path,
    )
    .unwrap();
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/v0.1-expected.json")).unwrap();
    let seq;
    {
        let s = Store::open(&path).unwrap();
        let rows = s
            .query_tasks(TaskQuery {
                include_archived: Some(true),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(rows.total, 32);
        for old in expected["tasks"].as_array().unwrap() {
            let t = s.get_task(old["key"].as_str().unwrap()).unwrap();
            assert_eq!(t.task.title, old["title"]);
            assert_eq!(t.task.description_md, old["description_md"]);
            assert_eq!(
                t.task.status,
                if old["status"] == "todo" {
                    "backlog"
                } else {
                    old["status"].as_str().unwrap()
                }
            );
            assert!(!t.task.story_id.is_empty());
            assert_eq!(t.epic.title, "Imported tasks");
            assert_eq!(t.story.title, "Imported tasks");
        }
        seq = s.latest_seq().unwrap();
        let events = s.list_activity(None, Some(2000)).unwrap();
        let migrated = events
            .iter()
            .filter(|e| e.payload["migration"] == true)
            .collect::<Vec<_>>();
        assert_eq!(migrated.len(), 1);
        assert_eq!(migrated[0].payload["movedTasks"], 32);
        assert_eq!(migrated[0].payload["todoToBacklog"], 9);
    }
    let s = Store::open(&path).unwrap();
    assert_eq!(s.latest_seq().unwrap(), seq);
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        9
    );
    assert!(
        db.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none()
    );
    let not_null: i64 = db
        .query_row(
            "SELECT \"notnull\" FROM pragma_table_info('tasks') WHERE name='story_id'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(not_null, 1);
}
#[test]
fn readiness_codes_overrides_and_changes_cursor() {
    let (_d, s, h, brain, worker, story) = setup();
    let t = s
        .create_task(
            &h.id,
            CreateTask {
                title: "Draft".into(),
                story_key: Some(story.key.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    let r = s.check_ready(&t.task.key).unwrap();
    assert_eq!(
        r.missing
            .iter()
            .map(|i| i.code.as_str())
            .collect::<Vec<_>>(),
        ["goal", "where", "change", "test", "result"]
    );
    assert!(matches!(
        s.mark_ready_fresh(&worker.id, &t.task.key, None),
        Err(Error::NotReady(_))
    ));
    assert!(matches!(
        s.mark_ready_fresh(&worker.id, &t.task.key, Some("I want it")),
        Err(Error::Forbidden(_))
    ));
    let before = s.latest_seq().unwrap();
    s.mark_ready_fresh(
        &brain.id,
        &t.task.key,
        Some("Investigate the legacy prototype first."),
    )
    .unwrap();
    assert_eq!(s.activity_count().unwrap() - before, 1);
    let events = s.list_changes_since(before, Some(&t.epic.key)).unwrap();
    assert_eq!(events[0].action, "task.ready_override");
    s.claim_task_fresh(&worker.id, &t.task.key).unwrap();
    let cursor = s.latest_seq().unwrap();
    s.update_task_brief_fresh(
        &h.id,
        &t.task.key,
        BriefPatch {
            goal_md: Some("Use Danil's revised goal".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let changes = s.list_changes_since(cursor, Some(&t.epic.key)).unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].action, "task.brief_updated");
    assert_eq!(changes[0].payload["fields"], serde_json::json!(["goalMd"]));
}
#[test]
fn each_readiness_field_and_story_active_are_independent() {
    let (_d, s, h, _, _, story) = setup();
    let draft = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: s.get_epic(&story.epic_id).unwrap().epic.key,
                title: "Draft intent".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let t = create(&s, &h, &draft, "backlog");
    assert_eq!(
        s.check_ready(&t.task.key).unwrap().missing[0].code,
        "story_active"
    );
    let t = create(&s, &h, &story, "backlog");
    assert!(s.check_ready(&t.task.key).unwrap().ready);
    let cases = [
        (
            "goal",
            BriefPatch {
                goal_md: Some("".into()),
                ..Default::default()
            },
        ),
        (
            "where",
            BriefPatch {
                where_md: Some("".into()),
                ..Default::default()
            },
        ),
        (
            "change",
            BriefPatch {
                changes: Some(vec![]),
                ..Default::default()
            },
        ),
        (
            "test",
            BriefPatch {
                tests: Some(vec![]),
                ..Default::default()
            },
        ),
        (
            "result",
            BriefPatch {
                result_md: Some("".into()),
                ..Default::default()
            },
        ),
    ];
    for (code, patch) in cases {
        s.update_task_brief_fresh(
            &h.id,
            &t.task.key,
            BriefPatch {
                goal_md: Some(brief().goal_md),
                where_md: Some(brief().where_md),
                changes: Some(brief().changes),
                tests: Some(brief().tests),
                result_md: Some(brief().result_md),
                ..Default::default()
            },
        )
        .unwrap();
        s.update_task_brief_fresh(&h.id, &t.task.key, patch)
            .unwrap();
        let r = s.check_ready(&t.task.key).unwrap();
        assert_eq!(r.missing.len(), 1);
        assert_eq!(r.missing[0].code, code);
    }
}
fn report(key: &str) -> SubmitReport {
    SubmitReport {
        expected_claim_generation: String::new(),
        key: key.into(),
        summary_md: "Implemented the adjacent-tile lantern cue.".into(),
        changed_files: vec!["game/lantern.gd".into()],
        tests: vec![ReportTest {
            name: "2".into(),
            command: "godot --headless --script tests/lantern.test.gd".into(),
            expected: "Only the adjacent tile lights up".into(),
            actual: "Two tiles lit up".into(),
            result: "FAIL".into(),
        }],
        ..Default::default()
    }
}
#[test]
fn report_review_loop_permissions_and_rounds() {
    let (_d, s, h, brain, worker, story) = setup();
    let t = create(&s, &h, &story, "backlog");
    assert!(matches!(
        s.claim_task_fresh(&worker.id, &t.task.key),
        Err(Error::NotReady(_))
    ));
    s.mark_ready_fresh(&h.id, &t.task.key, None).unwrap();
    s.claim_task_fresh(&worker.id, &t.task.key).unwrap();
    assert!(matches!(
        s.claim_task_fresh(&brain.id, &t.task.key),
        Err(Error::ClaimConflict { .. })
    ));
    let r = s
        .submit_report_fresh(&worker.id, report(&t.task.key))
        .unwrap();
    assert_eq!(r.round, 0);
    assert_eq!(s.get_task(&t.task.key).unwrap().task.status, "review");
    s.set_brain(&h.id, "JB-E1", &worker.handle).unwrap();
    assert!(matches!(
        s.review_task_fresh(
            &worker.id,
            ReviewTask {
                expected_report_id: String::new(),
                expected_review_context_revision: String::new(),
                key: t.task.key.clone(),
                verdict: "accept".into(),
                ..Default::default()
            }
        ),
        Err(Error::Forbidden(_))
    ));
    s.set_brain(&h.id, "JB-E1", &brain.handle).unwrap();
    assert!(matches!(
        s.review_task_fresh(
            &worker.id,
            ReviewTask {
                expected_report_id: String::new(),
                expected_review_context_revision: String::new(),
                key: t.task.key.clone(),
                verdict: "accept".into(),
                ..Default::default()
            }
        ),
        Err(Error::Forbidden(_))
    ));
    s.review_task_fresh(
        &brain.id,
        ReviewTask {
            expected_report_id: String::new(),
            expected_review_context_revision: String::new(),
            key: t.task.key.clone(),
            verdict: "changes_requested".into(),
            comments_md: "Only the adjacent tile should light up.".into(),
            failed_tests: Some(vec!["2".into()]),
        },
    )
    .unwrap();
    let t = s.get_task(&t.task.key).unwrap();
    assert_eq!(t.task.status, "ready");
    assert!(t.task.changes_requested);
    assert_eq!(t.task.review_round, 1);
    assert_eq!(t.task.assignee_id.as_deref(), Some(worker.id.as_str()));
    assert!(matches!(s.review_task_fresh(&brain.id,ReviewTask {
        expected_report_id: String::new(),
        expected_review_context_revision: String::new(),
        key:t.task.key.clone(),verdict:"accept".into(),..Default::default()}),Err(Error::Validation{reason,..}) if reason=="No report for round 1"));
    s.claim_task_fresh(&worker.id, &t.task.key).unwrap();
    s.submit_report_fresh(&worker.id, report(&t.task.key))
        .unwrap();
    s.review_task_fresh(
        &brain.id,
        ReviewTask {
            expected_report_id: String::new(),
            expected_review_context_revision: String::new(),
            key: t.task.key.clone(),
            verdict: "accept".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let t = s.get_task(&t.task.key).unwrap();
    assert_eq!(t.task.status, "done");
    assert_eq!(t.reports.len(), 2);
    assert_eq!(t.reviews.len(), 2);
}
#[test]
fn status_rules_and_no_legacy_done_bypass() {
    let (_d, s, h, brain, worker, story) = setup();
    let t = create(&s, &h, &story, "ready");
    assert!(matches!(
        s.move_task_fresh(&worker.id, &t.task.key, "done", None, None),
        Err(Error::Forbidden(_))
    ));
    assert!(
        s.set_story_status(&brain.id, &story.key, "done", None)
            .is_err()
    );
    s.set_story_status(
        &brain.id,
        &story.key,
        "done",
        Some("The spike is deliberately left as follow-up."),
    )
    .unwrap();
    let e = s
        .create_epic(
            &h.id,
            NewEpic {
                title: "Draft".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        matches!(s.set_epic_status(&h.id,&e.key,"active",None),Err(Error::Validation{reason,..}) if reason.contains("goalMd")&&reason.contains("doneWhenMd"))
    );
    let st = s
        .create_story(
            &h.id,
            NewStory {
                epic_key: e.key.clone(),
                title: "Draft".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(matches!(
        s.set_story_status(&h.id, &st.key, "active", None),
        Err(Error::Validation { .. })
    ));
    assert!(s.set_epic_status(&h.id, &e.key, "done", None).is_err());
    s.set_epic_status(
        &h.id,
        &e.key,
        "done",
        Some("Scope cancelled after the interview."),
    )
    .unwrap();
}
#[test]
fn questions_wait_on_feed_without_writer_lock_and_timeout() {
    let (_d, s, h, _, worker, story) = setup();
    let t = create(&s, &h, &story, "ready");
    let q = s
        .ask_user(
            &worker.id,
            AskUser {
                scope: Scope {
                    kind: "task".into(),
                    id: t.task.key.clone(),
                },
                title: "Should the cue pulse?".into(),
                body_md: None,
                options: Some(vec![QuestionOption {
                    label: "Static".into(),
                    description: "Keep a steady cue".into(),
                }]),
                recommended_index: Some(0),
                allow_free_text: Some(true),
                round_label: Some("Round 1".into()),
            },
        )
        .unwrap();
    assert!(s.get_task(&t.task.key).unwrap().task.needs_info);
    assert!(matches!(
        s.answer_question(
            &worker.id,
            AnswerQuestion {
                id: q.id.clone(),
                answer_index: Some(0),
                answer_text: None
            }
        ),
        Err(Error::Forbidden(_))
    ));
    let waiter = s.clone();
    let ids = vec![q.id.clone()];
    let thread = std::thread::spawn(move || waiter.wait_for_answer(&ids, 5).unwrap());
    std::thread::sleep(std::time::Duration::from_millis(150));
    let answered = std::time::Instant::now();
    s.answer_question(
        &h.id,
        AnswerQuestion {
            id: q.id,
            answer_index: Some(0),
            answer_text: None,
        },
    )
    .unwrap();
    assert_eq!(thread.join().unwrap().answered.len(), 1);
    println!(
        "Answer commit to feed waiter: {} ms",
        answered.elapsed().as_millis()
    );
    assert!(answered.elapsed() < std::time::Duration::from_secs(1));
    assert!(!s.get_task(&t.task.key).unwrap().task.needs_info);
    let q = s
        .ask_user(
            &worker.id,
            AskUser {
                scope: Scope {
                    kind: "story".into(),
                    id: story.key,
                },
                title: "Which cue?".into(),
                body_md: None,
                options: None,
                recommended_index: None,
                allow_free_text: None,
                round_label: None,
            },
        )
        .unwrap();
    assert!(!s.get_task(&t.task.key).unwrap().task.needs_info);
    assert_eq!(s.get_task(&t.task.key).unwrap().ancestor_questions.len(), 1);
    let start = std::time::Instant::now();
    assert_eq!(
        s.wait_for_answer(std::slice::from_ref(&q.id), 2)
            .unwrap()
            .pending
            .len(),
        1
    );
    assert!(start.elapsed() >= std::time::Duration::from_millis(1950));
    println!("Question timeout: {} ms", start.elapsed().as_millis());
    s.withdraw_question(&h.id, &q.id).unwrap();
    assert!(!s.get_task(&t.task.key).unwrap().task.needs_info);
}
#[test]
fn references_are_local_atomic_archived_and_never_fetch_urls() {
    let (d, s, h, _, worker, story) = setup();
    let t = create(&s, &h, &story, "ready");
    let file = d.path().join("lantern.png");
    std::fs::write(&file, b"local test reference").unwrap();
    let n = s.activity_count().unwrap();
    let item = s
        .add_reference(
            &worker.id,
            AddReference {
                kind: "asset".into(),
                file_path: Some(file.to_string_lossy().into()),
                link_to: Some(t.task.key.clone()),
                tags: Some(vec![" Art ".into()]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(s.activity_count().unwrap(), n + 1);
    assert_eq!(item.tags, ["art"]);
    assert_eq!(s.get_task(&t.task.key).unwrap().references.len(), 1);
    assert_eq!(
        s.list_assets(None, None)
            .unwrap()
            .into_iter()
            .find(|a| Some(&a.id) == item.asset_id.as_ref())
            .unwrap()
            .role,
        "reference"
    );
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/reference", listener.local_addr().unwrap());
    s.add_reference(
        &worker.id,
        AddReference {
            kind: "link".into(),
            url: Some(url.clone()),
            title: Some("Palette".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    s.archive_reference(&worker.id, &item.audit.id).unwrap();
    assert!(
        s.list_references(None, None, Some(&t.task.key))
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        s.update_reference(&worker.id, &item.audit.id, ReferencePatch::default()),
        Err(Error::Archived(_))
    ));
}
#[test]
fn project_templates_and_agent_status() {
    let (_d, s, h, brain, _, story) = setup();
    s.update_project(&h.id, "webapp", Some("2026-11-01T10:00:00Z"))
        .unwrap();
    let p = s.get_project().unwrap();
    assert_eq!(p.jam.template, "webapp");
    assert!(p.tag_suggestions.contains(&"frontend".to_string()));
    let board = s.board(None).unwrap();
    assert!(board["jam"]["timeLeft"].is_null());
    let e = s.get_epic(&story.epic_id).unwrap().epic;
    s.set_status(
        &brain.id,
        "reviewing the bridge cue",
        Some(Scope {
            kind: "epic".into(),
            id: e.key,
        }),
    )
    .unwrap();
    let m = s.get_member(&brain.id).unwrap();
    assert_eq!(m.status_text, "reviewing the bridge cue");
    assert!(m.status_at.is_some());
    assert!(
        !s.list_members()
            .unwrap()
            .into_iter()
            .find(|m| m.member.id == brain.id)
            .unwrap()
            .status_stale
    );
    let old = (time::OffsetDateTime::now_utc() - time::Duration::minutes(31))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    rusqlite::Connection::open(&s.path)
        .unwrap()
        .execute(
            "UPDATE project_members SET status_at=? WHERE member_id=?",
            rusqlite::params![old, brain.id],
        )
        .unwrap();
    assert!(
        s.list_members()
            .unwrap()
            .iter()
            .find(|m| m.member.id == brain.id)
            .unwrap()
            .status_stale
    );
    let cleared = s.set_status(&brain.id, "  ", None).unwrap();
    assert!(cleared.status_text.is_empty() && cleared.status_scope.is_none());
}

#[test]
fn v2_demo_and_full_snapshot_roundtrip() {
    let (d, s, h, _, _, _) = setup();
    s.seed_demo().unwrap();
    let p = s.get_project().unwrap();
    assert_eq!(
        (p.epics, p.stories, p.tasks, p.open_questions),
        (2, 4, 22, 2)
    );
    let epics = s.list_epics().unwrap();
    let e = epics.iter().find(|e| e.title == "Lantern levels").unwrap();
    assert_eq!(e.status, "active");
    assert_eq!(e.worker_model.as_deref(), Some("gpt-6.1-sol"));
    let journal = s.epic_journal(&e.key, 0).unwrap();
    assert!((35..=45).contains(&journal.len()), "{}", journal.len());
    let tasks = s.query_tasks(TaskQuery::default()).unwrap().tasks;
    for t in &tasks {
        if t.status == "ready" {
            assert!(s.check_ready(&t.key).unwrap().ready);
        }
    }
    let changed = tasks.iter().find(|t| t.changes_requested).unwrap();
    assert_eq!(s.get_task(&changed.key).unwrap().reviews.len(), 1);
    let review = tasks.iter().find(|t| t.status == "review").unwrap();
    assert!(
        s.get_task(&review.key).unwrap().reports[0]
            .tests
            .iter()
            .any(|t| t.result == "FAIL")
    );
    let path = d.path().join("reference.png");
    std::fs::write(&path, b"local reference").unwrap();
    s.add_reference(
        &h.id,
        AddReference {
            kind: "asset".into(),
            file_path: Some(path.to_string_lossy().into()),
            link_to: Some(review.key.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    let exported = s.export_jam().unwrap();
    assert_eq!(exported.version, 2);
    let imported = s
        .import_jam_json(&h.id, &serde_json::to_string(&exported).unwrap())
        .unwrap();
    let prefix = imported.jam.unwrap().key_prefix;
    let t = s.get_task(&format!("{prefix}-9")).unwrap();
    assert_eq!(t.reports.len(), 1);
    assert_eq!(t.references.len(), 1);
    assert_eq!(
        s.list_assets(None, None)
            .unwrap()
            .iter()
            .filter(|a| a.role == "reference")
            .count(),
        1
    );
    assert_eq!(s.get_project().unwrap().tasks, 22);
    assert_eq!(s.list_questions(Some("open"), None).unwrap().len(), 2);
    assert_eq!(s.get_task(&format!("{prefix}-7")).unwrap().reviews.len(), 1);
}

#[test]
fn active_intents_nullable_model_restoration_and_invalid_import_are_checked() {
    let (_dir, s, h, _brain, _worker, story) = setup();
    let e = s.get_epic("JB-E1").unwrap().epic;
    assert!(
        s.update_epic(
            &h.id,
            &e.key,
            EpicPatch {
                goal_md: Some(" ".into()),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert!(
        s.update_story(
            &h.id,
            &story.key,
            StoryPatch {
                acceptance: Some(vec![]),
                ..Default::default()
            }
        )
        .is_err()
    );
    let patch: EpicPatch = serde_json::from_value(serde_json::json!({"workerModel":null})).unwrap();
    assert!(
        s.update_epic(&h.id, &e.key, patch)
            .unwrap()
            .worker_model
            .is_none()
    );
    s.set_story_status(&h.id, &story.key, "archived", None)
        .unwrap();
    s.set_story_status(&h.id, &story.key, "active", None)
        .unwrap();
    s.set_epic_status(&h.id, &e.key, "archived", None).unwrap();
    s.set_epic_status(&h.id, &e.key, "active", None).unwrap();
    support::start_story(&s, &h.id, &story.key);
    let t = create(&s, &h, &story, "backlog");
    let incomplete = s
        .create_task(
            &h.id,
            CreateTask {
                title: "Draft claim".into(),
                story_key: Some(story.key.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(matches!(
        s.claim_task_fresh(&h.id, &incomplete.task.key),
        Err(Error::NotReady(_))
    ));
    s.mark_ready_fresh(
        &h.id,
        &incomplete.task.key,
        Some("Explore the prototype before implementation"),
    )
    .unwrap();
    s.claim_task_fresh(&h.id, &incomplete.task.key).unwrap();
    let note = s
        .add_reference(
            &h.id,
            AddReference {
                kind: "note".into(),
                text: Some("Lantern study".into()),
                caption: Some("Keep the glow warm".into()),
                link_to: Some(t.task.key),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(note.caption_md, "Lantern study\n\nKeep the glow warm");
    let mut snapshot = s.export_jam().unwrap();
    snapshot.planning.as_mut().unwrap().reference_links[0].target_id = "missing".into();
    let before = s.activity_count().unwrap();
    assert!(matches!(
        s.import_jam_json(&h.id, &serde_json::to_string(&snapshot).unwrap()),
        Err(Error::Validation { .. })
    ));
    assert_eq!(s.activity_count().unwrap(), before);
}

#[test]
fn explicit_keys_keep_their_original_project_journal_and_archive_boundary() {
    let (_dir, s, h, _brain, _worker, story) = setup();
    let cursor = s.latest_seq().unwrap();
    s.create_jam("Another project", None, None, None, "UTC", "Danil")
        .unwrap();
    s.update_story(
        &h.id,
        &story.key,
        StoryPatch {
            preserve_md: Some("Keep the lantern cue".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        s.epic_journal("JB-E1", cursor)
            .unwrap()
            .iter()
            .any(|e| e.action == "story.updated")
    );
    assert!(
        !s.list_changes_since(cursor, None)
            .unwrap()
            .iter()
            .any(|e| e.action == "story.updated")
    );
    let db = rusqlite::Connection::open(&s.path).unwrap();
    db.execute(
        "UPDATE jams SET archived=1 WHERE id=?",
        [&story.audit.jam_id],
    )
    .unwrap();
    let count = s.activity_count().unwrap();
    assert!(matches!(
        s.update_story(
            &h.id,
            &story.key,
            StoryPatch {
                preserve_md: Some("Overwrite".into()),
                ..Default::default()
            }
        ),
        Err(Error::Archived(_))
    ));
    assert_eq!(s.activity_count().unwrap(), count);
    assert_eq!(
        s.get_story(&story.key).unwrap().story.preserve_md,
        "Keep the lantern cue"
    );
}

#[test]
fn accepted_work_can_reopen_without_losing_rounds_or_weakening_guards() {
    for use_patch in [false, true] {
        for changes_first in [false, true] {
            let (_d, s, h, brain, worker, story) = setup();
            let t = create(&s, &h, &story, "ready");
            let key = &t.task.key;
            let review = |verdict: &str| ReviewTask {
                expected_report_id: String::new(),
                expected_review_context_revision: String::new(),
                key: key.clone(),
                verdict: verdict.into(),
                comments_md: "Verified".into(),
                ..Default::default()
            };
            s.claim_task_fresh(&worker.id, key).unwrap();
            s.submit_report_fresh(&worker.id, report(key)).unwrap();
            if changes_first {
                s.review_task_fresh(&brain.id, review("changes_requested"))
                    .unwrap();
                s.claim_task_fresh(&worker.id, key).unwrap();
                s.submit_report_fresh(&worker.id, report(key)).unwrap();
            }
            s.review_task_fresh(&brain.id, review("accept")).unwrap();
            let before = s.get_task(key).unwrap();
            s.update_task_brief_fresh(
                &h.id,
                key,
                BriefPatch {
                    goal_md: Some(String::new()),
                    ..Default::default()
                },
            )
            .unwrap();
            let seq = s.latest_seq().unwrap();
            assert!(matches!(
                s.move_task_fresh(&h.id, key, "ready", None, None),
                Err(Error::NotReady(_))
            ));
            assert!(matches!(
                s.update_current_task(TaskEditInput {
                    key: key.clone(),
                    expected_updated_at: s.get_task(key).unwrap().task.updated_at,
                    patch: TaskPatch {
                        status: Some("ready".into()),
                        ..Default::default()
                    }
                }),
                Err(Error::NotReady(_))
            ));
            assert_eq!(s.latest_seq().unwrap(), seq);
            assert_eq!(
                s.get_task(key).unwrap().task.review_round,
                before.task.review_round
            );
            s.update_task_brief_fresh(
                &h.id,
                key,
                BriefPatch {
                    goal_md: Some(t.brief.goal_md.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
            s.move_task_fresh(&h.id, key, "done", None, None).unwrap();
            assert_eq!(
                s.get_task(key).unwrap().task.review_round,
                before.task.review_round
            );
            assert!(
                s.move_task_fresh(&h.id, key, "ready", Some("JB-99999"), None)
                    .is_err()
            );
            assert_eq!(
                s.get_task(key).unwrap().task.review_round,
                before.task.review_round
            );
            if use_patch {
                s.update_current_task(TaskEditInput {
                    key: key.clone(),
                    expected_updated_at: s.get_task(key).unwrap().task.updated_at,
                    patch: TaskPatch {
                        status: Some("ready".into()),
                        ..Default::default()
                    },
                })
                .unwrap();
            } else {
                s.move_task_fresh(&h.id, key, "ready", None, None).unwrap();
            }
            let round = before.task.review_round + 1;
            assert_eq!(s.get_task(key).unwrap().task.review_round, round);
            s.move_task_fresh(&h.id, key, "ready", None, None).unwrap();
            assert!(s.submit_report_fresh(&worker.id, report(key)).is_err());
            s.claim_task_fresh(&worker.id, key).unwrap();
            assert!(matches!(
                s.submit_report_fresh(&brain.id, report(key)),
                Err(Error::Forbidden(_))
            ));
            let second = s.submit_report_fresh(&worker.id, report(key)).unwrap();
            assert_eq!(second.round, round);
            assert!(s.submit_report_fresh(&worker.id, report(key)).is_err());
            assert!(matches!(
                s.review_task_fresh(&worker.id, review("accept")),
                Err(Error::Forbidden(_))
            ));
            s.review_task_fresh(&brain.id, review("accept")).unwrap();
            let after = s.get_task(key).unwrap();
            assert_eq!(after.task.status, "done");
            assert_eq!(after.task.review_round, round);
            assert_eq!(after.reports.len(), before.reports.len() + 1);
            assert_eq!(after.reviews.len(), before.reviews.len() + 1);
            for prior in &before.reports {
                assert_eq!(
                    serde_json::to_value(after.reports.iter().find(|r| r.id == prior.id).unwrap())
                        .unwrap(),
                    serde_json::to_value(prior).unwrap()
                );
            }
            for prior in &before.reviews {
                assert_eq!(
                    serde_json::to_value(after.reviews.iter().find(|r| r.id == prior.id).unwrap())
                        .unwrap(),
                    serde_json::to_value(prior).unwrap()
                );
            }
        }
    }
}
