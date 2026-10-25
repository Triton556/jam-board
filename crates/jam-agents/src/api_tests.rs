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
            status: 200,
            chunks,
            hold: false,
        }
    }
    fn error(status: u16, message: &str) -> Self {
        Self {
            status,
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
                    .unwrap();
                while bytes.len() < header_end + length {
                    let n = socket.read(&mut buf).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                }
                sent.send(Captured {
                    path: headers.lines().next().unwrap().to_string(),
                    body: serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap(),
                    headers,
                })
                .unwrap();
                let length = if reply.hold {
                    1_000_000
                } else {
                    reply.chunks.iter().map(String::len).sum::<usize>()
                };
                socket.write_all(format!("HTTP/1.1 {} Fake\r\nContent-Type: text/event-stream\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n", reply.status).as_bytes()).await.unwrap();
                for chunk in reply.chunks {
                    for bytes in chunk.as_bytes().chunks(7) {
                        if socket.write_all(bytes).await.is_err() {
                            return;
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
async fn api_rate_limit_and_server_errors_do_not_retry() {
    for status in [429, 503] {
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
        assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::Error { message, .. } if message.contains("Provider busy") && message.contains(&status.to_string()))));
        assert!(server.requests.recv().await.is_some());
        assert!(server.requests.try_recv().is_err());
        s.connector().unwrap().stop().await.unwrap();
    }
}

#[tokio::test]
async fn api_cancel_mid_stream_aborts_http_and_emits_cancelled() {
    let mut server = FakeHttp::new(vec![HttpReply {
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
