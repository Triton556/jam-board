use crate::{
    DesktopState,
    commands::{ApiError, execute},
};
use jam_core::*;
use std::result::Result;
use tauri::{Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn reference_canvas(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<ReferenceCanvas, ApiError> {
    execute(&state, app, false, Store::reference_canvas).await
}
#[tauri::command]
#[specta::specta]
pub async fn canvas_geometry(
    input: CanvasGeometry,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.canvas_geometry(&s.current_member()?.id, input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn canvas_archive(
    input: CanvasArchive,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    execute(&state, app, true, move |s| {
        s.canvas_archive(&s.current_member()?.id, input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn reference_metadata(
    id: String,
    metadata: Option<String>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.reference_metadata(&s.current_member()?.id, &id, metadata)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn update_ref_edge(
    id: String,
    label: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefEdge, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_ref_edge(&s.current_member()?.id, &id, &label)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn clipboard_reference(
    bytes: Vec<u8>,
    x: f64,
    y: f64,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.clipboard_reference(&s.current_member()?.id, &bytes, x, y)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn fetch_reference_preview(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.fetch_reference_preview(&s.current_member()?.id, &id)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn clear_reference_preview(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.store_link_preview(&s.current_member()?.id, &id, None)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn canvas_viewport(
    value: Option<String>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Option<String>, ApiError> {
    execute(&state, app, false, move |s| {
        let actor = s.current_member()?.id;
        if let Some(value) = value {
            s.set_canvas_viewport(&actor, &value)?;
        }
        s.canvas_viewport(&actor)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn reference_media(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Option<String>, ApiError> {
    let path = execute(&state, app.clone(), false, move |s| {
        s.reference_media_path(&id)
    })
    .await?;
    if let Some(path) = path {
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| ApiError {
                code: crate::commands::ApiErrorCode::Internal,
                message: e.to_string(),
                field: None,
            })?;
        let encoded =
            percent_encoding::utf8_percent_encode(&path, percent_encoding::NON_ALPHANUMERIC);
        Ok(Some(if cfg!(windows) {
            format!("http://asset.localhost/{encoded}")
        } else {
            format!("asset://localhost/{encoded}")
        }))
    } else {
        Ok(None)
    }
}
