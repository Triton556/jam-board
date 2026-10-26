use super::*;
use crate::tests::{events, session};
use std::sync::Mutex;

#[tokio::test]
async fn acp_retry_sends_same_content_context_and_attachment_without_auto_retry() {
    let s = session(SessionStatus::Starting);
    let (history, mut record) = crate::history_tests::history(&s);
    record.entry.kind = HistoryKind::Acp;
    *s.history_writer.lock().unwrap() = history.create(record).unwrap();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let requests = captured.clone();
    let agent = sdk::Agent
        .builder()
        .on_receive_request(
            async move |_request: a::InitializeRequest,
                        reply: sdk::Responder<a::InitializeResponse>,
                        _cx| {
                reply.respond(a::InitializeResponse::new(ProtocolVersion::V1))
            },
            sdk::on_receive_request!(),
        )
        .on_receive_request(
            async move |_request: a::NewSessionRequest,
                        reply: sdk::Responder<a::NewSessionResponse>,
                        _cx| {
                reply.respond(a::NewSessionResponse::new("retry-fixture"))
            },
            sdk::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: a::PromptRequest,
                        reply: sdk::Responder<a::PromptResponse>,
                        _cx| {
                let count = {
                    let mut requests = requests.lock().unwrap();
                    requests.push(serde_json::to_value(request.prompt).unwrap());
                    requests.len()
                };
                if count == 1 {
                    let mut error = sdk::Error::internal_error()
                        .data(json!({"status":529,"retryAfterMs":50,"provider":"fixture"}));
                    error.message = "Model at capacity fake-secret-for-tests".into();
                    reply.respond_with_error(error)
                } else {
                    reply.respond(a::PromptResponse::new(a::StopReason::EndTurn))
                }
            },
            sdk::on_receive_request!(),
        );
    let (tx, rx) = mpsc::unbounded_channel();
    let (ready, ready_rx) = oneshot::channel();
    let runtime = s.clone();
    let task = tokio::spawn(async move { run_connection(runtime, agent, vec![], rx, ready).await });
    let (_done_tx, done) = tokio::sync::watch::channel(false);
    *s.connector.lock().unwrap() = Some(Arc::new(AcpConnector {
        tx: tx.clone(),
        stop: s.stop.clone(),
        done,
    }));
    tokio::time::timeout(Duration::from_secs(5), async {
        ready_rx.await.unwrap().unwrap();
        assert!(s.connector().unwrap().retry().await.is_err());
        let attachment = crate::attachments::add(
            &s,
            AttachmentSource::Bytes {
                name: "context.txt".into(),
                mime_type: "text/plain".into(),
                data: "U2FtZSBhdHRhY2htZW50".into(),
            },
        )
        .unwrap();
        s.connector()
            .unwrap()
            .prompt(vec![
                PromptPart::Text {
                    text: "Original user text".into(),
                },
                PromptPart::Attachment {
                    attachment_id: attachment.id,
                },
                PromptPart::BoardRef {
                    uri: "jam://fixture".into(),
                    label: "Fixture".into(),
                    text: "Original board context".into(),
                },
            ])
            .await
            .unwrap();
        loop {
            if s.view().status == SessionStatus::Ready
                && events(&s).iter().any(|e| {
                    matches!(
                        e.event,
                        AgentEventKind::Error {
                            code: Some(AgentErrorCode::Overloaded),
                            ..
                        }
                    )
                })
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(captured.lock().unwrap().len(), 1, "ACP must not auto-retry");
        assert!(events(&s).iter().any(|e| matches!(
            e.event,
            AgentEventKind::Error {
                retryable: true,
                retry_after_ms: Some(50),
                ..
            }
        )));
        assert!(
            !serde_json::to_string(&events(&s))
                .unwrap()
                .contains("fake-secret-for-tests")
        );
        s.connector().unwrap().retry().await.unwrap();
        loop {
            if s.view().status == SessionStatus::Ready && captured.lock().unwrap().len() == 2 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let requests = captured.lock().unwrap();
        assert_eq!(requests[0], requests[1]);
        let text = requests[1].to_string();
        assert!(text.contains("context.txt"));
        assert!(text.contains("file:"));
        assert!(text.contains("Original board context"));
        assert!(text.contains("read jam://guide first"));
        let disk = history.events(&s.view().id).unwrap();
        assert!(disk.iter().any(|e| matches!(
            e.event,
            AgentEventKind::Retrying {
                attempt: 1,
                max_attempts: 1,
                delay_ms: 0,
                ..
            }
        )));
        assert!(disk.iter().any(|e| matches!(
            e.event,
            AgentEventKind::Error {
                code: Some(AgentErrorCode::Overloaded),
                ..
            }
        )));
    })
    .await
    .expect("ACP retry timed out");
    task.abort();
    let _ = task.await;
}
