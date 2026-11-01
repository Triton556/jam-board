//! Folder-context-fenced round-12 planning and file adapters.
use crate::{
    DesktopState,
    commands::{ApiError, internal},
};
use jam_core::*;
use std::result::Result;
use std::sync::Arc;
use tauri::Manager;
use tauri::State;
struct BackendPreviewScope(tauri::AppHandle);

fn import_at_context(
    manager: &ProjectManager,
    legacy: &Store,
    context: &FolderCommandContext,
    input: ImportPlanInput,
) -> jam_core::Result<ImportPlanReport> {
    manager.with_expected_context(legacy, Some(context), |store| {
        store.import_plan(&store.current_member()?.id, input, ImportSource::Ui)
    })
}

#[tauri::command]
#[specta::specta]
pub async fn import_plan(
    context: FolderCommandContext,
    input: ImportPlanInput,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<ImportPlanReport, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || import_at_context(&manager, &legacy, &context, input))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn undo_import(
    context: FolderCommandContext,
    input: UndoImportInput,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<UndoImportReport, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        manager.with_expected_context(&legacy, Some(&context), |store| {
            store.undo_import(&store.current_member()?.id, input)
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn list_import_batches(
    context: FolderCommandContext,
    limit: Option<u32>,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<Vec<ImportBatchSummary>, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        manager.with_expected_context(&legacy, Some(&context), |store| {
            store.list_import_batches(ImportBatchListInput { limit })
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
fn preview_asset(
    manager: &ProjectManager,
    legacy: &Store,
    context: &FolderCommandContext,
    asset_id: &str,
    filesystem: &impl PreviewFilesystem,
    scope: &impl PreviewScope,
) -> jam_core::Result<FilePreview> {
    manager.with_expected_context(legacy, Some(context), |store| {
        store.preview_file_asset(asset_id, filesystem, scope)
    })
}
impl PreviewScope for BackendPreviewScope {
    fn allow_file(&self, path: &std::path::Path) -> jam_core::Result<()> {
        self.0
            .asset_protocol_scope()
            .allow_file(path)
            .map_err(|e| jam_core::Error::Forbidden(e.to_string()))
    }
}
#[tauri::command]
#[specta::specta]
pub async fn preview_file_asset(
    context: FolderCommandContext,
    asset_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
    app: tauri::AppHandle,
) -> Result<FilePreview, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        preview_asset(
            &manager,
            &legacy,
            &context,
            &asset_id,
            &LocalPreviewFilesystem,
            &BackendPreviewScope(app),
        )
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn move_story(
    context: FolderCommandContext,
    input: MoveStoryInput,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<Story, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        manager.with_expected_context(&legacy, Some(&context), |store| {
            store.move_story(&store.current_member()?.id, input)
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn move_task_to_story(
    context: FolderCommandContext,
    input: MoveTaskToStoryInput,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<TaskDetail, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        manager.with_expected_context(&legacy, Some(&context), |store| {
            store.move_task_to_story(&store.current_member()?.id, input)
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}

macro_rules! file_write {
    ($name:ident,$input:ty) => {
        #[tauri::command]
        #[specta::specta]
        pub async fn $name(
            context: FolderCommandContext,
            input: $input,
            state: State<'_, DesktopState>,
            manager: State<'_, Arc<ProjectManager>>,
        ) -> Result<CompactMutation, ApiError> {
            let manager = manager.inner().clone();
            let legacy = state.store.clone();
            tokio::task::spawn_blocking(move || {
                manager.with_expected_context(&legacy, Some(&context), |store| {
                    store.$name(&store.current_member()?.id, input)
                })
            })
            .await
            .map_err(internal)?
            .map_err(Into::into)
        }
    };
}
file_write!(link_file, LinkFileInput);
file_write!(unlink_file, UnlinkFileInput);
file_write!(archive_asset, AssetRequestInput);
file_write!(unarchive_asset, AssetRequestInput);
file_write!(rename_asset, RenameAssetInput);
file_write!(delete_asset, DeleteAssetInput);
file_write!(replace_asset, ReplaceAssetInput);

#[tauri::command]
#[specta::specta]
pub async fn asset_usage(
    context: FolderCommandContext,
    asset_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<AssetUsage, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        manager.with_expected_context(&legacy, Some(&context), |store| {
            store.asset_usage(&asset_id)
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn list_asset_revisions(
    context: FolderCommandContext,
    asset_id: String,
    state: State<'_, DesktopState>,
    manager: State<'_, Arc<ProjectManager>>,
) -> Result<Vec<AssetRevision>, ApiError> {
    let manager = manager.inner().clone();
    let legacy = state.store.clone();
    tokio::task::spawn_blocking(move || {
        manager.with_expected_context(&legacy, Some(&context), |store| {
            store.list_asset_revisions(&asset_id)
        })
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "jam-r12-preview-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &std::path::Path {
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
                    .is_some_and(|s| s.to_string_lossy().starts_with("jam-r12-preview-"))
            {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
    #[derive(Default)]
    struct Scope(std::cell::RefCell<Vec<std::path::PathBuf>>);
    impl PreviewScope for Scope {
        fn allow_file(&self, path: &std::path::Path) -> jam_core::Result<()> {
            self.0.borrow_mut().push(path.to_path_buf());
            Ok(())
        }
    }
    #[test]
    fn preview_adapter_fences_epoch_before_exact_file_scope_grant() {
        let dir = Fixture::new();
        let manager = ProjectManager::new(dir.path().join("fictional-appdata")).unwrap();
        let legacy = Store::open(dir.path().join("legacy.db")).unwrap();
        let handle = manager
            .create(&dir.path().join("Board"), "Board", false)
            .unwrap();
        let path = dir.path().join("image.png");
        std::fs::write(&path, b"synthetic image bytes").unwrap();
        let input=serde_json::from_value::<RegisterFile>(serde_json::json!({"storageType":"linked_file","sourcePath":display_path(&path),"requestId":"native-preview"})).unwrap();
        let asset = handle
            .store
            .register_file(&handle.store.current_member().unwrap().id, input)
            .unwrap()
            .asset
            .unwrap()
            .asset
            .id;
        let context = handle.command_context();
        let scope = Scope::default();
        assert!(matches!(
            preview_asset(
                &manager,
                &legacy,
                &context,
                &asset,
                &LocalPreviewFilesystem,
                &scope
            )
            .unwrap(),
            FilePreview::Media { .. }
        ));
        assert_eq!(*scope.0.borrow(), vec![path.canonicalize().unwrap()]);
        scope.0.borrow_mut().clear();
        manager.open(&handle.folder, false, false).unwrap();
        assert!(matches!(
            preview_asset(
                &manager,
                &legacy,
                &context,
                &asset,
                &LocalPreviewFilesystem,
                &scope
            ),
            Err(jam_core::Error::Conflict)
        ));
        assert!(scope.0.borrow().is_empty());
    }

    #[test]
    fn import_adapter_uses_ui_source_and_rejects_stale_epoch_before_writes() {
        let dir = Fixture::new();
        let manager = ProjectManager::new(dir.path().join("fictional-appdata")).unwrap();
        let legacy = Store::open(dir.path().join("legacy.db")).unwrap();
        let handle = manager
            .create(&dir.path().join("Board"), "Board", false)
            .unwrap();
        let context = handle.command_context();
        let input=serde_json::from_value::<ImportPlanInput>(serde_json::json!({"requestId":"native-import","epics":[{"externalRef":"native-e","title":"Native import"}]})).unwrap();
        let applied = import_at_context(&manager, &legacy, &context, input.clone()).unwrap();
        assert_eq!(applied.counts.created, 1);
        let history = handle
            .store
            .list_import_batches(ImportBatchListInput::default())
            .unwrap();
        assert!(matches!(history[0].source, ImportSource::Ui));
        manager.open(&handle.folder, false, false).unwrap();
        let active = manager.capture_selected().unwrap();
        let revision = active
            .store
            .folder_session_context()
            .unwrap()
            .board_revision;
        assert!(matches!(
            import_at_context(&manager, &legacy, &context, input),
            Err(jam_core::Error::Conflict)
        ));
        assert_eq!(
            active
                .store
                .folder_session_context()
                .unwrap()
                .board_revision,
            revision
        );
        assert_eq!(
            active
                .store
                .list_import_batches(ImportBatchListInput::default())
                .unwrap()
                .len(),
            1
        );
    }
}
