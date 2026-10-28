//! Exercise the production manager; the only spawned executable is verified Node.
use super::*;

async fn capture(
    path: &std::path::Path,
) -> std::result::Result<Value, tokio::time::error::Elapsed> {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Ok(bytes) = fs::read(path)
                && let Ok(value) = serde_json::from_slice(&bytes)
            {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
}

#[tokio::test]
async fn b1_manager_records_end_and_resumes_new_terminal_with_request_config_and_same_connection() {
    for family in ["claude", "codex"] {
        for choice in [UserConfigChoice::Include, UserConfigChoice::Exclude] {
            let (s, history, record, root) = fixture(family);
            let database =
                Arc::new(jam_core::Store::open(s.board.data_dir.join("runtime.db")).unwrap());
            let manager = SessionManager::new(
                database.clone(),
                Arc::new(MemoryCredentials::default()),
                |_| {},
                |_| {},
            );
            let script = s.board.data_dir.join("fake-managed-cli.cjs");
            let output = s.board.data_dir.join("managed-argv.json");
            fs::write(&script,"require('fs').writeFileSync(process.env.JAM_B1_CAPTURE,JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),token:process.env.FIXTURE_TOKEN}));console.log('FAKE_READY');setInterval(()=>{},1000)").unwrap();
            let node = which::which("node").unwrap().canonicalize().unwrap();
            assert_eq!(
                node.file_stem()
                    .unwrap()
                    .to_string_lossy()
                    .to_ascii_lowercase(),
                "node"
            );
            let mut profile = record.profile;
            profile.id = format!("b1-scripted-{family}");
            profile.command = node.to_string_lossy().into_owned();
            profile.args = vec![script.to_string_lossy().into_owned()];
            profile.env.extend([
                Env {
                    name: "PATH".into(),
                    value: String::new(),
                },
                Env {
                    name: "JAM_B1_CAPTURE".into(),
                    value: output.to_string_lossy().into_owned(),
                },
                Env {
                    name: "CODEX_HOME".into(),
                    value: root.to_string_lossy().into_owned(),
                },
                Env {
                    name: "CLAUDE_CONFIG_DIR".into(),
                    value: root.to_string_lossy().into_owned(),
                },
            ]);
            profile.secret_keys = vec![SecretKey {
                key: "FIXTURE_TOKEN".into(),
                label: "Synthetic credential".into(),
            }];
            // Directly save a custom fixture retaining only the CLI dialect. Never
            // use save() to override a built-in; it intentionally ignores overrides.
            database
                .set_setting(
                    "agent_profiles",
                    &serde_json::to_string(&vec![profile.clone()]).unwrap(),
                )
                .unwrap();
            manager
                .profiles
                .set_secret(&profile.id, "FIXTURE_TOKEN", "b1-fictional-token")
                .unwrap();
            let (resolved, args) = manager
                .profiles
                .get(&profile.id)
                .unwrap()
                .launch_command()
                .unwrap();
            assert_eq!(resolved.canonicalize().unwrap(), node);
            assert_eq!(
                std::path::Path::new(&args[0]).canonicalize().unwrap(),
                script.canonicalize().unwrap()
            );
            let initial = manager
                .start(
                    s.board.clone(),
                    StartAgentSessionInput {
                        profile_id: profile.id.clone(),
                        user_config: Some(UserConfigChoice::Include),
                        cwd: Some(s.view().cwd),
                        model: None,
                        effort: None,
                    },
                )
                .await
                .unwrap();
            let pending = history.load(&initial.id).unwrap();
            assert_eq!(pending.entry.kind, HistoryKind::Terminal);
            assert!(pending.entry.empty);
            assert_eq!(pending.entry.provider.label, profile.label);
            manager
                .terminal_resize(TerminalResizeInput {
                    session_id: initial.id.clone(),
                    cols: 80,
                    rows: 24,
                })
                .unwrap();
            let first = capture(&output).await;
            if first.is_err() {
                manager.stop(&initial.id).await.unwrap();
            }
            let first = first.expect("scripted initial CLI must capture argv");
            let native_id = manager
                .agent_session_id(&initial.id)
                .unwrap()
                .unwrap_or_else(|| "codex-b1-native".into());
            if family == "claude" {
                let argv = first["argv"].as_array().unwrap();
                let pos = argv.iter().position(|arg| arg == "--session-id").unwrap();
                assert_eq!(argv[pos + 1], native_id);
            }
            let path = if family == "claude" {
                claude_path(&pending, &root).with_file_name(format!("{native_id}.jsonl"))
            } else {
                let date = time::OffsetDateTime::parse(
                    &initial.created_at,
                    &time::format_description::well_known::Rfc3339,
                )
                .unwrap();
                root.join(format!(
                    "sessions/{:04}/{:02}/{:02}/rollout-b1.jsonl",
                    date.year(),
                    u8::from(date.month()),
                    date.day()
                ))
            };
            let rows = if family == "claude" {
                let mut rows = claude_rows();
                for row in &mut rows {
                    if row.get("sessionId").is_some() {
                        row["sessionId"] = native_id.clone().into();
                    }
                }
                rows
            } else {
                codex_rows(&native_id, &initial.cwd, &initial.created_at)
            };
            write_jsonl(&path, rows);
            assert!(
                manager
                    .resume_with_user_config(
                        &s.board.data_dir,
                        &s.board.project_id,
                        &initial.id,
                        Some(choice)
                    )
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("already open")
            );
            manager.stop(&initial.id).await.unwrap();
            let ended = history.load(&initial.id).unwrap();
            assert_eq!(ended.entry.resumable, Resumable::Native);
            assert!(!ended.entry.empty);
            assert_eq!(ended.entry.message_count, 2);
            assert_eq!(
                ended.entry.agent_session_id.as_deref(),
                Some(native_id.as_str())
            );
            assert_eq!(
                ended.entry.model.as_deref(),
                Some(if family == "claude" {
                    "claude-fixture-last"
                } else {
                    "codex-fixture-last"
                })
            );
            // An omitted choice still fails even with a saved default. The actual
            // resume request, deliberately opposite the default, selects behavior.
            manager
                .profiles
                .save_user_config_default(if choice == UserConfigChoice::Include {
                    UserConfigDefault::Exclude
                } else {
                    UserConfigDefault::Include
                })
                .unwrap();
            assert!(
                manager
                    .resume(&s.board.data_dir, &s.board.project_id, &initial.id)
                    .await
                    .is_err()
            );
            assert_eq!(manager.sessions(&s.board.project_id).len(), 1);
            fs::remove_file(&output).unwrap();
            let resumed = manager
                .resume_with_user_config(
                    &s.board.data_dir,
                    &s.board.project_id,
                    &initial.id,
                    Some(choice),
                )
                .await
                .unwrap();
            assert_ne!(resumed.id, initial.id);
            assert_eq!(resumed.profile_id, initial.profile_id);
            assert_eq!(resumed.cwd, initial.cwd);
            assert_eq!(
                manager.agent_session_id(&resumed.id).unwrap().as_deref(),
                Some(native_id.as_str())
            );
            // A second click through the old row cannot launch a second copy.
            assert!(
                manager
                    .resume_with_user_config(
                        &s.board.data_dir,
                        &s.board.project_id,
                        &initial.id,
                        Some(choice)
                    )
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("already open")
            );
            manager
                .terminal_resize(TerminalResizeInput {
                    session_id: resumed.id.clone(),
                    cols: 80,
                    rows: 24,
                })
                .unwrap();
            let received = capture(&output).await;
            manager.stop(&resumed.id).await.unwrap();
            let received = received.expect("scripted resumed CLI must capture argv");
            let argv = received["argv"].as_array().unwrap();
            let selector = if family == "claude" {
                "--resume"
            } else {
                "resume"
            };
            let pos = argv.iter().position(|arg| arg == selector).unwrap();
            assert_eq!(argv[pos + 1], native_id);
            assert!(!argv.iter().any(|arg| arg == "--session-id"));
            assert_eq!(received["token"], "b1-fictional-token");
            assert!(!received["argv"].to_string().contains("b1-fictional-token"));
            let has_exclusion = if family == "claude" {
                argv.iter().any(|arg| arg == "--setting-sources")
            } else {
                argv.iter().any(|arg| arg == "features.hooks=false")
            };
            assert_eq!(has_exclusion, choice == UserConfigChoice::Exclude);
            assert_eq!(history.list(None, None).unwrap().len(), 2);
            fs::remove_file(&path).unwrap();
            let before = manager.sessions(&s.board.project_id).len();
            assert!(
                manager
                    .resume_with_user_config(
                        &s.board.data_dir,
                        &s.board.project_id,
                        &initial.id,
                        Some(choice)
                    )
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("transcript is missing")
            );
            assert_eq!(manager.sessions(&s.board.project_id).len(), before);
        }
    }
}

#[test]
fn b1_manager_startup_recovers_pending_terminals_without_listing_or_launching() {
    for family in ["claude", "codex"] {
        let (s, store, record, root) = fixture(family);
        let path = if family == "claude" {
            claude_path(&record, &root)
        } else {
            root.join("sessions/2026/10/28/rollout-startup.jsonl")
        };
        write_jsonl(
            &path,
            if family == "claude" {
                claude_rows()
            } else {
                codex_rows("startup-native", &record.cwd, &record.entry.created_at)
            },
        );
        drop(store.create(record).unwrap());
        assert!(store.load("session-a").unwrap().entry.empty);
        let database =
            Arc::new(jam_core::Store::open(s.board.data_dir.join("startup.db")).unwrap());
        let manager = SessionManager::new(
            database,
            Arc::new(MemoryCredentials::default()),
            |_| {},
            |_| {},
        );
        let recovered = store.load("session-a").unwrap();
        assert!(!recovered.entry.empty);
        assert_eq!(recovered.entry.resumable, Resumable::Native);
        assert_eq!(recovered.entry.message_count, 2);
        assert!(manager.sessions(&s.board.project_id).is_empty());
    }
}

#[tokio::test]
async fn b1_natural_cli_exit_links_the_transcript_before_terminal_status_is_final() {
    let (s, history, record, root) = fixture("claude");
    let database = Arc::new(jam_core::Store::open(s.board.data_dir.join("natural.db")).unwrap());
    let manager = SessionManager::new(
        database.clone(),
        Arc::new(MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let script = s.board.data_dir.join("fake-natural-exit.cjs");
    fs::write(&script,r#"const fs=require('fs'),path=require('path'),argv=process.argv.slice(2);const id=argv[argv.indexOf('--session-id')+1],cwd=process.cwd(),at=new Date().toISOString();const dir=path.join(process.env.CLAUDE_CONFIG_DIR,'projects',cwd.replace(/[:\\/]/g,'-'));fs.mkdirSync(dir,{recursive:true});const rows=[{type:'user',sessionId:id,uuid:'u',timestamp:at,message:{role:'user',content:'Natural exit fixture'}},{type:'assistant',sessionId:id,uuid:'a',timestamp:at,message:{id:'a',role:'assistant',model:'natural-fixture-model',content:[{type:'text',text:'Done'}]}}];fs.writeFileSync(path.join(dir,id+'.jsonl'),rows.map(r=>JSON.stringify(r)+'\n').join(''));console.log('FAKE_NATURAL_EXIT');setTimeout(()=>process.exit(0),100);"#).unwrap();
    let node = which::which("node").unwrap();
    assert_eq!(
        node.file_stem()
            .unwrap()
            .to_string_lossy()
            .to_ascii_lowercase(),
        "node"
    );
    let mut profile = record.profile;
    profile.id = "b1-natural-node".into();
    profile.command = node.to_string_lossy().into_owned();
    profile.args = vec![script.to_string_lossy().into_owned()];
    profile.env.push(Env {
        name: "CLAUDE_CONFIG_DIR".into(),
        value: root.to_string_lossy().into_owned(),
    });
    database
        .set_setting(
            "agent_profiles",
            &serde_json::to_string(&vec![profile.clone()]).unwrap(),
        )
        .unwrap();
    let (resolved, args) = manager
        .profiles
        .get(&profile.id)
        .unwrap()
        .launch_command()
        .unwrap();
    assert_eq!(
        resolved.canonicalize().unwrap(),
        node.canonicalize().unwrap()
    );
    assert_eq!(
        std::path::Path::new(&args[0]).canonicalize().unwrap(),
        script.canonicalize().unwrap()
    );
    let view = manager
        .start(
            s.board.clone(),
            StartAgentSessionInput {
                profile_id: profile.id,
                user_config: Some(UserConfigChoice::Include),
                cwd: Some(s.view().cwd),
                model: None,
                effort: None,
            },
        )
        .await
        .unwrap();
    manager
        .terminal_resize(TerminalResizeInput {
            session_id: view.id.clone(),
            cols: 80,
            rows: 24,
        })
        .unwrap();
    let finished = tokio::time::timeout(
        Duration::from_secs(15),
        manager.get(&view.id).unwrap().finished.cancelled(),
    )
    .await;
    manager.stop(&view.id).await.unwrap();
    finished.expect("fake CLI natural exit");
    assert_eq!(
        manager.get(&view.id).unwrap().view().status,
        SessionStatus::Stopped
    );
    let ended = history.load(&view.id).unwrap();
    assert_eq!(ended.entry.title, "Natural exit fixture");
    assert_eq!(ended.entry.message_count, 2);
    assert_eq!(ended.entry.model.as_deref(), Some("natural-fixture-model"));
    assert_eq!(ended.entry.resumable, Resumable::Native);
}
