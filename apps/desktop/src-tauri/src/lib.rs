use jam_core::{ActivityEvent, ChangeFeed, Store};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_specta::Event;
mod agent_commands;
mod canvas_commands;
pub mod commands;
mod execution_commands;
mod m5_commands;
mod project_folder_commands;
mod skill_commands;
mod skill_runner;
mod startup_probe;
mod v2_commands;
mod voice_commands;
mod web_commands;
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct McpCallsChanged {}

pub struct DesktopState {
    pub store: Arc<Store>,
    pub feed: Arc<Mutex<ChangeFeed>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct BoardChanged {
    pub events: Vec<ActivityEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub project_context: Option<ProjectEventContext>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEventContext {
    pub instance_id: String,
    pub project_id: String,
    pub selection_epoch: u64,
    pub database_generation: String,
}
impl ProjectEventContext {
    fn capture(h: &jam_core::ProjectHandle) -> Self {
        Self {
            instance_id: h.instance_id.clone(),
            project_id: h.project_id.clone(),
            selection_epoch: h.selection_epoch,
            database_generation: h.database_generation.clone(),
        }
    }
}

pub fn event_bridge() -> tauri_specta::Builder<tauri::Wry> {
    macro_rules! desktop_commands {
        ($($extra:ident),*) => { tauri_specta::collect_commands![
            web_commands::web_search_settings,web_commands::save_web_search_settings,web_commands::set_web_search_key,web_commands::clear_web_search_key,web_commands::test_web_search,
            voice_commands::voice_set_cloud_key,voice_commands::voice_clear_cloud_key,voice_commands::voice_status,voice_commands::voice_prepare,voice_commands::voice_settings_save,voice_commands::voice_install,voice_commands::voice_cancel_install,voice_commands::voice_remove,voice_commands::voice_transcribe,voice_commands::voice_unload,
            agent_commands::agent_launch_logs,agent_commands::agent_launch_options,agent_commands::save_agent_user_config_default,
            agent_commands::agent_history,agent_commands::agent_history_events,agent_commands::resume_agent_session,agent_commands::rename_agent_history,agent_commands::delete_agent_history,agent_commands::clear_agent_history,agent_commands::agent_history_settings,agent_commands::save_agent_history_settings,
            agent_commands::agent_model_catalog,agent_commands::add_agent_attachment,agent_commands::remove_agent_attachment,agent_commands::agent_profiles,agent_commands::save_agent_profile,agent_commands::delete_agent_profile,agent_commands::set_agent_secret,agent_commands::clear_agent_secret,agent_commands::agent_sessions,agent_commands::start_agent_session,agent_commands::send_agent_prompt,agent_commands::retry_agent_turn,agent_commands::cancel_agent_turn,agent_commands::resolve_agent_permission,agent_commands::set_agent_config_option,agent_commands::stop_agent_session,agent_commands::agent_session_history,agent_commands::terminal_write,agent_commands::terminal_resize,agent_commands::terminal_snapshot,
            skill_commands::pick_folder,skill_commands::skill_saved_path,skill_commands::skill_check,skill_commands::cancel_skill,skill_commands::run_skill,
            canvas_commands::reference_canvas,canvas_commands::canvas_geometry,canvas_commands::canvas_archive,canvas_commands::reference_metadata,canvas_commands::update_ref_edge,canvas_commands::clipboard_reference,canvas_commands::fetch_reference_preview,canvas_commands::clear_reference_preview,canvas_commands::canvas_viewport,canvas_commands::reference_media,
            v2_commands::set_reference_verdict,v2_commands::link_ref_frame,v2_commands::unlink_ref_frame,v2_commands::list_plan_epics,v2_commands::list_plan_stories,v2_commands::clear_brain,v2_commands::reorder_story,
            v2_commands::get_project,v2_commands::update_project,v2_commands::list_epics,v2_commands::get_epic,v2_commands::get_story,v2_commands::create_epic,v2_commands::update_epic,v2_commands::set_epic_status,v2_commands::create_story,v2_commands::update_story,v2_commands::set_story_status,v2_commands::update_task_brief,v2_commands::check_ready,v2_commands::mark_ready,v2_commands::answer_question,v2_commands::ask_user,v2_commands::withdraw_question,v2_commands::list_questions,v2_commands::review_task,v2_commands::submit_report,v2_commands::set_brain,v2_commands::list_changes_since,v2_commands::epic_journal,v2_commands::add_reference,v2_commands::list_references,v2_commands::update_reference,v2_commands::link_reference,v2_commands::unlink_reference,v2_commands::archive_reference,v2_commands::list_ref_frames,v2_commands::create_ref_frame,v2_commands::update_ref_frame,v2_commands::archive_ref_frame,v2_commands::list_ref_edges,v2_commands::create_ref_edge,v2_commands::archive_ref_edge,v2_commands::update_ref_geometry,
            execution_commands::get_execution,execution_commands::list_execution,execution_commands::set_execution,execution_commands::list_execution_requests,execution_commands::resolve_execution_request,
            project_folder_commands::remove_recent_project_folder,project_folder_commands::locate_project_folder,project_folder_commands::preview_project_move,project_folder_commands::project_selection_context,project_folder_commands::open_file_asset,project_folder_commands::reveal_file_asset,project_folder_commands::create_project_folder,project_folder_commands::open_project_folder,project_folder_commands::close_project_folder,project_folder_commands::project_folder_info,project_folder_commands::list_project_folders,project_folder_commands::set_project_folder_rules,project_folder_commands::move_project_to_folder,project_folder_commands::project_operation_status,project_folder_commands::rollback_project_move,project_folder_commands::recover_project_folder,project_folder_commands::save_board_snapshot,project_folder_commands::register_file,project_folder_commands::link_task_file,project_folder_commands::set_task_file_role,project_folder_commands::unlink_task_file,project_folder_commands::resolve_file,project_folder_commands::file_operation_status,project_folder_commands::cancel_file_operation,project_folder_commands::list_file_assets,project_folder_commands::compare_board_snapshot,project_folder_commands::keep_live_board,
            commands::list_projects, commands::select_project, commands::restore_project,
            commands::app_ready, commands::app_state, commands::create_jam, commands::load_demo_jam,
            commands::set_current_member, commands::add_self, commands::get_board,
            commands::list_board_tasks, commands::get_task, commands::create_task,
            commands::move_task, commands::list_members, commands::list_activity,
            commands::set_theme, commands::list_tasks, commands::update_task,
            commands::release_task, commands::archive_task, commands::unarchive_task, commands::add_comment,
            m5_commands::attach_file,m5_commands::pick_files,m5_commands::list_assets,m5_commands::create_asset,m5_commands::update_asset,m5_commands::link_asset,m5_commands::unlink_asset,m5_commands::asset_preview,m5_commands::create_member,m5_commands::update_member,m5_commands::get_settings,m5_commands::set_settings,m5_commands::reset_jam,m5_commands::export_jam_json,m5_commands::import_jam_json,m5_commands::pick_file,m5_commands::mcp_status,m5_commands::set_mcp_http_enabled,m5_commands::regenerate_mcp_token,m5_commands::reveal_mcp_token,m5_commands::mcp_config_snippets,commands::list_tags, commands::runtime_info $(, commands::$extra)*
        ] };
    }
    let builder = tauri_specta::Builder::new()
        .dangerously_cast_bigints_to_number()
        .events(tauri_specta::collect_events![
            BoardChanged,
            McpCallsChanged,
            voice_commands::VoiceProgress,
            skill_commands::SkillOutput,
            agent_commands::DockEvent,
            agent_commands::TerminalOutputEvent
        ]);
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
    let startup_probe = startup_probe::StartupProbe::from_env();
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
    let builder = tauri::Builder::default();
    let bridge_handler = bridge.invoke_handler();
    let builder = if let Some(probe) = startup_probe {
        let probe_handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool =
            tauri::generate_handler![startup_probe::startup_first_paint];
        builder
            .manage(probe)
            .append_invoke_initialization_script(
                "document.addEventListener('DOMContentLoaded', () => { import('/startup-probe.js').then(probe => probe.observeFirstPaint(window.__TAURI_INTERNALS__.invoke)).catch(console.error); }, { once: true });",
            )
            .invoke_handler(move |invoke| {
                if invoke.message.command() == "startup_first_paint" {
                    probe_handler(invoke)
                } else {
                    bridge_handler(invoke)
                }
            })
    } else {
        builder.invoke_handler(bridge_handler)
    };
    builder
        .manage(skill_commands::SkillRuntime::default())
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
            if let Some(probe) = app.try_state::<startup_probe::StartupProbe>() {
                probe.window_created();
            }
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
            app.manage(runtime.projects.clone());
            app.manage(runtime.clone());
            app.manage(agent_commands::manager(store.clone(), app.handle().clone()));
            app.manage(voice_commands::manager(&data_dir, app.handle().clone())?);
            app.manage(Arc::new(jam_web_mcp::config::WebConfig::new(&data_dir)));
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
                    let folder_handle = runtime.projects.capture_selected().ok();
                    let feed = folder_handle
                        .as_ref()
                        .map(|h| h.feed.clone())
                        .unwrap_or_else(|| feed.clone());
                    let selected_store = folder_handle
                        .as_ref()
                        .map(|h| h.store.clone())
                        .unwrap_or_else(|| store.clone());
                    let result = tokio::task::spawn_blocking(move || {
                        let mut f = feed
                            .lock()
                            .map_err(|_| std::io::Error::other("feed lock poisoned"))?;
                        if f.data_changed()? {
                            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(
                                selected_store.selected_events(f.poll()?)?,
                            )
                        } else {
                            Ok(Vec::new())
                        }
                    })
                    .await;
                    match result {
                        Ok(Ok(events)) if !events.is_empty() => {
                            if let Err(e) = (BoardChanged {
                                events,
                                project_context: folder_handle
                                    .as_deref()
                                    .map(ProjectEventContext::capture),
                            })
                            .emit(&handle)
                            {
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
        .build(context)
        .expect("build Jam Board")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(runtime) = app.try_state::<jam_voice::LocalWhisper>()
            {
                runtime.shutdown();
            }
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(runtime) = app.try_state::<Arc<jam_agents::SessionManager>>()
            {
                tauri::async_runtime::block_on(runtime.stop_all());
            }
        });
}
