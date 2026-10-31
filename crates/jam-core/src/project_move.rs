use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveProject {
    pub project_id: String,
    pub destination: String,
    pub request_id: String,
    pub cloud_acknowledged: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveReceipt {
    pub id: String,
    pub project_id: String,
    pub state: String,
    pub destination: String,
    pub staging: String,
    pub source_backup: String,
    pub source_digest: String,
    pub destination_digest: String,
    pub table_counts: std::collections::BTreeMap<String, usize>,
    pub file_hashes: std::collections::BTreeMap<String, String>,
    pub byte_total: u64,
    pub unresolved_links: Vec<String>,
    pub error: Option<String>,
}
/// MCP and desktop runtimes retain a shared owner lock. Move/recovery needs exclusive ownership.
pub struct ProjectLease {
    _file: File,
}
impl Store {
    pub fn project_lease(&self) -> Result<ProjectLease> {
        let project = self.active_jam()?.id;
        let path = owner_path(&self.path, &project);
        let f = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)?;
        f.try_lock_shared().map_err(|_| {
            invalid(
                "project",
                "Project is moving/recovering; reconnect afterwards",
            )
        })?;
        self.read(check_writable)?;
        Ok(ProjectLease { _file: f })
    }
    pub fn project_operation_status(&self, request: &str) -> Result<MoveReceipt> {
        self.read(|c| {
            let json: String = c.query_row(
                "SELECT receipt_json FROM project_moves WHERE id=?",
                [request],
                |r| r.get(0),
            )?;
            Ok(serde_json::from_str(&json)?)
        })
    }
}
pub(crate) fn owner_path(db: &Path, project: &str) -> PathBuf {
    db.parent().unwrap_or(Path::new(".")).join(format!(
        "project-{}.owners.lock",
        crate::storage_io::hash(project.as_bytes())
    ))
}
pub(crate) fn check_writable(c: &Connection) -> Result<()> {
    let project = crate::projects::bound_project(c)?.or_else(|| {
        c.query_row(
            "SELECT value FROM settings WHERE key='current_project_id'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    });
    if let Some(project) = project {
        if let Some(dest) = c
            .query_row("SELECT moved_to FROM jams WHERE id=?", [&project], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .flatten()
        {
            return Err(Error::Forbidden(format!(
                "moved → {dest}; reconnect to the registered folder; retained legacy project is read-only"
            )));
        }
        if c.query_row("SELECT EXISTS(SELECT 1 FROM project_moves WHERE project_id=? AND state IN ('frozen','copied','verified','published'))",[project],|r|r.get::<_,bool>(0))? {return Err(Error::Forbidden("Project move is in progress; resume or roll back before writing".into()));}
    }
    Ok(())
}
fn save(c: &Connection, r: &MoveReceipt) -> Result<()> {
    c.execute("INSERT INTO project_moves VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,receipt_json=excluded.receipt_json",params![r.id,r.project_id,r.state,r.destination,serde_json::to_string(r)?,now()])?;
    Ok(())
}
fn digest(s: &BoardSnapshot) -> Result<String> {
    Ok(crate::storage_io::hash(&serde_json::to_vec(&s.tables)?))
}
fn prune(c: &mut Connection, project: &str) -> Result<()> {
    let original_projects: i64 = c.query_row("SELECT count(*) FROM jams", [], |r| r.get(0))?;
    if original_projects > 1
        && c.query_row(
            "SELECT EXISTS(SELECT 1 FROM work_contexts WHERE task_id IS NULL)",
            [],
            |r| r.get::<_, bool>(0),
        )?
    {
        return Err(invalid(
            "move",
            "Unscoped legacy work contexts are ambiguous; move refused without discarding them",
        ));
    }
    c.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA secure_delete=ON;")?;
    let tx = c.transaction()?;
    let tables = tx
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for table in &tables {
        let cols = tx
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if cols.contains(&"jam_id".to_string()) {
            tx.execute(
                &format!("DELETE FROM {table} WHERE jam_id IS NULL OR jam_id!=?"),
                [project],
            )?;
        } else if cols.contains(&"project_id".to_string()) && table != "project_moves" {
            tx.execute(
                &format!("DELETE FROM {table} WHERE project_id!=?"),
                [project],
            )?;
        }
    }
    for table in [
        "task_tags",
        "task_assets",
        "comments",
        "reports",
        "reviews",
        "task_presentation",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE task_id NOT IN (SELECT id FROM tasks)"),
            [],
        )?;
    }
    tx.execute(
        "DELETE FROM ref_links WHERE item_id NOT IN (SELECT id FROM ref_items)",
        [],
    )?;
    tx.execute(
        "DELETE FROM ref_frame_links WHERE frame_id NOT IN (SELECT id FROM ref_frames)",
        [],
    )?;
    for table in ["asset_components", "file_previews"] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE asset_id NOT IN (SELECT id FROM assets)"),
            [],
        )?;
    }
    tx.execute("DELETE FROM jams WHERE id!=?", [project])?;
    tx.execute(
        "DELETE FROM work_contexts WHERE task_id IS NOT NULL AND task_id NOT IN (SELECT id FROM tasks)",
        [],
    )?;
    tx.execute("DELETE FROM project_moves", [])?;
    tx.execute(
        "DELETE FROM settings WHERE key NOT LIKE ? AND key NOT LIKE ? AND key NOT LIKE ?",
        params![
            format!("board.{project}.%"),
            format!("project.{project}.%"),
            format!("canvas_viewport:{project}:%")
        ],
    )?;
    crate::projects::put_setting(&tx, "current_project_id", project)?;
    tx.execute(
        "INSERT OR IGNORE INTO settings(key,value) SELECT ?,value FROM settings WHERE key=?",
        params![
            format!("board.{project}.working_directory"),
            format!("board.{project}.project_folder")
        ],
    )?;
    let remembered: Option<String> = tx
        .query_row(
            "SELECT value FROM settings WHERE key=?",
            [format!("project.{project}.current_member_id")],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(member) = remembered {
        crate::projects::put_setting(&tx, "current_member_id", &member)?;
    }
    let mut used = std::collections::BTreeSet::new();
    for table in &tables {
        let fks = tx
            .prepare(&format!("PRAGMA foreign_key_list({table})"))?
            .query_map([], |r| Ok((r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (target, col) in fks {
            if target == "members" {
                for value in tx
                    .prepare(&format!(
                        "SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL"
                    ))?
                    .query_map([], |r| r.get::<_, String>(0))?
                {
                    used.insert(value?);
                }
            }
        }
    }
    let members = tx
        .prepare("SELECT id FROM members")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for m in members {
        if !used.contains(&m) {
            tx.execute("DELETE FROM members WHERE id=?", [m])?;
        }
    }
    tx.execute("UPDATE board_meta SET instance_id=?,database_generation=?,snapshot_hash=NULL,manifest_hash=NULL,published_revision=-1",[id(),id()])?;
    crate::storage_io::integrity(&tx)?;
    tx.commit()?;
    c.execute_batch("PRAGMA foreign_keys=ON; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}
impl ProjectManager {
    pub fn move_project(&self, source: &Store, input: MoveProject) -> Result<MoveReceipt> {
        self.advance_project_move(source, input, None)
    }
    /// Fault-injection boundary: returning after a durable state models process interruption.
    pub fn advance_project_move(
        &self,
        source: &Store,
        input: MoveProject,
        stop_after: Option<&str>,
    ) -> Result<MoveReceipt> {
        let _guard = self.selection_guard()?;
        self.advance_project_move_inner(source, input, stop_after)
    }
    pub(crate) fn advance_project_move_inner(
        &self,
        source: &Store,
        input: MoveProject,
        stop_after: Option<&str>,
    ) -> Result<MoveReceipt> {
        check_wal_runtime()?;
        crate::m5::validate_name("requestId", &input.request_id, 200)?;
        let dest = Path::new(&input.destination);
        validate_storage_path(dest, input.cloud_acknowledged)?;
        let _owners = crate::storage_io::lock(&owner_path(&source.path, &input.project_id))
            .map_err(|_| {
                invalid(
                    "project",
                    "Disconnect all MCP connections and agent sessions before moving this project",
                )
            })?;
        let mut c = crate::db::connect(&source.path)?;
        let maintenance = source
            .path
            .parent()
            .unwrap()
            .join("project-maintenance.lock");
        let _maintenance = crate::storage_io::lock(&maintenance)?;
        let existing: Option<String> = c
            .query_row(
                "SELECT receipt_json FROM project_moves WHERE id=?",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        let mut r = if let Some(json) = existing {
            let r: MoveReceipt = serde_json::from_str(&json)?;
            if r.project_id != input.project_id || r.destination != input.destination {
                return Err(Error::Conflict);
            }
            r
        } else {
            source.for_project(&input.project_id)?;
            source.flush_board_snapshot()?;
            if dest.exists() {
                return Err(invalid("destination", "Choose a new empty destination"));
            }
            let parent = dest
                .parent()
                .ok_or_else(|| invalid("destination", "Missing parent"))?;
            std::fs::create_dir_all(parent)?;
            let stage = parent.join(format!(
                ".jam-move-{}",
                crate::storage_io::hash(input.request_id.as_bytes())
            ));
            if stage.exists() {
                return Err(invalid(
                    "destination",
                    "Operation staging folder already exists without this source receipt",
                ));
            }
            let backup = source.path.parent().unwrap().join(format!(
                "move-{}.backup.db",
                crate::storage_io::hash(input.request_id.as_bytes())
            ));
            let r = MoveReceipt {
                id: input.request_id.clone(),
                project_id: input.project_id.clone(),
                state: "prepared".into(),
                destination: input.destination.clone(),
                staging: stage.to_string_lossy().into(),
                source_backup: backup.to_string_lossy().into(),
                source_digest: String::new(),
                destination_digest: String::new(),
                table_counts: Default::default(),
                file_hashes: Default::default(),
                byte_total: 0,
                unresolved_links: vec![],
                error: None,
            };
            save(&c, &r)?;
            r
        };
        if r.state == "rolled_back" {
            return Err(invalid(
                "operation",
                "This operation was rolled back; use a new request ID",
            ));
        }
        if r.state == "prepared" {
            if stop_after == Some("prepared") {
                return Ok(r);
            }
            r.state = "frozen".into();
            let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            if tx.query_row("SELECT EXISTS(SELECT 1 FROM file_operations WHERE project_id=? AND state='copying')",[&r.project_id],|row|row.get::<_,bool>(0))?{return Err(invalid("move","Finish or cancel pending file operations before moving"));}
            save(&tx, &r)?;
            tx.commit()?;
        }
        if r.state == "frozen" {
            if stop_after == Some("frozen") {
                return Ok(r);
            }
            crate::storage_io::backup(&c, Path::new(&r.source_backup))?;
            let private = source.path.parent().unwrap().join(format!(
                "move-{}.scoped.db",
                crate::storage_io::hash(r.id.as_bytes())
            ));
            crate::storage_io::backup(&c, &private)?;
            let mut scoped = crate::db::connect(&private)?;
            prune(&mut scoped, &r.project_id)?;
            let before = crate::board_snapshot::capture(&scoped)?;
            r.source_digest = digest(&before)?;
            r.table_counts = before
                .tables
                .iter()
                .map(|(k, v)| (k.clone(), v.len()))
                .collect();
            let stage = Path::new(&r.staging);
            if !stage.exists() {
                std::fs::create_dir(stage)?;
                initialize_layout(stage)?;
                crate::storage_io::atomic_write(
                    &stage.join(".state/operations/move-owner.json"),
                    &serde_json::to_vec(
                        &serde_json::json!({"id":r.id,"projectId":r.project_id,"sourceDatabase":source.path,"destination":r.destination,"committed":false}),
                    )?,
                )?;
            } else {
                let owner: serde_json::Value = serde_json::from_slice(&std::fs::read(
                    stage.join(".state/operations/move-owner.json"),
                )?)?;
                if owner["id"] != r.id || owner["projectId"] != r.project_id {
                    return Err(invalid("operation", "Staging belongs to another operation"));
                }
            }
            r.byte_total = 0;
            r.file_hashes.clear();
            r.unresolved_links.clear();
            initialize_layout(stage)?;
            crate::storage_io::backup(&scoped, &stage.join(".state/board.db"))?;
            drop(scoped);
            if crate::project_folders::folder_for_db(&source.path).is_some() {
                let context = source
                    .for_project(&r.project_id)?
                    .folder_session_context()?;
                crate::db::connect(&stage.join(".state/board.db"))?.execute(
                    "UPDATE board_meta SET instance_id=?",
                    [context.project_instance_id],
                )?;
            }
            let store = Store::open(stage.join(".state/board.db"))?;
            let project = store.active_jam()?;
            let mut manifest = ProjectManifest {
                schema_version: 1,
                id: project.id,
                name: project.name,
                folder_rules: default_folder_rules(),
                repository: crate::project_folders::manifest_repository(stage)?,
            };
            if let Some(source_folder) = crate::project_folders::folder_for_db(&source.path) {
                manifest.folder_rules = read_manifest(&source_folder)?.0.folder_rules;
            }
            crate::storage_io::atomic_write(
                &stage.join("jamboard.json"),
                &serde_json::to_vec_pretty(&manifest)?,
            )?;
            let managed = source
                .path
                .parent()
                .unwrap()
                .join("references")
                .canonicalize()
                .ok();
            for file in source
                .for_project(&r.project_id)?
                .list_file_assets(FileAssetQuery::default())?
            {
                let path = PathBuf::from(&file.asset.location);
                let physical = path.canonicalize();
                let owned = file.storage_type == "board_file"
                    || managed
                        .as_ref()
                        .is_some_and(|root| physical.as_ref().is_ok_and(|p| p.starts_with(root)))
                    || source
                        .path
                        .parent()
                        .unwrap()
                        .join("references")
                        .is_absolute()
                        && path.starts_with(source.path.parent().unwrap().join("references"));
                if owned {
                    if !path.is_file() {
                        r.unresolved_links
                            .push(format!("missing managed file: {}", path.display()));
                        save(&c, &r)?;
                        return Err(invalid(
                            "missingManagedFile",
                            "Lossless move blocked by a missing managed file; supply its bytes",
                        ));
                    }
                    let kind = &file.asset.kind;
                    let name = readable_file_name(
                        path.file_name().and_then(|s| s.to_str()).unwrap_or("File"),
                    );
                    let relative = if file.storage_type == "board_file" {
                        file.stored_path.clone()
                    } else {
                        format!(
                            "{}/{}-{}",
                            manifest.folder_rules[kind],
                            &file.asset.id[..file.asset.id.len().min(8)],
                            name
                        )
                    };
                    let target = crate::storage_io::contained(stage, &relative)?;
                    std::fs::create_dir_all(target.parent().unwrap())?;
                    std::fs::copy(&path, &target)?;
                    std::fs::OpenOptions::new()
                        .write(true)
                        .open(&target)?
                        .sync_all()?;
                    let a = crate::storage_io::hash_reader(File::open(&path)?)?;
                    let b = crate::storage_io::hash_reader(File::open(&target)?)?;
                    if a != b {
                        return Err(invalid("move", "File hash verification failed"));
                    }
                    r.byte_total += b.1;
                    r.file_hashes.insert(relative.clone(), b.0.clone());
                    store.write(|tx|{tx.execute("UPDATE assets SET storage_type='board_file',path_base='board',stored_path=?,location=?,content_hash=?,byte_size=? WHERE id=?",params![relative,relative,b.0,b.1 as i64,file.asset.id])?;Ok(())})?;
                    if [Some("file_copy"), Some("file_commit")].contains(&stop_after) {
                        save(&c, &r)?;
                        return Ok(r);
                    }
                } else if file.storage_type == "linked_file" && file.path_base == "repo" {
                    let source_repo = crate::project_folders::folder_for_db(&source.path)
                        .as_deref()
                        .map(repository_context)
                        .transpose()?
                        .flatten();
                    let destination_repo = repository_context(stage)?;
                    if source_repo
                        .as_ref()
                        .zip(destination_repo.as_ref())
                        .is_none_or(|(a, b)| a.1 != b.1)
                    {
                        let absolute=file.resolution.resolved_path.as_deref().ok_or_else(||invalid("move","Cannot preserve an unresolved repo-relative link outside its repository"))?;
                        store.write(|tx|{tx.execute("UPDATE assets SET path_base='absolute',stored_path=?,location=? WHERE id=?",params![absolute,absolute,file.asset.id])?;Ok(())})?;
                    }
                    if file.resolution.status != "available" {
                        r.unresolved_links.push(file.asset.location);
                    }
                } else if file.resolution.status == "missing" || file.resolution.status == "unknown"
                {
                    r.unresolved_links.push(file.asset.location);
                }
            }
            set_folder_metadata(&store, stage)?;
            r.destination_digest = digest(&store.board_snapshot()?)?;
            // Capture a second source fingerprint from a freshly scoped online backup before publication.
            let current = source.path.parent().unwrap().join(format!(
                "move-{}.verify.db",
                crate::storage_io::hash(r.id.as_bytes())
            ));
            crate::storage_io::backup(&c, &current)?;
            let mut verify = crate::db::connect(&current)?;
            prune(&mut verify, &r.project_id)?;
            if digest(&crate::board_snapshot::capture(&verify)?)? != r.source_digest {
                return Err(invalid(
                    "move",
                    "Source changed during move; roll back and retry",
                ));
            }
            r.state = "copied".into();
            save(&c, &r)?;
        }
        if r.state == "copied" {
            if stop_after == Some("copied") {
                return Ok(r);
            }
            let store = Store::open(Path::new(&r.staging).join(".state/board.db"))?;
            let snapshot = store.board_snapshot()?;
            if digest(&snapshot)? != r.destination_digest
                || snapshot
                    .tables
                    .iter()
                    .any(|(t, v)| r.table_counts.get(t) != Some(&v.len()))
            {
                return Err(invalid("move", "Table counts/digests differ"));
            }
            for (path, hash) in &r.file_hashes {
                if crate::storage_io::hash_reader(File::open(crate::storage_io::contained(
                    Path::new(&r.staging),
                    path,
                )?)?)?
                .0 != *hash
                {
                    return Err(invalid("move", "Copied bytes changed"));
                }
            }
            crate::storage_io::integrity(&crate::db::connect(&store.path)?)?;
            store.flush_board_snapshot()?;
            store.backup_board("pre-migration", true)?;
            r.state = "verified".into();
            save(&c, &r)?;
        }
        if r.state == "verified" {
            if stop_after == Some("verified") {
                return Ok(r);
            }
            let stage = Path::new(&r.staging);
            if stage.exists() {
                crate::project_folders::publish_staged_folder(stage, dest)?;
            } else if read_manifest(dest)?.0.id != r.project_id {
                return Err(invalid("move", "Published destination identity mismatch"));
            }
            if stop_after == Some("rename") {
                return Ok(r);
            }
            r.state = "published".into();
            save(&c, &r)?;
        }
        if r.state == "published" {
            if stop_after == Some("published") {
                return Ok(r);
            }
            let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            tx.execute(
                "UPDATE jams SET moved_to=?,migration_id=? WHERE id=?",
                params![r.destination, r.id, r.project_id],
            )?;
            r.state = "committed".into();
            save(&tx, &r)?;
            tx.commit()?;
        }
        if r.state == "committed" {
            if stop_after == Some("source_commit") {
                return Ok(r);
            }
            let db = crate::db::connect(&dest.join(".state/board.db"))?;
            let instance_id =
                db.query_row("SELECT instance_id FROM board_meta", [], |row| row.get(0))?;
            let canonical = dest.canonicalize()?;
            let entry = RegistryEntry {
                instance_id,
                project_id: r.project_id.clone(),
                project_name: source.for_project(&r.project_id)?.active_jam()?.name,
                canonical_folder: canonical.to_string_lossy().into(),
                display_folder: r.destination.clone(),
                repo_common_dir: repository_context(&canonical)?
                    .map(|(_, common)| common.to_string_lossy().into()),
                last_opened_at: now(),
                availability: "available".into(),
                migration_id: Some(r.id.clone()),
            };
            self.registry.relocate(
                &r.project_id,
                crate::project_folders::folder_for_db(&source.path).as_deref(),
                &entry,
            )?;
            let h = self
                .open_inner(dest, input.cloud_acknowledged, false, None)
                .map_err(|e| {
                    invalid(
                        "openMovedProject",
                        &format!("Cutover is committed; retry opening the destination: {e}"),
                    )
                })?;
            let mut entry = self.registry.resolve(&r.project_id, Some(dest))?;
            entry.migration_id = Some(r.id.clone());
            self.registry.register(&entry)?;
            drop(h);
        }
        Ok(r)
    }
    pub fn rollback_project_move(&self, source: &Store, request: &str) -> Result<MoveReceipt> {
        let mut r = source.project_operation_status(request)?;
        if r.state == "committed" {
            return Err(invalid(
                "move",
                "After cutover use a reverse move of the latest destination; retained source cannot be reactivated",
            ));
        }
        let _owners = crate::storage_io::lock(&owner_path(&source.path, &r.project_id))?;
        let destination = Path::new(&r.destination);
        if !destination.is_absolute()
            || Path::new(&r.staging)
                != destination
                    .parent()
                    .ok_or_else(|| invalid("operation", "Invalid destination"))?
                    .join(format!(
                        ".jam-move-{}",
                        crate::storage_io::hash(r.id.as_bytes())
                    ))
        {
            return Err(invalid("operation", "Invalid operation-owned paths"));
        }
        for p in [&r.staging, &r.destination] {
            let p = Path::new(p);
            if p.exists() {
                let resolved = p.canonicalize()?;
                if std::fs::symlink_metadata(p)?.file_type().is_symlink()
                    || resolved
                        != p.parent()
                            .unwrap()
                            .canonicalize()?
                            .join(p.file_name().unwrap())
                {
                    return Err(invalid(
                        "operation",
                        "Refuse deleting a symlink/junction or relocated staging folder",
                    ));
                }
                let owner: serde_json::Value = serde_json::from_slice(&std::fs::read(
                    p.join(".state/operations/move-owner.json"),
                )?)?;
                if owner["id"] != r.id || owner["projectId"] != r.project_id {
                    return Err(invalid(
                        "move",
                        "Refuse deleting a folder without matching operation ownership",
                    ));
                }
                std::fs::remove_dir_all(resolved)?;
            }
        }
        r.state = "rolled_back".into();
        save(&crate::db::connect(&source.path)?, &r)?;
        Ok(r)
    }
}
