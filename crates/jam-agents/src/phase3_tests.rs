//! BC12–BC15: phase-3 backend contracts, independent of UI/provider access.
use crate::tests::{MemoryCredentials, directory, events, session};
use crate::*;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
fn add(s: &crate::session::Session, name: &str, mime: &str, data: &[u8]) -> AttachmentView {
    crate::attachments::add(
        s,
        AttachmentSource::Bytes {
            name: name.into(),
            mime_type: mime.into(),
            data: crate::attachments::encode(data),
        },
    )
    .unwrap()
}
fn part(a: &AttachmentView) -> PromptPart {
    PromptPart::Attachment {
        attachment_id: a.id.clone(),
    }
}
#[test]
fn bc12_acp_categories_descriptions_groups_boolean_and_current_values() {
    let s = session(SessionStatus::Ready);
    crate::acp::emit_config(
        &s,
        json!([
        {"id":"model-id","name":"Model","type":"select","category":"model","description":"Choose model","currentValue":"m","options":[{"name":"Group","options":[{"value":"m","name":"Model M","description":"Model detail"}]}]},
        {"id":"effort","name":"Effort","type":"select","category":"thought_level","currentValue":"high","options":[{"value":"high","name":"High"}]},
        {"id":"fast","name":"Fast","type":"boolean","category":"model_config","description":"Fast detail","currentValue":true},
        {"id":"mode","name":"Mode","type":"select","category":"mode","currentValue":"plan","options":[{"value":"plan","name":"Plan","description":"Read and plan"}]}
        ]),
    );
    let inner = s.inner.lock().unwrap();
    assert_eq!(inner.view.model.as_deref(), Some("m"));
    assert_eq!(inner.view.effort.as_deref(), Some("high"));
    assert_eq!(inner.config["model-id"].category.as_deref(), Some("model"));
    assert_eq!(
        inner.config["model-id"].description.as_deref(),
        Some("Choose model")
    );
    assert_eq!(
        inner.config["model-id"].values[0].description.as_deref(),
        Some("Model detail")
    );
    assert_eq!(
        inner.config["fast"].category.as_deref(),
        Some("model_config")
    );
    assert_eq!(inner.config["fast"].value, "true");
    assert_eq!(
        inner.config["mode"].values[0].description.as_deref(),
        Some("Read and plan")
    );
}
#[test]
fn bc13_attachment_acp_capability_mapping_and_echo_retention() {
    for images in [false, true] {
        for embedded in [false, true] {
            let s = session(SessionStatus::Ready);
            {
                let mut i = s.inner.lock().unwrap();
                i.view.capabilities.images = images;
                i.view.capabilities.embedded_context = embedded;
            }
            let image = add(&s, "photo.png", "image/png", b"fictional image");
            let text = add(&s, "notes.md", "text/plain", b"hello");
            let pdf = add(&s, "file.pdf", "application/pdf", b"fictional pdf");
            assert!(image.thumbnail.as_ref().unwrap().len() <= 64 * 1024);
            assert!(std::path::Path::new(&image.path).exists());
            let content = vec![part(&image), part(&text), part(&pdf)];
            let blocks = crate::acp::prepare_prompt(&s, content.clone()).unwrap();
            let blocks = serde_json::to_value(blocks).unwrap();
            assert_eq!(
                blocks[1]["type"],
                if images { "image" } else { "resource_link" }
            );
            assert_eq!(
                blocks[2]["type"],
                if embedded {
                    "resource"
                } else {
                    "resource_link"
                }
            );
            assert_eq!(blocks[3]["type"], "resource_link");
            assert!(blocks[3]["uri"].as_str().unwrap().starts_with("file:///"));
            assert_eq!(blocks[3]["size"], 13);
            assert!(events(&s).iter().any(
                |e| matches!(&e.event,AgentEventKind::UserMessage{content:c,..} if *c==content)
            ));
            assert!(crate::attachments::remove(&s, &image.id).is_err());
        }
    }
}
#[test]
fn bc13_api_attachment_refusals_preserve_ready_and_draft_then_text_and_vision() {
    let s = session(SessionStatus::Ready);
    s.inner.lock().unwrap().view.kind = RuntimeKind::Api;
    let image = add(&s, "photo.png", "image/png", b"image");
    let pdf = add(&s, "file.pdf", "application/pdf", b"pdf");
    let err = crate::acp::prepare_prompt(&s, vec![part(&image)])
        .unwrap_err()
        .to_string();
    assert_eq!(err, "This model can't see images — pick a vision model");
    assert_eq!(s.view().status, SessionStatus::Ready);
    assert!(events(&s).is_empty());
    assert_eq!(
        crate::acp::prepare_prompt(&s, vec![part(&pdf)])
            .unwrap_err()
            .to_string(),
        "Not supported in API chat — use an agent connection"
    );
    assert!(!s.inner.lock().unwrap().attachments[&pdf.id].1);
    crate::attachments::remove(&s, &pdf.id).unwrap();
    assert!(!std::path::Path::new(&pdf.path).exists());
    s.inner.lock().unwrap().view.capabilities.images = true;
    let text = add(&s, "note.txt", "text/plain", b"my text");
    let blocks = crate::acp::prepare_prompt(&s, vec![part(&image), part(&text)]).unwrap();
    let blocks = serde_json::to_value(blocks).unwrap();
    assert_eq!(blocks[1]["type"], "image");
    assert!(blocks[2]["text"].as_str().unwrap().contains("note.txt"));
    assert!(blocks[2]["text"].as_str().unwrap().contains("my text"));
}
#[test]
fn bc13_attachment_limits_are_checked_before_running_or_echoing() {
    let s = session(SessionStatus::Ready);
    let a = add(&s, "note.txt", "text/plain", b"x");
    assert!(
        crate::acp::prepare_prompt(&s, vec![part(&a); 11])
            .unwrap_err()
            .to_string()
            .contains("10 files")
    );
    {
        s.inner
            .lock()
            .unwrap()
            .attachments
            .get_mut(&a.id)
            .unwrap()
            .0
            .size = 18 * 1024 * 1024;
    }
    std::fs::OpenOptions::new()
        .write(true)
        .open(&a.path)
        .unwrap()
        .set_len(18 * 1024 * 1024)
        .unwrap();
    assert!(
        crate::acp::prepare_prompt(&s, vec![part(&a); 3])
            .unwrap_err()
            .to_string()
            .contains("50 MB")
    );
    assert_eq!(s.view().status, SessionStatus::Ready);
    assert!(events(&s).is_empty());
    assert!(s.inner.lock().unwrap().first_prompt);
    let path = s.board.data_dir.join("large.bin");
    let f = std::fs::File::create(&path).unwrap();
    f.set_len(20 * 1024 * 1024 + 1).unwrap();
    assert!(
        crate::attachments::add(
            &s,
            AttachmentSource::Path {
                path: path.to_string_lossy().into()
            }
        )
        .unwrap_err()
        .to_string()
        .contains("20 MB")
    );
    assert!(
        crate::acp::prepare_prompt(
            &s,
            vec![PromptPart::Attachment {
                attachment_id: "../other-session".into()
            }]
        )
        .is_err()
    );
}
#[test]
fn bc14_effort_styles_match_contract_and_omit_auto_none_nonreasoning() {
    for (style, effort, expected) in [
        (
            EffortStyle::Openrouter,
            "high",
            json!({"reasoning":{"effort":"high"}}),
        ),
        (
            EffortStyle::Openai,
            "low",
            json!({"reasoning_effort":"low"}),
        ),
        (
            EffortStyle::Zai,
            "enabled",
            json!({"thinking":{"type":"enabled"}}),
        ),
        (
            EffortStyle::Zai,
            "disabled",
            json!({"thinking":{"type":"disabled"}}),
        ),
    ] {
        let mut body = json!({});
        crate::api::apply_effort(&mut body, style, Some(effort), true);
        assert_eq!(body, expected);
        for (effort, reasoning) in [(Some("auto"), true), (None, true), (Some(effort), false)] {
            let mut b = json!({});
            crate::api::apply_effort(&mut b, style, effort, reasoning);
            assert_eq!(b, json!({}));
        }
    }
    let mut b = json!({});
    crate::api::apply_effort(&mut b, EffortStyle::None, Some("high"), true);
    assert_eq!(b, json!({}));
}
#[test]
fn bc14_profile_effort_defaults_migration_patch_and_provider_model_override() {
    let root = directory();
    let store = Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap());
    let profiles = Profiles::new(store.clone(), Arc::new(MemoryCredentials::default()));
    assert_eq!(
        profiles.get("api-openrouter").unwrap().effort_style,
        EffortStyle::Openrouter
    );
    assert_eq!(
        profiles.get("api-zai").unwrap().effort_style,
        EffortStyle::Zai
    );
    assert_eq!(
        profiles.get("api-custom").unwrap().effort_style,
        EffortStyle::None
    );
    let mut profile = profiles.get("claude-openrouter").unwrap();
    profile.model = Some("provider/new-model".into());
    assert!(
        profiles
            .child_env(&profile)
            .unwrap()
            .iter()
            .any(|e| e.name == "ANTHROPIC_MODEL" && e.value == "provider/new-model")
    );
    let p=profiles.save(serde_json::from_value(json!({"id":"api-openrouter","label":"OR","kind":"api","effort":"high","effortStyle":"openai"})).unwrap()).unwrap();
    assert_eq!(p.effort.as_deref(), Some("high"));
    assert_eq!(p.effort_style, EffortStyle::Openai);
    let p = profiles
        .save(
            serde_json::from_value(
                json!({"id":"api-openrouter","label":"OR","kind":"api","effort":null}),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(p.effort, None);
    let mut old = serde_json::to_value(profiles.get("api-openrouter").unwrap()).unwrap();
    old.as_object_mut().unwrap().remove("effortStyle");
    old.as_object_mut().unwrap().remove("effort");
    store
        .set_setting("agent_profiles", &json!([old]).to_string())
        .unwrap();
    assert_eq!(
        profiles.get("api-openrouter").unwrap().effort_style,
        EffortStyle::Openrouter
    );
}
async fn stub(
    responses: Vec<(u16, Value)>,
) -> (
    String,
    tokio::sync::mpsc::UnboundedReceiver<String>,
    tokio::task::JoinHandle<()>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let task = tokio::spawn(async move {
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut b = [0; 1024];
            loop {
                let n = socket.read(&mut b).await.unwrap();
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&b[..n]);
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            tx.send(String::from_utf8(bytes).unwrap()).unwrap();
            let body = body.to_string();
            let reply = format!(
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(reply.as_bytes()).await.unwrap();
        }
    });
    (url, rx, task)
}
#[tokio::test]
async fn bc15_catalog_stub_parsing_auth_cache_refresh_expiry_fallback_and_secrets() {
    let root = directory();
    let profiles = Profiles::new(
        Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap()),
        Arc::new(MemoryCredentials::default()),
    );
    let provider = json!({"data":[{"id":"vision-reason","name":"Vision","context_length":128000,"supported_parameters":["tools","reasoning"],"architecture":{"input_modalities":["text","image"]},"pricing":{"prompt":"0.000002","completion":"0.000008"}},{"id":"no-tools","supported_parameters":[],"architecture":{"input_modalities":["text"]}}]});
    let (url, mut requests, task) = stub(vec![
        (200, provider.clone()),
        (200, provider.clone()),
        (200, provider.clone()),
        (401, json!({"error":"fake-secret-for-tests"})),
    ])
    .await;
    profiles
        .save(AgentProfileInput {
            id: Some("api-openrouter".into()),
            label: "Stub".into(),
            kind: RuntimeKind::Api,
            base_url: Some(Some(url)),
            ..Default::default()
        })
        .unwrap();
    profiles
        .set_secret("api-openrouter", "API_KEY", "fake-secret-for-tests")
        .unwrap();
    let input = || AgentModelCatalogInput {
        profile_id: "api-openrouter".into(),
        refresh: Some(false),
    };
    let c = crate::catalog::load(&profiles, &root, input())
        .await
        .unwrap();
    let request = requests.recv().await.unwrap();
    assert!(request.starts_with("GET /v1/models "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer fake-secret-for-tests")
    );
    assert_eq!(c.models.len(), 2);
    let m = &c.models[0];
    assert!(m.tools && m.reasoning && m.input_image);
    assert_eq!(m.context_length, Some(128000));
    assert_eq!(m.prompt_price_per_m.as_deref(), Some("2"));
    assert_eq!(m.completion_price_per_m.as_deref(), Some("8"));
    assert!(!c.models[1].tools);
    crate::catalog::load(&profiles, &root, input())
        .await
        .unwrap();
    assert!(requests.try_recv().is_err());
    let mut refresh = input();
    refresh.refresh = Some(true);
    crate::catalog::load(&profiles, &root, refresh.clone())
        .await
        .unwrap();
    requests.recv().await.unwrap();
    let path = std::fs::read_dir(root.join("agent-model-catalog"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut expired = c.clone();
    expired.fetched_at = Some("2020-01-01T00:00:00Z".into());
    assert!(!crate::catalog::fresh(&expired));
    std::fs::write(&path, serde_json::to_vec(&expired).unwrap()).unwrap();
    crate::catalog::load(&profiles, &root, input())
        .await
        .unwrap();
    requests.recv().await.unwrap();
    let fallback = crate::catalog::load(&profiles, &root, refresh)
        .await
        .unwrap();
    requests.recv().await.unwrap();
    assert!(fallback.error.is_some());
    assert_eq!(fallback.models.len(), 2);
    assert!(
        !serde_json::to_string(&fallback)
            .unwrap()
            .contains("fake-secret-for-tests")
    );
    assert!(
        !std::fs::read_to_string(path)
            .unwrap()
            .contains("fake-secret-for-tests")
    );
    task.await.unwrap();
}
#[tokio::test]
async fn bc15_catalog_zai_static_custom_profile_and_provider_secret_redaction() {
    let root = directory();
    let profiles = Profiles::new(
        Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap()),
        Arc::new(MemoryCredentials::default()),
    );
    let (url, mut requests, task) = stub(vec![
        (500, json!({})),
        (500, json!({})),
        (
            200,
            json!({"data":[{"id":"x","name":"echo fake-secret-for-tests"}]}),
        ),
    ])
    .await;
    for id in ["api-zai", "api-custom"] {
        profiles
            .save(AgentProfileInput {
                id: Some(id.into()),
                label: "Stub".into(),
                kind: RuntimeKind::Api,
                base_url: Some(Some(url.clone())),
                model: Some(Some("saved-model".into())),
                ..Default::default()
            })
            .unwrap();
        profiles
            .set_secret(id, "API_KEY", "fake-secret-for-tests")
            .unwrap();
        let c = crate::catalog::load(
            &profiles,
            &root,
            AgentModelCatalogInput {
                profile_id: id.into(),
                refresh: Some(true),
            },
        )
        .await
        .unwrap();
        assert!(c.models.iter().any(|m| m.id == "saved-model"));
        assert!(c.error.is_some());
        assert!(matches!(
            (&c.source, id),
            (CatalogSource::Static, "api-zai") | (CatalogSource::Profile, "api-custom")
        ));
        requests.recv().await.unwrap();
    }
    let c = crate::catalog::load(
        &profiles,
        &root,
        AgentModelCatalogInput {
            profile_id: "api-custom".into(),
            refresh: Some(true),
        },
    )
    .await
    .unwrap();
    assert_eq!(c.models[0].name, "echo [REDACTED]");
    requests.recv().await.unwrap();
    task.await.unwrap();
}

#[tokio::test]
async fn bc12_acp_set_config_routes_all_categories_with_original_ids() {
    use agent_client_protocol::{
        self as sdk,
        schema::{ProtocolVersion, v1 as a},
    };
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
    let s = session(SessionStatus::Starting);
    let options = Arc::new(std::sync::Mutex::new(json!([
    {"id":"model-id","category":"model","name":"Model","type":"select","currentValue":"m0","options":[{"value":"m0","name":"M0"},{"value":"m1","name":"M1"}]},
    {"id":"effort-id","category":"thought_level","name":"Effort","type":"select","currentValue":"low","options":[{"value":"low","name":"Low"},{"value":"high","name":"High"}]},
    {"id":"permission-id","category":"mode","name":"Access","type":"select","currentValue":"plan","options":[{"value":"plan","name":"Plan"},{"value":"default","name":"Default"}]},
    {"id":"vendor-id","category":"vendor","name":"Extra","type":"select","currentValue":"a","options":[{"value":"a","name":"A"},{"value":"b","name":"B"}]}
    ])));
    let initial = options.clone();
    let updates = options.clone();
    let agent = sdk::Agent
        .builder()
        .on_receive_request(
            async move |_: a::InitializeRequest,
                        reply: sdk::Responder<a::InitializeResponse>,
                        _cx| {
                reply.respond(a::InitializeResponse::new(ProtocolVersion::V1))
            },
            sdk::on_receive_request!(),
        )
        .on_receive_request(
            async move |_: a::NewSessionRequest,
                        reply: sdk::Responder<a::NewSessionResponse>,
                        _cx| {
                let options: Vec<a::SessionConfigOption> =
                    serde_json::from_value(initial.lock().unwrap().clone()).unwrap();
                reply.respond(a::NewSessionResponse::new("test").config_options(options))
            },
            sdk::on_receive_request!(),
        )
        .on_receive_request(
            async move |r: a::SetSessionConfigOptionRequest,
                        reply: sdk::Responder<a::SetSessionConfigOptionResponse>,
                        _cx| {
                let mut options = updates.lock().unwrap();
                let id = r.config_id.to_string();
                let item = options
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|v| v["id"] == id)
                    .unwrap();
                item["currentValue"] = json!(r.value.as_value_id().unwrap().to_string());
                reply.respond(a::SetSessionConfigOptionResponse::new(
                    serde_json::from_value(options.clone()).unwrap(),
                ))
            },
            sdk::on_receive_request!(),
        );
    let (client, server) = tokio::io::duplex(64 * 1024);
    let (cr, cw) = tokio::io::split(client);
    let (sr, sw) = tokio::io::split(server);
    let agent_task = tokio::spawn(async move {
        agent
            .connect_to(sdk::ByteStreams::new(sw.compat_write(), sr.compat()))
            .await
    });
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let (ready, received) = tokio::sync::oneshot::channel();
    let client_session = s.clone();
    let task = tokio::spawn(async move {
        crate::acp::run_connection(
            client_session,
            sdk::ByteStreams::new(cw.compat_write(), cr.compat()),
            vec![],
            rx,
            ready,
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        received.await.unwrap().unwrap();
        for (id, value) in [
            ("model-id", "m1"),
            ("effort-id", "high"),
            ("permission-id", "default"),
            ("vendor-id", "b"),
        ] {
            let (reply, received) = tokio::sync::oneshot::channel();
            tx.send(crate::session::Control::Config(
                id.into(),
                value.into(),
                reply,
            ))
            .unwrap();
            received.await.unwrap().unwrap();
            assert_eq!(s.inner.lock().unwrap().config[id].value, value);
        }
        assert_eq!(s.view().model.as_deref(), Some("m1"));
        assert_eq!(s.view().effort.as_deref(), Some("high"));
    })
    .await
    .unwrap();
    drop(tx);
    task.abort();
    agent_task.abort();
    let _ = task.await;
    let _ = agent_task.await;
}
#[test]
fn bc13_oversized_text_falls_back_to_link_and_base64_padding_is_checked() {
    let s = session(SessionStatus::Ready);
    s.inner.lock().unwrap().view.capabilities.embedded_context = true;
    let a = add(&s, "large.txt", "text/plain", &vec![b'x'; 256 * 1024 + 1]);
    let blocks =
        serde_json::to_value(crate::acp::prepare_prompt(&s, vec![part(&a)]).unwrap()).unwrap();
    assert_eq!(blocks[1]["type"], "resource_link");
    let s = session(SessionStatus::Ready);
    for bad in ["A", "A===", "!!!!", "AB==", "AAB="] {
        assert!(
            crate::attachments::add(
                &s,
                AttachmentSource::Bytes {
                    name: "bad".into(),
                    mime_type: "text/plain".into(),
                    data: bad.into()
                }
            )
            .is_err()
        );
    }
    let a = add(&s, "copied.txt", "text/plain", b"x");
    std::fs::write(&a.path, "modified after copy").unwrap();
    assert!(
        crate::acp::prepare_prompt(&s, vec![part(&a)])
            .unwrap_err()
            .to_string()
            .contains("Attachment changed")
    );
    assert_eq!(s.view().status, SessionStatus::Ready);
}
#[tokio::test]
async fn bc15_openrouter_without_key_and_custom_recents_fallback() {
    let root = directory();
    let profiles = Profiles::new(
        Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap()),
        Arc::new(MemoryCredentials::default()),
    );
    let (url, mut requests, task) = stub(vec![
        (
            200,
            json!({"data":[{"id":"m","supported_parameters":["tools"]}]}),
        ),
        (500, json!({})),
    ])
    .await;
    profiles
        .save(AgentProfileInput {
            id: Some("api-openrouter".into()),
            label: "OR".into(),
            kind: RuntimeKind::Api,
            base_url: Some(Some(url.clone())),
            ..Default::default()
        })
        .unwrap();
    let c = crate::catalog::load(
        &profiles,
        &root,
        AgentModelCatalogInput {
            profile_id: "api-openrouter".into(),
            refresh: None,
        },
    )
    .await
    .unwrap();
    assert!(c.error.is_none());
    assert!(
        !requests
            .recv()
            .await
            .unwrap()
            .to_ascii_lowercase()
            .contains("authorization:")
    );
    profiles
        .save(AgentProfileInput {
            id: Some("api-custom".into()),
            label: "Custom".into(),
            kind: RuntimeKind::Api,
            base_url: Some(Some(url)),
            ..Default::default()
        })
        .unwrap();
    profiles
        .set_secret("api-custom", "API_KEY", "fake-secret-for-tests")
        .unwrap();
    crate::catalog::remember(&root, "api-custom", "recent-free-text-model").unwrap();
    let c = crate::catalog::load(
        &profiles,
        &root,
        AgentModelCatalogInput {
            profile_id: "api-custom".into(),
            refresh: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(c.models[0].id, "recent-free-text-model");
    assert!(c.error.is_some());
    requests.recv().await.unwrap();
    task.await.unwrap();
}

#[tokio::test]
async fn bc15_zai_bare_model_ids_keep_known_reasoning_and_explicit_flags_win() {
    let root = directory();
    let profiles = Profiles::new(
        Arc::new(jam_core::Store::open(root.join("jam.db")).unwrap()),
        Arc::new(MemoryCredentials::default()),
    );
    let (url, mut requests, task) = stub(vec![(
        200,
        json!({"data":[{"id":"glm-4.6"},{"id":"glm-4.5","reasoning":false},{"id":"unknown"}]}),
    )])
    .await;
    profiles
        .save(AgentProfileInput {
            id: Some("api-zai".into()),
            label: "z.ai".into(),
            kind: RuntimeKind::Api,
            base_url: Some(Some(url)),
            ..Default::default()
        })
        .unwrap();
    profiles
        .set_secret("api-zai", "API_KEY", "fake-secret-for-tests")
        .unwrap();
    let c = crate::catalog::load(
        &profiles,
        &root,
        AgentModelCatalogInput {
            profile_id: "api-zai".into(),
            refresh: None,
        },
    )
    .await
    .unwrap();
    assert!(c.models[0].reasoning);
    assert!(!c.models[1].reasoning);
    assert!(!c.models[2].reasoning);
    requests.recv().await.unwrap();
    task.await.unwrap();
}

#[derive(Default)]
pub(crate) struct PreviewMedia(
    std::sync::Mutex<std::collections::BTreeMap<String, std::path::PathBuf>>,
);
impl AttachmentMedia for PreviewMedia {
    fn grant(&self, path: &std::path::Path) -> Result<String> {
        let url = format!("asset://localhost/registered/{}", ulid::Ulid::generate());
        self.0.lock().unwrap().insert(url.clone(), path.into());
        Ok(url)
    }
    fn revoke(&self, path: &std::path::Path) -> Result<()> {
        self.0.lock().unwrap().retain(|_, p| p != path);
        Ok(())
    }
}
impl PreviewMedia {
    pub(crate) fn read(&self, url: &str) -> Result<Vec<u8>> {
        let grants = self.0.lock().unwrap();
        let path = grants
            .get(url)
            .ok_or_else(|| crate::err("Preview is not granted"))?;
        Ok(std::fs::read(path)?)
    }
}
#[test]
fn bc13_preview_urls_only_grant_images_in_the_session_folder_and_revoke_on_remove() {
    let media = Arc::new(PreviewMedia::default());
    let s = crate::tests::session_with_media(SessionStatus::Ready, Some(media.clone()));
    let small = add(&s, "small.png", "image/png", b"small image");
    assert!(small.thumbnail.is_some());
    let small_url = small.preview_url.as_deref().unwrap();
    assert_eq!(media.read(small_url).unwrap(), b"small image");
    let large_bytes = vec![7; 80 * 1024];
    let large = add(&s, "photo.jpg", "image/jpeg", &large_bytes);
    assert!(large.thumbnail.is_none());
    let url = large.preview_url.as_deref().unwrap();
    assert_eq!(media.read(url).unwrap(), large_bytes);
    let text = add(&s, "note.txt", "text/plain", b"text");
    assert!(text.preview_url.is_none());
    assert!(text.thumbnail.is_none());
    let outside = s.board.data_dir.join("private.png");
    std::fs::write(&outside, "outside attachment storage").unwrap();
    {
        let mut inner = s.inner.lock().unwrap();
        inner.attachments.get_mut(&large.id).unwrap().0.path =
            outside.to_string_lossy().into_owned();
        assert!(crate::attachments::preview_url(&s, &inner, &large.id).is_err());
        inner.attachments.get_mut(&large.id).unwrap().0 = large.clone();
    }
    let other_folder = s.board.data_dir.join("agent-attachments/other-session");
    std::fs::create_dir_all(&other_folder).unwrap();
    let other = other_folder.join("other.png");
    std::fs::write(&other, "other session").unwrap();
    {
        let mut inner = s.inner.lock().unwrap();
        inner.attachments.get_mut(&large.id).unwrap().0.path = other.to_string_lossy().into_owned();
        assert!(crate::attachments::preview_url(&s, &inner, &large.id).is_err());
        inner.attachments.get_mut(&large.id).unwrap().0 = large.clone();
    }
    crate::attachments::remove(&s, &large.id).unwrap();
    assert!(media.read(url).is_err());
    assert!(!std::path::Path::new(&large.path).exists());
    std::fs::write(&large.path, "recreated without a grant").unwrap();
    assert!(media.read(url).is_err());
    assert!(crate::attachments::preview_url(&s, &s.inner.lock().unwrap(), &large.id).is_err());
}
