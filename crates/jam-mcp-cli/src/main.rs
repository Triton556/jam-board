use rmcp::ServiceExt;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("jam-board-mcp: {e}");
        std::process::exit(1);
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut args = std::env::args().skip(1);
    let mut db = None;
    let mut demo = false;
    let mut project = std::env::var("JAM_BOARD_PROJECT").ok();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--db" => db = Some(PathBuf::from(args.next().ok_or("--db requires a path")?)),
            "--project" => {
                project = Some(
                    args.next()
                        .ok_or("--project requires a project ID or key prefix")?,
                )
            }
            "--seed-demo" => demo = true,
            "--help" | "-h" => {
                eprintln!(
                    "jam-board-mcp [--db <path>] [--project <id-or-key-prefix>] [--seed-demo]\nMCP stdio server. Database precedence: --db, JAM_BOARD_DB, JAM_BOARD_DATA_DIR/jam.db, APPDATA."
                );
                return Ok(());
            }
            _ => return Err(format!("Unknown argument: {arg}").into()),
        }
    }
    let path = jam_core::resolve_db_path(db)?;
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    jam_mcp::init_logging(dir, "mcp-stdio")?;
    let store = Arc::new(jam_core::Store::open(&path)?);
    if demo {
        store.seed_demo()?;
    }
    let server = jam_mcp::JamServer::new(
        store,
        std::env::var("JAM_AGENT_NAME").ok(),
        Arc::new(Mutex::new(Default::default())),
    )
    .with_project(project)
    .report_stdio_calls();
    tracing::info!("Jam Board stdio ready");
    let running = server.serve(rmcp::transport::stdio()).await?;
    running.waiting().await?;
    Ok(())
}
