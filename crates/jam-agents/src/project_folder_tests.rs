use super::*;
use std::{sync::Arc, time::Duration};

fn scratch() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-visuals/round11/R11-A/fixtures")
        .join(ulid::Ulid::generate().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    if cfg!(windows) {
        std::path::absolute(dir).unwrap()
    } else {
        dir.canonicalize().unwrap()
    }
}
fn context(store: &jam_core::Store, root: &Path) -> BoardContext {
    let sidecar = root.join("fictional-sidecar");
    std::fs::write(&sidecar, "Never executed").unwrap();
    BoardContext::from_store(store, root.to_path_buf(), sidecar).unwrap()
}
fn input(profile: &str) -> StartAgentSessionInput {
    StartAgentSessionInput {
        profile_id: profile.into(),
        user_config: Some(UserConfigChoice::Include),
        cwd: None,
        model: None,
        effort: None,
    }
}
fn working_directory(store: &jam_core::Store, cwd: &Path) {
    store
        .set_setting(
            &format!("board.{}.working_directory", store.active_jam().unwrap().id),
            &cwd.to_string_lossy(),
        )
        .unwrap();
}
fn runtime(profile_store: Arc<jam_core::Store>, root: &Path, crash: bool) -> SessionManager {
    let manager = SessionManager::new(
        profile_store.clone(),
        Arc::new(crate::tests::MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let node = which::which("node").expect("Installed offline Node recorder");
    assert_eq!(
        node.file_stem().unwrap().to_string_lossy().to_lowercase(),
        "node"
    );
    assert!(node.is_absolute());
    let script = root.join("fake-acp.cjs");
    std::fs::write(&script, r#"
const fs = require('fs');
require('readline').createInterface({input:process.stdin}).on('line', line => {
  const q = JSON.parse(line);
  let result;
  if (q.method === 'initialize') result = {protocolVersion:1,agentCapabilities:{loadSession:true},agentInfo:{name:'fixture',version:'1'}};
  else if (q.method === 'session/new' || q.method === 'session/load') {
    fs.writeFileSync(process.env.JAM_TEST_RECORD, JSON.stringify({cwd:process.cwd(),params:q.params}));
    result = q.method === 'session/new' ? {sessionId:'fictional-native'} : {};
    if (process.env.JAM_TEST_CRASH === '1') setTimeout(() => process.exit(7), 200);
  }
  if (result) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
});
"#).unwrap();
    assert!(script.is_file() && script.starts_with(root));
    let mut profile = manager.profiles.get("claude-code").unwrap();
    profile.id = "r11-fake".into();
    profile.label = "R11 scripted fixture".into();
    profile.preset = None; // No preset lookup, npx, downloads or provider prompts.
    profile.command = node.to_string_lossy().into_owned();
    profile.args = vec![script.to_string_lossy().into_owned()];
    profile.extra_mcp_servers.clear();
    profile.env = vec![
        Env {
            name: "PATH".into(),
            value: String::new(),
        },
        Env {
            name: "JAM_TEST_RECORD".into(),
            value: root.join("received.json").to_string_lossy().into_owned(),
        },
        Env {
            name: "JAM_TEST_CRASH".into(),
            value: if crash { "1" } else { "0" }.into(),
        },
    ];
    let (executable, args) = profile.launch_command().unwrap();
    assert_eq!(
        executable.canonicalize().unwrap(),
        node.canonicalize().unwrap()
    );
    assert_eq!(args, vec![script.to_string_lossy().into_owned()]);
    profile_store
        .set_setting(
            "agent_profiles",
            &serde_json::to_string(&vec![profile]).unwrap(),
        )
        .unwrap();
    manager
}

#[test]
fn r11_canonical_locator_stdio_http_and_legacy_bytes() {
    let root = scratch();
    let legacy = jam_core::Store::open(root.join("jam.db")).unwrap();
    legacy.seed_demo().unwrap();
    let board = context(&legacy, &root);
    let before = serde_json::to_vec(&mcp_entries(&board, "Brain", &[]).unwrap()).unwrap();
    let (legacy_binding, _lease) = ProjectBinding::capture(&legacy).unwrap();
    let mut entries = mcp_entries(&board, "Brain", &[]).unwrap();
    legacy_binding.wire(&mut entries);
    assert_eq!(before, serde_json::to_vec(&entries).unwrap());
    // Exact legacy non-secret launch spec, with no new serialized keys.
    let value: serde_json::Value = serde_json::from_slice(&before).unwrap();
    assert_eq!(
        value[0],
        serde_json::json!({
            "enabled":true,"preset":"custom","trustReadOnly":true,"name":"jam-board",
            "command":board.sidecar_path.to_string_lossy(),"args":[],"env":[
                {"name":"JAM_BOARD_PROJECT","value":board.project_id},
                {"name":"JAM_BOARD_DATA_DIR","value":board.data_dir.to_string_lossy()},
                {"name":"JAM_AGENT_NAME","value":"Brain"}
            ]
        })
    );
    let projects = jam_core::ProjectManager::new(root.join("local-runtime")).unwrap();
    let handle = projects
        .create(&root.join("Доска 🪐 with spaces"), "Folder A", false)
        .unwrap();
    let board = context(&handle.store, &root);
    let (binding, _lease) = ProjectBinding::capture(&handle.store).unwrap();
    let mut entries = mcp_entries(&board, "Brain", &[]).unwrap();
    binding.wire(&mut entries);
    assert!(
        entries[0]
            .env
            .iter()
            .any(|e| e.name == "JAM_BOARD_PROJECT_FOLDER" && Path::new(&e.value) == handle.folder)
    );
    entries[0].http = Some(McpHttp {
        url: "http://127.0.0.1:47321/mcp".into(),
        bearer_secret_key: None,
    });
    entries[0].bearer_token = Some("r11-fictional-bearer-canary".into());
    for preset in ["claude-cli", "codex-cli"] {
        let (_, argv) = terminal_command(Some(preset), "fictional-cli", &[], &entries).unwrap();
        assert!(argv.join(" ").contains("X-Jam-Project-Folder"));
        assert!(argv.join(" ").contains("utf8:"));
        assert!(!argv.join(" ").contains("r11-fictional-bearer-canary"));
        assert!(
            terminal_environment(Some(preset), "fictional-cli", &entries)
                .unwrap()
                .iter()
                .any(|e| e.value == "r11-fictional-bearer-canary")
        );
    }
    assert!(
        !serde_json::to_string(&entries)
            .unwrap()
            .contains("r11-fictional-bearer-canary")
    );
}

#[test]
fn r11_cwd_precedence_and_missing_directory_fail_closed() {
    let root = scratch();
    let projects = jam_core::ProjectManager::new(root.join("app-local")).unwrap();
    let h = projects.create(&root.join("anchor"), "A", false).unwrap();
    let board = context(&h.store, &root);
    let (binding, lease) = ProjectBinding::capture(&h.store).unwrap();
    let repository = h.store.folder_session_context().unwrap().repository_root;
    assert_eq!(
        binding.cwd(&board, None).unwrap().canonicalize().unwrap(),
        PathBuf::from(repository.unwrap_or_else(|| h.folder.to_string_lossy().into_owned()))
            .canonicalize()
            .unwrap()
    );
    drop(lease);
    let worktree = root.join("Unity worktree");
    std::fs::create_dir(&worktree).unwrap();
    working_directory(&h.store, &worktree);
    let (binding, _lease) = ProjectBinding::capture(&h.store).unwrap();
    assert_eq!(binding.cwd(&board, None).unwrap(), worktree);
    assert_eq!(binding.cwd(&board, root.to_str()).unwrap(), root);
    std::fs::remove_dir(&worktree).unwrap();
    assert!(
        binding
            .cwd(&board, None)
            .unwrap_err()
            .to_string()
            .contains("existing directory")
    );
    assert_eq!(binding.cwd(&board, root.to_str()).unwrap(), root);
    let mut without_repository = binding.clone();
    without_repository.default_cwd = Some(h.folder.to_string_lossy().into_owned());
    assert_eq!(without_repository.cwd(&board, None).unwrap(), h.folder);
}

#[test]
fn r11_resume_refuses_missing_original_database_and_changed_generation() {
    let root = scratch();
    let store = jam_core::Store::open(root.join("jam.db")).unwrap();
    store.seed_demo().unwrap();
    let (mut binding, _lease) = ProjectBinding::capture(&store).unwrap();
    binding.database_generation = "stale-generation".into();
    let error = match binding.reconnect() {
        Ok(_) => panic!("Stale generation must fail"),
        Err(e) => e,
    };
    assert!(error.to_string().contains("reconnect"));
    binding.database_path = root.join("absent-original.db");
    let error = match binding.reconnect() {
        Ok(_) => panic!("Missing source must fail"),
        Err(e) => e,
    };
    assert!(error.to_string().contains("original board is unavailable"));
    assert!(!binding.database_path.exists());
}

#[tokio::test]
async fn r11_worktree_launch_history_cwd_and_selection_are_immutable() {
    let root = scratch();
    let projects = jam_core::ProjectManager::new(root.join("app-local")).unwrap();
    let a = projects.create(&root.join("anchor-A"), "A", false).unwrap();
    let worktree = root.join("Unity worktree A");
    std::fs::create_dir(&worktree).unwrap();
    working_directory(&a.store, &worktree);
    let profile_store = Arc::new(jam_core::Store::open(root.join("profiles.db")).unwrap());
    let manager = runtime(profile_store, &root, false);
    let board = context(&a.store, &root);
    working_directory(&a.store, &root.join("missing-worktree"));
    let error = manager
        .start_for_store(
            &a.store,
            root.clone(),
            board.sidecar_path.clone(),
            input("r11-fake"),
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("missing or unreachable"));
    assert!(!root.join("received.json").exists());
    assert!(manager.sessions(&a.project_id).is_empty());
    working_directory(&a.store, &worktree);
    let view = manager
        .start_for_store(
            &a.store,
            root.clone(),
            board.sidecar_path,
            input("r11-fake"),
        )
        .await
        .unwrap();
    let b = projects.create(&root.join("anchor-B"), "B", false).unwrap();
    assert_eq!(
        projects.capture_selected().unwrap().project_id,
        b.project_id
    );
    assert_eq!(manager.sessions(&a.project_id)[0].project_id, a.project_id);
    let recorded: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("received.json")).unwrap()).unwrap();
    assert_eq!(
        Path::new(recorded["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        worktree.canonicalize().unwrap()
    );
    assert_eq!(
        Path::new(recorded["params"]["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        worktree.canonicalize().unwrap()
    );
    let env = recorded["params"]["mcpServers"][0]["env"]
        .as_array()
        .unwrap();
    assert!(env.iter().any(|e| e["name"] == "JAM_BOARD_PROJECT_FOLDER"
        && Path::new(e["value"].as_str().unwrap()) == a.folder));
    assert!(
        env.iter()
            .any(|e| e["name"] == "JAM_BOARD_PROJECT" && e["value"] == a.project_id)
    );
    working_directory(&a.store, &root);
    manager.stop(&view.id).await.unwrap();
    let history = manager.history_store(&root, &a.project_id).unwrap();
    assert_eq!(history.load(&view.id).unwrap().cwd, view.cwd);
    assert!(
        manager
            .agent_history(&root, &b.project_id, None, None)
            .unwrap()
            .is_empty()
    );
    let resumed = manager
        .resume_with_user_config(
            &root,
            &a.project_id,
            &view.id,
            Some(UserConfigChoice::Include),
        )
        .await
        .unwrap();
    assert_eq!(resumed.cwd, view.cwd);
    assert_eq!(resumed.project_id, a.project_id);
    manager.stop(&resumed.id).await.unwrap();
    assert_eq!(history.list(None, None).unwrap().len(), 1);
    history.delete(&view.id).unwrap();
    assert!(history.load_binding(&view.id).unwrap().is_none());
}

#[tokio::test]
async fn r11_agent_lease_blocks_move_stop_releases_and_old_history_requires_reconnect() {
    let root = scratch();
    let store = Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap());
    store.seed_demo().unwrap();
    working_directory(&store, &root);
    let project_id = store.active_jam().unwrap().id;
    let manager = runtime(store.clone(), &root, false);
    let board = context(&store, &root);
    let view = manager
        .start_for_store(&store, root.clone(), board.sidecar_path, input("r11-fake"))
        .await
        .unwrap();
    let projects = jam_core::ProjectManager::new(root.join("local-runtime")).unwrap();
    let movement = jam_core::MoveProject {
        project_id: project_id.clone(),
        destination: root.join("moved-board").to_string_lossy().into_owned(),
        request_id: "r11-agent-move".into(),
        cloud_acknowledged: false,
    };
    let error = projects
        .move_project(&store, movement.clone())
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("Disconnect all MCP connections and agent sessions"),
        "{error}"
    );
    manager.stop(&view.id).await.unwrap();
    let moved = projects.move_project(&store, movement).unwrap();
    assert_eq!(moved.state, "committed");
    let error = manager
        .resume(&root, &project_id, &view.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("reconnect"), "{error}");
}

#[tokio::test]
async fn r11_crash_releases_lease_and_failed_launch_never_leaks_it() {
    let root = scratch();
    let store = Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap());
    store.seed_demo().unwrap();
    working_directory(&store, &root);
    let manager = runtime(store.clone(), &root, true);
    let board = context(&store, &root);
    let view = manager
        .start_for_store(
            &store,
            root.clone(),
            board.sidecar_path.clone(),
            input("r11-fake"),
        )
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(15), manager.stop(&view.id))
        .await
        .unwrap()
        .unwrap();
    // A separate launch exits itself, without an explicit stop from the UI.
    let view = manager
        .start_for_store(
            &store,
            root.clone(),
            board.sidecar_path.clone(),
            input("r11-fake"),
        )
        .await
        .unwrap();
    let finished = manager.get(&view.id).unwrap().finished.clone();
    tokio::time::timeout(Duration::from_secs(15), finished.cancelled())
        .await
        .unwrap();
    tokio::task::yield_now().await;
    let mut bad_input = input("r11-fake");
    bad_input.cwd = Some(
        root.join("missing-directory")
            .to_string_lossy()
            .into_owned(),
    );
    assert!(
        manager
            .start_for_store(&store, root.clone(), board.sidecar_path, bad_input)
            .await
            .is_err()
    );
    let projects = jam_core::ProjectManager::new(root.join("local-runtime")).unwrap();
    // Bounded polling tolerates the asynchronous crash-cleanup task.
    let movement = jam_core::MoveProject {
        project_id: store.active_jam().unwrap().id,
        destination: root.join("after-crash").to_string_lossy().into_owned(),
        request_id: "r11-after-crash".into(),
        cloud_acknowledged: false,
    };
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match projects.move_project(&store, movement.clone()) {
                Ok(receipt) => {
                    assert_eq!(receipt.state, "committed");
                    break;
                }
                Err(e) if e.to_string().contains("Disconnect all MCP") => {
                    tokio::time::sleep(Duration::from_millis(20)).await
                }
                Err(e) => panic!("{e}"),
            }
        }
    })
    .await
    .unwrap();
}
