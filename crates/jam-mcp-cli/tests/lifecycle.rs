use jam_core::Store;
use serde_json::{Value, json};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

struct Client {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
    inline: bool,
    name: Option<String>,
}

impl Client {
    fn new(db: &Path, project: Option<&str>, inline: bool, name: Option<&str>) -> Self {
        Self::with_agent_name(db, project, inline, name, None)
    }

    fn with_agent_name(
        db: &Path,
        project: Option<&str>,
        inline: bool,
        name: Option<&str>,
        agent: Option<&str>,
    ) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_jam-board-mcp"));
        command
            .arg("--db")
            .arg(db)
            .env_remove("JAM_BOARD_PROJECT")
            .env_remove("JAM_AGENT_NAME")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(project) = project {
            command.env("JAM_BOARD_PROJECT", project);
        }
        if let Some(agent) = agent {
            command.env("JAM_AGENT_NAME", agent);
        }
        let mut child = command.spawn().unwrap();
        Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            next_id: 0,
            inline,
            name: name.map(str::to_owned),
        }
    }

    async fn send(&mut self, method: &str, mut params: Value) -> u64 {
        if self.inline {
            params["_meta"] = json!({
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {}
            });
            if let Some(name) = &self.name {
                params["_meta"]["io.modelcontextprotocol/clientInfo"] =
                    json!({"name": name, "version": "1"});
            }
        }
        self.next_id += 1;
        let id = self.next_id;
        let mut line = serde_json::to_vec(
            &json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}),
        )
        .unwrap();
        line.push(b'\n');
        self.input.write_all(&line).await.unwrap();
        self.input.flush().await.unwrap();
        id
    }

    async fn receive(&mut self) -> Value {
        let mut line = String::new();
        let bytes = tokio::time::timeout(Duration::from_secs(15), self.output.read_line(&mut line))
            .await
            .expect("MCP response timed out")
            .unwrap();
        assert_ne!(bytes, 0, "MCP closed stdout");
        let response: Value = serde_json::from_str(&line).unwrap();
        assert!(response.get("error").is_none(), "{response}");
        response
    }

    async fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.send(method, params).await;
        let response = self.receive().await;
        assert_eq!(response["id"], id);
        response["result"].clone()
    }

    async fn close(mut self) {
        self.input.shutdown().await.unwrap();
        drop(self.input);
        assert!(
            tokio::time::timeout(Duration::from_secs(10), self.child.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
    }
}

fn fixture() -> (tempfile::TempDir, Store, String) {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-visuals/round7/a1/tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let store = Store::open(dir.path().join("jam.db")).unwrap();
    let (project, _) = store
        .create_jam("Lifecycle contract", None, None, None, "UTC", "Human")
        .unwrap();
    (dir, store, project.id)
}

async fn exercise_lifecycle(inline: bool, hinted: bool) {
    let (_dir, store, project) = fixture();
    let name = "Lifecycle agent";
    let mut client = Client::new(
        &store.path,
        hinted.then_some(project.as_str()),
        inline,
        Some(name),
    );
    if inline {
        let discovery = client.request("server/discover", json!({})).await;
        assert_eq!(
            discovery["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
            "jam-board"
        );
    } else {
        client
            .request("initialize", json!({"protocolVersion":"2025-06-18", "capabilities":{}, "clientInfo":{"name":name,"version":"1"}}))
            .await;
        client
            .input
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
            .await
            .unwrap();
    }
    // Discovery/initialize already records presence, before any list or tool call.
    let scoped = store.for_project(&project).unwrap();
    let member = scoped
        .list_members()
        .unwrap()
        .into_iter()
        .find(|row| row.member.name == name)
        .expect("lifecycle must register presence");
    assert!(member.online);
    let before = member.member.last_seen_at.unwrap();
    let tools = client.request("tools/list", json!({})).await;
    assert_eq!(tools["tools"].as_array().unwrap().len(), 52);
    let resources = client.request("resources/list", json!({})).await;
    assert!(
        resources["resources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["uri"] == "jam://guide")
    );
    let guide = client
        .request("resources/read", json!({"uri":"jam://guide"}))
        .await;
    assert!(
        guide["contents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Jam Board")
    );
    assert_eq!(
        client.request("resources/templates/list", json!({})).await["resourceTemplates"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        client.request("prompts/list", json!({})).await["prompts"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(
        !client
            .request("prompts/get", json!({"name":"plan_epic"}))
            .await["messages"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(client.request("completion/complete", json!({"ref":{"type":"ref/prompt","name":"plan_epic"},"argument":{"name":"tag","value":""}})).await["completion"]["values"], json!([]));
    // Changing the active board cannot redirect this session or its writes.
    let (other, _) = store
        .create_jam("Other project", None, None, None, "UTC", "Human")
        .unwrap();
    let context = client
        .request(
            "tools/call",
            json!({"name":"get_session_context","arguments":{}}),
        )
        .await;
    assert_eq!(context["structuredContent"]["projectId"], project);
    let write = client
        .request(
            "tools/call",
            json!({"name":"create_epic","arguments":{"title":"Lifecycle write"}}),
        )
        .await;
    assert_ne!(write["isError"], true, "{write}");
    let key = write["structuredContent"]["key"].as_str().unwrap();
    assert_eq!(scoped.get_epic(key).unwrap().epic.title, "Lifecycle write");
    assert!(
        store
            .for_project(&other.id)
            .unwrap()
            .list_members()
            .unwrap()
            .iter()
            .all(|m| m.member.name != name)
    );
    let after = scoped
        .list_members()
        .unwrap()
        .into_iter()
        .find(|row| row.member.name == name)
        .unwrap();
    assert!(
        after.member.last_seen_at.unwrap() > before,
        "requests must refresh heartbeat"
    );
    client.close().await;
}

#[tokio::test]
async fn legacy_initialize_stdio_contract() {
    exercise_lifecycle(false, true).await;
    exercise_lifecycle(false, false).await;
}

#[tokio::test]
async fn discover_inline_stdio_contract() {
    exercise_lifecycle(true, true).await;
    exercise_lifecycle(true, false).await;
}

#[tokio::test]
async fn inline_first_requests_bind_without_discover() {
    for (method, params) in [
        ("tools/list", json!({})),
        ("resources/list", json!({})),
        ("resources/templates/list", json!({})),
        ("resources/read", json!({"uri":"jam://guide"})),
        ("prompts/list", json!({})),
        ("prompts/get", json!({"name":"plan_epic"})),
        (
            "tools/call",
            json!({"name":"get_session_context","arguments":{}}),
        ),
        (
            "completion/complete",
            json!({"ref":{"type":"ref/prompt","name":"plan_epic"},"argument":{"name":"tag","value":""}}),
        ),
    ] {
        let (_dir, store, project) = fixture();
        // No project hint: capture the active project on the first operation.
        let mut client = Client::new(&store.path, None, true, Some("Inline first"));
        client.request(method, params).await;
        let members = store.for_project(&project).unwrap().list_members().unwrap();
        assert!(
            members
                .iter()
                .any(|m| m.member.name == "Inline first" && m.online),
            "{method}"
        );
        client.close().await;
    }
}

#[tokio::test]
async fn concurrent_inline_first_requests_bind_once() {
    let (_dir, store, project) = fixture();
    let mut client = Client::new(&store.path, None, true, Some("Concurrent inline"));
    let mut ids = Vec::new();
    for method in ["tools/list", "resources/list", "prompts/list", "tools/list"] {
        ids.push(client.send(method, json!({})).await);
    }
    for _ in 0..ids.len() {
        let response = client.receive().await;
        let id = response["id"].as_u64().unwrap();
        assert!(ids.contains(&id));
        ids.retain(|i| *i != id);
    }
    assert!(ids.is_empty());
    assert_eq!(
        store
            .for_project(&project)
            .unwrap()
            .list_members()
            .unwrap()
            .iter()
            .filter(|m| m.member.kind == "agent")
            .count(),
        1
    );
    client.close().await;
}

#[tokio::test]
async fn inline_identity_sources_and_session_identity_are_stable() {
    for (info, env, expected, client_kind) in [
        (
            Some("Metadata worker"),
            Some("Environment worker"),
            "Environment worker",
            "other",
        ),
        (
            Some("claude-code-contract"),
            Some("Display worker"),
            "Display worker",
            "claude-code",
        ),
        (
            Some("codex-contract"),
            Some("Display worker"),
            "Display worker",
            "codex",
        ),
        (Some("Metadata worker"), None, "Metadata worker", "other"),
        (
            None,
            Some("Environment worker"),
            "Environment worker",
            "other",
        ),
        (None, Some("Claude reviewer"), "Claude reviewer", "other"),
        (None, None, "Agent", "other"),
    ] {
        let (_dir, store, project) = fixture();
        let mut client = Client::with_agent_name(&store.path, None, true, info, env);
        client.request("tools/list", json!({})).await;
        client.name = Some("Changed client info".into());
        client.request("tools/list", json!({})).await;
        let members = store.for_project(&project).unwrap().list_members().unwrap();
        let agents = members
            .iter()
            .filter(|m| m.member.kind == "agent")
            .collect::<Vec<_>>();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].member.name, expected);
        assert_eq!(agents[0].member.client.as_deref(), Some(client_kind));
        assert!(agents[0].online && agents[0].member.last_seen_at.is_some());
        client.close().await;
    }
}

#[tokio::test]
async fn legacy_agent_name_overrides_default_and_client_info_precedes_metadata() {
    for agent_name in [Some("Environment worker"), None] {
        let (_dir, store, project) = fixture();
        let mut client = Client::with_agent_name(&store.path, None, false, None, agent_name);
        client.request("initialize", json!({
        "protocolVersion":"2025-06-18", "capabilities":{},
        "clientInfo":{"name":"codex-handshake-worker","version":"1"},
        "_meta":{"io.modelcontextprotocol/clientInfo":{"name":"claude-code-metadata","version":"1"}}
    })).await;
        client
            .input
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
            .await
            .unwrap();
        client.request("tools/list", json!({})).await;
        let members = store.for_project(&project).unwrap().list_members().unwrap();
        let agents = members
            .iter()
            .filter(|m| m.member.kind == "agent")
            .collect::<Vec<_>>();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].member.name, agent_name.unwrap_or("Codex"));
        assert_eq!(agents[0].member.client.as_deref(), Some("codex"));
        assert!(agents[0].online);
        client.close().await;
    }
}
