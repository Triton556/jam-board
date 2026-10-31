use jam_core::Store;
use jam_mcp::start_http;
use rmcp::{
    ServiceExt,
    model::*,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

fn fixture() -> (tempfile::TempDir, Arc<Store>, String) {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-visuals/round7/a1/tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let store = Arc::new(Store::open(dir.path().join("jam.db")).unwrap());
    let (project, _) = store
        .create_jam("HTTP lifecycle", None, None, None, "UTC", "Human")
        .unwrap();
    (dir, store, project.id)
}

#[tokio::test]
async fn http_inline_uses_project_and_agent_headers() {
    let (_dir, store, project) = fixture();
    let server = start_http(
        store.clone(),
        "synthetic-test-bearer".into(),
        Arc::new(Mutex::new(Default::default())),
    )
    .await
    .unwrap();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "Authorization",
        "Bearer synthetic-test-bearer".parse().unwrap(),
    );
    headers.insert("X-Jam-Project", project.parse().unwrap());
    headers.insert("X-Jam-Agent", "HTTP inline profile".parse().unwrap());
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    let transport = StreamableHttpClientTransport::with_client(
        http,
        StreamableHttpClientTransportConfig::with_uri(format!(
            "http://127.0.0.1:{}/mcp",
            server.port
        )),
    );
    let client = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("claude-code-contract", "1"),
    )
    .with_protocol_version(ProtocolVersion::V_2026_07_28)
    .serve(transport)
    .await
    .unwrap();
    assert_eq!(client.list_all_tools().await.unwrap().len(), 57);
    assert!(
        client
            .list_all_resources()
            .await
            .unwrap()
            .iter()
            .any(|r| r.uri == "jam://guide")
    );
    client
        .read_resource(ReadResourceRequestParams::new("jam://guide"))
        .await
        .unwrap();
    let (other, _) = store
        .create_jam("Other active HTTP", None, None, None, "UTC", "Human")
        .unwrap();
    let result = client
        .call_tool(CallToolRequestParams::new("get_session_context"))
        .await
        .unwrap();
    assert_eq!(result.structured_content.unwrap()["projectId"], project);
    let result = client
        .call_tool(
            CallToolRequestParams::new("create_epic").with_arguments(
                json!({"title":"HTTP inline write"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));
    let key = result.structured_content.unwrap()["key"]
        .as_str()
        .unwrap()
        .to_owned();
    let scoped = store.for_project(&project).unwrap();
    assert_eq!(
        scoped.get_epic(&key).unwrap().epic.title,
        "HTTP inline write"
    );
    let members = scoped.list_members().unwrap();
    let member = members
        .iter()
        .find(|m| m.member.name == "HTTP inline profile")
        .unwrap();
    assert!(member.online && member.member.last_seen_at.is_some());
    assert_eq!(member.member.client.as_deref(), Some("claude-code"));
    assert!(
        store
            .for_project(&other.id)
            .unwrap()
            .list_members()
            .unwrap()
            .iter()
            .all(|m| m.member.name != "HTTP inline profile")
    );
    client.cancel().await.unwrap();
    server.stop().await;
}

async fn response_json(response: reqwest::Response) -> Value {
    assert!(response.status().is_success(), "HTTP {}", response.status());
    let body = response.text().await.unwrap();
    if let Ok(value) = serde_json::from_str(&body) {
        value
    } else {
        body.lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .find_map(|data| serde_json::from_str(data).ok())
            .unwrap_or_else(|| panic!("SSE response has no JSON data: {body}"))
    }
}

#[tokio::test]
async fn http_bound_session_rejects_project_change_and_keeps_identity() {
    let (_dir, store, project) = fixture();
    let (other, _) = store
        .create_jam("Other HTTP", None, None, None, "UTC", "Human")
        .unwrap();
    let server = start_http(
        store.clone(),
        "synthetic-test-bearer".into(),
        Arc::new(Mutex::new(Default::default())),
    )
    .await
    .unwrap();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    let url = format!("http://127.0.0.1:{}/mcp", server.port);
    let request = |project: &str, agent: &str| {
        client
            .post(&url)
            .bearer_auth("synthetic-test-bearer")
            .header("Accept", "application/json, text/event-stream")
            .header("X-Jam-Project", project)
            .header("X-Jam-Agent", agent)
    };
    let initialize = request(&project, "Captured profile").json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"codex-test","version":"1"}}})).send().await.unwrap();
    let session = initialize
        .headers()
        .get("mcp-session-id")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(response_json(initialize).await.get("error").is_none());
    let initialized = request(&project, "Captured profile")
        .header("mcp-session-id", &session)
        .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .send()
        .await
        .unwrap();
    assert!(initialized.status().is_success());
    let result = response_json(
        request(&other.id, "Changed profile")
            .header("mcp-session-id", &session)
            .json(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert!(
        result["error"]["message"]
            .as_str()
            .unwrap()
            .contains("already bound. Reconnect"),
        "{result}"
    );
    let result = response_json(
        request(&project, "Changed profile")
            .header("mcp-session-id", &session)
            .json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(result["result"]["tools"].as_array().unwrap().len(), 57);
    let members = store.for_project(&project).unwrap().list_members().unwrap();
    assert!(
        members
            .iter()
            .any(|m| m.member.name == "Captured profile" && m.online)
    );
    assert!(members.iter().all(|m| m.member.name != "Changed profile"));
    server.stop().await;
}
