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
    assert!(format!("{:?}", r.content).contains(code), "{:?}", r.content);
}

#[tokio::test]
async fn full_stdio_contract_and_errors() {
    let (_d, s, h) = fixture();
    let c = client(&s.path, "Codex").await;
    let tools = c.list_all_tools().await.unwrap();
    assert_eq!(tools.len(), 12);
    assert!(tools.iter().any(|t| t.name == "create_task"));
    let input = json!({"title":"Add jump buffer","priority":"high","tags":[" GAMEPLAY ","gameplay"],"idempotencyKey":"m2-1"});
    let t = data(call(&c, "create_task", input.clone()).await);
    let key = t["key"].as_str().unwrap();
    assert_eq!(t["tags"], json!(["gameplay"]));
    let n = s.activity_count().unwrap();
    assert_eq!(data(call(&c, "create_task", input).await)["id"], t["id"]);
    assert_eq!(s.activity_count().unwrap(), n);
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
        data(call(&c, "move_task", json!({"key":key,"status":"review"})).await)["status"],
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
    assert_eq!(detail["activity"].as_array().unwrap().len(), 4);
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
        "todo"
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
        c.list_all_resource_templates().await.unwrap()[0].uri_template,
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
    assert_eq!(c.list_all_prompts().await.unwrap().len(), 1);
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
    let baseline = s.activity_count().unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(5));
    let mut threads = Vec::new();
    for worker in 0..4 {
        let s = s.clone();
        let actor = h.id.clone();
        let barrier = barrier.clone();
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            for i in 0..200 {
                s.create_task(
                    &actor,
                    CreateTask {
                        title: format!("App {worker} task {i}"),
                        ..Default::default()
                    },
                )
                .unwrap();
            }
        }));
    }
    barrier.wait();
    for i in 0..200 {
        data(call(&c, "create_task", json!({"title":format!("MCP task {i}")})).await);
    }
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(s.activity_count().unwrap() - baseline, 1000);
    assert_eq!(s.active_jam().unwrap().task_seq, 1000);
    c.cancel().await.unwrap();
}

#[tokio::test]
async fn stdio_write_reaches_external_feed_in_one_second() {
    let (_d, s, _h) = fixture();
    let c = client(&s.path, "Feed agent").await;
    data(call(&c, "get_board", json!({})).await);
    let mut feed = ChangeFeed::open(&s.path, s.latest_seq().unwrap()).unwrap();
    let start = Instant::now();
    let t = data(call(&c, "create_task", json!({"title":"Live from MCP"})).await);
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
