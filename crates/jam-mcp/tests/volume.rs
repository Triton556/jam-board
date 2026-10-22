//! Opt in, from the workspace root:
//! cargo build -p jam-mcp-cli
//! JAM_VOLUME_STDIO_BIN="$PWD/target/debug/jam-board-mcp" JAM_VOLUME_KEEP=1 \
//! cargo test -p jam-mcp --test volume -- --ignored --nocapture
//! Real 2 HTTP + 2 stdio clients; never connects to an existing board or grants execution.
#[path = "../../jam-core/tests/volume_support/mod.rs"]
mod volume_support;
use jam_core::*;
use jam_mcp::{start_http, token};
use rmcp::{
    RoleClient, ServiceExt,
    model::*,
    service::RunningService,
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use volume_support::*;
type Client = RunningService<RoleClient, ClientConfig>;

async fn http_client(port: u16, bearer: &str, project: &str, name: &str) -> Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
    headers.insert("X-Jam-Project", project.parse().unwrap());
    headers.insert("X-Jam-Agent", name.parse().unwrap());
    let transport = StreamableHttpClientTransport::with_client(
        reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap(),
        StreamableHttpClientTransportConfig::with_uri(format!("http://127.0.0.1:{port}/mcp")),
    );
    ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-volume-http", "1"),
    )
    .serve(transport)
    .await
    .unwrap()
}
async fn stdio_client(binary: &Path, db: &Path, project: &str, name: &str) -> Client {
    let mut command = tokio::process::Command::new(binary);
    command
        .arg("--db")
        .arg(db)
        .arg("--project")
        .arg(project)
        .env("JAM_AGENT_NAME", name)
        .env("RUST_LOG", "warn");
    ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-volume-stdio", "1"),
    )
    .serve(TokioChildProcess::new(command).unwrap())
    .await
    .unwrap()
}
async fn raw(client: &Client, tool: &str, args: Value) -> CallToolResult {
    client
        .call_tool(
            CallToolRequestParams::new(tool.to_owned())
                .with_arguments(args.as_object().unwrap().clone()),
        )
        .await
        .unwrap()
}
async fn call(client: &Client, tool: &str, args: Value) -> Value {
    let result = raw(client, tool, args).await;
    assert_ne!(result.is_error, Some(true), "{tool}: {result:?}");
    result.structured_content.unwrap()
}
async fn live(client: &Client, cursor: i64, seconds: u64) -> (Value, Instant) {
    let result = call(client, "wait_for_changes", json!({"cursor":cursor,"actions":["comment.added"],"actorKind":"human","timeoutSeconds":seconds})).await;
    (result, Instant::now())
}

// UI selection is stressed independently of all four immutable MCP session bindings.
struct SelectionChurn {
    stop: Arc<AtomicBool>,
    switches: Arc<AtomicUsize>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl SelectionChurn {
    fn start(store: Arc<Store>, projects: Vec<String>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let switches = Arc::new(AtomicUsize::new(0));
        let signal = stop.clone();
        let count = switches.clone();
        let thread = std::thread::spawn(move || {
            let mut n = 0;
            while !signal.load(Ordering::Relaxed) {
                store.select_project(&projects[n % projects.len()]).unwrap();
                count.fetch_add(1, Ordering::Relaxed);
                n += 1;
                std::thread::sleep(Duration::from_millis(25));
            }
        });
        Self {
            stop,
            switches,
            thread: Some(thread),
        }
    }
}
impl Drop for SelectionChurn {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.thread.take().unwrap().join().unwrap();
    }
}

async fn exercise(
    client: &Client,
    p: &ProjectFixture,
    foreign: &ProjectFixture,
    label: &str,
    ordinal: usize,
) {
    // Version failure happens before any volume mutation; no stale binary fallback.
    assert_eq!(
        client
            .peer_info()
            .unwrap()
            .server_info
            .as_ref()
            .unwrap()
            .version,
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(
        call(client, "get_session_context", json!({})).await["projectId"],
        p.project.id
    );
    let detail = call(client, "get_task", json!({"key":p.tasks[ordinal*4].key})).await;
    let forbidden=raw(client,"claim_task",json!({"key":detail["key"],"expectedClaimGeneration":detail["claimGeneration"],"expectedUpdatedAt":detail["updatedAt"]})).await;
    assert_eq!(forbidden.is_error, Some(true));
    assert_eq!(
        forbidden.structured_content.unwrap()["code"],
        "execution_required"
    );
    for (tool, args) in [
        ("get_task", json!({"key":foreign.tasks[0].key})),
        ("get_epic", json!({"key":foreign.epics[0].audit.id})),
        (
            "get_execution",
            json!({"scope":ExecutionScope {kind:ExecutionScopeType::Story,id:foreign.stories[0].audit.id.clone()}}),
        ),
        ("list_tasks", json!({"story":foreign.stories[0].audit.id})),
        (
            "add_comment",
            json!({"key":foreign.tasks[0].key,"body":"Must never land in a foreign project"}),
        ),
    ] {
        let result = raw(client, tool, args).await;
        assert_eq!(result.is_error, Some(true), "{label}/{tool}");
        assert_eq!(
            result.structured_content.unwrap()["code"],
            "forbidden",
            "{label}/{tool}"
        );
    }
    let own = &p.tasks[ordinal * 4];
    let comment = call(
        client,
        "add_comment",
        json!({"key":own.key,"body":format!("Fictional pinned {label} note")}),
    )
    .await;
    assert_eq!(comment["taskId"], own.id);
    let visible = p.tasks.iter().filter(|t| t.archived_at.is_none()).count();
    assert_eq!(
        call(client, "get_project", json!({})).await["tasks"],
        visible
    );
    for tool in ["list_tasks", "get_board"] {
        let mut observations = Vec::new();
        for i in 0..WARMUP + SAMPLES {
            let started = Instant::now();
            let result = raw(
                client,
                tool,
                if tool == "list_tasks" {
                    json!({"limit":50})
                } else {
                    json!({})
                },
            )
            .await;
            let operation_ms = started.elapsed().as_secs_f64() * 1000.0;
            assert_ne!(result.is_error, Some(true), "{label}/{tool}: {result:?}");
            let payload = result.structured_content.as_ref().unwrap();
            if tool == "list_tasks" {
                let tasks = payload["tasks"].as_array().unwrap();
                assert_eq!(tasks.len(), visible.min(50));
                assert!(
                    tasks
                        .iter()
                        .all(|t| t["jamId"] == p.project.id && t["archivedAt"].is_null())
                );
            } else {
                assert_eq!(payload["jam"]["id"], p.project.id);
                assert_eq!(
                    payload["columns"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|c| c["count"].as_u64().unwrap())
                        .sum::<u64>(),
                    visible as u64
                );
            }
            let serialize = Instant::now();
            let bytes = serde_json::to_vec(&result).unwrap().len();
            if i >= WARMUP {
                observations.push(Observation {
                    operation_ms,
                    serialization_ms: serialize.elapsed().as_secs_f64() * 1000.0,
                    bytes,
                });
            }
            if i == WARMUP {
                println!(
                    "VOLUME {}",
                    json!({"kind":"transport_payload","label":label,"tool":tool,"tasks":p.tasks.len(),"structuredJsonBytes":serde_json::to_vec(payload).unwrap().len(),"callToolResultJsonBytes":bytes})
                );
            }
            assert_eq!(
                call(client, "get_session_context", json!({})).await["projectId"],
                p.project.id
            );
        }
        report(
            &format!("{label}.{tool}.four_clients_selection_churn"),
            p.tasks.len(),
            &observations,
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "opt-in: requires explicit current stdio binary and creates 3,040 fictional tasks"]
async fn four_real_pinned_clients_under_volume_and_ui_selection_churn() {
    let binary = std::env::var_os("JAM_VOLUME_STDIO_BIN")
        .expect("Set JAM_VOLUME_STDIO_BIN to the explicitly rebuilt current sidecar");
    assert!(Path::new(&binary).is_file());
    let f = Fixture::new(&VOLUME_SIZES);
    let bearer = token(f.path.parent().unwrap()).unwrap();
    let server = start_http(
        f.store.clone(),
        bearer.clone(),
        Arc::new(Mutex::new(Default::default())),
    )
    .await
    .unwrap();
    let clients = vec![
        http_client(
            server.port,
            &bearer,
            &f.projects[0].project.id,
            "Volume HTTP A",
        )
        .await,
        http_client(
            server.port,
            &bearer,
            &f.projects[1].project.id,
            "Volume HTTP B",
        )
        .await,
        stdio_client(
            Path::new(&binary),
            &f.path,
            &f.projects[0].project.id,
            "Volume stdio A",
        )
        .await,
        stdio_client(
            Path::new(&binary),
            &f.path,
            &f.projects[2].project.id,
            "Volume stdio C",
        )
        .await,
    ];
    let churn = SelectionChurn::start(
        f.store.clone(),
        f.projects.iter().map(|p| p.project.id.clone()).collect(),
    );
    tokio::join!(
        exercise(&clients[0], &f.projects[0], &f.projects[1], "http-A", 0),
        exercise(&clients[1], &f.projects[1], &f.projects[2], "http-B", 1),
        exercise(&clients[2], &f.projects[0], &f.projects[2], "stdio-A", 2),
        exercise(&clients[3], &f.projects[2], &f.projects[0], "stdio-C", 3),
    );
    // Only project A receives an event: both A transports wake, B and C time out.
    let cursor = f.store.latest_seq().unwrap();
    let written = Arc::new(Mutex::new(None::<Instant>));
    let writer = async {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let s = f.projects[0].store.clone();
        let human = f.projects[0].human.id.clone();
        let key = f.projects[0].tasks[0].key.clone();
        let written = written.clone();
        tokio::task::spawn_blocking(move || {
            *written.lock().unwrap() = Some(Instant::now());
            s.add_comment(&human, &key, "Fictional live-wait wakeup")
                .unwrap();
        })
        .await
        .unwrap();
    };
    let (a, b, a2, c, ()) = tokio::join!(
        live(&clients[0], cursor, 5),
        live(&clients[1], cursor, 1),
        live(&clients[2], cursor, 5),
        live(&clients[3], cursor, 1),
        writer
    );
    for (label, (result, finished)) in [("http-A", a), ("stdio-A", a2)] {
        assert_eq!(result["timedOut"], false);
        let events = result["events"].as_array().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["taskKey"], f.projects[0].tasks[0].key);
        println!(
            "VOLUME {}",
            json!({"kind":"live_wait","label":label,"writeStartToResponseMs":finished.duration_since(written.lock().unwrap().unwrap()).as_secs_f64()*1000.0,"events":events.len()})
        );
    }
    for (result, _) in [b, c] {
        assert_eq!(result["timedOut"], true);
        assert!(result["events"].as_array().unwrap().is_empty());
    }
    let switches = churn.switches.load(Ordering::Relaxed);
    drop(churn);
    assert!(switches > 4);
    for p in &f.projects {
        assert!(
            p.store
                .list_execution()
                .unwrap()
                .iter()
                .all(|s| s.effective_state == ExecutionEffectiveState::Paused)
        );
        measure("post_transport.get_project.counts", p.tasks.len(), || {
            p.store.get_project().unwrap()
        });
    }
    println!(
        "VOLUME {}",
        json!({"kind":"transport_correctness","clients":4,"http":2,"stdio":2,"selectionSwitches":switches,"selectionIntervalMs":25,"foreignReadsAndWritesRejected":true,"sameProjectLiveWaits":2,"foreignProjectWaitTimeouts":2,"executionGrants":0,"fixture":f.path})
    );
    for client in clients {
        client.cancel().await.unwrap();
    }
    server.stop().await;
}
