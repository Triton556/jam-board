use super::*;
use std::time::Duration;

pub(super) fn scratch() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-visuals/round7/a2-launch-wiring")
        .join(ulid::Ulid::generate().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    // Match the OS/Node child cwd: Unix absolute() retains `..`, while Windows
    // canonicalize() adds a verbatim prefix that the CLI does not retain.
    if cfg!(windows) {
        std::path::absolute(dir).unwrap()
    } else {
        dir.canonicalize().unwrap()
    }
}

/// A process test may invoke only the explicitly resolved Node interpreter and
/// a script written by this fixture. Never resolve an agent preset on PATH.
fn assert_fake_launch(executable: &Path, args: &[String], node: &Path, script: &Path) {
    assert!(executable.is_absolute());
    assert_eq!(
        executable.canonicalize().unwrap(),
        node.canonicalize().unwrap()
    );
    assert_eq!(
        executable
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_ascii_lowercase(),
        "node"
    );
    assert_eq!(args.first().map(String::as_str), script.to_str());
    assert!(script.is_file());
    assert!(
        script.canonicalize().unwrap().starts_with(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../test-visuals/round7/a2-launch-wiring")
                .canonicalize()
                .unwrap()
        )
    );
}
fn entries() -> Vec<McpEntry> {
    vec![
        McpEntry {
            enabled: true,
            name: "web".into(),
            command: "fixture-mcp".into(),
            env: vec![
                Env {
                    name: "BRAVE_API_KEY".into(),
                    value: "fictional-brave-secret".into(),
                },
                Env {
                    name: "TAVILY_API_KEY".into(),
                    value: "fictional-tavily-secret".into(),
                },
            ],
            ..Default::default()
        },
        McpEntry {
            enabled: true,
            name: "remote".into(),
            http: Some(McpHttp {
                url: "https://example.invalid/mcp".into(),
                bearer_secret_key: None,
            }),
            bearer_token: Some("fictional-bearer-secret".into()),
            ..Default::default()
        },
    ]
}

#[test]
fn terminal_config_contains_references_and_no_credential_values() {
    let entries = entries();
    for family in ["claude", "codex"] {
        let preset = format!("{family}-cli");
        let (_, args) = terminal_command(Some(&preset), family, &[], &entries).unwrap();
        assert!(!args.join(" ").contains("fictional-"));
        let env = terminal_environment(Some(&preset), family, &entries).unwrap();
        assert_eq!(env.len(), 3);
        if family == "claude" {
            let config: serde_json::Value = serde_json::from_str(&args[1]).unwrap();
            assert_eq!(
                config["mcpServers"]["web"]["env"]["BRAVE_API_KEY"],
                "${JAM_MCP_0_ENV_0}"
            );
            assert_eq!(
                config["mcpServers"]["remote"]["headers"]["Authorization"],
                "Bearer ${JAM_MCP_1_BEARER_TOKEN}"
            );
        } else {
            assert!(args.iter().any(
                |a| a == "mcp_servers.\"web\".env_vars=[\"BRAVE_API_KEY\",\"TAVILY_API_KEY\"]"
            ));
            assert!(
                args.iter().any(|a| a
                    == "mcp_servers.\"remote\".bearer_token_env_var=\"JAM_MCP_1_BEARER_TOKEN\"")
            );
        }
    }
}

#[test]
fn codex_rejects_conflicting_forwarded_values_without_echoing_them() {
    let mut entries = entries();
    let mut duplicate = entries[0].clone();
    duplicate.name = "other".into();
    duplicate.env[0].value = "second-secret".into();
    entries.push(duplicate);
    let error = terminal_command(Some("codex-cli"), "codex", &[], &entries)
        .unwrap_err()
        .to_string();
    assert!(error.contains("conflicting"));
    assert!(!error.contains("secret"));
    // Claude aliases are per-server, so distinct values remain isolated.
    assert!(terminal_environment(Some("claude-cli"), "claude", &entries).is_ok());
}

#[test]
fn injected_name_and_guide_context_match_and_are_unique_per_launch() {
    let fixture = crate::tests::session(SessionStatus::Starting);
    let mut first = fixture.board.clone();
    first.key_prefix = "A / B__✨".into();
    first.name_for_launch();
    let mut second = first.clone();
    second.name_for_launch();
    assert_ne!(first.server_name(), second.server_name());
    assert!(first.server_name().starts_with("jam-board-AB-"));
    assert!(
        first
            .server_name()
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    );
    let entries = mcp_entries(&first, "Brain", &[]).unwrap();
    assert_eq!(entries[0].name, first.server_name());
    assert!(
        first
            .preamble()
            .contains(&format!("Use the {} MCP server", entries[0].name))
    );
    assert!(
        first
            .preamble()
            .contains("read jam://guide first from that server")
    );
    let override_entry = McpEntry {
        name: first.server_name().into(),
        ..Default::default()
    };
    assert!(mcp_entries(&first, "Brain", &[override_entry]).is_err());
}

#[test]
fn claude_terminal_id_is_uuid_v4_and_codex_gets_no_unknown_flag() {
    let mut args = vec!["--model".into(), "fixture".into()];
    let id = terminal_session_id(Some("claude-cli"), "node", &mut args)
        .unwrap()
        .unwrap();
    assert_eq!(id.len(), 36);
    assert_eq!(&id[14..15], "4");
    assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    assert_eq!(
        id.split('-').map(str::len).collect::<Vec<_>>(),
        [8, 4, 4, 4, 12]
    );
    assert_eq!(&args[args.len() - 2..], &["--session-id", &id]);
    assert!(terminal_session_id(Some("claude-cli"), "claude", &mut args).is_err());
    let mut codex = vec![];
    assert!(
        terminal_session_id(Some("codex-cli"), "codex", &mut codex)
            .unwrap()
            .is_none()
    );
    assert!(codex.is_empty());
}

#[tokio::test]
async fn launch_records_terminal_identity_cwd_time_and_warning_in_session_history() {
    use std::sync::Arc;
    for preset in ["claude-cli", "codex-cli"] {
        let root = scratch();
        let fake = root.join("fake-cli.cjs");
        let output = root.join("received.json");
        std::fs::write(&fake,"require('fs').writeFileSync(process.env.JAM_TEST_OUTPUT,JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));setInterval(()=>{},1000)").unwrap();
        let fixture = crate::tests::session(SessionStatus::Starting);
        let mut board = fixture.board.clone();
        board.data_dir = root.clone();
        std::fs::write(
            root.join("config.toml"),
            "[mcp_servers.jam-board]\nenabled=false\n",
        )
        .unwrap();
        std::fs::write(
            root.join(".claude.json"),
            r#"{"mcpServers":{"jam-board":{"command":"old-jam-board-mcp"}}}"#,
        )
        .unwrap();
        let store = Arc::new(jam_core::Store::open(root.join("board.db")).unwrap());
        let manager = SessionManager::new(
            store.clone(),
            Arc::new(crate::tests::MemoryCredentials::default()),
            |_| {},
            |_| {},
        );
        let node = which::which("node").unwrap();
        // Persist a custom fixture directly: save() deliberately ignores
        // executable overrides for built-ins. Preserve only the CLI dialect.
        let mut profile = manager.profiles.get(preset).unwrap();
        profile.id = format!("fixture-{preset}");
        profile.label = "Scripted CLI".into();
        profile.command = node.to_string_lossy().into_owned();
        profile.args = vec![fake.to_string_lossy().into_owned()];
        profile.env = vec![
            Env {
                name: "PATH".into(),
                value: String::new(),
            },
            Env {
                name: "JAM_TEST_OUTPUT".into(),
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
        ];
        store
            .set_setting(
                "agent_profiles",
                &serde_json::to_string(&vec![profile.clone()]).unwrap(),
            )
            .unwrap();
        let (resolved, resolved_args) = manager
            .profiles
            .get(&profile.id)
            .unwrap()
            .launch_command()
            .unwrap();
        assert_fake_launch(&resolved, &resolved_args, &node, &fake);
        let before = time::OffsetDateTime::now_utc();
        let view = manager
            .start(
                board,
                StartAgentSessionInput {
                    user_config: Some(UserConfigChoice::Include),
                    profile_id: profile.id,
                    cwd: Some(root.to_string_lossy().into_owned()),
                    model: None,
                    effort: None,
                },
            )
            .await
            .unwrap();
        manager
            .terminal_resize(TerminalResizeInput {
                session_id: view.id.clone(),
                cols: 100,
                rows: 30,
            })
            .unwrap();
        let observed = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Ok(bytes) = std::fs::read(&output)
                    && let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes)
                {
                    break v;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await;
        manager.stop(&view.id).await.unwrap();
        let observed = observed.expect("Scripted CLI startup timeout");
        let id = manager.agent_session_id(&view.id).unwrap();
        if preset == "claude-cli" {
            let args = observed["argv"].as_array().unwrap();
            let index = args.iter().position(|a| a == "--session-id").unwrap();
            assert_eq!(args[index + 1], id.unwrap());
        } else {
            assert!(id.is_none());
        }
        assert_eq!(
            Path::new(observed["cwd"].as_str().unwrap()),
            Path::new(&view.cwd)
        );
        assert!(
            time::OffsetDateTime::parse(
                &view.created_at,
                &time::format_description::well_known::Rfc3339
            )
            .unwrap()
                >= before
        );
        let events = manager.history(&view.id).unwrap();
        assert!(events.iter().any(|event| matches!(&event.event, AgentEventKind::Status { message:Some(message),.. } if message.starts_with("Launch warning: ") && message.contains("configPath") && message.contains("suggestedFix") && message.contains("jam-board-FB-"))));
        assert!(
            !observed["argv"]
                .to_string()
                .contains("mcp_servers.\\\"jam-board\\\".")
        );
    }
}

/// Runs on Windows and Linux. Inspects both the recorder's received argv and the
/// OS process command line, including Windows npm-style cmd/bat forwarding.
#[tokio::test]
async fn spawned_cli_argv_has_no_secrets_and_environment_delivers_values() {
    let root = scratch();
    let script = root.join("record.cjs");
    std::fs::write(&script, "const fs=require('fs');fs.writeFileSync(process.env.JAM_TEST_OUTPUT,JSON.stringify({pid:process.pid,argv:process.argv.slice(2),env:Object.fromEntries(JSON.parse(process.env.JAM_TEST_FORWARD_NAMES).map(k=>[k,process.env[k]]))}));setInterval(()=>{},1000);").unwrap();
    let node = which::which("node").expect("Offline Node recorder must be installed");
    #[cfg(windows)]
    let launchers = vec!["direct", "cmd", "bat"];
    #[cfg(not(windows))]
    let launchers = vec!["direct"];
    for family in ["claude", "codex"] {
        for extension in &launchers {
            let output = root.join(format!("{family}-{extension}.json"));
            let preset = format!("{family}-cli");
            let entries = entries();
            let launcher = if *extension == "direct" {
                node.clone()
            } else {
                let path = root.join(format!("recorder.{extension}"));
                std::fs::write(&path, format!("@\"{}\" %*\r\n", node.display())).unwrap();
                path
            };
            assert_fake_launch(
                &node,
                &[script.to_string_lossy().into_owned()],
                &node,
                &script,
            );
            assert!(launcher.is_absolute());
            if *extension != "direct" {
                assert!(launcher.starts_with(&root));
                assert_eq!(
                    std::fs::read_to_string(&launcher).unwrap(),
                    format!("@\"{}\" %*\r\n", node.display())
                );
            }
            let (_, args) = terminal_command(
                Some(&preset),
                launcher.to_str().unwrap(),
                &[script.to_string_lossy().into_owned()],
                &entries,
            )
            .unwrap();
            let mut env =
                terminal_environment(Some(&preset), launcher.to_str().unwrap(), &entries).unwrap();
            env.push(Env {
                name: "JAM_TEST_FORWARD_NAMES".into(),
                value: serde_json::to_string(&env.iter().map(|e| &e.name).collect::<Vec<_>>())
                    .unwrap(),
            });
            env.push(Env {
                name: "JAM_TEST_OUTPUT".into(),
                value: output.to_string_lossy().into_owned(),
            });
            env.push(Env {
                name: "PATH".into(),
                value: String::new(),
            });
            let (command, args, launcher_env) = crate::launcher::terminal_launcher(
                launcher.to_string_lossy().into_owned(),
                args.clone(),
            )
            .unwrap();
            env.extend(launcher_env);
            if *extension == "direct" {
                assert_fake_launch(Path::new(&command), &args, &node, &script);
            } else {
                #[cfg(windows)]
                {
                    let expected = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
                    assert_eq!(command, expected);
                    assert_eq!(
                        args,
                        ["/d", "/s", "/v:off", "/c", "%JAM_DOCK_BATCH_COMMAND%"]
                    );
                    assert!(
                        env.iter()
                            .find(|e| e.name == "JAM_DOCK_BATCH_COMMAND")
                            .unwrap()
                            .value
                            .contains(launcher.to_str().unwrap())
                    );
                }
            }
            let s = crate::tests::session(SessionStatus::Starting);
            s.inner.lock().unwrap().view.kind = RuntimeKind::Terminal;
            crate::terminal::start(s.clone(), PathBuf::from(command), None, args, env, vec![])
                .await
                .unwrap();
            // Round 7 terminal startup waits for the renderer's fitted size.
            s.connector().unwrap().resize(100, 30).unwrap();
            let observed = tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    if let Ok(bytes) = std::fs::read(&output)
                        && let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes)
                    {
                        break value;
                    }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            })
            .await;
            let result = match observed {
                Ok(observed) => {
                    let pid = observed["pid"].as_u64().unwrap();
                    let commandline = os_commandline(pid);
                    let argv = observed["argv"].to_string();
                    assert!(!argv.contains("fictional-"));
                    assert!(!commandline.contains("fictional-"));
                    assert!(!commandline.is_empty());
                    assert!(
                        observed["env"]
                            .to_string()
                            .contains("fictional-brave-secret")
                    );
                    assert!(
                        observed["env"]
                            .to_string()
                            .contains("fictional-tavily-secret")
                    );
                    assert!(
                        observed["env"]
                            .to_string()
                            .contains("fictional-bearer-secret")
                    );
                    Ok(())
                }
                Err(e) => Err(e),
            };
            s.connector().unwrap().stop().await.unwrap();
            result.expect("CLI recorder did not start");
        }
    }
}

fn os_commandline(pid: u64) -> String {
    #[cfg(windows)]
    {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        #[link(name = "ntdll")]
        unsafe extern "system" {
            fn NtQueryInformationProcess(
                handle: *mut c_void,
                class: u32,
                buffer: *mut c_void,
                len: u32,
                required: *mut u32,
            ) -> i32;
        }
        #[repr(C)]
        struct UnicodeString {
            len: u16,
            maximum: u16,
            data: *const u16,
        }
        struct Handle(*mut c_void);
        impl Drop for Handle {
            fn drop(&mut self) {
                // SAFETY: owned OpenProcess handle, closed exactly once.
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        // WMI/CIM can be denied in a sandbox. Query only our own child through
        // PROCESS_QUERY_LIMITED_INFORMATION; do not request memory-write access.
        // SAFETY: no inherited handle and an existing recorder PID.
        let handle = Handle(unsafe { OpenProcess(0x1000, 0, pid as u32) });
        assert!(!handle.0.is_null(), "Cannot query recorder command line");
        let mut required = 0;
        // SAFETY: length-only query with a valid output pointer.
        unsafe {
            NtQueryInformationProcess(handle.0, 60, std::ptr::null_mut(), 0, &mut required);
        }
        assert!(required > 0 && required < 1024 * 1024);
        let mut buffer = vec![0usize; (required as usize).div_ceil(std::mem::size_of::<usize>())];
        let base = buffer.as_mut_ptr() as usize;
        let size = required as usize;
        // SAFETY: aligned, live buffer with the exact OS-requested capacity.
        let status = unsafe {
            NtQueryInformationProcess(
                handle.0,
                60,
                buffer.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        };
        assert!(status >= 0, "Cannot read recorder command line");
        // SAFETY: successful query returns a UNICODE_STRING at the aligned base.
        let value = unsafe { &*(buffer.as_ptr().cast::<UnicodeString>()) };
        assert!(
            value.data as usize >= base && value.data as usize + value.len as usize <= base + size
        );
        // SAFETY: checked that the UTF-16 slice stays within our buffer.
        String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(value.data, value.len as usize / 2)
        })
    }
    #[cfg(not(windows))]
    {
        std::fs::read_to_string(format!("/proc/{pid}/cmdline")).unwrap()
    }
}

#[derive(Default)]
struct CapturedLogs(std::sync::Mutex<String>);
impl tracing::Subscriber for CapturedLogs {
    fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn event(&self, event: &tracing::Event<'_>) {
        struct Visitor<'a>(&'a mut String);
        impl tracing::field::Visit for Visitor<'_> {
            fn record_debug(&mut self, _: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                use std::fmt::Write;
                let _ = writeln!(self.0, "{value:?}");
            }
        }
        event.record(&mut Visitor(&mut self.0.lock().unwrap()));
    }
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}

#[tokio::test(flavor = "current_thread")]
async fn fake_acp_stderr_and_tracing_redact_mcp_env_and_bearer_credentials() {
    use std::sync::Arc;
    let root = scratch();
    let script = root.join("fake-acp.cjs");
    std::fs::write(&script,r#"
const readline = require('readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const q=JSON.parse(line);
  if(q.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'fixture',version:'1'}}})+'\n');
  else if(q.method==='session/new') {process.stderr.write('FIXTURE '+JSON.stringify(q.params.mcpServers)+'\n',()=>process.exit(7));}
});
"#).unwrap();
    let fixture = crate::tests::session(SessionStatus::Starting);
    let mut board = fixture.board.clone();
    board.data_dir = root.clone();
    let store = Arc::new(jam_core::Store::open(root.join("board.db")).unwrap());
    let credentials = Arc::new(crate::tests::MemoryCredentials::default());
    let manager = SessionManager::new(store.clone(), credentials.clone(), |_| {}, |_| {});
    let node = which::which("node").unwrap();
    let mut profile = manager.profiles.get("claude-code").unwrap();
    profile.id = "fixture-acp".into();
    profile.preset = None;
    profile.command = node.to_string_lossy().into_owned();
    profile.args = vec![script.to_string_lossy().into_owned()];
    profile.env = vec![Env {
        name: "PATH".into(),
        value: String::new(),
    }];
    profile.extra_mcp_servers = entries();
    let bearer = "fictional-bearer-quote-\"-slash-\\-secret";
    profile.extra_mcp_servers[1].bearer_token = None;
    profile.extra_mcp_servers[1]
        .http
        .as_mut()
        .unwrap()
        .bearer_secret_key = Some("FIXTURE_TOKEN".into());
    credentials
        .set(&profile.id, "FIXTURE_TOKEN", bearer)
        .unwrap();
    store
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
    assert_fake_launch(&resolved, &args, &node, &script);
    let logs = Arc::new(CapturedLogs::default());
    let _capture = tracing::subscriber::set_default(logs.clone());
    let result = manager
        .start(
            board.clone(),
            StartAgentSessionInput {
                user_config: Some(UserConfigChoice::Include),
                profile_id: profile.id,
                cwd: Some(root.to_string_lossy().into_owned()),
                model: None,
                effort: None,
            },
        )
        .await;
    manager.stop_all().await;
    assert!(result.is_err());
    let view = manager.sessions(&board.project_id).pop().unwrap();
    let history = serde_json::to_string(&manager.history(&view.id).unwrap()).unwrap();
    let logs = logs.0.lock().unwrap();
    assert!(history.contains("FIXTURE"));
    assert!(
        logs.contains("FIXTURE"),
        "ACP stderr was not observed by tracing"
    );
    for text in [&history, &*logs] {
        assert!(text.contains("[REDACTED]"));
        for secret in [
            "fictional-brave-secret",
            "fictional-tavily-secret",
            "fictional-bearer-quote",
        ] {
            assert!(
                !text.contains(secret),
                "MCP credential escaped ACP redaction"
            );
        }
    }
}
