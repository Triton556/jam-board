use jam_core::{ActivityEvent, ChangeFeed, Store};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_specta::Event;
pub mod commands;
mod m5_commands;
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct McpCallsChanged {}

pub struct DesktopState {
    pub store: Arc<Store>,
    pub feed: Arc<Mutex<ChangeFeed>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct BoardChanged {
    pub events: Vec<ActivityEvent>,
}

pub fn event_bridge() -> tauri_specta::Builder<tauri::Wry> {
    macro_rules! desktop_commands {
        ($($extra:ident),*) => { tauri_specta::collect_commands![
            commands::app_ready, commands::app_state, commands::create_jam, commands::load_demo_jam,
            commands::set_current_member, commands::add_self, commands::get_board,
            commands::list_board_tasks, commands::get_task, commands::create_task,
            commands::move_task, commands::list_members, commands::list_activity,
            commands::set_theme, commands::list_tasks, commands::update_task,
            commands::archive_task, commands::unarchive_task, commands::add_comment,
            m5_commands::attach_file,m5_commands::pick_files,m5_commands::list_assets,m5_commands::create_asset,m5_commands::update_asset,m5_commands::link_asset,m5_commands::unlink_asset,m5_commands::asset_preview,m5_commands::create_member,m5_commands::update_member,m5_commands::get_settings,m5_commands::set_settings,m5_commands::reset_jam,m5_commands::export_jam_json,m5_commands::import_jam_json,m5_commands::pick_file,m5_commands::mcp_status,m5_commands::set_mcp_http_enabled,m5_commands::regenerate_mcp_token,m5_commands::reveal_mcp_token,m5_commands::mcp_config_snippets,commands::list_tags, commands::runtime_info $(, commands::$extra)*
        ] };
    }
    let builder = tauri_specta::Builder::new()
        .dangerously_cast_bigints_to_number()
        .events(tauri_specta::collect_events![BoardChanged, McpCallsChanged]);
    #[cfg(debug_assertions)]
    let builder = builder.commands(desktop_commands!(seed_bulk));
    #[cfg(not(debug_assertions))]
    let builder = builder.commands(desktop_commands!());
    builder
}

pub fn export_event_bindings(path: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    event_bridge().export(specta_typescript::Typescript::default(), path)?;
    let generated = std::fs::read_to_string(path)?;
    std::fs::write(path, format!("{}\n", generated.trim_end()))?;
    Ok(())
}

pub fn run() {
    let mut context = tauri::generate_context!();
    let development_dir = std::env::var_os("JAM_BOARD_DATA_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            cfg!(debug_assertions).then(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.dev-data")
            })
        });
    if let Some(dir) = development_dir {
        let absolute = std::path::absolute(dir).expect("resolve development data directory");
        context.config_mut().app.app_directories_override =
            Some(tauri::utils::config::AppDirectoriesOverride::Root(absolute));
    }
    let bridge = event_bridge();
    #[cfg(debug_assertions)]
    export_event_bindings(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/bindings.ts"
    )))
    .expect("export event types");
    tauri::Builder::default()
        .invoke_handler(bridge.invoke_handler())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            bridge.mount_events(app);
            let data_dir = if let Some(dir) = std::env::var_os("JAM_BOARD_DATA_DIR") {
                std::path::PathBuf::from(dir)
            } else if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.dev-data")
            } else {
                app.path().app_data_dir()?
            };
            jam_mcp::init_logging(&data_dir, "desktop")?;
            let store = Arc::new(Store::open(data_dir.join("jam.db"))?);
            let runtime = jam_mcp::McpRuntime::new(
                store.clone(),
                std::env::current_exe()?.with_file_name(if cfg!(windows) {
                    "jam-board-mcp.exe"
                } else {
                    "jam-board-mcp"
                }),
            )
            .map_err(|e| std::io::Error::other(e.to_string()))?;
            let handle = app.handle().clone();
            let feed = Arc::new(Mutex::new(ChangeFeed::open(
                &store.path,
                store.latest_seq()?,
            )?));
            app.manage(store.clone());
            app.manage(DesktopState {
                store: store.clone(),
                feed: feed.clone(),
            });
            app.manage(runtime.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = runtime.listen_stdio().await {
                    tracing::error!(%e,"Cannot receive stdio call metadata");
                }
                let enabled =
                    store.setting("mcp_http_enabled").ok().flatten().as_deref() != Some("false");
                if let Err(e) = runtime.set_enabled(enabled).await {
                    tracing::error!(%e,"MCP HTTP unavailable");
                }
                let mut call_stamp = String::new();
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
                loop {
                    interval.tick().await;
                    let stamp = runtime
                        .recent
                        .lock()
                        .ok()
                        .and_then(|r| r.front().map(|c| c.at.clone()))
                        .unwrap_or_default();
                    if stamp != call_stamp {
                        call_stamp = stamp;
                        let _ = McpCallsChanged {}.emit(&handle);
                    }
                    let feed = feed.clone();
                    let result = tokio::task::spawn_blocking(move || {
                        let mut f = feed
                            .lock()
                            .map_err(|_| std::io::Error::other("feed lock poisoned"))?;
                        if f.data_changed()? {
                            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(f.poll()?)
                        } else {
                            Ok(Vec::new())
                        }
                    })
                    .await;
                    match result {
                        Ok(Ok(events)) if !events.is_empty() => {
                            if let Err(e) = (BoardChanged { events }).emit(&handle) {
                                tracing::warn!(%e,"Cannot emit board-changed");
                            }
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) => tracing::error!(%e,"Cannot poll board changes"),
                        Err(e) => tracing::error!(%e,"Change-feed worker stopped"),
                    }
                }
            });
            Ok(())
        })
        .run(context)
        .expect("run Jam Board");
}
