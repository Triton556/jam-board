use jam_core::Store;
use jam_mcp::{start_http, token};
use rmcp::{
    ServiceExt,
    model::*,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[tokio::test]
async fn http_auth_origin_identity_port_and_tools() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Arc::new(Store::open(d.path().join("jam.db")).unwrap());
    s.create_jam("HTTP jam", None, None, None, "UTC", "Danil")
        .unwrap();
    let bearer = token(d.path()).unwrap();
    assert_eq!(token(d.path()).unwrap(), bearer);
    assert_eq!(bearer.len(), 43);
    let blocker = tokio::net::TcpListener::bind("127.0.0.1:47321").await.ok();
    let recent = Arc::new(Mutex::new(Default::default()));
    let server = start_http(s.clone(), bearer.clone(), recent.clone())
        .await
        .unwrap();
    if blocker.is_some() {
        assert_ne!(server.port, 47321);
    }
    assert_eq!(
        s.setting("mcp_http_port").unwrap().unwrap(),
        server.port.to_string()
    );
    let url = format!("http://127.0.0.1:{}/mcp", server.port);
    let http = reqwest::Client::new();
    assert_eq!(http.post(&url).send().await.unwrap().status(), 401);
    for origin in [
        "http://evil.example:123",
        "http://localhost.evil:123",
        "null",
    ] {
        assert_eq!(
            http.post(&url)
                .bearer_auth(&bearer)
                .header("Origin", origin)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
    headers.insert("X-Jam-Agent", "Mira's Codex".parse().unwrap());
    headers.insert("Origin", "http://localhost:1420".parse().unwrap());
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap();
    let transport = StreamableHttpClientTransport::with_client(
        http,
        StreamableHttpClientTransportConfig::with_uri(url),
    );
    let client = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-http-test", "1"),
    )
    .with_protocol_version(ProtocolVersion::V_2025_06_18)
    .serve(transport)
    .await
    .unwrap();
    assert_eq!(client.list_all_tools().await.unwrap().len(), 12);
    let result = client
        .call_tool(
            CallToolRequestParams::new("create_task").with_arguments(
                serde_json::json!({"title":"HTTP task"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));
    let members = s.list_members().unwrap();
    let m = members
        .iter()
        .find(|m| m.member.name == "Mira's Codex")
        .unwrap();
    assert_eq!(m.member.client.as_deref(), Some("codex"));
    assert!(m.online);
    assert_eq!(m.member.color, "#E0679A");
    assert_eq!(recent.lock().unwrap().len(), 1);
    client.cancel().await.unwrap();
    server.stop().await;
    drop(blocker);
}
