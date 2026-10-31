//! Human-side folder lifecycle; each write captures an immutable instance/epoch.
use crate::{
    DesktopState,
    commands::{ApiError, internal},
};
use jam_core::*;
use std::result::Result;
use std::{path::Path, sync::Arc};
use tauri::{Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn remove_recent_project_folder(
    instance_id: String,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<(), ApiError> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || manager.remove_recent_project_folder(&instance_id))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn locate_project_folder(
    instance_id: String,
    expected_project_id: String,
    folder: String,
    cloud_acknowledged: bool,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ProjectFolderInfo, ApiError> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        manager
            .locate_project_folder(
                &instance_id,
                &expected_project_id,
                Path::new(&folder),
                cloud_acknowledged,
            )?
            .info()
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn project_selection_context(
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FolderCommandContext, ApiError> {
    Ok(manager.selection_context(&state.store)?)
}
#[tauri::command]
#[specta::specta]
pub async fn preview_project_move(
    project_id: String,
    destination: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
    app: tauri::AppHandle,
) -> Result<ProjectMovePreview, ApiError> {
    let source = state.store.clone();
    let manager = manager.inner().clone();
    let agents_bound = app
        .try_state::<Arc<jam_agents::SessionManager>>()
        .is_some_and(|agents| {
            agents.sessions(&project_id).iter().any(|s| {
                !matches!(
                    s.status,
                    jam_agents::SessionStatus::Stopped | jam_agents::SessionStatus::Failed
                )
            })
        });
    tokio::task::spawn_blocking(move || {
        let mut preview =
            manager.preview_project_move(&source, &project_id, Path::new(&destination))?;
        preview.agent_session_bound = agents_bound;
        preview.has_bound_owners |= agents_bound;
        Ok(preview)
    })
    .await
    .map_err(internal)?
}

/// Injectable boundary: tests resolve real synthetic assets but never launch applications.
trait AssetOpener {
    fn open_url(&self, url: &str) -> Result<(), ApiError>;
    fn open_path(&self, path: &str) -> Result<(), ApiError>;
    fn reveal_path(&self, path: &str) -> Result<(), ApiError>;
}
struct BackendOpener(tauri::AppHandle);
impl AssetOpener for BackendOpener {
    fn open_url(&self, url: &str) -> Result<(), ApiError> {
        use tauri_plugin_opener::OpenerExt;
        self.0
            .opener()
            .open_url(url, None::<&str>)
            .map_err(internal)
    }
    fn open_path(&self, path: &str) -> Result<(), ApiError> {
        use tauri_plugin_opener::OpenerExt;
        self.0
            .opener()
            .open_path(path, None::<&str>)
            .map_err(internal)
    }
    fn reveal_path(&self, path: &str) -> Result<(), ApiError> {
        use tauri_plugin_opener::OpenerExt;
        self.0.opener().reveal_item_in_dir(path).map_err(internal)
    }
}
fn launch_asset(
    manager: &ProjectManager,
    legacy: &Store,
    context: &FolderCommandContext,
    asset: &str,
    reveal: bool,
    opener: &impl AssetOpener,
) -> Result<(), ApiError> {
    // Hold selection through fresh resolution and the backend handoff.
    let target = manager.with_expected_context(legacy, Some(context), |store| {
        let resolution = store.resolve_file(ResolveFile {
            asset_id: asset.into(),
            working_directory: store.get_settings()?.working_directory,
        })?;
        let path = resolution
            .resolved_path
            .ok_or_else(|| invalid_asset("File has no resolved location"))?;
        if resolution.storage_type == "url" {
            // resolve_file validates HTTP(S), credentials and whitespace.
            opener
                .open_url(&path)
                .map_err(|e| Error::Forbidden(e.message))?;
        } else {
            if resolution.status != "available" {
                return Err(invalid_asset(&format!("File is {}", resolution.status)));
            }
            let file = std::fs::File::open(&path)
                .map_err(|e| invalid_asset(&format!("File is missing or unreadable: {e}")))?;
            if !file.metadata()?.is_file() {
                return Err(invalid_asset("Asset is not a readable file"));
            }
            let result = if reveal {
                opener.reveal_path(&path)
            } else {
                opener.open_path(&path)
            };
            result.map_err(|e| Error::Forbidden(e.message))?;
        }
        Ok(())
    });
    target.map_err(Into::into)
}
fn invalid_asset(message: &str) -> Error {
    Error::Validation {
        field: "assetId".into(),
        reason: message.into(),
    }
}
#[tauri::command]
#[specta::specta]
pub async fn open_file_asset(
    context: FolderCommandContext,
    asset_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        launch_asset(
            &manager,
            &legacy,
            &context,
            &asset_id,
            false,
            &BackendOpener(app),
        )
    })
    .await
    .map_err(internal)?
}
#[tauri::command]
#[specta::specta]
pub async fn reveal_file_asset(
    context: FolderCommandContext,
    asset_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        launch_asset(
            &manager,
            &legacy,
            &context,
            &asset_id,
            true,
            &BackendOpener(app),
        )
    })
    .await
    .map_err(internal)?
}

fn capture(
    manager: &ProjectManager,
    context: &FolderCommandContext,
) -> Result<Arc<ProjectHandle>, ApiError> {
    let h = manager.capture_selected()?;
    if h.instance_id != context.instance_id || h.selection_epoch != context.selection_epoch {
        return Err(Error::Conflict.into());
    }
    Ok(h)
}
fn operation_source(
    manager: &ProjectManager,
    legacy: &Arc<Store>,
    request: &str,
) -> jam_core::Result<Arc<Store>> {
    match manager
        .registry
        .local_setting(&format!("move-source:{request}"))?
    {
        Some(path) => Ok(Arc::new(Store::open(path)?)),
        None => Ok(legacy.clone()),
    }
}
#[cfg(test)]
fn capture_move_source(
    manager: &ProjectManager,
    legacy: &Arc<Store>,
    input: &MoveProject,
) -> jam_core::Result<Arc<Store>> {
    let key = format!("move-source:{}", input.request_id);
    if manager.registry.local_setting(&key)?.is_some() {
        return operation_source(manager, legacy, &input.request_id);
    }
    let source = if let Ok(handle) = manager.capture_selected()
        && handle.project_id == input.project_id
    {
        handle.store.clone()
    } else if manager
        .registry
        .entries()?
        .iter()
        .any(|entry| entry.project_id == input.project_id)
    {
        manager
            .resolve_handle(Some(&input.project_id), None)?
            .store
            .clone()
    } else {
        Arc::new(legacy.for_project(&input.project_id)?)
    };
    // Keep the source locator after cutover: the selected destination has no old
    // move receipt, and navigation must never retarget status/resume/rollback.
    manager
        .registry
        .set_local_setting(&key, &source.path.to_string_lossy())?;
    Ok(source)
}
#[tauri::command]
#[specta::specta]
pub async fn create_project_folder(
    folder: String,
    name: String,
    cloud_acknowledged: bool,
    initialization: Option<NewJamInput>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ProjectFolderInfo, ApiError> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        manager
            .create_initialized(
                Path::new(&folder),
                &name,
                cloud_acknowledged,
                initialization,
            )?
            .info()
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn open_project_folder(
    folder: String,
    cloud_acknowledged: bool,
    separate_copy: bool,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ProjectFolderInfo, ApiError> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        manager
            .open(Path::new(&folder), cloud_acknowledged, separate_copy)?
            .info()
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn close_project_folder(
    context: FolderCommandContext,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<(), ApiError> {
    let handle = capture(&manager, &context)?;
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || manager.close_handle(&handle))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn project_folder_info(
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ProjectFolderInfo, ApiError> {
    Ok(manager.capture_selected()?.info()?)
}
#[tauri::command]
#[specta::specta]
pub async fn list_project_folders(
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<Vec<RegistryEntry>, ApiError> {
    Ok(manager.registry.entries()?)
}
#[tauri::command]
#[specta::specta]
pub async fn set_project_folder_rules(
    context: Option<FolderCommandContext>,
    rules: std::collections::BTreeMap<String, String>,
    expected_manifest_revision: String,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ProjectFolderInfo, ApiError> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        manager.set_folder_rules_checked(context.as_ref(), rules, &expected_manifest_revision)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn move_project_to_folder(
    input: MoveProject,
    expected_context: Option<FolderCommandContext>,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
    app: tauri::AppHandle,
) -> Result<MoveReceipt, ApiError> {
    let agents = app
        .try_state::<Arc<jam_agents::SessionManager>>()
        .map(|m| m.inner().clone());
    let project = input.project_id.clone();
    let legacy = state.store.clone();
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        manager.move_project_with_context_check(&legacy, input, expected_context.as_ref(), || {
            if agents.is_some_and(|agents| {
                agents.sessions(&project).iter().any(|s| {
                    !matches!(
                        s.status,
                        jam_agents::SessionStatus::Stopped | jam_agents::SessionStatus::Failed
                    )
                })
            }) {
                return Err(Error::Forbidden(
                    "Disconnect all agent sessions before moving this project".into(),
                ));
            }
            Ok(())
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn project_operation_status(
    request_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<MoveReceipt, ApiError> {
    Ok(operation_source(&manager, &state.store, &request_id)?
        .project_operation_status(&request_id)?)
}
#[tauri::command]
#[specta::specta]
pub async fn rollback_project_move(
    request_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<MoveReceipt, ApiError> {
    let source = operation_source(&manager, &state.store, &request_id)?;
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || manager.rollback_project_move(&source, &request_id))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn recover_project_folder(
    folder: String,
    cloud_acknowledged: bool,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ProjectFolderInfo, ApiError> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        manager
            .recover(Path::new(&folder), cloud_acknowledged)?
            .info()
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn save_board_snapshot(
    context: FolderCommandContext,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<(), ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || h.store.flush_board_snapshot())
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn compare_board_snapshot(
    context: FolderCommandContext,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<SnapshotComparison, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || h.store.compare_board_snapshot())
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn keep_live_board(
    context: FolderCommandContext,
    expected_external_hash: String,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<(), ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || h.store.keep_live_board(&expected_external_hash))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn register_file(
    context: FolderCommandContext,
    input: RegisterFile,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileMutationResult, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || h.store.register_file(&h.store.current_member()?.id, input))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn link_task_file(
    context: FolderCommandContext,
    input: TaskFileInput,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileMutationResult, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || {
        h.store.link_task_file(&h.store.current_member()?.id, input)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn set_task_file_role(
    context: FolderCommandContext,
    input: TaskFileInput,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileMutationResult, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || {
        h.store
            .set_task_file_role(&h.store.current_member()?.id, input)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn unlink_task_file(
    context: FolderCommandContext,
    input: TaskFileInput,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileMutationResult, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || {
        h.store
            .unlink_task_file(&h.store.current_member()?.id, input)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn resolve_file(
    context: FolderCommandContext,
    input: ResolveFile,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileResolution, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || h.store.resolve_file(input))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn file_operation_status(
    context: FolderCommandContext,
    request_id: String,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileOperationStatus, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || {
        h.store
            .file_operation_status(&h.store.current_member()?.id, &request_id)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn list_file_assets(
    context: FolderCommandContext,
    input: FileAssetQuery,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<Vec<FileAsset>, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || h.store.list_file_assets(input))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_file_operation(
    context: FolderCommandContext,
    request_id: String,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<FileOperationStatus, ApiError> {
    let h = capture(&manager, &context)?;
    tokio::task::spawn_blocking(move || {
        h.store
            .cancel_file_operation(&h.store.current_member()?.id, &request_id)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct FakeOpener(std::cell::RefCell<Vec<(String, String)>>);
    impl AssetOpener for FakeOpener {
        fn open_url(&self, path: &str) -> Result<(), ApiError> {
            self.0.borrow_mut().push(("url".into(), path.into()));
            Ok(())
        }
        fn open_path(&self, path: &str) -> Result<(), ApiError> {
            self.0.borrow_mut().push(("open".into(), path.into()));
            Ok(())
        }
        fn reveal_path(&self, path: &str) -> Result<(), ApiError> {
            self.0.borrow_mut().push(("reveal".into(), path.into()));
            Ok(())
        }
    }
    #[test]
    fn asset_open_reveal_resolve_fresh_and_never_launch_missing_unreadable_or_stale_assets() {
        let d = Fixture::new();
        let manager = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
        let legacy = Store::open(d.path().join("legacy.db")).unwrap();
        let h = manager
            .create(&d.path().join("Folder"), "Folder", false)
            .unwrap();
        let file = d.path().join("fictional.txt");
        std::fs::write(&file, b"hello").unwrap();
        let input:RegisterFile=serde_json::from_value(serde_json::json!({"storageType":"linked_file","sourcePath":file.to_string_lossy(),"requestId":"file"})).unwrap();
        let asset = h
            .store
            .register_file(&h.store.current_member().unwrap().id, input)
            .unwrap()
            .asset
            .unwrap()
            .asset
            .id;
        let opener = FakeOpener::default();
        let context = h.command_context();
        launch_asset(&manager, &legacy, &context, &asset, false, &opener).unwrap();
        launch_asset(&manager, &legacy, &context, &asset, true, &opener).unwrap();
        assert_eq!(
            opener
                .0
                .borrow()
                .iter()
                .map(|(action, _)| action.as_str())
                .collect::<Vec<_>>(),
            ["open", "reveal"]
        );
        opener.0.borrow_mut().clear();
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let deny_read = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&file)
                .unwrap();
            for reveal in [false, true] {
                let error =
                    launch_asset(&manager, &legacy, &context, &asset, reveal, &opener).unwrap_err();
                assert!(matches!(
                    error.code,
                    crate::commands::ApiErrorCode::Validation
                ));
                assert_eq!(error.field.as_deref(), Some("assetId"));
            }
            assert!(opener.0.borrow().is_empty());
            drop(deny_read);
        }
        std::fs::remove_file(&file).unwrap();
        for reveal in [false, true] {
            let error =
                launch_asset(&manager, &legacy, &context, &asset, reveal, &opener).unwrap_err();
            assert!(matches!(
                error.code,
                crate::commands::ApiErrorCode::Validation
            ));
            assert_eq!(error.field.as_deref(), Some("assetId"));
        }
        assert!(opener.0.borrow().is_empty());
        std::fs::create_dir(&file).unwrap();
        assert!(launch_asset(&manager, &legacy, &context, &asset, false, &opener).is_err());
        assert!(launch_asset(&manager, &legacy, &context, "unknown", true, &opener).is_err());
        assert!(opener.0.borrow().is_empty());
        let url:RegisterFile=serde_json::from_value(serde_json::json!({"storageType":"url","url":"https://example.invalid/fake","requestId":"url"})).unwrap();
        let url = h
            .store
            .register_file(&h.store.current_member().unwrap().id, url)
            .unwrap()
            .asset
            .unwrap()
            .asset
            .id;
        for reveal in [false, true] {
            launch_asset(&manager, &legacy, &context, &url, reveal, &opener).unwrap();
        }
        assert!(
            opener
                .0
                .borrow()
                .iter()
                .all(|(action, path)| action == "url" && path == "https://example.invalid/fake")
        );
        opener.0.borrow_mut().clear();
        manager.open(&h.folder, false, false).unwrap();
        let error = launch_asset(&manager, &legacy, &context, &url, false, &opener).unwrap_err();
        assert!(matches!(
            error.code,
            crate::commands::ApiErrorCode::Conflict
        ));
        assert!(opener.0.borrow().is_empty());
        manager.close().unwrap();
        let (project, owner) = legacy
            .create_jam("Legacy", None, None, None, "UTC", "Owner")
            .unwrap();
        manager.select_legacy_project(&legacy, &project.id).unwrap();
        let url:RegisterFile=serde_json::from_value(serde_json::json!({"storageType":"url","url":"https://example.invalid/legacy","requestId":"legacy-url"})).unwrap();
        let url = legacy
            .register_file(&owner.id, url)
            .unwrap()
            .asset
            .unwrap()
            .asset
            .id;
        launch_asset(
            &manager,
            &legacy,
            &manager.selection_context(&legacy).unwrap(),
            &url,
            false,
            &opener,
        )
        .unwrap();
        assert_eq!(opener.0.borrow().len(), 1);
    }
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "jam-r11-desktop-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let (Ok(path), Ok(root)) =
                (self.0.canonicalize(), std::env::temp_dir().canonicalize())
                && path.parent() == Some(root.as_path())
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("jam-r11-desktop-"))
            {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
    #[test]
    fn mv_desktop_move_source_stays_bound_after_selection_changes() {
        let d = Fixture::new();
        let manager = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
        let legacy = Arc::new(Store::open(d.path().join("legacy.db")).unwrap());
        let folder = manager
            .create(&d.path().join("Folder"), "Folder", false)
            .unwrap();
        let input = MoveProject {
            project_id: folder.project_id.clone(),
            destination: d.path().join("Moved").to_string_lossy().into(),
            request_id: "desktop-move".into(),
            cloud_acknowledged: false,
        };
        let source = capture_move_source(&manager, &legacy, &input).unwrap();
        assert_eq!(source.path, folder.store.path);
        manager
            .create(&d.path().join("Other"), "Other", false)
            .unwrap();
        assert_eq!(
            capture_move_source(&manager, &legacy, &input).unwrap().path,
            source.path
        );
        assert_eq!(
            operation_source(&manager, &legacy, &input.request_id)
                .unwrap()
                .path,
            source.path
        );
    }
    #[test]
    fn st_captured_command_epoch_rejects_late_a_b_a_picker_results() {
        let d = Fixture::new();
        let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
        let a = m.create(&d.path().join("A"), "A", false).unwrap();
        let context = FolderCommandContext {
            instance_id: a.instance_id.clone(),
            selection_epoch: a.selection_epoch,
        };
        assert!(capture(&m, &context).is_ok());
        m.create(&d.path().join("B"), "B", false).unwrap();
        assert!(capture(&m, &context).is_err());
        let reopened = m.open(&a.folder, false, false).unwrap();
        assert_eq!(reopened.instance_id, a.instance_id);
        assert_ne!(reopened.selection_epoch, a.selection_epoch);
        assert!(capture(&m, &context).is_err());
        assert!(
            capture(
                &m,
                &FolderCommandContext {
                    instance_id: reopened.instance_id.clone(),
                    selection_epoch: reopened.selection_epoch
                }
            )
            .is_ok()
        );
    }
}
