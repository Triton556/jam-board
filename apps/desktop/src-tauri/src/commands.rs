use crate::{BoardChanged, DesktopState};
use jam_core::*;
use serde::{Deserialize, Serialize};
use std::result::Result;
use tauri::State;
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    NotFound,
    ClaimConflict,
    Validation,
    Archived,
    Conflict,
    Internal,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}
impl From<jam_core::Error> for ApiError {
    fn from(error: jam_core::Error) -> Self {
        let (code, field) = match &error {
            Error::NotFound(_) => (ApiErrorCode::NotFound, None),
            Error::ClaimConflict { .. } => (ApiErrorCode::ClaimConflict, None),
            Error::Validation { field, .. } => (ApiErrorCode::Validation, Some(field.clone())),
            Error::Archived(_) => (ApiErrorCode::Archived, None),
            Error::Conflict => (ApiErrorCode::Conflict, None),
            _ => (ApiErrorCode::Internal, None),
        };
        Self {
            code,
            message: error.to_string(),
            field,
        }
    }
}
pub(crate) fn internal(e: impl std::fmt::Display) -> ApiError {
    ApiError {
        code: ApiErrorCode::Internal,
        message: e.to_string(),
        field: None,
    }
}
pub(crate) async fn execute<T: Send + 'static>(
    state: &DesktopState,
    app: tauri::AppHandle,
    mutation: bool,
    f: impl FnOnce(&Store) -> jam_core::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
    let store = state.store.clone();
    let feed = state.feed.clone();
    tokio::task::spawn_blocking(move || {
        let result = f(&store).map_err(ApiError::from)?;
        if mutation {
            let events = feed
                .lock()
                .map_err(internal)?
                .poll()
                .map_err(ApiError::from)?;
            if !events.is_empty() {
                BoardChanged { events }.emit(&app).map_err(internal)?;
            }
        }
        Ok(result)
    })
    .await
    .map_err(internal)?
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveInput {
    pub key: String,
    pub status: String,
    pub before_key: Option<String>,
    pub after_key: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityInput {
    pub after_seq: Option<i64>,
    pub limit: Option<i64>,
}

#[tauri::command]
#[specta::specta]
pub async fn app_state(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute(&state, app, false, Store::app_state).await
}
#[tauri::command]
#[specta::specta]
pub async fn create_jam(
    input: NewJamInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute(&state, app, true, move |s| s.onboard(input)).await
}
#[tauri::command]
#[specta::specta]
pub async fn load_demo_jam(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute(&state, app, true, |s| {
        s.seed_demo()?;
        s.app_state()
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn set_current_member(
    member_id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute(&state, app, true, move |s| s.set_current_member(&member_id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn add_self(
    name: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute(&state, app, true, move |s| s.join_as_human(&name)).await
}
#[tauri::command]
#[specta::specta]
pub async fn get_board(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<BoardSummary, ApiError> {
    execute(&state, app, false, Store::board_summary).await
}
#[tauri::command]
#[specta::specta]
pub async fn list_board_tasks(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<BoardTasks, ApiError> {
    execute(&state, app, false, Store::list_board_tasks).await
}
#[tauri::command]
#[specta::specta]
pub async fn get_task(
    key: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskDetail, ApiError> {
    execute(&state, app, false, move |s| s.get_task(&key)).await
}
#[tauri::command]
#[specta::specta]
pub async fn create_task(
    input: CreateTask,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskDetail, ApiError> {
    execute(&state, app, true, move |s| s.create_current_task(input)).await
}
#[tauri::command]
#[specta::specta]
pub async fn move_task(
    input: MoveInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskSummary, ApiError> {
    execute(&state, app, true, move |s| {
        s.move_current_task(
            &input.key,
            &input.status,
            input.before_key.as_deref(),
            input.after_key.as_deref(),
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn list_members(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<MemberWithStats>, ApiError> {
    execute(&state, app, false, Store::members_with_stats).await
}
#[tauri::command]
#[specta::specta]
pub async fn list_activity(
    input: ActivityQuery,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<ActivityEvent>, ApiError> {
    execute(&state, app, false, move |s| s.activity_page(input)).await
}
#[tauri::command]
#[specta::specta]
pub async fn set_theme(
    theme: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    execute(&state, app, true, move |s| s.set_theme(&theme)).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_tasks(
    input: TaskQuery,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskListPage, ApiError> {
    execute(&state, app, false, move |store| store.query_tasks(input)).await
}
#[tauri::command]
#[specta::specta]
pub async fn update_task(
    input: TaskEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskDetail, ApiError> {
    execute(&state, app, true, move |store| {
        store.update_current_task(input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn archive_task(
    key: String,
    reason: Option<String>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskSummary, ApiError> {
    execute(&state, app, true, move |store| {
        store.archive_current_task(&key, reason.as_deref())
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn unarchive_task(
    key: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskSummary, ApiError> {
    execute(&state, app, true, move |store| {
        store.unarchive_current_task(&key)
    })
    .await
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommentInput {
    pub key: String,
    pub body_md: String,
}
#[tauri::command]
#[specta::specta]
pub async fn add_comment(
    input: CommentInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Comment, ApiError> {
    execute(&state, app, true, move |store| {
        store.add_current_comment(&input.key, &input.body_md)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn list_tags(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<TagCount>, ApiError> {
    execute(&state, app, false, Store::list_tags).await
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub data_dir: String,
    pub sidecar_path: String,
}
#[tauri::command]
#[specta::specta]
pub async fn runtime_info(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RuntimeInfo, ApiError> {
    execute(&state, app, false, |store| {
        Ok(RuntimeInfo {
            data_dir: std::path::absolute(store.path.parent().ok_or_else(invalid_path)?)?
                .to_string_lossy()
                .into_owned(),
            sidecar_path: std::env::current_exe()?
                .with_file_name(if cfg!(windows) {
                    "jam-board-mcp.exe"
                } else {
                    "jam-board-mcp"
                })
                .to_string_lossy()
                .into_owned(),
        })
    })
    .await
}
fn invalid_path() -> jam_core::Error {
    jam_core::Error::Io(std::io::Error::other("Database has no parent directory"))
}
// Export a stable command type, but never register the bulk generator in release.
#[tauri::command]
#[specta::specta]
pub async fn seed_bulk(
    n: usize,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    #[cfg(debug_assertions)]
    {
        execute(&state, app, true, move |store| store.seed_bulk(n)).await
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (n, state, app);
        Err(internal(
            "Bulk generation is only available in debug builds",
        ))
    }
}

/// A local first-content-frame receipt for reproducible release measurements.
#[tauri::command]
#[specta::specta]
pub fn app_ready(state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), ApiError> {
    use tauri::Emitter;
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(internal)?
        .as_millis();
    let receipt = serde_json::json!({ "pid": std::process::id(), "readyAtUnixMs": at });
    let directory = state
        .store
        .path
        .parent()
        .ok_or_else(|| internal("Missing data directory"))?
        .join("logs");
    std::fs::create_dir_all(&directory).map_err(internal)?;
    std::fs::write(directory.join("app-ready.json"), receipt.to_string()).map_err(internal)?;
    app.emit("app-ready", receipt).map_err(internal)?;
    Ok(())
}
