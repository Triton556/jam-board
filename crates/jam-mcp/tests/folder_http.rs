use jam_core::*;
use jam_mcp::*;
use rmcp::{
    ServiceExt,
    model::*,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn mc_http_registry_folder_binding_token_isolation_and_move_refusal() {
    let d = tempfile::tempdir().unwrap();
    let app = d.path().join("fictional-appdata");
    let manager = Arc::new(ProjectManager::new(&app).unwrap());
    let h = manager
        .create(&d.path().join("Доска With Spaces"), "Folder HTTP", false)
        .unwrap();
    let legacy = Arc::new(Store::open(app.join("jam.db")).unwrap());
    legacy
        .create_jam("Legacy", None, None, None, "UTC", "Human")
        .unwrap();
    let bearer = token(&app).unwrap();
    let server = start_http_with_manager(
        legacy.clone(),
        bearer.clone(),
        Arc::new(Mutex::new(Default::default())),
        manager.clone(),
    )
    .await
    .unwrap();
    assert!(app.join("mcp-token").is_file());
    assert!(!h.folder.join(".state/mcp-token").exists());
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
    headers.insert("X-Jam-Project", h.project_id.parse().unwrap());
    headers.insert(
        "X-Jam-Project-Folder",
        serde_json::from_str::<serde_json::Value>(
            &folder_config_snippets(
                "sidecar",
                "appdata",
                server.port,
                &h.project_id,
                &h.folder.to_string_lossy(),
            )
            .claude_http,
        )
        .unwrap()["mcpServers"]["jam-board"]["headers"]["X-Jam-Project-Folder"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
    );
    let http = reqwest::Client::builder()
        .default_headers(headers)
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
        Implementation::new("folder-http-fixture", "1"),
    )
    .serve(transport)
    .await
    .unwrap();
    let context = client
        .call_tool(CallToolRequestParams::new("get_session_context"))
        .await
        .unwrap()
        .structured_content
        .unwrap();
    assert_eq!(context["projectId"], h.project_id);
    assert_eq!(context["projectInstanceId"], h.instance_id);
    assert!(
        manager
            .move_project(
                &h.store,
                MoveProject {
                    project_id: h.project_id.clone(),
                    destination: d.path().join("moved").to_string_lossy().into(),
                    request_id: "connected-move".into(),
                    cloud_acknowledged: false
                }
            )
            .is_err()
    );
    client.cancel().await.unwrap();
    server.stop().await;
}
