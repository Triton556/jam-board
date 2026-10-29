use crate::{
    session::{Control, Reply, Session},
    *,
};
use agent_client_protocol::{
    self as sdk,
    schema::{ProtocolVersion, v1 as a},
};
use futures::future::BoxFuture;
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::sync::{mpsc, oneshot};
use tokio_util::{
    compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt},
    sync::CancellationToken,
};
use tracing::instrument::WithSubscriber;

// Observe a complete JSON-RPC message without delaying or changing the wire stream.
struct StartupReader<R> {
    reader: R,
    traffic: Option<tokio::sync::watch::Sender<bool>>,
    session: Arc<Session>,
    pending: Vec<u8>,
}
impl<R: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for StartupReader<R> {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = std::pin::Pin::new(&mut self.reader).poll_read(cx, buf);
        let mut protocol_message = false;
        if self.traffic.is_some() {
            for byte in &buf.filled()[before..] {
                if *byte == b'\n' {
                    protocol_message |= serde_json::from_slice::<Value>(&self.pending)
                        .ok()
                        .is_some_and(|v| {
                            v["jsonrpc"] == "2.0"
                                && (v.get("method").is_some() || v.get("id").is_some())
                        });
                    self.pending.clear();
                } else if self.pending.len() < 1024 * 1024 {
                    self.pending.push(*byte);
                }
            }
        }
        if protocol_message && let Some(tx) = self.traffic.take() {
            self.pending.clear();
            self.session
                .launch_step("adapter", LaunchStepState::Ok, "Chat adapter responded");
            self.session.launch_step(
                "initialize",
                LaunchStepState::Running,
                "Connecting to chat adapter",
            );
            let _ = tx.send(true);
        }
        result
    }
}
fn package_launcher(executable: &std::path::Path, args: &[String]) -> bool {
    let name = executable
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    matches!(name.as_str(), "npx" | "pnpx" | "bunx")
        || (matches!(name.as_str(), "npm" | "pnpm" | "yarn" | "bun")
            && args
                .iter()
                .any(|a| matches!(a.as_str(), "exec" | "dlx" | "x")))
}
fn startup_timeout_message(connection: &str, download: bool) -> String {
    if download {
        format!(
            "{connection} chat didn't start in time. The first launch downloads its chat adapter, which can take a few minutes. Try again; if it keeps failing, open Logs."
        )
    } else {
        format!(
            "{connection} chat didn't start in time. Try again; if it keeps failing, open Logs."
        )
    }
}
async fn wait_for_startup<T>(
    ready: oneshot::Receiver<T>,
    mut traffic: tokio::sync::watch::Receiver<bool>,
    preparing: bool,
    adapter_budget: Duration,
    initialize_budget: Duration,
) -> std::result::Result<std::result::Result<T, oneshot::error::RecvError>, ()> {
    let deadline = tokio::time::sleep(if preparing {
        adapter_budget
    } else {
        initialize_budget
    });
    tokio::pin!(deadline);
    tokio::pin!(ready);
    tokio::select! {
        result = &mut ready => Ok(result),
        _ = &mut deadline => Err(()),
        _ = async { let _ = traffic.wait_for(|seen| *seen).await; } => tokio::time::timeout(initialize_budget, ready).await.map_err(|_| ()),
    }
}

struct AcpConnector {
    tx: mpsc::UnboundedSender<Control>,
    stop: CancellationToken,
    done: tokio::sync::watch::Receiver<bool>,
}
impl AcpConnector {
    async fn request(&self, make: impl FnOnce(Reply) -> Control) -> Result<()> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(make(tx))
            .map_err(|_| err("Agent session is disconnected"))?;
        rx.await.map_err(|_| err("Agent session is disconnected"))?
    }
}
impl Connector for AcpConnector {
    fn prompt(&self, content: Vec<PromptPart>) -> BoxFuture<'_, Result<()>> {
        Box::pin(self.request(|r| Control::Prompt(content, r)))
    }
    fn retry(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(self.request(Control::Retry))
    }
    fn cancel(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(self.request(Control::Cancel))
    }
    fn config(&self, option: String, value: String) -> BoxFuture<'_, Result<()>> {
        Box::pin(self.request(|r| Control::Config(option, value, r)))
    }
    fn stop(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(async {
            self.stop.cancel();
            let mut done = self.done.clone();
            if !*done.borrow() {
                let _ = done.wait_for(|v| *v).await;
            }
            Ok(())
        })
    }
}
pub(crate) async fn start(
    session: Arc<Session>,
    executable: PathBuf,
    args: Vec<String>,
    env: Vec<Env>,
    entries: Vec<McpEntry>,
    connection: String,
) -> Result<()> {
    let preparing = package_launcher(&executable, &args);
    session.launch_step(
        "adapter",
        LaunchStepState::Running,
        if preparing {
            format!("Preparing {connection} chat adapter (first launch may download it)…")
        } else {
            format!("Starting {connection} chat adapter…")
        },
    );
    let mut command = tokio::process::Command::new(&executable);
    command
        .args(args)
        .current_dir(&session.view().cwd)
        .envs(env.iter().map(|e| (&e.name, &e.value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|_| err(format!("Cannot launch {connection} chat adapter")))?;
    session.launch_step(
        "start_process",
        LaunchStepState::Ok,
        "Chat adapter process started",
    );
    let pid = child
        .id()
        .ok_or_else(|| err("Agent process has no process ID"))?;
    let tree = match crate::process::ProcessTree::attach(pid) {
        Ok(tree) => tree,
        Err(e) => {
            let _ = crate::session::kill_tree(pid).await;
            let _ = child.kill().await;
            return Err(e);
        }
    };
    let (traffic_tx, traffic_rx) = tokio::sync::watch::channel(false);
    let transport = sdk::ByteStreams::new(
        child.stdin.take().expect("stdin").compat_write(),
        StartupReader {
            reader: child.stdout.take().expect("stdout"),
            traffic: Some(traffic_tx),
            session: session.clone(),
            pending: Vec::new(),
        }
        .compat(),
    );
    let stderr = child.stderr.take().expect("stderr");
    let (tx, rx) = mpsc::unbounded_channel();
    let stop = session.stop.clone();
    let (done_tx, done) = tokio::sync::watch::channel(false);
    let mut startup_done = done.clone();
    *session.connector.lock().expect("connector lock") = Some(Arc::new(AcpConnector {
        tx,
        stop: stop.clone(),
        done,
    }));
    let (ready_tx, ready_rx) = oneshot::channel();
    let stderr_session = session.clone();
    let tail = Arc::new(std::sync::Mutex::new(String::new()));
    let stderr_tail = tail.clone();
    let stderr_task = tokio::spawn(async move {
        read_adapter_stderr(&stderr_session, stderr, &stderr_tail).await;
    });
    let task_stop = stop.clone();
    let startup_session = session.clone();
    tokio::spawn(async move {
        let protocol = run_connection(session.clone(), transport, entries, rx, ready_tx);
        tokio::pin!(protocol);
        let outcome = tokio::select! {
            biased;
            _ = task_stop.cancelled() => None,
            result = &mut protocol => Some(result),
            status = child.wait() => Some(Err(err(format!("Agent process exited: {}", status.map(|s| s.to_string()).unwrap_or_else(|_| "unknown status".into()))))),
        };
        // Stop descendants before releasing the parent handle. Also reap the child.
        let _ = crate::session::kill_tree(pid).await;
        let _ = tree.terminate();
        let _ = child.kill().await;
        let _ = child.wait().await;
        let mut stderr_task = stderr_task;
        if tokio::time::timeout(Duration::from_secs(2), &mut stderr_task)
            .await
            .is_err()
        {
            stderr_task.abort();
            let _ = stderr_task.await;
        }
        session.cancel_permissions();
        match outcome {
            None => session.status(SessionStatus::Stopped, None),
            Some(Ok(())) => session.status(SessionStatus::Stopped, None),
            Some(Err(e)) => session.fail(
                "Chat connection disconnected",
                Some(format!(
                    "{}\n{}",
                    session.redact(&e.to_string()),
                    tail.lock().expect("stderr tail")
                )),
            ),
        }
        let _ = done_tx.send(true);
        session.finished.cancel();
    });
    match wait_for_startup(
        ready_rx,
        traffic_rx,
        preparing,
        Duration::from_secs(180),
        Duration::from_secs(60),
    )
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => {
            let _ = startup_done.wait_for(|v| *v).await;
            let detail = startup_session
                .inner
                .lock()
                .expect("session lock")
                .events
                .iter()
                .rev()
                .find_map(|e| match &e.event {
                    AgentEventKind::Error {
                        message, detail, ..
                    } => Some(detail.clone().unwrap_or_else(|| message.clone())),
                    _ => None,
                })
                .unwrap_or_else(|| "Agent session stopped during initialization".into());
            Err(err(detail))
        }
        Err(_) => {
            let message = startup_timeout_message(&connection, preparing);
            startup_session.fail(
                &message,
                Some("ACP initialize/session readiness deadline exceeded".into()),
            );
            stop.cancel();
            let _ = startup_done.wait_for(|v| *v).await;
            Err(err(message))
        }
    }
}

async fn read_adapter_stderr(
    session: &Session,
    mut stderr: impl tokio::io::AsyncRead + Unpin,
    tail: &std::sync::Mutex<String>,
) {
    use tokio::io::AsyncReadExt;
    let mut buffer = [0u8; 4096];
    let mut pending = Vec::new();
    let mut overlong = false;
    while let Ok(n) = stderr.read(&mut buffer).await {
        if n == 0 {
            break;
        }
        for byte in &buffer[..n] {
            if *byte == b'\n' {
                record_stderr(
                    session,
                    if overlong {
                        "[Adapter stderr line omitted: over 16 KiB]".into()
                    } else {
                        String::from_utf8_lossy(&pending)
                            .trim_end_matches('\r')
                            .to_owned()
                    },
                    tail,
                );
                pending.clear();
                overlong = false;
            } else if !overlong {
                if pending.len() == 16 * 1024 {
                    pending.clear();
                    overlong = true;
                } else {
                    pending.push(*byte);
                }
            }
        }
    }
    if overlong || !pending.is_empty() {
        record_stderr(
            session,
            if overlong {
                "[Adapter stderr line omitted: over 16 KiB]".into()
            } else {
                String::from_utf8_lossy(&pending).into_owned()
            },
            tail,
        );
    }
}
fn record_stderr(session: &Session, line: String, tail: &std::sync::Mutex<String>) {
    let line = crate::wiring::launch_config::redact_diagnostic(&session.redact(&line));
    session.adapter_log(&line);
    let lower = line.to_ascii_lowercase();
    let downloading = [
        "npm http fetch",
        "npm warn exec",
        "npm info",
        "npm notice",
        "downloading",
        "fetch manifest",
    ]
    .iter()
    .any(|s| lower.contains(s));
    if downloading
        && session
            .inner
            .lock()
            .expect("session lock")
            .launch_steps
            .get("adapter")
            .is_some_and(|s| s.state == LaunchStepState::Running)
    {
        session.launch_step(
            "adapter",
            LaunchStepState::Running,
            "Downloading chat adapter packages; first launch may take a few minutes…",
        );
    }
    tracing::debug!(session_id = %session.view().id, stderr = %line, "ACP stderr");
    let mut tail = tail.lock().expect("stderr tail");
    tail.push_str(&line);
    tail.push('\n');
    if tail.len() > 8192 {
        let mut cut = tail.len() - 8192;
        while !tail.is_char_boundary(cut) {
            cut += 1;
        }
        tail.drain(..cut);
    }
}

pub(crate) async fn run_connection<T: sdk::ConnectTo<sdk::Client>>(
    session: Arc<Session>,
    transport: T,
    entries: Vec<McpEntry>,
    mut controls: mpsc::UnboundedReceiver<Control>,
    ready: oneshot::Sender<Result<()>>,
) -> Result<()> {
    let updates = session.clone();
    let permissions = session.clone();
    let auth = session.clone();
    let diagnostics = tracing::dispatcher::get_default(Clone::clone);
    sdk::Client
        .builder()
        .on_receive_notification(
            async move |notification: a::SessionNotification, _cx| {
                map_update(
                    &updates,
                    serde_json::to_value(notification.update)
                        .map_err(sdk::Error::into_internal_error)?,
                );
                Ok(())
            },
            sdk::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: a::RequestPermissionRequest,
                        responder: sdk::Responder<a::RequestPermissionResponse>,
                        _cx| {
                let options = request
                    .options
                    .iter()
                    .map(|option| {
                        Ok(PermissionOption {
                            option_id: option.option_id.to_string(),
                            name: option.name.clone(),
                            kind: serde_json::from_value(
                                serde_json::to_value(option.kind)
                                    .map_err(sdk::Error::into_internal_error)?,
                            )
                            .map_err(sdk::Error::into_internal_error)?,
                        })
                    })
                    .collect::<std::result::Result<Vec<_>, sdk::Error>>()?;
                let tool = serde_json::to_value(&request.tool_call)
                    .map_err(sdk::Error::into_internal_error)?;
                let rx = permissions.permission(
                    Some(request.tool_call.tool_call_id.to_string()),
                    text(&tool, "title")
                        .unwrap_or("Allow agent tool call?")
                        .into(),
                    options,
                );
                // Incoming dispatch is ordered. Keep it free while the human decides
                // so cancellation and later notifications continue to be processed.
                tokio::spawn(async move {
                    let outcome = match rx.await.unwrap_or(None) {
                        Some(id) => a::RequestPermissionOutcome::Selected(
                            a::SelectedPermissionOutcome::new(id),
                        ),
                        None => a::RequestPermissionOutcome::Cancelled,
                    };
                    let _ = responder.respond(a::RequestPermissionResponse::new(outcome));
                });
                Ok(())
            },
            sdk::on_receive_request!(),
        )
        .on_receive_notification(async move |notification: sdk::UntypedMessage, _cx| {
            if notification.method == "_auth/status_update" {
                if let Ok(params) = serde_json::to_value(notification.params) { map_auth_status(&auth, &params); }
            } else {
                tracing::dispatcher::with_default(&diagnostics, || tracing::debug!(method = %notification.method, "Ignoring unknown ACP notification"));
            }
            Ok(())
        }, sdk::on_receive_notification!())
        .connect_with(transport, async move |cx: sdk::ConnectionTo<sdk::Agent>| {
            if !session.inner.lock().expect("session lock").launch_steps.contains_key("adapter") {
                session.launch_step("initialize", LaunchStepState::Running, "Connecting to chat adapter");
            }
            let init = cx
                .send_request(
                    a::InitializeRequest::new(ProtocolVersion::V1)
                        .client_capabilities(
                            a::ClientCapabilities::new().session(
                                a::ClientSessionCapabilities::new().config_options(
                                    a::SessionConfigOptionsCapabilities::new()
                                        .boolean(a::BooleanConfigOptionCapabilities::new()),
                                ),
                            ),
                        )
                        .client_info(a::Implementation::new(
                            "Jam Board",
                            env!("CARGO_PKG_VERSION"),
                        )),
                )
                .block_task()
                .await.inspect_err(|e| {
                    session.launch_step("initialize", LaunchStepState::Failed, "Chat adapter initialization failed; see Logs");
                    crate::provider_errors::emit_failure(&session, crate::provider_errors::acp_failure(e));
                })?;
            if init.protocol_version != ProtocolVersion::V1 {
                return Err(sdk::Error::invalid_params().data("Unsupported ACP protocol version"));
            }
            session.launch_step("initialize", LaunchStepState::Ok, "Chat adapter initialized");
            let prompt_caps = &init.agent_capabilities.prompt_capabilities;
            session
                .inner
                .lock()
                .expect("session lock")
                .view
                .capabilities = Capabilities {
                images: prompt_caps.image,
                audio: prompt_caps.audio,
                embedded_context: prompt_caps.embedded_context,
                config_options: false,
            };
            let servers = entries.iter().filter(|e| e.enabled).map(|e| {
                if let Some(http) = &e.http {
                    a::McpServer::Http(a::McpServerHttp::new(&e.name, &http.url).headers(
                        e.bearer_token.as_ref().map(|v| a::HttpHeader::new("Authorization", format!("Bearer {v}"))).into_iter().collect()
                    ))
                } else {
                    a::McpServer::Stdio(a::McpServerStdio::new(&e.name, &e.command).args(e.args.clone()).env(e.env.iter().map(|v| a::EnvVariable::new(&v.name, &v.value)).collect()))
                }
            }).collect();
            let native_id = session.inner.lock().expect("session lock").resume_native_id.clone();
            let supported = init.agent_capabilities.load_session;
            let meta = session.inner.lock().expect("session lock").launch_meta.as_ref().and_then(|m| m.as_object().cloned());
            session.launch_step("session", LaunchStepState::Running, if native_id.is_some() { "Restoring chat session" } else { "Creating chat session" });
            let (id, new) = if let Some(id) = native_id {
                if !supported { return Err(sdk::Error::invalid_params().data("Agent no longer supports session/load")); }
                let loaded = cx.send_request(a::LoadSessionRequest::new(id.clone(), PathBuf::from(&session.view().cwd)).mcp_servers(servers).meta(meta)).block_task().await.inspect_err(|e| report_setup_error(&session, e))?;
                let value = serde_json::to_value(loaded).map_err(sdk::Error::into_internal_error)?;
                let mut response = value;
                response["sessionId"] = json!(id);
                let new: a::NewSessionResponse = serde_json::from_value(response).map_err(sdk::Error::into_internal_error)?;
                (new.session_id.clone(), new)
            } else {
                let new = cx.send_request(a::NewSessionRequest::new(PathBuf::from(&session.view().cwd)).mcp_servers(servers).meta(meta)).block_task().await.inspect_err(|e| report_setup_error(&session, e))?;
                (new.session_id.clone(), new)
            };
            session.launch_step("session", LaunchStepState::Ok, "Chat session established");
            session.inner.lock().expect("session lock").resume_native_id = Some(id.to_string());
            if let Some(writer) = session.history_writer.lock().expect("history writer lock").as_mut() {
                writer.native(id.to_string(), supported).map_err(sdk::Error::into_internal_error)?;
            }
            if let Some(options) = new.config_options {
                emit_config(
                    &session,
                    serde_json::to_value(options).map_err(sdk::Error::into_internal_error)?,
                );
            } else if let Some(modes) = new.modes {
                let options = ConfigOption {
                    category: Some("mode".into()),
                    description: None,
                    id: "mode".into(),
                    name: "Mode".into(),
                    value: modes.current_mode_id.to_string(),
                    values: modes
                        .available_modes
                        .into_iter()
                        .map(|m| ConfigValue {
                            value: m.id.to_string(),
                            name: m.name,
                            description: m.description,
                        })
                        .collect(),
                };
                let mut inner = session.inner.lock().expect("session lock");
                inner.legacy_mode = true;
                inner.view.capabilities.config_options = true;
                inner.config.insert("mode".into(), options.clone());
                session.push_locked(
                    &mut inner,
                    AgentEventKind::ConfigOptions {
                        options: vec![options],
                    },
                );
            }
            session.status(SessionStatus::Ready, None);
            let _ = ready.send(Ok(()));
            while let Some(control) = controls.recv().await {
                match control {
                    control @ (Control::Prompt(..) | Control::Retry(..)) => {
                        let (prepared, reply) = match control {
                            Control::Prompt(content, reply) => (prepare_prompt(&session, content), reply),
                            Control::Retry(reply) => (prepare_retry_with_selection(&session).map(|(blocks, _)| blocks), reply),
                            _ => unreachable!(),
                        };
                        match prepared {
                            Err(e) => {
                                let _ = reply.send(Err(e));
                            }
                            Ok(content) => {
                                let completed = session.clone();
                                let request =
                                    cx.send_request(a::PromptRequest::new(id.clone(), content));
                                request.on_receiving_result(async move |result| {
                                    completed.flush_text();
                                    completed.cancel_permissions();
                                    match result {
                                        Ok(response) => {
                                            completed.emit(AgentEventKind::TurnEnd {
                                                stop_reason: serde_json::to_value(
                                                    response.stop_reason,
                                                )
                                                .ok()
                                                .and_then(|v| v.as_str().map(str::to_owned))
                                                .unwrap_or_else(|| "end_turn".into()),
                                            });
                                        }
                                        Err(e) => {
                                            report_auth_error(&completed, &e);
                                            crate::provider_errors::emit_failure(&completed, crate::provider_errors::acp_failure(&e));
                                            completed.emit(AgentEventKind::TurnEnd { stop_reason: "error".into() });
                                        },
                                    }
                                    completed.inner.lock().expect("session lock").message_id = None;
                                    completed.status(SessionStatus::Ready, None);
                                    Ok(())
                                })?;
                                let _ = reply.send(Ok(()));
                            }
                        }
                    }
                    Control::Cancel(reply) => {
                        session.inner.lock().expect("session lock").cancelling = true;
                        session.cancel_permissions();
                        let result = cx
                            .send_notification(a::CancelNotification::new(id.clone()))
                            .map_err(|_| err("Cannot cancel disconnected agent"));
                        let _ = reply.send(result);
                    }
                    Control::Config(option, value, reply) => {
                        let (known, is_boolean, is_mode) = {
                            let inner = session.inner.lock().expect("session lock");
                            (
                                inner.config.get(&option).cloned(),
                                inner.boolean_config.contains(&option),
                                inner.legacy_mode && option == "mode",
                            )
                        };
                        let Some(known) = known else {
                            let _ = reply.send(Err(err("Unknown agent configuration option")));
                            continue;
                        };
                        if !known.values.iter().any(|v| v.value == value) {
                            let _ = reply.send(Err(err("Unknown agent configuration value")));
                            continue;
                        }
                        if is_mode {
                            let updated = session.clone();
                            cx.send_request(a::SetSessionModeRequest::new(
                                id.clone(),
                                value.clone(),
                            ))
                            .on_receiving_result(
                                async move |result| {
                                    let result = result
                                        .map(|_| {
                                            let mut inner =
                                                updated.inner.lock().expect("session lock");
                                            if let Some(mode) = inner.config.get_mut("mode") {
                                                mode.value = value;
                                            }
                                            let options = inner.config.values().cloned().collect();
                                            updated.push_locked(
                                                &mut inner,
                                                AgentEventKind::ConfigOptions { options },
                                            );
                                        })
                                        .map_err(|e| err(updated.redact(&e.to_string())));
                                    let _ = reply.send(result);
                                    Ok(())
                                },
                            )?;
                            continue;
                        }
                        let value = if is_boolean {
                            a::SessionConfigOptionValue::boolean(value == "true")
                        } else {
                            a::SessionConfigOptionValue::value_id(value)
                        };
                        let result = cx.send_request(a::SetSessionConfigOptionRequest::new(
                            id.clone(),
                            option,
                            value,
                        ));
                        let updated = session.clone();
                        result.on_receiving_result(async move |result| {
                            let result = match result {
                                Ok(response) => {
                                    emit_config(
                                        &updated,
                                        serde_json::to_value(response.config_options)
                                            .map_err(sdk::Error::into_internal_error)?,
                                    );
                                    Ok(())
                                }
                                Err(e) => Err(err(updated.redact(&e.to_string()))),
                            };
                            let _ = reply.send(result);
                            Ok(())
                        })?;
                    }
                }
            }
            Ok(())
        })
        // The SDK's debug/trace messages include complete protocol payloads.
        // Keep raw transport logging off; our stderr/error paths redact first.
        .with_subscriber(tracing::subscriber::NoSubscriber::default())
        .await
        .map_err(|e| err(e.to_string()))
}

fn report_setup_error(session: &Session, error: &sdk::Error) {
    report_auth_error(session, error);
    session.launch_step("session", LaunchStepState::Failed, error.to_string());
    crate::provider_errors::emit_failure(session, crate::provider_errors::acp_failure(error));
}

pub(crate) fn report_auth_error(session: &Session, error: &sdk::Error) {
    if error.code == a::ErrorCode::AuthRequired {
        session.emit(AgentEventKind::Auth {
            state: AuthState::Required,
            label: session.redact(&error.to_string()),
        });
    }
}
pub(crate) fn map_auth_status(session: &Session, params: &Value) {
    let status = &params["authStatus"];
    let state = match status["kind"].as_str().unwrap_or_default() {
        "none" => AuthState::Required,
        "authenticated" | "logged_in" | "loggedIn" | "api_key" | "apiKey" | "api-key"
        | "claude_ai" | "claudeAi" | "claude-ai" | "oauth" | "subscription" | "account"
        | "gateway" | "external" => AuthState::Ok,
        _ => AuthState::Unknown,
    };
    session.emit(AgentEventKind::Auth {
        state,
        label: status["label"]
            .as_str()
            .unwrap_or("Authentication status unknown")
            .into(),
    });
}

pub(crate) fn prepare_prompt(
    session: &Session,
    content: Vec<PromptPart>,
) -> Result<Vec<a::ContentBlock>> {
    prepare_prompt_with_selection(session, content).map(|(blocks, _)| blocks)
}
pub(crate) fn prepare_prompt_with_selection(
    session: &Session,
    content: Vec<PromptPart>,
) -> Result<(Vec<a::ContentBlock>, AgentSessionView)> {
    prepare_input(session, Some(content))
}
pub(crate) fn prepare_retry_with_selection(
    session: &Session,
) -> Result<(Vec<a::ContentBlock>, AgentSessionView)> {
    prepare_input(session, None)
}
fn prepare_input(
    session: &Session,
    content: Option<Vec<PromptPart>>,
) -> Result<(Vec<a::ContentBlock>, AgentSessionView)> {
    let retry = content.is_none();
    let mut inner = session.inner.lock().expect("session lock");
    if inner.view.status != SessionStatus::Ready || session.stop.is_cancelled() {
        return Err(err("Agent is not ready for another prompt"));
    }
    let captured = if retry {
        if !inner.last_turn_failed {
            return Err(err("There is no failed turn to retry"));
        }
        Some(
            inner
                .last_prompt
                .clone()
                .ok_or_else(|| err("There is no user message to retry"))?,
        )
    } else {
        None
    };
    let content =
        content.unwrap_or_else(|| captured.as_ref().expect("retry prompt").content.clone());
    if content.is_empty() {
        return Err(err("A prompt must contain at least one content part"));
    }
    crate::attachments::validate(&inner, &content)?;
    // Adapters recognize /usage only as one text block. A board preamble would
    // turn this local command into ordinary model input. Keep first-prompt
    // context pending for the next real prompt, including after command retry.
    let usage_command = inner.view.kind == RuntimeKind::Acp
        && matches!(content.as_slice(), [PromptPart::Text { text }] if text == "/usage")
        && inner
            .events
            .iter()
            .rev()
            .find_map(|e| match &e.event {
                AgentEventKind::AvailableCommands { commands } => {
                    Some(commands.iter().any(|c| c.name == "usage"))
                }
                _ => None,
            })
            .unwrap_or(false);
    let mut blocks = Vec::new();
    let preamble = captured
        .as_ref()
        .map(|p| p.preamble.clone())
        .unwrap_or_else(|| {
            (inner.first_prompt && !usage_command).then(|| session.board.preamble())
        });
    if let Some(preamble) = &preamble {
        blocks.push(json!({"type":"text","text":preamble}));
    }
    for part in &content {
        blocks.push(match part {
            PromptPart::Attachment { attachment_id } => crate::attachments::block(&inner, attachment_id)?,
            PromptPart::Text { text } => json!({"type":"text","text":text}),
            PromptPart::BoardRef { uri, text, .. } if inner.view.capabilities.embedded_context => json!({"type":"resource","resource":{"uri":uri,"mimeType":"text/plain","text":text}}),
            PromptPart::BoardRef { uri, label, text } => json!({"type":"text","text":format!("Board context — {label} ({uri}):\n{text}")}),
            PromptPart::Image { mime_type, data } => {
                if !inner.view.capabilities.images { return Err(err(if inner.view.kind == RuntimeKind::Api { "This model can't see images — pick a vision model" } else { "This agent does not support image prompts" })); }
                json!({"type":"image","mimeType":mime_type,"data":data})
            }
        });
    }
    let blocks = blocks
        .into_iter()
        .map(serde_json::from_value)
        .collect::<std::result::Result<Vec<a::ContentBlock>, _>>()?;
    for part in &content {
        if let PromptPart::Attachment { attachment_id } = part {
            inner
                .attachments
                .get_mut(attachment_id)
                .expect("validated attachment")
                .1 = true;
        }
    }
    inner.last_prompt = Some(crate::session::LastPrompt {
        content: content.clone(),
        preamble: preamble.clone(),
    });
    inner.last_turn_failed = false;
    if !usage_command {
        inner.first_prompt = false;
    }
    inner.message_id = None;
    inner.cancelling = false;
    inner.view.status = SessionStatus::Running;
    if retry {
        let code = inner.last_failure_code.unwrap_or(AgentErrorCode::Agent);
        let max_attempts = if inner.view.kind == RuntimeKind::Api {
            3
        } else {
            1
        };
        session.push_locked(
            &mut inner,
            AgentEventKind::Retrying {
                attempt: 1,
                max_attempts,
                delay_ms: 0,
                code,
            },
        );
    } else {
        session.push_locked(
            &mut inner,
            AgentEventKind::UserMessage {
                message_id: ulid::Ulid::generate().to_string(),
                content,
                context_preamble: preamble,
            },
        );
    }
    session.push_locked(
        &mut inner,
        AgentEventKind::Status {
            status: SessionStatus::Running,
            message: None,
        },
    );
    Ok((blocks, inner.view.clone()))
}
fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}
fn short_content(value: &Value) -> Option<String> {
    fn render(v: &Value, out: &mut Vec<String>) {
        if let Some(text) = v.get("text").and_then(Value::as_str) {
            out.push(text.into());
        }
        if let Some(diff) = v.get("newText").and_then(Value::as_str) {
            out.push(format!(
                "{}\n{diff}",
                v.get("path").and_then(Value::as_str).unwrap_or("Diff")
            ));
        }
        for key in ["content", "resource"] {
            if let Some(v) = v.get(key) {
                render(v, out);
            }
        }
        if let Some(array) = v.as_array() {
            for v in array {
                render(v, out);
            }
        }
        if let Some(terminal) = v.get("terminalId").and_then(Value::as_str) {
            out.push(format!("Terminal {terminal}"));
        }
    }
    let mut out = Vec::new();
    render(value, &mut out);
    (!out.is_empty()).then(|| out.join("\n").chars().take(4000).collect())
}
pub(crate) fn emit_config(session: &Session, value: Value) {
    fn values(value: &Value) -> Vec<ConfigValue> {
        value
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|v| {
                if v.get("options").is_some() {
                    values(&v["options"])
                } else {
                    vec![ConfigValue {
                        value: text(v, "value").unwrap_or_default().into(),
                        name: text(v, "name").unwrap_or_default().into(),
                        description: text(v, "description").map(str::to_owned),
                    }]
                }
            })
            .collect()
    }
    let options = value
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| {
            if text(v, "type") == Some("boolean") {
                ConfigOption {
                    category: text(v, "category").map(str::to_owned),
                    description: text(v, "description").map(str::to_owned),
                    id: text(v, "id").unwrap_or_default().into(),
                    name: text(v, "name").unwrap_or_default().into(),
                    value: v["currentValue"].to_string(),
                    values: vec![
                        ConfigValue {
                            value: "true".into(),
                            name: "On".into(),
                            description: None,
                        },
                        ConfigValue {
                            value: "false".into(),
                            name: "Off".into(),
                            description: None,
                        },
                    ],
                }
            } else {
                ConfigOption {
                    category: text(v, "category").map(str::to_owned),
                    description: text(v, "description").map(str::to_owned),
                    id: text(v, "id").unwrap_or_default().into(),
                    name: text(v, "name").unwrap_or_default().into(),
                    value: text(v, "currentValue").unwrap_or_default().into(),
                    values: values(&v["options"]),
                }
            }
        })
        .collect::<Vec<_>>();
    {
        let mut inner = session.inner.lock().expect("session lock");
        inner.view.capabilities.config_options = true;
        inner.view.model = options
            .iter()
            .find(|o| o.category.as_deref() == Some("model"))
            .map(|o| o.value.clone())
            .or_else(|| inner.view.model.clone());
        inner.view.effort = options
            .iter()
            .find(|o| o.category.as_deref() == Some("thought_level"))
            .map(|o| o.value.clone());
        inner.config = options.iter().cloned().map(|o| (o.id.clone(), o)).collect();
        inner.boolean_config = value
            .as_array()
            .into_iter()
            .flatten()
            .filter(|v| text(v, "type") == Some("boolean"))
            .filter_map(|v| text(v, "id").map(str::to_owned))
            .collect();
        inner.legacy_mode = false;
    }
    session.emit(AgentEventKind::ConfigOptions { options });
}
pub(crate) fn map_update(session: &Session, v: Value) {
    let kind = text(&v, "sessionUpdate").unwrap_or_default();
    if matches!(kind, "tool_call" | "tool_call_update")
        && let Some(content) = short_content(&v)
        && content.to_ascii_lowercase().contains("mcp server ")
    {
        session.adapter_log(&content);
    }
    let previous = session
        .inner
        .lock()
        .expect("session lock")
        .message_id
        .as_ref()
        .map(|(kind, _)| kind.clone());
    if previous.as_deref().is_some_and(|previous| previous != kind) {
        session.flush_text();
    }
    let event = match kind {
        "agent_message_chunk" | "agent_thought_chunk" => {
            let mut inner = session.inner.lock().expect("session lock");
            let id = if let Some((previous, id)) = &inner.message_id {
                if previous == kind {
                    id.clone()
                } else {
                    ulid::Ulid::generate().to_string()
                }
            } else {
                ulid::Ulid::generate().to_string()
            };
            inner.message_id = Some((kind.into(), id.clone()));
            inner
                .text_pending
                .push_str(&short_content(&v).unwrap_or_default());
            let text = session.take_safe_text(&mut inner.text_pending, false);
            if text.is_empty() {
                return;
            }
            if kind == "agent_message_chunk" {
                AgentEventKind::AgentMessageDelta {
                    message_id: id,
                    text,
                }
            } else {
                AgentEventKind::AgentThoughtDelta {
                    message_id: id,
                    text,
                }
            }
        }
        "user_message_chunk" => AgentEventKind::UserMessage {
            message_id: ulid::Ulid::generate().to_string(),
            content: vec![PromptPart::Text {
                text: short_content(&v).unwrap_or_default(),
            }],
            context_preamble: None,
        },
        "tool_call" => {
            session.inner.lock().expect("session lock").message_id = None;
            AgentEventKind::ToolCall {
                tool_name: None,
                tool_call_id: text(&v, "toolCallId").unwrap_or_default().into(),
                title: text(&v, "title").unwrap_or("Tool call").into(),
                tool_kind: text(&v, "kind").unwrap_or("other").into(),
                status: text(&v, "status").unwrap_or("pending").into(),
                input: v.get("rawInput").cloned(),
                content: short_content(&v),
                locations: v.get("locations").and_then(Value::as_array).map(|v| {
                    v.iter()
                        .filter_map(|l| text(l, "path").map(str::to_owned))
                        .collect()
                }),
            }
        }
        "tool_call_update" => AgentEventKind::ToolCallUpdate {
            tool_call_id: text(&v, "toolCallId").unwrap_or_default().into(),
            title: text(&v, "title").map(str::to_owned),
            status: text(&v, "status").map(str::to_owned),
            content: short_content(&v),
            output: v.get("rawOutput").cloned(),
        },
        "plan" => AgentEventKind::Plan {
            entries: serde_json::from_value(v["entries"].clone()).unwrap_or_default(),
        },
        "available_commands_update" => AgentEventKind::AvailableCommands {
            commands: v["availableCommands"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|v| AvailableCommand {
                    name: text(v, "name").unwrap_or_default().into(),
                    description: text(v, "description").unwrap_or_default().into(),
                })
                .collect(),
        },
        "config_option_update" => {
            emit_config(session, v["configOptions"].clone());
            return;
        }
        "current_mode_update" => {
            let mut inner = session.inner.lock().expect("session lock");
            if let Some(mode) = inner.config.get_mut("mode") {
                mode.value = text(&v, "currentModeId").unwrap_or_default().into();
                let options = inner.config.values().cloned().collect();
                session.push_locked(&mut inner, AgentEventKind::ConfigOptions { options });
            }
            return;
        }
        "session_info_update" => {
            if let Some(title) = text(&v, "title") {
                session.inner.lock().expect("session lock").view.title = session.redact(title);
            }
            return;
        }
        "usage_update" => {
            let (Some(used), Some(size)) = (v["used"].as_u64(), v["size"].as_u64()) else {
                return;
            };
            AgentEventKind::Usage {
                used,
                size,
                cost: serde_json::from_value::<UsageCost>(v["cost"].clone())
                    .ok()
                    .filter(|c| c.amount.is_finite() && c.amount >= 0.0),
            }
        }
        // Unadvertised extension updates have no matching dock surface.
        _ => return,
    };
    session.emit(event);
}

#[cfg(test)]
#[path = "acp_retry_tests.rs"]
mod retry_tests;

#[cfg(test)]
#[path = "launch_event_tests.rs"]
mod launch_event_tests;
