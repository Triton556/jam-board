use crate::{
    tests::{directory, session},
    *,
};
use std::{path::PathBuf, time::Duration};

#[cfg(windows)]
fn recorder(extension: &str) -> (PathBuf, PathBuf, Vec<String>) {
    let root = directory().join("batch launchers");
    std::fs::create_dir_all(&root).unwrap();
    let node = which::which("node.exe").expect("Offline fixture needs installed Node.js");
    let script = root.join("record.cjs");
    let launcher = root.join(format!("recorder.{extension}"));
    let output = root.join("arguments.json");
    std::fs::write(&script, "const a=process.argv.slice(2); require('fs').writeFileSync(process.env.JAM_DOCK_TEST_RECORD,JSON.stringify(a)); process.stdout.write('ARGS:'+JSON.stringify(a)+'\\n');").unwrap();
    std::fs::write(
        &launcher,
        format!("@\"{}\" \"{}\" %*\r\n", node.display(), script.display()),
    )
    .unwrap();
    let json = serde_json::json!({"mcpServers":{"jam-board":{"command":"C:/Program Files/Jam/mcp.exe","args":[],"env":{"JAM_AGENT_NAME":"Brain & dock | () ^ %PATH% !TEST!","JAM_BOARD_PROJECT":"FAKE"}}}}).to_string();
    let args = vec![
        "--mcp-config".into(),
        json,
        "empty-next".into(),
        String::new(),
        "C:\\path with spaces\\".into(),
        "literal \"quoted\" text".into(),
    ];
    (launcher, output, args)
}

#[cfg(windows)]
#[tokio::test]
async fn tokio_batch_launch_preserves_inline_json_and_argv() {
    for extension in ["cmd", "bat"] {
        let (launcher, output, args) = recorder(extension);
        let mut command = tokio::process::Command::new(&launcher);
        command
            .args(&args)
            .env("JAM_DOCK_TEST_RECORD", &output)
            .creation_flags(0x08000000)
            .kill_on_drop(true);
        let child = tokio::time::timeout(Duration::from_secs(10), command.output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            child.status.success(),
            "{}",
            String::from_utf8_lossy(&child.stderr)
        );
        let observed: Vec<String> =
            serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
        assert_eq!(observed, args);
    }
}

#[cfg(windows)]
#[tokio::test]
async fn pty_batch_launch_preserves_inline_json_and_argv() {
    for extension in ["cmd", "bat"] {
        let (launcher, output, args) = recorder(extension);
        let s = session(SessionStatus::Starting);
        s.inner.lock().unwrap().view.kind = RuntimeKind::Terminal;
        crate::terminal::start(
            s.clone(),
            launcher,
            None,
            args.clone(),
            vec![Env {
                name: "JAM_DOCK_TEST_RECORD".into(),
                value: output.to_string_lossy().into_owned(),
            }],
            vec![],
        )
        .await
        .unwrap();
        let result = tokio::time::timeout(Duration::from_secs(10), s.finished.cancelled()).await;
        s.connector().unwrap().stop().await.unwrap();
        result.expect("PTY batch did not terminate");
        assert_eq!(s.view().status, SessionStatus::Stopped);
        let observed: Vec<String> =
            serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
        assert_eq!(observed, args);
    }
}
