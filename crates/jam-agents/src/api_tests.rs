use super::*;
use crate::tests::{events, session};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[derive(Default)]
struct FakeTools {
    calls: Mutex<Vec<(String, Value)>>,
    stopped: AtomicBool,
}
impl ToolSource for FakeTools {
    fn list(&self) -> BoxFuture<'_, Result<Vec<ApiTool>>> {
        Box::pin(async {
            Ok(vec![
                ApiTool {
                    name: "read_board".into(),
                    description: "Read fictional board".into(),
                    schema: json!({"type":"object","properties":{"project":{"type":"string"}}}),
                    read_only: true,
                },
                ApiTool {
                    name: "write_note".into(),
                    description: "Write fictional note".into(),
                    schema: json!({"type":"object","properties":{"text":{"type":"string"}}}),
                    read_only: false,
                },
            ])
        })
    }
    fn guide(&self) -> BoxFuture<'_, Result<String>> {
        Box::pin(async { Ok("Fictional jam://guide: Ready is not Start approval.".into()) })
    }
    fn call(&self, name: String, args: Value) -> BoxFuture<'_, Result<Value>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((name.clone(), args));
            Ok(json!({"content":[{"type":"text","text":format!("Completed {name}")}]}))
        })
    }
    fn shutdown(&self) -> BoxFuture<'_, ()> {
        Box::pin(async {
            self.stopped.store(true, Ordering::SeqCst);
        })
    }
}
struct HttpReply {
    status: u16,
    retry_after: Option<String>,
    chunks: Vec<String>,
    hold: bool,
}
impl HttpReply {
    fn stream(values: Vec<Value>) -> Self {
        let mut chunks = values
            .into_iter()
            .map(|v| format!("data: {v}\n\n"))
            .collect::<Vec<_>>();
        chunks.push("data: [DONE]\n\n".into());
        Self {
            retry_after: None,
            status: 200,
            chunks,
            hold: false,
        }
    }
    fn error(status: u16, message: &str) -> Self {
        Self {
            status,
            retry_after: None,
            chunks: vec![json!({"error":{"message":message}}).to_string()],
            hold: false,
        }
    }
}
struct Captured {
    path: String,
    headers: String,
    body: Value,
}
struct FakeHttp {
    base: String,
    requests: mpsc::UnboundedReceiver<Captured>,
    task: tokio::task::JoinHandle<()>,
    disconnected: Option<oneshot::Receiver<()>>,
}
impl Drop for FakeHttp {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl FakeHttp {
    async fn new(replies: Vec<HttpReply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (sent, requests) = mpsc::unbounded_channel();
        let (closed, disconnected) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut closed = Some(closed);
            for reply in replies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buf = [0u8; 4096];
                let header_end = loop {
                    let n = socket.read(&mut buf).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        break end + 4;
                    }
                };
                let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                let length = headers
                    .lines()
                    .find_map(|s| {
                        s.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                while bytes.len() < header_end + length {
                    let n = socket.read(&mut buf).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                }
                sent.send(Captured {
                    path: headers.lines().next().unwrap().to_string(),
                    body: if length == 0 {
                        Value::Null
                    } else {
                        serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap()
                    },
                    headers,
                })
                .unwrap();
                let length = if reply.hold {
                    1_000_000
                } else {
                    reply.chunks.iter().map(String::len).sum::<usize>()
                };
                let retry_after = reply
                    .retry_after
                    .as_ref()
                    .map(|v| format!("Retry-After: {v}\r\n"))
                    .unwrap_or_default();
                socket.write_all(format!("HTTP/1.1 {} Fake\r\nContent-Type: text/event-stream\r\n{retry_after}Content-Length: {length}\r\nConnection: close\r\n\r\n", reply.status).as_bytes()).await.unwrap();
                'chunks: for chunk in reply.chunks {
                    for bytes in chunk.as_bytes().chunks(7) {
                        if socket.write_all(bytes).await.is_err() {
                            break 'chunks;
                        }
                        tokio::task::yield_now().await;
                    }
                }
                if reply.hold {
                    let mut byte = [0u8; 1];
                    let _ = socket.read(&mut byte).await;
                    if let Some(closed) = closed.take() {
                        let _ = closed.send(());
                    }
                }
            }
        });
        Self {
            base,
            requests,
            task,
            disconnected: Some(disconnected),
        }
    }
}
fn config(server: &FakeHttp) -> ApiConfig {
    ApiConfig {
        effort_style: EffortStyle::None,
        catalog: ModelCatalog {
            models: vec![],
            source: CatalogSource::Profile,
            fetched_at: None,
            error: None,
        },
        base_url: server.base.clone(),
        model: "fictional-model".into(),
        key: "fake-secret-for-tests".into(),
    }
}
async fn wait_for(s: &Session, condition: impl Fn(&[AgentDockEvent]) -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if condition(&events(s)) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .expect("API scenario timed out");
}
fn ended(events: &[AgentDockEvent]) -> bool {
    events
        .iter()
        .any(|e| matches!(e.event, AgentEventKind::TurnEnd { .. }))
}
fn delta(text: &str) -> Value {
    json!({"choices":[{"delta":{"content":text},"finish_reason":null}]})
}
fn end(reason: &str) -> Value {
    json!({"choices":[{"delta":{},"finish_reason":reason}]})
}

#[test]
fn sse_handles_split_utf8_events_and_incremental_tool_calls() {
    let chunks = [
        delta("Hello α"),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool-","function":{"name":"read_","arguments":"{\"project\":"}}]}}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"board","arguments":"\"a\"}"}}]},"finish_reason":"tool_calls"}]}),
    ];
    let wire = chunks
        .iter()
        .map(|v| format!("data: {v}\r\n\r\n"))
        .collect::<String>()
        + "data: [DONE]\r\n\r\n";
    let mut parser = SseDecoder::default();
    let mut result = Completion::default();
    for byte in wire.as_bytes() {
        for event in parser.push(&[*byte]).unwrap() {
            result.apply(event).unwrap();
        }
    }
    assert_eq!(result.text, "Hello α");
    assert!(result.done);
    assert_eq!(result.finish.as_deref(), Some("tool_calls"));
    assert_eq!(result.calls[&0].id, "tool-1");
    assert_eq!(result.calls[&0].name, "read_board");
    assert_eq!(
        serde_json::from_str::<Value>(&result.calls[&0].arguments).unwrap(),
        json!({"project":"a"})
    );
}

#[tokio::test]
// BC05: local HTTP + abstract MCP source; read auto-runs, write waits for a choice.
async fn api_turn_streams_tools_permission_results_and_final_text() {
    let first = HttpReply::stream(vec![
        delta("I will "),
        delta("inspect the board."),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read-1","function":{"name":"read_board","arguments":"{\"project\":"}},{"index":1,"id":"write-1","function":{"name":"write_note","arguments":"{\"text\":\""}}]}}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a\"}"}},{"index":1,"function":{"arguments":"A note\"}"}}]},"finish_reason":"tool_calls"}]}),
    ]);
    let mut server = FakeHttp::new(vec![
        first,
        HttpReply::stream(vec![delta("Done."), end("stop")]),
    ])
    .await;
    let s = session(SessionStatus::Starting);
    let tools = Arc::new(FakeTools::default());
    start_with_source(s.clone(), config(&server), tools.clone())
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Inspect and add a note".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .any(|e| matches!(e.event, AgentEventKind::PermissionRequest { .. }))
    })
    .await;
    assert_eq!(tools.calls.lock().unwrap().len(), 1);
    assert_eq!(tools.calls.lock().unwrap()[0].0, "read_board");
    let request = s
        .inner
        .lock()
        .unwrap()
        .permissions
        .keys()
        .next()
        .unwrap()
        .clone();
    s.resolve(&request, Some("allow_once".into())).unwrap();
    wait_for(&s, ended).await;
    assert_eq!(
        tools.calls.lock().unwrap().as_slice(),
        &[
            ("read_board".into(), json!({"project":"a"})),
            ("write_note".into(), json!({"text":"A note"}))
        ]
    );
    let request = server.requests.recv().await.unwrap();
    assert_eq!(request.path, "POST /chat/completions HTTP/1.1");
    assert!(
        request
            .headers
            .to_ascii_lowercase()
            .contains("authorization: bearer fake-secret-for-tests")
    );
    assert!(!request.body.to_string().contains("fake-secret-for-tests"));
    assert_eq!(request.body["model"], "fictional-model");
    assert_eq!(request.body["tools"].as_array().unwrap().len(), 2);
    assert!(
        request.body["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("Fictional jam://guide")
    );
    let second = server.requests.recv().await.unwrap();
    let messages = second.body["messages"].as_array().unwrap();
    assert_eq!(messages.iter().filter(|m| m["role"] == "tool").count(), 2);
    let event_json = serde_json::to_value(events(&s)).unwrap();
    assert!(!event_json.to_string().contains("fake-secret-for-tests"));
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::ToolCall { title, .. } if title.contains("write_note") && title.contains("A note"))));
    assert_eq!(s.view().status, SessionStatus::Ready);
    s.connector().unwrap().stop().await.unwrap();
    assert!(tools.stopped.load(Ordering::SeqCst));
}

#[tokio::test]
async fn api_401_reports_auth_required_and_redacts_provider_error() {
    let mut server =
        FakeHttp::new(vec![HttpReply::error(401, "Invalid fake-secret-for-tests")]).await;
    let s = session(SessionStatus::Starting);
    start_with_source(s.clone(), config(&server), Arc::new(FakeTools::default()))
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text { text: "Hi".into() }])
        .await
        .unwrap();
    wait_for(&s, ended).await;
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::Auth { state: AuthState::Required, label } if label.contains("Invalid [REDACTED]"))));
    assert!(
        !serde_json::to_string(&events(&s))
            .unwrap()
            .contains("fake-secret-for-tests")
    );
    assert!(server.requests.recv().await.is_some());
    assert!(server.requests.try_recv().is_err());
    s.connector().unwrap().stop().await.unwrap();
}

#[tokio::test]
async fn api_permanent_status_errors_do_not_retry() {
    for status in [400, 413] {
        let mut server = FakeHttp::new(vec![HttpReply::error(status, "Provider busy")]).await;
        let s = session(SessionStatus::Starting);
        start_with_source(s.clone(), config(&server), Arc::new(FakeTools::default()))
            .await
            .unwrap();
        s.connector()
            .unwrap()
            .prompt(vec![PromptPart::Text { text: "Hi".into() }])
            .await
            .unwrap();
        wait_for(&s, ended).await;
        assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::Error { detail: Some(detail), .. } if detail.contains("Provider busy") && detail.contains(&status.to_string()))));
        assert!(server.requests.recv().await.is_some());
        assert!(server.requests.try_recv().is_err());
        s.connector().unwrap().stop().await.unwrap();
    }
}

#[tokio::test]
async fn api_cancel_mid_stream_aborts_http_and_emits_cancelled() {
    let mut server = FakeHttp::new(vec![HttpReply {
        retry_after: None,
        status: 200,
        chunks: vec![format!("data: {}\n\n", delta("Partial response"))],
        hold: true,
    }])
    .await;
    let s = session(SessionStatus::Starting);
    start_with_source(s.clone(), config(&server), Arc::new(FakeTools::default()))
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text { text: "Hi".into() }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .any(|e| matches!(e.event, AgentEventKind::AgentMessageDelta { .. }))
    })
    .await;
    s.connector().unwrap().cancel().await.unwrap();
    wait_for(&s, ended).await;
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::TurnEnd { stop_reason } if stop_reason == "cancelled")));
    tokio::time::timeout(Duration::from_secs(3), server.disconnected.take().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(s.view().status, SessionStatus::Ready);
    s.connector().unwrap().stop().await.unwrap();
}

#[tokio::test]
async fn api_length_finishes_as_max_tokens() {
    let server = FakeHttp::new(vec![HttpReply::stream(vec![
        delta("Incomplete"),
        end("length"),
    ])])
    .await;
    let s = session(SessionStatus::Starting);
    start_with_source(s.clone(), config(&server), Arc::new(FakeTools::default()))
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text { text: "Hi".into() }])
        .await
        .unwrap();
    wait_for(&s, ended).await;
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::TurnEnd { stop_reason } if stop_reason == "max_tokens")));
    s.connector().unwrap().stop().await.unwrap();
}

#[test]
fn api_model_is_required() {
    let error = ApiConfig {
        effort_style: EffortStyle::None,
        catalog: ModelCatalog {
            models: vec![],
            source: CatalogSource::Profile,
            fetched_at: None,
            error: None,
        },
        base_url: "http://127.0.0.1".into(),
        model: " ".into(),
        key: "fake".into(),
    }
    .endpoint()
    .unwrap_err();
    assert_eq!(error.to_string(), "A model is required for API profiles");
}

fn write_reply(id: &str) -> HttpReply {
    HttpReply::stream(vec![
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":id,"function":{"name":"write_note","arguments":"{\"text\":\"Fictional note\"}"}}]},"finish_reason":"tool_calls"}]}),
    ])
}

#[tokio::test]
async fn api_allow_always_is_scoped_to_this_tool_and_session() {
    let server = FakeHttp::new(vec![
        write_reply("w1"),
        HttpReply::stream(vec![delta("Saved one"), end("stop")]),
        write_reply("w2"),
        HttpReply::stream(vec![delta("Saved two"), end("stop")]),
    ])
    .await;
    let s = session(SessionStatus::Starting);
    let tools = Arc::new(FakeTools::default());
    start_with_source(s.clone(), config(&server), tools.clone())
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "First".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .any(|e| matches!(e.event, AgentEventKind::PermissionRequest { .. }))
    })
    .await;
    let id = s
        .inner
        .lock()
        .unwrap()
        .permissions
        .keys()
        .next()
        .unwrap()
        .clone();
    s.resolve(&id, Some("allow_always".into())).unwrap();
    wait_for(&s, ended).await;
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Second".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .filter(|e| matches!(e.event, AgentEventKind::TurnEnd { .. }))
            .count()
            == 2
    })
    .await;
    assert_eq!(
        events(&s)
            .iter()
            .filter(|e| matches!(e.event, AgentEventKind::PermissionRequest { .. }))
            .count(),
        1
    );
    assert_eq!(tools.calls.lock().unwrap().len(), 2);
    let users = events(&s)
        .into_iter()
        .filter_map(|e| match e.event {
            AgentEventKind::UserMessage {
                context_preamble, ..
            } => Some(context_preamble),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(users[0].is_some());
    assert!(users[1].is_none());
    s.connector().unwrap().stop().await.unwrap();
}

#[tokio::test]
async fn api_cancel_pending_permission_never_runs_the_write_and_retains_valid_history() {
    let mut server = FakeHttp::new(vec![
        write_reply("cancel-write"),
        HttpReply::stream(vec![delta("Recovered"), end("stop")]),
    ])
    .await;
    let s = session(SessionStatus::Starting);
    let tools = Arc::new(FakeTools::default());
    start_with_source(s.clone(), config(&server), tools.clone())
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Try write".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .any(|e| matches!(e.event, AgentEventKind::PermissionRequest { .. }))
    })
    .await;
    s.connector().unwrap().cancel().await.unwrap();
    wait_for(&s, ended).await;
    assert!(tools.calls.lock().unwrap().is_empty());
    assert!(s.inner.lock().unwrap().permissions.is_empty());
    assert!(events(&s).iter().any(|e| matches!(
        &e.event,
        AgentEventKind::PermissionResolved {
            option_id: None,
            ..
        }
    )));
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Continue".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .filter(|e| matches!(e.event, AgentEventKind::TurnEnd { .. }))
            .count()
            == 2
    })
    .await;
    let _first = server.requests.recv().await.unwrap();
    let next = server.requests.recv().await.unwrap();
    assert!(
        next.body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["role"] == "tool"
                && m["tool_call_id"] == "cancel-write"
                && m["content"].as_str().unwrap().contains("Cancelled"))
    );
    assert!(tools.calls.lock().unwrap().is_empty());
    s.connector().unwrap().stop().await.unwrap();
}

#[tokio::test]
async fn api_reject_permission_sends_declined_tool_result() {
    let mut server = FakeHttp::new(vec![
        write_reply("reject-write"),
        HttpReply::stream(vec![delta("Declined"), end("stop")]),
    ])
    .await;
    let s = session(SessionStatus::Starting);
    let tools = Arc::new(FakeTools::default());
    start_with_source(s.clone(), config(&server), tools.clone())
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Try write".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |events| {
        events
            .iter()
            .any(|e| matches!(e.event, AgentEventKind::PermissionRequest { .. }))
    })
    .await;
    let id = s
        .inner
        .lock()
        .unwrap()
        .permissions
        .keys()
        .next()
        .unwrap()
        .clone();
    s.resolve(&id, Some("reject".into())).unwrap();
    wait_for(&s, ended).await;
    assert!(tools.calls.lock().unwrap().is_empty());
    let _first = server.requests.recv().await.unwrap();
    let next = server.requests.recv().await.unwrap();
    assert!(
        next.body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["role"] == "tool"
                && m["content"].as_str().unwrap().contains("person declined"))
    );
    s.connector().unwrap().stop().await.unwrap();
}

#[tokio::test]
async fn bc14_api_synthetic_options_switch_models_and_send_each_effort_style() {
    for (style, effort, field, expected) in [
        (
            EffortStyle::Openrouter,
            "high",
            "reasoning",
            json!({"effort":"high"}),
        ),
        (
            EffortStyle::Openai,
            "medium",
            "reasoning_effort",
            json!("medium"),
        ),
        (
            EffortStyle::Zai,
            "enabled",
            "thinking",
            json!({"type":"enabled"}),
        ),
        (EffortStyle::None, "high", "reasoning", Value::Null),
    ] {
        let mut server = FakeHttp::new(vec![
            HttpReply::stream(vec![end("stop")]),
            HttpReply::stream(vec![end("stop")]),
        ])
        .await;
        let s = session(SessionStatus::Starting);
        s.inner.lock().unwrap().view.effort = Some(effort.into());
        let mut cfg = config(&server);
        cfg.effort_style = style;
        let mut m = crate::catalog::fallback_model("fictional-model");
        m.reasoning = true;
        cfg.catalog.models = vec![m, crate::catalog::fallback_model("routine-model")];
        start_with_source(s.clone(), cfg, Arc::new(FakeTools::default()))
            .await
            .unwrap();
        {
            let inner = s.inner.lock().unwrap();
            assert_eq!(inner.config["model"].category.as_deref(), Some("model"));
            assert_eq!(
                inner.config.contains_key("thought_level"),
                style != EffortStyle::None
            );
        }
        s.connector()
            .unwrap()
            .prompt(vec![PromptPart::Text {
                text: "Plan".into(),
            }])
            .await
            .unwrap();
        let request = server.requests.recv().await.unwrap();
        assert_eq!(request.body["model"], "fictional-model");
        assert_eq!(request.body[field], expected);
        wait_for(&s, |e| ended(e) && s.view().status == SessionStatus::Ready).await;
        s.connector()
            .unwrap()
            .config("model".into(), "routine-model".into())
            .await
            .unwrap();
        assert_eq!(s.view().model.as_deref(), Some("routine-model"));
        assert!(!s.inner.lock().unwrap().config.contains_key("thought_level"));
        assert!(
            s.connector()
                .unwrap()
                .config("thought_level".into(), "high".into())
                .await
                .is_err()
        );
        s.connector()
            .unwrap()
            .prompt(vec![PromptPart::Text {
                text: "Routine work".into(),
            }])
            .await
            .unwrap();
        let request = server.requests.recv().await.unwrap();
        assert_eq!(request.body["model"], "routine-model");
        for key in ["reasoning", "reasoning_effort", "thinking"] {
            assert!(request.body.get(key).is_none());
        }
        s.stop.cancel();
        s.finished.cancelled().await;
    }
}
#[tokio::test]
async fn bc13_api_image_url_transport_and_nonvision_refusal_before_http() {
    let mut server = FakeHttp::new(vec![HttpReply::stream(vec![end("stop")])]).await;
    let s = session(SessionStatus::Starting);
    let mut cfg = config(&server);
    let mut m = crate::catalog::fallback_model("fictional-model");
    m.input_image = true;
    cfg.catalog.models = vec![m];
    start_with_source(s.clone(), cfg, Arc::new(FakeTools::default()))
        .await
        .unwrap();
    let a = crate::attachments::add(
        &s,
        AttachmentSource::Bytes {
            name: "photo.png".into(),
            mime_type: "image/png".into(),
            data: "aW1hZ2U=".into(),
        },
    )
    .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Attachment {
            attachment_id: a.id.clone(),
        }])
        .await
        .unwrap();
    let request = server.requests.recv().await.unwrap();
    let parts = request.body["messages"][1]["content"].as_array().unwrap();
    let image = parts.iter().find(|v| v["type"] == "image_url").unwrap();
    assert_eq!(image["image_url"]["url"], "data:image/png;base64,aW1hZ2U=");
    wait_for(&s, |e| ended(e) && s.view().status == SessionStatus::Ready).await;
    s.connector()
        .unwrap()
        .config("model".into(), "unknown-text-model".into())
        .await
        .unwrap();
    assert_eq!(
        s.connector()
            .unwrap()
            .prompt(vec![PromptPart::Attachment {
                attachment_id: a.id
            }])
            .await
            .unwrap_err()
            .to_string(),
        "This model can't see images — pick a vision model"
    );
    assert_eq!(s.view().status, SessionStatus::Ready);
    assert!(server.requests.try_recv().is_err());
    s.stop.cancel();
    s.finished.cancelled().await;
}

#[tokio::test]
async fn multi_server_namespaces_routes_and_permission_matrix() {
    let board = Arc::new(FakeTools::default());
    let web = Arc::new(FakeTools::default());
    let custom = Arc::new(FakeTools::default());
    let source = MultiTools {
        servers: vec![
            ServerTools {
                name: "jam-board".into(),
                trust: false,
                source: board.clone(),
                tools: board.list().await.unwrap(),
            },
            ServerTools {
                name: "web".into(),
                trust: true,
                source: web.clone(),
                tools: web.list().await.unwrap(),
            },
            ServerTools {
                name: "custom".into(),
                trust: false,
                source: custom.clone(),
                tools: custom.list().await.unwrap(),
            },
        ],
    };
    let tools = source.list().await.unwrap();
    assert_eq!(tools.len(), 6);
    for (name, direct) in [
        ("jam-board__read_board", true),
        ("jam-board__write_note", false),
        ("web__read_board", true),
        ("web__write_note", false),
        ("custom__read_board", false),
        ("custom__write_note", false),
    ] {
        assert_eq!(
            tools.iter().find(|t| t.name == name).unwrap().read_only,
            direct,
            "{name}"
        );
    }
    source
        .call("web__read_board".into(), json!({"project":"one"}))
        .await
        .unwrap();
    assert_eq!(web.calls.lock().unwrap()[0].0, "read_board");
    assert!(board.calls.lock().unwrap().is_empty());
    assert!(
        source
            .call("missing__read_board".into(), json!({}))
            .await
            .is_err()
    );
    assert!(source.call("web__missing".into(), json!({})).await.is_err());
    source.shutdown().await;
    assert!(web.stopped.load(Ordering::SeqCst));
}
#[tokio::test]
async fn api_external_read_hint_requires_trust_and_rejection_never_dispatches() {
    let mut server = FakeHttp::new(vec![
        HttpReply::stream(vec![json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"external","function":{"name":"custom__read_board","arguments":"{}"}}]},"finish_reason":"tool_calls"}]})]),
        HttpReply::stream(vec![delta("Declined."), end("stop")]),
    ]).await;
    let s = session(SessionStatus::Starting);
    let fake = Arc::new(FakeTools::default());
    let source = Arc::new(MultiTools {
        servers: vec![ServerTools {
            name: "custom".into(),
            trust: false,
            tools: fake.list().await.unwrap(),
            source: fake.clone(),
        }],
    });
    start_with_source(s.clone(), config(&server), source)
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Read".into(),
        }])
        .await
        .unwrap();
    wait_for(&s, |e| {
        e.iter()
            .any(|e| matches!(e.event, AgentEventKind::PermissionRequest { .. }))
    })
    .await;
    assert!(fake.calls.lock().unwrap().is_empty());
    let request = s
        .inner
        .lock()
        .unwrap()
        .permissions
        .keys()
        .next()
        .cloned()
        .unwrap();
    s.resolve(&request, Some("reject".into())).unwrap();
    wait_for(&s, ended).await;
    assert!(fake.calls.lock().unwrap().is_empty());
    let first = server.requests.recv().await.unwrap();
    assert_eq!(
        first.body["tools"][0]["function"]["name"],
        "custom__read_board"
    );
    s.connector().unwrap().stop().await.unwrap();
}
#[tokio::test]
async fn api_resume_command_restores_transcript_truncates_results_and_continues_after_failed_mcp() {
    let mut server = FakeHttp::new(vec![
        HttpReply {
            retry_after: None,
            status: 200,
            chunks: vec![json!({"data":[{"id":"fictional-model","tools":true}]}).to_string()],
            hold: false,
        },
        HttpReply::stream(vec![delta("Continued."), end("stop")]),
    ])
    .await;
    let s = session(SessionStatus::Stopped);
    let database = Arc::new(jam_core::Store::open(s.board.data_dir.join("resume.db")).unwrap());
    let manager = SessionManager::new(
        database,
        Arc::new(crate::tests::MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let profile = manager
        .profiles
        .save(AgentProfileInput {
            label: "Stub API".into(),
            kind: RuntimeKind::Api,
            base_url: Some(Some(server.base.clone())),
            model: Some(Some("fictional-model".into())),
            secret_keys: Some(vec![SecretKey {
                key: "API_KEY".into(),
                label: "API key".into(),
            }]),
            ..Default::default()
        })
        .unwrap();
    manager
        .profiles
        .set_secret(&profile.id, "API_KEY", "fake-secret-for-tests")
        .unwrap();
    let history = manager
        .history_store(&s.board.data_dir, &s.board.project_id)
        .unwrap();
    let record = crate::history::StoredHistory {
        entry: HistoryEntry {
            id: "saved-entry".into(),
            provider: Default::default(),
            empty: false,
            project_id: s.board.project_id.clone(),
            profile_id: profile.id.clone(),
            profile_label: profile.label,
            kind: HistoryKind::Api,
            title: "Previous conversation".into(),
            created_at: crate::session::now(),
            updated_at: crate::session::now(),
            model: profile.model.clone(),
            effort: None,
            agent_session_id: None,
            resumable: Resumable::Transcript,
            message_count: 0,
        },
        board: s.board.clone(),
        cwd: s.view().cwd,
        profile: manager.profiles.get(&profile.id).unwrap(),
        renamed: false,
        has_user_message: false,
        last_agent_message_id: None,
        terminal: None,
    };
    let mut writer = history.create(record).unwrap().unwrap();
    for (i, event) in [
        AgentEventKind::UserMessage {
            message_id: "u1".into(),
            content: vec![PromptPart::Text {
                text: "Previous request".into(),
            }],
            context_preamble: Some("Original context".into()),
        },
        AgentEventKind::AgentMessageDelta {
            message_id: "a1".into(),
            text: "Previous ".into(),
        },
        AgentEventKind::AgentMessageDelta {
            message_id: "a1".into(),
            text: "answer".into(),
        },
        AgentEventKind::ToolCall {
            tool_name: Some("jam-board__read_board".into()),
            tool_call_id: "t1".into(),
            title: "Read board".into(),
            tool_kind: "read".into(),
            status: "pending".into(),
            input: Some(json!({"project":"one"})),
            content: None,
            locations: None,
        },
        AgentEventKind::ToolCallUpdate {
            tool_call_id: "t1".into(),
            title: None,
            status: Some("completed".into()),
            content: None,
            output: Some(json!({"content":[{"type":"text","text":"界".repeat(4000)}]})),
        },
        AgentEventKind::TurnEnd {
            stop_reason: "end_turn".into(),
        },
    ]
    .into_iter()
    .enumerate()
    {
        writer
            .append(
                &AgentDockEvent {
                    session_id: "saved-entry".into(),
                    seq: i as u64 + 1,
                    at: crate::session::now(),
                    event,
                },
                &s.view(),
            )
            .unwrap();
    }
    drop(writer);
    let view = manager
        .resume(&s.board.data_dir, &s.board.project_id, "saved-entry")
        .await
        .unwrap();
    assert_eq!(view.cwd, s.view().cwd);
    assert_eq!(view.id, "saved-entry");
    let replay = manager.history(&view.id).unwrap();
    assert_eq!(
        replay
            .iter()
            .filter(|e| matches!(e.event, AgentEventKind::Error { .. }))
            .count(),
        1
    );
    assert!(replay.iter().any(|e| matches!(&e.event, AgentEventKind::Status { message: Some(m), .. } if m.starts_with("Resumed "))));
    assert!(
        manager
            .resume(&s.board.data_dir, &s.board.project_id, "saved-entry")
            .await
            .is_err()
    );
    manager
        .prompt(SendAgentPromptInput {
            session_id: view.id.clone(),
            content: vec![PromptPart::Text {
                text: "Continue".into(),
            }],
        })
        .await
        .unwrap();
    wait_for(&manager.get(&view.id).unwrap(), |e| e.iter().any(|e| matches!(&e.event, AgentEventKind::AgentMessageDelta { text, .. } if text == "Continued."))).await;
    let _catalogue = server.requests.recv().await.unwrap();
    let request = server.requests.recv().await.unwrap();
    let messages = request.body["messages"].as_array().unwrap();
    assert!(
        messages
            .iter()
            .any(|m| m["role"] == "user" && m.to_string().contains("Previous request"))
    );
    assert!(
        messages
            .iter()
            .any(|m| m["role"] == "assistant" && m["content"] == "Previous answer")
    );
    let result = messages.iter().find(|m| m["role"] == "tool").unwrap()["content"]
        .as_str()
        .unwrap();
    assert!(result.len() <= 8192);
    assert!(result.ends_with("[Tool result truncated to 8 KB for resume]"));
    manager.stop(&view.id).await.unwrap();
    let persisted = history.events("saved-entry").unwrap();
    assert_eq!(
        persisted
            .iter()
            .filter(|e| matches!(e.event, AgentEventKind::UserMessage { .. }))
            .count(),
        2
    );
    assert_eq!(history.list(None, None).unwrap().len(), 1);
}

#[tokio::test]
async fn http_mcp_handshake_bearer_session_routing_and_split_sse() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        for step in 0..5 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![];
            let mut chunk = [0u8; 4096];
            let header_end = loop {
                let n = socket.read(&mut chunk).await.unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let headers = String::from_utf8(bytes[..header_end].to_vec())
                .unwrap()
                .to_lowercase();
            assert!(headers.contains("authorization: bearer fixture-bearer"));
            if step > 0 {
                assert!(headers.contains("mcp-session-id: fixture-session"));
            }
            if step == 4 {
                assert!(headers.starts_with("delete /mcp"));
                socket
                    .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                    .await
                    .unwrap();
                break;
            }
            let length = headers
                .lines()
                .find_map(|l| {
                    l.strip_prefix("content-length:")
                        .map(|s| s.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            while bytes.len() < header_end + length {
                let n = socket.read(&mut chunk).await.unwrap();
                bytes.extend_from_slice(&chunk[..n]);
            }
            let request: Value =
                serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
            let result = match step {
                0 => {
                    assert_eq!(request["method"], "initialize");
                    json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}})
                }
                1 => {
                    assert_eq!(request["method"], "notifications/initialized");
                    socket.write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    continue;
                }
                2 => {
                    assert_eq!(request["method"], "tools/list");
                    json!({"tools":[{"name":"read","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":true}}]})
                }
                3 => {
                    assert_eq!(request["method"], "tools/call");
                    assert_eq!(request["params"]["name"], "read");
                    json!({"content":[{"type":"text","text":"Read completed 界"}]})
                }
                _ => unreachable!(),
            };
            let response = json!({"jsonrpc":"2.0","id":request["id"],"result":result});
            let (content_type, body) = if step == 3 {
                (
                    "text/event-stream",
                    format!("event: message\r\ndata: {response}\r\n\r\n"),
                )
            } else {
                ("application/json", response.to_string())
            };
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nMcp-Session-Id: fixture-session\r\nConnection: close\r\n\r\n",
                body.len()
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            for bytes in body.as_bytes().chunks(3) {
                socket.write_all(bytes).await.unwrap();
                tokio::task::yield_now().await;
            }
        }
    });
    let s = session(SessionStatus::Starting);
    let source = HttpTools::connect(
        &s,
        &McpHttp {
            url,
            bearer_secret_key: Some("MCP_HTTP_TOKEN".into()),
        },
        Some("fixture-bearer".into()),
    )
    .await
    .unwrap();
    let tools = source.list().await.unwrap();
    assert_eq!(tools[0].name, "read");
    assert!(tools[0].read_only);
    let result = source.call("read".into(), json!({})).await.unwrap();
    assert_eq!(result["content"][0]["text"], "Read completed 界");
    source.shutdown().await;
    task.await.unwrap();
}

#[tokio::test]
async fn multi_server_connects_real_stdio_children_and_skips_one_failed_server() {
    let s = session(SessionStatus::Starting);
    let fixture = s.board.data_dir.join("fixture-mcp.cjs");
    std::fs::write(&fixture, r#"
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
 const q = JSON.parse(line); if (q.id === undefined) return;
 let result;
 if(q.method === 'initialize') result = { protocolVersion: q.params.protocolVersion, capabilities: {tools:{}}, serverInfo: {name:'fixture',version:'1'} };
 else if(q.method === 'tools/list') result = { tools: [{name:'read', inputSchema:{type:'object'}, annotations:{readOnlyHint:true}}] };
 else if(q.method === 'tools/call') result = {content:[{type:'text',text:process.env.FIXTURE_SERVER + ':' + (process.env.FIXTURE_API_KEY || 'absent')}]};
 else if(q.method === 'resources/read') result = {contents:[{uri:'jam://guide',text:'Fixture guide'}]};
 else return;
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
});
"#).unwrap();
    let command = which::which("node").unwrap().to_string_lossy().into_owned();
    // This fixture must never resolve an installed agent or a real MCP server.
    assert_eq!(
        std::path::Path::new(&command)
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_ascii_lowercase(),
        "node"
    );
    assert!(fixture.is_file());
    assert!(std::path::Path::new(&command).is_absolute());
    let make = |name: &str, trust| McpEntry {
        enabled: true,
        name: name.into(),
        command: command.clone(),
        args: vec![fixture.to_string_lossy().into_owned()],
        env: vec![Env {
            name: "FIXTURE_SERVER".into(),
            value: name.into(),
        }],
        trust_read_only: Some(trust),
        ..Default::default()
    };
    let missing = McpEntry {
        enabled: true,
        name: "broken".into(),
        command: s
            .board
            .data_dir
            .join("does-not-exist")
            .to_string_lossy()
            .into_owned(),
        ..Default::default()
    };
    let source = MultiTools::connect(
        &s,
        &[make("jam-board", false), make("web", true), missing],
        &[Env {
            name: "FIXTURE_API_KEY".into(),
            value: "must-not-reach-child".into(),
        }],
    )
    .await;
    let tools = source.list().await.unwrap();
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0].name, "jam-board__read");
    assert_eq!(tools[1].name, "web__read");
    for name in ["jam-board", "web"] {
        assert!(events(&s).iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == format!("mcp:{name}") && launch.state == LaunchStepState::Ok)));
    }
    assert!(events(&s).iter().any(|e| matches!(e.event.launch_step(), Some(launch) if launch.step == "mcp:broken" && launch.state == LaunchStepState::Failed && launch.message.contains("MCP executable not found"))));
    assert_eq!(
        source.call("web__read".into(), json!({})).await.unwrap()["content"][0]["text"],
        "web:absent"
    );
    assert_eq!(
        events(&s)
            .iter()
            .filter(|e| matches!(e.event, AgentEventKind::Error { .. }))
            .count(),
        1
    );
    source.shutdown().await;
}

#[tokio::test]
async fn api_resume_does_not_reactivate_interrupted_permissions_or_pending_tools() {
    let server = FakeHttp::new(vec![]).await;
    let s = session(SessionStatus::Starting);
    let replay = [
        AgentEventKind::ToolCall {
            tool_name: Some("custom__write".into()),
            tool_call_id: "old-tool".into(),
            title: "Old write".into(),
            tool_kind: "other".into(),
            status: "pending".into(),
            input: Some(json!({})),
            content: None,
            locations: None,
        },
        AgentEventKind::PermissionRequest {
            request_id: "old-permission".into(),
            tool_call_id: Some("old-tool".into()),
            title: "Old write".into(),
            options: vec![],
        },
    ]
    .into_iter()
    .enumerate()
    .map(|(i, event)| AgentDockEvent {
        session_id: s.view().id,
        seq: i as u64 + 1,
        at: crate::session::now(),
        event,
    })
    .collect();
    {
        let mut inner = s.inner.lock().unwrap();
        inner.resume_events = replay;
        inner.seq = 2;
    }
    let tools = Arc::new(FakeTools::default());
    start_with_source(s.clone(), config(&server), tools.clone())
        .await
        .unwrap();
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::PermissionResolved { request_id, option_id: None } if request_id == "old-permission")));
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::ToolCallUpdate { tool_call_id, status: Some(status), .. } if tool_call_id == "old-tool" && status == "failed")));
    assert!(s.inner.lock().unwrap().permissions.is_empty());
    assert!(tools.calls.lock().unwrap().is_empty());
    s.connector().unwrap().stop().await.unwrap();
}

#[path = "api_retry_tests.rs"]
mod retry_tests;
