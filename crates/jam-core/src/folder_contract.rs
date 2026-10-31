//! Additive human-side selection and folder preflight contract.
use crate::*;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FolderCommandContext {
    pub instance_id: String,
    pub selection_epoch: u64,
}

impl ProjectHandle {
    pub fn command_context(&self) -> FolderCommandContext {
        FolderCommandContext {
            instance_id: self.instance_id.clone(),
            selection_epoch: self.selection_epoch,
        }
    }
}

impl ProjectManager {
    pub fn preview_project_move(
        &self,
        legacy: &Store,
        project: &str,
        destination: &Path,
    ) -> Result<ProjectMovePreview> {
        let _guard = self.selection_guard()?;
        if let Ok(h) = self.capture_selected()
            && h.project_id == project
        {
            return h.store.preview_project_move(project, destination);
        }
        if let Some(entry) = self
            .registry
            .entries()?
            .into_iter()
            .find(|e| e.project_id == project)
        {
            let folder = Path::new(&entry.canonical_folder);
            if read_manifest(folder)?.0.id != project {
                return Err(invalid(
                    "expectedProjectId",
                    "Registered folder identity changed",
                ));
            }
            return preview_at(&folder.join(".state/board.db"), project, destination);
        }
        legacy.preview_project_move(project, destination)
    }
    /// Legacy onboarding/import/archive can also change selection without select_project.
    pub fn with_legacy_selection_update<T>(
        &self,
        legacy: &Store,
        f: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        let _guard = self.selection_guard()?;
        let before = legacy.active_jam().ok().map(|j| j.id);
        let result = f();
        if before != legacy.active_jam().ok().map(|j| j.id) {
            self.next_epoch();
            *self
                .legacy_selection
                .lock()
                .map_err(|_| invalid("project", "Selection lock poisoned"))? = None;
        }
        result
    }
    pub fn set_folder_rules_checked(
        &self,
        expected_context: Option<&FolderCommandContext>,
        rules: std::collections::BTreeMap<String, String>,
        revision: &str,
    ) -> Result<ProjectFolderInfo> {
        let _guard = self.selection_guard()?;
        let h = self.capture_selected().map_err(|e| {
            if expected_context.is_some() {
                Error::Conflict
            } else {
                e
            }
        })?;
        if expected_context.is_some_and(|e| *e != h.command_context()) {
            return Err(Error::Conflict);
        }
        self.set_folder_rules_inner(&h, rules, revision)
    }
    pub fn move_project_with_context(
        &self,
        legacy: &Arc<Store>,
        input: MoveProject,
        expected: Option<&FolderCommandContext>,
    ) -> Result<MoveReceipt> {
        self.move_project_with_context_check(legacy, input, expected, || Ok(()))
    }
    pub fn move_project_with_context_check(
        &self,
        legacy: &Arc<Store>,
        input: MoveProject,
        expected: Option<&FolderCommandContext>,
        check_owners: impl FnOnce() -> Result<()>,
    ) -> Result<MoveReceipt> {
        let _guard = self.selection_guard()?;
        if let Some(expected) = expected {
            let current = self.selection_context_inner(legacy).map_err(|e| match e {
                Error::NotFound(_) => Error::Conflict,
                other => other,
            })?;
            if *expected != current {
                return Err(Error::Conflict);
            }
            let project = match self.capture_selected() {
                Ok(h) => h.project_id.clone(),
                Err(_) => legacy.active_jam()?.id,
            };
            if project != input.project_id {
                return Err(Error::Conflict);
            }
        }
        check_owners()?;
        let key = format!("move-source:{}", input.request_id);
        let source = if let Some(path) = self.registry.local_setting(&key)? {
            Arc::new(Store::open(path)?)
        } else {
            let source = if let Ok(h) = self.capture_selected()
                && h.project_id == input.project_id
            {
                h.store.clone()
            } else if self
                .registry
                .entries()?
                .iter()
                .any(|e| e.project_id == input.project_id)
            {
                self.resolve_handle(Some(&input.project_id), None)?
                    .store
                    .clone()
            } else {
                Arc::new(legacy.for_project(&input.project_id)?)
            };
            self.registry
                .set_local_setting(&key, &source.path.to_string_lossy())?;
            source
        };
        self.advance_project_move_inner(&source, input, None)
    }
    /// Held through the native write, also excluding all desktop selection changes.
    pub fn with_expected_context<T>(
        &self,
        legacy: &Store,
        expected: Option<&FolderCommandContext>,
        f: impl FnOnce(&Store) -> Result<T>,
    ) -> Result<T> {
        let _guard = self.selection_guard()?;
        let context = self.selection_context_inner(legacy).map_err(|e| match e {
            Error::NotFound(_) if expected.is_some() => Error::Conflict,
            other => other,
        })?;
        if expected.is_some_and(|e| *e != context) {
            return Err(Error::Conflict);
        }
        let store = self
            .capture_selected()
            .map(|h| h.store.clone())
            .unwrap_or_else(|_| Arc::new(legacy.clone()));
        f(&store.selected_snapshot()?)
    }
    pub fn selection_context(&self, legacy: &Store) -> Result<FolderCommandContext> {
        let _guard = self.selection_guard()?;
        self.selection_context_inner(legacy)
    }
    pub(crate) fn selection_context_inner(&self, legacy: &Store) -> Result<FolderCommandContext> {
        if let Ok(h) = self.capture_selected() {
            return Ok(h.command_context());
        }
        let project = legacy.active_jam()?.id;
        let mut selected = self
            .legacy_selection
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))?;
        if selected.as_ref().is_none_or(|(p, _)| *p != project) {
            let instance = legacy.folder_session_context()?.project_instance_id;
            *selected = Some((
                project.clone(),
                FolderCommandContext {
                    instance_id: format!("legacy:{instance}:{project}"),
                    selection_epoch: self.next_epoch(),
                },
            ));
        }
        Ok(selected.as_ref().unwrap().1.clone())
    }
    pub fn select_legacy_project(&self, legacy: &Store, project: &str) -> Result<AppState> {
        let _guard = self.selection_guard()?;
        // Validate the target before closing the current board.
        legacy.for_project(project)?;
        if let Ok(h) = self.capture_selected() {
            self.close_handle_inner(&h)?;
        }
        let state = legacy.select_project(project)?;
        *self
            .legacy_selection
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))? = None;
        self.selection_context_inner(legacy)?;
        Ok(state)
    }
    pub fn remove_recent_project_folder(&self, instance: &str) -> Result<()> {
        let _guard = self.selection_guard()?;
        if self
            .capture_selected()
            .is_ok_and(|h| h.instance_id == instance)
        {
            return Err(invalid(
                "instanceId",
                "Close the current project before removing its recent entry",
            ));
        }
        self.registry.remove(instance)
    }
    pub fn locate_project_folder(
        &self,
        instance: &str,
        expected: &str,
        folder: &Path,
        cloud: bool,
    ) -> Result<Arc<ProjectHandle>> {
        let _guard = self.selection_guard()?;
        let entry = self
            .registry
            .entries()?
            .into_iter()
            .find(|e| e.instance_id == instance)
            .ok_or_else(|| Error::NotFound("Recent project instance".into()))?;
        // Both checks precede open, registration, acknowledgement and any selection change.
        if entry.project_id != expected || read_manifest(folder)?.0.id != expected {
            return Err(invalid(
                "expectedProjectId",
                "Located manifest does not match the expected project identity",
            ));
        }
        // Ignore only the relocated entry for duplicate detection. Do not remove it first.
        let h = self.open_inner(folder, cloud, false, Some((instance, expected)))?;
        if h.instance_id != instance {
            self.registry.remove(instance)?;
        }
        Ok(h)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveInventory {
    pub count: u64,
    pub bytes: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveDestinationPolicy {
    pub allowed: bool,
    pub cloud_acknowledgement_needed: bool,
    pub non_empty: bool,
    pub error_field: Option<String>,
    pub message: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMovePreview {
    pub tasks: MoveInventory,
    pub managed_copies: MoveInventory,
    pub linked_files: MoveInventory,
    pub missing_files: Vec<String>,
    pub missing_file_count: u64,
    pub agent_session_bound: bool,
    pub has_bound_owners: bool,
    pub destination_policy: MoveDestinationPolicy,
}
impl Store {
    /// No receipt, backup, owner-lock creation, snapshot publication or directory creation.
    pub fn preview_project_move(
        &self,
        project: &str,
        destination: &Path,
    ) -> Result<ProjectMovePreview> {
        let scoped = self.for_project(project)?;
        scoped.read(|c| preview_connection(c, &self.path, project, destination))
    }
}
fn preview_at(db: &Path, project: &str, destination: &Path) -> Result<ProjectMovePreview> {
    let connection = rusqlite::Connection::open_with_flags(
        crate::db::sqlite_path(db)?,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let guard = PreviewReadLock::new(connection)?;
    let wal = std::path::PathBuf::from(format!("{}-wal", db.display()));
    let shm = std::path::PathBuf::from(format!("{}-shm", db.display()));
    // The SQLite VFS shared lock prevents checkpoint/replacement of main DB pages.
    // With no WAL at this instant, immutable reads of those pages form a consistent
    // snapshot, even if another writer subsequently appends a new WAL. No sidecars.
    let isolated = if !wal.exists() {
        let path = crate::db::sqlite_path(db)?
            .to_string_lossy()
            .replace('\\', "/");
        let path = path.strip_prefix("//?/").unwrap_or(&path);
        let encoded = path
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"/:-_.~".contains(&b) {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect::<String>();
        Some(rusqlite::Connection::open_with_flags(
            format!("file:{encoded}?mode=ro&immutable=1"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )?)
    } else {
        if !shm.exists() {
            return Err(invalid(
                "projectFolder",
                "Open/recover this project's WAL state before previewing its move",
            ));
        }
        None
    };
    let c = isolated.as_ref().unwrap_or(&guard.connection);
    c.busy_timeout(std::time::Duration::from_secs(5))?;
    c.execute_batch("CREATE TEMP TABLE jam_project_context(project_id TEXT);")?;
    c.execute("INSERT INTO jam_project_context VALUES(?)", [project])?;
    let tx = c.unchecked_transaction()?;
    crate::projects::selected_jam(&tx)?;
    let result = preview_connection(&tx, db, project, destination)?;
    tx.commit()?;
    Ok(result)
}
/// Acquire only SQLite's main-file SHARED lock before the first pager read. This
/// uses the active VFS on every platform and creates no application or SQLite file.
struct PreviewReadLock {
    connection: rusqlite::Connection,
    file: *mut rusqlite::ffi::sqlite3_file,
}
impl PreviewReadLock {
    fn new(connection: rusqlite::Connection) -> Result<Self> {
        let mut file: *mut rusqlite::ffi::sqlite3_file = std::ptr::null_mut();
        // SAFETY: FILE_POINTER writes a borrowed sqlite3_file pointer belonging to
        // this live connection. It remains live until after Drop releases the lock.
        unsafe {
            let code = rusqlite::ffi::sqlite3_file_control(
                connection.handle(),
                c"main".as_ptr(),
                rusqlite::ffi::SQLITE_FCNTL_FILE_POINTER,
                (&mut file as *mut *mut rusqlite::ffi::sqlite3_file).cast(),
            );
            if code != rusqlite::ffi::SQLITE_OK || file.is_null() || (*file).pMethods.is_null() {
                return Err(invalid(
                    "preview",
                    "Cannot capture a read-only SQLite file lock",
                ));
            }
            let lock = (*(*file).pMethods)
                .xLock
                .ok_or_else(|| invalid("preview", "SQLite VFS has no shared file lock"))?;
            if lock(file, rusqlite::ffi::SQLITE_LOCK_SHARED) != rusqlite::ffi::SQLITE_OK {
                return Err(invalid(
                    "preview",
                    "Project checkpoint is busy; retry move preview",
                ));
            }
        }
        Ok(Self { connection, file })
    }
}
impl Drop for PreviewReadLock {
    fn drop(&mut self) {
        // SAFETY: self.connection still owns this VFS file; unlocking precedes close.
        unsafe {
            if let Some(unlock) = (*(*self.file).pMethods).xUnlock {
                unlock(self.file, rusqlite::ffi::SQLITE_LOCK_NONE);
            }
        }
    }
}
fn preview_connection(
    c: &rusqlite::Connection,
    db: &Path,
    project: &str,
    destination: &Path,
) -> Result<ProjectMovePreview> {
    let tasks = {
        let count = c.query_row(
            "SELECT count(*) FROM tasks WHERE jam_id=?",
            [project],
            |r| r.get::<_, i64>(0),
        )? as u64;
        // Logical UTF-8 JSON bytes of task rows; never SQLite page allocation.
        let columns = c
            .prepare("PRAGMA table_info(tasks)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .join(",");
        let rows = crate::board_snapshot::rows(
            c,
            "tasks",
            &columns,
            &format!("WHERE jam_id='{}'", project.replace('\'', "''")),
        )?;
        MoveInventory {
            count,
            bytes: serde_json::to_vec(&rows)?.len() as u64,
        }
    };
    let policy = validate_storage_path(destination, false);
    let (field, message) = match policy {
        Ok(()) => (None, None),
        Err(Error::Validation { field, reason }) => (Some(field), Some(reason)),
        Err(e) => (Some("destination".into()), Some(e.to_string())),
    };
    let destination_exists = destination.exists();
    let non_empty = destination_exists
        && (!destination.is_dir() || std::fs::read_dir(destination)?.next().is_some());
    let owner = crate::project_move::owner_path(db, project);
    let bound = match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(owner)
    {
        Ok(file) => file.try_lock().is_err(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => true, // Unknown ownership is conservatively bound.
    };
    let mut result = ProjectMovePreview {
        tasks,
        managed_copies: MoveInventory::default(),
        linked_files: MoveInventory::default(),
        missing_files: vec![],
        missing_file_count: 0,
        agent_session_bound: false,
        has_bound_owners: bound,
        destination_policy: MoveDestinationPolicy {
            allowed: field.is_none() && !destination_exists,
            cloud_acknowledgement_needed: field.as_deref() == Some("cloudAcknowledged"),
            non_empty,
            error_field: if destination_exists && field.is_none() {
                Some("destination".into())
            } else {
                field
            },
            message: if destination_exists && message.is_none() {
                Some(
                    "Choose a new destination path; move cannot overwrite an existing folder"
                        .into(),
                )
            } else {
                message
            },
        },
    };
    let managed = db.parent().unwrap_or(Path::new(".")).join("references");
    let physical_managed = managed.canonicalize().ok();
    let files = c.prepare("SELECT id,storage_type,coalesce(nullif(stored_path,''),location) FROM assets WHERE jam_id=? ORDER BY id")?.query_map([project], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, String>(2)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
    for (id, storage, stored) in files {
        if storage == "url" {
            continue;
        }
        let resolved = crate::file_model::load_file_with_refresh(c, &id, None, true);
        let resolution = resolved
            .as_ref()
            .map(|file| file.resolution.clone())
            .unwrap_or_else(|_| FileResolution {
                storage_type: storage.clone(),
                path_base: "unknown".into(),
                stored_path: stored.clone(),
                resolved_path: None,
                worktree_root: None,
                resolution_basis: "unresolved".into(),
                status: "unknown".into(),
                checked_at: now(),
            });
        let path = resolution.resolved_path.as_deref().map(Path::new);
        let owned = storage == "board_file"
            || Path::new(&stored).starts_with(&managed)
            || path.is_some_and(|p| {
                p.starts_with(&managed)
                    || physical_managed
                        .as_ref()
                        .is_some_and(|root| p.canonicalize().is_ok_and(|p| p.starts_with(root)))
            });
        let inventory = if owned {
            &mut result.managed_copies
        } else {
            &mut result.linked_files
        };
        inventory.count += 1;
        inventory.bytes += path
            .and_then(|p| p.metadata().ok())
            .filter(|m| m.is_file())
            .map_or(0, |m| m.len());
        if resolution.status != "available" {
            result.missing_file_count += 1;
            if result.missing_files.len() < 100 {
                result.missing_files.push(stored);
            }
        }
    }
    Ok(result)
}
