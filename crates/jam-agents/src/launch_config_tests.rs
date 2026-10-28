use super::*;

#[test]
fn stale_codex_servers_include_disabled_quoted_names_and_binary_aliases() {
    let source = r#"
# [mcp_servers.comment]
[mcp_servers.jam-board]
enabled = false
[mcp_servers."old.board"]
command = 'C:\old\jam-board-mcp.exe'
[mcp_servers.other]
command = "unrelated"
env = { TOKEN = "jam-board-mcp" }
[mcp_servers.wrapper]
command = 'node'
args = [
  'C:/debug/jam-board-mcp.js',
]
"#;
    assert_eq!(
        stale_servers(source, true),
        BTreeSet::from(["jam-board".into(), "old.board".into(), "wrapper".into()])
    );
    assert_eq!(
        stale_servers(
            r#"mcp_servers = { inline = { command = 'jam-board-mcp' }, other = { command = 'node' } }"#,
            true
        ),
        BTreeSet::from(["inline".into()])
    );
    assert_eq!(
        stale_servers(r#"mcp_servers."jam-board".enabled = false"#, true),
        BTreeSet::from(["jam-board".into()])
    );
}

#[test]
fn stale_claude_user_project_and_local_entries_are_detected_without_credentials() {
    let source = serde_json::json!({
        "mcpServers": {"jam-board":{"disabled":true},"alias":{"command":"C:/Jam/jam-board-mcp.exe","env":{"TOKEN":"fictional-secret"}},"other":{"command":"unrelated"}},
        "projects": {"C:/old":{"mcpServers":{"local":{"command":"node","args":["jam-board-mcp.js"]}}}}
    }).to_string();
    let names = stale_servers(&source, false);
    assert_eq!(
        names,
        BTreeSet::from(["alias".into(), "jam-board".into(), "local".into()])
    );
    assert!(!format!("{names:?}").contains("fictional-secret"));
    assert!(stale_servers("invalid configuration fictional-secret", false).is_empty());
}

#[test]
fn launch_warning_has_config_path_fix_and_new_server_and_leaves_file_untouched() {
    let root = super::super::launch_wiring_tests::scratch();
    let config = root.join("config.toml");
    let source = "[mcp_servers.jam-board]\nenabled = false\n";
    std::fs::write(&config, source).unwrap();
    let fixture = crate::tests::session(SessionStatus::Starting);
    let store = Arc::new(jam_core::Store::open(root.join("board.db")).unwrap());
    let profiles = Profiles::new(store, Arc::new(crate::tests::MemoryCredentials::default()));
    let profile = profiles.get("codex-cli").unwrap();
    let warnings = launch_warnings(
        &profile,
        &fixture.board.data_dir,
        &[Env {
            name: "CODEX_HOME".into(),
            value: root.to_string_lossy().into_owned(),
        }],
        "jam-board-FB-unique",
    );
    let warning = warnings
        .iter()
        .find(|w| w.config_path == config.to_string_lossy())
        .unwrap();
    let payload = serde_json::to_value(warning).unwrap();
    assert_eq!(payload["serverName"], "jam-board");
    assert_eq!(payload["injectedServerName"], "jam-board-FB-unique");
    assert!(
        payload["suggestedFix"]
            .as_str()
            .unwrap()
            .contains("Remove or disable")
    );
    assert_eq!(std::fs::read_to_string(config).unwrap(), source);
}

use std::sync::Arc;
