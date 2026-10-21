use jam_core::Store;
use jam_mcp::{start_http, token};
use rmcp::{
    ServiceExt,
    model::*,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[tokio::test]
async fn http_auth_origin_identity_port_and_tools() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let d = tempfile::tempdir_in(base).unwrap();
    let s = Arc::new(Store::open(d.path().join("jam.db")).unwrap());
    s.create_jam("HTTP jam", None, None, None, "UTC", "Danil")
        .unwrap();
    let bearer = token(d.path()).unwrap();
    assert_eq!(token(d.path()).unwrap(), bearer);
    assert_eq!(bearer.len(), 43);
    let blocker = tokio::net::TcpListener::bind("127.0.0.1:47321").await.ok();
    let recent = Arc::new(Mutex::new(Default::default()));
    let server = start_http(s.clone(), bearer.clone(), recent.clone())
        .await
        .unwrap();
    if blocker.is_some() {
        assert_ne!(server.port, 47321);
    }
    assert_eq!(
        s.setting("mcp_http_port").unwrap().unwrap(),
        server.port.to_string()
    );
    let url = format!("http://127.0.0.1:{}/mcp", server.port);
    let http = reqwest::Client::new();
    assert_eq!(http.post(&url).send().await.unwrap().status(), 401);
    for origin in [
        "http://evil.example:123",
        "http://localhost.evil:123",
        "null",
    ] {
        assert_eq!(
            http.post(&url)
                .bearer_auth(&bearer)
                .header("Origin", origin)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
    headers.insert("X-Jam-Agent", "Mira's Codex".parse().unwrap());
    headers.insert("Origin", "http://localhost:1420".parse().unwrap());
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap();
    let transport = StreamableHttpClientTransport::with_client(
        http,
        StreamableHttpClientTransportConfig::with_uri(url),
    );
    let client = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-http-test", "1"),
    )
    .with_protocol_version(ProtocolVersion::V_2025_06_18)
    .serve(transport)
    .await
    .unwrap();
    let mut actual = client
        .list_all_tools()
        .await
        .unwrap()
        .iter()
        .map(|t| t.name.to_string())
        .collect::<Vec<_>>();
    actual.sort();
    assert_eq!(actual.len(), 44);
    let expected: Vec<String> =
        serde_json::from_str(include_str!("fixtures/tools-v2.json")).unwrap();
    assert_eq!(actual, expected);
    let h = s.current_member().unwrap();
    let e = s
        .create_epic(
            &h.id,
            jam_core::NewEpic {
                title: "HTTP epic".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let story = s
        .create_story(
            &h.id,
            jam_core::NewStory {
                epic_key: e.key,
                title: "HTTP story".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let result = client
        .call_tool(
            CallToolRequestParams::new("create_task").with_arguments(
                serde_json::json!({"storyKey":story.key,"title":"HTTP task"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));
    let members = s.list_members().unwrap();
    let m = members
        .iter()
        .find(|m| m.member.name == "Mira's Codex")
        .unwrap();
    assert_eq!(m.member.client.as_deref(), Some("codex"));
    assert!(m.online);
    assert_eq!(m.member.color, "#E0679A");
    assert_eq!(recent.lock().unwrap().len(), 1);
    let result = client
        .call_tool(
            CallToolRequestParams::new("wait_for_changes").with_arguments(
                serde_json::json!({"cursor":0,"actorKind":"human"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));
    assert_eq!(result.structured_content.unwrap()["timedOut"], false);
    client.cancel().await.unwrap();
    server.stop().await;
    drop(blocker);
}

#[tokio::test]
async fn http_sessions_pin_the_requested_project_not_later_human_selection() {
    let d = tempfile::tempdir().unwrap();
    let s = Arc::new(Store::open(d.path().join("projects.db")).unwrap());
    let (first, h) = s
        .create_jam("HTTP first", None, None, None, "UTC", "Human")
        .unwrap();
    let (second, _) = s
        .create_jam("HTTP second", None, None, None, "UTC", "Other human")
        .unwrap();
    let bearer = token(d.path()).unwrap();
    let server = start_http(
        s.clone(),
        bearer.clone(),
        Arc::new(Mutex::new(Default::default())),
    )
    .await
    .unwrap();
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("Bearer {bearer}").parse().unwrap());
    headers.insert("X-Jam-Project", first.key_prefix.parse().unwrap());
    headers.insert("X-Jam-Agent", "Pinned HTTP worker".parse().unwrap());
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
        Implementation::new("codex-http-pin", "1"),
    )
    .serve(transport)
    .await
    .unwrap();
    let read = || {
        CallToolRequestParams::new("get_session_context")
            .with_arguments(serde_json::json!({}).as_object().unwrap().clone())
    };
    let result = client.call_tool(read()).await.unwrap();
    assert_eq!(result.structured_content.unwrap()["projectId"], first.id);
    assert_eq!(s.active_jam().unwrap().id, second.id);
    s.select_project(&first.id).unwrap();
    s.select_project(&second.id).unwrap();
    let result = client.call_tool(read()).await.unwrap();
    assert_eq!(result.structured_content.unwrap()["projectId"], first.id);
    // Agent changes still land in the pinned first project.
    let created = client
        .call_tool(
            CallToolRequestParams::new("create_epic").with_arguments(
                serde_json::json!({"title":"Pinned epic"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(created.structured_content.unwrap()["jamId"], first.id);
    assert_eq!(s.get_project().unwrap().epics, 0);
    let pinned = s.for_project(&first.id).unwrap();
    assert_eq!(pinned.get_project().unwrap().epics, 1);
    assert!(
        pinned
            .list_members()
            .unwrap()
            .iter()
            .any(|m| m.member.name == "Pinned HTTP worker")
    );
    assert!(
        s.list_members()
            .unwrap()
            .iter()
            .all(|m| m.member.name != "Pinned HTTP worker")
    );
    // Archival blocks an existing session until that exact project is restored.
    s.select_project(&first.id).unwrap();
    s.reset_jam(&h.id, &first.name).unwrap();
    let result = client.call_tool(read()).await.unwrap();
    assert_eq!(result.is_error, Some(true));
    assert_eq!(result.structured_content.unwrap()["code"], "archived");
    s.restore_project(&first.id).unwrap();
    assert_eq!(
        client
            .call_tool(read())
            .await
            .unwrap()
            .structured_content
            .unwrap()["projectId"],
        first.id
    );
    client.cancel().await.unwrap();
    server.stop().await;
}

#[tokio::test]
async fn http_start_approval_is_typed_pinned_and_pause_preserves_worker_evidence() {
    use jam_core::*;
    let d = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(d.path().join("execution.db")).unwrap());
    let (project, human) = store
        .create_jam("HTTP execution", None, None, None, "UTC", "Human")
        .unwrap();
    let pinned = store.for_project(&project.id).unwrap();
    let epic = pinned
        .create_epic(
            &human.id,
            NewEpic {
                title: "Exact epic".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let story = pinned
        .create_story(
            &human.id,
            NewStory {
                epic_key: epic.key.clone(),
                title: "Exact story".into(),
                outcome_md: Some("Verified outcome".into()),
                acceptance: Some(vec![Acceptance {
                    id: "a".into(),
                    criterion: "Correct".into(),
                    mandatory: true,
                    check: "Tests".into(),
                }]),
                ..Default::default()
            },
        )
        .unwrap();
    pinned
        .set_story_status(&human.id, &story.key, "active", None)
        .unwrap();
    let task = pinned
        .create_task(
            &human.id,
            CreateTask {
                story_key: Some(story.key.clone()),
                title: "Ready is not permission".into(),
                status: Some("ready".into()),
                brief: TaskBrief {
                    goal_md: "Goal".into(),
                    where_md: "src/feature".into(),
                    result_md: "Report".into(),
                    changes: vec![Change {
                        title: "Change".into(),
                        required: "Required".into(),
                        ..Default::default()
                    }],
                    tests: vec![BriefTest {
                        setup: "Run checks".into(),
                        expected: "Pass".into(),
                    }],
                    ..Default::default()
                },
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
    headers.insert("X-Jam-Project", project.id.parse().unwrap());
    headers.insert("X-Jam-Agent", "HTTP brain".parse().unwrap());
    let transport = StreamableHttpClientTransport::with_client(
        reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap(),
        StreamableHttpClientTransportConfig::with_uri(format!(
            "http://127.0.0.1:{}/mcp",
            server.port
        )),
    );
    let client = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("codex-http-gate", "1"),
    )
    .serve(transport)
    .await
    .unwrap();
    let call = |name: &'static str, args: serde_json::Value| {
        CallToolRequestParams::new(name).with_arguments(args.as_object().unwrap().clone())
    };
    client
        .call_tool(call("get_project", serde_json::json!({})))
        .await
        .unwrap();
    let brain = pinned
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.name == "HTTP brain")
        .unwrap()
        .member;
    pinned
        .set_brain(&human.id, &epic.key, &brain.handle)
        .unwrap();
    let denied = client
        .call_tool(call("claim_task", serde_json::json!({"key":task.task.key})))
        .await
        .unwrap();
    assert_eq!(
        denied.structured_content.unwrap()["code"],
        "execution_required"
    );
    let request = client.call_tool(call("request_execution", serde_json::json!({"scope":{"type":"story","id":story.key},"reason":"Start this exact reviewed story"}))).await.unwrap();
    assert_ne!(request.is_error, Some(true));
    let request: ExecutionRequest =
        serde_json::from_value(request.structured_content.unwrap()).unwrap();
    assert_eq!(request.project_id, project.id);
    assert_eq!(request.scope.id, story.audit.id);
    assert!(
        !client
            .list_all_tools()
            .await
            .unwrap()
            .iter()
            .any(|t| matches!(
                t.name.as_ref(),
                "set_execution" | "resolve_execution_request"
            ))
    );
    let (other, _) = store
        .create_jam("Unrelated project", None, None, None, "UTC", "Other human")
        .unwrap();
    pinned
        .resolve_execution_request(
            &human.id,
            ResolveExecutionRequest {
                id: request.id,
                decision: ExecutionDecision::Approve,
                expected_revision: request.revision,
            },
        )
        .unwrap();
    assert_eq!(store.active_jam().unwrap().id, other.id);
    let claim = client
        .call_tool(call("claim_task", serde_json::json!({"key":task.task.key})))
        .await
        .unwrap();
    assert_ne!(claim.is_error, Some(true));
    let scope = ExecutionScope {
        kind: ExecutionScopeType::Story,
        id: story.audit.id,
    };
    pinned
        .set_execution(
            &human.id,
            SetExecution {
                expected_revision: pinned.get_execution(&scope).unwrap().revision,
                scope: scope.clone(),
                action: ExecutionAction::Pause,
            },
        )
        .unwrap();
    let report = client.call_tool(call("submit_report", serde_json::json!({"key":task.task.key,"summaryMd":"Existing round evidence survives pause","changedFiles":["src/feature"],"tests":[{"name":"check","command":"check","expected":"Pass","actual":"Pass","result":"PASS"}]}))).await.unwrap();
    assert_ne!(report.is_error, Some(true));
    pinned
        .review_task(
            &human.id,
            ReviewTask {
                key: task.task.key.clone(),
                verdict: "changes_requested".into(),
                comments_md: "Another round".into(),
                failed_tests: None,
            },
        )
        .unwrap();
    let denied = client
        .call_tool(call("claim_task", serde_json::json!({"key":task.task.key})))
        .await
        .unwrap();
    assert_eq!(
        denied.structured_content.unwrap()["code"],
        "execution_required"
    );
    assert_eq!(store.get_project().unwrap().tasks, 0);
    assert_eq!(pinned.get_task(&task.task.key).unwrap().reports.len(), 1);
    client.cancel().await.unwrap();
    server.stop().await;
}
