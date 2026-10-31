use jam_core::*;
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
    id: u32,
}
impl Client {
    fn open(folder: &Path, app: &Path, project: &str) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_jam-board-mcp"))
            .arg("--project-folder")
            .arg(folder)
            .arg("--project")
            .arg(project)
            .env("JAM_BOARD_DATA_DIR", app)
            .env_remove("JAM_BOARD_DB")
            .env_remove("JAM_BOARD_PROJECT_FOLDER")
            .env_remove("JAM_BOARD_PROJECT")
            .env_remove("JAM_AGENT_NAME")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            id: 0,
        }
    }
    async fn tool(&mut self, name: &str, args: Value) -> Value {
        self.id += 1;
        let req = json!({"jsonrpc":"2.0","id":self.id,"method":"tools/call","params":{"name":name,"arguments":args,"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"round11-fixture","version":"1"}}}});
        let mut line = serde_json::to_vec(&req).unwrap();
        line.push(b'\n');
        self.input.write_all(&line).await.unwrap();
        self.input.flush().await.unwrap();
        let mut line = String::new();
        assert!(
            tokio::time::timeout(Duration::from_secs(20), self.output.read_line(&mut line))
                .await
                .unwrap()
                .unwrap()
                > 0
        );
        let result: Value = serde_json::from_str(&line).unwrap();
        assert!(result.get("error").is_none(), "{result}");
        assert_ne!(result["result"]["isError"], true, "{result}");
        result["result"]["structuredContent"].clone()
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
#[tokio::test]
async fn mc_folder_context_exact_id_and_eof_snapshot() {
    let d = tempfile::tempdir().unwrap();
    let app = d.path().join("fictional-appdata");
    let m = ProjectManager::new(&app).unwrap();
    let h = m
        .create(&d.path().join("Доска with spaces"), "Fixture", false)
        .unwrap();
    let mut client = Client::open(&h.folder, &app, &h.project_id);
    let context = client.tool("get_session_context", json!({})).await;
    assert_eq!(context["projectId"], h.project_id);
    assert_eq!(context["projectInstanceId"], h.instance_id);
    assert_eq!(context["databaseGeneration"], h.database_generation);
    assert_eq!(context["folderRules"]["model"], "files/models");
    assert_eq!(
        context["fileCapabilities"]["kinds"]
            .as_array()
            .unwrap()
            .len(),
        7
    );
    client.tool("register_file",json!({"storageType":"url","url":"https://example.invalid/document","requestId":"stdio-url"})).await;
    client.close().await;
    assert!(
        std::fs::read_to_string(h.folder.join("board.json"))
            .unwrap()
            .contains("https://example.invalid/document")
    );
    assert!(!h.folder.join(".state/mcp-token").exists());
}
#[tokio::test]
async fn db_two_stdio_processes_share_idempotent_copy_and_flush() {
    let d = tempfile::tempdir().unwrap();
    let app = d.path().join("fictional-appdata");
    let m = ProjectManager::new(&app).unwrap();
    let h = m.create(&d.path().join("board"), "Fixture", false).unwrap();
    let source = d.path().join("Ship.fbx");
    std::fs::write(&source, b"fixture model bytes").unwrap();
    let mut a = Client::open(&h.folder, &app, &h.project_id);
    let mut b = Client::open(&h.folder, &app, &h.project_id);
    let request = json!({"storageType":"board_file","sourcePath":source,"requestId":"shared-copy"});
    let (a_result, b_result) = tokio::join!(
        a.tool("register_file", request.clone()),
        b.tool("register_file", request)
    );
    assert_eq!(a_result["asset"]["id"], b_result["asset"]["id"]);
    a.close().await;
    b.close().await;
    assert_eq!(h.store.list_assets(None, None).unwrap().len(), 1);
    let snapshot: BoardSnapshot =
        serde_json::from_slice(&std::fs::read(h.folder.join("board.json")).unwrap()).unwrap();
    assert_eq!(snapshot.tables["assets"].len(), 1);
}
#[tokio::test]
async fn db_killed_stdio_coordinator_reopen_drains_transactional_dirty_revision() {
    let d = tempfile::tempdir().unwrap();
    let app = d.path().join("fictional-appdata");
    let m = ProjectManager::new(&app).unwrap();
    let h = m
        .create(&d.path().join("Board"), "Coordinator restart", false)
        .unwrap();
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let mut first = Client::open(&h.folder, &app, &h.project_id);
    first.tool("register_file",json!({"storageType":"url","url":"https://example.invalid/killed-coordinator","requestId":"kill-before-debounce"})).await;
    first.child.kill().await.unwrap();
    first.child.wait().await.unwrap();
    let connection = has_unpublished_revision(&h.store.path);
    assert!(connection, "Fixture must kill before debounce publication");
    let mut reopened = Client::open(&h.folder, &app, &h.project_id);
    reopened.tool("get_session_context", json!({})).await;
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if std::fs::read_to_string(h.folder.join("board.json"))
            .unwrap()
            .contains("https://example.invalid/killed-coordinator")
        {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    reopened.close().await;
}
fn has_unpublished_revision(path: &Path) -> bool {
    let store = Store::open(path).unwrap();
    let snapshot = store.board_snapshot().unwrap();
    let folder = path.parent().unwrap().parent().unwrap();
    let published: BoardSnapshot =
        serde_json::from_slice(&std::fs::read(folder.join("board.json")).unwrap()).unwrap();
    snapshot.board_revision > published.board_revision
}
#[test]
fn mc_cli_refuses_wrong_id_absent_db_and_conflicting_locations() {
    let d = tempfile::tempdir().unwrap();
    let app = d.path().join("fictional-appdata");
    let m = ProjectManager::new(&app).unwrap();
    let h = m.create(&d.path().join("board"), "Fixture", false).unwrap();
    let run = |args: Vec<std::ffi::OsString>| {
        std::process::Command::new(env!("CARGO_BIN_EXE_jam-board-mcp"))
            .args(args)
            .env("JAM_BOARD_DATA_DIR", &app)
            .env_remove("JAM_BOARD_DB")
            .env_remove("JAM_BOARD_PROJECT_FOLDER")
            .env_remove("JAM_BOARD_PROJECT")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .unwrap()
    };
    assert!(
        !run(vec![
            "--project-folder".into(),
            h.folder.clone().into_os_string(),
            "--project".into(),
            "wrong-exact-id".into()
        ])
        .status
        .success()
    );
    let absent = d.path().join("absent.db");
    assert!(
        !run(vec!["--db".into(), absent.clone().into_os_string()])
            .status
            .success()
    );
    assert!(!absent.exists());
    assert!(
        !run(vec![
            "--project-folder".into(),
            h.folder.clone().into_os_string(),
            "--db".into(),
            absent.into_os_string()
        ])
        .status
        .success()
    );
}
