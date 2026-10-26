use rmcp::{ServiceExt, model::CallToolRequestParams, transport::TokioChildProcess};

#[tokio::test]
async fn w7_actual_stdio_schema_plain_error_and_shutdown() {
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_jam-web-mcp"));
    command
        .env("JAM_WEB_PROVIDER", "")
        .env("BRAVE_API_KEY", "")
        .env("TAVILY_API_KEY", "")
        .env("JAM_WEB_DOWNLOAD_DIR", "");
    let transport = TokioChildProcess::new(command).unwrap();
    let client = ().serve(transport).await.unwrap();
    let tools = client.list_all_tools().await.unwrap();
    assert_eq!(tools.len(), 3);
    let response = client
        .call_tool(
            CallToolRequestParams::new("web_search").with_arguments(
                serde_json::json!({"query":"fixture","kind":"web"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    let value = serde_json::to_value(response).unwrap();
    assert_eq!(value["isError"], true);
    assert_eq!(
        value["content"][0]["text"],
        "Choose a web search provider in Settings"
    );
    let response = client
        .call_tool(
            CallToolRequestParams::new("read_page").with_arguments(
                serde_json::json!({"url":"http://[::1]/"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap()["content"][0]["text"],
        "URL must resolve only to public addresses"
    );
    client.cancel().await.unwrap();
}
