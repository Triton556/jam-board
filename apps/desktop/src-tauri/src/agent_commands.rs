//! Thin desktop adapter; runtime state, credentials and protocol live in jam-agents.
use crate::{
    DesktopState,
    commands::{ApiError, internal},
};
use jam_agents::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "agent-dock-event")]
#[serde(transparent)]
pub struct DockEvent(pub AgentDockEvent);
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "agent-terminal-output")]
#[serde(transparent)]
pub struct TerminalOutputEvent(pub AgentTerminalOutput);

/// Desktop launch metadata extends the shared session view without changing
/// the runtime event protocol or assigning Jam Board's ID to the agent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionLaunchView {
    #[serde(flatten)]
    pub session: AgentSessionView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
}
impl AgentSessionLaunchView {
    fn new(session: AgentSessionView, runtime: &SessionManager) -> Self {
        let agent_session_id = runtime.agent_session_id(&session.id).ok().flatten();
        Self {
            session,
            agent_session_id,
        }
    }
}

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
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentSessionLaunchView>> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
    Ok(runtime
        .sessions(&project.id)
        .into_iter()
        .map(|s| AgentSessionLaunchView::new(s, &runtime))
        .collect())
}
#[tauri::command]
#[specta::specta]
pub async fn start_agent_session(
    input: StartAgentSessionInput,
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AgentSessionLaunchView> {
    // Snapshot before dispatch. Navigation after this point cannot retarget the child.
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let store = store.selected_snapshot().map_err(ApiError::from)?;
    runtime
        .start_for_store(
            &store,
            mcp.data_dir.clone(),
            mcp.sidecar_path.clone(),
            input,
        )
        .await
        .map(|s| AgentSessionLaunchView::new(s, &runtime))
        .map_err(internal)
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
pub async fn agent_launch_logs(
    session_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentDockEvent>> {
    runtime.launch_logs(&session_id).map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn agent_launch_options(
    profile_id: String,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AgentLaunchOptions> {
    runtime
        .profiles
        .launch_options(&profile_id)
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn save_agent_user_config_default(
    choice: UserConfigDefault,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<UserConfigDefault> {
    runtime
        .profiles
        .save_user_config_default(choice)
        .map_err(internal)
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
                if let Some(payload) = launch_warning_payload(&e) {
                    let _ = app.emit("agent-launch-warning", payload);
                }
                let _ = DockEvent(e).emit(&app);
            },
            move |e| {
                let _ = TerminalOutputEvent(e).emit(&terminal_app);
            },
        )
        .with_attachment_media(media),
    )
}

fn launch_warning_payload(event: &AgentDockEvent) -> Option<serde_json::Value> {
    let AgentEventKind::Status {
        message: Some(message),
        ..
    } = &event.event
    else {
        return None;
    };
    let mut warning: serde_json::Value =
        serde_json::from_str(message.strip_prefix("Launch warning: ")?).ok()?;
    warning
        .as_object_mut()?
        .insert("sessionId".into(), event.session_id.clone().into());
    Some(warning)
}

#[cfg(test)]
mod history_tests {
    use super::*;

    #[test]
    fn b1_history_output_keeps_terminal_provider_model_and_resume_user_config_contract() {
        let entry: HistoryEntry = serde_json::from_value(serde_json::json!({
            "id":"fixture-terminal", "projectId":"fixture-project", "profileId":"fixture-profile",
            "profileLabel":"Fixture connection", "kind":"terminal",
            "provider":{"label":"Fixture connection","agentKind":"claude-cli"}, "empty":false,
            "title":"Fixture task", "createdAt":"2026-10-28T00:00:00Z", "updatedAt":"2026-10-28T00:01:00Z",
            "model":"fixture-model", "effort":null, "agentSessionId":"fixture-native",
            "resumable":"native", "messageCount":2
        })).unwrap();
        let output = serde_json::to_value(entry).unwrap();
        assert_eq!(output["kind"], "terminal");
        assert_eq!(output["provider"]["label"], "Fixture connection");
        assert_eq!(output["model"], "fixture-model");
        assert_eq!(output["empty"], false);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../test-visuals/round7/b1-terminal-history");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("history-contract-bindings.ts");
        crate::export_event_bindings(&path).unwrap();
        let generated = std::fs::read_to_string(path).unwrap();
        assert!(generated.contains("resumeAgentSession: (entryId: string, userConfig:"));
        assert!(generated.contains("\"resume_agent_session\", { entryId, userConfig }"));
        assert!(generated.contains("\"chat\" | \"terminal\""));
        assert!(generated.contains("provider: HistoryProvider"));
        assert!(generated.contains("empty: boolean"));
    }
}

#[cfg(test)]
mod launch_tests {
    use super::*;

    #[test]
    fn b2_launch_event_wire_and_generated_bindings_use_flat_fields_and_registered_commands() {
        let wire = serde_json::json!({"sessionId":"fixture", "seq":1, "at":"2026-10-28T06:00:00Z", "kind":"launch_step", "step":"initialize", "state":"running", "message":"ACP initialize", "startedAt":"2026-10-28T06:00:00Z", "endedAt":null});
        let event: AgentDockEvent = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(DockEvent(event)).unwrap(), wire);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../test-visuals/round7/b2-launch-events");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("contract-bindings.ts");
        crate::export_event_bindings(&path).unwrap();
        let generated = std::fs::read_to_string(path).unwrap();
        for expected in [
            "agentLaunchLogs:",
            "agentLaunchOptions:",
            "saveAgentUserConfigDefault:",
            "kind: \"launch_step\"; step: string; state:",
            "startedAt: string",
            "endedAt: string | null",
            "resetsAt?: string | null",
            "userConfig?: UserConfigChoice | null",
            "\"usage_limit\"",
        ] {
            assert!(
                generated.contains(expected),
                "Missing generated contract: {expected}"
            );
        }
        assert!(!generated.contains("launch: LaunchStep"));
    }

    #[test]
    fn launch_metadata_flattens_session_view_with_optional_agent_id() {
        let session: AgentSessionView = serde_json::from_value(serde_json::json!({
            "id":"board-session", "profileId":"fake", "projectId":"project", "kind":"terminal",
            "title":"Fake", "status":"starting", "cwd":"/fixture", "createdAt":"2026-10-28T06:00:00Z",
            "capabilities":{"images":false,"audio":false,"embeddedContext":false,"configOptions":false}, "model":null,"effort":null
        })).unwrap();
        let mut view = AgentSessionLaunchView {
            session,
            agent_session_id: Some("b981229f-407a-4249-a7de-7eb00187d191".into()),
        };
        let value = serde_json::to_value(&view).unwrap();
        assert_eq!(
            value["agentSessionId"],
            "b981229f-407a-4249-a7de-7eb00187d191"
        );
        assert_eq!(value["id"], "board-session");
        assert!(value.get("session").is_none());
        view.agent_session_id = None;
        assert!(
            serde_json::to_value(view)
                .unwrap()
                .get("agentSessionId")
                .is_none()
        );
    }

    #[test]
    fn launch_warning_event_payload_includes_session_path_and_fix() {
        let payload = serde_json::json!({"configPath":"/fixture/config.toml", "serverName":"jam-board", "injectedServerName":"jam-board-FB-unique", "suggestedFix":"Remove or disable this stale entry after review"});
        let event = AgentDockEvent {
            session_id: "session".into(),
            seq: 1,
            at: "2026-10-28T06:00:00Z".into(),
            event: AgentEventKind::Status {
                status: SessionStatus::Starting,
                message: Some(format!("Launch warning: {payload}")),
            },
        };
        let mut expected = payload;
        expected["sessionId"] = "session".into();
        assert_eq!(launch_warning_payload(&event), Some(expected));
    }
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
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<HistoryEntry>> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
    let dir = mcp.data_dir.clone();
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || {
        runtime.agent_history(&dir, &project.id, limit, query.as_deref())
    })
    .await
    .map_err(internal)?
    .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn agent_history_events(
    entry_id: String,
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AgentDockEvent>> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
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
    user_config: Option<UserConfigChoice>,
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<AgentSessionLaunchView> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
    runtime
        .resume_with_user_config(&mcp.data_dir, &project.id, &entry_id, user_config)
        .await
        .map(|s| AgentSessionLaunchView::new(s, &runtime))
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn rename_agent_history(
    entry_id: String,
    title: String,
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
    runtime
        .rename_history(&mcp.data_dir, &project.id, &entry_id, &title)
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn delete_agent_history(
    entry_id: String,
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
    runtime
        .delete_history(&mcp.data_dir, &project.id, &entry_id)
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn clear_agent_history(
    projects: State<'_, Arc<jam_core::ProjectManager>>,
    state: State<'_, DesktopState>,
    mcp: State<'_, Arc<jam_mcp::McpRuntime>>,
    runtime: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let store = projects
        .capture_selected()
        .ok()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let project = store.active_jam().map_err(ApiError::from)?;
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
