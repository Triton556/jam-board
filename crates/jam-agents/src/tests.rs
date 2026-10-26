use super::*;
use crate::session::{Control, Session, SessionInner};
use agent_client_protocol::{
    self as sdk,
    schema::{ProtocolVersion, v1 as a},
};
use serde_json::json;
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

#[derive(Default)]
pub(crate) struct MemoryCredentials(Mutex<BTreeMap<String, String>>);
impl CredentialStore for MemoryCredentials {
    fn get(&self, p: &str, k: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(&format!("{p}:{k}")).cloned())
    }
    fn set(&self, p: &str, k: &str, v: &str) -> Result<()> {
        self.0.lock().unwrap().insert(format!("{p}:{k}"), v.into());
        Ok(())
    }
    fn clear(&self, p: &str, k: &str) -> Result<()> {
        self.0.lock().unwrap().remove(&format!("{p}:{k}"));
        Ok(())
    }
}
pub(crate) fn directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!("jam-agents-test-{}", ulid::Ulid::generate()));
    std::fs::create_dir_all(&path).unwrap();
    path
}
fn board() -> BoardContext {
    let dir = directory();
    std::fs::write(
        dir.join("jam-board-mcp.exe"),
        "Fictional test sidecar; never executed",
    )
    .unwrap();
    BoardContext {
        project_id: "project-a".into(),
        project_name: "Fictional board".into(),
        key_prefix: "FB".into(),
        project_folder: None,
        sidecar_path: dir.join("jam-board-mcp.exe"),
        data_dir: dir,
    }
}
pub(crate) fn session(status: SessionStatus) -> Arc<Session> {
    session_with_media(status, None)
}
pub(crate) fn session_with_media(
    status: SessionStatus,
    attachment_media: Option<Arc<dyn AttachmentMedia>>,
) -> Arc<Session> {
    let board = board();
    Arc::new(Session {
        history_writer: Mutex::new(None),
        inner: Mutex::new(SessionInner {
            view: AgentSessionView {
                id: "session-a".into(),
                profile_id: "test".into(),
                project_id: board.project_id.clone(),
                kind: RuntimeKind::Acp,
                title: "Test".into(),
                status,
                cwd: board.data_dir.to_string_lossy().into_owned(),
                created_at: crate::session::now(),
                capabilities: Capabilities::default(),
                model: None,
                effort: None,
            },
            events: VecDeque::new(),
            seq: 0,
            permissions: BTreeMap::new(),
            first_prompt: true,
            last_prompt: None,
            last_turn_failed: false,
            last_failure_code: None,
            message_id: None,
            scrollback: String::new(),
            config: BTreeMap::new(),
            boolean_config: vec![],
            legacy_mode: false,
            cancelling: false,
            text_pending: String::new(),
            attachments: BTreeMap::new(),
            resume_events: vec![],
            resume_native_id: None,
            replaying: false,
        }),
        board,
        connector: Mutex::new(None),
        secrets: vec!["fake-secret-for-tests".into()],
        attachment_media,
        dock_sink: Arc::new(|_| {}),
        terminal_sink: Arc::new(|_| {}),
        stop: tokio_util::sync::CancellationToken::new(),
        finished: tokio_util::sync::CancellationToken::new(),
    })
}
pub(crate) fn events(s: &Session) -> Vec<AgentDockEvent> {
    s.inner.lock().unwrap().events.iter().cloned().collect()
}

#[test]
// BC01 / H-BD01 / AG16: persistent profiles and pinned board configuration.
fn bd_profiles_persist_builtin_edits_hide_and_custom_credentials() {
    let root = directory();
    let store = Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap());
    let credentials = Arc::new(MemoryCredentials::default());
    let profiles = Profiles::new(store.clone(), credentials.clone());
    assert_eq!(profiles.list().unwrap().len(), 10);
    let edited = profiles
        .save(AgentProfileInput {
            id: Some("claude-zai".into()),
            label: "Personal brain".into(),
            hidden: Some(true),
            base_url: Some(Some("https://example.invalid/anthropic".into())),
            model: Some(Some("fictional-model".into())),
            ..Default::default()
        })
        .unwrap();
    assert!(edited.built_in && edited.hidden);
    assert!(profiles.delete("claude-zai").is_err());
    profiles
        .set_secret(
            "claude-zai",
            "ANTHROPIC_AUTH_TOKEN",
            "fake-secret-for-tests",
        )
        .unwrap();
    let reopened = Profiles::new(store.clone(), credentials);
    let view = reopened
        .list()
        .unwrap()
        .into_iter()
        .find(|p| p.id == "claude-zai")
        .unwrap();
    assert_eq!(view.label, "Personal brain");
    assert!(view.hidden && view.secret_keys[0].is_set);
    assert!(
        !serde_json::to_string(&view)
            .unwrap()
            .contains("fake-secret")
    );
    assert!(
        !store
            .setting("agent_profiles")
            .unwrap()
            .unwrap()
            .contains("fake-secret")
    );
    let env = reopened
        .child_env(&reopened.get("claude-zai").unwrap())
        .unwrap();
    assert!(
        env.iter()
            .any(|e| e.name == "ANTHROPIC_BASE_URL"
                && e.value == "https://example.invalid/anthropic")
    );
    assert!(
        env.iter()
            .any(|e| e.name == "ANTHROPIC_MODEL" && e.value == "fictional-model")
    );
    assert!(
        env.iter()
            .any(|e| e.name == "ANTHROPIC_AUTH_TOKEN" && e.value == "fake-secret-for-tests")
    );
    reopened
        .clear_secret("claude-zai", "ANTHROPIC_AUTH_TOKEN")
        .unwrap();
    assert!(
        !reopened
            .list()
            .unwrap()
            .into_iter()
            .find(|p| p.id == "claude-zai")
            .unwrap()
            .secret_keys[0]
            .is_set
    );
    let custom = reopened
        .save(AgentProfileInput {
            label: "Custom".into(),
            kind: RuntimeKind::Terminal,
            command: Some("missing-fictional-command".into()),
            secret_keys: Some(vec![SecretKey {
                key: "CUSTOM_AUTH".into(),
                label: "Auth".into(),
            }]),
            ..Default::default()
        })
        .unwrap();
    assert!(!custom.available);
    reopened
        .set_secret(&custom.id, "CUSTOM_AUTH", "fake-only")
        .unwrap();
    reopened.delete(&custom.id).unwrap();
    assert!(reopened.get(&custom.id).is_err());
    assert!(
        reopened
            .save(AgentProfileInput {
                id: Some("codex".into()),
                label: "Codex".into(),
                env: Some(vec![Env {
                    name: "OPENAI_API_KEY".into(),
                    value: "fake-only".into()
                }]),
                ..Default::default()
            })
            .is_err()
    );
    assert!(
        reopened
            .child_env(&reopened.get("claude-openrouter").unwrap())
            .unwrap()
            .iter()
            .any(|e| e.name == "ANTHROPIC_API_KEY" && e.value.is_empty())
    );
}

#[test]
fn bd_phase_two_presets_optional_key_and_npx_fallback() {
    let root = directory();
    let store = Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap());
    let credentials = Arc::new(MemoryCredentials::default());
    let profiles = Profiles::new(store.clone(), credentials.clone());
    let claude = profiles.get("claude-code").unwrap();
    assert_eq!(claude.secret_keys[0].key, "ANTHROPIC_API_KEY");
    assert!(
        !profiles
            .child_env(&claude)
            .unwrap()
            .iter()
            .any(|e| e.name == "ANTHROPIC_API_KEY")
    );
    profiles
        .set_secret("claude-code", "ANTHROPIC_API_KEY", "fake-only")
        .unwrap();
    assert!(
        profiles
            .child_env(&claude)
            .unwrap()
            .iter()
            .any(|e| e.name == "ANTHROPIC_API_KEY" && e.value == "fake-only")
    );
    let mut legacy = serde_json::to_value(vec![claude]).unwrap();
    legacy[0]["secretKeys"] = json!([]);
    store
        .set_setting("agent_profiles", &legacy.to_string())
        .unwrap();
    assert_eq!(
        profiles.get("claude-code").unwrap().secret_keys[0].key,
        "ANTHROPIC_API_KEY"
    );
    let cli = profiles.get("claude-cli").unwrap();
    let (path, args) = cli
        .launch_command_with(|command| {
            if command == "npx" {
                Ok(PathBuf::from("C:/Fake/npx.cmd"))
            } else {
                Err(which::Error::CannotFindBinaryPath)
            }
        })
        .unwrap();
    assert_eq!(path, PathBuf::from("C:/Fake/npx.cmd"));
    assert_eq!(args, vec!["-y", "@anthropic-ai/claude-code"]);
    for (id, url) in [
        ("api-openrouter", Some("https://openrouter.ai/api/v1")),
        ("api-zai", Some("https://api.z.ai/api/paas/v4")),
        ("api-custom", None),
    ] {
        let p = profiles.get(id).unwrap();
        assert_eq!(p.kind, RuntimeKind::Api);
        assert_eq!(p.base_url.as_deref(), url);
        assert_eq!(p.secret_keys[0].key, "API_KEY");
        profiles.set_secret(id, "API_KEY", "fake-api-only").unwrap();
        assert!(
            !profiles
                .child_env(&p)
                .unwrap()
                .iter()
                .any(|e| e.name == "API_KEY")
        );
    }
    assert!(
        !store
            .setting("agent_profiles")
            .unwrap()
            .unwrap()
            .contains("fake-")
    );
}

#[test]
fn bd_mcp_and_cwd_are_project_pinned() {
    let mut b = board();
    let entries = mcp_entries(&b, "Brain · dock", &[]).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "jam-board");
    assert!(PathBuf::from(&entries[0].command).is_absolute());
    assert_eq!(
        entries[0].env,
        vec![
            Env {
                name: "JAM_BOARD_PROJECT".into(),
                value: "project-a".into()
            },
            Env {
                name: "JAM_BOARD_DATA_DIR".into(),
                value: b.data_dir.to_string_lossy().into_owned()
            },
            Env {
                name: "JAM_AGENT_NAME".into(),
                value: "Brain · dock".into()
            }
        ]
    );
    let scratch = choose_cwd(&b, None).unwrap();
    assert!(scratch.ends_with("agent-workspace/project-a"));
    b.project_folder = Some(b.data_dir.to_string_lossy().into_owned());
    assert_eq!(
        choose_cwd(&b, None).unwrap(),
        std::path::absolute(&b.data_dir).unwrap()
    );
    assert_eq!(
        choose_cwd(&b, Some(scratch.to_str().unwrap())).unwrap(),
        scratch
    );
    assert!(choose_cwd(&b, Some("fictional-does-not-exist")).is_err());
    b.project_folder = Some("fictional-does-not-exist".into());
    assert_eq!(choose_cwd(&b, None).unwrap(), scratch);
    b.project_id = "../escape".into();
    assert!(choose_cwd(&b, None).is_err());
    let (command, args) = terminal_command(Some("claude-cli"), "claude", &[], &entries).unwrap();
    assert_eq!(command, "claude");
    assert_eq!(args[0], "--mcp-config");
    let value: serde_json::Value = serde_json::from_str(&args[1]).unwrap();
    assert_eq!(
        value["mcpServers"]["jam-board"]["env"]["JAM_BOARD_PROJECT"],
        "project-a"
    );
    let (_, args) = terminal_command(Some("codex-cli"), "codex", &[], &entries).unwrap();
    assert!(
        args.iter()
            .any(|s| s.starts_with("mcp_servers.\"jam-board\".command=\""))
    );
    assert!(
        args.iter()
            .any(|s| s == "mcp_servers.\"jam-board\".env.\"JAM_BOARD_PROJECT\"=\"project-a\"")
    );
}

#[test]
fn bd_store_context_does_not_follow_project_switches() {
    let dir = directory();
    let store = jam_core::Store::open(dir.join("jam.db")).unwrap();
    let (a, _) = store
        .create_jam("A", None, None, None, "UTC", "Human")
        .unwrap();
    store
        .set_setting(
            &format!("board.{}.project_folder", a.id),
            dir.to_str().unwrap(),
        )
        .unwrap();
    let context = BoardContext::from_store(&store, dir.clone(), dir.join("mcp.exe")).unwrap();
    let (b, _) = store
        .create_jam("B", None, None, None, "UTC", "Human")
        .unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(context.project_id, a.id);
    assert_eq!(context.project_folder.as_deref(), dir.to_str());
}

#[test]
fn bd_profile_null_clears_overrides_and_command_detection_uses_first_token() {
    let root = directory();
    let store = Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap());
    let profiles = Profiles::new(store, Arc::new(MemoryCredentials::default()));
    let patch: AgentProfileInput = serde_json::from_value(
        json!({"id":"claude-zai","label":"z.ai","kind":"acp","baseUrl":null,"model":null}),
    )
    .unwrap();
    let saved = profiles.save(patch).unwrap();
    assert_eq!(saved.base_url, None);
    assert_eq!(saved.model, None);
    #[cfg(windows)]
    let command = "cmd.exe /d";
    #[cfg(not(windows))]
    let command = "sh -e";
    let saved = profiles
        .save(AgentProfileInput {
            label: "Tokenized command".into(),
            command: Some(command.into()),
            ..Default::default()
        })
        .unwrap();
    assert!(saved.available);
    let (_, args) = profiles.get(&saved.id).unwrap().launch_command().unwrap();
    assert_eq!(args.len(), 1);
}

#[cfg(windows)]
#[tokio::test]
async fn bd_crashed_acp_keeps_redacted_stderr_and_failed_history() {
    let b = board();
    let store = Arc::new(jam_core::Store::open(b.data_dir.join("jam.db")).unwrap());
    let manager = SessionManager::new(
        store,
        Arc::new(MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let profile = manager
        .profiles
        .save(AgentProfileInput {
            label: "Fictional crash".into(),
            command: Some("cmd.exe".into()),
            args: Some(vec![
                "/d".into(),
                "/c".into(),
                "echo Fictional failure %TEST_AUTH% 1>&2 & exit /b 7".into(),
            ]),
            secret_keys: Some(vec![SecretKey {
                key: "TEST_AUTH".into(),
                label: "Fake".into(),
            }]),
            ..Default::default()
        })
        .unwrap();
    manager
        .profiles
        .set_secret(&profile.id, "TEST_AUTH", "fake-secret-for-tests")
        .unwrap();
    let result = manager
        .start(
            b.clone(),
            StartAgentSessionInput {
                model: None,
                effort: None,
                profile_id: profile.id,
                cwd: None,
            },
        )
        .await;
    assert!(result.is_err());
    manager.stop_all().await;
    let sessions = manager.sessions(&b.project_id);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].status, SessionStatus::Failed);
    let history = serde_json::to_string(&manager.history(&sessions[0].id).unwrap()).unwrap();
    assert!(history.contains("Fictional failure"), "{history}");
    assert!(history.contains("[REDACTED]"));
    assert!(!history.contains("fake-secret-for-tests"));
}

#[cfg(windows)]
#[tokio::test]
async fn bd_stop_all_terminates_terminal_wrapper_and_descendant() {
    let b = board();
    let store = Arc::new(jam_core::Store::open(b.data_dir.join("jam.db")).unwrap());
    let manager = SessionManager::new(
        store,
        Arc::new(MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let profile = manager
        .profiles
        .save(AgentProfileInput {
            label: "Fictional sleeper".into(),
            kind: RuntimeKind::Terminal,
            command: Some("cmd.exe".into()),
            args: Some(vec![
                "/d".into(),
                "/c".into(),
                "powershell.exe -NoProfile -NonInteractive -Command Start-Sleep -Seconds 30".into(),
            ]),
            ..Default::default()
        })
        .unwrap();
    let view = manager
        .start(
            b,
            StartAgentSessionInput {
                model: None,
                effort: None,
                profile_id: profile.id,
                cwd: None,
            },
        )
        .await
        .unwrap();
    manager
        .terminal_resize(TerminalResizeInput {
            session_id: view.id.clone(),
            cols: 120,
            rows: 40,
        })
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), manager.stop_all())
        .await
        .expect("Stopping the terminal tree timed out");
    let sessions = manager.sessions(&view.project_id);
    assert_eq!(sessions[0].status, SessionStatus::Stopped);
    assert!(
        manager
            .terminal_write(TerminalWriteInput {
                session_id: view.id,
                data: "x".into()
            })
            .is_err()
    );
}

#[test]
fn bd_first_prompt_preamble_and_content_capabilities() {
    let s = session(SessionStatus::Ready);
    let image = PromptPart::Image {
        mime_type: "image/png".into(),
        data: "aW1hZ2U=".into(),
    };
    assert!(
        crate::acp::prepare_prompt(&s, vec![image.clone()])
            .unwrap_err()
            .to_string()
            .contains("does not support image")
    );
    assert!(events(&s).is_empty());
    let part = PromptPart::BoardRef {
        uri: "jam://task/FB-1".into(),
        label: "FB-1".into(),
        text: "Fictional task".into(),
    };
    let blocks = crate::acp::prepare_prompt(&s, vec![part.clone()]).unwrap();
    let json = serde_json::to_value(blocks).unwrap();
    assert!(
        json[0]["text"]
            .as_str()
            .unwrap()
            .contains("A chat message is not Start approval.")
    );
    assert_eq!(
        json[1]["text"],
        "Board context — FB-1 (jam://task/FB-1):\nFictional task"
    );
    assert!(
        matches!(&events(&s)[0].event, AgentEventKind::UserMessage { context_preamble: Some(p), .. } if p.contains("project-a"))
    );
    s.status(SessionStatus::Ready, None);
    s.inner.lock().unwrap().view.capabilities = Capabilities {
        images: true,
        embedded_context: true,
        ..Default::default()
    };
    let json =
        serde_json::to_value(crate::acp::prepare_prompt(&s, vec![part, image]).unwrap()).unwrap();
    assert_eq!(json.as_array().unwrap().len(), 2);
    assert_eq!(json[0]["type"], "resource");
    assert_eq!(json[0]["resource"]["uri"], "jam://task/FB-1");
    assert_eq!(json[1]["type"], "image");
}

#[tokio::test]
async fn bd_permission_stays_pending_then_resolves_or_cancels() {
    let s = session(SessionStatus::Running);
    let options = vec![PermissionOption {
        option_id: "yes".into(),
        name: "Allow once".into(),
        kind: PermissionKind::AllowOnce,
    }];
    let mut rx = s.permission(
        Some("tool-a".into()),
        "Fictional permission".into(),
        options.clone(),
    );
    assert!(rx.try_recv().is_err());
    assert_eq!(s.view().status, SessionStatus::AwaitingPermission);
    let id = s
        .inner
        .lock()
        .unwrap()
        .permissions
        .keys()
        .next()
        .unwrap()
        .clone();
    assert!(s.resolve(&id, Some("invalid".into())).is_err());
    s.resolve(&id, Some("yes".into())).unwrap();
    assert_eq!(rx.await.unwrap().as_deref(), Some("yes"));
    assert_eq!(s.view().status, SessionStatus::Running);
    assert!(s.resolve(&id, None).is_err());
    let rx = s.permission(None, "Again".into(), options);
    s.cancel_permissions();
    assert_eq!(rx.await.unwrap(), None);
    assert!(matches!(
        &events(&s).last().unwrap().event,
        AgentEventKind::PermissionResolved {
            option_id: None,
            ..
        }
    ));
}

#[test]
fn bd_acp_mapping_history_cap_and_redaction() {
    let s = session(SessionStatus::Running);
    for text in ["Hello ", "world"] {
        crate::acp::map_update(
            &s,
            json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":text}}),
        );
    }
    let ev = events(&s);
    let first = serde_json::to_value(&ev[0]).unwrap();
    let second = serde_json::to_value(&ev[1]).unwrap();
    assert_eq!(first["messageId"], second["messageId"]);
    assert_eq!(first["kind"], "agent_message_delta");
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"tool_call","toolCallId":"a","title":"Read","kind":"read","status":"pending","rawInput":{"secret":"fake-secret-for-tests"},"content":[{"type":"content","content":{"type":"text","text":"Reading"}}],"locations":[{"path":"fictional.rs","line":1}]}),
    );
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"tool_call_update","toolCallId":"a","status":"completed","rawOutput":{"ok":true}}),
    );
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"plan","entries":[{"content":"Do it","status":"in_progress","priority":"high"}]}),
    );
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"available_commands_update","availableCommands":[{"name":"help","description":"Help"}]}),
    );
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"config_option_update","configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"fast","options":[{"value":"fast","name":"Fast"}]}]}),
    );
    let before = events(&s).len();
    crate::acp::map_update(&s, json!({"sessionUpdate":"usage_update"}));
    assert_eq!(events(&s).len(), before);
    assert!(
        !serde_json::to_string(&events(&s))
            .unwrap()
            .contains("fake-secret-for-tests")
    );
    for n in 0..5_010 {
        s.emit(AgentEventKind::AgentThoughtDelta {
            message_id: "thought".into(),
            text: n.to_string(),
        });
    }
    let events = events(&s);
    assert_eq!(events.len(), 5_000);
    assert!(events.windows(2).all(|w| w[1].seq == w[0].seq + 1));
    s.terminal_output("α".repeat(200_000));
    assert!(s.inner.lock().unwrap().scrollback.len() <= 256 * 1024);
}

#[test]
fn bd_split_secret_is_redacted_before_stream_emission() {
    let s = session(SessionStatus::Running);
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Token: fake-secret-"}}),
    );
    crate::acp::map_update(
        &s,
        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"for-tests done"}}),
    );
    s.flush_text();
    let text = events(&s)
        .iter()
        .filter_map(|e| match &e.event {
            AgentEventKind::AgentMessageDelta { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect::<String>();
    assert_eq!(text, "Token: [REDACTED] done");
    let mut pending = "fake-secret-".to_owned();
    assert_eq!(s.take_safe_text(&mut pending, false), "");
    pending.push_str("for-tests");
    assert_eq!(s.take_safe_text(&mut pending, false), "[REDACTED]");
    s.emit(AgentEventKind::ToolCallUpdate { tool_call_id:"test".into(), title:None, status:Some("completed".into()), content:None, output:Some(json!({"state":"fake-secret-for-tests","kind":"fake-secret-for-tests","nested":{"type":"fake-secret-for-tests"}})) });
    assert!(
        !serde_json::to_string(&events(&s))
            .unwrap()
            .contains("fake-secret-for-tests")
    );
}

#[tokio::test]
// BC02 / H-BD02 / AG15: protocol sequence, config, permission and cancellation.
async fn bd_fake_acp_end_to_end_over_duplex() {
    fake_acp_flow(false).await;
}
#[tokio::test]
async fn bd_fake_acp_cancel_answers_pending_permission() {
    fake_acp_flow(true).await;
}
async fn fake_acp_flow(cancel: bool) {
    let s = session(SessionStatus::Starting);
    let board = s.board.clone();
    let entries = mcp_entries(&board, "Test · dock", &[]).unwrap();
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let agent_cancelled = cancelled.clone();
    let agent = sdk::Agent.builder()
        .on_receive_request(async move |request: a::InitializeRequest, reply: sdk::Responder<a::InitializeResponse>, _cx| {
            assert_eq!(request.protocol_version, ProtocolVersion::V1);
            let caps = serde_json::to_value(request.client_capabilities).unwrap(); assert_ne!(caps["terminal"], true); assert_ne!(caps["fs"]["readTextFile"], true);
            reply.respond(a::InitializeResponse::new(ProtocolVersion::V1))
        }, sdk::on_receive_request!())
        .on_receive_request(async move |request: a::NewSessionRequest, reply: sdk::Responder<a::NewSessionResponse>, _cx| {
            let request = serde_json::to_value(request).unwrap(); assert_eq!(request["mcpServers"][0]["name"], "jam-board");
            assert_eq!(request["mcpServers"][0]["command"], board.sidecar_path.to_string_lossy().as_ref());
            assert!(request["mcpServers"][0]["env"].as_array().unwrap().iter().any(|e| e["name"] == "JAM_BOARD_PROJECT" && e["value"] == "project-a"));
            reply.respond(a::NewSessionResponse::new("fake-acp-session").config_options(vec![a::SessionConfigOption::boolean("flag", "Fictional flag", true)]))
        }, sdk::on_receive_request!())
        .on_receive_notification(async move |_notification: a::CancelNotification, _cx| {
            agent_cancelled.store(true, std::sync::atomic::Ordering::SeqCst); Ok(())
        }, sdk::on_receive_notification!())
        .on_receive_request(async move |request: a::SetSessionConfigOptionRequest, reply: sdk::Responder<a::SetSessionConfigOptionResponse>, _cx| {
            assert_eq!(request.config_id.to_string(), "flag"); assert_eq!(request.value.as_bool(), Some(false));
            reply.respond(a::SetSessionConfigOptionResponse::new(vec![a::SessionConfigOption::boolean("flag", "Fictional flag", false)]))
        }, sdk::on_receive_request!())
        .on_receive_request(async move |request: a::PromptRequest, reply: sdk::Responder<a::PromptResponse>, cx: sdk::ConnectionTo<sdk::Client>| {
            assert_eq!(request.session_id.to_string(), "fake-acp-session");
            assert!(serde_json::to_string(&request.prompt).unwrap().contains("read jam://guide first"));
            for text in ["Hello ", "board"] { cx.send_notification(a::SessionNotification::new(request.session_id.clone(), a::SessionUpdate::AgentMessageChunk(a::ContentChunk::new(a::ContentBlock::Text(a::TextContent::new(text))))))?; }
            let update: a::SessionUpdate = serde_json::from_value(json!({"sessionUpdate":"tool_call","toolCallId":"t1","title":"Read board","kind":"read","status":"pending"})).unwrap();
            cx.send_notification(a::SessionNotification::new(request.session_id.clone(), update))?;
            let tool: a::ToolCallUpdate = serde_json::from_value(json!({"toolCallId":"t1","title":"Read board"})).unwrap();
            cx.send_request(a::RequestPermissionRequest::new(request.session_id, tool, vec![a::PermissionOption::new("allow", "Allow once", a::PermissionOptionKind::AllowOnce)])).on_receiving_result(async move |permission| {
                let outcome = permission?.outcome;
                if cancel { assert!(matches!(outcome, a::RequestPermissionOutcome::Cancelled)); }
                else { assert!(matches!(outcome, a::RequestPermissionOutcome::Selected(_))); }
                reply.respond(a::PromptResponse::new(if cancel { a::StopReason::Cancelled } else { a::StopReason::EndTurn }))
            })?;
            Ok(())
        }, sdk::on_receive_request!());
    let (client, server) = tokio::io::duplex(64 * 1024);
    let (cr, cw) = tokio::io::split(client);
    let (sr, sw) = tokio::io::split(server);
    let agent_task = tokio::spawn(async move {
        agent
            .connect_to(sdk::ByteStreams::new(sw.compat_write(), sr.compat()))
            .await
    });
    let (tx, rx) = mpsc::unbounded_channel();
    let (ready, ready_rx) = oneshot::channel();
    let client_session = s.clone();
    let client_task = tokio::spawn(async move {
        crate::acp::run_connection(
            client_session,
            sdk::ByteStreams::new(cw.compat_write(), cr.compat()),
            entries,
            rx,
            ready,
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        ready_rx.await.unwrap().unwrap();
        let (reply, received) = oneshot::channel();
        tx.send(Control::Config("flag".into(), "false".into(), reply))
            .unwrap();
        received.await.unwrap().unwrap();
        let (reply, received) = oneshot::channel();
        tx.send(Control::Prompt(
            vec![PromptPart::Text { text: "Hi".into() }],
            reply,
        ))
        .unwrap();
        received.await.unwrap().unwrap();
        loop {
            let request = s.inner.lock().unwrap().permissions.keys().next().cloned();
            if let Some(request) = request {
                if cancel {
                    let (reply, received) = oneshot::channel();
                    tx.send(Control::Cancel(reply)).unwrap();
                    received.await.unwrap().unwrap();
                } else {
                    s.resolve(&request, Some("allow".into())).unwrap();
                }
                break;
            }
            tokio::task::yield_now().await;
        }
        loop {
            if events(&s)
                .iter()
                .any(|e| matches!(e.event, AgentEventKind::TurnEnd { .. }))
                && s.view().status == SessionStatus::Ready
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or_else(|e| {
        panic!(
            "fake ACP flow timed out: {e}; events={:?}; agent_finished={}; client_finished={}",
            events(&s),
            agent_task.is_finished(),
            client_task.is_finished()
        )
    });
    let kinds = events(&s)
        .iter()
        .map(|e| {
            serde_json::to_value(e).unwrap()["kind"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect::<Vec<_>>();
    let mut expected = vec![
        "config_options",
        "status",
        "config_options",
        "user_message",
        "status",
        "agent_message_delta",
        "agent_message_delta",
        "tool_call",
        "status",
        "permission_request",
        "permission_resolved",
        "turn_end",
        "status",
    ];
    if !cancel {
        expected.insert(11, "status");
    }
    assert_eq!(kinds, expected);
    assert_eq!(cancelled.load(std::sync::atomic::Ordering::SeqCst), cancel);
    drop(tx);
    client_task.abort();
    agent_task.abort();
    let _ = client_task.await;
    let _ = agent_task.await;
}

#[tokio::test]
// BC03 / H-BD03 / AG17: native output and process lifecycle, not rendered UX.
async fn bd_pty_echo_and_scrollback() {
    let s = session(SessionStatus::Starting);
    s.inner.lock().unwrap().view.kind = RuntimeKind::Terminal;
    #[cfg(windows)]
    let (command, args) = ("cmd.exe", vec!["/c".into(), "echo hello".into()]);
    #[cfg(not(windows))]
    let (command, args) = ("sh", vec!["-c".into(), "echo hello".into()]);
    crate::terminal::start(
        s.clone(),
        which::which(command).unwrap(),
        None,
        args,
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let observed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let hello = s.inner.lock().unwrap().scrollback.contains("hello");
            if hello
                && matches!(
                    s.view().status,
                    SessionStatus::Stopped | SessionStatus::Failed
                )
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    s.connector().unwrap().stop().await.unwrap();
    observed.expect("PTY output missing or child did not stop");
    assert_eq!(s.view().status, SessionStatus::Stopped);
}
