//! Thin desktop adapter; runtime state, credentials and protocol live in jam-agents.
use crate::{
    DesktopState,
    commands::{ApiError, internal},
};
use jam_agents::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "agent-dock-event")]
#[serde(transparent)]
pub struct DockEvent(pub AgentDockEvent);
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "agent-terminal-output")]
#[serde(transparent)]
pub struct TerminalOutputEvent(pub AgentTerminalOutput);

type Result<T> = std::result::Result<T, ApiError>;
#[tauri::command]
#[specta::specta]
pub async fn agent_profiles(
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentProfileView>> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.profiles.list())
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn save_agent_profile(
    input: AgentProfileInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AgentProfileView> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.profiles.save(input))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn delete_agent_profile(
    profile_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.profiles.delete(&profile_id))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn set_agent_secret(
    profile_id: String,
    key: String,
    value: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.profiles.set_secret(&profile_id, &key, &value))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn clear_agent_secret(
    profile_id: String,
    key: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.profiles.clear_secret(&profile_id, &key))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn agent_sessions(
    state: State<'_, DesktopState>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentSessionView>> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    Ok(runtime.sessions(&project.id))
}
#[tauri::command]
#[specta::specta]
pub async fn start_agent_session(
    input: StartAgentSessionInput,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AgentSessionView> {
    // Snapshot before dispatch. Navigation after this point cannot retarget the child.
    let board =
        BoardContext::from_store(&state.store, mcp.data_dir.clone(), mcp.sidecar_path.clone())
            .map_err(internal)?;
    runtime.start(board, input).await.map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn send_agent_prompt(
    input: SendAgentPromptInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    runtime.prompt(input).await.map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_agent_turn(
    session_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    runtime.cancel(&session_id).await.map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn resolve_agent_permission(
    input: ResolveAgentPermissionInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    runtime.resolve_permission(input).map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn set_agent_config_option(
    input: SetAgentConfigOptionInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    runtime.set_config(input).await.map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn stop_agent_session(
    session_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    runtime.stop(&session_id).await.map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn agent_session_history(
    session_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentDockEvent>> {
    runtime.history(&session_id).map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn terminal_write(
    input: TerminalWriteInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.terminal_write(input))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn terminal_resize(
    input: TerminalResizeInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.terminal_resize(input))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn terminal_snapshot(
    session_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<String> {
    runtime.terminal_snapshot(&session_id).map_err(internal)
}

pub fn manager(store: Arc<jam_core::Store>, app: tauri::AppHandle) -> Arc<SessionManager> {
    let terminal_app = app.clone();
    let media = Arc::new(DesktopAttachmentMedia(app.clone()));
    Arc::new(
        SessionManager::new(
            store,
            Arc::new(OsCredentials),
            move |e| {
                let _ = DockEvent(e).emit(&app);
            },
            move |e| {
                let _ = TerminalOutputEvent(e).emit(&terminal_app);
            },
        )
        .with_attachment_media(media),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn agent_model_catalog(
    input: AgentModelCatalogInput,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<ModelCatalog> {
    runtime
        .model_catalog(&mcp.data_dir, input)
        .await
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn add_agent_attachment(
    input: AddAgentAttachmentInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AttachmentView> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.add_attachment(input))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn remove_agent_attachment(
    input: RemoveAgentAttachmentInput,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.remove_attachment(input))
        .await
        .map_err(internal)?
        .map_err(internal)
}

struct DesktopAttachmentMedia(tauri::AppHandle);
impl AttachmentMedia for DesktopAttachmentMedia {
    fn grant(&self, path: &std::path::Path) -> jam_agents::Result<String> {
        self.0
            .asset_protocol_scope()
            .allow_file(path)
            .map_err(|_| AgentError("Cannot grant attachment preview".into()))?;
        let encoded = percent_encoding::utf8_percent_encode(
            &path.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        Ok(if cfg!(windows) {
            format!("http://asset.localhost/{encoded}")
        } else {
            format!("asset://localhost/{encoded}")
        })
    }
    fn revoke(&self, path: &std::path::Path) -> jam_agents::Result<()> {
        self.0
            .asset_protocol_scope()
            .forbid_file(path)
            .map_err(|_| AgentError("Cannot revoke attachment preview".into()))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn agent_history(
    limit: Option<u32>,
    query: Option<String>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<HistoryEntry>> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    runtime
        .agent_history(&mcp.data_dir, &project.id, limit, query.as_deref())
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn agent_history_events(
    entry_id: String,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentDockEvent>> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    let dir = mcp.data_dir.clone();
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.history_events(&dir, &project.id, &entry_id))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn resume_agent_session(
    entry_id: String,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AgentSessionView> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    runtime
        .resume(&mcp.data_dir, &project.id, &entry_id)
        .await
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn rename_agent_history(
    entry_id: String,
    title: String,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    runtime
        .rename_history(&mcp.data_dir, &project.id, &entry_id, &title)
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn delete_agent_history(
    entry_id: String,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    runtime
        .delete_history(&mcp.data_dir, &project.id, &entry_id)
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn clear_agent_history(
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let project = state.store.active_jam().map_err(ApiError::from)?;
    runtime
        .clear_history(&mcp.data_dir, &project.id)
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn agent_history_settings(
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<HistorySettings> {
    Ok(runtime.history_settings())
}
#[tauri::command]
#[specta::specta]
pub async fn save_agent_history_settings(
    keep_history: bool,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<HistorySettings> {
    runtime
        .save_history_settings(HistorySettings { keep_history })
        .map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn retry_agent_turn(
    session_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    runtime.retry(&session_id).await.map_err(internal)
}
