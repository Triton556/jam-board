use crate::{
    session::Control,
    tests::{events, session},
    *,
};
use agent_client_protocol::{
    self as sdk,
    schema::{ProtocolVersion, v1 as a},
};
use serde_json::json;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

#[test]
fn auth_extension_maps_actual_adapter_kinds_and_preserves_labels() {
    let s = session(SessionStatus::Ready);
    for (kind, expected) in [
        ("none", "required"),
        ("account", "ok"),
        ("api_key", "ok"),
        ("gateway", "ok"),
        ("external", "ok"),
        ("future-kind", "unknown"),
    ] {
        crate::acp::map_auth_status(
            &s,
            &json!({"authStatus":{"kind":kind,"label":"Original label"}}),
        );
        let event = serde_json::to_value(events(&s).last().unwrap()).unwrap();
        assert_eq!(event["kind"], "auth");
        assert_eq!(event["state"], expected);
        assert_eq!(event["label"], "Original label");
    }
}

#[tokio::test]
async fn acp_auth_error_and_unknown_extensions_do_not_break_dispatch() {
    for new_error in [false, true] {
        let s = session(SessionStatus::Starting);
        let client_session = s.clone();
        let agent = sdk::Agent
            .builder()
            .on_receive_request(
                async move |_req: a::InitializeRequest,
                            reply: sdk::Responder<a::InitializeResponse>,
                            _cx| {
                    reply.respond(a::InitializeResponse::new(ProtocolVersion::V1))
                },
                sdk::on_receive_request!(),
            )
            .on_receive_request(
                async move |_req: a::NewSessionRequest,
                            reply: sdk::Responder<a::NewSessionResponse>,
                            cx: sdk::ConnectionTo<sdk::Client>| {
                    cx.send_notification(sdk::UntypedMessage::new(
                        "_unknown/extension",
                        json!({"ignored":true}),
                    )?)?;
                    cx.send_notification(sdk::UntypedMessage::new(
                        "_auth/status_update",
                        json!({"authStatus":{"kind":"none","label":"Not logged in"}}),
                    )?)?;
                    if new_error {
                        let mut error = a::Error::auth_required();
                        error.message = "Sign in before creating a session".into();
                        reply.respond_with_error(error)
                    } else {
                        reply.respond(a::NewSessionResponse::new("auth-test"))
                    }
                },
                sdk::on_receive_request!(),
            )
            .on_receive_request(
                async move |_req: a::PromptRequest,
                            reply: sdk::Responder<a::PromptResponse>,
                            _cx| {
                    let mut error = a::Error::auth_required();
                    error.message = "Sign in before sending a prompt".into();
                    reply.respond_with_error(error)
                },
                sdk::on_receive_request!(),
            );
        let (tx, rx) = mpsc::unbounded_channel();
        let (ready, ready_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            crate::acp::run_connection(client_session, agent, vec![], rx, ready).await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            if new_error { assert!(ready_rx.await.is_err()); }
            else {
                ready_rx.await.unwrap().unwrap(); let (reply, response) = oneshot::channel(); tx.send(Control::Prompt(vec![PromptPart::Text { text:"Hi".into() }], reply)).unwrap(); response.await.unwrap().unwrap();
                loop { if events(&s).iter().any(|e| matches!(&e.event, AgentEventKind::Auth { label, .. } if label.contains("sending a prompt"))) { break; } tokio::task::yield_now().await; }
            }
            let all = serde_json::to_value(events(&s)).unwrap(); assert!(all.as_array().unwrap().iter().any(|e| e["kind"] == "auth" && e["state"] == "required" && e["label"] == "Not logged in"));
            assert!(all.to_string().contains(if new_error { "creating a session" } else { "sending a prompt" }));
        }).await.expect("auth dispatch scenario timed out");
        drop(tx);
        task.abort();
        let _ = task.await;
    }
}
