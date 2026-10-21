//! Only the native human bridge can authorize execution; MCP only requests it.
use crate::{
    DesktopState,
    commands::{ApiError, execute},
};
use jam_core::*;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn get_execution(
    scope: ExecutionScope,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> std::result::Result<ExecutionState, ApiError> {
    execute(&state, app, false, move |s| s.get_execution(&scope)).await
}
#[tauri::command]
#[specta::specta]
pub async fn list_execution(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> std::result::Result<Vec<ExecutionState>, ApiError> {
    execute(&state, app, false, Store::list_execution).await
}
#[tauri::command]
#[specta::specta]
pub async fn set_execution(
    input: SetExecution,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> std::result::Result<ExecutionState, ApiError> {
    execute(&state, app, true, move |s| {
        s.set_execution(&s.current_member()?.id, input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn list_execution_requests(
    status: Option<ExecutionRequestStatus>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> std::result::Result<Vec<ExecutionRequest>, ApiError> {
    execute(&state, app, false, move |s| {
        s.list_execution_requests(status)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn resolve_execution_request(
    input: ResolveExecutionRequest,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> std::result::Result<ExecutionRequest, ApiError> {
    execute(&state, app, true, move |s| {
        s.resolve_execution_request(&s.current_member()?.id, input)
    })
    .await
}
