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
    let mut folder: Option<PathBuf> = None;
    let mut demo = false;
    let mut project = std::env::var("JAM_BOARD_PROJECT").ok();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--db" => db = Some(PathBuf::from(args.next().ok_or("--db requires a path")?)),
            "--project-folder" => {
                folder = Some(PathBuf::from(
                    args.next().ok_or("--project-folder requires a path")?,
                ))
            }
            "--project" => {
                project = Some(
                    args.next()
                        .ok_or("--project requires a project ID or key prefix")?,
                )
            }
            "--seed-demo" => demo = true,
            "--help" | "-h" => {
                eprintln!(
                    "jam-board-mcp [--project-folder <path>] [--db <path>] [--project <id>] [--seed-demo]\nLocation: CLI, environment, exact project registry, legacy default. Conflicting selectors and absent databases are refused. JAM_BOARD_DATA_DIR stays app-local."
                );
                return Ok(());
            }
            _ => return Err(format!("Unknown argument: {arg}").into()),
        }
    }
    let env_folder = std::env::var_os("JAM_BOARD_PROJECT_FOLDER").map(PathBuf::from);
    if let (Some(a), Some(b)) = (&folder, &env_folder)
        && a.canonicalize()? != b.canonicalize()?
    {
        return Err("Conflicting CLI/environment project folders".into());
    }
    let mut folder = folder.or(env_folder);
    let explicit_db = db
        .clone()
        .or_else(|| std::env::var_os("JAM_BOARD_DB").map(PathBuf::from));
    if folder.is_some() && explicit_db.is_some() {
        return Err("Folder selector conflicts with explicit legacy DB selector".into());
    }
    if folder.is_none()
        && let Some(path) = &explicit_db
        && path.file_name().is_some_and(|n| n == "board.db")
        && path
            .parent()
            .and_then(std::path::Path::file_name)
            .is_some_and(|n| n == ".state")
    {
        folder = path
            .parent()
            .and_then(std::path::Path::parent)
            .map(std::path::Path::to_path_buf);
    }
    let app_dir = std::env::var_os("JAM_BOARD_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("dev.triton556.jamboard"))
        });
    let mut manager = None;
    let store = if let Some(folder) = folder {
        if demo {
            return Err("--seed-demo is not supported for folder projects".into());
        }
        let m =
            Arc::new(jam_core::ProjectManager::new(app_dir.as_ref().ok_or(
                "Folder transport needs an app-local registry locator",
            )?)?);
        let h = m.resolve_handle(project.as_deref(), Some(&folder))?;
        project = Some(h.project_id.clone());
        manager = Some(m);
        h.store.clone()
    } else {
        let mut registered = None;
        if db.is_none()
            && std::env::var_os("JAM_BOARD_DB").is_none()
            && let (Some(id), Some(app)) = (&project, &app_dir)
            && app.join("registry.db").is_file()
        {
            let m = Arc::new(jam_core::ProjectManager::new(app)?);
            if m.registry.entries()?.iter().any(|e| e.project_id == *id) {
                registered = Some(m.resolve_handle(Some(id), None)?.store.clone());
                manager = Some(m);
            }
        }
        if let Some(s) = registered {
            s
        } else {
            let path = jam_core::resolve_db_path(db)?;
            if !path.is_file() && !demo {
                return Err(
                    "Database does not exist; explicitly create/open the project before connecting"
                        .into(),
                );
            }
            Arc::new(jam_core::Store::open(path)?)
        }
    };
    let dir = store
        .path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let dir = if manager.is_some() {
        app_dir
            .as_deref()
            .ok_or("Missing app-local runtime locator")?
    } else {
        dir
    };
    jam_mcp::init_logging(dir, "mcp-stdio")?;
    if demo {
        store.seed_demo()?;
    }
    let mut server = jam_mcp::JamServer::new(
        store.clone(),
        std::env::var("JAM_AGENT_NAME").ok(),
        Arc::new(Mutex::new(Default::default())),
    )
    .with_project(project);
    if let Some(manager) = manager {
        server = server.with_project_manager(manager);
    } else {
        server = server.report_stdio_calls();
    }
    tracing::info!("Jam Board stdio ready");
    let running = server.serve(rmcp::transport::stdio()).await?;
    let result = running.waiting().await;
    store.flush_board_snapshot()?;
    result?;
    Ok(())
}
