use crate::*;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryLocator {
    pub root_relative: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub folder_rules: BTreeMap<String, String>,
    pub repository: Option<RepositoryLocator>,
}
pub fn default_folder_rules() -> BTreeMap<String, String> {
    [
        ("sprite", "files/images"),
        ("audio", "files/audio"),
        ("model", "files/models"),
        ("document", "files/docs"),
        ("level", "files/other"),
        ("font", "files/other"),
        ("other", "files/other"),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v.into()))
    .collect()
}
pub(crate) fn folder_for_db(path: &Path) -> Option<PathBuf> {
    (path.file_name()? == "board.db" && path.parent()?.file_name()? == ".state")
        .then(|| path.parent().unwrap().parent().unwrap().to_path_buf())
}
pub fn sqlite_runtime_version() -> String {
    rusqlite::version().into()
}
pub fn check_wal_runtime() -> Result<()> {
    if rusqlite::version_number() < 3_051_003 {
        return Err(invalid(
            "sqlite",
            "Project folders require the WAL-reset fix in SQLite 3.51.3+; dependency upgrade must be authorized separately",
        ));
    }
    Ok(())
}
pub fn read_manifest(folder: &Path) -> Result<(ProjectManifest, String)> {
    let bytes = std::fs::read(folder.join("jamboard.json"))?;
    let m: ProjectManifest = serde_json::from_slice(&bytes)?;
    if m.schema_version != 1 {
        return Err(invalid(
            "schemaVersion",
            "Unsupported manifest version; writable open refused",
        ));
    }
    if m.id.is_empty() {
        return Err(invalid("id", "Manifest needs an exact project ID"));
    }
    validate_rules(folder, &m.folder_rules)?;
    if let Some(repo) = &m.repository {
        let detected = repository_context(folder)?;
        let expected = folder.join(&repo.root_relative).canonicalize()?;
        if detected.as_ref().is_none_or(|(root, _)| *root != expected) {
            return Err(invalid(
                "repository",
                "Manifest repository differs from detected containing repository",
            ));
        }
    }
    Ok((m, crate::storage_io::hash(&bytes)))
}
pub(crate) fn validate_rules(folder: &Path, rules: &BTreeMap<String, String>) -> Result<()> {
    if rules.len() != FILE_KINDS.len() {
        return Err(invalid("folderRules", "Supply every advertised kind"));
    }
    for kind in FILE_KINDS {
        let p = rules
            .get(kind)
            .ok_or_else(|| invalid("folderRules", "Missing kind"))?;
        if !p.starts_with("files/") {
            return Err(invalid("folderRules", "Rules must stay below files/"));
        }
        crate::storage_io::contained(folder, p)?;
    }
    Ok(())
}
pub(crate) fn repository_context(path: &Path) -> Result<Option<(PathBuf, PathBuf)>> {
    let run = |args: &[&str]| -> Option<PathBuf> {
        let out = std::process::Command::new("git")
            .arg("--no-optional-locks")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .ok()?;
        if !out.status.success() || out.stdout.len() > 32768 {
            return None;
        }
        PathBuf::from(String::from_utf8(out.stdout).ok()?.trim())
            .canonicalize()
            .ok()
    };
    let Some(root) = run(&["rev-parse", "--show-toplevel"]) else {
        return Ok(None);
    };
    let Some(common) = run(&["rev-parse", "--path-format=absolute", "--git-common-dir"]) else {
        return Ok(None);
    };
    Ok(Some((root, common)))
}
pub(crate) fn manifest_repository(folder: &Path) -> Result<Option<RepositoryLocator>> {
    let Some((root, _)) = repository_context(folder)? else {
        return Ok(None);
    };
    let folder = folder.canonicalize()?;
    let depth = folder
        .strip_prefix(root)
        .map_err(|_| invalid("repository", "Detected root does not contain folder"))?
        .components()
        .count();
    Ok(Some(RepositoryLocator {
        root_relative: if depth == 0 {
            ".".into()
        } else {
            vec![".."; depth].join("/")
        },
    }))
}
pub fn validate_storage_path(path: &Path, cloud_acknowledged: bool) -> Result<()> {
    let raw = path.to_string_lossy();
    let normal = raw.replace('/', "\\");
    if normal.starts_with("\\\\") && !normal.starts_with("\\\\?\\")
        || normal.to_ascii_lowercase().starts_with("\\\\?\\unc\\")
    {
        return Err(invalid(
            "projectFolder",
            "Remote/UNC storage is refused; choose a local disk",
        ));
    }
    if !path.is_absolute() {
        return Err(invalid(
            "projectFolder",
            "Use an absolute local path, not a drive-relative path",
        ));
    }
    for part in path.components() {
        if let std::path::Component::Normal(p) = part
            && crate::file_model::reserved_name(&p.to_string_lossy())
        {
            return Err(invalid("projectFolder", "Reserved device name"));
        }
    }
    let mut ancestor = path;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| invalid("projectFolder", "No existing parent"))?;
    }
    let physical = ancestor.canonicalize()?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetVolumePathNameW(path: *const u16, volume: *mut u16, len: u32) -> i32;
            fn GetDriveTypeW(root: *const u16) -> u32;
            fn GetFileAttributesW(path: *const u16) -> u32;
        }
        let p: Vec<_> = physical.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut volume = vec![0u16; 32768];
        if unsafe { GetVolumePathNameW(p.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        if unsafe { GetDriveTypeW(volume.as_ptr()) } != 3 {
            return Err(invalid(
                "projectFolder",
                "Only fixed local storage is supported",
            ));
        }
        let attrs = unsafe { GetFileAttributesW(p.as_ptr()) };
        if attrs == u32::MAX || attrs & (0x1000 | 0x40000 | 0x400000) != 0 {
            return Err(invalid(
                "projectFolder",
                "Offline/cloud placeholder storage is refused",
            ));
        }
    }
    #[cfg(unix)]
    {
        // Refuse known network mount types, including paths reached through symlinks.
        if let Ok(mounts) = std::fs::read_to_string("/proc/mounts") {
            for line in mounts.lines() {
                let cols: Vec<_> = line.split_whitespace().collect();
                if cols.len() > 2
                    && ["nfs", "nfs4", "cifs", "smbfs", "sshfs", "fuse.sshfs"].contains(&cols[2])
                    && physical.starts_with(cols[1])
                {
                    return Err(invalid("projectFolder", "Remote storage is refused"));
                }
            }
        }
    }
    let cloud = format!("{} {}", raw, physical.display()).to_lowercase();
    if [
        "onedrive",
        "dropbox",
        "google drive",
        "googledrive",
        "icloud",
    ]
    .iter()
    .any(|s| cloud.contains(s))
        && !cloud_acknowledged
    {
        return Err(invalid(
            "cloudAcknowledged",
            "Sync may copy DB/WAL/SHM separately; explicitly acknowledge this risk or choose local storage",
        ));
    }
    Ok(())
}
pub struct ProjectHandle {
    pub instance_id: String,
    pub project_id: String,
    pub folder: PathBuf,
    pub store: Arc<Store>,
    pub selection_epoch: u64,
    pub database_generation: String,
    pub feed: Arc<Mutex<ChangeFeed>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderInfo {
    pub context: FolderCommandContext,
    pub last_snapshot_at: Option<String>,
    pub instance_id: String,
    pub project_id: String,
    pub folder: String,
    pub selection_epoch: u64,
    pub database_generation: String,
    pub manifest: ProjectManifest,
    pub manifest_revision: String,
    pub sqlite_version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileCapabilities {
    pub storage_types: Vec<String>,
    pub kinds: Vec<String>,
    pub roles: Vec<String>,
    pub legacy_copy_limit_bytes: i64,
    pub tools: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FolderSessionContext {
    pub project_instance_id: String,
    pub database_generation: String,
    pub board_revision: i64,
    pub project_folder: Option<String>,
    pub repository_root: Option<String>,
    pub working_directory: Option<String>,
    pub folder_rules: BTreeMap<String, String>,
    pub manifest_revision: Option<String>,
    pub file_capabilities: FileCapabilities,
}
impl ProjectHandle {
    pub fn info(&self) -> Result<ProjectFolderInfo> {
        let (manifest, manifest_revision) = read_manifest(&self.folder)?;
        Ok(ProjectFolderInfo {
            context: self.command_context(),
            last_snapshot_at: self.store.setting("local.last_snapshot_at")?,
            instance_id: self.instance_id.clone(),
            project_id: self.project_id.clone(),
            folder: self.folder.to_string_lossy().into(),
            selection_epoch: self.selection_epoch,
            database_generation: self.database_generation.clone(),
            manifest,
            manifest_revision,
            sqlite_version: sqlite_runtime_version(),
        })
    }
}
pub struct ProjectManager {
    pub registry: Arc<ProjectRegistry>,
    selected: Mutex<Option<Arc<ProjectHandle>>>,
    epoch: AtomicU64,
    selection_gate: Mutex<()>,
    pub(crate) legacy_selection: Mutex<Option<(String, FolderCommandContext)>>,
}
impl ProjectManager {
    pub fn new(data_dir: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            registry: Arc::new(ProjectRegistry::open(data_dir)?),
            selected: Mutex::new(None),
            epoch: AtomicU64::new(0),
            selection_gate: Mutex::new(()),
            legacy_selection: Mutex::new(None),
        })
    }
    pub(crate) fn selection_guard(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.selection_gate
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))
    }
    pub(crate) fn next_epoch(&self) -> u64 {
        self.epoch.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub fn capture_selected(&self) -> Result<Arc<ProjectHandle>> {
        self.selected
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))?
            .clone()
            .ok_or_else(|| Error::NotFound("No folder project selected".into()))
    }
    pub fn resolve_handle(
        &self,
        project: Option<&str>,
        folder: Option<&Path>,
    ) -> Result<Arc<ProjectHandle>> {
        if folder.is_none()
            && let Ok(h) = self.capture_selected()
            && project.is_none_or(|p| p == h.project_id)
        {
            return Ok(h);
        }
        let path = if let Some(folder) = folder {
            let (manifest, _) = read_manifest(folder)?;
            if project.is_some_and(|p| p != manifest.id) {
                return Err(invalid(
                    "project",
                    "Folder manifest does not match the exact project ID",
                ));
            }
            folder.to_path_buf()
        } else {
            PathBuf::from(
                self.registry
                    .resolve(
                        project.ok_or_else(|| invalid("project", "Select an exact project ID"))?,
                        None,
                    )?
                    .canonical_folder,
            )
        };
        let cloud_key = format!("cloud_ack:{}", path.canonicalize()?.display());
        let acknowledged = self.registry.local_setting(&cloud_key)?.as_deref() == Some("true");
        // Resolving an MCP connection must not change the desktop selection.
        ProjectManager::new(&self.registry.data_dir)?.open(&path, acknowledged, false)
    }
    pub fn open_registered(&self, project: &str) -> Result<Arc<ProjectHandle>> {
        let entry = self.registry.resolve(project, None)?;
        let folder = Path::new(&entry.canonical_folder);
        let acknowledged = self
            .registry
            .local_setting(&format!("cloud_ack:{}", folder.canonicalize()?.display()))?
            .as_deref()
            == Some("true");
        self.open(folder, acknowledged, false)
    }
    pub fn create(
        &self,
        folder: &Path,
        name: &str,
        cloud_acknowledged: bool,
    ) -> Result<Arc<ProjectHandle>> {
        self.create_initialized(folder, name, cloud_acknowledged, None)
    }
    pub fn create_initialized(
        &self,
        folder: &Path,
        name: &str,
        cloud_acknowledged: bool,
        initialization: Option<NewJamInput>,
    ) -> Result<Arc<ProjectHandle>> {
        let _guard = self.selection_guard()?;
        check_wal_runtime()?;
        validate_storage_path(folder, cloud_acknowledged)?;
        crate::m5::validate_name("name", name, 140)?;
        let existing_empty = folder.is_dir() && std::fs::read_dir(folder)?.next().is_none();
        if folder.exists() && !existing_empty {
            return Err(invalid(
                "projectFolder",
                "Destination already exists; choose a new folder",
            ));
        }
        let parent = folder
            .parent()
            .ok_or_else(|| invalid("projectFolder", "Missing parent"))?;
        std::fs::create_dir_all(parent)?;
        let stage = parent.join(format!(".jam-create-{}", id()));
        std::fs::create_dir(&stage)?;
        let result = (|| {
            initialize_layout(&stage)?;
            let store = Store::open(stage.join(".state/board.db"))?;
            let project = if let Some(mut input) = initialization {
                if input.name != name {
                    return Err(invalid(
                        "name",
                        "Initialization name must match the folder name",
                    ));
                }
                input.name = name.into();
                store
                    .onboard(input)?
                    .jam
                    .ok_or_else(|| invalid("initialization", "No project created"))?
            } else {
                store.create_jam(name, None, None, None, "UTC", "Owner")?.0
            };
            let manifest = ProjectManifest {
                schema_version: 1,
                id: project.id,
                name: name.into(),
                folder_rules: default_folder_rules(),
                repository: manifest_repository(&stage)?,
            };
            crate::storage_io::atomic_write(
                &stage.join("jamboard.json"),
                &serde_json::to_vec_pretty(&manifest)?,
            )?;
            set_folder_metadata(&store, &stage)?;
            store.flush_board_snapshot()?;
            drop(store);
            if existing_empty {
                std::fs::remove_dir(folder)?;
            }
            publish_staged_folder(&stage, folder)?;
            self.open_inner(folder, cloud_acknowledged, false, None)
        })();
        if result.is_err() && stage.exists() {
            crate::board_snapshot::quiesce(&stage);
            let resolved = stage.canonicalize()?;
            if std::fs::symlink_metadata(&stage)?.file_type().is_symlink()
                || resolved.parent() != Some(parent.canonicalize()?.as_path())
            {
                return Err(invalid(
                    "operation",
                    "Staging path changed; cleanup refused",
                ));
            }
            std::fs::remove_dir_all(resolved)?;
        }
        result
    }
    pub fn open(
        &self,
        folder: &Path,
        cloud_acknowledged: bool,
        separate_copy: bool,
    ) -> Result<Arc<ProjectHandle>> {
        let _guard = self.selection_guard()?;
        self.open_inner(folder, cloud_acknowledged, separate_copy, None)
    }
    pub(crate) fn open_inner(
        &self,
        folder: &Path,
        cloud_acknowledged: bool,
        separate_copy: bool,
        relocated_instance: Option<(&str, &str)>,
    ) -> Result<Arc<ProjectHandle>> {
        check_wal_runtime()?;
        validate_storage_path(folder, cloud_acknowledged)?;
        let folder = folder.canonicalize()?;
        let (mut manifest, _) = read_manifest(&folder)?;
        if relocated_instance.is_some_and(|(_, expected)| manifest.id != expected) {
            return Err(invalid(
                "expectedProjectId",
                "Located manifest does not match the expected project identity",
            ));
        }
        if folder.join(".state/board.db").is_file() {
            crate::storage_io::contained(&folder, ".state/board.db")?;
        }
        reconcile_move_receipt(&folder)?;
        if cloud_acknowledged {
            self.registry
                .set_local_setting(&format!("cloud_ack:{}", folder.display()), "true")?;
        }
        let repo = repository_context(&folder)?;
        let existing_db = folder.join(".state/board.db");
        if existing_db.is_file() {
            let c = rusqlite::Connection::open_with_flags(
                crate::db::sqlite_path(&existing_db)?,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            if c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? == 9 {
                let moved: Option<String> = c.query_row(
                    "SELECT moved_to FROM jams WHERE id=?",
                    [&manifest.id],
                    |r| r.get(0),
                )?;
                if let Some(destination) = moved {
                    let target = Path::new(&destination).canonicalize()?;
                    if target == folder || read_manifest(&target)?.0.id != manifest.id {
                        return Err(invalid("move", "Invalid moved-project redirect"));
                    }
                    drop(c);
                    return self.open_inner(&target, cloud_acknowledged, false, relocated_instance);
                }
                let receipt_path = folder.join(".state/operations/move-owner.json");
                if receipt_path.is_file() {
                    let receipt: serde_json::Value =
                        serde_json::from_slice(&std::fs::read(&receipt_path)?)?;
                    if receipt["committed"] == true
                        && receipt["destination"].as_str().is_some_and(|p| {
                            Path::new(p).canonicalize().ok().as_deref() == Some(&folder)
                        })
                    {
                        let instance_id =
                            c.query_row("SELECT instance_id FROM board_meta", [], |r| r.get(0))?;
                        let entry = RegistryEntry {
                            instance_id,
                            project_id: manifest.id.clone(),
                            project_name: manifest.name.clone(),
                            canonical_folder: folder.to_string_lossy().into(),
                            display_folder: folder.to_string_lossy().into(),
                            repo_common_dir: repo
                                .as_ref()
                                .map(|(_, common)| common.to_string_lossy().into()),
                            last_opened_at: now(),
                            availability: "available".into(),
                            migration_id: receipt["id"].as_str().map(str::to_owned),
                        };
                        let old = receipt["sourceDatabase"]
                            .as_str()
                            .and_then(|p| folder_for_db(Path::new(p)));
                        self.registry
                            .relocate(&manifest.id, old.as_deref(), &entry)?;
                    }
                }
            }
        }
        for e in self.registry.entries()? {
            if relocated_instance.is_some_and(|(instance, _)| instance == e.instance_id) {
                continue;
            }
            if e.project_id == manifest.id && Path::new(&e.canonical_folder) != folder {
                if repo
                    .as_ref()
                    .is_some_and(|(_, c)| e.repo_common_dir.as_deref() == c.to_str())
                {
                    return self.open_inner(
                        Path::new(&e.canonical_folder),
                        cloud_acknowledged,
                        false,
                        relocated_instance,
                    );
                }
                if !separate_copy {
                    return Err(invalid(
                        "duplicateProjectId",
                        &format!(
                            "Open registered board at {} or explicitly open as a separate copy",
                            e.display_folder
                        ),
                    ));
                }
                manifest.id = id();
                break;
            }
        }
        let db = folder.join(".state/board.db");
        if !db.is_file() {
            return Err(invalid(
                "recoveryRequired",
                "Local DB is absent; explicitly recover from board.json",
            ));
        }
        crate::storage_io::contained(&folder, ".state/board.db")?;
        validate_storage_path(&folder.join(".state"), cloud_acknowledged)?;
        probe_storage(&folder)?;
        let _maintenance = crate::storage_io::lock(&folder.join(".state/maintenance.lock"))?;
        check_tracked_state(&folder)?;
        let mut store = Store::open(&db)?;
        recover_rules_receipt(&store, &folder)?;
        let (_, current_hash) = read_manifest(&folder)?;
        let known = store.read(|c| {
            Ok(
                c.query_row("SELECT manifest_hash FROM board_meta", [], |r| {
                    r.get::<_, Option<String>>(0)
                })?,
            )
        })?;
        if known.as_deref().is_some_and(|h| h != current_hash) {
            return Err(invalid(
                "staleManifest",
                "Manifest changed externally; compare/recover before opening writable state",
            ));
        }
        if separate_copy {
            let old = store.active_jam()?.id;
            if old != manifest.id {
                store.reidentify_folder(&old, &manifest.id)?;
                store = Store::open(&db)?;
                crate::storage_io::atomic_write(
                    &folder.join("jamboard.json"),
                    &serde_json::to_vec_pretty(&manifest)?,
                )?;
            }
        }
        let mut scoped = store.for_project(&manifest.id)?;
        scoped.app_data_dir = Some(self.registry.data_dir.canonicalize()?);
        let store = Arc::new(scoped);
        if store
            .read(|c| Ok(c.query_row("SELECT count(*) FROM jams", [], |r| r.get::<_, i64>(0))?))?
            != 1
        {
            return Err(invalid(
                "database",
                "Folder DB must contain exactly one project",
            ));
        }
        set_folder_metadata(&store, &folder)?;
        store.reconcile_file_operations()?;
        crate::storage_io::integrity(&crate::db::connect(&db)?)?;
        let (instance_id, generation) = store.read(|c| {
            Ok(c.query_row(
                "SELECT instance_id,database_generation FROM board_meta",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?)
        })?;
        let feed = Arc::new(Mutex::new(ChangeFeed::open(
            &store.path,
            store.latest_seq()?,
        )?));
        let handle = Arc::new(ProjectHandle {
            feed,
            instance_id,
            project_id: manifest.id.clone(),
            folder: folder.clone(),
            store,
            selection_epoch: self.epoch.fetch_add(1, Ordering::SeqCst) + 1,
            database_generation: generation,
        });
        self.registry.register(&RegistryEntry {
            instance_id: handle.instance_id.clone(),
            project_id: manifest.id,
            project_name: handle.store.active_jam()?.name,
            canonical_folder: folder.to_string_lossy().into(),
            display_folder: folder.to_string_lossy().into(),
            repo_common_dir: repo.map(|(_, c)| c.to_string_lossy().into()),
            last_opened_at: now(),
            availability: "available".into(),
            migration_id: None,
        })?;
        *self
            .legacy_selection
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))? = None;
        *self
            .selected
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))? = Some(handle.clone());
        crate::board_snapshot::schedule(&folder);
        Ok(handle)
    }
    pub fn close(&self) -> Result<()> {
        let h = self.capture_selected()?;
        self.close_handle(&h)
    }
    pub fn close_handle(&self, h: &Arc<ProjectHandle>) -> Result<()> {
        let _guard = self.selection_guard()?;
        self.close_handle_inner(h)
    }
    pub(crate) fn close_handle_inner(&self, h: &Arc<ProjectHandle>) -> Result<()> {
        h.store.flush_board_snapshot()?;
        if h.store.read(|c| {
            Ok(c.query_row(
                "SELECT board_revision>backup_revision FROM board_meta",
                [],
                |r| r.get::<_, bool>(0),
            )?)
        })? {
            h.store.backup_board("close", false)?;
        }
        let mut selected = self
            .selected
            .lock()
            .map_err(|_| invalid("project", "Selection lock poisoned"))?;
        if selected.as_ref().is_some_and(|s| Arc::ptr_eq(s, h)) {
            *selected = None;
        }
        self.epoch.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    pub fn set_folder_rules(
        &self,
        rules: BTreeMap<String, String>,
        expected: &str,
    ) -> Result<ProjectFolderInfo> {
        let h = self.capture_selected()?;
        self.set_folder_rules_for(&h, rules, expected)
    }
    pub fn set_folder_rules_for(
        &self,
        h: &Arc<ProjectHandle>,
        rules: BTreeMap<String, String>,
        expected: &str,
    ) -> Result<ProjectFolderInfo> {
        let _guard = self.selection_guard()?;
        if self.capture_selected()?.command_context() != h.command_context() {
            return Err(Error::Conflict);
        }
        self.set_folder_rules_inner(h, rules, expected)
    }
    pub(crate) fn set_folder_rules_inner(
        &self,
        h: &Arc<ProjectHandle>,
        rules: BTreeMap<String, String>,
        expected: &str,
    ) -> Result<ProjectFolderInfo> {
        let _lock = crate::storage_io::lock(&h.folder.join(".state/maintenance.lock"))?;
        let (mut m, hash) = read_manifest(&h.folder)?;
        if hash != expected {
            return Err(Error::Conflict);
        }
        validate_rules(&h.folder, &rules)?;
        m.folder_rules = rules;
        crate::storage_io::atomic_write(
            &h.folder.join(".state/operations/folder-rules.json"),
            &serde_json::to_vec_pretty(&serde_json::json!({"expectedHash":hash,"manifest":m}))?,
        )?;
        crate::storage_io::atomic_write(
            &h.folder.join("jamboard.json"),
            &serde_json::to_vec_pretty(&m)?,
        )?;
        set_folder_metadata(&h.store, &h.folder)?;
        std::fs::remove_file(h.folder.join(".state/operations/folder-rules.json"))?;
        h.info()
    }
}
pub(crate) fn initialize_layout(folder: &Path) -> Result<()> {
    for p in [
        ".state/operations",
        ".state/backups",
        ".state/thumbs",
        "files/images",
        "files/audio",
        "files/models",
        "files/docs",
        "files/other",
    ] {
        std::fs::create_dir_all(folder.join(p))?;
    }
    let ignore = folder.join(".gitignore");
    let mut text = match std::fs::read_to_string(&ignore) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    if !text.lines().any(|l| l.trim() == "/.state/") {
        let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
        if !text.is_empty() && !text.ends_with('\n') {
            text.push_str(newline);
        }
        text.push_str("/.state/");
        text.push_str(newline);
        crate::storage_io::atomic_write(&ignore, text.as_bytes())?;
    }
    Ok(())
}
pub(crate) fn publish_staged_folder(stage: &Path, destination: &Path) -> Result<()> {
    crate::board_snapshot::quiesce(stage);
    let snapshot = crate::storage_io::lock(&stage.join(".state/snapshot.lock"))?;
    let maintenance = crate::storage_io::lock(&stage.join(".state/maintenance.lock"))?;
    let db = crate::db::connect(&stage.join(".state/board.db"))?;
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    drop(db);
    drop(maintenance);
    drop(snapshot);
    let stage = stage.canonicalize()?;
    let destination = destination
        .parent()
        .ok_or_else(|| invalid("destination", "Missing parent"))?
        .canonicalize()?
        .join(
            destination
                .file_name()
                .ok_or_else(|| invalid("destination", "Missing filename"))?,
        );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match std::fs::rename(&stage, &destination) {
            Ok(()) => return Ok(()),
            Err(e)
                if e.kind() == std::io::ErrorKind::PermissionDenied
                    && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(std::time::Duration::from_millis(50))
            }
            Err(e) => {
                return Err(invalid(
                    "publishRename",
                    &format!("Cannot publish staged folder; retry the operation: {e}"),
                ));
            }
        }
    }
}
fn reconcile_move_receipt(folder: &Path) -> Result<()> {
    let path = folder.join(".state/operations/move-owner.json");
    if !path.is_file() {
        return Ok(());
    }
    let mut receipt: serde_json::Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    if receipt["committed"] == true {
        return Ok(());
    }
    let source = receipt["sourceDatabase"]
        .as_str()
        .ok_or_else(|| invalid("move", "Move receipt has no source authority"))?;
    let c = rusqlite::Connection::open_with_flags(
        crate::db::sqlite_path(Path::new(source))?,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    use rusqlite::OptionalExtension;
    let committed=c.query_row("SELECT destination FROM project_moves WHERE id=? AND project_id=? AND state='committed'",rusqlite::params![receipt["id"].as_str(),receipt["projectId"].as_str()],|r|r.get::<_,String>(0)).optional()?;
    if committed
        .as_ref()
        .is_none_or(|p| Path::new(p).canonicalize().ok().as_deref() != Some(folder))
    {
        return Err(invalid(
            "moveInProgress",
            "Source remains the move authority; resume or roll back its operation before opening this destination",
        ));
    }
    receipt["committed"] = serde_json::json!(true);
    crate::storage_io::atomic_write(&path, &serde_json::to_vec(&receipt)?)?;
    Ok(())
}
fn probe_storage(folder: &Path) -> Result<()> {
    let path = folder.join(format!(".state/storage-probe-{}", id()));
    let first = std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&path)?;
    let result = (|| {
        first
            .try_lock()
            .map_err(|_| invalid("storage", "Filesystem lock probe failed"))?;
        let second = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)?;
        if second.try_lock().is_ok() {
            return Err(invalid(
                "storage",
                "Filesystem does not enforce exclusive locks",
            ));
        }
        drop(second);
        Ok(())
    })();
    drop(first);
    std::fs::remove_file(&path)?;
    result?;
    let probe = folder.join(format!(".state/replace-probe-{}", id()));
    let result = (|| {
        crate::storage_io::atomic_write(&probe, b"before")?;
        crate::storage_io::atomic_write(&probe, b"after")?;
        if std::fs::read(&probe)? != b"after" {
            return Err(invalid("storage", "Atomic replace probe failed"));
        }
        Ok(())
    })();
    if probe.exists() {
        std::fs::remove_file(probe)?;
    }
    result
}
pub(crate) fn set_folder_metadata(store: &Store, folder: &Path) -> Result<()> {
    let (_, hash) = read_manifest(folder)?;
    store.write(|c| {
        c.execute("UPDATE board_meta SET manifest_hash=?", [hash])?;
        Ok(())
    })?;
    Ok(())
}
pub(crate) fn recover_rules_receipt(store: &Store, folder: &Path) -> Result<()> {
    let path = folder.join(".state/operations/folder-rules.json");
    if !path.is_file() {
        return Ok(());
    }
    let receipt: serde_json::Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    let manifest: ProjectManifest = serde_json::from_value(receipt["manifest"].clone())?;
    validate_rules(folder, &manifest.folder_rules)?;
    let (current, hash) = read_manifest(folder)?;
    if current.id != manifest.id {
        return Err(invalid("manifest", "Rules receipt identity mismatch"));
    }
    let bytes = serde_json::to_vec_pretty(&manifest)?;
    let new_hash = crate::storage_io::hash(&bytes);
    if Some(hash.as_str()) != receipt["expectedHash"].as_str() && hash != new_hash {
        return Err(invalid(
            "staleManifest",
            "External manifest edit conflicts with pending rules update",
        ));
    }
    crate::storage_io::atomic_write(&folder.join("jamboard.json"), &bytes)?;
    set_folder_metadata(store, folder)?;
    std::fs::remove_file(path)?;
    Ok(())
}
fn check_tracked_state(folder: &Path) -> Result<()> {
    let Some((root, _)) = repository_context(folder)? else {
        return Ok(());
    };
    let dot = root.join(".git");
    let git_dir = if dot.is_dir() {
        dot
    } else {
        let text = std::fs::read_to_string(dot)?;
        root.join(
            text.trim()
                .strip_prefix("gitdir: ")
                .ok_or_else(|| invalid("git", "Invalid gitdir file"))?,
        )
    };
    let data = match std::fs::read(git_dir.join("index")) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if data.len() < 12 || &data[..4] != b"DIRC" {
        return Err(invalid("git", "Cannot verify that .state is untracked"));
    }
    let version = u32::from_be_bytes(data[4..8].try_into().unwrap());
    if !(2..=4).contains(&version) {
        return Err(invalid(
            "git",
            "Unsupported index format; cannot verify .state isolation",
        ));
    }
    let count = u32::from_be_bytes(data[8..12].try_into().unwrap());
    let mut offset = 12;
    let mut previous = Vec::<u8>::new();
    let relative = folder
        .strip_prefix(&root)
        .map_err(|_| invalid("git", "Folder is outside detected repo"))?
        .to_string_lossy()
        .replace('\\', "/");
    let prefix = if relative.is_empty() {
        ".state".to_owned()
    } else {
        format!("{relative}/.state")
    };
    for _ in 0..count {
        let start = offset;
        if offset + 62 > data.len() {
            return Err(invalid("git", "Truncated git index"));
        }
        let flags = u16::from_be_bytes(data[offset + 60..offset + 62].try_into().unwrap());
        offset += 62;
        if flags & 0x4000 != 0 {
            offset += 2;
        }
        let mut remove = 0usize;
        if version == 4 {
            loop {
                let b = *data
                    .get(offset)
                    .ok_or_else(|| invalid("git", "Truncated compressed index"))?;
                offset += 1;
                remove = (remove << 7) + (b & 0x7f) as usize;
                if b & 0x80 == 0 {
                    break;
                }
                remove += 1;
            }
        }
        let end = data
            .get(offset..)
            .and_then(|s| s.iter().position(|b| *b == 0))
            .map(|n| n + offset)
            .ok_or_else(|| invalid("git", "Invalid index path"))?;
        let mut path = if version == 4 {
            previous[..previous
                .len()
                .checked_sub(remove)
                .ok_or_else(|| invalid("git", "Invalid compressed index"))?]
                .to_vec()
        } else {
            Vec::new()
        };
        path.extend_from_slice(&data[offset..end]);
        previous = path.clone();
        offset = end + 1;
        if version != 4 {
            offset = start + (offset - start).div_ceil(8) * 8;
        }
        let path = String::from_utf8(path).map_err(|_| {
            invalid(
                "git",
                "Non-UTF8 index path; .state tracking status is unknown",
            )
        })?;
        if path == prefix || path.starts_with(&format!("{prefix}/")) {
            return Err(invalid(
                "git",
                ".state is already tracked; remove it from tracking before writable setup (the app does not run git rm)",
            ));
        }
    }
    Ok(())
}
impl Store {
    pub fn folder_session_context(&self) -> Result<FolderSessionContext> {
        self.read(|c| {
            let (instance, generation, revision) = c.query_row(
                "SELECT instance_id,database_generation,board_revision FROM board_meta",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            let folder = folder_for_db(&self.path);
            let manifest = folder.as_deref().map(read_manifest).transpose()?;
            let root = folder
                .as_deref()
                .map(repository_context)
                .transpose()?
                .flatten()
                .map(|(root, _)| root.to_string_lossy().into_owned());
            let project = crate::projects::selected_jam(c)?;
            use rusqlite::OptionalExtension;
            let working_directory = c
                .query_row(
                    "SELECT value FROM settings WHERE key=?",
                    [format!("board.{}.working_directory", project.id)],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(FolderSessionContext {
                project_instance_id: instance,
                database_generation: generation,
                board_revision: revision,
                project_folder: folder.map(|p| p.to_string_lossy().into()),
                repository_root: root,
                working_directory,
                folder_rules: manifest
                    .as_ref()
                    .map(|(m, _)| m.folder_rules.clone())
                    .unwrap_or_default(),
                manifest_revision: manifest.map(|(_, hash)| hash),
                file_capabilities: FileCapabilities {
                    storage_types: ["board_file", "linked_file", "url"]
                        .map(str::to_owned)
                        .into(),
                    kinds: FILE_KINDS.map(str::to_owned).into(),
                    roles: FILE_ROLES.map(str::to_owned).into(),
                    legacy_copy_limit_bytes: 50 * 1024 * 1024,
                    tools: [
                        "register_file",
                        "link_task_file",
                        "set_task_file_role",
                        "unlink_task_file",
                        "resolve_file",
                    ]
                    .map(str::to_owned)
                    .into(),
                },
            })
        })
    }
    pub fn validate_session_generation(&self, expected: &str) -> Result<()> {
        self.read(|c| {
            crate::project_move::check_writable(c)?;
            let actual: String =
                c.query_row("SELECT database_generation FROM board_meta", [], |r| {
                    r.get(0)
                })?;
            if actual != expected {
                return Err(Error::Forbidden(
                    "Database generation changed; reconnect and reconcile your baseline".into(),
                ));
            }
            Ok(())
        })
    }
    pub(crate) fn reidentify_folder(&self, old: &str, new: &str) -> Result<()> {
        let snapshot_hash = folder_for_db(&self.path)
            .and_then(|f| std::fs::read(f.join("board.json")).ok())
            .map(|bytes| crate::storage_io::hash(&bytes));
        self.write(|c| {
            c.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
            for table in [
                "jams",
                "tasks",
                "assets",
                "epics",
                "stories",
                "questions",
                "ref_items",
                "ref_frames",
                "ref_edges",
                "activity",
                "project_members",
                "task_idempotency",
                "execution_states",
                "execution_requests",
            ] {
                let col = if table == "jams" { "id" } else { "jam_id" };
                c.execute(
                    &format!("UPDATE {table} SET {col}=? WHERE {col}=?"),
                    [new, old],
                )?;
            }
            c.execute(
                "UPDATE questions SET scope_id=? WHERE scope_type='project' AND scope_id=?",
                [new, old],
            )?;
            for table in ["file_operations", "project_moves"] {
                c.execute(
                    &format!("UPDATE {table} SET project_id=? WHERE project_id=?"),
                    [new, old],
                )?;
            }
            let settings = c
                .prepare("SELECT key,value FROM settings")?
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for (key, value) in settings {
                for (from, to) in [
                    (format!("board.{old}."), format!("board.{new}.")),
                    (format!("project.{old}."), format!("project.{new}.")),
                    (
                        format!("canvas_viewport:{old}:"),
                        format!("canvas_viewport:{new}:"),
                    ),
                ] {
                    if let Some(suffix) = key.strip_prefix(&from) {
                        crate::projects::put_setting(c, &format!("{to}{suffix}"), &value)?;
                        c.execute("DELETE FROM settings WHERE key=?", [&key])?;
                    }
                }
            }
            c.execute(
                "UPDATE execution_states SET own_state='paused',revision=revision+1",
                [],
            )?;
            c.execute(
                "UPDATE execution_requests SET status='superseded' WHERE status='pending'",
                [],
            )?;
            c.execute(
                "UPDATE settings SET value=? WHERE key='current_project_id'",
                [new],
            )?;
            c.execute(
                "UPDATE board_meta SET instance_id=?,database_generation=?,snapshot_hash=?",
                rusqlite::params![id(), id(), snapshot_hash],
            )?;
            Ok(())
        })
    }
    pub fn flush_board_snapshot(&self) -> Result<()> {
        if let Some(folder) = folder_for_db(&self.path) {
            crate::board_snapshot::publish(&folder)?;
        }
        Ok(())
    }
}
