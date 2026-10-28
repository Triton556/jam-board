use super::*;
use serde_json::{Value, json};
use std::{fs, path::PathBuf, time::Duration};
use std::{fs::OpenOptions, io::Write};
#[path = "terminal_history_integration_tests.rs"]
mod integration;

fn fixture_session(status: SessionStatus) -> Arc<crate::session::Session> {
    let mut s = session(status);
    let root = std::path::absolute(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../test-visuals/round7/b1-terminal-history/fixtures")
            .join(ulid::Ulid::generate().to_string()),
    )
    .unwrap();
    fs::create_dir_all(&root).unwrap();
    let mutable = Arc::get_mut(&mut s).unwrap();
    mutable.board.data_dir = root.clone();
    mutable.board.sidecar_path = root.join("fake-sidecar");
    fs::write(
        &mutable.board.sidecar_path,
        "Fixture sidecar; never executed",
    )
    .unwrap();
    mutable.inner.lock().unwrap().view.cwd = root.to_string_lossy().into_owned();
    s
}

fn fixture(
    family: &str,
) -> (
    Arc<crate::session::Session>,
    HistoryStore,
    StoredHistory,
    PathBuf,
) {
    let s = fixture_session(SessionStatus::Starting);
    let (store, mut record) = history(&s);
    record.profile.kind = RuntimeKind::Terminal;
    record.profile.preset = Some(format!("{family}-cli"));
    record.profile.label = format!("Fixture {family}");
    record.entry.profile_label = record.profile.label.clone();
    record.entry.created_at = "2026-10-28T02:00:00Z".into();
    record.entry.updated_at = record.entry.created_at.clone();
    let root = s.board.data_dir.join("cli-config");
    record.profile.env.push(Env {
        name: if family == "claude" {
            "CLAUDE_CONFIG_DIR"
        } else {
            "CODEX_HOME"
        }
        .into(),
        value: root.to_string_lossy().into_owned(),
    });
    record.prepare_terminal((family == "claude").then(|| "fixture-claude-id".into()));
    (s, store, record, root)
}
fn write_jsonl(path: &std::path::Path, rows: Vec<Value>) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        path,
        rows.into_iter()
            .map(|row| format!("{row}\n"))
            .collect::<String>(),
    )
    .unwrap();
}
fn claude_path(record: &StoredHistory, root: &std::path::Path) -> PathBuf {
    let project: String = record
        .cwd
        .chars()
        .map(|c| {
            if matches!(c, ':' | '\\' | '/') {
                '-'
            } else {
                c
            }
        })
        .collect();
    root.join("projects")
        .join(project)
        .join("fixture-claude-id.jsonl")
}
fn claude_rows() -> Vec<Value> {
    vec![
        json!({"type":"user","isMeta":true,"message":{"role":"user","content":"Ignore bookkeeping"}}),
        json!({"type":"user","sessionId":"fixture-claude-id","uuid":"u1","timestamp":"2026-10-28T02:00:03Z","message":{"role":"user","content":[{"type":"text","text":"  Fixture task\nsecond line  "}]}}),
        json!({"type":"assistant","uuid":"a1","timestamp":"2026-10-28T02:00:04Z","message":{"id":"msg-a1","role":"assistant","model":"claude-fixture-old","content":[{"type":"text","text":"Hello"}]}}),
        json!({"type":"assistant","uuid":"a2","timestamp":"2026-10-28T02:00:05Z","message":{"id":"msg-a1","role":"assistant","model":"claude-fixture-last","content":[{"type":"text","text":"Hello again"}]}}),
        json!({"type":"assistant","isSidechain":true,"message":{"role":"assistant","model":"ignored-subagent","content":"Ignored"}}),
    ]
}
fn codex_rows(id: &str, cwd: &str, at: &str) -> Vec<Value> {
    vec![
        json!({"type":"session_meta","timestamp":at,"payload":{"id":id,"cwd":cwd,"timestamp":at,"originator":"codex_cli_rs","cli_version":"fixture"}}),
        json!({"type":"turn_context","timestamp":at,"payload":{"model":"codex-fixture-old"}}),
        json!({"type":"response_item","timestamp":"2026-10-28T02:00:03Z","payload":{"type":"message","id":"u1","role":"user","content":[{"type":"input_text","text":"Codex fixture task"}]}}),
        json!({"type":"event_msg","timestamp":"2026-10-28T02:00:03Z","payload":{"type":"user_message","message":"Codex fixture task"}}),
        json!({"type":"response_item","timestamp":"2026-10-28T02:00:05Z","payload":{"type":"message","id":"a1","role":"assistant","content":[{"type":"output_text","text":"Fixture reply"}]}}),
        json!({"type":"turn_context","timestamp":"2026-10-28T02:00:06Z","payload":{"model":"codex-fixture-last"}}),
    ]
}

#[test]
fn b1_old_history_defaults_provider_kind_and_model_from_config_events() {
    let s = fixture_session(SessionStatus::Ready);
    let (store, record) = history(&s);
    let mut json = serde_json::to_value(&record).unwrap();
    for field in ["kind", "provider", "empty", "model", "terminal"] {
        json.as_object_mut().unwrap().remove(field);
    }
    fs::create_dir_all(&store.dir).unwrap();
    let path = store.dir.join("session-a.json");
    for kind in [None, Some("acp"), Some("api")] {
        if let Some(kind) = kind {
            json["kind"] = kind.into();
        }
        fs::write(&path, json.to_string()).unwrap();
        let loaded = store.load("session-a").unwrap();
        assert_eq!(loaded.entry.kind, HistoryKind::Chat);
        assert_eq!(loaded.entry.provider.label, record.profile.label);
        assert_eq!(loaded.entry.provider.agent_kind, "api-openrouter");
        assert!(!loaded.entry.empty);
    }
    let loaded = store.load("session-a").unwrap();
    *s.history_writer.lock().unwrap() = store.create(loaded).unwrap();
    for model in ["first-model", "last-model"] {
        s.emit(AgentEventKind::ConfigOptions {
            options: vec![ConfigOption {
                id: "provider-model".into(),
                category: Some("model".into()),
                name: "Model".into(),
                value: model.into(),
                values: vec![],
                description: None,
            }],
        });
    }
    s.status(SessionStatus::Stopped, None);
    assert_eq!(
        store.load("session-a").unwrap().entry.model.as_deref(),
        Some("last-model")
    );
    assert_eq!(
        serde_json::to_value(store.list(None, None).unwrap()).unwrap()[0]["kind"],
        "chat"
    );
}

#[test]
fn b1_claude_end_summary_empty_rename_search_delete_preserves_transcript() {
    let (s, store, record, root) = fixture("claude");
    let path = claude_path(&record, &root);
    *s.history_writer.lock().unwrap() = store.create(record).unwrap();
    assert!(store.list(None, None).unwrap()[0].empty);
    write_jsonl(&path, claude_rows());
    // A crash can leave an incomplete tail; valid transcript records still count.
    OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"{\"type\":")
        .unwrap();
    s.status(SessionStatus::Stopped, None);
    let entry = store.load("session-a").unwrap().entry;
    assert_eq!(entry.kind, HistoryKind::Terminal);
    assert_eq!(entry.title, "Fixture task");
    assert_eq!(entry.message_count, 2);
    assert_eq!(entry.updated_at, "2026-10-28T02:00:05Z");
    assert_eq!(entry.model.as_deref(), Some("claude-fixture-last"));
    assert!(!entry.empty);
    assert_eq!(entry.resumable, Resumable::Native);
    assert_eq!(entry.provider.label, "Fixture claude");
    store.rename("session-a", "Renamed terminal").unwrap();
    s.status(SessionStatus::Stopped, None);
    assert_eq!(
        store.list(None, Some("RENAMED")).unwrap()[0].title,
        "Renamed terminal"
    );
    let bytes = fs::read(&path).unwrap();
    store.delete("session-a").unwrap();
    s.status(SessionStatus::Stopped, None);
    assert!(store.list(None, None).unwrap().is_empty());
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn b1_codex_restart_links_nearest_cwd_time_and_rejects_ambiguous_or_distant() {
    for scenario in ["nearest", "ambiguous", "distant", "wrong-cwd", "midnight"] {
        let (_s, store, mut record, root) = fixture("codex");
        if scenario == "midnight" {
            record.entry.created_at = "2026-10-27T23:59:59Z".into();
        }
        let first = root.join("sessions/2026/10/28/rollout-first.jsonl");
        let at = if scenario == "distant" {
            "2026-10-28T02:03:00Z"
        } else if scenario == "midnight" {
            "2026-10-28T00:00:01Z"
        } else {
            "2026-10-28T02:00:01Z"
        };
        let cwd = if scenario == "wrong-cwd" {
            "/another-project"
        } else {
            &record.cwd
        };
        write_jsonl(&first, codex_rows("codex-first", cwd, at));
        if scenario == "nearest" || scenario == "ambiguous" {
            let second_at = if scenario == "ambiguous" {
                at
            } else {
                "2026-10-28T02:00:30Z"
            };
            write_jsonl(
                &root.join("sessions/2026/10/28/rollout-second.jsonl"),
                codex_rows("codex-second", &record.cwd, second_at),
            );
        }
        drop(store.create(record).unwrap()); // Simulate application exit without final status.
        let restarted = HistoryStore::new(
            store.dir.parent().unwrap().parent().unwrap(),
            "project-a",
            store.enabled.clone(),
            store.lock.clone(),
        )
        .unwrap();
        let entry = restarted.list(None, None).unwrap().remove(0);
        if matches!(scenario, "nearest" | "midnight") {
            assert_eq!(
                entry.agent_session_id.as_deref(),
                Some("codex-first"),
                "{scenario}"
            );
            assert_eq!(entry.title, "Codex fixture task");
            assert_eq!(entry.message_count, 2);
            assert_eq!(entry.model.as_deref(), Some("codex-fixture-last"));
            assert!(!entry.empty);
        } else {
            assert!(entry.empty, "{scenario}");
            assert_eq!(entry.resumable, Resumable::None);
        }
    }
}

#[tokio::test]
async fn b1_terminal_resume_fake_cli_receives_native_selector_cwd_and_environment() {
    for family in ["claude", "codex"] {
        let (s, _store, mut record, root) = fixture(family);
        let transcript = if family == "claude" {
            claude_path(&record, &root)
        } else {
            root.join("sessions/2026/10/28/rollout-fixture.jsonl")
        };
        write_jsonl(
            &transcript,
            if family == "claude" {
                claude_rows()
            } else {
                codex_rows("codex-fixture-id", &record.cwd, "2026-10-28T02:00:01Z")
            },
        );
        record.refresh_terminal().unwrap();
        let script = s.board.data_dir.join("fake-resume.cjs");
        let output = s.board.data_dir.join("received.json");
        fs::write(&script,"require('fs').writeFileSync(process.env.JAM_FIXTURE_OUTPUT,JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),token:process.env.FIXTURE_TOKEN}));setInterval(()=>{},1000)").unwrap();
        let mut args = vec![script.to_string_lossy().into_owned()];
        let id = record.terminal_resume_args(&mut args).unwrap();
        assert_eq!(
            &args[1..],
            &[
                if family == "claude" {
                    "--resume"
                } else {
                    "resume"
                },
                &id
            ]
        );
        assert!(!args.iter().any(|a| a == "--session-id"));
        let node = which::which("node").unwrap();
        assert_eq!(
            node.file_stem()
                .unwrap()
                .to_string_lossy()
                .to_ascii_lowercase(),
            "node"
        );
        crate::terminal::start(
            s.clone(),
            node,
            record.profile.preset.as_deref(),
            args,
            vec![
                Env {
                    name: "JAM_FIXTURE_OUTPUT".into(),
                    value: output.to_string_lossy().into_owned(),
                },
                Env {
                    name: "FIXTURE_TOKEN".into(),
                    value: "fictional-env-only-token".into(),
                },
            ],
            mcp_entries(&s.board, "Fixture", &[]).unwrap(),
        )
        .await
        .unwrap();
        s.connector().unwrap().resize(80, 24).unwrap();
        let observed = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Ok(bytes) = fs::read(&output)
                    && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
                {
                    break value;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        s.connector().unwrap().stop().await.unwrap();
        let observed = observed.expect("fake Node CLI startup");
        assert_eq!(
            observed["argv"][0],
            if family == "claude" {
                "--resume"
            } else {
                "resume"
            }
        );
        assert_eq!(observed["argv"][1], id);
        assert_eq!(
            fs::canonicalize(observed["cwd"].as_str().unwrap()).unwrap(),
            fs::canonicalize(&record.cwd).unwrap()
        );
        assert_eq!(observed["token"], "fictional-env-only-token");
        assert!(
            !observed["argv"]
                .to_string()
                .contains("fictional-env-only-token")
        );
        fs::remove_file(&transcript).unwrap();
        assert!(
            record
                .terminal_resume_args(&mut vec![])
                .unwrap_err()
                .to_string()
                .contains("transcript is missing")
        );
    }
}

#[test]
fn b1_terminal_missing_empty_image_title_fallback_and_selector_validation() {
    let (_s, store, mut record, root) = fixture("claude");
    record.entry.title = "Original terminal title".into();
    let path = claude_path(&record, &root);
    write_jsonl(
        &path,
        vec![json!({"type":"system","timestamp":"2026-10-28T02:00:03Z"})],
    );
    record.refresh_terminal().unwrap();
    assert!(record.entry.empty);
    assert_eq!(record.entry.message_count, 0);
    assert_eq!(record.entry.title, "Original terminal title");
    write_jsonl(
        &path,
        vec![
            json!({"type":"user","uuid":"image-user","sessionId":"fixture-claude-id","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"fictional"}}]}}),
        ],
    );
    record.refresh_terminal().unwrap();
    assert!(!record.entry.empty);
    assert_eq!(record.entry.message_count, 1);
    assert_eq!(record.entry.title, "Original terminal title");
    for flag in [
        "--session-id",
        "--resume=another",
        "resume",
        "--continue",
        "--last",
    ] {
        assert!(
            record
                .terminal_resume_args(&mut vec![flag.into()])
                .unwrap_err()
                .to_string()
                .contains("session selection")
        );
    }
    record.entry.agent_session_id = Some("../../other".into());
    assert!(
        record
            .terminal_resume_args(&mut vec![])
            .unwrap_err()
            .to_string()
            .contains("Invalid history identifier")
    );
    record.entry.agent_session_id = Some("fixture-claude-id".into());
    drop(store.create(record).unwrap());
    let bytes = fs::read(&path).unwrap();
    store.clear().unwrap();
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn b1_terminal_oversized_bookkeeping_record_is_skipped_with_bounded_reads() {
    let (_s, _store, mut record, root) = fixture("claude");
    let path = claude_path(&record, &root);
    write_jsonl(&path, vec![]);
    let mut file = OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(&vec![b'x'; 4 * 1024 * 1024 + 100]).unwrap();
    file.write_all(b"\nmalformed bookkeeping\n").unwrap();
    for row in claude_rows() {
        writeln!(file, "{row}").unwrap();
    }
    drop(file);
    record.refresh_terminal().unwrap();
    assert_eq!(record.entry.title, "Fixture task");
    assert_eq!(record.entry.message_count, 2);
}

#[test]
fn b1_terminal_summary_survives_transcript_removal_before_final_status() {
    let (s, store, record, root) = fixture("claude");
    let path = claude_path(&record, &root);
    *s.history_writer.lock().unwrap() = store.create(record).unwrap();
    write_jsonl(&path, claude_rows());
    assert_eq!(store.list(None, None).unwrap()[0].message_count, 2);
    fs::remove_file(path).unwrap();
    s.status(SessionStatus::Stopped, None);
    let retained = store.load("session-a").unwrap();
    assert_eq!(retained.entry.title, "Fixture task");
    assert_eq!(retained.entry.message_count, 2);
    assert!(!retained.entry.empty);
    assert_eq!(retained.entry.resumable, Resumable::None);
}
