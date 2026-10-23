use crate::{
    DesktopState,
    commands::{ApiError, internal},
    skill_runner::{self, SkillCheck, SkillInput, SkillResult},
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;
#[derive(Default)]
pub struct SkillRuntime {
    active: Mutex<Option<Arc<AtomicBool>>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SkillOutput {
    pub line: String,
}
type Result<T> = std::result::Result<T, ApiError>;
#[tauri::command]
#[specta::specta]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
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
pub async fn skill_saved_path(state: State<'_, DesktopState>) -> Result<Option<String>> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || store.setting("jam_skill_target"))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn skill_check(input: SkillInput, state: State<'_, DesktopState>) -> Result<SkillCheck> {
    let trust = state
        .store
        .path
        .parent()
        .ok_or_else(|| internal("Missing app data path"))?
        .join("skill-receipts");
    Ok(skill_runner::check(&input, &trust).await)
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_skill(runtime: State<'_, SkillRuntime>) -> Result<()> {
    if let Some(c) = runtime.active.lock().map_err(internal)?.as_ref() {
        c.store(true, Ordering::SeqCst)
    }
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub async fn run_skill(
    input: SkillInput,
    step: String,
    runtime: State<'_, SkillRuntime>,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<SkillResult> {
    let trust = state
        .store
        .path
        .parent()
        .ok_or_else(|| internal("Missing app data path"))?
        .join("skill-receipts");
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = runtime.active.lock().map_err(internal)?;
        if active.is_some() {
            return Err(internal("Another skill step is running"));
        }
        *active = Some(cancel.clone());
    }
    let result = skill_runner::run(
        input,
        &step,
        trust,
        cancel,
        Duration::from_secs(120),
        move |line| {
            let _ = SkillOutput { line }.emit(&app);
        },
    )
    .await;
    *runtime.active.lock().map_err(internal)? = None;
    result.map_err(internal)
}
