use crate::{BoardChanged, DesktopState};
use jam_core::*;
use serde::{Deserialize, Serialize};
use std::result::Result;
use tauri::{Manager, State};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    NotFound,
    ClaimConflict,
    StaleClaim,
    Validation,
    Archived,
    Conflict,
    NotReady,
    ExecutionRequired,
    WrongStatus,
    Forbidden,
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
            Error::StaleClaim => (ApiErrorCode::StaleClaim, None),
            Error::Validation { field, .. } => (ApiErrorCode::Validation, Some(field.clone())),
            Error::Archived(_) => (ApiErrorCode::Archived, None),
            Error::Conflict => (ApiErrorCode::Conflict, None),
            Error::NotReady(_) => (ApiErrorCode::NotReady, None),
            Error::ExecutionRequired(_) => (ApiErrorCode::ExecutionRequired, None),
            Error::WrongStatus(_) => (ApiErrorCode::WrongStatus, None),
            Error::Forbidden(_) => (ApiErrorCode::Forbidden, None),
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
    // Capture the project before scheduling; later navigation cannot retarget this command.
    let handle = app
        .try_state::<std::sync::Arc<jam_core::ProjectManager>>()
        .and_then(|m| m.capture_selected().ok());
    let scoped = if let Some(h) = &handle {
        (*h.store).clone()
    } else {
        captured_project_store(&state.store)?
    };
    execute_with_store(state, app, mutation, scoped, handle, f).await
}
fn captured_project_store(store: &Store) -> Result<Store, ApiError> {
    store.selected_snapshot().map_err(ApiError::from)
}
pub(crate) async fn execute_unbound<T: Send + 'static>(
    state: &DesktopState,
    app: tauri::AppHandle,
    mutation: bool,
    f: impl FnOnce(&Store) -> jam_core::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
    let handle = app
        .try_state::<std::sync::Arc<jam_core::ProjectManager>>()
        .and_then(|m| m.capture_selected().ok());
    let scoped = handle
        .as_ref()
        .map(|h| (*h.store).clone())
        .unwrap_or_else(|| (*state.store).clone());
    if mutation
        && handle.is_none()
        && let Some(manager) = app
            .try_state::<std::sync::Arc<ProjectManager>>()
            .map(|m| m.inner().clone())
    {
        let legacy = state.store.clone();
        return execute_with_store(state, app, mutation, scoped, handle, move |s| {
            manager.with_legacy_selection_update(&legacy, || f(s))
        })
        .await;
    }
    execute_with_store(state, app, mutation, scoped, handle, f).await
}
async fn execute_with_store<T: Send + 'static>(
    state: &DesktopState,
    app: tauri::AppHandle,
    mutation: bool,
    scoped: Store,
    handle: Option<std::sync::Arc<jam_core::ProjectHandle>>,
    f: impl FnOnce(&Store) -> jam_core::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
    let selected = handle
        .as_ref()
        .map(|h| h.store.clone())
        .unwrap_or_else(|| state.store.clone());
    let feed = handle
        .as_ref()
        .map(|h| h.feed.clone())
        .unwrap_or_else(|| state.feed.clone());
    tokio::task::spawn_blocking(move || {
        let result = f(&scoped).map_err(ApiError::from)?;
        if mutation {
            let events = feed
                .lock()
                .map_err(internal)?
                .poll()
                .map_err(ApiError::from)?;
            let events = selected.selected_events(events).map_err(ApiError::from)?;
            if !events.is_empty() {
                BoardChanged {
                    events,
                    project_context: handle.as_deref().map(crate::ProjectEventContext::capture),
                }
                .emit(&app)
                .map_err(internal)?;
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
    pub expected_updated_at: String,
    pub status: String,
    pub before_key: Option<String>,
    pub after_key: Option<String>,
    pub override_reason: Option<String>,
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
    execute_unbound(&state, app, false, Store::app_state).await
}
#[tauri::command]
#[specta::specta]
pub async fn list_projects(
    include_archived: Option<bool>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<ProjectSummary>, ApiError> {
    execute_with_store(&state, app, false, (*state.store).clone(), None, move |s| {
        s.list_projects(include_archived.unwrap_or(false))
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn select_project(
    project_id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    let source = state.store.clone();
    let manager = app
        .try_state::<std::sync::Arc<jam_core::ProjectManager>>()
        .map(|m| m.inner().clone());
    tokio::task::spawn_blocking(move || {
        if source.moved_project_folder(&project_id)?.is_some() {
            let manager = manager.ok_or_else(|| {
                jam_core::Error::Forbidden("Moved project needs the app registry resolver".into())
            })?;
            return manager.open_registered(&project_id)?.store.app_state();
        }
        if let Some(manager) = manager {
            return manager.select_legacy_project(&source, &project_id);
        }
        source.select_project(&project_id)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn restore_project(
    project_id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute_unbound(&state, app, true, move |s| s.restore_project(&project_id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn create_jam(
    input: NewJamInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute_unbound(&state, app, true, move |s| s.onboard(input)).await
}
#[tauri::command]
#[specta::specta]
pub async fn load_demo_jam(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState, ApiError> {
    execute_unbound(&state, app, true, |s| {
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
            &input.expected_updated_at,
            input.before_key.as_deref(),
            input.after_key.as_deref(),
            input.override_reason.as_deref(),
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
    execute_unbound(&state, app, true, move |s| s.set_theme(&theme)).await
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
pub async fn release_task(
    input: ReleaseClaim,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskSummary, ApiError> {
    execute(&state, app, true, move |store| {
        store.release_current_task(input)
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
    execute_unbound(&state, app, false, |store| {
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

#[cfg(test)]
mod project_command_tests {
    use super::*;
    #[test]
    fn ordinary_commands_never_fall_back_to_unbound_after_the_last_project_is_archived() {
        let directory = std::env::temp_dir().join(format!(
            "jam-native-scope-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        {
            let store = Store::open(directory.join("jam.db")).unwrap();
            assert!(captured_project_store(&store).is_err());
            let (project, human) = store
                .create_jam("Archived board", None, None, None, "UTC", "Human")
                .unwrap();
            let story = store.default_task_story(&human.id).unwrap();
            let task = store
                .create_task(
                    &human.id,
                    CreateTask {
                        story_key: Some(story.key),
                        title: "Retained data".into(),
                        ..Default::default()
                    },
                )
                .unwrap();
            let captured = captured_project_store(&store).unwrap();
            store.reset_jam(&human.id, &project.name).unwrap();
            assert!(matches!(
                captured_project_store(&store),
                Err(ApiError {
                    code: ApiErrorCode::NotFound,
                    ..
                })
            ));
            assert!(matches!(
                captured.get_task(&task.task.key),
                Err(Error::Archived(_))
            ));
            // Legacy core explicit-key reads still exist; native commands cannot reach them.
            assert_eq!(
                store.get_task(&task.task.key).unwrap().task.title,
                "Retained data"
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
