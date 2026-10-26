//! Thin adapter for Web search settings. No secret is returned to the UI.
use crate::commands::{ApiError, internal};
use jam_web_mcp::config::{Provider, WebConfig, WebSearchSettings, WebSearchSettingsInput};
use std::sync::Arc;
use tauri::State;

type Result<T> = std::result::Result<T, ApiError>;

#[tauri::command]
#[specta::specta]
pub async fn web_search_settings(runtime: State<'_, Arc<WebConfig>>) -> Result<WebSearchSettings> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.settings())
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn save_web_search_settings(
    input: WebSearchSettingsInput,
    runtime: State<'_, Arc<WebConfig>>,
) -> Result<WebSearchSettings> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.save(input))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn set_web_search_key(
    provider: Provider,
    key: String,
    runtime: State<'_, Arc<WebConfig>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.set_key(provider, &key))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn clear_web_search_key(
    provider: Provider,
    runtime: State<'_, Arc<WebConfig>>,
) -> Result<()> {
    let runtime = runtime.inner().clone();
    tokio::task::spawn_blocking(move || runtime.clear_key(provider))
        .await
        .map_err(internal)?
        .map_err(internal)
}
#[tauri::command]
#[specta::specta]
pub async fn test_web_search(runtime: State<'_, Arc<WebConfig>>) -> Result<()> {
    let runtime = runtime.inner().clone();
    let provider = tokio::task::spawn_blocking(move || runtime.search_provider())
        .await
        .map_err(internal)?
        .map_err(internal)?;
    jam_web_mcp::providers::test_connection(provider.as_ref())
        .await
        .map_err(internal)
}

#[cfg(test)]
mod tests {
    #[test]
    fn w7_desktop_command_contract() {
        let bridge = crate::event_bridge();
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../test-visuals/round6/w7/command-bindings.ts");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        bridge
            .export(specta_typescript::Typescript::default(), &path)
            .unwrap();
        let text = std::fs::read_to_string(path).unwrap();
        for name in [
            "web_search_settings",
            "save_web_search_settings",
            "set_web_search_key",
            "clear_web_search_key",
            "test_web_search",
        ] {
            assert!(text.contains(&format!("\"{name}\"")), "{name}");
        }
        assert!(text.contains("WebSearchSettingsInput"));
    }
}
