use rmcp::ServiceExt;

#[tokio::main]
async fn main() {
    if run().await.is_err() {
        eprintln!("jam-web-mcp: Web tool server stopped unexpectedly");
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    let server = jam_web_mcp::WebServer::from_env()?;
    server
        .serve(rmcp::transport::stdio())
        .await?
        .waiting()
        .await?;
    Ok(())
}
