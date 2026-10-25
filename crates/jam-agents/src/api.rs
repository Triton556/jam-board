//! OpenAI-compatible streaming chat. Credentials stay in the Authorization
//! header; the MCP sidecar receives only non-secret, project-pinned settings.
use crate::{
    session::{Reply, Session},
    *,
};
use futures::{StreamExt, future::BoxFuture};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tracing::instrument::WithSubscriber;

#[derive(Clone)]
pub struct ApiTool {
    pub name: String,
    pub description: String,
    pub schema: Value,
    pub read_only: bool,
}
/// The real MCP client and offline fixtures share exactly this boundary.
pub trait ToolSource: Send + Sync {
    fn list(&self) -> BoxFuture<'_, Result<Vec<ApiTool>>>;
    fn guide(&self) -> BoxFuture<'_, Result<String>>;
    fn call(&self, name: String, arguments: Value) -> BoxFuture<'_, Result<Value>>;
    fn shutdown(&self) -> BoxFuture<'_, ()>;
}
struct McpTools {
    service: tokio::sync::Mutex<Option<rmcp::service::RunningService<rmcp::RoleClient, ()>>>,
    tree: crate::process::ProcessTree,
}
impl McpTools {
    async fn connect(
        session: &Session,
        entry: &McpEntry,
        env: &[Env],
    ) -> Result<Arc<dyn ToolSource>> {
        use rmcp::ServiceExt;
        let mut command = tokio::process::Command::new(&entry.command);
        command
            .args(&entry.args)
            .current_dir(&session.view().cwd)
            .envs(env.iter().map(|e| (&e.name, &e.value)))
            .envs(entry.env.iter().map(|e| (&e.name, &e.value)))
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        #[cfg(unix)]
        command.process_group(0);
        let transport = rmcp::transport::TokioChildProcess::builder(command)
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| err("Cannot start the Jam Board MCP sidecar"))?
            .0;
        let pid = transport
            .id()
            .ok_or_else(|| err("MCP sidecar has no process ID"))?;
        let tree = crate::process::ProcessTree::attach(pid)?;
        let service = tokio::select! {
            _ = session.stop.cancelled() => return Err(err("Session stopped during MCP startup")),
            result = tokio::time::timeout(Duration::from_secs(30), ().serve(transport)) => result.map_err(|_| err("Jam Board MCP sidecar initialization timed out"))?.map_err(|_| err("Cannot initialize the Jam Board MCP sidecar"))?,
        };
        Ok(Arc::new(Self {
            service: tokio::sync::Mutex::new(Some(service)),
            tree,
        }))
    }
}
impl ToolSource for McpTools {
    fn list(&self) -> BoxFuture<'_, Result<Vec<ApiTool>>> {
        Box::pin(async {
            let service = self.service.lock().await;
            let service = service
                .as_ref()
                .ok_or_else(|| err("MCP sidecar has stopped"))?;
            let tools = service
                .list_all_tools()
                .await
                .map_err(|_| err("Cannot list Jam Board MCP tools"))?;
            Ok(tools
                .into_iter()
                .map(|t| ApiTool {
                    name: t.name.into_owned(),
                    description: t.description.map(|v| v.into_owned()).unwrap_or_default(),
                    schema: Value::Object((*t.input_schema).clone()),
                    read_only: t.annotations.as_ref().and_then(|a| a.read_only_hint) == Some(true),
                })
                .collect())
        })
    }
    fn guide(&self) -> BoxFuture<'_, Result<String>> {
        Box::pin(async {
            let service = self.service.lock().await;
            let result = service
                .as_ref()
                .ok_or_else(|| err("MCP sidecar has stopped"))?
                .read_resource(rmcp::model::ReadResourceRequestParams::new("jam://guide"))
                .await
                .map_err(|_| err("Cannot read jam://guide"))?;
            let value = serde_json::to_value(result)?;
            Ok(value["contents"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n"))
        })
    }
    fn call(&self, name: String, arguments: Value) -> BoxFuture<'_, Result<Value>> {
        Box::pin(async move {
            let service = self.service.lock().await;
            let request = rmcp::model::CallToolRequestParams::new(name).with_arguments(
                arguments
                    .as_object()
                    .cloned()
                    .ok_or_else(|| err("Tool arguments must be a JSON object"))?,
            );
            let result = service
                .as_ref()
                .ok_or_else(|| err("MCP sidecar has stopped"))?
                .call_tool(request)
                .await
                .map_err(|_| {
                    err("Jam Board MCP tool call failed; inspect the board before retrying")
                })?;
            Ok(serde_json::to_value(result)?)
        })
    }
    fn shutdown(&self) -> BoxFuture<'_, ()> {
        Box::pin(async {
            if let Some(service) = self.service.lock().await.take() {
                let _ = tokio::time::timeout(Duration::from_secs(5), service.cancel()).await;
            }
            let _ = self.tree.terminate();
        })
    }
}

pub(crate) struct ApiConfig {
    pub base_url: String,
    pub model: String,
    pub key: String,
    pub effort_style: EffortStyle,
    pub catalog: ModelCatalog,
}
impl ApiConfig {
    fn endpoint(&self) -> Result<reqwest::Url> {
        if self.model.trim().is_empty() {
            return Err(err("A model is required for API profiles"));
        }
        let endpoint = reqwest::Url::parse(&format!(
            "{}/chat/completions",
            self.base_url.trim_end_matches('/')
        ))
        .map_err(|_| err("Enter a valid OpenAI-compatible API base URL"))?;
        if !["http", "https"].contains(&endpoint.scheme())
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(err(
                "API base URL must use HTTP(S) without credentials, a query or a fragment",
            ));
        }
        Ok(endpoint)
    }
}
struct Prompt {
    content: Vec<Value>,
    cancel: CancellationToken,
    reply: Reply,
    model: String,
    effort: Option<String>,
}
struct ApiConnector {
    session: std::sync::Weak<Session>,
    tx: mpsc::UnboundedSender<Prompt>,
    current: Arc<Mutex<Option<CancellationToken>>>,
    effort_style: EffortStyle,
    catalog: ModelCatalog,
}
impl Connector for ApiConnector {
    fn prompt(&self, content: Vec<PromptPart>) -> BoxFuture<'_, Result<()>> {
        Box::pin(async move {
            let session = self
                .session
                .upgrade()
                .ok_or_else(|| err("API session is disconnected"))?;
            let (blocks, selection) = crate::acp::prepare_prompt_with_selection(&session, content)?;
            let content = blocks
                .into_iter()
                .map(|block| {
                    let value = serde_json::to_value(block)?;
                    Ok::<_, serde_json::Error>(if value["type"] == "image" {
                        let mime = value["mimeType"].as_str().unwrap_or_default();
                        let data = value["data"].as_str().unwrap_or_default();
                        json!({"type":"image_url","image_url":{"url":format!("data:{mime};base64,{data}")}})
                    } else {
                        value
                    })
                })
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let cancel = CancellationToken::new();
            *self.current.lock().expect("turn lock") = Some(cancel.clone());
            if session.inner.lock().expect("session lock").cancelling {
                cancel.cancel();
            }
            let (reply, rx) = oneshot::channel();
            self.tx
                .send(Prompt {
                    content,
                    model: selection.model.unwrap_or_default(),
                    effort: selection.effort,
                    cancel,
                    reply,
                })
                .map_err(|_| err("API session is disconnected"))?;
            rx.await.map_err(|_| err("API session is disconnected"))?
        })
    }
    fn cancel(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(async {
            if let Some(cancel) = self.current.lock().expect("turn lock").as_ref() {
                cancel.cancel();
            }
            if let Some(session) = self.session.upgrade() {
                session.cancel_permissions();
            }
            Ok(())
        })
    }
    fn config(&self, option: String, value: String) -> BoxFuture<'_, Result<()>> {
        Box::pin(async move {
            let session = self
                .session
                .upgrade()
                .ok_or_else(|| err("API session is disconnected"))?;
            let mut inner = session.inner.lock().expect("session lock");
            if session.stop.is_cancelled()
                || matches!(
                    inner.view.status,
                    SessionStatus::Stopped | SessionStatus::Failed
                )
            {
                return Err(err("API session is disconnected"));
            }
            match option.as_str() {
                "model" if !value.trim().is_empty() => {
                    if session.redact(&value) == value {
                        crate::catalog::remember(
                            &session.board.data_dir,
                            &inner.view.profile_id,
                            &value,
                        )?;
                    }
                    inner.view.model = Some(value);
                }
                "thought_level"
                    if inner
                        .config
                        .get("thought_level")
                        .is_some_and(|o| o.values.iter().any(|v| v.value == value)) =>
                {
                    inner.view.effort = (value != "auto").then_some(value);
                }
                _ => return Err(err("Unknown agent configuration option or value")),
            }
            drop(inner);
            emit_options(&session, &self.catalog, self.effort_style);
            Ok(())
        })
    }
    fn stop(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(async {
            if let Some(session) = self.session.upgrade() {
                session.stop.cancel();
                session.finished.cancelled().await;
            }
            Ok(())
        })
    }
}

pub(crate) async fn start(
    session: Arc<Session>,
    profile: &crate::profiles::Profile,
    key: Option<String>,
    env: Vec<Env>,
    entries: Vec<McpEntry>,
    catalog: ModelCatalog,
) -> Result<()> {
    let key = key.filter(|s| !s.is_empty()).ok_or_else(|| {
        session.emit(AgentEventKind::Auth {
            state: AuthState::Required,
            label: "Set API_KEY in the connection profile".into(),
        });
        err("API_KEY is not set for this profile")
    })?;
    let config = ApiConfig {
        base_url: profile.base_url.clone().unwrap_or_default(),
        model: profile.model.clone().unwrap_or_default(),
        key,
        effort_style: profile.effort_style,
        catalog,
    };
    config.endpoint()?;
    let source = McpTools::connect(&session, &entries[0], &env)
        .with_subscriber(tracing::subscriber::NoSubscriber::default())
        .await?;
    start_with_source(session, config, source).await
}
pub(crate) async fn start_with_source(
    session: Arc<Session>,
    config: ApiConfig,
    source: Arc<dyn ToolSource>,
) -> Result<()> {
    let endpoint = config.endpoint()?;
    let setup = async {
        let tools = source.list().await?;
        let guide = tokio::time::timeout(Duration::from_secs(5), source.guide())
            .await
            .ok()
            .and_then(std::result::Result::ok)
            .unwrap_or_default();
        Ok::<_, AgentError>((tools, bounded(&guide, 64 * 1024)))
    };
    let setup = tokio::select! { _ = session.stop.cancelled() => Err(err("Session stopped during API startup")), result = tokio::time::timeout(Duration::from_secs(30), setup) => result.map_err(|_| err("API tool initialization timed out")).and_then(|v| v) };
    let (tools, guide) = match setup {
        Ok(v) => v,
        Err(e) => {
            source.shutdown().await;
            return Err(e);
        }
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| err("Cannot initialize the API HTTP client"))?;
    let system = format!(
        "You are the person's brain agent in Jam Board. Help clarify intent and coordinate the board. Tool permission is not board Start approval. Preserve human drafts and captured revisions.\n\n{}\n\n{}",
        session.board.preamble(),
        guide
    );
    let (tx, mut rx) = mpsc::unbounded_channel::<Prompt>();
    let current = Arc::new(Mutex::new(None));
    *session.connector.lock().expect("connector lock") = Some(Arc::new(ApiConnector {
        session: Arc::downgrade(&session),
        tx,
        current: current.clone(),
        effort_style: config.effort_style,
        catalog: config.catalog.clone(),
    }));
    {
        let mut inner = session.inner.lock().expect("session lock");
        inner.view.kind = RuntimeKind::Api;
        inner.view.model = Some(config.model.clone());
    }
    if session.redact(&config.model) == config.model {
        let _ = crate::catalog::remember(
            &session.board.data_dir,
            &session.view().profile_id,
            &config.model,
        );
    }
    emit_options(&session, &config.catalog, config.effort_style);
    session.status(SessionStatus::Ready, None);
    tokio::spawn(async move {
        let mut history = vec![json!({"role":"system","content":system})];
        let mut allowed = BTreeSet::new();
        loop {
            let prompt = tokio::select! { biased; _ = session.stop.cancelled() => break, prompt = rx.recv() => match prompt { Some(p) => p, None => break } };
            history.push(json!({"role":"user","content":prompt.content}));
            let _ = prompt.reply.send(Ok(()));
            let turn_config = ApiConfig {
                model: prompt.model,
                key: config.key.clone(),
                base_url: config.base_url.clone(),
                effort_style: config.effort_style,
                catalog: config.catalog.clone(),
            };
            let effort = prompt.effort;
            let mut progress = BTreeSet::new();
            let result = tokio::select! {
                biased;
                _ = session.stop.cancelled() => Ok("cancelled"),
                _ = prompt.cancel.cancelled() => Ok("cancelled"),
                result = run_turn(&session, &client, &endpoint, &turn_config, effort.as_deref(), &tools, source.as_ref(), &mut history, &mut allowed, &mut progress).with_subscriber(tracing::subscriber::NoSubscriber::default()) => result,
            };
            session.flush_text();
            session.cancel_permissions();
            let stop_reason = match result {
                Ok(reason) => reason,
                Err(e) => {
                    session.emit(AgentEventKind::Error {
                        message: session.redact(&e.to_string()),
                        detail: None,
                    });
                    "end_turn"
                }
            };
            for id in progress {
                session.emit(AgentEventKind::ToolCallUpdate { tool_call_id: id, title: None, status: Some("cancelled".into()), content: Some("Cancelled. An already dispatched board operation may have completed; inspect the board before retrying.".into()), output: None });
            }
            settle_pending_tools(&mut history);
            *current.lock().expect("turn lock") = None;
            session.emit(AgentEventKind::TurnEnd {
                stop_reason: stop_reason.into(),
            });
            session.status(SessionStatus::Ready, None);
        }
        source.shutdown().await;
        session.cancel_permissions();
        session.status(SessionStatus::Stopped, None);
        session.finished.cancel();
    });
    Ok(())
}

#[derive(Default)]
pub(crate) struct SseDecoder {
    buffer: Vec<u8>,
    data: Vec<u8>,
}
pub(crate) enum SseEvent {
    Data(Value),
    Done,
}
impl SseDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<SseEvent>> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(end) = self.buffer.iter().position(|b| *b == b'\n') {
            let mut line = self.buffer.drain(..=end).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                if let Some(event) = self.event()? {
                    events.push(event);
                }
            } else if let Some(data) = line.strip_prefix(b"data:") {
                let data = data.strip_prefix(b" ").unwrap_or(data);
                if !self.data.is_empty() {
                    self.data.push(b'\n');
                }
                self.data.extend_from_slice(data);
            }
            if self.data.len() > 1024 * 1024 {
                return Err(err("Provider SSE event exceeds 1 MiB"));
            }
        }
        if self.buffer.len() > 1024 * 1024 {
            return Err(err("Provider SSE line exceeds 1 MiB"));
        }
        Ok(events)
    }
    fn event(&mut self) -> Result<Option<SseEvent>> {
        let data = std::mem::take(&mut self.data);
        if data.is_empty() {
            return Ok(None);
        }
        if data == b"[DONE]" {
            return Ok(Some(SseEvent::Done));
        }
        Ok(Some(SseEvent::Data(
            serde_json::from_slice(&data).map_err(|_| err("Provider sent invalid SSE JSON"))?,
        )))
    }
    fn finish(&mut self) -> Result<Vec<SseEvent>> {
        let mut events = self.push(b"\n\n")?;
        if let Some(event) = self.event()? {
            events.push(event);
        }
        Ok(events)
    }
}
#[derive(Default)]
pub(crate) struct ToolDelta {
    pub id: String,
    pub name: String,
    pub arguments: String,
}
#[derive(Default)]
pub(crate) struct Completion {
    pub text: String,
    pub calls: BTreeMap<u64, ToolDelta>,
    pub finish: Option<String>,
    done: bool,
}
impl Completion {
    pub(crate) fn apply(&mut self, event: SseEvent) -> Result<String> {
        let SseEvent::Data(v) = event else {
            self.done = true;
            return Ok(String::new());
        };
        if let Some(error) = v.get("error") {
            return Err(err(provider_message(error)));
        }
        let Some(choice) = v["choices"].as_array().and_then(|a| a.first()) else {
            return Ok(String::new());
        };
        let delta = &choice["delta"];
        let text = delta["content"].as_str().unwrap_or_default();
        self.text.push_str(text);
        for call in delta["tool_calls"].as_array().into_iter().flatten() {
            let index = call["index"]
                .as_u64()
                .ok_or_else(|| err("Provider tool-call delta has no index"))?;
            if self.calls.len() >= 128 && !self.calls.contains_key(&index) {
                return Err(err("Provider requested too many tools in one response"));
            }
            let entry = self.calls.entry(index).or_default();
            if let Some(s) = call["id"].as_str() {
                entry.id.push_str(s);
            }
            if let Some(s) = call["function"]["name"].as_str() {
                entry.name.push_str(s);
            }
            if let Some(s) = call["function"]["arguments"].as_str() {
                entry.arguments.push_str(s);
            }
            if entry.arguments.len() > 1024 * 1024 {
                return Err(err("Provider tool arguments exceed 1 MiB"));
            }
        }
        if let Some(reason) = choice["finish_reason"].as_str() {
            self.finish = Some(reason.into());
        }
        Ok(text.into())
    }
}
#[allow(clippy::too_many_arguments)]
async fn run_turn(
    session: &Session,
    client: &reqwest::Client,
    endpoint: &reqwest::Url,
    config: &ApiConfig,
    effort: Option<&str>,
    tools: &[ApiTool],
    source: &dyn ToolSource,
    history: &mut Vec<Value>,
    allowed: &mut BTreeSet<String>,
    progress: &mut BTreeSet<String>,
) -> Result<&'static str> {
    let functions = tools.iter().map(|t| json!({"type":"function","function":{"name":t.name,"description":t.description,"parameters":t.schema}})).collect::<Vec<_>>();
    for _ in 0..32 {
        let mut body =
            json!({"model":config.model,"messages":history,"stream":true,"tools":functions});
        apply_effort(
            &mut body,
            config.effort_style,
            effort,
            config
                .catalog
                .models
                .iter()
                .any(|m| m.id == config.model && m.reasoning),
        );
        let response = client
            .post(endpoint.clone())
            .bearer_auth(&config.key)
            .json(&body)
            .send()
            .await
            .map_err(|_| err("Cannot reach the API provider"))?;
        let status = response.status();
        if !status.is_success() {
            let mut body = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| err("Cannot read provider error response"))?;
                let remaining = (64 * 1024usize).saturating_sub(body.len());
                body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if body.len() == 64 * 1024 {
                    break;
                }
            }
            let message = serde_json::from_slice::<Value>(&body)
                .ok()
                .map(|v| provider_message(v.get("error").unwrap_or(&v)))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| bounded(&String::from_utf8_lossy(&body), 2000));
            if status.as_u16() == 401 || status.as_u16() == 403 {
                session.emit(AgentEventKind::Auth {
                    state: AuthState::Required,
                    label: format!("HTTP {}: {}", status.as_u16(), message),
                });
            }
            return Err(err(format!(
                "API provider returned HTTP {}: {}",
                status.as_u16(),
                message
            )));
        }
        session.emit(AgentEventKind::Auth {
            state: AuthState::Ok,
            label: "API connection authenticated".into(),
        });
        let message_id = ulid::Ulid::generate().to_string();
        let mut decoder = SseDecoder::default();
        let mut completion = Completion::default();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| {
                err("Provider stream disconnected; no automatic retry was attempted")
            })?;
            for event in decoder.push(&chunk)? {
                let text = completion.apply(event)?;
                session.stream_text(&message_id, &text);
            }
            if completion.done {
                break;
            }
        }
        if !completion.done {
            for event in decoder.finish()? {
                let text = completion.apply(event)?;
                session.stream_text(&message_id, &text);
            }
        }
        session.flush_text();
        if !completion.done && completion.finish.is_none() {
            return Err(err("Provider stream ended before completing the response"));
        }
        if completion.finish.as_deref() == Some("length") {
            history.push(json!({"role":"assistant","content":completion.text}));
            return Ok("max_tokens");
        }
        if completion.calls.is_empty() {
            history.push(json!({"role":"assistant","content":completion.text}));
            return Ok("end_turn");
        }
        let mut calls = completion.calls.into_values().collect::<Vec<_>>();
        for call in &mut calls {
            if call.id.is_empty() {
                call.id = ulid::Ulid::generate().to_string();
            }
        }
        history.push(json!({"role":"assistant","content":completion.text,"tool_calls":calls.iter().map(|c|json!({"id":c.id,"type":"function","function":{"name":c.name,"arguments":c.arguments}})).collect::<Vec<_>>()}));
        for call in calls {
            let parsed = serde_json::from_str::<Value>(&call.arguments)
                .ok()
                .filter(Value::is_object);
            let title = friendly_title(&call.name, parsed.as_ref());
            progress.insert(call.id.clone());
            session.emit(AgentEventKind::ToolCall {
                tool_call_id: call.id.clone(),
                title: title.clone(),
                tool_kind: "other".into(),
                status: "pending".into(),
                input: parsed.clone(),
                content: None,
                locations: None,
            });
            let tool = tools.iter().find(|t| t.name == call.name);
            let result = if let (Some(tool), Some(arguments)) = (tool, parsed) {
                let permit = if tool.read_only || allowed.contains(&tool.name) {
                    true
                } else {
                    let choice = session
                        .permission(
                            Some(call.id.clone()),
                            title,
                            vec![
                                PermissionOption {
                                    option_id: "allow_once".into(),
                                    name: "Allow once".into(),
                                    kind: PermissionKind::AllowOnce,
                                },
                                PermissionOption {
                                    option_id: "allow_always".into(),
                                    name: "Always allow this tool for this session".into(),
                                    kind: PermissionKind::AllowAlways,
                                },
                                PermissionOption {
                                    option_id: "reject".into(),
                                    name: "Reject".into(),
                                    kind: PermissionKind::RejectOnce,
                                },
                            ],
                        )
                        .await
                        .unwrap_or(None);
                    match choice.as_deref() {
                        Some("allow_once") => true,
                        Some("allow_always") => {
                            allowed.insert(tool.name.clone());
                            true
                        }
                        _ => false,
                    }
                };
                if permit {
                    session.emit(AgentEventKind::ToolCallUpdate {
                        tool_call_id: call.id.clone(),
                        title: None,
                        status: Some("in_progress".into()),
                        content: None,
                        output: None,
                    });
                    match source.call(tool.name.clone(), arguments).await {
                        Ok(v) => v,
                        Err(e) => {
                            json!({"isError":true,"content":[{"type":"text","text":e.to_string()}]})
                        }
                    }
                } else {
                    json!({"isError":true,"content":[{"type":"text","text":"The person declined this tool call."}]})
                }
            } else {
                json!({"isError":true,"content":[{"type":"text","text":"Unknown tool or invalid JSON object arguments."}]})
            };
            let content = tool_result_text(&result);
            session.emit(AgentEventKind::ToolCallUpdate {
                tool_call_id: call.id.clone(),
                title: None,
                status: Some(
                    if result["isError"] == true {
                        "failed"
                    } else {
                        "completed"
                    }
                    .into(),
                ),
                content: Some(bounded(&content, 4000)),
                output: Some(result),
            });
            history.push(json!({"role":"tool","tool_call_id":call.id,"content":bounded(&content, 256 * 1024)}));
            progress.remove(&call.id);
        }
    }
    Err(err(
        "API turn reached the 32-round tool limit; inspect the conversation before continuing",
    ))
}
fn friendly_title(name: &str, args: Option<&Value>) -> String {
    let summary = args
        .and_then(Value::as_object)
        .map(|args| {
            args.iter()
                .take(3)
                .map(|(k, v)| format!("{k}: {}", bounded(v.as_str().unwrap_or(&v.to_string()), 70)))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    if summary.is_empty() {
        name.into()
    } else {
        format!("{name} · {}", bounded(&summary, 180))
    }
}
fn provider_message(value: &Value) -> String {
    value["message"]
        .as_str()
        .or_else(|| value.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| bounded(&value.to_string(), 2000))
}
fn tool_result_text(value: &Value) -> String {
    let text = value["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() {
        value.to_string()
    } else {
        text
    }
}
fn bounded(value: &str, bytes: usize) -> String {
    let mut end = value.len().min(bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}
fn settle_pending_tools(history: &mut Vec<Value>) {
    let Some(start) = history
        .iter()
        .rposition(|m| m["role"] == "assistant" && m["tool_calls"].is_array())
    else {
        return;
    };
    let calls = history[start]["tool_calls"]
        .as_array()
        .expect("calls")
        .iter()
        .filter_map(|c| c["id"].as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    for id in calls {
        if !history[start + 1..]
            .iter()
            .any(|m| m["role"] == "tool" && m["tool_call_id"] == id)
        {
            history.push(json!({"role":"tool","tool_call_id":id,"content":"Cancelled. An already dispatched operation may have completed; inspect the board before retrying."}));
        }
    }
}

#[cfg(test)]
#[path = "api_tests.rs"]
mod tests;

fn emit_options(session: &Session, catalog: &ModelCatalog, style: EffortStyle) {
    let mut inner = session.inner.lock().expect("session lock");
    let model = inner.view.model.clone().unwrap_or_default();
    let info = catalog.models.iter().find(|m| m.id == model);
    inner.view.capabilities.images = info.is_some_and(|m| m.input_image);
    inner.view.capabilities.embedded_context = false;
    inner.view.capabilities.config_options = true;
    let mut values = catalog
        .models
        .iter()
        .map(|m| ConfigValue {
            value: m.id.clone(),
            name: m.name.clone(),
            description: None,
        })
        .collect::<Vec<_>>();
    if !values.iter().any(|v| v.value == model) {
        values.push(ConfigValue {
            value: model.clone(),
            name: model.clone(),
            description: None,
        });
    }
    let mut options = vec![ConfigOption {
        id: "model".into(),
        name: "Model".into(),
        value: model,
        values,
        category: Some("model".into()),
        description: None,
    }];
    if style != EffortStyle::None && info.is_some_and(|m| m.reasoning) {
        let values = if style == EffortStyle::Zai {
            vec![
                ("auto", "Auto"),
                ("enabled", "Thinking on"),
                ("disabled", "Thinking off"),
            ]
        } else {
            vec![
                ("auto", "Auto"),
                ("low", "Low"),
                ("medium", "Medium"),
                ("high", "High"),
            ]
        };
        options.push(ConfigOption {
            id: "thought_level".into(),
            name: "Effort".into(),
            value: inner.view.effort.clone().unwrap_or("auto".into()),
            values: values
                .into_iter()
                .map(|(value, name)| ConfigValue {
                    value: value.into(),
                    name: name.into(),
                    description: None,
                })
                .collect(),
            category: Some("thought_level".into()),
            description: None,
        });
    }
    inner.config = options.iter().cloned().map(|o| (o.id.clone(), o)).collect();
    session.push_locked(&mut inner, AgentEventKind::ConfigOptions { options });
}
pub(crate) fn apply_effort(
    body: &mut Value,
    style: EffortStyle,
    effort: Option<&str>,
    reasoning: bool,
) {
    let Some(effort) = effort.filter(|s| !s.is_empty() && *s != "auto") else {
        return;
    };
    if !reasoning {
        return;
    }
    match style {
        EffortStyle::Openrouter if ["low", "medium", "high"].contains(&effort) => {
            body["reasoning"] = json!({"effort":effort});
        }
        EffortStyle::Openai if ["low", "medium", "high"].contains(&effort) => {
            body["reasoning_effort"] = json!(effort);
        }
        EffortStyle::Zai if ["enabled", "disabled"].contains(&effort) => {
            body["thinking"] = json!({"type":effort});
        }
        _ => {}
    }
}
