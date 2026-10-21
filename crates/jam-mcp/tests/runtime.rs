use std::sync::Arc;
#[tokio::test]
async fn runtime_can_toggle_and_rotate_http_without_restarting() {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let store = Arc::new(jam_core::Store::open(d.path().join("jam.db")).unwrap());
    let runtime = jam_mcp::McpRuntime::new(
        store,
        "C:\\Program Files\\Jam Board\\jam-board-mcp.exe".into(),
    )
    .unwrap();
    runtime.set_enabled(true).await.unwrap();
    let status = runtime.status().await.unwrap();
    assert!(status.running);
    let old = runtime.reveal().unwrap();
    let http = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/mcp", status.port.unwrap());
    assert_eq!(http.post(&url).send().await.unwrap().status(), 401);
    runtime.set_enabled(false).await.unwrap();
    assert!(!runtime.status().await.unwrap().running);
    runtime.set_enabled(true).await.unwrap();
    assert!(runtime.status().await.unwrap().running);
    runtime.regenerate().await.unwrap();
    assert_ne!(runtime.reveal().unwrap(), old);
    let url = format!(
        "http://127.0.0.1:{}/mcp",
        runtime.status().await.unwrap().port.unwrap()
    );
    assert_eq!(
        http.post(&url)
            .bearer_auth(&old)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_ne!(
        http.post(&url)
            .bearer_auth(runtime.reveal().unwrap())
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert!(runtime.status().await.unwrap().running);
    runtime.set_enabled(false).await.unwrap();
}
#[test]
fn snippets_escape_windows_paths_as_valid_toml_strings() {
    let path = r"C:\Program Files\Jam's tools\jam-board-mcp.exe";
    let snippets =
        jam_mcp::config_snippets(path, r"C:\Users\Example\My data", 47325, "test-placeholder");
    let line = snippets
        .codex_stdio
        .lines()
        .find(|s| s.starts_with("command = "))
        .unwrap();
    let decoded: String = serde_json::from_str(line.strip_prefix("command = ").unwrap()).unwrap();
    assert_eq!(decoded, path);
    assert!(snippets.codex_http.contains("47325"));
    assert!(
        snippets
            .claude_http
            .contains("Authorization: Bearer test-placeholder")
    );
}
