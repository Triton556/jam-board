use super::*;
use crate::{
    history::*,
    tests::{MemoryCredentials, events, session},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
#[path = "terminal_history_tests.rs"]
mod terminal_history_tests;

#[test]
fn r11_terminal_history_uses_original_cwd_after_launch_default_changes() {
    let s = session(SessionStatus::Stopped);
    let (store, mut record) = history(&s);
    let original_cwd = r"F:\Unity\original-worktree";
    let changed_cwd = r"F:\Unity\new-worktree";
    let config = s.board.data_dir.join("r11-fictional-codex");
    let transcripts = config.join("sessions/2026/10/30");
    std::fs::create_dir_all(&transcripts).unwrap();
    record.cwd = original_cwd.into();
    record.board.project_folder = Some(changed_cwd.into());
    record.entry.created_at = "2026-10-30T00:00:00Z".into();
    record.profile.kind = RuntimeKind::Terminal;
    record.profile.preset = Some("codex-cli".into());
    record.profile.env = vec![Env {
        name: "CODEX_HOME".into(),
        value: config.to_string_lossy().into_owned(),
    }];
    record.prepare_terminal(None);
    for (id, cwd, title) in [
        ("original-native", original_cwd, "Original task"),
        ("other-native", changed_cwd, "Another project"),
    ] {
        let rows = [
            serde_json::json!({"type":"session_meta","timestamp":"2026-10-30T00:00:00Z","payload":{"id":id,"cwd":cwd,"timestamp":"2026-10-30T00:00:00Z"}}),
            serde_json::json!({"type":"response_item","timestamp":"2026-10-30T00:00:01Z","payload":{"type":"message","id":"fictional-user","role":"user","content":[{"type":"input_text","text":title}]}}),
        ];
        std::fs::write(
            transcripts.join(format!("rollout-{id}.jsonl")),
            rows.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
    }
    let binding = crate::wiring::ProjectBinding {
        project_id: record.entry.project_id.clone(),
        database_path: s.board.data_dir.join("test.db"),
        database_generation: "fictional-generation".into(),
        folder: Some("F:/canonical-board".into()),
        default_cwd: Some(changed_cwd.into()),
    };
    drop(store.create_bound(record, Some(&binding)).unwrap());
    let entries = store.list(None, None).unwrap();
    assert_eq!(entries[0].title, "Original task");
    assert_eq!(
        entries[0].agent_session_id.as_deref(),
        Some("original-native")
    );
    assert_eq!(store.load("session-a").unwrap().cwd, original_cwd);
    store.rename("session-a", "Retained title").unwrap();
    let retained = store.load_binding("session-a").unwrap().unwrap();
    assert_eq!(retained.database_generation, binding.database_generation);
    assert_eq!(retained.default_cwd.as_deref(), Some(changed_cwd));
    assert_eq!(store.list(None, None).unwrap()[0].title, "Retained title");
}

pub(crate) fn history(s: &crate::session::Session) -> (HistoryStore, StoredHistory) {
    let store = Arc::new(jam_core::Store::open(s.board.data_dir.join("test.db")).unwrap());
    let profiles = Profiles::new(store, Arc::new(MemoryCredentials::default()));
    let profile = profiles.get("api-openrouter").unwrap();
    let view = s.view();
    let record = StoredHistory {
        entry: HistoryEntry {
            id: view.id,
            project_id: view.project_id,
            profile_id: profile.id.clone(),
            profile_label: profile.label.clone(),
            kind: HistoryKind::Api,
            provider: Default::default(),
            empty: false,
            title: "New chat".into(),
            created_at: view.created_at.clone(),
            updated_at: view.created_at,
            model: Some("fixture".into()),
            effort: None,
            agent_session_id: None,
            resumable: Resumable::Transcript,
            message_count: 0,
        },
        board: s.board.clone(),
        cwd: view.cwd,
        profile,
        renamed: false,
        has_user_message: false,
        last_agent_message_id: None,
        terminal: None,
    };
    let history = HistoryStore::new(
        &s.board.data_dir,
        &s.board.project_id,
        Arc::new(AtomicBool::new(true)),
        Arc::new(Mutex::new(())),
    )
    .unwrap();
    (history, record)
}
#[test]
fn history_stream_roundtrip_title_rename_delete_clear_and_project_isolation() {
    let s = session(SessionStatus::Ready);
    let (store, record) = history(&s);
    *s.history_writer.lock().unwrap() = store.create(record).unwrap();
    s.emit(AgentEventKind::UserMessage {
        message_id: "u1".into(),
        content: vec![PromptPart::Text {
            text: format!("{}\nignored title", "界".repeat(70)),
        }],
        context_preamble: None,
    });
    s.emit(AgentEventKind::AgentMessageDelta {
        message_id: "a1".into(),
        text: "fake-secret-for-tests answer".into(),
    });
    s.emit(AgentEventKind::TurnEnd {
        stop_reason: "end_turn".into(),
    });
    let entry = &store.list(None, None).unwrap()[0];
    assert_eq!(entry.title, "界".repeat(60));
    assert_eq!(entry.message_count, 2);
    assert_eq!(store.events(&entry.id).unwrap().len(), 3);
    let disk = std::fs::read_to_string(store.dir.join("session-a.events.jsonl")).unwrap();
    assert!(disk.contains("[REDACTED] answer"));
    assert!(!disk.contains("fake-secret-for-tests"));
    store.rename(&entry.id, "My title").unwrap();
    s.emit(AgentEventKind::TurnEnd {
        stop_reason: "end_turn".into(),
    });
    assert_eq!(
        store.list(Some(1), Some("MY TITLE")).unwrap()[0].title,
        "My title"
    );
    let other = HistoryStore::new(
        &s.board.data_dir,
        "other-project",
        store.enabled.clone(),
        store.lock.clone(),
    )
    .unwrap();
    let mut record = store.load(&entry.id).unwrap();
    record.entry.id = "other".into();
    record.entry.project_id = "other-project".into();
    let _other_writer = other.create(record).unwrap();
    store.delete(&entry.id).unwrap();
    s.emit(AgentEventKind::TurnEnd {
        stop_reason: "end_turn".into(),
    });
    assert!(store.list(None, None).unwrap().is_empty());
    assert!(store.events(&entry.id).is_err());
    let mut record = history(&s).1;
    record.entry.id = "new".into();
    let _writer = store.create(record).unwrap();
    store.clear().unwrap();
    assert!(store.list(None, None).unwrap().is_empty());
    assert_eq!(other.list(None, None).unwrap().len(), 1);
    assert!(
        HistoryStore::new(
            &s.board.data_dir,
            "../escape",
            store.enabled.clone(),
            store.lock.clone()
        )
        .is_err()
    );
    assert!(store.events("../escape").is_err());
}
#[test]
fn history_response_never_exceeds_twenty_megabytes_and_marks_truncation() {
    let s = session(SessionStatus::Ready);
    let (store, record) = history(&s);
    let mut writer = store.create(record).unwrap().unwrap();
    let event = AgentDockEvent {
        session_id: "session-a".into(),
        seq: 1,
        at: crate::session::now(),
        event: AgentEventKind::AgentMessageDelta {
            message_id: "a".into(),
            text: "x".repeat(1024 * 1024),
        },
    };
    for _ in 0..22 {
        writer.append(&event, &s.view()).unwrap();
    }
    let events = store.events("session-a").unwrap();
    assert_eq!(
        store.events_for_resume("session-a").unwrap().len(),
        22,
        "the response cap must not discard resume context"
    );
    assert!(serde_json::to_vec(&events).unwrap().len() <= MAX_HISTORY_RESPONSE);
    assert!(
        matches!(&events.last().unwrap().event, AgentEventKind::Status { message: Some(m), .. } if m.contains("History truncated"))
    );
    assert!(
        std::fs::metadata(store.dir.join("session-a.events.jsonl"))
            .unwrap()
            .len()
            > MAX_HISTORY_RESPONSE as u64
    );
}
#[test]
fn history_settings_default_on_persist_and_disable_writes() {
    let s = session(SessionStatus::Ready);
    let (store, record) = history(&s);
    let database = Arc::new(jam_core::Store::open(s.board.data_dir.join("settings.db")).unwrap());
    let make = || {
        SessionManager::new(
            database.clone(),
            Arc::new(MemoryCredentials::default()),
            |_| {},
            |_| {},
        )
    };
    let manager = make();
    assert!(manager.history_settings().keep_history);
    manager
        .save_history_settings(HistorySettings {
            keep_history: false,
        })
        .unwrap();
    assert!(!make().history_settings().keep_history);
    let mut writer = store.create(record.clone()).unwrap().unwrap();
    store.enabled.store(false, Ordering::SeqCst);
    assert!(store.create(record).unwrap().is_none());
    writer
        .append(
            &AgentDockEvent {
                session_id: "session-a".into(),
                seq: 1,
                at: crate::session::now(),
                event: AgentEventKind::TurnEnd {
                    stop_reason: "end_turn".into(),
                },
            },
            &s.view(),
        )
        .unwrap();
    assert!(store.events("session-a").unwrap().is_empty());
}
#[test]
fn mcp_presets_disabled_defaults_resolution_and_secret_free_shapes() {
    let s = session(SessionStatus::Ready);
    let web = McpEntry {
        enabled: true,
        name: "web".into(),
        preset: McpPreset::Web,
        ..Default::default()
    };
    let browser = McpEntry {
        enabled: true,
        name: "browser".into(),
        preset: McpPreset::Browser,
        ..Default::default()
    };
    let off = McpEntry {
        name: "off".into(),
        preset: McpPreset::Web,
        ..Default::default()
    };
    let http = McpEntry {
        enabled: true,
        name: "remote".into(),
        http: Some(McpHttp {
            url: "http://127.0.0.1:1234/mcp".into(),
            bearer_secret_key: Some("MCP_REMOTE_BEARER".into()),
        }),
        bearer_token: Some("fictional-token".into()),
        ..Default::default()
    };
    let entries = mcp_entries(&s.board, "Brain", &[web, browser, off, http]).unwrap();
    assert_eq!(entries.len(), 4);
    assert!(entries[1].command.ends_with("jam-web-mcp.exe"));
    assert!(entries[1].trusts_read_only());
    assert!(!entries[2].trusts_read_only());
    assert!(
        entries[1]
            .env
            .iter()
            .any(|e| e.name == "JAM_WEB_DOWNLOAD_DIR" && e.value.contains("project-a"))
    );
    assert_eq!(entries[2].args, ["-y", "@playwright/mcp@latest"]);
    assert!(
        !serde_json::to_string(&entries)
            .unwrap()
            .contains("fictional-token")
    );
    for preset in ["claude-cli", "codex-cli"] {
        let (_, args) = terminal_command(Some(preset), "fixture", &[], &entries).unwrap();
        let text = args.join(" ");
        assert!(text.contains("http://127.0.0.1:1234/mcp"));
        assert!(!text.contains("fictional-token"));
        let env = crate::wiring::terminal_environment(Some(preset), "fixture", &entries).unwrap();
        assert!(env.iter().any(|e| e.value == "fictional-token"));
        assert!(text.contains("jam-web-mcp"));
    }
    assert!(mcp_entries(&s.board, "Brain", &[entries[1].clone(), entries[1].clone()]).is_err());
    let mut invalid = entries[3].clone();
    invalid.http.as_mut().unwrap().url = "https://user:password@example.test/mcp".into();
    assert!(mcp_entries(&s.board, "Brain", &[invalid]).is_err());
}
#[tokio::test]
async fn unsupported_resume_does_not_start_process_and_other_projects_cannot_read() {
    let s = session(SessionStatus::Ready);
    let (history, mut record) = history(&s);
    record.entry.resumable = Resumable::None;
    let _writer = history.create(record).unwrap();
    let manager = SessionManager::new(
        Arc::new(jam_core::Store::open(s.board.data_dir.join("manager.db")).unwrap()),
        Arc::new(MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    assert!(
        manager
            .resume(&s.board.data_dir, &s.board.project_id, "session-a")
            .await
            .unwrap_err()
            .to_string()
            .contains("read-only transcript")
    );
    assert!(manager.sessions(&s.board.project_id).is_empty());
    assert!(
        manager
            .history_events(&s.board.data_dir, "other-project", "session-a")
            .is_err()
    );
    assert!(events(&s).is_empty());
}
#[tokio::test]
async fn acp_native_load_replays_without_duplicating_disk_and_preserves_wiring() {
    use agent_client_protocol::{
        self as sdk,
        schema::{ProtocolVersion, v1 as a},
    };
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
    let s = session(SessionStatus::Starting);
    let (store, mut record) = history(&s);
    record.entry.kind = HistoryKind::Acp;
    record.entry.agent_session_id = Some("native-id".into());
    record.entry.resumable = Resumable::Native;
    *s.history_writer.lock().unwrap() = store.create(record).unwrap();
    {
        let mut inner = s.inner.lock().unwrap();
        inner.resume_native_id = Some("native-id".into());
        inner.replaying = true;
        inner.first_prompt = false;
    }
    let expected_cwd = s.view().cwd;
    let entries = mcp_entries(
        &s.board,
        "Brain",
        &[McpEntry {
            enabled: true,
            name: "remote".into(),
            http: Some(McpHttp {
                url: "https://example.invalid/mcp".into(),
                bearer_secret_key: None,
            }),
            bearer_token: Some("fictional-token".into()),
            ..Default::default()
        }],
    )
    .unwrap();
    let agent = sdk::Agent.builder()
        .on_receive_request(async move |_request: a::InitializeRequest, reply: sdk::Responder<a::InitializeResponse>, _cx| {
            reply.respond(a::InitializeResponse::new(ProtocolVersion::V1).agent_capabilities(serde_json::from_value(serde_json::json!({"loadSession":true})).unwrap()))
        }, sdk::on_receive_request!())
        .on_receive_request(async move |request: a::LoadSessionRequest, reply: sdk::Responder<a::LoadSessionResponse>, cx: sdk::ConnectionTo<sdk::Client>| {
            assert_eq!(request.session_id.to_string(), "native-id"); assert_eq!(request.cwd.to_string_lossy(), expected_cwd);
            let wire = serde_json::to_value(&request).unwrap(); assert_eq!(wire["mcpServers"][1]["type"], "http");
            assert_eq!(wire["mcpServers"][1]["headers"][0]["value"], "Bearer fictional-token");
            for (kind, text) in [("user_message_chunk", "Previous user"), ("agent_message_chunk", "Previous answer")] {
                let update = serde_json::from_value(serde_json::json!({"sessionUpdate":kind,"content":{"type":"text","text":text}})).unwrap();
                cx.send_notification(a::SessionNotification::new(request.session_id.clone(), update))?;
            }
            reply.respond(a::LoadSessionResponse::new())
        }, sdk::on_receive_request!());
    let (client, server) = tokio::io::duplex(65536);
    let (cr, cw) = tokio::io::split(client);
    let (sr, sw) = tokio::io::split(server);
    let agent_task = tokio::spawn(async move {
        agent
            .connect_to(sdk::ByteStreams::new(sw.compat_write(), sr.compat()))
            .await
    });
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let (ready, ready_rx) = tokio::sync::oneshot::channel();
    let runtime_s = s.clone();
    let task = tokio::spawn(async move {
        crate::acp::run_connection(
            runtime_s,
            sdk::ByteStreams::new(cw.compat_write(), cr.compat()),
            entries,
            rx,
            ready,
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), ready_rx)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    s.flush_text();
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::AgentMessageDelta { text, .. } if text == "Previous answer")));
    assert!(
        store.events("session-a").unwrap().is_empty(),
        "native replay must not append another transcript copy"
    );
    s.inner.lock().unwrap().replaying = false;
    s.status(SessionStatus::Ready, Some("Resumed 2026-10-26".into()));
    assert_eq!(store.events("session-a").unwrap().len(), 1);
    assert_eq!(
        store.load("session-a").unwrap().entry.resumable,
        Resumable::Native
    );
    drop(tx);
    task.abort();
    agent_task.abort();
}
#[test]
fn history_recovers_incomplete_tail_before_appending_new_events() {
    use std::io::Write;
    let s = session(SessionStatus::Ready);
    let (store, record) = history(&s);
    let mut writer = store.create(record).unwrap().unwrap();
    let event = AgentDockEvent {
        session_id: "session-a".into(),
        seq: 1,
        at: crate::session::now(),
        event: AgentEventKind::UserMessage {
            message_id: "u1".into(),
            content: vec![PromptPart::Text {
                text: "Retain this".into(),
            }],
            context_preamble: None,
        },
    };
    writer.append(&event, &s.view()).unwrap();
    drop(writer);
    let path = store.dir.join("session-a.events.jsonl");
    let valid = std::fs::read(&path).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"{\"sessionId\":\"interrupted")
        .unwrap();
    let before = store.events("session-a").unwrap();
    assert_eq!(before.len(), 2);
    assert!(
        matches!(&before[1].event, AgentEventKind::Status { message: Some(m), .. } if m.contains("incomplete"))
    );
    let record = store.load("session-a").unwrap();
    let mut writer = store.create(record).unwrap().unwrap();
    let mut next = event.clone();
    next.seq = 2;
    next.event = AgentEventKind::TurnEnd {
        stop_reason: "end_turn".into(),
    };
    writer.append(&next, &s.view()).unwrap();
    assert!(std::fs::read(&path).unwrap().starts_with(&valid));
    assert_eq!(store.events("session-a").unwrap().len(), 2);
}
#[test]
fn profile_mcp_switches_legacy_migration_bearer_credentials_and_validation() {
    let s = session(SessionStatus::Ready);
    let database = Arc::new(jam_core::Store::open(s.board.data_dir.join("profiles.db")).unwrap());
    let credentials = Arc::new(MemoryCredentials::default());
    let profiles = Profiles::new(database.clone(), credentials.clone());
    let profile = profiles
        .save(AgentProfileInput {
            label: "HTTP fixture".into(),
            kind: RuntimeKind::Api,
            extra_mcp_servers: Some(vec![McpEntry {
                enabled: true,
                name: "remote".into(),
                http: Some(McpHttp {
                    url: "https://example.invalid/mcp".into(),
                    bearer_secret_key: Some("MCP_REMOTE_TOKEN".into()),
                }),
                ..Default::default()
            }]),
            ..Default::default()
        })
        .unwrap();
    profiles
        .set_secret(&profile.id, "MCP_REMOTE_TOKEN", "private-fixture-bearer")
        .unwrap();
    let view = profiles
        .list()
        .unwrap()
        .into_iter()
        .find(|p| p.id == profile.id)
        .unwrap();
    assert!(
        view.secret_keys
            .iter()
            .any(|k| k.key == "MCP_REMOTE_TOKEN" && k.is_set)
    );
    assert!(
        !serde_json::to_string(&view)
            .unwrap()
            .contains("private-fixture-bearer")
    );
    assert!(
        !database
            .setting("agent_profiles")
            .unwrap()
            .unwrap()
            .contains("private-fixture-bearer")
    );
    assert_eq!(
        credentials
            .get(&profile.id, "MCP_REMOTE_TOKEN")
            .unwrap()
            .as_deref(),
        Some("private-fixture-bearer")
    );
    let mut legacy = serde_json::to_value(profiles.get(&profile.id).unwrap()).unwrap();
    legacy["extraMcpServers"][0]
        .as_object_mut()
        .unwrap()
        .remove("enabled");
    database
        .set_setting("agent_profiles", &serde_json::json!([legacy]).to_string())
        .unwrap();
    assert!(profiles.get(&profile.id).unwrap().extra_mcp_servers[0].enabled);
    let web: McpEntry =
        serde_json::from_value(serde_json::json!({"name":"web","preset":"web"})).unwrap();
    assert!(!web.enabled);
    assert!(web.trusts_read_only());
    for name in ["jam-board", "duplicate__namespace", "has space"] {
        assert!(
            profiles
                .save(AgentProfileInput {
                    label: "Invalid".into(),
                    kind: RuntimeKind::Api,
                    extra_mcp_servers: Some(vec![McpEntry {
                        name: name.into(),
                        ..Default::default()
                    }]),
                    ..Default::default()
                })
                .is_err()
        );
    }
}
