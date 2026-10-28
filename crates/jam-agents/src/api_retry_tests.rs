use super::*;

#[tokio::test]
async fn b9_api_quota_429_never_auto_retries_even_with_retry_after_zero() {
    let mut server = FakeHttp::new(vec![immediate_error(
        429,
        "insufficient_quota: You've hit your usage limit; try again at Nov 2nd, 2026 4:27 PM.",
    )])
    .await;
    let s = session(SessionStatus::Starting);
    prompt_fixture(&s, &server, Arc::new(FakeTools::default())).await;
    wait_retry(&s, ended).await;
    assert!(retry_events(&s).is_empty());
    server.requests.recv().await.unwrap();
    assert!(server.requests.try_recv().is_err());
    assert!(events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::Error { code: Some(AgentErrorCode::UsageLimit), retryable: false, resets_at: Some(date), .. } if date == "2026-11-02T16:27:00")));
    s.connector().unwrap().stop().await.unwrap();
}

async fn wait_retry(s: &Session, predicate: impl Fn(&[AgentDockEvent]) -> bool) {
    tokio::time::timeout(Duration::from_secs(16), async {
        loop {
            if predicate(&events(s)) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .expect("retry scenario timed out");
}
fn retry_events(s: &Session) -> Vec<(u32, u32, u64, AgentErrorCode)> {
    events(s)
        .iter()
        .filter_map(|e| match e.event {
            AgentEventKind::Retrying {
                attempt,
                max_attempts,
                delay_ms,
                code,
            } => Some((attempt, max_attempts, delay_ms, code)),
            _ => None,
        })
        .collect()
}
fn immediate_error(status: u16, text: &str) -> HttpReply {
    let mut reply = HttpReply::error(status, text);
    reply.retry_after = Some("0".into());
    reply
}
async fn prompt_fixture(s: &Arc<Session>, server: &FakeHttp, tools: Arc<dyn ToolSource>) {
    start_with_source(s.clone(), config(server), tools)
        .await
        .unwrap();
    s.connector()
        .unwrap()
        .prompt(vec![PromptPart::Text {
            text: "Original request".into(),
        }])
        .await
        .unwrap();
}
#[tokio::test]
async fn api_retries_429_with_retry_after_503_529_and_capacity_400() {
    for (status, text, code) in [
        (429, "rate limit", AgentErrorCode::RateLimited),
        (503, "busy", AgentErrorCode::Overloaded),
        (529, "overloaded", AgentErrorCode::Overloaded),
        (400, "Model at capacity", AgentErrorCode::Overloaded),
    ] {
        let mut server = FakeHttp::new(vec![
            immediate_error(status, text),
            HttpReply::stream(vec![delta("Recovered"), end("stop")]),
        ])
        .await;
        let s = session(SessionStatus::Starting);
        let (history, record) = crate::history_tests::history(&s);
        *s.history_writer.lock().unwrap() = history.create(record).unwrap();
        prompt_fixture(&s, &server, Arc::new(FakeTools::default())).await;
        wait_retry(&s, ended).await;
        assert_eq!(retry_events(&s), [(2, 3, 0, code)]);
        assert!(
            history
                .events(&s.view().id)
                .unwrap()
                .iter()
                .any(|e| matches!(e.event, AgentEventKind::Retrying { attempt: 2, .. }))
        );
        assert!(
            !events(&s)
                .iter()
                .any(|e| matches!(e.event, AgentEventKind::Error { .. }))
        );
        assert_eq!(
            server.requests.recv().await.unwrap().body,
            server.requests.recv().await.unwrap().body
        );
        assert!(server.requests.try_recv().is_err());
        s.connector().unwrap().stop().await.unwrap();
    }
}
#[tokio::test]
async fn api_429_without_header_uses_two_and_six_seconds_then_stops_after_three_attempts() {
    let mut server = FakeHttp::new(vec![
        HttpReply::error(429, "rate limit"),
        HttpReply::error(429, "rate limit"),
        HttpReply::error(429, "rate limit"),
    ])
    .await;
    let s = session(SessionStatus::Starting);
    prompt_fixture(&s, &server, Arc::new(FakeTools::default())).await;
    wait_retry(&s, ended).await;
    assert_eq!(
        retry_events(&s),
        [
            (2, 3, 2000, AgentErrorCode::RateLimited),
            (3, 3, 6000, AgentErrorCode::RateLimited)
        ]
    );
    for _ in 0..3 {
        server.requests.recv().await.unwrap();
    }
    assert!(server.requests.try_recv().is_err());
    assert!(events(&s).iter().any(|e| matches!(
        e.event,
        AgentEventKind::Error {
            code: Some(AgentErrorCode::RateLimited),
            retryable: true,
            retry_after_ms: None,
            ..
        }
    )));
    s.connector().unwrap().stop().await.unwrap();
}
#[tokio::test]
async fn api_retry_after_over_thirty_seconds_is_reported_without_retrying_early() {
    let mut reply = HttpReply::error(429, "wait");
    reply.retry_after = Some("31".into());
    let server = FakeHttp::new(vec![reply]).await;
    let s = session(SessionStatus::Starting);
    prompt_fixture(&s, &server, Arc::new(FakeTools::default())).await;
    wait_retry(&s, ended).await;
    assert!(retry_events(&s).is_empty());
    assert!(events(&s).iter().any(|e| matches!(
        e.event,
        AgentEventKind::Error {
            retry_after_ms: Some(31000),
            ..
        }
    )));
    s.connector().unwrap().stop().await.unwrap();
}
#[tokio::test]
async fn api_does_not_auto_retry_after_first_token_or_tool_call_delta() {
    for output in [
        delta("Partial"),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t","function":{"name":"read_board","arguments":"{}"}}]}}]}),
    ] {
        let mut server = FakeHttp::new(vec![HttpReply::stream(vec![
            output,
            json!({"error":{"code":503,"message":"at capacity"}}),
        ])])
        .await;
        let s = session(SessionStatus::Starting);
        let tools = Arc::new(FakeTools::default());
        prompt_fixture(&s, &server, tools.clone()).await;
        wait_retry(&s, ended).await;
        assert!(retry_events(&s).is_empty());
        assert!(tools.calls.lock().unwrap().is_empty());
        assert!(events(&s).iter().any(|e| matches!(
            e.event,
            AgentEventKind::Error {
                code: Some(AgentErrorCode::Overloaded),
                ..
            }
        )));
        server.requests.recv().await.unwrap();
        assert!(server.requests.try_recv().is_err());
        s.connector().unwrap().stop().await.unwrap();
    }
}
#[tokio::test]
async fn api_retries_only_model_request_after_tools_have_run() {
    let tool = HttpReply::stream(vec![
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read1","function":{"name":"read_board","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}),
    ]);
    let mut server = FakeHttp::new(vec![
        tool,
        immediate_error(503, "at capacity"),
        HttpReply::stream(vec![delta("Done"), end("stop")]),
    ])
    .await;
    let s = session(SessionStatus::Starting);
    let tools = Arc::new(FakeTools::default());
    prompt_fixture(&s, &server, tools.clone()).await;
    wait_retry(&s, ended).await;
    assert_eq!(tools.calls.lock().unwrap().len(), 1);
    server.requests.recv().await.unwrap();
    let failed = server.requests.recv().await.unwrap().body;
    let retry = server.requests.recv().await.unwrap().body;
    assert_eq!(failed, retry);
    assert!(
        retry["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["role"] == "tool")
    );
    s.connector().unwrap().stop().await.unwrap();
}
#[tokio::test]
async fn api_stop_and_cancel_abort_pending_backoff_and_running_retry_is_refused() {
    for stop_session in [false, true] {
        let mut server = FakeHttp::new(vec![HttpReply::error(503, "at capacity")]).await;
        let s = session(SessionStatus::Starting);
        prompt_fixture(&s, &server, Arc::new(FakeTools::default())).await;
        wait_retry(&s, |e| {
            e.iter()
                .any(|e| matches!(e.event, AgentEventKind::Retrying { .. }))
        })
        .await;
        assert!(s.connector().unwrap().retry().await.is_err());
        let start = std::time::Instant::now();
        if stop_session {
            s.connector().unwrap().stop().await.unwrap();
        } else {
            s.connector().unwrap().cancel().await.unwrap();
            wait_retry(&s, ended).await;
        }
        assert!(start.elapsed() < Duration::from_secs(1));
        server.requests.recv().await.unwrap();
        assert!(server.requests.try_recv().is_err());
        if !stop_session {
            s.connector().unwrap().stop().await.unwrap();
        }
    }
}
#[tokio::test]
async fn api_manual_retry_command_preserves_parts_context_tools_and_records_history() {
    let catalogue = HttpReply {
        retry_after: None,
        status: 200,
        chunks: vec![json!({"data":[{"id":"fictional-model","tools":true}]}).to_string()],
        hold: false,
    };
    let tool = HttpReply::stream(vec![
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read1","function":{"name":"absent","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}),
    ]);
    let mut server = FakeHttp::new(vec![
        catalogue,
        tool,
        HttpReply::stream(vec![
            delta("Failed partial"),
            json!({"error":{"code":503,"message":"at capacity"}}),
        ]),
        HttpReply::stream(vec![delta("Successful retry"), end("stop")]),
    ])
    .await;
    let fixture = session(SessionStatus::Stopped);
    let database =
        Arc::new(jam_core::Store::open(fixture.board.data_dir.join("retry.db")).unwrap());
    let manager = SessionManager::new(
        database,
        Arc::new(crate::tests::MemoryCredentials::default()),
        |_| {},
        |_| {},
    );
    let p = manager
        .profiles
        .save(AgentProfileInput {
            label: "Retry API".into(),
            kind: RuntimeKind::Api,
            base_url: Some(Some(server.base.clone())),
            model: Some(Some("fictional-model".into())),
            secret_keys: Some(vec![SecretKey {
                key: "API_KEY".into(),
                label: "Key".into(),
            }]),
            ..Default::default()
        })
        .unwrap();
    manager
        .profiles
        .set_secret(&p.id, "API_KEY", "fake-secret-for-tests")
        .unwrap();
    let view = manager
        .start(
            fixture.board.clone(),
            StartAgentSessionInput {
                user_config: None,
                profile_id: p.id,
                cwd: None,
                model: None,
                effort: None,
            },
        )
        .await
        .unwrap();
    assert!(manager.retry(&view.id).await.is_err());
    let attachment = manager
        .add_attachment(AddAgentAttachmentInput {
            session_id: view.id.clone(),
            source: AttachmentSource::Bytes {
                name: "context.txt".into(),
                mime_type: "text/plain".into(),
                data: "U2FtZSBhdHRhY2htZW50".into(),
            },
        })
        .unwrap();
    let parts = vec![
        PromptPart::Text {
            text: "Keep all parts".into(),
        },
        PromptPart::Attachment {
            attachment_id: attachment.id,
        },
        PromptPart::BoardRef {
            uri: "jam://fixture".into(),
            label: "Context".into(),
            text: "Same board context".into(),
        },
    ];
    manager
        .prompt(SendAgentPromptInput {
            session_id: view.id.clone(),
            content: parts,
        })
        .await
        .unwrap();
    let s = manager.get(&view.id).unwrap();
    wait_retry(&s, ended).await;
    assert!(events(&s).iter().any(
        |e| matches!(&e.event,AgentEventKind::AgentMessageDelta{text,..} if text=="Failed partial")
    ));
    manager.retry(&view.id).await.unwrap();
    wait_retry(&s, |e| {
        e.iter()
            .filter(|e| matches!(e.event, AgentEventKind::TurnEnd { .. }))
            .count()
            == 2
    })
    .await;
    server.requests.recv().await.unwrap();
    let original = server.requests.recv().await.unwrap().body;
    let failed = server.requests.recv().await.unwrap().body;
    let retried = server.requests.recv().await.unwrap().body;
    assert_eq!(failed, retried);
    let all = retried.to_string();
    assert!(!all.contains("Failed partial"));
    assert!(all.contains("Same attachment"));
    assert!(all.contains("Same board context"));
    assert_eq!(original["messages"][1], retried["messages"][1]);
    let disk = manager
        .history_events(&fixture.board.data_dir, &fixture.board.project_id, &view.id)
        .unwrap();
    assert!(
        disk.iter()
            .any(|e| matches!(e.event, AgentEventKind::Retrying { attempt: 1, .. }))
    );
    assert!(disk.iter().any(|e| matches!(
        e.event,
        AgentEventKind::Error {
            code: Some(AgentErrorCode::Overloaded),
            ..
        }
    )));
    assert_eq!(
        disk.iter()
            .filter(|e| matches!(e.event, AgentEventKind::UserMessage { .. }))
            .count(),
        1
    );
    assert!(
        !serde_json::to_string(&transcript_messages(&disk))
            .unwrap()
            .contains("Failed partial")
    );
    manager.stop(&view.id).await.unwrap();
}
#[tokio::test]
async fn api_network_stream_failure_retries_only_before_output() {
    for started in [false, true] {
        let mut replies = vec![HttpReply {
            retry_after: None,
            status: 200,
            chunks: if started {
                vec![format!("data: {}\n\n", delta("Lost stream"))]
            } else {
                vec![]
            },
            hold: false,
        }];
        if !started {
            replies.push(HttpReply::stream(vec![delta("Recovered"), end("stop")]));
        }
        let server = FakeHttp::new(replies).await;
        let s = session(SessionStatus::Starting);
        prompt_fixture(&s, &server, Arc::new(FakeTools::default())).await;
        wait_retry(&s, ended).await;
        if started {
            assert!(retry_events(&s).is_empty());
            assert!(events(&s).iter().any(|e| matches!(
                e.event,
                AgentEventKind::Error {
                    code: Some(AgentErrorCode::Network),
                    retryable: true,
                    ..
                }
            )));
        } else {
            assert_eq!(retry_events(&s), [(2, 3, 2000, AgentErrorCode::Network)]);
        }
        s.connector().unwrap().stop().await.unwrap();
    }
}
