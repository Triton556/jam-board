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

#[tokio::test]
async fn snippets_and_recent_calls_follow_selected_project_but_never_retarget_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(jam_core::Store::open(dir.path().join("jam.db")).unwrap());
    let (a, _) = store
        .create_jam("Board A", None, None, None, "UTC", "Human")
        .unwrap();
    let runtime = jam_mcp::McpRuntime::new(store.clone(), "sidecar.exe".into()).unwrap();
    let a_snippets = runtime.snippets().await.unwrap();
    assert!(
        a_snippets
            .codex_stdio
            .contains(&format!("JAM_BOARD_PROJECT = {:?}", a.id))
    );
    assert!(
        a_snippets
            .codex_http
            .contains(&format!("\"X-Jam-Project\" = {:?}", a.id))
    );
    assert!(
        a_snippets
            .claude_stdio
            .contains(&format!("JAM_BOARD_PROJECT='{}'", a.id))
    );
    assert!(
        a_snippets
            .claude_http
            .contains(&format!("'X-Jam-Project: {}'", a.id))
    );
    let (b, _) = store
        .create_jam("Board B", None, None, None, "UTC", "Human")
        .unwrap();
    let b_snippets = runtime.snippets().await.unwrap();
    assert!(b_snippets.codex_stdio.contains(&b.id));
    assert!(!b_snippets.codex_stdio.contains(&a.id));
    let status = runtime.status().await.unwrap();
    assert_eq!(status.project_id, Some(b.id));
    assert_eq!(status.project_key_prefix, Some(b.key_prefix));
    // A previously copied connection string retains A's immutable id.
    assert!(a_snippets.codex_stdio.contains(&a.id));
}
