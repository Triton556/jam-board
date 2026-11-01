use jam_core::*;
use jam_mcp::{start_http, token};
use rmcp::{
    RoleClient, ServiceExt,
    model::*,
    service::RunningService,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

async fn call(client: &RunningService<RoleClient, ClientConfig>, args: Value) -> CallToolResult {
    client
        .call_tool(
            CallToolRequestParams::new("move_story")
                .with_arguments(args.as_object().unwrap().clone()),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn story_move_schema_and_transport_preserve_optional_captured_version() {
    let tool = jam_mcp::tool_catalog()
        .into_iter()
        .find(|t| t.name == "move_story")
        .unwrap();
    let schema = serde_json::to_value(tool.input_schema).unwrap();
    assert!(schema["properties"]["expectedUpdatedAt"].is_object());
    assert!(
        !schema["required"]
            .as_array()
            .unwrap()
            .contains(&json!("expectedUpdatedAt"))
    );
    let d = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(d.path().join("fictional.db")).unwrap());
    let (_, human) = store
        .create_jam("Guard", None, None, None, "UTC", "Human")
        .unwrap();
    let from = store
        .create_epic(
            &human.id,
            NewEpic {
                title: "From".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let to = store
        .create_epic(
            &human.id,
            NewEpic {
                title: "To".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let bearer = token(d.path()).unwrap();
    let server = start_http(
        store.clone(),
        bearer.clone(),
        Arc::new(Mutex::new(Default::default())),
    )
    .await
    .unwrap();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap();
    let transport = StreamableHttpClientTransport::with_client(
        http,
        StreamableHttpClientTransportConfig::with_uri(format!(
            "http://127.0.0.1:{}/mcp",
            server.port
        )),
    );
    let client = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("r12-m-fixture", "1"),
    )
    .serve(transport)
    .await
    .unwrap();
    let context = client
        .call_tool(
            CallToolRequestParams::new("get_session_context")
                .with_arguments(serde_json::Map::new()),
        )
        .await
        .unwrap()
        .structured_content
        .unwrap();
    for capability in ["references.batch", "references.collect"] {
        assert!(
            context["capabilities"]
                .as_array()
                .unwrap()
                .contains(&json!(capability))
        );
    }
    for (index, expected) in [Some("stale"), Some("current"), None]
        .into_iter()
        .enumerate()
    {
        let story = store
            .create_story(
                &human.id,
                NewStory {
                    epic_key: from.key.clone(),
                    title: "Story".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        let mut args =
            json!({"key":story.key,"toEpicKey":to.key,"requestId":format!("guard-{index}")});
        if let Some(value) = expected {
            args["expectedUpdatedAt"] = json!(if value == "current" {
                &story.audit.updated_at
            } else {
                value
            });
        }
        let activity = store.activity_count().unwrap();
        let result = call(&client, args).await;
        if expected == Some("stale") {
            assert_eq!(result.is_error, Some(true));
            assert_eq!(
                store.get_story(&story.key).unwrap().story.epic_id,
                from.audit.id
            );
            assert_eq!(store.activity_count().unwrap(), activity);
        } else {
            assert_ne!(result.is_error, Some(true));
            assert_eq!(
                store.get_story(&story.key).unwrap().story.epic_id,
                to.audit.id
            );
        }
    }
    client.cancel().await.unwrap();
    server.stop().await;
}
