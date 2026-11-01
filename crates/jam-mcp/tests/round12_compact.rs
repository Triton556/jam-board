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

async fn call(
    client: &RunningService<RoleClient, ClientConfig>,
    name: &str,
    args: Value,
) -> CallToolResult {
    client
        .call_tool(
            CallToolRequestParams::new(name.to_owned())
                .with_arguments(args.as_object().unwrap().clone()),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn compact_writes_projection_optional_reads_and_enum_errors_use_real_mcp_transport() {
    let d = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(d.path().join("fictional.db")).unwrap());
    store
        .create_jam("MCP compact", None, None, None, "UTC", "Human")
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
        Implementation::new("r12-contract-fixture", "1"),
    )
    .serve(transport)
    .await
    .unwrap();
    let context = call(&client, "get_session_context", json!({}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(context["serverVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(context["schemaVersion"], 10);
    assert!(
        context["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("compact.v1"))
    );
    let resources = client.list_all_resources().await.unwrap();
    for name in ["plan_epic", "work_on_next_task"] {
        let uri = format!("jam://prompts/{name}");
        assert!(resources.iter().any(|r| r.uri == uri));
        let resource = client
            .read_resource(ReadResourceRequestParams::new(uri))
            .await
            .unwrap();
        let resource = serde_json::to_value(&resource).unwrap();
        let resource = resource["contents"][0]["text"].as_str().unwrap();
        let prompt = client
            .get_prompt(GetPromptRequestParams::new(name).with_arguments(
                serde_json::Map::from_iter([
                    ("epicKey".into(), json!("{epicKey}")),
                    ("tag".into(), json!("{tag}")),
                ]),
            ))
            .await
            .unwrap();
        let prompt = serde_json::to_value(&prompt).unwrap();
        let prompt = prompt["messages"][0]["content"]["text"].as_str().unwrap();
        assert_eq!(resource.split("\n\nArguments:").next().unwrap(), prompt);
        assert_eq!(
            resource
                .lines()
                .filter(|l| l.starts_with("Arguments:"))
                .count(),
            1
        );
    }
    let epic = call(
        &client,
        "create_epic",
        json!({"requestId":"e-1","externalRef":"ls/e1","title":"Epic"}),
    )
    .await;
    assert_ne!(epic.is_error, Some(true));
    let epic = epic.structured_content.unwrap();
    assert_eq!(epic["kind"], "epic");
    assert!(epic.get("title").is_none());
    let replay = call(
        &client,
        "create_epic",
        json!({"requestId":"e-1","externalRef":"ls/e1","title":"Epic"}),
    )
    .await
    .structured_content
    .unwrap();
    assert_eq!(replay["key"], epic["key"]);
    assert_eq!(replay["replayed"], true);
    let story = call(
        &client,
        "create_story",
        json!({"requestId":"s-1","title":"Story","epicKey":epic["key"]}),
    )
    .await
    .structured_content
    .unwrap();
    let task=call(&client,"create_task",json!({"requestId":"t-1","title":"Task","storyKey":story["key"],"externalRef":"ls/t1","tags":["size-M","design","alpha"]})).await;
    assert_ne!(task.is_error, Some(true));
    let task = task.structured_content.unwrap();
    for field in ["id", "key", "updatedAt", "claimGeneration", "status"] {
        assert!(task.get(field).is_some(), "missing {field}");
    }
    assert!(task.get("brief").is_none());
    assert!(task.get("descriptionMd").is_none());
    let page = call(
        &client,
        "list_tasks",
        json!({"externalRef":"ls/t1","fields":["title","status"]}),
    )
    .await
    .structured_content
    .unwrap();
    assert_eq!(
        page["tasks"][0],
        json!({"key":task["key"],"title":"Task","status":"backlog"})
    );
    let read = call(&client, "get_task", json!({"key":task["key"]}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(read["tags"], json!(["size-m", "design", "alpha"]));
    assert!(read.get("reports").is_none());
    assert!(read.get("comments").is_none());
    let expanded = call(
        &client,
        "get_task",
        json!({"key":task["key"],"include":["reports","comments"]}),
    )
    .await
    .structured_content
    .unwrap();
    assert_eq!(expanded["reports"], json!([]));
    assert_eq!(expanded["comments"], json!([]));
    let default_epic = call(&client, "get_epic", json!({"key":epic["key"]}))
        .await
        .structured_content
        .unwrap();
    assert!(default_epic.get("journal").is_none());
    assert_eq!(default_epic["stories"].as_array().unwrap().len(), 1);
    let find = call(&client, "find", json!({"externalRefs":["ls/t1"]}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(find.as_array().unwrap().len(), 1);
    assert_eq!(find[0]["claimGeneration"], task["claimGeneration"]);
    let invalid = call(
        &client,
        "create_epic",
        json!({"requestId":"bad-color","title":"Bad","color":"m7"}),
    )
    .await;
    assert_eq!(invalid.is_error, Some(true));
    let invalid = invalid.structured_content.unwrap();
    assert_eq!(invalid["field"], "color");
    for value in ["m1", "m2", "m3", "m4", "m5", "m6"] {
        assert!(invalid["message"].as_str().unwrap().contains(value));
    }
    let missing = call(
        &client,
        "create_task",
        json!({"title":"Missing request","storyKey":story["key"]}),
    )
    .await;
    assert_eq!(missing.is_error, Some(true));
    assert!(
        context["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("import.v1"))
    );
    assert!(
        context["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("idempotency.all"))
    );
    let imported=call(&client,"import_plan",json!({"requestId":"transport-import","epics":[{"externalRef":"transport-e","title":"Imported"}]})).await;
    assert_ne!(imported.is_error, Some(true));
    let imported = imported.structured_content.unwrap();
    assert_eq!(imported["counts"]["created"], 1);
    assert_eq!(imported["noChanges"], false);
    let history = call(&client, "list_import_batches", json!({"limit":1}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(history[0]["batchId"], imported["batchId"]);
    assert_eq!(history[0]["source"], "mcp");
    let event = store
        .list_changes_since(0, None)
        .unwrap()
        .into_iter()
        .find(|e| e.action == "import_applied")
        .unwrap();
    assert_eq!(event.client.as_deref(), Some("r12-contract-fixture/1"));
    let undone = call(
        &client,
        "undo_import",
        json!({"requestId":"transport-undo","batchId":imported["batchId"]}),
    )
    .await;
    assert_ne!(undone.is_error, Some(true));
    assert_eq!(undone.structured_content.unwrap()["undone"], 1);
    let twice = call(
        &client,
        "undo_import",
        json!({"requestId":"transport-undo-again","batchId":imported["batchId"]}),
    )
    .await;
    assert_eq!(twice.is_error, Some(true));
    assert_eq!(twice.structured_content.unwrap()["code"], "already_undone");
    let invalid=call(&client,"import_plan",json!({"requestId":"invalid-import-color","epics":[{"externalRef":"bad","title":"Bad","color":"m7"}]})).await;
    assert_eq!(invalid.is_error, Some(true));
    assert_eq!(
        invalid.structured_content.unwrap()["field"],
        "epics[0].color"
    );
    client.cancel().await.unwrap();
    server.stop().await;
}

#[tokio::test]
async fn client_identity_mapping_and_activity_client_keep_the_raw_session_name() {
    let d = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(d.path().join("fictional.db")).unwrap());
    store
        .create_jam("Identity", None, None, None, "UTC", "Human")
        .unwrap();
    let bearer = token(d.path()).unwrap();
    let server = start_http(
        store.clone(),
        bearer.clone(),
        Arc::new(Mutex::new(Default::default())),
    )
    .await
    .unwrap();
    for (name, header, expected) in [
        ("claude-import-script", None, "claude-import-script"),
        ("claude-code", None, "Claude"),
        (
            "claude-import-script",
            Some("Header custom"),
            "Header custom",
        ),
        ("claude-code", Some("Header Claude"), "Header Claude"),
    ] {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
        if let Some(header) = header {
            headers.insert("X-Jam-Agent", header.parse().unwrap());
        }
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
            Implementation::new(name, "v12"),
        )
        .serve(transport)
        .await
        .unwrap();
        let result=call(&client,"create_epic",json!({"title":format!("Identity {name} {expected}"),"requestId":format!("identity-{expected}")})).await;
        assert_ne!(result.is_error, Some(true));
        let epic = result.structured_content.unwrap();
        let actor = store
            .list_members()
            .unwrap()
            .into_iter()
            .find(|m| m.member.name == expected)
            .unwrap()
            .member;
        let event = store
            .list_changes_since(0, None)
            .unwrap()
            .into_iter()
            .find(|e| e.action == "epic.created" && e.epic_id.as_deref() == epic["id"].as_str())
            .unwrap();
        assert_eq!(event.actor.id, actor.id);
        assert_eq!(
            event.client.as_deref(),
            Some(format!("{name}/v12").as_str())
        );
        client.cancel().await.unwrap();
    }
    server.stop().await;
}
