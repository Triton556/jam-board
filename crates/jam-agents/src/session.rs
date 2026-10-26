use crate::*;
use futures::future::BoxFuture;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

pub(crate) type Reply = oneshot::Sender<Result<()>>;
pub(crate) enum Control {
    Prompt(Vec<PromptPart>, Reply),
    Cancel(Reply),
    Config(String, String, Reply),
}

/// Runtime boundary shared by ACP and PTY; an API connector can implement this
/// without adding a desktop dependency or changing the dock protocol.
pub trait Connector: Send + Sync {
    fn prompt(&self, content: Vec<PromptPart>) -> BoxFuture<'_, Result<()>>;
    fn cancel(&self) -> BoxFuture<'_, Result<()>>;
    fn config(&self, option: String, value: String) -> BoxFuture<'_, Result<()>>;
    fn stop(&self) -> BoxFuture<'_, Result<()>>;
    fn write(&self, _data: &str) -> Result<()> {
        Err(err("This session has no terminal"))
    }
    fn resize(&self, _cols: u16, _rows: u16) -> Result<()> {
        Err(err("This session has no terminal"))
    }
}
pub(crate) type DockSink = Arc<dyn Fn(AgentDockEvent) + Send + Sync>;
pub(crate) type TerminalSink = Arc<dyn Fn(AgentTerminalOutput) + Send + Sync>;
pub(crate) struct PendingPermission {
    pub options: Vec<String>,
    pub reply: oneshot::Sender<Option<String>>,
}
pub(crate) struct SessionInner {
    pub view: AgentSessionView,
    pub events: VecDeque<AgentDockEvent>,
    pub seq: u64,
    pub permissions: BTreeMap<String, PendingPermission>,
    pub first_prompt: bool,
    pub message_id: Option<(String, String)>,
    pub scrollback: String,
    pub config: BTreeMap<String, ConfigOption>,
    pub boolean_config: Vec<String>,
    pub legacy_mode: bool,
    pub cancelling: bool,
    pub text_pending: String,
    pub attachments: BTreeMap<String, (AttachmentView, bool)>,
}
pub(crate) struct Session {
    pub inner: Mutex<SessionInner>,
    pub board: BoardContext,
    pub connector: Mutex<Option<Arc<dyn Connector>>>,
    pub secrets: Vec<String>,
    pub attachment_media: Option<Arc<dyn AttachmentMedia>>,
    pub dock_sink: DockSink,
    pub terminal_sink: TerminalSink,
    pub stop: tokio_util::sync::CancellationToken,
    pub finished: tokio_util::sync::CancellationToken,
}
pub(crate) fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
impl Session {
    pub fn stream_text(&self, message_id: &str, text: &str) {
        if text.is_empty() {
            return;
        }
        let mut inner = self.inner.lock().expect("session lock");
        inner.message_id = Some(("agent_message_chunk".into(), message_id.into()));
        inner.text_pending.push_str(text);
        let text = self.take_safe_text(&mut inner.text_pending, false);
        if !text.is_empty() {
            self.push_locked(
                &mut inner,
                AgentEventKind::AgentMessageDelta {
                    message_id: message_id.into(),
                    text,
                },
            );
        }
    }
    pub fn view(&self) -> AgentSessionView {
        self.inner.lock().expect("session lock").view.clone()
    }
    pub fn redact(&self, text: &str) -> String {
        let mut text = text.to_owned();
        for secret in &self.secrets {
            if !secret.is_empty() {
                text = text.replace(secret, "[REDACTED]");
            }
        }
        text
    }
    /// Retain only a suffix that could become a secret in the next chunk.
    /// This prevents split credentials from leaking without delaying terminal
    /// prompts that do not end with a credential prefix.
    pub fn take_safe_text(&self, pending: &mut String, finish: bool) -> String {
        *pending = self.redact(pending);
        let mut retain = 0;
        if !finish {
            for secret in &self.secrets {
                for (n, _) in secret.char_indices().skip(1) {
                    if n > retain && pending.ends_with(&secret[..n]) {
                        retain = n;
                    }
                }
            }
        }
        pending.drain(..pending.len() - retain).collect()
    }
    pub fn flush_text(&self) {
        let mut inner = self.inner.lock().expect("session lock");
        if let Some((kind, message_id)) = inner.message_id.clone() {
            let text = self.take_safe_text(&mut inner.text_pending, true);
            if !text.is_empty() {
                let event = if kind == "agent_thought_chunk" {
                    AgentEventKind::AgentThoughtDelta { message_id, text }
                } else {
                    AgentEventKind::AgentMessageDelta { message_id, text }
                };
                self.push_locked(&mut inner, event);
            }
        }
    }
    fn redact_json(&self, value: &mut serde_json::Value, raw_payload: bool) {
        match value {
            serde_json::Value::String(s) => *s = self.redact(s),
            serde_json::Value::Array(v) => {
                for v in v {
                    self.redact_json(v, raw_payload);
                }
            }
            serde_json::Value::Object(v) => {
                for (key, v) in v.iter_mut() {
                    // Wire discriminators and control identities are protocol,
                    // not rendered text. Never corrupt an enum or permission ID.
                    if raw_payload
                        || ![
                            "kind",
                            "type",
                            "status",
                            "state",
                            "messageId",
                            "toolCallId",
                            "requestId",
                            "optionId",
                        ]
                        .contains(&key.as_str())
                    {
                        self.redact_json(v, raw_payload || key == "input" || key == "output");
                    }
                }
            }
            _ => {}
        }
    }
    pub fn push_locked(&self, inner: &mut SessionInner, event: AgentEventKind) {
        let mut json = serde_json::to_value(&event).expect("serialize dock event");
        self.redact_json(&mut json, false);
        let event = serde_json::from_value(json).expect("redacted dock event");
        inner.seq += 1;
        let event = AgentDockEvent {
            session_id: inner.view.id.clone(),
            seq: inner.seq,
            at: now(),
            event,
        };
        if inner.events.len() == 5_000 {
            inner.events.pop_front();
        }
        inner.events.push_back(event.clone());
        (self.dock_sink)(event);
    }
    pub fn emit(&self, event: AgentEventKind) {
        self.push_locked(&mut self.inner.lock().expect("session lock"), event);
    }
    pub fn status(&self, status: SessionStatus, message: Option<String>) {
        let mut inner = self.inner.lock().expect("session lock");
        if matches!(
            inner.view.status,
            SessionStatus::Stopped | SessionStatus::Failed
        ) {
            return;
        }
        inner.view.status = status;
        self.push_locked(&mut inner, AgentEventKind::Status { status, message });
    }
    pub fn fail(&self, message: &str, detail: Option<String>) {
        self.cancel_permissions();
        if matches!(
            self.view().status,
            SessionStatus::Stopped | SessionStatus::Failed
        ) {
            return;
        }
        self.status(SessionStatus::Failed, Some(message.into()));
        self.emit(AgentEventKind::Error {
            message: message.into(),
            detail,
        });
    }
    pub fn connector(&self) -> Result<Arc<dyn Connector>> {
        self.connector
            .lock()
            .map_err(|_| err("Session lock unavailable"))?
            .clone()
            .ok_or_else(|| err("Session is still starting"))
    }
    pub fn permission(
        &self,
        tool_call_id: Option<String>,
        title: String,
        options: Vec<PermissionOption>,
    ) -> oneshot::Receiver<Option<String>> {
        let (reply, rx) = oneshot::channel();
        let mut inner = self.inner.lock().expect("session lock");
        if self.stop.is_cancelled()
            || inner.cancelling
            || (inner.view.status != SessionStatus::Running
                && inner.view.status != SessionStatus::AwaitingPermission)
        {
            let _ = reply.send(None);
            return rx;
        }
        let request_id = ulid::Ulid::generate().to_string();
        inner.permissions.insert(
            request_id.clone(),
            PendingPermission {
                options: options.iter().map(|o| o.option_id.clone()).collect(),
                reply,
            },
        );
        inner.view.status = SessionStatus::AwaitingPermission;
        self.push_locked(
            &mut inner,
            AgentEventKind::Status {
                status: SessionStatus::AwaitingPermission,
                message: None,
            },
        );
        self.push_locked(
            &mut inner,
            AgentEventKind::PermissionRequest {
                request_id,
                tool_call_id,
                title,
                options,
            },
        );
        rx
    }
    pub fn resolve(&self, request_id: &str, option_id: Option<String>) -> Result<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| err("Session lock unavailable"))?;
        let pending = inner
            .permissions
            .get(request_id)
            .ok_or_else(|| err("Permission request is no longer pending"))?;
        if option_id
            .as_ref()
            .is_some_and(|id| !pending.options.contains(id))
        {
            return Err(err("Unknown permission option"));
        }
        let pending = inner
            .permissions
            .remove(request_id)
            .expect("pending permission");
        let _ = pending.reply.send(option_id.clone());
        self.push_locked(
            &mut inner,
            AgentEventKind::PermissionResolved {
                request_id: request_id.into(),
                option_id,
            },
        );
        if inner.permissions.is_empty() && inner.view.status == SessionStatus::AwaitingPermission {
            inner.view.status = SessionStatus::Running;
            self.push_locked(
                &mut inner,
                AgentEventKind::Status {
                    status: SessionStatus::Running,
                    message: None,
                },
            );
        }
        Ok(())
    }
    pub fn cancel_permissions(&self) {
        let mut inner = self.inner.lock().expect("session lock");
        for (request_id, pending) in std::mem::take(&mut inner.permissions) {
            let _ = pending.reply.send(None);
            self.push_locked(
                &mut inner,
                AgentEventKind::PermissionResolved {
                    request_id,
                    option_id: None,
                },
            );
        }
    }
    pub fn terminal_output(&self, data: String) {
        let data = self.redact(&data);
        let mut inner = self.inner.lock().expect("session lock");
        inner.scrollback.push_str(&data);
        if inner.scrollback.len() > 256 * 1024 {
            let mut cut = inner.scrollback.len() - 256 * 1024;
            while !inner.scrollback.is_char_boundary(cut) {
                cut += 1;
            }
            inner.scrollback.drain(..cut);
        }
        (self.terminal_sink)(AgentTerminalOutput {
            session_id: inner.view.id.clone(),
            data,
        });
    }
}

pub struct SessionManager {
    pub profiles: Profiles,
    attachment_media: Option<Arc<dyn AttachmentMedia>>,
    sessions: Mutex<BTreeMap<String, Arc<Session>>>,
    dock_sink: DockSink,
    terminal_sink: TerminalSink,
    shutting_down: std::sync::atomic::AtomicBool,
}
impl SessionManager {
    pub fn new(
        store: Arc<jam_core::Store>,
        credentials: Arc<dyn CredentialStore>,
        dock_sink: impl Fn(AgentDockEvent) + Send + Sync + 'static,
        terminal_sink: impl Fn(AgentTerminalOutput) + Send + Sync + 'static,
    ) -> Self {
        Self {
            profiles: Profiles::new(store, credentials),
            attachment_media: None,
            sessions: Mutex::new(BTreeMap::new()),
            dock_sink: Arc::new(dock_sink),
            terminal_sink: Arc::new(terminal_sink),
            shutting_down: std::sync::atomic::AtomicBool::new(false),
        }
    }
    pub fn with_attachment_media(mut self, media: Arc<dyn AttachmentMedia>) -> Self {
        self.attachment_media = Some(media);
        self
    }
    pub fn sessions(&self, project_id: &str) -> Vec<AgentSessionView> {
        self.sessions
            .lock()
            .expect("sessions lock")
            .values()
            .map(|s| s.view())
            .filter(|s| s.project_id == project_id)
            .collect()
    }
    pub(crate) fn get(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .lock()
            .map_err(|_| err("Sessions lock unavailable"))?
            .get(id)
            .cloned()
            .ok_or_else(|| err("Agent session not found"))
    }
    pub async fn start(
        &self,
        board: BoardContext,
        input: StartAgentSessionInput,
    ) -> Result<AgentSessionView> {
        if self.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(err("The agent runtime is shutting down"));
        }
        let mut profile = self.profiles.get(&input.profile_id)?;
        if let Some(model) = input.model {
            profile.model = Some(model);
        }
        if let Some(effort) = input.effort {
            profile.effort = Some(effort);
        }
        if profile.kind == RuntimeKind::Api
            && profile.model.as_deref().is_none_or(|s| s.trim().is_empty())
        {
            return Err(err("A model is required for API profiles"));
        }
        if !board.sidecar_path.is_file() {
            return Err(err(
                "Jam Board MCP sidecar not found; build or reinstall the app before starting an agent",
            ));
        }
        let (executable, args) = if profile.kind == RuntimeKind::Api {
            (std::path::PathBuf::new(), vec![])
        } else {
            profile.launch_command()?
        };
        let api_key = if profile.kind == RuntimeKind::Api {
            self.profiles.api_key(&profile.id)?
        } else {
            None
        };
        let catalog = if profile.kind == RuntimeKind::Api {
            Some(
                crate::catalog::load(
                    &self.profiles,
                    &board.data_dir,
                    AgentModelCatalogInput {
                        profile_id: profile.id.clone(),
                        refresh: Some(false),
                    },
                )
                .await?,
            )
        } else {
            None
        };
        let cwd = choose_cwd(&board, input.cwd.as_deref())?;
        let entries = mcp_entries(&board, &profile.agent_name, &profile.extra_mcp_servers)?;
        let mut env = self.profiles.child_env(&profile)?;
        env.extend(entries[0].env.clone());
        // A custom terminal wrapper has no universal CLI flags. Give it the
        // same non-secret stdio spec as ACP, without touching global config.
        env.push(Env {
            name: "JAM_BOARD_MCP_COMMAND".into(),
            value: entries[0].command.clone(),
        });
        env.push(Env {
            name: "JAM_BOARD_MCP_CONFIG".into(),
            value: serde_json::to_string(&entries)?,
        });
        let mut secrets = env
            .iter()
            .filter(|e| {
                crate::profiles::is_secret_name(&e.name)
                    || profile.secret_keys.iter().any(|k| k.key == e.name)
            })
            .map(|e| e.value.clone())
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>();
        if let Some(key) = api_key.as_ref().filter(|s| !s.is_empty()) {
            secrets.push(key.clone());
        }
        secrets.extend(
            std::env::vars()
                .filter(|(k, _)| crate::profiles::is_secret_name(k))
                .map(|(_, v)| v)
                .filter(|v| !v.is_empty()),
        );
        secrets.sort_by_key(|v| std::cmp::Reverse(v.len()));
        secrets.dedup();
        let session = Arc::new(Session {
            inner: Mutex::new(SessionInner {
                view: AgentSessionView {
                    id: ulid::Ulid::generate().to_string(),
                    profile_id: profile.id.clone(),
                    project_id: board.project_id.clone(),
                    kind: profile.kind,
                    title: profile.label.clone(),
                    status: SessionStatus::Starting,
                    cwd: cwd.to_string_lossy().into_owned(),
                    created_at: now(),
                    capabilities: Capabilities::default(),
                    model: profile.model.clone(),
                    effort: profile.effort.clone(),
                },
                events: VecDeque::new(),
                seq: 0,
                permissions: BTreeMap::new(),
                first_prompt: true,
                message_id: None,
                scrollback: String::new(),
                config: BTreeMap::new(),
                boolean_config: vec![],
                legacy_mode: false,
                cancelling: false,
                text_pending: String::new(),
                attachments: BTreeMap::new(),
            }),
            board,
            connector: Mutex::new(None),
            secrets,
            attachment_media: self.attachment_media.clone(),
            dock_sink: self.dock_sink.clone(),
            terminal_sink: self.terminal_sink.clone(),
            stop: tokio_util::sync::CancellationToken::new(),
            finished: tokio_util::sync::CancellationToken::new(),
        });
        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| err("Sessions lock unavailable"))?;
            if self.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(err("The agent runtime is shutting down"));
            }
            sessions.insert(session.view().id.clone(), session.clone());
        }
        session.emit(AgentEventKind::Status {
            status: SessionStatus::Starting,
            message: None,
        });
        let started = match profile.kind {
            RuntimeKind::Acp => {
                crate::acp::start(session.clone(), executable, args, env, entries).await
            }
            RuntimeKind::Terminal => {
                crate::terminal::start(
                    session.clone(),
                    executable,
                    profile.preset.as_deref(),
                    args,
                    env,
                    entries,
                )
                .await
            }
            RuntimeKind::Api => {
                crate::api::start(
                    session.clone(),
                    &profile,
                    api_key,
                    env,
                    entries,
                    catalog.expect("API catalog"),
                )
                .await
            }
        };
        if let Err(e) = started {
            let message = session.redact(&e.to_string());
            if session.stop.is_cancelled() {
                session.status(SessionStatus::Stopped, None);
            } else {
                session.fail("Cannot start agent session", Some(message.clone()));
            }
            session.finished.cancel();
            return Err(err(message));
        }
        Ok(session.view())
    }
    pub async fn model_catalog(
        &self,
        dir: &std::path::Path,
        input: AgentModelCatalogInput,
    ) -> Result<ModelCatalog> {
        crate::catalog::load(&self.profiles, dir, input).await
    }
    pub fn add_attachment(&self, input: AddAgentAttachmentInput) -> Result<AttachmentView> {
        crate::attachments::add(self.get(&input.session_id)?.as_ref(), input.source)
    }
    pub fn remove_attachment(&self, input: RemoveAgentAttachmentInput) -> Result<()> {
        crate::attachments::remove(self.get(&input.session_id)?.as_ref(), &input.attachment_id)
    }
    pub async fn delete_session(&self, id: &str) -> Result<()> {
        self.stop(id).await?;
        let session = self.get(id)?;
        crate::attachments::cleanup(&session)?;
        self.sessions
            .lock()
            .map_err(|_| err("Sessions lock unavailable"))?
            .remove(id);
        Ok(())
    }
    pub async fn prompt(&self, input: SendAgentPromptInput) -> Result<()> {
        self.get(&input.session_id)?
            .connector()?
            .prompt(input.content)
            .await
    }
    pub async fn cancel(&self, id: &str) -> Result<()> {
        let s = self.get(id)?;
        s.inner.lock().expect("session lock").cancelling = true;
        s.cancel_permissions();
        s.connector()?.cancel().await
    }
    pub fn resolve_permission(&self, input: ResolveAgentPermissionInput) -> Result<()> {
        self.get(&input.session_id)?
            .resolve(&input.request_id, input.option_id)
    }
    pub async fn set_config(&self, input: SetAgentConfigOptionInput) -> Result<()> {
        self.get(&input.session_id)?
            .connector()?
            .config(input.option_id, input.value)
            .await
    }
    pub async fn stop(&self, id: &str) -> Result<()> {
        let s = self.get(id)?;
        s.cancel_permissions();
        s.stop.cancel();
        s.finished.cancelled().await;
        Ok(())
    }
    pub async fn stop_all(&self) {
        self.shutting_down
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let sessions = self
            .sessions
            .lock()
            .expect("sessions lock")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for s in &sessions {
            s.cancel_permissions();
            s.stop.cancel();
        }
        for s in sessions {
            s.finished.cancelled().await;
        }
    }
    pub fn history(&self, id: &str) -> Result<Vec<AgentDockEvent>> {
        Ok(self
            .get(id)?
            .inner
            .lock()
            .map_err(|_| err("Session lock unavailable"))?
            .events
            .iter()
            .cloned()
            .collect())
    }
    pub fn terminal_write(&self, input: TerminalWriteInput) -> Result<()> {
        self.get(&input.session_id)?.connector()?.write(&input.data)
    }
    pub fn terminal_resize(&self, input: TerminalResizeInput) -> Result<()> {
        if input.cols == 0 || input.rows == 0 {
            return Err(err("Terminal dimensions must be positive"));
        }
        self.get(&input.session_id)?
            .connector()?
            .resize(input.cols, input.rows)
    }
    pub fn terminal_snapshot(&self, id: &str) -> Result<String> {
        let s = self.get(id)?;
        if s.view().kind != RuntimeKind::Terminal {
            return Err(err("This session has no terminal"));
        }
        Ok(s.inner.lock().expect("session lock").scrollback.clone())
    }
}

/// Kill Windows wrappers and descendants (npx.cmd -> node -> agent). Hidden:
/// stopping a dock must not flash another console window.
pub(crate) async fn kill_tree(pid: u32) -> Result<()> {
    #[cfg(windows)]
    {
        use std::time::Duration;

        let mut cmd = tokio::process::Command::new("taskkill.exe");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000);
        let result = tokio::time::timeout(Duration::from_secs(10), cmd.output())
            .await
            .map_err(|_| err("Timed out stopping agent process tree"))??;
        if !result.status.success() {
            tracing::debug!(
                pid,
                "Process tree already exited or taskkill could not find it"
            );
        }
    }
    #[cfg(unix)]
    {
        let _ = tokio::process::Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .output()
            .await?;
    }
    Ok(())
}

impl Drop for Session {
    fn drop(&mut self) {
        // History is memory-only; attachment originals have the same lifetime.
        let _ = crate::attachments::cleanup(self);
    }
}
#[cfg(test)]
mod phase3_lifecycle_tests {
    use super::*;
    #[tokio::test]
    async fn bc13_delete_session_cleans_copies_but_keeps_originals() {
        let media = Arc::new(crate::phase3_tests::PreviewMedia::default());
        let s = crate::tests::session_with_media(SessionStatus::Stopped, Some(media.clone()));
        let source = s.board.data_dir.join("original.txt");
        std::fs::write(&source, "fictional original").unwrap();
        let a = crate::attachments::add(
            &s,
            AttachmentSource::Path {
                path: source.to_string_lossy().into_owned(),
            },
        )
        .unwrap();
        let image = crate::attachments::add(
            &s,
            AttachmentSource::Bytes {
                name: "photo.png".into(),
                mime_type: "image/png".into(),
                data: "aW1hZ2U=".into(),
            },
        )
        .unwrap();
        let url = image.preview_url.clone().unwrap();
        assert!(media.read(&url).is_ok());
        let manager = SessionManager::new(
            Arc::new(jam_core::Store::open(s.board.data_dir.join("jam.db")).unwrap()),
            Arc::new(crate::tests::MemoryCredentials::default()),
            |_| {},
            |_| {},
        );
        manager
            .sessions
            .lock()
            .unwrap()
            .insert(s.view().id.clone(), s.clone());
        s.finished.cancel();
        manager.delete_session(&s.view().id).await.unwrap();
        assert!(source.is_file());
        assert!(!std::path::Path::new(&a.path).exists());
        assert!(manager.history(&s.view().id).is_err());
        assert!(media.read(&url).is_err());
    }
}
