//! B7/B9/O1: only scripted adapters and in-memory ACP peers. Never launch a preset.
use super::*;
use crate::tests::{MemoryCredentials, directory, events, session};

#[test]
fn b7_launch_steps_have_stable_start_end_and_bounded_redacted_logs() {
    let s = session(SessionStatus::Starting);
    s.launch_step("initialize", LaunchStepState::Running, "Initializing");
    let started = s.inner.lock().unwrap().launch_steps["initialize"]
        .started_at
        .clone();
    s.launch_step(
        "initialize",
        LaunchStepState::Ok,
        "Initialized fake-secret-for-tests",
    );
    let wire = serde_json::to_value(events(&s).last().unwrap()).unwrap();
    assert_eq!(wire["step"], "initialize");
    assert_eq!(wire["state"], "ok");
    assert_eq!(wire["startedAt"], started);
    assert!(wire["endedAt"].as_str().is_some());
    let diagnostic = "Authorization: Basic synthetic-basic-token API_KEY=synthetic-api-key";
    let redacted = crate::wiring::launch_config::redact_diagnostic(diagnostic);
    assert!(!redacted.contains("synthetic-"));
    assert_eq!(
        crate::wiring::launch_config::redact_diagnostic(&redacted),
        redacted
    );
    for i in 0..620 {
        s.adapter_log(&format!(
            "line {i} fake-secret-for-tests Authorization: Bearer synthetic-unknown-token"
        ));
    }
    let inner = s.inner.lock().unwrap();
    assert_eq!(inner.launch_log.len(), 500);
    let logs = serde_json::to_string(&inner.launch_log).unwrap();
    assert!(logs.contains("line 120"));
    assert!(logs.contains("line 619"));
    assert!(!logs.contains("line 119 "));
    assert!(!logs.contains("fake-secret-for-tests"));
    assert!(!logs.contains("synthetic-unknown-token"));
}

#[tokio::test]
async fn b7_stderr_split_credentials_and_oversized_lines_do_not_leak() {
    use tokio::io::AsyncWriteExt;
    let s = session(SessionStatus::Starting);
    let (mut writer, reader) = tokio::io::duplex(64);
    let task = tokio::spawn(async move {
        writer.write_all(b"prefix fake-secret-").await.unwrap();
        tokio::task::yield_now().await;
        writer.write_all(b"for-tests\n").await.unwrap();
        writer.write_all(&vec![b'a'; 20 * 1024]).await.unwrap();
        writer
            .write_all(b"fake-secret-for-tests\nlast line")
            .await
            .unwrap();
    });
    let tail = std::sync::Mutex::new(String::new());
    read_adapter_stderr(&s, reader, &tail).await;
    task.await.unwrap();
    let logs = serde_json::to_string(&events(&s)).unwrap();
    assert!(!logs.contains("fake-secret-for-tests"));
    assert!(logs.contains("over 16 KiB"));
    assert!(logs.contains("last line"));
    assert!(tail.lock().unwrap().len() < 8192);
}

#[test]
fn b7_terminal_steps_wait_for_actual_spawn_ready_and_close_on_stop() {
    let s = session(SessionStatus::Starting);
    s.launch_step(
        "start_process",
        LaunchStepState::Running,
        "Awaiting fitted PTY size",
    );
    s.launch_step(
        "mcp:board",
        LaunchStepState::Running,
        "Awaiting adapter evidence",
    );
    s.status(
        SessionStatus::Starting,
        Some("Terminal renderer: {}".into()),
    );
    assert_eq!(
        s.inner.lock().unwrap().launch_steps["start_process"].state,
        LaunchStepState::Running
    );
    assert!(!s.inner.lock().unwrap().launch_steps.contains_key("ready"));
    s.status(
        SessionStatus::Starting,
        Some("Terminal startup: spawned; request_to_spawn_ms=3".into()),
    );
    assert_eq!(
        s.inner.lock().unwrap().launch_steps["start_process"].state,
        LaunchStepState::Ok
    );
    s.status(SessionStatus::Ready, Some("Terminal first output".into()));
    assert_eq!(
        s.inner.lock().unwrap().launch_steps["mcp:board"].state,
        LaunchStepState::Skipped
    );
    assert_eq!(
        s.inner.lock().unwrap().launch_steps["ready"].state,
        LaunchStepState::Ok
    );
    let stopped = session(SessionStatus::Starting);
    stopped.launch_step("start_process", LaunchStepState::Running, "Awaiting size");
    stopped.status(SessionStatus::Stopped, None);
    assert_eq!(
        stopped.inner.lock().unwrap().launch_steps["start_process"].state,
        LaunchStepState::Skipped
    );
}

#[test]
fn b7_recorded_codex_mcp_conflict_reason_is_retained_without_claiming_success() {
    let s = session(SessionStatus::Starting);
    let reason = "[codex-acp] MCP server `jam-board` was not started, because the Codex config already defines an MCP server with this name. Codex uses its own entry, or no server if that entry is disabled.";
    map_update(
        &s,
        json!({"sessionUpdate":"tool_call","toolCallId":"mcp_startup.jam-board.fixture","title":"mcp__jam-board__startup","kind":"other","status":"failed","content":[{"type":"content","content":{"type":"text","text":reason}}]}),
    );
    let inner = s.inner.lock().unwrap();
    let step = &inner.launch_steps["mcp:jam-board"];
    assert_eq!(step.state, LaunchStepState::Failed);
    assert_eq!(step.message, reason);
}

#[tokio::test]
async fn b9_acp_recorded_usage_error_is_emitted_once_without_auto_retry() {
    let s = session(SessionStatus::Starting);
    let prompts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = prompts.clone();
    let agent = sdk::Agent
        .builder()
        .on_receive_request(
            async move |_req: a::InitializeRequest,
                        reply: sdk::Responder<a::InitializeResponse>,
                        _cx| {
                reply.respond(a::InitializeResponse::new(ProtocolVersion::V1))
            },
            sdk::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: a::NewSessionRequest,
                        reply: sdk::Responder<a::NewSessionResponse>,
                        _cx| reply.respond(a::NewSessionResponse::new("usage-fixture")),
            sdk::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: a::PromptRequest, reply: sdk::Responder<a::PromptResponse>, _cx| {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut error = sdk::Error::internal_error()
                    .data(json!({"codexErrorInfo":"usageLimitExceeded"}));
                error.message =
                    "You've hit your usage limit. Please try again at Nov 2nd, 2026 4:27 PM."
                        .into();
                reply.respond_with_error(error)
            },
            sdk::on_receive_request!(),
        );
    let (tx, rx) = mpsc::unbounded_channel();
    let (ready, ready_rx) = oneshot::channel();
    let runtime = s.clone();
    let task = tokio::spawn(async move { run_connection(runtime, agent, vec![], rx, ready).await });
    ready_rx.await.unwrap().unwrap();
    let (reply, sent) = oneshot::channel();
    tx.send(Control::Prompt(
        vec![PromptPart::Text {
            text: "Synthetic input to in-memory peer only".into(),
        }],
        reply,
    ))
    .unwrap();
    sent.await.unwrap().unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if events(&s)
                .iter()
                .any(|e| matches!(e.event, AgentEventKind::TurnEnd { .. }))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(prompts.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(
        !events(&s)
            .iter()
            .any(|e| matches!(e.event, AgentEventKind::Retrying { .. }))
    );
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::Error { code: Some(AgentErrorCode::UsageLimit), retryable: false, resets_at: Some(date), .. } if date == "2026-11-02T16:27:00")));
    task.abort();
    let _ = task.await;
}

#[test]
fn o1_default_persists_ask_blocks_unconfirmed_launch_and_unknown_exclusion() {
    let root = directory();
    let store = Arc::new(jam_core::Store::open(root.join("settings.db")).unwrap());
    let profiles = Profiles::new(store.clone(), Arc::new(MemoryCredentials::default()));
    assert_eq!(
        profiles.user_config_default().unwrap(),
        UserConfigDefault::Ask
    );
    assert!(profiles.user_config_choice(None, RuntimeKind::Acp).is_err());
    assert_eq!(
        profiles
            .user_config_choice(Some(UserConfigChoice::Include), RuntimeKind::Terminal)
            .unwrap(),
        UserConfigChoice::Include
    );
    profiles
        .save_user_config_default(UserConfigDefault::Exclude)
        .unwrap();
    let reopened = Profiles::new(store, Arc::new(MemoryCredentials::default()));
    assert!(reopened.user_config_choice(None, RuntimeKind::Acp).is_err());
    assert_eq!(
        reopened
            .launch_options("codex")
            .unwrap()
            .user_config_default,
        UserConfigDefault::Exclude
    );
    assert!(
        reopened
            .launch_options("codex")
            .unwrap()
            .exclude_description
            .contains("Global AGENTS.md")
    );
    let mut custom = reopened.get("codex").unwrap();
    custom.preset = None;
    custom.command = "custom-fixture".into();
    custom.args.clear();
    assert!(!crate::wiring::launch_config::exclude_description(&custom).0);
    assert!(
        crate::wiring::launch_config::apply_user_config(
            &custom,
            UserConfigChoice::Exclude,
            &mut vec![],
            &mut vec![]
        )
        .is_err()
    );
}

#[test]
fn o1_exclusion_uses_supported_options_and_keeps_auth_locations_untouched() {
    let root = directory();
    let auth = root.join("auth.json");
    std::fs::write(&auth, "synthetic-auth-never-copy").unwrap();
    let config = "mcp_servers = { inline = { command = 'fake' } }\n[mcp_servers.\"personal.docs\"]\ncommand='fake'\n[profiles.test.mcp_servers.profile_server]\ncommand='fake'\n";
    std::fs::write(root.join("config.toml"), config).unwrap();
    let store = Arc::new(jam_core::Store::open(root.join("settings.db")).unwrap());
    let profiles = Profiles::new(store, Arc::new(MemoryCredentials::default()));
    for id in ["codex", "codex-cli", "claude-code", "claude-cli"] {
        let profile = profiles.get(id).unwrap();
        let mut included_args = vec!["original".into()];
        let mut included_env = vec![Env {
            name: "AUTH_FIXTURE".into(),
            value: "synthetic-auth".into(),
        }];
        assert!(
            crate::wiring::launch_config::apply_user_config(
                &profile,
                UserConfigChoice::Include,
                &mut included_args,
                &mut included_env
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(included_args, ["original"]);
        assert_eq!(included_env[0].value, "synthetic-auth");
        let mut args = vec!["original".into()];
        let mut env = vec![
            Env {
                name: "CODEX_HOME".into(),
                value: root.to_string_lossy().into_owned(),
            },
            Env {
                name: "CLAUDE_CONFIG_DIR".into(),
                value: root.to_string_lossy().into_owned(),
            },
            Env {
                name: "CODEX_CONFIG".into(),
                value: "{\"model\":\"fixture\"}".into(),
            },
        ];
        let meta = crate::wiring::launch_config::apply_user_config(
            &profile,
            UserConfigChoice::Exclude,
            &mut args,
            &mut env,
        )
        .unwrap();
        assert_eq!(env[0].value, root.to_string_lossy());
        assert_eq!(env[1].value, root.to_string_lossy());
        assert!(!args.join(" ").contains("synthetic-auth"));
        match id {
            "claude-code" => {
                let meta = meta.unwrap();
                assert_eq!(
                    meta["claudeCode"]["options"]["settingSources"],
                    json!(["project", "local"])
                );
                assert_eq!(meta["claudeCode"]["options"]["strictMcpConfig"], true);
                assert_eq!(
                    meta["claudeCode"]["options"]["settings"]["disableAllHooks"],
                    true
                );
            }
            "claude-cli" => {
                assert!(
                    args.windows(2)
                        .any(|a| a == ["--setting-sources", "project,local"])
                );
                assert!(args.contains(&"--strict-mcp-config".into()));
            }
            "codex" => {
                let config: Value = serde_json::from_str(&env.last().unwrap().value).unwrap();
                assert_eq!(config["model"], "fixture");
                assert_eq!(config["features.hooks"], false);
                for name in ["inline", "personal.docs", "profile_server"] {
                    assert_eq!(
                        config[format!(
                            "mcp_servers.{}.enabled",
                            serde_json::to_string(name).unwrap()
                        )],
                        false
                    );
                }
            }
            "codex-cli" => {
                assert!(args.iter().any(|a| a == "features.hooks=false"));
                assert!(
                    args.iter()
                        .any(|a| a == "mcp_servers.\"personal.docs\".enabled=false")
                );
            }
            _ => unreachable!(),
        }
    }
    assert_eq!(
        std::fs::read_to_string(auth).unwrap(),
        "synthetic-auth-never-copy"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("config.toml")).unwrap(),
        config
    );
    for settings in [
        json!({"apiKeyHelper":"synthetic-auth-helper"}),
        json!({"env":{"ANTHROPIC_AUTH_TOKEN":"synthetic-native-token"}}),
    ] {
        std::fs::write(root.join("settings.json"), settings.to_string()).unwrap();
        for id in ["claude-code", "claude-cli"] {
            let profile = profiles.get(id).unwrap();
            let mut args = vec![];
            let mut env = vec![Env {
                name: "CLAUDE_CONFIG_DIR".into(),
                value: root.to_string_lossy().into_owned(),
            }];
            let meta = crate::wiring::launch_config::apply_user_config(
                &profile,
                UserConfigChoice::Exclude,
                &mut args,
                &mut env,
            )
            .unwrap();
            if let Some(meta) = meta {
                assert_eq!(
                    meta["claudeCode"]["options"]["settingSources"],
                    json!(["user", "project", "local"])
                );
            } else {
                assert!(args.iter().any(|v| v == "user,project,local"));
            }
            assert!(
                !args.join(" ").contains("synthetic-"),
                "Native auth config must not be copied into argv"
            );
        }
        assert_eq!(
            serde_json::from_str::<Value>(
                &std::fs::read_to_string(root.join("settings.json")).unwrap()
            )
            .unwrap(),
            settings
        );
    }
}

#[tokio::test]
async fn b7_o1_scripted_terminal_exclusion_preserves_auth_and_waits_for_fit() {
    for family in ["claude-cli", "codex-cli"] {
        let s = session(SessionStatus::Starting);
        let root = s.board.data_dir.clone();
        std::fs::write(
            root.join("config.toml"),
            "[mcp_servers.personal]\ncommand='never-run'\n",
        )
        .unwrap();
        let store = Arc::new(jam_core::Store::open(root.join("settings.db")).unwrap());
        let manager = SessionManager::new(
            store.clone(),
            Arc::new(MemoryCredentials::default()),
            |_| {},
            |_| {},
        );
        let mut profile = fake_profile(
            &manager,
            family,
            &root,
            r#"require('fs').writeFileSync(process.env.JAM_B2_CAPTURE,JSON.stringify({argv:process.argv.slice(2),auth:process.env.JAM_B2_AUTH_TOKEN}));console.log('Scripted terminal ready');setInterval(()=>{},1000);"#,
        );
        profile.env.push(Env {
            name: "JAM_B2_AUTH_TOKEN".into(),
            value: "synthetic-auth".into(),
        });
        store
            .set_setting(
                "agent_profiles",
                &serde_json::to_string(&vec![profile.clone()]).unwrap(),
            )
            .unwrap();
        let view = manager
            .start(
                s.board.clone(),
                StartAgentSessionInput {
                    profile_id: profile.id,
                    user_config: Some(UserConfigChoice::Exclude),
                    cwd: None,
                    model: None,
                    effort: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(view.status, SessionStatus::Starting);
        assert!(
            !root.join("captured.jsonl").exists(),
            "No process before fitted-size handshake"
        );
        manager
            .terminal_resize(TerminalResizeInput {
                session_id: view.id.clone(),
                cols: 80,
                rows: 24,
            })
            .unwrap();
        let captured = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if manager.get(&view.id).unwrap().view().status == SessionStatus::Ready
                    && let Ok(text) = std::fs::read_to_string(root.join("captured.jsonl"))
                    && let Ok(value) = serde_json::from_str::<Value>(&text)
                {
                    break value;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        manager.stop(&view.id).await.unwrap();
        let captured = captured.expect("Scripted terminal did not become ready");
        assert_eq!(captured["auth"], "synthetic-auth");
        let argv = captured["argv"].as_array().unwrap();
        if family == "claude-cli" {
            assert!(argv.iter().any(|v| v == "--strict-mcp-config"));
            assert!(argv.iter().any(|v| v == "project,local"));
        } else {
            assert!(
                argv.iter()
                    .any(|v| v == "mcp_servers.\"personal\".enabled=false")
            );
        }
        assert!(
            !argv
                .iter()
                .any(|v| v.as_str().is_some_and(|v| v.contains("synthetic-auth")))
        );
        let log = manager.launch_logs(&view.id).unwrap();
        assert!(log.iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "start_process" && launch.state == LaunchStepState::Ok && launch.message == "Terminal process spawned")));
        assert!(log.iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "ready" && launch.state == LaunchStepState::Ok)));
    }
}

#[tokio::test]
async fn b7_resolution_failure_is_retained_without_spawning_any_process() {
    let s = session(SessionStatus::Starting);
    let root = s.board.data_dir.clone();
    let store = Arc::new(jam_core::Store::open(root.join("settings.db")).unwrap());
    let manager = SessionManager::new(
        store.clone(),
        Arc::new(MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let mut profile = manager.profiles.get("codex").unwrap();
    profile.id = "b2-missing-fixture".into();
    profile.command = root.join("does-not-exist").to_string_lossy().into_owned();
    profile.args.clear();
    store
        .set_setting(
            "agent_profiles",
            &serde_json::to_string(&vec![profile.clone()]).unwrap(),
        )
        .unwrap();
    assert!(
        manager
            .start(
                s.board.clone(),
                StartAgentSessionInput {
                    profile_id: profile.id,
                    user_config: Some(UserConfigChoice::Include),
                    cwd: None,
                    model: None,
                    effort: None
                }
            )
            .await
            .is_err()
    );
    let views = manager.sessions(&s.board.project_id);
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].status, SessionStatus::Failed);
    assert!(manager.launch_logs(&views[0].id).unwrap().iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "resolve_executable" && launch.state == LaunchStepState::Failed)));
}

#[tokio::test]
async fn b7_stop_during_scripted_initialize_closes_running_steps_without_ready() {
    let s = session(SessionStatus::Starting);
    let root = s.board.data_dir.clone();
    let store = Arc::new(jam_core::Store::open(root.join("settings.db")).unwrap());
    let manager = Arc::new(SessionManager::new(
        store.clone(),
        Arc::new(MemoryCredentials::default()),
        |_| {},
        |_| {},
    ));
    let profile = fake_profile(
        &manager,
        "codex",
        &root,
        "require('readline').createInterface({input:process.stdin}).on('line',()=>{});setInterval(()=>{},1000);",
    );
    store
        .set_setting(
            "agent_profiles",
            &serde_json::to_string(&vec![profile.clone()]).unwrap(),
        )
        .unwrap();
    let worker = manager.clone();
    let board = s.board.clone();
    let startup = tokio::spawn(async move {
        worker
            .start(
                board,
                StartAgentSessionInput {
                    profile_id: profile.id,
                    user_config: Some(UserConfigChoice::Include),
                    cwd: None,
                    model: None,
                    effort: None,
                },
            )
            .await
    });
    let pending = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(view) = manager.sessions(&s.board.project_id).first()
                && manager.launch_logs(&view.id).unwrap().iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "initialize" && launch.state == LaunchStepState::Running)) { break view.id.clone(); }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await;
    manager.stop_all().await;
    let id = pending.expect("Fake initialize was not reached");
    assert!(startup.await.unwrap().is_err());
    let log = manager.launch_logs(&id).unwrap();
    assert!(log.iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "initialize" && launch.state == LaunchStepState::Skipped)));
    assert!(
        !log.iter()
            .any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "ready"))
    );
}

fn fake_profile(
    manager: &SessionManager,
    family: &str,
    root: &std::path::Path,
    script: &str,
) -> crate::profiles::Profile {
    let node = which::which("node").unwrap().canonicalize().unwrap();
    assert_eq!(
        node.file_stem()
            .unwrap()
            .to_string_lossy()
            .to_ascii_lowercase(),
        "node"
    );
    let fake = root.join("scripted-adapter.cjs");
    std::fs::write(&fake, script).unwrap();
    let canonical_fake = fake.canonicalize().unwrap();
    assert!(
        canonical_fake.starts_with(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../test-visuals/round7/b2-launch-events")
                .canonicalize()
                .unwrap()
        )
    );
    let mut profile = manager.profiles.get(family).unwrap();
    profile.id = format!("b2-fixture-{family}");
    profile.command = node.to_string_lossy().into_owned();
    // Node's Windows module loader rejects verbatim-prefixed script paths on
    // hosted runners. Launch the ordinary absolute path, still checked below.
    profile.args = vec![
        std::path::absolute(&fake)
            .unwrap()
            .to_string_lossy()
            .into_owned(),
    ];
    profile.env = vec![
        Env {
            name: "PATH".into(),
            value: String::new(),
        },
        Env {
            name: "CODEX_HOME".into(),
            value: root.to_string_lossy().into_owned(),
        },
        Env {
            name: "CLAUDE_CONFIG_DIR".into(),
            value: root.to_string_lossy().into_owned(),
        },
        Env {
            name: "JAM_B2_CAPTURE".into(),
            value: root.join("captured.jsonl").to_string_lossy().into_owned(),
        },
    ];
    let (resolved, args) = profile.launch_command().unwrap();
    assert_eq!(resolved.canonicalize().unwrap(), node);
    assert_eq!(
        std::path::Path::new(&args[0]).canonicalize().unwrap(),
        canonical_fake
    );
    profile
}

#[tokio::test]
async fn b7_o1_scripted_acp_start_logs_and_exclusion_reach_the_real_process_boundary() {
    for family in ["claude-code", "codex"] {
        let s = session(SessionStatus::Starting);
        let root = s.board.data_dir.clone();
        std::fs::write(
            root.join("config.toml"),
            "[mcp_servers.personal]\ncommand='never-run'\n",
        )
        .unwrap();
        let store = Arc::new(jam_core::Store::open(root.join("settings.db")).unwrap());
        let manager = SessionManager::new(
            store.clone(),
            Arc::new(MemoryCredentials::default()),
            |_| {},
            |_| {},
        );
        let script = r#"const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});
fs.appendFileSync(process.env.JAM_B2_CAPTURE,JSON.stringify({argv:process.argv.slice(2),codexConfig:process.env.CODEX_CONFIG||null})+'\n');
rl.on('line',line=>{const r=JSON.parse(line);fs.appendFileSync(process.env.JAM_B2_CAPTURE,JSON.stringify(r)+'\n');let result;if(r.method==='initialize'){console.error('synthetic stderr Authorization: Bearer synthetic-unknown-token');result={protocolVersion:1,agentCapabilities:{loadSession:true}}}else if(r.method==='session/new'){result={sessionId:'native-fixture'}}else if(r.method==='session/load'){result={}}else{throw Error('Unexpected fake method '+r.method)}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');});"#;
        let profile = fake_profile(&manager, family, &root, script);
        store
            .set_setting(
                "agent_profiles",
                &serde_json::to_string(&vec![profile.clone()]).unwrap(),
            )
            .unwrap();
        let view = manager
            .start(
                s.board.clone(),
                StartAgentSessionInput {
                    profile_id: profile.id.clone(),
                    user_config: Some(UserConfigChoice::Exclude),
                    cwd: None,
                    model: None,
                    effort: None,
                },
            )
            .await
            .unwrap();
        manager.stop(&view.id).await.unwrap();
        let log = manager.launch_logs(&view.id).unwrap();
        for expected in [
            "resolve_executable",
            "start_process",
            "initialize",
            "session",
            "ready",
        ] {
            assert!(log.iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == expected && launch.state == LaunchStepState::Ok)), "{expected}");
        }
        assert!(log.iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step.starts_with("mcp:") && launch.state == LaunchStepState::Skipped)));
        let text = serde_json::to_string(&log).unwrap();
        assert!(text.contains("synthetic stderr"));
        assert!(!text.contains("synthetic-unknown-token"));
        let rows = std::fs::read_to_string(root.join("captured.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        let request = rows.iter().find(|r| r["method"] == "session/new").unwrap();
        if family == "claude-code" {
            assert_eq!(
                request["params"]["_meta"]["claudeCode"]["options"]["strictMcpConfig"],
                true
            );
        } else {
            let config: Value =
                serde_json::from_str(rows[0]["codexConfig"].as_str().unwrap()).unwrap();
            assert_eq!(config["mcp_servers.\"personal\".enabled"], false);
        }
        // Resume goes through the same explicit choice and ACP metadata path.
        let resumed = manager
            .resume_with_user_config(
                &root,
                &s.board.project_id,
                &view.id,
                Some(UserConfigChoice::Exclude),
            )
            .await
            .unwrap();
        manager.stop(&resumed.id).await.unwrap();
        let rows = std::fs::read_to_string(root.join("captured.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        let request = rows.iter().find(|r| r["method"] == "session/load").unwrap();
        assert_eq!(request["params"]["sessionId"], "native-fixture");
        if family == "claude-code" {
            assert_eq!(
                request["params"]["_meta"]["claudeCode"]["options"]["settingSources"],
                json!(["project", "local"])
            );
        }
    }
}
