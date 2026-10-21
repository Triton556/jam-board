use jam_core::{ChangeFeed, CreateTask, Store};
use rmcp::{
    RoleClient, ServiceExt, model::*, service::RunningService, transport::TokioChildProcess,
};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

fn planning(s: &Store, h: &jam_core::Member) -> String {
    let e = s
        .create_epic(
            &h.id,
            jam_core::NewEpic {
                title: "Integration epic".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let story = s
        .create_story(
            &h.id,
            jam_core::NewStory {
                epic_key: e.key,
                title: "Integration story".into(),
                outcome_md: Some("Complete focused work".into()),
                acceptance: Some(vec![jam_core::Acceptance {
                    id: "1".into(),
                    criterion: "Focused tests pass".into(),
                    mandatory: true,
                    check: "Run tests".into(),
                }]),
                ..Default::default()
            },
        )
        .unwrap();
    s.set_story_status(&h.id, &story.key, "active", None)
        .unwrap();
    story.key
}
fn task_input(story: &str, title: &str) -> Value {
    json!({"storyKey":story,"title":title,"goalMd":"A precise lantern interaction","whereMd":"game/lantern.gd","changes":[{"title":"Cue","required":"Light the next safe tile"}],"tests":[{"setup":"Hold lantern at bridge","expected":"Next tile lights up"}],"resultMd":"Report changed files, tests, deviations and unverified checks"})
}
fn assert_tools(tools: &[Tool]) {
    let mut actual = tools.iter().map(|t| t.name.to_string()).collect::<Vec<_>>();
    actual.sort();
    assert_eq!(actual.len(), 40);
    let expected: Vec<String> =
        serde_json::from_str(include_str!("../../jam-mcp/tests/fixtures/tools-v2.json")).unwrap();
    assert_eq!(actual, expected);
    let wait = tools.iter().find(|t| t.name == "wait_for_changes").unwrap();
    assert_eq!(wait.input_schema["required"], json!(["cursor"]));
    assert_eq!(
        wait.input_schema["properties"]["timeoutSeconds"]["default"],
        30
    );
    assert!(wait.output_schema.is_some());
    let create = tools.iter().find(|t| t.name == "create_task").unwrap();
    assert_eq!(
        create.input_schema["properties"]["storyKey"]["type"],
        "string"
    );
    let questions = tools.iter().find(|t| t.name == "list_questions").unwrap();
    assert!(
        questions.input_schema["properties"]["status"]["enum"]
            .as_array()
            .unwrap()
            .contains(&json!("open"))
    );
}
fn fixture() -> (tempfile::TempDir, Arc<Store>, jam_core::Member) {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Arc::new(Store::open(d.path().join("jam.db")).unwrap());
    let (_, h) = s
        .create_jam("Integration jam", None, None, None, "UTC", "Danil")
        .unwrap();
    (d, s, h)
}
async fn client(db: &Path, name: &str) -> RunningService<RoleClient, ClientConfig> {
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_jam-board-mcp"));
    cmd.arg("--db").arg(db).env("JAM_AGENT_NAME", name);
    let transport = TokioChildProcess::new(cmd).unwrap();
    ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-integration-test", "1"),
    )
    .with_protocol_version(ProtocolVersion::V_2025_06_18)
    .serve(transport)
    .await
    .unwrap()
}
async fn call(
    c: &RunningService<RoleClient, ClientConfig>,
    tool: &str,
    args: Value,
) -> CallToolResult {
    c.call_tool(
        CallToolRequestParams::new(tool.to_string())
            .with_arguments(args.as_object().unwrap().clone()),
    )
    .await
    .unwrap()
}
fn data(r: CallToolResult) -> Value {
    assert_ne!(r.is_error, Some(true), "{:?}", r.content);
    r.structured_content.unwrap()
}
fn error(r: CallToolResult, code: &str) {
    assert_eq!(r.is_error, Some(true));
    assert_eq!(r.structured_content.as_ref().unwrap()["code"], code);
    assert!(format!("{:?}", r.content).contains(code), "{:?}", r.content);
}

#[tokio::test]
async fn worker_status_gates_through_stdio_leave_rejected_tasks_unchanged() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.dev-data/release-prep-20261021/stdio-repair-scenarios");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Store::open(d.path().join("jam.db")).unwrap();
    let (_, h) = s
        .create_jam("Repair wire", None, None, None, "UTC", "Human")
        .unwrap();
    let story = planning(&s, &h);
    let c = client(&s.path, "Repair worker").await;
    let worker = s
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.name == "Repair worker")
        .unwrap()
        .member;
    let t = s
        .create_task(
            &h.id,
            CreateTask {
                title: "Assigned incomplete backlog".into(),
                story_key: Some(story.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    let key = t.task.key;
    s.update_current_task(jam_core::TaskEditInput {
        key: key.clone(),
        expected_updated_at: t.task.updated_at,
        patch: jam_core::TaskPatch {
            assignee_id: Some(Some(worker.id)),
            ..Default::default()
        },
    })
    .unwrap();
    let before = serde_json::to_value(s.get_task(&key).unwrap()).unwrap();
    let seq = s.latest_seq().unwrap();
    error(
        call(&c, "claim_task", json!({"key":key})).await,
        "not_ready",
    );
    for name in ["move_task", "release_task"] {
        error(
            call(&c, name, json!({"key":key,"status":"in_progress"})).await,
            "forbidden",
        );
    }
    error(
        call(
            &c,
            "submit_report",
            json!({"key":key,"summaryMd":"Bypass","changedFiles":[],"tests":[]}),
        )
        .await,
        "wrong_status",
    );
    error(
        call(&c, "update_task", json!({"key":key,"status":"in_progress"})).await,
        "validation",
    );
    error(
        call(
            &c,
            "create_task",
            json!({"storyKey":story,"title":"Bypass","status":"in_progress"}),
        )
        .await,
        "forbidden",
    );
    assert_eq!(
        serde_json::to_value(s.get_task(&key).unwrap()).unwrap(),
        before
    );
    assert_eq!(s.latest_seq().unwrap(), seq);
    let valid = data(call(&c, "create_task", task_input(&story, "Complete Ready task")).await);
    let key = valid["key"].as_str().unwrap();
    data(call(&c, "mark_ready", json!({"key":key})).await);
    error(
        call(&c, "move_task", json!({"key":key,"status":"in_progress"})).await,
        "forbidden",
    );
    data(call(&c, "claim_task", json!({"key":key})).await);
    data(
        call(
            &c,
            "submit_report",
            json!({"key":key,"summaryMd":"Valid work","changedFiles":[],"tests":[]}),
        )
        .await,
    );
    c.cancel().await.unwrap();
}

#[tokio::test]
async fn full_stdio_contract_and_errors() {
    let (_d, s, h) = fixture();
    let c = client(&s.path, "Codex").await;
    let info = c.peer_info().unwrap();
    let instructions = info.instructions.as_deref().unwrap();
    assert!(instructions.contains("Ready") && instructions.contains("submit_report"));
    assert!(instructions.contains("human") && instructions.contains("appointed brain"));
    assert!(!instructions.contains("comment with results"));
    let tools = c.list_all_tools().await.unwrap();
    assert_tools(&tools);
    let story = planning(&s, &h);
    assert!(tools.iter().any(|t| t.name == "create_task"));
    let mut input = task_input(&story, "Add jump buffer");
    input["priority"] = json!("high");
    input["tags"] = json!([" GAMEPLAY ", "gameplay"]);
    input["idempotencyKey"] = json!("m2-1");
    let t = data(call(&c, "create_task", input.clone()).await);
    let key = t["key"].as_str().unwrap();
    assert_eq!(t["tags"], json!(["gameplay"]));
    let n = s.activity_count().unwrap();
    assert_eq!(data(call(&c, "create_task", input).await)["id"], t["id"]);
    assert_eq!(s.activity_count().unwrap(), n);
    data(call(&c, "mark_ready", json!({"key":key})).await);
    let page = data(call(&c, "list_tasks", json!({"query":"jump buffer"})).await);
    assert_eq!(page["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(
        data(call(&c, "claim_task", json!({"key":key})).await)["status"],
        "in_progress"
    );
    let other = client(&s.path, "Other agent").await;
    error(
        call(&other, "claim_task", json!({"key":key})).await,
        "claim_conflict",
    );
    assert_eq!(
        {
            data(call(&c, "submit_report", json!({"key":key,"summaryMd":"Implemented jump buffering","changedFiles":[],"tests":[]})).await);
            s.get_task(key).unwrap().task.status
        },
        "review"
    );
    data(
        call(
            &c,
            "add_comment",
            json!({"key":key,"body":"Implemented and tested jump buffering."}),
        )
        .await,
    );
    let detail = data(call(&c, "get_task", json!({"key":key})).await);
    assert_eq!(detail["comments"].as_array().unwrap().len(), 1);
    assert_eq!(detail["activity"].as_array().unwrap().len(), 5);
    error(
        call(&c, "get_task", json!({"key":"JB-99999"})).await,
        "not_found",
    );
    error(
        call(
            &c,
            "create_task",
            json!({"title":"Bad priority","priority":"urgent"}),
        )
        .await,
        "validation",
    );
    error(
        call(&c, "update_task", json!({"key":key,"priority":"urgent"})).await,
        "validation",
    );
    let updated = data(
        call(
            &c,
            "update_task",
            json!({"key":key,"estimate":5,"dueAt":"2026-11-01T00:00:00Z"}),
        )
        .await,
    );
    assert_eq!(updated["estimate"], 5);
    assert!(
        data(
            call(
                &c,
                "update_task",
                json!({"key":key,"estimate":null,"dueAt":null})
            )
            .await
        )["estimate"]
            .is_null()
    );
    assert_eq!(
        data(call(&c, "release_task", json!({"key":key})).await)["status"],
        "backlog"
    );
    assert_eq!(
        data(call(&c, "get_board", json!({})).await)["jam"]["name"],
        "Integration jam"
    );
    assert!(
        !data(call(&c, "list_members", json!({})).await)
            .as_array()
            .unwrap()
            .is_empty()
    );
    s.create_asset(&h.id, "sprite", "Player", "assets/player.png", None)
        .unwrap();
    assert_eq!(
        data(call(&c, "list_assets", json!({"kind":"sprite"})).await)
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(c.list_all_resources().await.unwrap().len(), 1);
    assert_eq!(
        c.list_all_resource_templates()
            .await
            .unwrap()
            .into_iter()
            .find(|r| r.uri_template == "jam://task/{key}")
            .unwrap()
            .uri_template,
        "jam://task/{key}"
    );
    let resource = c
        .read_resource(ReadResourceRequestParams::new(format!("jam://task/{key}")))
        .await
        .unwrap();
    assert!(
        serde_json::to_string(&resource)
            .unwrap()
            .contains("Implemented and tested")
    );
    let resource = c
        .read_resource(ReadResourceRequestParams::new("jam://board"))
        .await
        .unwrap();
    assert!(
        serde_json::to_string(&resource)
            .unwrap()
            .contains("Integration jam")
    );
    assert_eq!(c.list_all_prompts().await.unwrap().len(), 3);
    let prompt = c
        .get_prompt(
            GetPromptRequestParams::new("work_on_next_task").with_arguments(
                serde_json::Map::from_iter([("tag".into(), json!("gameplay"))]),
            ),
        )
        .await
        .unwrap();
    assert!(serde_json::to_string(&prompt).unwrap().contains("gameplay"));
    data(
        call(
            &c,
            "archive_task",
            json!({"key":key,"reason":"Done in another task"}),
        )
        .await,
    );
    error(
        call(&c, "update_task", json!({"key":key,"title":"Forbidden"})).await,
        "archived",
    );
    assert!(data(call(&c, "get_task", json!({"key":key})).await)["archivedAt"].is_string());
    // The same process remains healthy after all tool errors.
    data(call(&c, "get_board", json!({})).await);
    other.cancel().await.unwrap();
    c.cancel().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 6)]
async fn four_application_writers_and_stdio_process_1000_mutations() {
    let (_d, s, h) = fixture();
    let c = client(&s.path, "Stress agent").await;
    data(call(&c, "get_board", json!({})).await);
    let story = planning(&s, &h);
    let baseline = s.activity_count().unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(5));
    let mut threads = Vec::new();
    for worker in 0..4 {
        let s = s.clone();
        let actor = h.id.clone();
        let story = story.clone();
        let barrier = barrier.clone();
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            for i in 0..200 {
                if i % 3 == 0 {
                    s.create_epic(
                        &actor,
                        jam_core::NewEpic {
                            title: format!("App {worker} epic {i}"),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                } else if i % 3 == 1 {
                    s.create_story(
                        &actor,
                        jam_core::NewStory {
                            epic_key: "JB-E1".into(),
                            title: format!("App {worker} story {i}"),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                } else {
                    s.create_task(
                        &actor,
                        CreateTask {
                            title: format!("App {worker} task {i}"),
                            story_key: Some(story.clone()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                }
            }
        }));
    }
    barrier.wait();
    for i in 0..200 {
        match i % 3 {
            0 => {
                data(call(&c, "create_epic", json!({"title":format!("MCP epic {i}")})).await);
            }
            1 => {
                data(
                    call(
                        &c,
                        "create_story",
                        json!({"epicKey":"JB-E1","title":format!("MCP story {i}")}),
                    )
                    .await,
                );
            }
            _ => {
                data(
                    call(
                        &c,
                        "create_task",
                        json!({"storyKey":story,"title":format!("MCP task {i}")}),
                    )
                    .await,
                );
            }
        }
    }
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(s.activity_count().unwrap() - baseline, 1000);
    assert_eq!(s.active_jam().unwrap().task_seq, 330);
    assert_eq!(s.list_epics().unwrap().len(), 336);
    c.cancel().await.unwrap();
}

#[tokio::test]
async fn stdio_write_reaches_external_feed_in_one_second() {
    let (_d, s, h) = fixture();
    let story = planning(&s, &h);
    let c = client(&s.path, "Feed agent").await;
    data(call(&c, "get_board", json!({})).await);
    let mut feed = ChangeFeed::open(&s.path, s.latest_seq().unwrap()).unwrap();
    let start = Instant::now();
    let t = data(call(&c, "create_task", task_input(&story, "Live from MCP")).await);
    let mut interval = tokio::time::interval(Duration::from_millis(250));
    let events = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            interval.tick().await;
            if feed.data_changed().unwrap() {
                let events = feed.poll().unwrap();
                if !events.is_empty() {
                    break events;
                }
            }
        }
    })
    .await
    .unwrap();
    assert!(start.elapsed() <= Duration::from_secs(1));
    assert!(
        events
            .iter()
            .any(|e| e.task_key.as_deref() == t["key"].as_str() && e.actor.kind == "agent")
    );
    println!(
        "Cross-process feed latency: {} ms",
        start.elapsed().as_millis()
    );
    c.cancel().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_v2_tool_success_and_error_through_stdio() {
    let (dir, s, h) = fixture();
    let brain = client(&s.path, "Claude").await;
    let worker = client(&s.path, "Codex").await;
    assert_tools(&brain.list_all_tools().await.unwrap());
    data(call(&brain, "get_project", json!({})).await);
    data(call(&brain, "list_epics", json!({})).await);
    let e=data(call(&brain,"create_epic",json!({"title":"Lantern levels","goalMd":"Cross the bridge","doneWhenMd":"Keyboard playtest passes","workerModel":"gpt-6.1-sol"})).await);
    let ek = e["key"].as_str().unwrap();
    data(call(&brain, "become_brain", json!({"epicKey":ek})).await);
    let occupied = call(&worker, "become_brain", json!({"epicKey":ek})).await;
    assert!(format!("{:?}", occupied.content).contains("Claude"));
    error(occupied, "forbidden");
    data(
        call(
            &brain,
            "set_brain",
            json!({"epicKey":ek,"memberHandle":"claude"}),
        )
        .await,
    );
    data(
        call(
            &brain,
            "update_epic",
            json!({"key":ek,"decidedMd":"Keep keyboard controls"}),
        )
        .await,
    );
    data(
        call(
            &brain,
            "set_epic_status",
            json!({"key":ek,"status":"active"}),
        )
        .await,
    );
    let story=data(call(&brain,"create_story",json!({"epicKey":ek,"title":"Light the bridge","outcomeMd":"Identify safe tiles","acceptance":[{"id":"1","criterion":"Adjacent safe tile lights up","mandatory":true,"check":"Bridge playtest"}]})).await);
    let sk = story["key"].as_str().unwrap();
    data(
        call(
            &brain,
            "update_story",
            json!({"key":sk,"preserveMd":"Keep keyboard bindings"}),
        )
        .await,
    );
    data(
        call(
            &brain,
            "set_story_status",
            json!({"key":sk,"status":"active"}),
        )
        .await,
    );
    let task = data(call(&brain, "create_task", task_input(sk, "Light the next tile")).await);
    let key = task["key"].as_str().unwrap();
    data(
        call(
            &brain,
            "update_task_brief",
            json!({"key":key,"contextMd":"The bridge scene already exists"}),
        )
        .await,
    );
    assert_eq!(
        data(call(&brain, "check_ready", json!({"key":key})).await)["ready"],
        true
    );
    data(call(&brain, "mark_ready", json!({"key":key})).await);
    data(call(&worker, "claim_task", json!({"key":key})).await);
    data(
        call(
            &worker,
            "set_status",
            json!({"text":format!("implementing {key}"),"scope":{"type":"task","id":key}}),
        )
        .await,
    );
    let report = json!({"key":key,"summaryMd":"Implemented lantern cue","changedFiles":["game/lantern.gd"],"tests":[{"name":"2","command":"godot --headless --script tests/bridge.gd","expected":"One tile lights up","actual":"Two tiles light up","result":"FAIL"}]});
    data(call(&worker, "submit_report", report.clone()).await);
    error(
        call(
            &worker,
            "review_task",
            json!({"key":key,"verdict":"accept","commentsMd":"Self review"}),
        )
        .await,
        "forbidden",
    );
    data(call(&brain,"review_task",json!({"key":key,"verdict":"changes_requested","commentsMd":"Only one tile should light up","failedTests":["2"]})).await);
    data(call(&worker, "claim_task", json!({"key":key})).await);
    let mut report = report;
    report["tests"][0]["actual"] = json!("One tile lights up");
    report["tests"][0]["result"] = json!("PASS");
    data(call(&worker, "submit_report", report).await);
    data(
        call(
            &brain,
            "review_task",
            json!({"key":key,"verdict":"accept","commentsMd":"Acceptance checked"}),
        )
        .await,
    );
    let q=data(call(&brain,"ask_user",json!({"scope":{"type":"epic","id":ek},"title":"Keep keyboard controls?","options":[{"label":"Keep","description":"Preserve existing bindings"}],"recommendedIndex":0,"roundLabel":"Round 1"})).await);
    let qid = q["id"].as_str().unwrap();
    data(call(&brain, "list_questions", json!({"status":"open"})).await);
    let waiter = call(
        &brain,
        "wait_for_answer",
        json!({"questionIds":[qid],"timeoutSeconds":2}),
    );
    let answer = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        s.answer_question(
            &h.id,
            jam_core::AnswerQuestion {
                id: qid.into(),
                answer_index: Some(0),
                answer_text: None,
            },
        )
        .unwrap();
    };
    let start = Instant::now();
    let (result, ()) = tokio::join!(waiter, answer);
    assert_eq!(data(result)["answered"].as_array().unwrap().len(), 1);
    assert!(start.elapsed() < Duration::from_secs(1));
    let q = data(
        call(
            &brain,
            "ask_user",
            json!({"scope":{"type":"task","id":key},"title":"Should snow sparkle?"}),
        )
        .await,
    );
    data(call(&brain, "withdraw_question", json!({"id":q["id"]})).await);
    let path = dir.path().join("reference.txt");
    std::fs::write(&path, "Lantern reference").unwrap();
    let r = data(
        call(
            &brain,
            "add_reference",
            json!({"kind":"asset","filePath":path,"title":"Lantern","linkTo":key,"frameEpicKey":ek}),
        )
        .await,
    );
    let id = r["id"].as_str().unwrap();
    let second = data(
        call(
            &brain,
            "add_reference",
            json!({"kind":"note","text":"One warm tile, readable snow","frameEpicKey":ek}),
        )
        .await,
    );
    assert_eq!(r["frameId"], second["frameId"]);
    assert_eq!(
        s.list_ref_frames()
            .unwrap()
            .iter()
            .filter(|f| f.epic_id.as_deref() == e["id"].as_str())
            .count(),
        1
    );
    data(
        call(
            &brain,
            "link_reference",
            json!({"itemId":id,"targetKey":sk}),
        )
        .await,
    );
    data(
        call(
            &brain,
            "update_reference",
            json!({"itemId":id,"caption":"Keep a warm glow","tags":[" LIGHT "]}),
        )
        .await,
    );
    assert_eq!(
        data(call(&brain, "list_references", json!({"taskKey":key})).await)
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let cursor = s.latest_seq().unwrap();
    s.update_task_brief(
        &h.id,
        key,
        jam_core::BriefPatch {
            boundaries_md: Some("Do not change controls".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let changes = data(
        call(
            &brain,
            "list_changes_since",
            json!({"cursor":cursor,"epicKey":ek}),
        )
        .await,
    );
    assert_eq!(changes[0]["action"], "task.brief_updated");
    assert_eq!(changes[0]["payload"]["fields"], json!(["boundariesMd"]));
    let tree = data(call(&brain, "get_epic", json!({"key":ek})).await);
    assert_eq!(tree["stories"].as_array().unwrap().len(), 1);
    for (tool, args, code) in [
        ("get_project", json!({"unexpected":1}), "validation"),
        ("list_epics", json!({"unexpected":1}), "validation"),
        ("get_epic", json!({"key":"missing"}), "not_found"),
        ("create_epic", json!({"title":""}), "validation"),
        ("update_epic", json!({"key":ek,"color":"red"}), "validation"),
        (
            "set_epic_status",
            json!({"key":ek,"status":"invalid"}),
            "validation",
        ),
        ("become_brain", json!({"epicKey":"missing"}), "not_found"),
        (
            "set_brain",
            json!({"epicKey":ek,"memberHandle":"missing"}),
            "not_found",
        ),
        (
            "create_story",
            json!({"epicKey":ek,"title":""}),
            "validation",
        ),
        ("update_story", json!({"key":sk,"title":""}), "validation"),
        (
            "set_story_status",
            json!({"key":sk,"status":"invalid"}),
            "validation",
        ),
        (
            "update_task_brief",
            json!({"key":key,"changes":[{"title":"Bad","required":""}]}),
            "validation",
        ),
        ("check_ready", json!({"key":"missing"}), "not_found"),
        ("mark_ready", json!({"key":"missing"}), "not_found"),
        (
            "submit_report",
            json!({"key":key,"summaryMd":"","changedFiles":[],"tests":[]}),
            "forbidden",
        ),
        (
            "review_task",
            json!({"key":key,"verdict":"invalid","commentsMd":""}),
            "wrong_status",
        ),
        (
            "ask_user",
            json!({"scope":{"type":"task","id":key},"title":""}),
            "validation",
        ),
        (
            "wait_for_answer",
            json!({"questionIds":[qid],"timeoutSeconds":61}),
            "validation",
        ),
        ("list_questions", json!({"status":"invalid"}), "validation"),
        ("withdraw_question", json!({"id":"missing"}), "not_found"),
        ("set_status", json!({"text":"x".repeat(121)}), "validation"),
        ("list_changes_since", json!({"cursor":-1}), "validation"),
        (
            "add_reference",
            json!({"kind":"link","url":"ftp://invalid"}),
            "validation",
        ),
        ("list_references", json!({"taskKey":"missing"}), "not_found"),
        (
            "link_reference",
            json!({"itemId":id,"targetKey":"missing"}),
            "not_found",
        ),
        (
            "update_reference",
            json!({"itemId":id,"title":""}),
            "validation",
        ),
    ] {
        error(call(&brain, tool, args).await, code);
    }
    for uri in [
        format!("jam://epic/{ek}"),
        format!("jam://story/{sk}"),
        format!("jam://task/{key}"),
    ] {
        brain
            .read_resource(ReadResourceRequestParams::new(uri))
            .await
            .unwrap();
    }
    for name in ["plan_epic", "work_on_next_task", "review_task"] {
        let prompt = brain
            .get_prompt(GetPromptRequestParams::new(name))
            .await
            .unwrap();
        assert!(!prompt.messages.is_empty());
    }
    worker.cancel().await.unwrap();
    brain.cancel().await.unwrap();
}

#[tokio::test]
async fn brain_session_journal_has_exact_ordered_sentences() {
    let (_dir, s, h) = fixture();
    let brain = client(&s.path, "Claude").await;
    let worker = client(&s.path, "Codex").await;
    data(
        call(
            &brain,
            "set_status",
            json!({"text":"interviewing about lantern levels"}),
        )
        .await,
    );
    for title in ["Audience?", "Controls?", "Time budget?"] {
        let q = data(
            call(
                &brain,
                "ask_user",
                json!({"scope":{"type":"project","id":""},"title":title,"roundLabel":"Round 1"}),
            )
            .await,
        );
        s.answer_question(
            &h.id,
            jam_core::AnswerQuestion {
                id: q["id"].as_str().unwrap().into(),
                answer_index: None,
                answer_text: Some("Keep the cozy keyboard game".into()),
            },
        )
        .unwrap();
    }
    data(call(&brain,"create_epic",json!({"title":"Lantern levels","goalMd":"A cozy keyboard game","doneWhenMd":"Cross both bridges"})).await);
    data(call(&brain, "become_brain", json!({"epicKey":"JB-E1"})).await);
    let mut expected = vec![
        "Claude created epic JB-E1 · Lantern levels".to_string(),
        "Claude updated JB-E1 · brainMemberId".into(),
    ];
    for i in 1..=2 {
        data(call(&brain,"create_story",json!({"epicKey":"JB-E1","title":format!("Bridge {i}"),"outcomeMd":"Cross safely","acceptance":[{"id":"1","criterion":"Cross bridge","mandatory":true,"check":"Keyboard playtest"}]})).await);
        data(
            call(
                &brain,
                "set_story_status",
                json!({"key":format!("JB-S{i}"),"status":"active"}),
            )
            .await,
        );
        expected.push(format!("Claude created story JB-S{i} · Bridge {i}"));
        expected.push(format!("Claude set JB-S{i} to active"));
    }
    for i in 1..=4 {
        data(
            call(
                &brain,
                "create_task",
                task_input(
                    if i <= 2 { "JB-S1" } else { "JB-S2" },
                    &format!("Lantern cue {i}"),
                ),
            )
            .await,
        );
        expected.push(format!("Claude created JB-{i} · Lantern cue {i}"));
    }
    for i in 1..=4 {
        data(call(&brain, "mark_ready", json!({"key":format!("JB-{i}")})).await);
        expected.push(format!("Claude moved JB-{i} to Ready"));
    }
    data(call(&worker, "claim_task", json!({"key":"JB-1"})).await);
    expected.push("Codex claimed JB-1".into());
    data(call(&worker,"submit_report",json!({"key":"JB-1","summaryMd":"Cue is ready","changedFiles":["game/lantern.gd"],"tests":[{"name":"2","command":"playtest","expected":"One tile","actual":"Two tiles","result":"FAIL"}]})).await);
    expected.push("Codex submitted a report for JB-1".into());
    data(call(&brain,"review_task",json!({"key":"JB-1","verdict":"changes_requested","commentsMd":"One tile only","failedTests":["2"]})).await);
    expected.push("Claude returned JB-1: tests 2 failed".into());
    let journal = s.epic_journal("JB-E1", 0).unwrap();
    assert_eq!(
        journal
            .iter()
            .map(|e| e.sentence.clone())
            .collect::<Vec<_>>(),
        expected
    );
    let prelude = s
        .list_changes_since(0, None)
        .unwrap()
        .into_iter()
        .filter(|a| {
            a.action == "question.asked"
                || a.action == "question.answered"
                || a.action == "agent.status"
        })
        .collect::<Vec<_>>();
    assert_eq!(prelude.len(), 7);
    assert!(prelude.iter().all(|a| a.epic_id.is_none()));
    worker.cancel().await.unwrap();
    brain.cancel().await.unwrap();
}

#[tokio::test]
async fn wait_for_changes_stdio_contract_and_cross_process_report_latency() {
    let (_dir, s, h) = fixture();
    let brain = client(&s.path, "Waiting brain").await;
    let worker = client(&s.path, "Reporting worker").await;
    let story = planning(&s, &h);
    let task = data(
        call(
            &worker,
            "create_task",
            task_input(&story, "Report wake test"),
        )
        .await,
    );
    let key = task["key"].as_str().unwrap();
    data(call(&worker, "mark_ready", json!({"key":key})).await);
    data(call(&worker, "claim_task", json!({"key":key})).await);
    for args in [
        json!({}),
        json!({"cursor":0,"timeoutSeconds":0}),
        json!({"cursor":0,"timeoutSeconds":61}),
        json!({"cursor":0,"actions":["report.unknown"]}),
        json!({"cursor":0,"actorKind":"robot"}),
    ] {
        error(call(&brain, "wait_for_changes", args).await, "validation");
    }
    let cursor = s.latest_seq().unwrap();
    let waiter = call(
        &brain,
        "wait_for_changes",
        json!({"cursor":cursor,"actions":["report.submitted"],"timeoutSeconds":5}),
    );
    let write = async {
        tokio::time::sleep(Duration::from_millis(350)).await;
        let sent = Instant::now();
        data(
            call(
                &worker,
                "submit_report",
                json!({"key":key,"summaryMd":"Cross-process wake","changedFiles":[],"tests":[]}),
            )
            .await,
        );
        sent
    };
    let (result, sent) = tokio::join!(waiter, write);
    let latency = sent.elapsed();
    println!(
        "wait_for_changes report.submitted cross-process wake latency: {:.3} ms",
        latency.as_secs_f64() * 1000.0
    );
    assert!(
        latency < Duration::from_secs(1),
        "wake latency: {latency:?}"
    );
    let result = data(result);
    assert_eq!(result["timedOut"], false);
    assert_eq!(result["events"].as_array().unwrap().len(), 1);
    assert_eq!(result["events"][0]["action"], "report.submitted");
    assert!(
        result["events"][0]["sentence"]
            .as_str()
            .unwrap()
            .contains("Reporting worker")
    );
    let seq = result["nextCursor"].as_i64().unwrap();
    assert_eq!(seq, s.latest_seq().unwrap());
    let count = s.activity_count().unwrap();
    let started = Instant::now();
    let existing = data(
        call(
            &brain,
            "wait_for_changes",
            json!({"cursor":cursor,"actions":["report.submitted"]}),
        )
        .await,
    );
    assert!(started.elapsed() < Duration::from_millis(250));
    assert_eq!(existing, result);
    let timed = Instant::now();
    let timeout = data(
        call(
            &brain,
            "wait_for_changes",
            json!({"cursor":seq,"timeoutSeconds":2}),
        )
        .await,
    );
    assert!(timed.elapsed() >= Duration::from_secs(2));
    assert!(timed.elapsed() < Duration::from_secs(3));
    assert_eq!(
        timeout,
        json!({"events":[],"nextCursor":seq,"timedOut":true})
    );
    assert_eq!(s.activity_count().unwrap(), count);
    brain.cancel().await.unwrap();
    worker.cancel().await.unwrap();
}

#[tokio::test]
async fn eight_change_waiters_and_two_hundred_stdio_writes_do_not_lock() {
    let (_dir, s, h) = fixture();
    let writer = client(&s.path, "Concurrent writer").await;
    let story = planning(&s, &h);
    let task = data(
        call(
            &writer,
            "create_task",
            task_input(&story, "Concurrent report"),
        )
        .await,
    );
    let key = task["key"].as_str().unwrap();
    data(call(&writer, "mark_ready", json!({"key":key})).await);
    data(call(&writer, "claim_task", json!({"key":key})).await);
    let mut clients = Vec::new();
    for i in 0..8 {
        clients.push(client(&s.path, &format!("Concurrent waiter {i}")).await);
    }
    let before = s
        .list_members()
        .unwrap()
        .into_iter()
        .filter(|m| m.member.name.starts_with("Concurrent waiter "))
        .map(|m| (m.member.id, m.member.last_seen_at))
        .collect::<Vec<_>>();
    assert_eq!(before.len(), 8);
    let cursor = s.latest_seq().unwrap();
    let mut waits = tokio::task::JoinSet::new();
    for c in clients {
        waits.spawn(async move {
            let result = data(
                call(
                    &c,
                    "wait_for_changes",
                    json!({"cursor":cursor,"actions":["report.submitted"],"timeoutSeconds":30}),
                )
                .await,
            );
            let returned = Instant::now();
            c.cancel().await.unwrap();
            (result, returned)
        });
    }
    let ready_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let members = s.list_members().unwrap();
        if before.iter().all(|(id, stamp)| {
            members
                .iter()
                .any(|m| &m.member.id == id && m.member.last_seen_at > *stamp)
        }) {
            break;
        }
        assert!(
            Instant::now() < ready_deadline,
            "all eight calls must enter before writes"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let started = Instant::now();
    for i in 0..200 {
        data(
            call(
                &writer,
                "set_status",
                json!({"text":format!("Concurrent write {i}")}),
            )
            .await,
        );
    }
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "writer starvation"
    );
    assert!(
        waits.try_join_next().is_none(),
        "non-matching writes woke a waiter"
    );
    let sent = Instant::now();
    data(
        call(
            &writer,
            "submit_report",
            json!({"key":key,"summaryMd":"All writes complete","changedFiles":[],"tests":[]}),
        )
        .await,
    );
    let expected_seq = s.latest_seq().unwrap();
    assert_eq!(expected_seq, cursor + 201);
    let mut returned = 0;
    while let Some(wait) = waits.join_next().await {
        let (result, at) = wait.unwrap();
        assert_eq!(result["timedOut"], false);
        assert_eq!(result["nextCursor"], expected_seq);
        assert_eq!(result["events"].as_array().unwrap().len(), 1);
        assert_eq!(result["events"][0]["action"], "report.submitted");
        assert!(at.duration_since(sent) < Duration::from_secs(1));
        returned += 1;
    }
    assert_eq!(returned, 8);
    println!(
        "8 waiters / 200 stdio writes: all returned, writes took {:.3} s, no lock errors",
        sent.duration_since(started).as_secs_f64()
    );
    writer.cancel().await.unwrap();
}

#[tokio::test]
async fn project_binding_survives_selection_changes_and_rejects_foreign_keys() {
    let (_dir, s, h) = fixture();
    let project_a = s.active_jam().unwrap();
    let story_a = planning(&s, &h);
    let worker = client(&s.path, "Pinned worker").await;
    let first = data(call(&worker, "create_task", task_input(&story_a, "A task")).await);
    let (project_b, hb) = s
        .create_jam("Second project", None, None, None, "UTC", "Second human")
        .unwrap();
    let story_b = planning(&s, &hb);
    let second_client = client(&s.path, "Second worker").await;
    let second = data(
        call(
            &second_client,
            "create_task",
            task_input(&story_b, "B task"),
        )
        .await,
    );
    let context = data(call(&worker, "get_session_context", json!({})).await);
    assert_eq!(context["projectId"], project_a.id);
    assert_eq!(context["keyPrefix"], project_a.key_prefix);
    assert_eq!(context["canSwitchProject"], false);
    assert_eq!(
        data(call(&worker, "get_board", json!({})).await)["jam"]["id"],
        project_a.id
    );
    assert_eq!(
        data(call(&second_client, "get_session_context", json!({})).await)["projectId"],
        project_b.id
    );
    error(
        call(&worker, "get_task", json!({"key":second["key"]})).await,
        "forbidden",
    );
    error(
        call(&worker, "create_task", task_input(&story_b, "Wrong scope")).await,
        "forbidden",
    );
    error(
        call(
            &worker,
            "get_epic",
            json!({"key":format!("{}-E1",project_b.key_prefix)}),
        )
        .await,
        "forbidden",
    );
    let resource = worker
        .read_resource(ReadResourceRequestParams::new(format!(
            "jam://task/{}",
            second["key"].as_str().unwrap()
        )))
        .await;
    assert!(resource.is_err());
    assert_eq!(
        data(call(&worker, "get_task", json!({"key":first["key"]})).await)["title"],
        "A task"
    );
    // An explicit pin can connect to A while the human remains on B.
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_jam-board-mcp"));
    cmd.arg("--db")
        .arg(&s.path)
        .arg("--project")
        .arg(&project_a.key_prefix)
        .env("JAM_BOARD_PROJECT", &project_b.id)
        .env("JAM_AGENT_NAME", "Explicit worker");
    let explicit = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-pin-test", "1"),
    )
    .serve(TokioChildProcess::new(cmd).unwrap())
    .await
    .unwrap();
    assert_eq!(
        data(call(&explicit, "get_session_context", json!({})).await)["projectId"],
        project_a.id
    );
    assert_eq!(s.active_jam().unwrap().id, project_b.id);
    explicit.cancel().await.unwrap();
    worker.cancel().await.unwrap();
    second_client.cancel().await.unwrap();
}
