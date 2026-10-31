use crate::*;
use futures::future::BoxFuture;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

pub(crate) type Reply = oneshot::Sender<Result<()>>;
pub(crate) enum Control {
    Prompt(Vec<PromptPart>, Reply),
    Retry(Reply),
    Cancel(Reply),
    Config(String, String, Reply),
}

/// Runtime boundary shared by ACP and PTY; an API connector can implement this
/// without adding a desktop dependency or changing the dock protocol.
pub trait Connector: Send + Sync {
    fn prompt(&self, content: Vec<PromptPart>) -> BoxFuture<'_, Result<()>>;
    fn retry(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(async { Err(err("This session cannot retry a chat turn")) })
    }
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
#[derive(Clone)]
pub(crate) struct LastPrompt {
    pub content: Vec<PromptPart>,
    pub preamble: Option<String>,
}
pub(crate) struct SessionInner {
    pub view: AgentSessionView,
    pub events: VecDeque<AgentDockEvent>,
    pub launch_log: VecDeque<AgentDockEvent>,
    pub launch_steps: BTreeMap<String, LaunchStep>,
    pub launch_meta: Option<serde_json::Value>,
    pub seq: u64,
    pub permissions: BTreeMap<String, PendingPermission>,
    pub first_prompt: bool,
    pub last_prompt: Option<LastPrompt>,
    pub last_turn_failed: bool,
    pub last_failure_code: Option<AgentErrorCode>,
    pub message_id: Option<(String, String)>,
    pub scrollback: String,
    pub config: BTreeMap<String, ConfigOption>,
    pub boolean_config: Vec<String>,
    pub legacy_mode: bool,
    pub cancelling: bool,
    pub text_pending: String,
    pub attachments: BTreeMap<String, (AttachmentView, bool)>,
    pub resume_events: Vec<AgentDockEvent>,
    pub resume_native_id: Option<String>,
    pub replaying: bool,
}
pub(crate) struct Session {
    pub inner: Mutex<SessionInner>,
    pub history_writer: Mutex<Option<crate::history::HistoryWriter>>,
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
// A deliberately narrow projection: no conversation text, credentials or unrelated
// rollout fields escape this reader. Never borrow usage from another session.
fn read_plan_usage(root: &std::path::Path, native: &str) -> Option<AgentEventKind> {
    use std::io::BufRead;
    if native.is_empty()
        || !native
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return None;
    }
    fn find(root: &std::path::Path, suffix: &str, depth: u8, found: &mut Vec<std::path::PathBuf>) {
        if depth == 0 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                find(&entry.path(), suffix, depth - 1, found);
            } else if kind.is_file()
                && entry.file_name().to_string_lossy().starts_with("rollout-")
                && entry.file_name().to_string_lossy().ends_with(suffix)
            {
                found.push(entry.path());
            }
        }
    }
    #[derive(serde::Deserialize)]
    struct Row {
        r#type: Option<String>,
        payload: Option<Payload>,
    }
    #[derive(serde::Deserialize)]
    struct Payload {
        r#type: Option<String>,
        rate_limits: Option<Limits>,
    }
    #[derive(serde::Deserialize)]
    struct Limits {
        primary: Option<PlanUsageWindow>,
        secondary: Option<PlanUsageWindow>,
    }
    let mut files = vec![];
    find(root, &format!("-{native}.jsonl"), 5, &mut files);
    let file = files
        .into_iter()
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())?;
    let mut latest = None;
    for line in std::io::BufReader::new(std::fs::File::open(file).ok()?)
        .lines()
        .map_while(std::result::Result::ok)
    {
        let Ok(row) = serde_json::from_str::<Row>(&line) else {
            continue;
        };
        if row.r#type.as_deref() != Some("event_msg") {
            continue;
        }
        if let Some(payload) = row.payload
            && payload.r#type.as_deref() == Some("token_count")
            && let Some(limits) = payload.rate_limits
        {
            let valid = |w: &PlanUsageWindow| {
                w.used_percent.is_finite() && (0.0..=100.0).contains(&w.used_percent)
            };
            let primary = limits.primary.filter(valid);
            let secondary = limits.secondary.filter(valid);
            latest = Some(AgentEventKind::PlanUsage { primary, secondary });
        }
    }
    latest
}
#[cfg(test)]
#[test]
fn r8c_rollout_limits_are_session_scoped_and_only_latest_valid_fields_are_returned() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-visuals/round8/r8c-chat-launch-status/fixtures")
        .join(ulid::Ulid::generate().to_string());
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("rollout-2026-other.jsonl"), r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":99,"resets_at":123}}}}"#).unwrap();
    assert!(read_plan_usage(&root, "wanted").is_none());
    std::fs::write(root.join("rollout-2026-wanted.jsonl"), concat!(
        "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"rate_limits\":{\"primary\":{\"used_percent\":20,\"resets_at\":123}}}}\n",
        "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"content\":\"ignored fixture\"}}\n",
        "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"rate_limits\":{\"primary\":{\"used_percent\":30,\"resets_at\":456},\"secondary\":{\"used_percent\":40,\"resets_at\":789}}}}\n",
        "{incomplete"
    )).unwrap();
    let wire = serde_json::to_value(read_plan_usage(&root, "wanted").unwrap()).unwrap();
    assert_eq!(wire["primary"]["used_percent"].as_f64(), Some(30.0));
    assert_eq!(wire["secondary"]["resets_at"], 789);
    assert!(read_plan_usage(&root, "../wanted").is_none());
    assert!(!wire.to_string().contains("ignored fixture"));
}
impl Session {
    pub fn launch_step(&self, step: &str, state: LaunchStepState, message: impl Into<String>) {
        let mut inner = self.inner.lock().expect("session lock");
        self.launch_step_locked(&mut inner, step, state, message.into());
    }
    fn launch_step_locked(
        &self,
        inner: &mut SessionInner,
        step: &str,
        state: LaunchStepState,
        message: String,
    ) {
        let started_at = inner
            .launch_steps
            .get(step)
            .filter(|s| state != LaunchStepState::Running || s.state == LaunchStepState::Running)
            .map(|s| s.started_at.clone())
            .unwrap_or_else(now);
        let launch = LaunchStep {
            step: step.into(),
            state,
            message: crate::wiring::launch_config::redact_diagnostic(&self.redact(&message))
                .chars()
                .take(4096)
                .collect(),
            started_at,
            ended_at: (state != LaunchStepState::Running).then(now),
        };
        if inner.launch_steps.len() >= 500
            && !inner.launch_steps.contains_key(step)
            && let Some(old) = inner
                .launch_steps
                .keys()
                .find(|key| key.starts_with("mcp:"))
                .cloned()
        {
            inner.launch_steps.remove(&old);
        }
        inner.launch_steps.insert(step.into(), launch.clone());
        self.push_locked(
            inner,
            AgentEventKind::LaunchStep {
                step: launch.step,
                state: launch.state,
                message: launch.message,
                started_at: launch.started_at,
                ended_at: launch.ended_at,
            },
        );
    }
    pub fn adapter_log(&self, message: &str) {
        let message = crate::wiring::launch_config::redact_diagnostic(&self.redact(message));
        let message: String = message.chars().take(4096).collect();
        self.emit(AgentEventKind::LaunchLog {
            message: message.clone(),
        });
        // Preserve the adapter's actual reason; forwarding a server in an ACP
        // request is not evidence that the server connected.
        let lower = message.to_ascii_lowercase();
        if let Some(at) = lower.find("mcp server ") {
            let rest = &message[at + 11..];
            let name = rest
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .trim_matches(['`', '\'', '"', ':']);
            if !name.is_empty() {
                let state = if lower.contains("not started")
                    || lower.contains("failed")
                    || lower.contains("cancelled")
                    || lower.contains("error")
                {
                    Some(LaunchStepState::Failed)
                } else if lower.contains("connected") || lower.contains("started successfully") {
                    Some(LaunchStepState::Ok)
                } else {
                    None
                };
                if let Some(state) = state {
                    self.launch_step(&format!("mcp:{name}"), state, message);
                }
            }
        }
    }
    fn end_launch(&self, state: LaunchStepState, message: &str) {
        let pending = self
            .inner
            .lock()
            .expect("session lock")
            .launch_steps
            .values()
            .filter(|s| s.state == LaunchStepState::Running)
            .map(|s| s.step.clone())
            .collect::<Vec<_>>();
        for step in pending {
            self.launch_step(&step, state, message);
        }
    }
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
        if let AgentEventKind::Status { status, message } = &event {
            if *status == SessionStatus::Starting
                && message
                    .as_deref()
                    .is_some_and(|s| s.starts_with("Terminal startup: spawned;"))
            {
                self.launch_step_locked(
                    inner,
                    "start_process",
                    LaunchStepState::Ok,
                    "Terminal process spawned".into(),
                );
            }
            if *status == SessionStatus::Ready && !inner.launch_steps.contains_key("ready") {
                if inner
                    .launch_steps
                    .get("start_process")
                    .is_some_and(|s| s.state == LaunchStepState::Running)
                {
                    self.launch_step_locked(
                        inner,
                        "start_process",
                        LaunchStepState::Ok,
                        "Runtime started".into(),
                    );
                }
                let pending = inner
                    .launch_steps
                    .values()
                    .filter(|s| s.state == LaunchStepState::Running)
                    .map(|s| s.step.clone())
                    .collect::<Vec<_>>();
                for step in pending {
                    self.launch_step_locked(
                        inner,
                        &step,
                        LaunchStepState::Skipped,
                        "Adapter does not report connection confirmation; see adapter logs".into(),
                    );
                }
                self.launch_step_locked(
                    inner,
                    "ready",
                    LaunchStepState::Ok,
                    "Session ready".into(),
                );
            }
        }
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
        if matches!(
            event.event,
            AgentEventKind::LaunchStep { .. } | AgentEventKind::LaunchLog { .. }
        ) {
            if inner.launch_log.len() == 500 {
                inner.launch_log.pop_front();
            }
            inner.launch_log.push_back(event.clone());
        }
        if inner.events.len() == 5_000 {
            inner.events.pop_front();
        }
        if !inner.replaying {
            let mut writer = self.history_writer.lock().expect("history writer lock");
            if let Some(active) = writer.as_mut()
                && let Err(e) = active.append(&event, &inner.view)
            {
                // Surface one failure and stop retrying writes for this session.
                *writer = None;
                let error = AgentDockEvent {
                    session_id: inner.view.id.clone(),
                    seq: inner.seq + 1,
                    at: now(),
                    event: AgentEventKind::Error {
                        code: None,
                        retryable: false,
                        retry_after_ms: None,
                        resets_at: None,
                        message: "Cannot save chat history".into(),
                        detail: Some(self.redact(&e.to_string())),
                    },
                };
                inner.seq += 1;
                inner.events.push_back(event.clone());
                inner.events.push_back(error.clone());
                (self.dock_sink)(event);
                (self.dock_sink)(error);
                return;
            }
        }
        if let Some(writer) = self
            .history_writer
            .lock()
            .expect("history writer lock")
            .as_ref()
        {
            inner.view.title = writer.record.entry.title.clone();
        }
        inner.events.push_back(event.clone());
        (self.dock_sink)(event);
    }
    pub fn emit(&self, event: AgentEventKind) {
        self.push_locked(&mut self.inner.lock().expect("session lock"), event);
    }
    pub fn status(&self, status: SessionStatus, message: Option<String>) {
        if status == SessionStatus::Stopped {
            self.end_launch(LaunchStepState::Skipped, "Session stopped during launch");
        }
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
        self.end_launch(LaunchStepState::Failed, message);
        self.status(SessionStatus::Failed, Some(message.into()));
        self.emit(AgentEventKind::Error {
            code: None,
            retryable: false,
            retry_after_ms: None,
            resets_at: None,
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
    store: Arc<jam_core::Store>,
    history_enabled: Arc<std::sync::atomic::AtomicBool>,
    history_lock: Arc<Mutex<()>>,
    resuming: Mutex<BTreeSet<String>>,
    attachment_media: Option<Arc<dyn AttachmentMedia>>,
    sessions: Mutex<BTreeMap<String, Arc<Session>>>,
    project_leases: Arc<Mutex<BTreeMap<String, (String, jam_core::ProjectLease)>>>,
    dock_sink: DockSink,
    terminal_sink: TerminalSink,
    shutting_down: std::sync::atomic::AtomicBool,
}
struct ResumeReservation<'a> {
    entries: &'a Mutex<BTreeSet<String>>,
    id: &'a str,
}
impl Drop for ResumeReservation<'_> {
    fn drop(&mut self) {
        self.entries.lock().expect("resume lock").remove(self.id);
    }
}
impl SessionManager {
    pub fn new(
        store: Arc<jam_core::Store>,
        credentials: Arc<dyn CredentialStore>,
        dock_sink: impl Fn(AgentDockEvent) + Send + Sync + 'static,
        terminal_sink: impl Fn(AgentTerminalOutput) + Send + Sync + 'static,
    ) -> Self {
        let keep = store
            .setting("agent_keep_history")
            .ok()
            .flatten()
            .as_deref()
            != Some("false");
        let manager = Self {
            profiles: Profiles::new(store.clone(), credentials),
            store,
            history_enabled: Arc::new(std::sync::atomic::AtomicBool::new(keep)),
            history_lock: Arc::new(Mutex::new(())),
            resuming: Mutex::new(BTreeSet::new()),
            attachment_media: None,
            sessions: Mutex::new(BTreeMap::new()),
            project_leases: Arc::new(Mutex::new(BTreeMap::new())),
            dock_sink: Arc::new(dock_sink),
            terminal_sink: Arc::new(terminal_sink),
            shutting_down: std::sync::atomic::AtomicBool::new(false),
        };
        if let Some(dir) = manager.store.path.parent() {
            crate::history::HistoryStore::recover_all(
                dir,
                manager.history_enabled.clone(),
                manager.history_lock.clone(),
            );
        }
        manager
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
        let binding = match self.store.for_project(&board.project_id) {
            Ok(store) => Some(crate::wiring::ProjectBinding::capture(&store)?),
            // Retain the low-level adapter API for callers supplying a standalone
            // context. Desktop launches always use start_for_store instead.
            Err(jam_core::Error::NotFound(_)) => None,
            Err(e) => return Err(e.into()),
        };
        self.start_saved(board, input, None, binding).await
    }
    /// Production launch boundary: capture a store, locator and owner lease before
    /// the first await. The manager's global store owns profiles, not selection.
    pub async fn start_for_store(
        &self,
        store: &jam_core::Store,
        data_dir: std::path::PathBuf,
        sidecar_path: std::path::PathBuf,
        input: StartAgentSessionInput,
    ) -> Result<AgentSessionView> {
        let pinned = store.selected_snapshot()?;
        let binding = crate::wiring::ProjectBinding::capture(&pinned)?;
        let board = BoardContext::from_store(&pinned, data_dir, sidecar_path)?;
        self.start_saved(board, input, None, Some(binding)).await
    }
    async fn start_saved(
        &self,
        mut board: BoardContext,
        input: StartAgentSessionInput,
        saved: Option<crate::history::StoredHistory>,
        binding: Option<(crate::wiring::ProjectBinding, jam_core::ProjectLease)>,
    ) -> Result<AgentSessionView> {
        if self.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(err("The agent runtime is shutting down"));
        }
        let cwd = match &binding {
            Some((context, _)) => context.cwd(&board, input.cwd.as_deref())?,
            None => choose_cwd(&board, input.cwd.as_deref())?,
        };
        let mut profile = match &saved {
            Some(record) => record.profile.clone(),
            None => self.profiles.get(&input.profile_id)?,
        };
        let user_config = self
            .profiles
            .user_config_choice(input.user_config, profile.kind)?;
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
        if profile.kind != RuntimeKind::Api && !board.sidecar_path.is_file() {
            return Err(err(
                "Jam Board MCP sidecar not found; build or reinstall the app before starting an agent",
            ));
        }
        let launch_resolution = if profile.kind == RuntimeKind::Api {
            Ok((std::path::PathBuf::new(), vec![]))
        } else {
            profile.launch_command()
        };
        let (executable, mut args) = launch_resolution.as_ref().ok().cloned().unwrap_or_default();
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
        let previous_server_name = board.server_name().to_string();
        let terminal_session_id =
            if profile.kind == RuntimeKind::Terminal && launch_resolution.is_ok() {
                if let Some(record) = &saved {
                    Some(record.terminal_resume_args(&mut args)?)
                } else {
                    crate::wiring::terminal_session_id(
                        profile.preset.as_deref(),
                        &executable.to_string_lossy(),
                        &mut args,
                    )?
                }
            } else {
                None
            };
        // API runtimes own their MCP connections and do not merge user config.
        // ACP/CLI adapters do, so each process gets a fresh collision-proof name.
        if profile.kind != RuntimeKind::Api && (saved.is_none() || board.mcp_server_name.is_none())
        {
            board.name_for_launch();
        }
        let mut entries = mcp_entries(&board, &profile.agent_name, &profile.extra_mcp_servers)?;
        if let Some((context, _)) = &binding {
            context.wire(&mut entries);
        }
        for entry in &mut entries {
            if let Some(key) = entry
                .http
                .as_ref()
                .and_then(|h| h.bearer_secret_key.as_ref())
            {
                entry.bearer_token = self.profiles.credentials.get(&profile.id, key)?;
            }
        }
        let mut env = self.profiles.child_env(&profile)?;
        let launch_meta = crate::wiring::launch_config::apply_user_config(
            &profile,
            user_config,
            &mut args,
            &mut env,
        )?;
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
        secrets.extend(entries.iter().filter_map(|e| e.bearer_token.clone()));
        secrets.extend(
            entries
                .iter()
                .flat_map(|e| e.env.iter())
                .filter(|e| crate::profiles::is_secret_name(&e.name))
                .map(|e| e.value.clone()),
        );
        secrets.extend(
            std::env::vars()
                .filter(|(k, _)| crate::profiles::is_secret_name(k))
                .map(|(_, v)| v)
                .filter(|v| !v.is_empty()),
        );
        // Adapter stderr may quote credential values as JSON. Redact the
        // escaped spelling too, before it can reach tracing or retained errors.
        let escaped = secrets
            .iter()
            .filter_map(|s| serde_json::to_string(s).ok())
            .map(|s| s[1..s.len() - 1].to_string())
            .collect::<Vec<_>>();
        secrets.extend(escaped);
        secrets.sort_by_key(|v| std::cmp::Reverse(v.len()));
        secrets.dedup();
        // Reject credentials copied into custom argv or downstream MCP argv,
        // including the ACP path. Diagnostics deliberately omit the value.
        let contains_secret =
            |value: &str| secrets.iter().any(|s| !s.is_empty() && value.contains(s));
        if contains_secret(&executable.to_string_lossy())
            || args.iter().any(|a| contains_secret(a))
            || entries.iter().any(|e| {
                contains_secret(&e.command)
                    || e.args.iter().any(|a| contains_secret(a))
                    || e.http.as_ref().is_some_and(|h| contains_secret(&h.url))
            })
        {
            return Err(err(
                "Credentials cannot be passed in process arguments; use environment variables",
            ));
        }
        if profile.kind == RuntimeKind::Terminal && launch_resolution.is_ok() {
            env.extend(crate::wiring::terminal_environment(
                profile.preset.as_deref(),
                &executable.to_string_lossy(),
                &entries,
            )?);
        }
        let launch_warnings = crate::wiring::launch_config::launch_warnings(
            &profile,
            &cwd,
            &env,
            board.server_name(),
        );
        let history_store = self.history_store(&board.data_dir, &board.project_id)?;
        let resume_events = if let Some(record) = &saved {
            if profile.kind == RuntimeKind::Terminal {
                vec![]
            } else {
                history_store.events_for_resume(&record.entry.id)?
            }
        } else {
            vec![]
        };
        let view = AgentSessionView {
            id: saved
                .as_ref()
                .filter(|_| profile.kind != RuntimeKind::Terminal)
                .map(|r| r.entry.id.clone())
                .unwrap_or_else(|| ulid::Ulid::generate().to_string()),
            profile_id: profile.id.clone(),
            project_id: board.project_id.clone(),
            kind: profile.kind,
            title: saved
                .as_ref()
                .map(|r| r.entry.title.clone())
                .unwrap_or_else(|| profile.label.clone()),
            status: SessionStatus::Starting,
            cwd: cwd.to_string_lossy().into_owned(),
            created_at: now(),
            capabilities: Capabilities::default(),
            model: profile.model.clone(),
            effort: profile.effort.clone(),
        };
        let mut record = saved
            .clone()
            .unwrap_or_else(|| crate::history::StoredHistory {
                entry: HistoryEntry {
                    id: view.id.clone(),
                    project_id: board.project_id.clone(),
                    profile_id: profile.id.clone(),
                    profile_label: profile.label.clone(),
                    provider: Default::default(),
                    empty: true,
                    kind: if profile.kind == RuntimeKind::Api {
                        HistoryKind::Api
                    } else {
                        HistoryKind::Acp
                    },
                    title: profile.label.clone(),
                    created_at: view.created_at.clone(),
                    updated_at: view.created_at.clone(),
                    model: profile.model.clone(),
                    effort: profile.effort.clone(),
                    agent_session_id: None,
                    resumable: if profile.kind == RuntimeKind::Api {
                        Resumable::Transcript
                    } else {
                        Resumable::None
                    },
                    message_count: 0,
                },
                board: board.clone(),
                cwd: view.cwd.clone(),
                profile: profile.clone(),
                renamed: false,
                has_user_message: false,
                last_agent_message_id: None,
                terminal: None,
            });
        record.board = board.clone();
        if profile.kind == RuntimeKind::Terminal {
            record.entry.id = view.id.clone();
            record.entry.created_at = view.created_at.clone();
            record.entry.updated_at = view.created_at.clone();
            if saved.is_none() {
                record.prepare_terminal(terminal_session_id.clone());
            }
        }
        let writer =
            history_store.create_bound(record, binding.as_ref().map(|(context, _)| context))?;
        let mut last_prompt = None;
        let mut last_turn_failed = false;
        let mut last_failure_code = None;
        for event in &resume_events {
            match &event.event {
                AgentEventKind::UserMessage {
                    content,
                    context_preamble,
                    ..
                } => {
                    last_prompt = Some(LastPrompt {
                        content: content.clone(),
                        preamble: context_preamble.as_ref().map(|text| {
                            text.replace(
                                &format!("Use the {previous_server_name} MCP server"),
                                &format!("Use the {} MCP server", board.server_name()),
                            )
                        }),
                    });
                    last_turn_failed = false;
                }
                AgentEventKind::Error {
                    code: Some(code), ..
                } => {
                    last_turn_failed = true;
                    last_failure_code = Some(*code);
                }
                AgentEventKind::TurnEnd { stop_reason } if stop_reason != "error" => {
                    last_turn_failed = false;
                }
                _ => {}
            }
        }
        let session = Arc::new(Session {
            history_writer: Mutex::new(writer),
            inner: Mutex::new(SessionInner {
                view,
                events: VecDeque::new(),
                launch_log: VecDeque::new(),
                launch_steps: BTreeMap::new(),
                launch_meta,
                seq: resume_events.last().map_or(0, |e| e.seq),
                permissions: BTreeMap::new(),
                first_prompt: saved.is_none(),
                last_prompt,
                last_turn_failed,
                last_failure_code,
                message_id: None,
                scrollback: String::new(),
                config: BTreeMap::new(),
                boolean_config: vec![],
                legacy_mode: false,
                cancelling: false,
                text_pending: String::new(),
                attachments: BTreeMap::new(),
                resume_events,
                resume_native_id: terminal_session_id.or_else(|| {
                    saved
                        .as_ref()
                        .and_then(|r| r.entry.agent_session_id.clone())
                }),
                replaying: saved.is_some() && profile.kind == RuntimeKind::Acp,
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
        if let Some((_, lease)) = binding {
            let id = session.view().id.clone();
            let lease_id = ulid::Ulid::generate().to_string();
            self.project_leases
                .lock()
                .expect("project leases lock")
                .insert(id.clone(), (lease_id.clone(), lease));
            let leases = self.project_leases.clone();
            let finished = session.finished.clone();
            tokio::spawn(async move {
                finished.cancelled().await;
                let mut leases = leases.lock().expect("project leases lock");
                if leases
                    .get(&id)
                    .is_some_and(|(current, _)| current == &lease_id)
                {
                    leases.remove(&id);
                }
            });
        }
        session.emit(AgentEventKind::Status {
            status: SessionStatus::Starting,
            message: None,
        });
        session.launch_step(
            "user_config",
            LaunchStepState::Ok,
            if user_config == UserConfigChoice::Include {
                "User global configuration included".into()
            } else {
                crate::wiring::launch_config::exclude_description(&profile).1
            },
        );
        if let Err(error) = launch_resolution {
            session.launch_step(
                "resolve_executable",
                LaunchStepState::Failed,
                error.to_string(),
            );
            session.fail("Cannot resolve agent executable", Some(error.to_string()));
            session.finished.cancel();
            self.project_leases
                .lock()
                .expect("project leases lock")
                .remove(&session.view().id);
            return Err(err(session.redact(&error.to_string())));
        }
        session.launch_step(
            "resolve_executable",
            if profile.kind == RuntimeKind::Api {
                LaunchStepState::Skipped
            } else {
                LaunchStepState::Ok
            },
            if profile.kind == RuntimeKind::Api {
                "API connection; no agent executable".into()
            } else {
                format!(
                    "Resolved {} (version not cached; no version probe was run)",
                    executable.display()
                )
            },
        );
        session.launch_step(
            "start_process",
            LaunchStepState::Running,
            if profile.kind == RuntimeKind::Api {
                "Initialize API connector"
            } else {
                "Start adapter/process"
            },
        );
        if profile.kind != RuntimeKind::Acp {
            session.launch_step(
                "initialize",
                LaunchStepState::Skipped,
                "ACP initialize does not apply to this runtime",
            );
            session.launch_step(
                "session",
                LaunchStepState::Skipped,
                "ACP session/new or session/load does not apply to this runtime",
            );
        }
        for entry in &entries {
            session.launch_step(
                &format!("mcp:{}", entry.name),
                if entry.enabled {
                    LaunchStepState::Running
                } else {
                    LaunchStepState::Skipped
                },
                if entry.enabled {
                    format!(
                        "MCP server {}: awaiting runtime connection result",
                        entry.name
                    )
                } else {
                    format!("MCP server {} is disabled", entry.name)
                },
            );
        }
        for warning in launch_warnings {
            // The existing status channel also retains startup diagnostics for
            // replay after a session picker remount.
            session.emit(AgentEventKind::Status {
                status: SessionStatus::Starting,
                message: Some(format!(
                    "Launch warning: {}",
                    serde_json::to_string(&warning)?
                )),
            });
        }
        let started = match profile.kind {
            RuntimeKind::Acp => {
                crate::acp::start(
                    session.clone(),
                    executable,
                    args,
                    env,
                    entries,
                    profile.label.clone(),
                )
                .await
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
            session.inner.lock().expect("session lock").replaying = false;
            let message = session.redact(&e.to_string());
            if session.stop.is_cancelled() {
                session.status(SessionStatus::Stopped, None);
            } else {
                session.fail("Cannot start agent session", Some(message.clone()));
            }
            session.finished.cancel();
            self.project_leases
                .lock()
                .expect("project leases lock")
                .remove(&session.view().id);
            return Err(err(message));
        }
        if saved.is_some() {
            session.inner.lock().expect("session lock").replaying = false;
            session.status(SessionStatus::Ready, Some(format!("Resumed {}", now())));
        }
        Ok(session.view())
    }
    pub fn history_settings(&self) -> HistorySettings {
        HistorySettings {
            keep_history: self
                .history_enabled
                .load(std::sync::atomic::Ordering::SeqCst),
        }
    }
    pub fn launch_logs(&self, id: &str) -> Result<Vec<AgentDockEvent>> {
        let session = self.get(id)?;
        let (mut logs, native, profile_id) = {
            let inner = session
                .inner
                .lock()
                .map_err(|_| err("Session lock unavailable"))?;
            (
                inner.launch_log.iter().cloned().collect::<Vec<_>>(),
                inner.resume_native_id.clone(),
                inner.view.profile_id.clone(),
            )
        };
        if let Ok(profile) = self.profiles.get(&profile_id)
            && (profile
                .preset
                .as_deref()
                .is_some_and(|p| matches!(p, "codex" | "codex-cli"))
                || profile.command.contains("codex-acp")
                || profile.args.iter().any(|arg| arg.contains("codex-acp")))
            && let Some(native) = native
        {
            let home = profile
                .env
                .iter()
                .find(|e| e.name == "CODEX_HOME")
                .map(|e| std::path::PathBuf::from(&e.value))
                .or_else(|| std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from))
                .or_else(|| {
                    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                        .map(|p| std::path::PathBuf::from(p).join(".codex"))
                });
            if let Some(home) = home
                && let Some(event) = read_plan_usage(&home.join("sessions"), &native)
            {
                logs.push(AgentDockEvent {
                    session_id: id.into(),
                    seq: 0,
                    at: now(),
                    event,
                });
            }
        }
        Ok(logs)
    }
    /// CLI identity is runtime metadata, separate from Jam Board's session ID.
    pub fn agent_session_id(&self, id: &str) -> Result<Option<String>> {
        let session = self.get(id)?;
        let inner = session
            .inner
            .lock()
            .map_err(|_| err("Session lock unavailable"))?;
        Ok((inner.view.kind == RuntimeKind::Terminal)
            .then(|| inner.resume_native_id.clone())
            .flatten())
    }
    pub fn save_history_settings(&self, settings: HistorySettings) -> Result<HistorySettings> {
        let _guard = self
            .history_lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        self.store.set_setting(
            "agent_keep_history",
            if settings.keep_history {
                "true"
            } else {
                "false"
            },
        )?;
        self.history_enabled
            .store(settings.keep_history, std::sync::atomic::Ordering::SeqCst);
        Ok(settings)
    }
    pub(crate) fn history_store(
        &self,
        dir: &std::path::Path,
        project_id: &str,
    ) -> Result<crate::history::HistoryStore> {
        crate::history::HistoryStore::new(
            dir,
            project_id,
            self.history_enabled.clone(),
            self.history_lock.clone(),
        )
    }
    pub fn agent_history(
        &self,
        dir: &std::path::Path,
        project_id: &str,
        limit: Option<u32>,
        query: Option<&str>,
    ) -> Result<Vec<HistoryEntry>> {
        self.history_store(dir, project_id)?.list(limit, query)
    }
    pub fn history_events(
        &self,
        dir: &std::path::Path,
        project_id: &str,
        entry_id: &str,
    ) -> Result<Vec<AgentDockEvent>> {
        self.history_store(dir, project_id)?.events(entry_id)
    }
    pub fn rename_history(
        &self,
        dir: &std::path::Path,
        project_id: &str,
        entry_id: &str,
        title: &str,
    ) -> Result<()> {
        self.history_store(dir, project_id)?.rename(entry_id, title)
    }
    pub fn delete_history(
        &self,
        dir: &std::path::Path,
        project_id: &str,
        entry_id: &str,
    ) -> Result<()> {
        self.history_store(dir, project_id)?.delete(entry_id)
    }
    pub fn clear_history(&self, dir: &std::path::Path, project_id: &str) -> Result<()> {
        self.history_store(dir, project_id)?.clear()
    }
    pub async fn resume(
        &self,
        dir: &std::path::Path,
        project_id: &str,
        entry_id: &str,
    ) -> Result<AgentSessionView> {
        self.resume_with_user_config(dir, project_id, entry_id, None)
            .await
    }
    pub async fn resume_with_user_config(
        &self,
        dir: &std::path::Path,
        project_id: &str,
        entry_id: &str,
        user_config: Option<UserConfigChoice>,
    ) -> Result<AgentSessionView> {
        {
            let mut entries = self
                .resuming
                .lock()
                .map_err(|_| err("Resume lock unavailable"))?;
            if !entries.insert(entry_id.into()) {
                return Err(err("This session is already resuming"));
            }
        }
        let _reservation = ResumeReservation {
            entries: &self.resuming,
            id: entry_id,
        };
        let mut record = self.history_store(dir, project_id)?.load(entry_id)?;
        if record.entry.project_id != project_id || record.board.project_id != project_id {
            return Err(err("History belongs to another project"));
        }
        if record.entry.kind == HistoryKind::Terminal {
            record.refresh_terminal()?;
            record.terminal_resume_args(&mut vec![])?;
            if self.sessions(&record.entry.project_id).iter().any(|view| {
                view.kind == RuntimeKind::Terminal
                    && view.profile_id == record.entry.profile_id
                    && !matches!(view.status, SessionStatus::Stopped | SessionStatus::Failed)
                    && self.agent_session_id(&view.id).ok().flatten()
                        == record.entry.agent_session_id
            }) {
                return Err(err("This terminal session is already open"));
            }
        }
        if record.entry.resumable == Resumable::None {
            return Err(err(
                "This agent supports only a read-only transcript; continue in a new session",
            ));
        }
        if let Ok(session) = self.get(entry_id)
            && !matches!(
                session.view().status,
                SessionStatus::Stopped | SessionStatus::Failed
            )
        {
            return Err(err("This session is already open"));
        }
        let input = StartAgentSessionInput {
            profile_id: record.profile.id.clone(),
            user_config,
            cwd: Some(record.cwd.clone()),
            model: record.entry.model.clone(),
            effort: record.entry.effort.clone(),
        };
        let binding = self
            .history_store(dir, project_id)?
            .load_binding(entry_id)?;
        let binding = if let Some(binding) = binding {
            if binding.project_id != project_id {
                return Err(err("History binding belongs to another project"));
            }
            Some(binding.reconnect()?)
        } else {
            // Pre-folder histories stay readable, but must never follow a moved
            // legacy project to its new folder implicitly.
            if self.store.moved_project_folder(project_id)?.is_some() {
                return Err(err(
                    "This project moved; reconnect to its folder before resuming",
                ));
            }
            match self.store.for_project(project_id) {
                Ok(store) => Some(crate::wiring::ProjectBinding::capture(&store)?),
                Err(jam_core::Error::NotFound(_)) => None,
                Err(e) => return Err(e.into()),
            }
        };
        self.start_saved(record.board.clone(), input, Some(record), binding)
            .await
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
    pub async fn retry(&self, id: &str) -> Result<()> {
        self.get(id)?.connector()?.retry().await
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
        self.project_leases
            .lock()
            .expect("project leases lock")
            .remove(id);
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
        self.project_leases
            .lock()
            .expect("project leases lock")
            .clear();
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
        // Attachment copies have the process session lifetime; the text transcript is persistent.
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
