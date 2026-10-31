//! Semantic guards and an opt-in, marked-fictional-fixture-only before/after probe.
mod volume_support;
use jam_core::*;
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::Write,
    path::Path,
    sync::{Arc, Barrier},
};
use volume_support::*;

fn matrix(p: &ProjectFixture, foreign: &ProjectFixture, handle: &str) -> Vec<Value> {
    let mut cases = vec![
        json!({}),
        json!({"status":[]}),
        json!({"status":["ready","backlog"]}),
    ];
    for status in STATUSES {
        cases.push(json!({"status":[status]}));
    }
    for assignee in ["unassigned", "me", handle, "UNKNOWN-HANDLE"] {
        cases.push(json!({"assignee":assignee}));
    }
    for tag in ["volume", " HOTSPOT \t", "lane-0", " МАЯК ", "missing", ""] {
        cases.push(json!({"tag":tag}));
    }
    for query in [
        "",
        "needle",
        "FICTIONAL",
        "МАЯК",
        "ΣΊΣΥΦΟΣ",
        "100%_literal",
        "missing",
    ] {
        cases.push(json!({"query":query}));
    }
    for limit in [1, 2, 50, 200] {
        cases.push(json!({"limit":limit}));
    }
    for cursor in ["0", "1", "49", "50", "199", "200", "9999"] {
        cases.push(json!({"cursor":cursor,"limit":2}));
    }
    cases.push(json!({"cursor":usize::MAX.to_string(),"limit":200}));
    for value in [false, true] {
        for field in ["ready", "changesRequested", "needsInfo", "includeArchived"] {
            cases.push(json!({field:value}));
        }
        cases.push(
            json!({"ready":value,"tag":"hotspot","includeArchived":true,"limit":2,"cursor":"1"}),
        );
    }
    for epic in [&p.epics[0].key, &p.epics[0].audit.id] {
        cases.push(json!({"epic":epic}));
    }
    for story in [&p.stories[0].key, &p.stories[0].audit.id] {
        cases.push(json!({"story":story}));
    }
    cases.push(json!({"epic":p.epics[0].key,"story":p.stories[2].key})); // valid but unrelated ancestors
    cases.push(json!({"story":p.stories[0].key,"ready":true,"status":["ready"],"tag":"volume","query":"fictional","assignee":"unassigned","needsInfo":false,"changesRequested":false,"cursor":"1","limit":2}));
    for (field, value) in [
        ("epic", &foreign.epics[0].audit.id),
        ("story", &foreign.stories[0].audit.id),
    ] {
        cases.push(json!({field:value}));
        cases.push(json!({field:value,"tag":"missing","cursor":"9999","ready":false}));
    }
    cases
}
fn outcome(result: Result<TaskPage>) -> Value {
    match result {
        Ok(page) => json!({"ok":page}),
        Err(error) => json!({"error":format!("{error:?}")}),
    }
}
// Independent reference over fully hydrated, immutable input, matching public semantics.
fn reference(
    p: &ProjectFixture,
    all: &[TaskSummary],
    members: &BTreeMap<String, String>,
    actor: Option<&str>,
    filter: TaskFilter,
) -> Result<TaskPage> {
    let epic = filter
        .epic
        .as_deref()
        .map(|k| p.store.get_epic(k).map(|v| v.epic.audit.id))
        .transpose()?;
    let story = filter
        .story
        .as_deref()
        .map(|k| p.store.get_story(k).map(|v| v.story.audit.id))
        .transpose()?;
    let mut rows = all
        .iter()
        .filter(|t| {
            epic.as_ref().is_none_or(|e| t.epic_id == *e)
                && story.as_ref().is_none_or(|s| t.story_id == *s)
                && filter.ready.is_none_or(|r| t.ready == r)
                && filter
                    .changes_requested
                    .is_none_or(|r| t.changes_requested == r)
                && filter.needs_info.is_none_or(|r| t.needs_info == r)
                && (filter.include_archived.unwrap_or(false) || t.archived_at.is_none())
                && filter
                    .status
                    .as_ref()
                    .is_none_or(|statuses| statuses.contains(&t.status))
                && filter.assignee.as_ref().is_none_or(|a| match a.as_str() {
                    "me" => actor.is_some() && t.assignee_id.as_deref() == actor,
                    "unassigned" => t.assignee_id.is_none(),
                    _ => t.assignee_id.as_ref().and_then(|id| members.get(id)) == Some(a),
                })
                && filter
                    .tag
                    .as_ref()
                    .is_none_or(|tag| t.tags.contains(&tag.trim().to_lowercase()))
                && filter.query.as_ref().is_none_or(|q| {
                    t.title.to_lowercase().contains(&q.to_lowercase())
                        || t.description_md.to_lowercase().contains(&q.to_lowercase())
                })
        })
        .cloned()
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.position.total_cmp(&b.position).then(a.key.cmp(&b.key)));
    let offset = filter
        .cursor
        .as_deref()
        .unwrap_or("0")
        .parse::<usize>()
        .unwrap();
    let limit = filter.limit.unwrap_or(50);
    let next_cursor = (offset.saturating_add(limit) < rows.len())
        .then(|| offset.saturating_add(limit).to_string());
    Ok(TaskPage {
        tasks: rows.into_iter().skip(offset).take(limit).collect(),
        next_cursor,
    })
}

// All persistent tables, including history/settings/schema. No domain mutation is used.
fn logical_snapshot(path: &Path) -> Vec<u8> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let schema = connection
        .prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    let mut tables = Vec::new();
    for (name, sql) in schema {
        let mut statement = connection
            .prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))
            .unwrap();
        let columns = statement
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let count = columns.len();
        let mut rows = statement
            .query_map([], |row| {
                Ok((0..count)
                    .map(|i| match row.get_ref(i).unwrap() {
                        ValueRef::Null => json!(["null"]),
                        ValueRef::Integer(v) => json!(["integer", v]),
                        ValueRef::Real(v) => json!(["real", v.to_bits()]),
                        ValueRef::Text(v) => match std::str::from_utf8(v) {
                            Ok(s) => json!(["text", s]),
                            Err(_) => json!(["text-bytes", v]),
                        },
                        ValueRef::Blob(v) => json!(["blob", v]),
                    })
                    .collect::<Vec<_>>())
            })
            .unwrap()
            .map(|r| serde_json::to_string(&r.unwrap()).unwrap())
            .collect::<Vec<_>>();
        rows.sort();
        tables.push(json!({"name":name,"sql":sql,"columns":columns,"rows":rows}));
    }
    serde_json::to_vec(&json!({"schemaVersion":connection.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),"tables":tables})).unwrap()
}

#[test]
fn list_page_matches_full_field_reference_for_all_defined_filters_and_actor_modes() {
    let f = Fixture::new(&[24, 12, 8]);
    let p = &f.projects[0];
    let agent = p.store.identify_agent("Paging agent", "codex").unwrap();
    p.store
        .assign_task(&p.human.id, &p.tasks[1].key, Some(&agent.id))
        .unwrap();
    p.store
        .assign_task(&p.human.id, &p.tasks[2].key, Some(&p.human.id))
        .unwrap();
    let detail = p.store.get_task(&p.tasks[3].key).unwrap();
    p.store
        .update_current_task(TaskEditInput {
            key: detail.task.key,
            expected_updated_at: detail.task.updated_at,
            patch: TaskPatch {
                title: Some("МАЯК Σίσυφος 100%_literal".into()),
                tags: Some(vec!["МАЯК".into(), "hotspot".into()]),
                ..Default::default()
            },
        })
        .unwrap();
    p.store
        .ask_user(
            &p.human.id,
            AskUser {
                scope: Scope {
                    kind: "task".into(),
                    id: p.tasks[0].key.clone(),
                },
                title: "Fictional clarification".into(),
                body_md: None,
                options: None,
                recommended_index: None,
                allow_free_text: Some(true),
                round_label: None,
            },
        )
        .unwrap();
    let before = logical_snapshot(&f.path);
    let all = p
        .store
        .query_tasks(TaskQuery {
            include_archived: Some(true),
            ..Default::default()
        })
        .unwrap()
        .tasks;
    let members = p
        .store
        .list_members()
        .unwrap()
        .into_iter()
        .map(|m| (m.member.id, m.member.handle))
        .collect::<BTreeMap<_, _>>();
    for actor in [None, Some(p.human.id.as_str()), Some(agent.id.as_str())] {
        for input in matrix(p, &f.projects[1], &agent.handle) {
            let filter: TaskFilter = serde_json::from_value(input.clone()).unwrap();
            assert_eq!(
                outcome(p.store.list_tasks(actor, filter.clone())),
                outcome(reference(p, &all, &members, actor, filter)),
                "actor={actor:?}, input={input}"
            );
        }
    }
    assert!(
        p.store
            .list_tasks(
                None,
                TaskFilter {
                    assignee: Some(agent.handle.to_uppercase()),
                    ..Default::default()
                }
            )
            .unwrap()
            .tasks
            .is_empty(),
        "Member handles remain case-sensitive"
    );
    for input in [
        json!({"limit":0}),
        json!({"limit":201}),
        json!({"status":["unknown"]}),
        json!({"cursor":"-1"}),
        json!({"cursor":"broken"}),
    ] {
        assert!(matches!(
            p.store
                .list_tasks(None, serde_json::from_value(input).unwrap()),
            Err(Error::Validation { .. })
        ));
    }
    assert_eq!(
        logical_snapshot(&f.path),
        before,
        "Every table, history row and setting remains unchanged by reads"
    );
}

#[test]
fn readiness_filters_match_rust_unicode_whitespace_with_complementary_counts_and_order() {
    let f = Fixture::new(&[8, 4, 4]);
    let p = &f.projects[0];
    let complete = p.store.get_task(&p.tasks[0].key).unwrap().brief;
    let whitespace = (0..=char::MAX as u32)
        .filter_map(char::from_u32)
        .filter(|c| c.is_whitespace());
    for c in whitespace {
        for field in ["goal", "where", "result", "padded"] {
            let mut brief = complete.clone();
            match field {
                "goal" => brief.goal_md = c.to_string(),
                "where" => brief.where_md = c.to_string(),
                "result" => brief.result_md = c.to_string(),
                _ => {
                    let text = format!("{c}Маяк 日本語{c}");
                    brief.goal_md = text.clone();
                    brief.where_md = text.clone();
                    brief.result_md = text.clone();
                    brief.changes[0].title = text.clone();
                    brief.changes[0].required = text.clone();
                    brief.tests[0].setup = text.clone();
                    brief.tests[0].expected = text;
                }
            }
            let created = p
                .store
                .create_task(
                    &p.human.id,
                    CreateTask {
                        story_key: Some(p.stories[0].key.clone()),
                        title: format!("Unicode U+{:04X} {field}", c as u32),
                        brief,
                        ..Default::default()
                    },
                )
                .unwrap()
                .task;
            assert_eq!(created.ready, field == "padded");
        }
    }
    // These are meaningful non-whitespace even though they may be visually subtle.
    for text in ["\u{200b}", "\u{feff}", "\u{180e}", "Маяк", "日本語"] {
        let mut brief = complete.clone();
        brief.goal_md = text.into();
        assert!(
            p.store
                .create_task(
                    &p.human.id,
                    CreateTask {
                        story_key: Some(p.stories[0].key.clone()),
                        title: "Meaningful Unicode".into(),
                        brief,
                        ..Default::default()
                    }
                )
                .unwrap()
                .task
                .ready
        );
    }
    let before = logical_snapshot(&f.path);
    let all = p.store.query_tasks(TaskQuery::default()).unwrap();
    let mut matched = 0;
    for ready in [false, true] {
        let table = p
            .store
            .query_tasks(TaskQuery {
                ready: Some(ready),
                ..Default::default()
            })
            .unwrap();
        let expected = all
            .tasks
            .iter()
            .filter(|t| t.ready == ready)
            .collect::<Vec<_>>();
        assert_eq!(table.total as usize, expected.len());
        assert_eq!(
            serde_json::to_value(&table.tasks).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
        matched += table.total;
        let mcp = p
            .store
            .list_tasks(
                None,
                TaskFilter {
                    ready: Some(ready),
                    limit: Some(200),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(mcp.next_cursor.is_none());
        let mut table_keys = table.tasks.iter().map(|t| &t.key).collect::<Vec<_>>();
        let mut mcp_keys = mcp.tasks.iter().map(|t| &t.key).collect::<Vec<_>>();
        table_keys.sort();
        mcp_keys.sort();
        assert_eq!(mcp_keys, table_keys);
    }
    assert_eq!(matched, all.total);
    assert_eq!(logical_snapshot(&f.path), before);
}

#[test]
fn readiness_accepts_nul_content_in_each_mandatory_field_without_new_validation() {
    let f = Fixture::new(&[4, 4, 4]);
    let p = &f.projects[0];
    let complete = p.store.get_task(&p.tasks[0].key).unwrap().brief;
    let mut created_keys = Vec::new();
    for text in ["\0", "\0abc", "abc\0", " \0 "] {
        for field in 0..7 {
            let mut brief = complete.clone();
            match field {
                0 => brief.goal_md = text.into(),
                1 => brief.where_md = text.into(),
                2 => brief.result_md = text.into(),
                3 => brief.changes[0].title = text.into(),
                4 => brief.changes[0].required = text.into(),
                5 => brief.tests[0].setup = text.into(),
                _ => brief.tests[0].expected = text.into(),
            }
            let created = p
                .store
                .create_task(
                    &p.human.id,
                    CreateTask {
                        story_key: Some(p.stories[0].key.clone()),
                        title: format!("NUL parity field {field}"),
                        brief,
                        ..Default::default()
                    },
                )
                .unwrap()
                .task;
            assert!(
                created.ready,
                "Rust readiness accepts non-whitespace NUL content"
            );
            created_keys.push(created.key);
        }
    }
    let all = p.store.query_tasks(TaskQuery::default()).unwrap();
    let mut total = 0;
    for ready in [true, false] {
        let page = p
            .store
            .query_tasks(TaskQuery {
                ready: Some(ready),
                ..Default::default()
            })
            .unwrap();
        let expected = all
            .tasks
            .iter()
            .filter(|t| t.ready == ready)
            .collect::<Vec<_>>();
        assert_eq!(page.total as usize, expected.len());
        assert_eq!(
            serde_json::to_value(&page.tasks).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
        total += page.total;
        if ready {
            assert!(
                created_keys
                    .iter()
                    .all(|key| page.tasks.iter().any(|t| &t.key == key))
            );
        }
    }
    assert_eq!(total, all.total);
}

#[test]
fn needs_info_only_counts_open_task_questions_in_the_pinned_project() {
    let f = Fixture::new(&[24, 8, 4]);
    let p = &f.projects[0];
    let ask = |project: &ProjectFixture, kind: &str, id: &str| {
        project
            .store
            .ask_user(
                &project.human.id,
                AskUser {
                    scope: Scope {
                        kind: kind.into(),
                        id: id.into(),
                    },
                    title: "Fictional question".into(),
                    body_md: None,
                    options: None,
                    recommended_index: None,
                    allow_free_text: Some(true),
                    round_label: None,
                },
            )
            .unwrap()
    };
    ask(p, "task", &p.tasks[0].key);
    let answered = ask(p, "task", &p.tasks[1].key);
    p.store
        .answer_question(
            &p.human.id,
            AnswerQuestion {
                id: answered.id,
                answer_index: None,
                answer_text: Some("Fictional answer".into()),
            },
        )
        .unwrap();
    let withdrawn = ask(p, "task", &p.tasks[2].key);
    p.store
        .withdraw_question(&p.human.id, &withdrawn.id)
        .unwrap();
    ask(p, "story", &p.stories[0].key);
    ask(&f.projects[1], "task", &f.projects[1].tasks[0].key);
    // Archived tasks participate only when includeArchived is explicitly requested.
    ask(p, "task", &p.tasks[3].key);
    p.store
        .archive_task(&p.human.id, &p.tasks[3].key, None, None)
        .unwrap();
    for archived in [false, true] {
        let page = p
            .store
            .list_tasks(
                None,
                TaskFilter {
                    needs_info: Some(true),
                    include_archived: Some(archived),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(page.tasks.len(), if archived { 2 } else { 1 });
        assert!(page.tasks.iter().all(|t| t.needs_info));
        let other = p
            .store
            .list_tasks(
                None,
                TaskFilter {
                    needs_info: Some(false),
                    include_archived: Some(archived),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(other.tasks.iter().all(|t| !t.needs_info));
    }
}

#[test]
fn imported_pending_rework_flag_filters_without_granting_execution() {
    let f = Fixture::new(&[8, 4, 4]);
    let p = &f.projects[0];
    let mut snapshot = serde_json::to_value(p.store.export_jam().unwrap()).unwrap();
    snapshot["tasks"][0]["changesRequested"] = json!(true);
    let imported = f
        .store
        .import_jam_json(&p.human.id, &snapshot.to_string())
        .unwrap()
        .jam
        .unwrap();
    let pinned = f.store.for_project(&imported.id).unwrap();
    let page = pinned
        .list_tasks(
            None,
            TaskFilter {
                changes_requested: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(page.tasks.len(), 1);
    assert!(page.tasks[0].changes_requested);
    assert!(
        pinned
            .list_execution()
            .unwrap()
            .iter()
            .all(|e| e.effective_state == ExecutionEffectiveState::Paused)
    );
}

#[test]
fn page_filter_and_hydration_share_one_read_snapshot_while_a_writer_changes_the_task() {
    let f = Fixture::new(&[24, 12, 8]);
    let p = &f.projects[0];
    let key = p.tasks[0].key.clone();
    let s = Store::open(&f.path)
        .unwrap()
        .for_project(&p.project.id)
        .unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let start = barrier.clone();
    let writer = std::thread::spawn(move || {
        start.wait();
        for i in 0..80 {
            let detail = s.get_task(&key).unwrap();
            let mut brief = detail.brief;
            brief.goal_md = if i % 2 == 0 {
                "Visible phase".into()
            } else {
                String::new()
            };
            s.update_current_task(TaskEditInput {
                key: key.clone(),
                expected_updated_at: detail.task.updated_at,
                patch: TaskPatch {
                    title: Some(if i % 2 == 0 {
                        "phase-a".into()
                    } else {
                        "phase-b".into()
                    }),
                    brief: Some(brief),
                    ..Default::default()
                },
            })
            .unwrap();
        }
    });
    barrier.wait();
    for _ in 0..80 {
        let page = p
            .store
            .list_tasks(
                None,
                TaskFilter {
                    query: Some("phase-a".into()),
                    ready: Some(true),
                    limit: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(page.tasks.iter().all(|t| t.title == "phase-a" && t.ready));
    }
    writer.join().unwrap();
}

#[test]
#[ignore = "explicit marked fictional DB only: JAM_VOLUME_COMPARE_DB=... JAM_VOLUME_COMPARE_PHASE=record|compare"]
fn compare_exact_retained_fictional_fixture() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.dev-data/volume")
        .canonicalize()
        .unwrap();
    let path = std::path::PathBuf::from(
        std::env::var_os("JAM_VOLUME_COMPARE_DB")
            .expect("Set an existing retained fictional fixture path"),
    )
    .canonicalize()
    .unwrap();
    assert!(
        path.starts_with(&root) && path.file_name().unwrap() == "fictional-volume.db",
        "Never open an arbitrary/live database"
    );
    let dir = path.parent().unwrap();
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(dir.join("fixture-manifest.json"))
            .expect("Explicit fictional fixture marker is required"),
    )
    .unwrap();
    assert_eq!(manifest["fictional"], true);
    let phase = std::env::var("JAM_VOLUME_COMPARE_PHASE").unwrap();
    assert!(["record", "compare"].contains(&phase.as_str()));
    // Refuse migration before Store::open. Only read APIs are called below; compare
    // every persistent table before/after because Store owns writable connections.
    let readonly = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        readonly
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        9
    );
    drop(readonly);
    let before = logical_snapshot(&path);
    let store = Store::open(&path).unwrap();
    let listed = store.list_projects(false).unwrap();
    assert_eq!(listed.len(), 3);
    let mut projects = Vec::new();
    for listed in listed {
        assert!(listed.jam.name.starts_with("Fictional volume project "));
        assert!(
            manifest["projects"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["id"] == listed.jam.id)
        );
        let pinned = store.for_project(&listed.jam.id).unwrap();
        let epics = pinned.list_epics().unwrap();
        let stories = epics
            .iter()
            .flat_map(|e| {
                pinned
                    .get_epic(&e.key)
                    .unwrap()
                    .stories
                    .into_iter()
                    .map(|s| s.story)
            })
            .collect();
        let tasks = pinned
            .query_tasks(TaskQuery {
                include_archived: Some(true),
                ..Default::default()
            })
            .unwrap()
            .tasks;
        assert!(
            pinned
                .list_execution()
                .unwrap()
                .iter()
                .all(|s| s.effective_state == ExecutionEffectiveState::Paused)
        );
        projects.push(ProjectFixture {
            human: pinned.current_member().unwrap(),
            store: pinned,
            project: listed.jam,
            epics,
            stories,
            tasks,
        });
    }
    projects.sort_by_key(|p| std::cmp::Reverse(p.tasks.len()));
    assert_eq!(
        projects.iter().map(|p| p.tasks.len()).collect::<Vec<_>>(),
        VOLUME_SIZES
    );
    let mut outputs = Vec::new();
    for (i, p) in projects.iter().enumerate() {
        for input in matrix(p, &projects[(i + 1) % projects.len()], &p.human.handle) {
            let filter = serde_json::from_value(input.clone()).unwrap();
            outputs.push(json!({"projectId":p.project.id,"actor":p.human.id,"filter":input,"result":outcome(p.store.list_tasks(Some(&p.human.id),filter))}));
        }
        for (label, filter) in [
            ("same_db.list_tasks.limit50", TaskFilter::default()),
            (
                "same_db.list_tasks.limit1",
                TaskFilter {
                    limit: Some(1),
                    ..Default::default()
                },
            ),
            (
                "same_db.list_tasks.ready_hotspot",
                TaskFilter {
                    ready: Some(true),
                    tag: Some("hotspot".into()),
                    ..Default::default()
                },
            ),
        ] {
            measure(label, p.tasks.len(), || {
                p.store.list_tasks(None, filter.clone()).unwrap()
            });
        }
    }
    let output = serde_json::to_vec(&outputs).unwrap();
    assert_eq!(
        logical_snapshot(&path),
        before,
        "Comparison helper is logically read-only, including all history/settings/schema"
    );
    let results_path = dir.join("paging-baseline-results.json");
    let database_path = dir.join("paging-baseline-logical-db.json");
    if phase == "record" {
        for (path, bytes) in [(results_path, &output), (database_path, &before)] {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .expect("Never overwrite baseline evidence")
                .write_all(bytes)
                .unwrap();
        }
    } else {
        assert_eq!(
            std::fs::read(database_path).unwrap(),
            before,
            "The original fictional fixture changed since baseline"
        );
        std::fs::write(dir.join("paging-after-results.json"), &output).unwrap();
        assert_eq!(
            std::fs::read(results_path).unwrap(),
            output,
            "Exact fields/order/cursor/errors must match baseline bytes"
        );
    }
    println!(
        "PAGING {}",
        json!({"phase":phase,"fixture":path,"matrixCases":outputs.len(),"serializedResultBytes":output.len(),"logicalDatabaseBytes":before.len(),"version":env!("CARGO_PKG_VERSION"),"debugAssertions":cfg!(debug_assertions),"logicalDatabaseUnchanged":true})
    );
}
