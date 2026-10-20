use crate::{
    DesktopState, McpCallsChanged,
    commands::{ApiError, execute, internal},
};
use jam_core::*;
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;
#[tauri::command]
#[specta::specta]
pub async fn attach_file(
    key: String,
    path: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> std::result::Result<Asset, ApiError> {
    execute(&state, app, true, move |s| {
        s.attach_file(&s.current_member()?.id, &key, &path)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn pick_files(app: tauri::AppHandle) -> std::result::Result<Vec<String>, ApiError> {
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(internal)
            })
            .collect()
    })
    .await
    .map_err(internal)?
}
type Result<T> = std::result::Result<T, ApiError>;
#[tauri::command]
#[specta::specta]
pub async fn list_assets(
    input: AssetQuery,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<AssetWithTasks>> {
    execute(&state, app, false, move |s| s.assets_with_tasks(input)).await
}
#[tauri::command]
#[specta::specta]
pub async fn create_asset(
    input: NewAsset,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Asset> {
    execute(&state, app, true, move |s| {
        s.create_asset(
            &s.current_member()?.id,
            &input.kind,
            &input.name,
            &input.location,
            input.notes.as_deref(),
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn update_asset(
    input: AssetEdit,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<()> {
    execute(&state, app, true, move |s| {
        s.update_asset_fields(&s.current_member()?.id, input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn link_asset(
    input: AssetLink,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<()> {
    execute(&state, app, true, move |s| {
        s.link_asset(&s.current_member()?.id, &input.task_key, &input.asset_id)
            .map(|_| ())
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn unlink_asset(
    input: AssetLink,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<()> {
    execute(&state, app, true, move |s| {
        s.unlink_asset(&s.current_member()?.id, input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn create_member(
    input: NewMember,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Member> {
    execute(&state, app, true, move |s| {
        s.add_human(
            &s.current_member()?.id,
            &input.name,
            &input.color,
            input.avatar.as_deref(),
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn update_member(
    input: MemberEdit,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Member> {
    execute(&state, app, true, move |s| {
        s.edit_member(&s.current_member()?.id, input)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn asset_preview(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Option<String>> {
    let path = execute(&state, app.clone(), false, move |s| {
        s.asset_preview_path(&id)
    })
    .await?;
    if let Some(path) = path {
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(internal)?;
        let encoded = percent_encoding::utf8_percent_encode(
            &path.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        Ok(Some(if cfg!(windows) {
            format!("http://asset.localhost/{encoded}")
        } else {
            format!("asset://localhost/{encoded}")
        }))
    } else {
        Ok(None)
    }
}
#[tauri::command]
#[specta::specta]
pub async fn get_settings(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Settings> {
    execute(&state, app, false, Store::get_settings).await
}
#[tauri::command]
#[specta::specta]
pub async fn set_settings(
    input: SettingsPatch,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Settings> {
    execute(&state, app, false, move |s| s.set_settings(input)).await
}
#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetInput {
    pub confirm_name: String,
}
#[tauri::command]
#[specta::specta]
pub async fn reset_jam(
    input: ResetInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState> {
    execute(&state, app, true, move |s| {
        s.reset_jam(&s.current_member()?.id, &input.confirm_name)
    })
    .await
}
#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ExportPath {
    pub path: String,
}
#[tauri::command]
#[specta::specta]
pub async fn export_jam_json(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<ExportPath> {
    execute(&state, app.clone(), false, move |s| {
        let snapshot = s.export_jam()?;
        let name = snapshot
            .jam
            .name
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>();
        let date = jam_core::now().chars().take(10).collect::<String>();
        let path = app
            .dialog()
            .file()
            .add_filter("Jam Board JSON", &["json"])
            .set_file_name(format!("jam-{name}-{date}.json"))
            .blocking_save_file()
            .ok_or_else(|| Error::Validation {
                field: "file".into(),
                reason: "Export cancelled".into(),
            })?
            .into_path()
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        std::fs::write(&path, serde_json::to_vec_pretty(&snapshot)?)?;
        Ok(ExportPath {
            path: path.to_string_lossy().into(),
        })
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn import_jam_json(
    path: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<AppState> {
    execute(&state, app, true, move |s| {
        s.import_jam_file(&s.current_member()?.id, std::path::Path::new(&path))
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn pick_file(json_only: bool, app: tauri::AppHandle) -> Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let dialog = if json_only {
            dialog.add_filter("Jam Board JSON", &["json"])
        } else {
            dialog
        };
        dialog
            .blocking_pick_file()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(internal)
            })
            .transpose()
    })
    .await
    .map_err(internal)?
}
#[tauri::command]
#[specta::specta]
pub async fn mcp_status(
    runtime: State<'_, Arc<jam_mcp::McpRuntime>>,
) -> Result<jam_mcp::McpStatus> {
    runtime.status().await.map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn set_mcp_http_enabled(
    enabled: bool,
    runtime: State<'_, Arc<jam_mcp::McpRuntime>>,
    app: tauri::AppHandle,
) -> Result<()> {
    runtime.set_enabled(enabled).await.map_err(internal)?;
    McpCallsChanged {}.emit(&app).map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn regenerate_mcp_token(
    runtime: State<'_, Arc<jam_mcp::McpRuntime>>,
    app: tauri::AppHandle,
) -> Result<()> {
    runtime.regenerate().await.map_err(internal)?;
    McpCallsChanged {}.emit(&app).map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn reveal_mcp_token(runtime: State<'_, Arc<jam_mcp::McpRuntime>>) -> Result<String> {
    runtime.reveal().map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn mcp_config_snippets(
    runtime: State<'_, Arc<jam_mcp::McpRuntime>>,
) -> Result<jam_mcp::ConfigSnippets> {
    runtime.snippets().await.map_err(internal)
}
