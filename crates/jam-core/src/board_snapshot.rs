use crate::*;
use rusqlite::{
    Connection, params,
    types::{Value as SqlValue, ValueRef},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

// Each column is intentional. Local settings, receipts, previews, cwd, profiles and credentials are absent.
pub(crate) const TABLES: &[(&str, &str)] = &[
    (
        "jams",
        "id,name,theme,starts_at,ends_at,timezone,task_seq,key_prefix,created_at,archived,template,milestone_at,epic_seq,story_seq",
    ),
    ("members", "id,kind,name,handle,color,created_at"),
    ("project_members", "jam_id,member_id"),
    (
        "epics",
        "id,jam_id,key,title,color,status,goal_md,done_when_md,not_included_md,decided_md,open_questions_md,participation,reviewer,worker_model,brain_member_id,position,created_by,updated_by,created_at,updated_at,archived_at",
    ),
    (
        "stories",
        "id,jam_id,key,epic_id,title,status,outcome_md,basis_md,preserve_md,scale_md,rejection_risks_md,open_decisions_md,acceptance_json,position,created_by,updated_by,created_at,updated_at,archived_at",
    ),
    (
        "tasks",
        "id,jam_id,key,title,description_md,status,priority,estimate,due_at,position,assignee_id,created_by,updated_by,created_at,updated_at,archived_at,idempotency_key,story_id,goal_md,context_md,where_md,changes_json,tests_json,boundaries_md,result_md,user_quotes_md,changes_requested,review_round,claim_generation,metadata_json",
    ),
    ("task_tags", "task_id,tag"),
    (
        "assets",
        "id,jam_id,kind,name,location,notes,created_by,created_at,role,storage_type,path_base,stored_path,original_name,mime_type,byte_size,content_hash,content_revision,metadata_json",
    ),
    (
        "task_assets",
        "task_id,asset_id,role,position,created_by,created_at",
    ),
    ("comments", "id,task_id,author_id,body_md,created_at"),
    (
        "activity",
        "seq,id,jam_id,actor_id,action,task_id,payload,created_at,epic_id",
    ),
    (
        "reports",
        "id,task_id,round,author_id,summary_md,changed_files_json,tests_json,deviations_md,not_verified_md,created_at",
    ),
    (
        "reviews",
        "id,task_id,round,reviewer_id,verdict,comments_md,failed_tests_json,created_at",
    ),
    (
        "questions",
        "id,jam_id,epic_id,scope_type,scope_id,asked_by,round_label,title,body_md,options_json,recommended_index,allow_free_text,status,answer_index,answer_text,answered_by,answered_at,created_at",
    ),
    (
        "ref_frames",
        "id,jam_id,epic_id,title,x,y,w,h,color,archived_at,collapsed",
    ),
    (
        "ref_items",
        "id,jam_id,kind,asset_id,url,link_preview,title,caption_md,tags_json,x,y,w,h,z,frame_id,position,created_by,updated_by,created_at,updated_at,archived_at,metadata,verdict,archived_by",
    ),
    ("ref_edges", "id,jam_id,from_item,to_item,label,archived_at"),
    ("ref_links", "item_id,target_type,target_id,archived_at"),
    (
        "ref_frame_links",
        "frame_id,target_type,target_id,archived_at",
    ),
    (
        "execution_states",
        "jam_id,scope_type,scope_id,own_state,revision,changed_by,changed_at",
    ),
    (
        "execution_requests",
        "id,jam_id,epic_id,scope_type,scope_id,requested_by,reason,status,revision,created_at,resolved_by,resolved_at",
    ),
    ("task_idempotency", "jam_id,actor_id,token,task_id"),
    (
        "asset_components",
        "asset_id,relative_uri,component_asset_id",
    ),
    (
        "task_presentation",
        "task_id,cover_asset_id,cover_mode,metadata_json",
    ),
];
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardSnapshot {
    pub format_version: u32,
    pub project_id: String,
    pub board_revision: i64,
    pub tables: BTreeMap<String, Vec<BTreeMap<String, Value>>>,
    pub content_settings: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotComparison {
    pub live_hash: String,
    pub external_hash: String,
    pub live_revision: i64,
    pub external_revision: Option<i64>,
    pub external_valid: bool,
    pub changed_tables: Vec<String>,
    pub error: Option<String>,
}
pub(crate) fn install_dirty_tracking(c: &Connection) -> Result<()> {
    for (table, columns) in TABLES {
        for action in ["INSERT", "UPDATE", "DELETE"] {
            let extra = if *table == "project_members" && action == "UPDATE" {
                " OF jam_id,member_id"
            } else if *table == "members" && action == "UPDATE" {
                " OF name,handle,color"
            } else {
                ""
            };
            let changed = if action == "UPDATE" {
                format!(
                    " WHEN {}",
                    columns
                        .split(',')
                        .map(|col| format!("NEW.{col} IS NOT OLD.{col}"))
                        .collect::<Vec<_>>()
                        .join(" OR ")
                )
            } else {
                String::new()
            };
            c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS dirty_{table}_{action} AFTER {action}{extra} ON {table}{changed} BEGIN UPDATE board_meta SET board_revision=board_revision+1,dirty_since=coalesce(dirty_since,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE singleton=1; END;"))?;
        }
    }
    for action in ["INSERT", "UPDATE", "DELETE"] {
        let row = if action == "DELETE" { "OLD" } else { "NEW" };
        c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS dirty_content_settings_{action} AFTER {action} ON settings WHEN {row}.key LIKE 'board.%.color_by' OR {row}.key LIKE 'board.%.estimates_enabled' OR {row}.key LIKE 'board.%.wip_limit' BEGIN UPDATE board_meta SET board_revision=board_revision+1,dirty_since=coalesce(dirty_since,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE singleton=1; END;"))?;
    }
    Ok(())
}
pub(crate) fn rows(
    c: &Connection,
    table: &str,
    columns: &str,
    filter: &str,
) -> Result<Vec<BTreeMap<String, Value>>> {
    let order = match table {
        "activity" => "seq,id",
        "task_assets" if columns.split(',').any(|c| c == "position") => "task_id,position,asset_id",
        _ => columns,
    };
    let mut stmt = c.prepare(&format!(
        "SELECT {columns} FROM {table} {filter} ORDER BY {order}"
    ))?;
    let names: Vec<_> = columns.split(',').map(str::to_owned).collect();
    let rows = stmt
        .query_map([], |r| {
            let mut row = BTreeMap::new();
            for (i, k) in names.iter().enumerate() {
                let value = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => json!(v),
                    ValueRef::Real(v) => {
                        if !v.is_finite() {
                            return Err(rusqlite::Error::InvalidQuery);
                        }
                        json!(v)
                    }
                    ValueRef::Text(v) => {
                        json!(std::str::from_utf8(v).map_err(|_| rusqlite::Error::InvalidQuery)?)
                    }
                    ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidQuery),
                };
                row.insert(k.clone(), value);
            }
            Ok(row)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub(crate) fn capture(c: &Connection) -> Result<BoardSnapshot> {
    let project_id: String = c.query_row("SELECT id FROM jams", [], |r| r.get(0))?;
    if c.query_row("SELECT count(*) FROM jams", [], |r| r.get::<_, i64>(0))? != 1 {
        return Err(invalid(
            "snapshot",
            "Snapshots require a single-project folder DB",
        ));
    }
    let mut tables = BTreeMap::new();
    for (table, cols) in TABLES {
        tables.insert((*table).into(), rows(c, table, cols, "")?);
    }
    // location is a legacy compatibility field; portable authority never contains an anchor prefix.
    if let Some(assets) = tables.get_mut("assets") {
        for a in assets {
            a.insert("location".into(), a["stored_path"].clone());
        }
    }
    let mut settings = BTreeMap::new();
    for suffix in ["color_by", "estimates_enabled", "wip_limit"] {
        let key = format!("board.{project_id}.{suffix}");
        use rusqlite::OptionalExtension;
        if let Some(value) = c
            .query_row("SELECT value FROM settings WHERE key=?", [&key], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
        {
            settings.insert(key, value);
        }
    }
    Ok(BoardSnapshot {
        format_version: 3,
        project_id,
        board_revision: c.query_row("SELECT board_revision FROM board_meta", [], |r| r.get(0))?,
        tables,
        content_settings: settings,
    })
}
fn bytes(s: &BoardSnapshot) -> Result<Vec<u8>> {
    let mut b = serde_json::to_vec_pretty(s)?;
    b.push(b'\n');
    Ok(b)
}
impl Store {
    pub fn compare_board_snapshot(&self) -> Result<SnapshotComparison> {
        let folder = crate::project_folders::folder_for_db(&self.path)
            .ok_or_else(|| invalid("snapshot", "Folder project required"))?;
        let live = self.board_snapshot()?;
        let external = std::fs::read(folder.join("board.json"))?;
        let parsed = serde_json::from_slice::<BoardSnapshot>(&external);
        let mut result = SnapshotComparison {
            live_hash: crate::storage_io::hash(&bytes(&live)?),
            external_hash: crate::storage_io::hash(&external),
            live_revision: live.board_revision,
            external_revision: None,
            external_valid: false,
            changed_tables: vec![],
            error: None,
        };
        match parsed {
            Ok(snapshot)
                if snapshot.format_version == 3 && snapshot.project_id == live.project_id =>
            {
                result.external_valid = true;
                result.external_revision = Some(snapshot.board_revision);
                for (table, rows) in &live.tables {
                    if snapshot.tables.get(table) != Some(rows) {
                        result.changed_tables.push(table.clone());
                    }
                }
                if snapshot.content_settings != live.content_settings {
                    result.changed_tables.push("contentSettings".into());
                }
            }
            Ok(_) => result.error = Some("Unsupported version or mismatched project ID".into()),
            Err(_) => result.error = Some("External snapshot is invalid or truncated".into()),
        }
        Ok(result)
    }
    pub fn keep_live_board(&self, expected_external_hash: &str) -> Result<()> {
        let folder = crate::project_folders::folder_for_db(&self.path)
            .ok_or_else(|| invalid("snapshot", "Folder project required"))?;
        {
            let _publication = crate::storage_io::lock(&folder.join(".state/snapshot.lock"))?;
            let _maintenance = crate::storage_io::lock(&folder.join(".state/maintenance.lock"))?;
            let external = std::fs::read(folder.join("board.json"))?;
            let hash = crate::storage_io::hash(&external);
            if hash != expected_external_hash {
                return Err(Error::Conflict);
            }
            crate::storage_io::atomic_write(
                &folder.join(format!(
                    ".state/backups/pinned-external-snapshot-{}.json",
                    id()
                )),
                &external,
            )?;
            self.write(|c| {
                c.execute(
                    "UPDATE board_meta SET snapshot_hash=?,last_error=NULL",
                    [hash],
                )?;
                Ok(())
            })?;
            let receipt = folder.join(".state/operations/snapshot-publication.json");
            if receipt.is_file() {
                std::fs::remove_file(receipt)?;
            }
        }
        self.flush_board_snapshot()
    }
    pub fn board_snapshot(&self) -> Result<BoardSnapshot> {
        self.read(capture)
    }
}
pub(crate) fn publish(folder: &Path) -> Result<()> {
    if is_quiet(folder) || !folder.join("jamboard.json").is_file() {
        return Ok(());
    }
    let _coordinator = crate::storage_io::lock(&folder.join(".state/snapshot.lock"))?;
    if is_quiet(folder) {
        return Ok(());
    }
    let _manifest_lock = crate::storage_io::lock(&folder.join(".state/maintenance.lock"))?;
    if folder.join(".state/operations/folder-rules.json").is_file() {
        crate::project_folders::recover_rules_receipt(
            &Store::open(folder.join(".state/board.db"))?,
            folder,
        )?;
    }
    let (mut manifest, mut manifest_hash) = read_manifest(folder)?;
    let mut c = crate::db::connect(&folder.join(".state/board.db"))?;
    if c.query_row("SELECT moved_to IS NOT NULL FROM jams", [], |r| {
        r.get::<_, bool>(0)
    })? {
        return Ok(());
    }
    let publication_receipt = folder.join(".state/operations/snapshot-publication.json");
    if publication_receipt.is_file() {
        let receipt: Value = serde_json::from_slice(&std::fs::read(&publication_receipt)?)?;
        let current = std::fs::read(folder.join("board.json"))
            .ok()
            .map(|b| crate::storage_io::hash(&b));
        if current.as_deref() == receipt["publishedHash"].as_str() {
            let revision = receipt["revision"]
                .as_i64()
                .ok_or_else(|| invalid("snapshot", "Invalid publication receipt"))?;
            c.execute("UPDATE board_meta SET snapshot_hash=?,published_revision=?,manifest_hash=?,dirty_since=CASE WHEN board_revision=? THEN NULL ELSE dirty_since END",params![current,revision,manifest_hash,revision])?;
            crate::projects::put_setting(
                &c,
                "local.last_snapshot_at",
                receipt["publishedAt"].as_str().unwrap_or(&now()),
            )?;
            std::fs::remove_file(&publication_receipt)?;
        } else if current.as_deref() != receipt["expectedHash"].as_str() {
            return Err(invalid(
                "externalSnapshotEdit",
                "Pending snapshot publication conflicts with an external edit",
            ));
        }
    }
    let tx = c.transaction()?;
    let snapshot = capture(&tx)?;
    if snapshot.project_id != manifest.id {
        return Err(invalid("snapshot", "Manifest identity changed"));
    }
    let (expected, known_manifest): (Option<String>, Option<String>) = tx.query_row(
        "SELECT snapshot_hash,manifest_hash FROM board_meta",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    tx.commit()?;
    if known_manifest
        .as_deref()
        .is_some_and(|v| v != manifest_hash)
    {
        return Err(invalid(
            "staleManifest",
            "Manifest was edited externally; compare or recover before publication",
        ));
    }
    let path = folder.join("board.json");
    match std::fs::read(&path) {
        Ok(b) => {
            if expected.as_deref() != Some(&crate::storage_io::hash(&b)) {
                return Err(invalid(
                    "externalSnapshotEdit",
                    "board.json changed externally; choose Keep live board, Recover, or Compare",
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if expected.is_some() {
                return Err(invalid(
                    "externalSnapshotEdit",
                    "board.json was removed externally",
                ));
            }
        }
        Err(e) => return Err(e.into()),
    }
    let b = bytes(&snapshot)?;
    let digest = crate::storage_io::hash(&b);
    let project_name = snapshot.tables["jams"][0]["name"]
        .as_str()
        .ok_or_else(|| invalid("name", "Invalid project name"))?;
    if manifest.name != project_name {
        manifest.name = project_name.into();
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
        crate::storage_io::atomic_write(
            &folder.join(".state/operations/folder-rules.json"),
            &serde_json::to_vec(&json!({"expectedHash":manifest_hash,"manifest":manifest}))?,
        )?;
        crate::storage_io::atomic_write(&folder.join("jamboard.json"), &manifest_bytes)?;
        manifest_hash = crate::storage_io::hash(&manifest_bytes);
    }
    if expected.as_deref() != Some(&digest) {
        crate::storage_io::atomic_write(
            &publication_receipt,
            &serde_json::to_vec(
                &json!({"version":1,"revision":snapshot.board_revision,"expectedHash":expected,"publishedHash":digest,"publishedAt":now()}),
            )?,
        )?;
        crate::storage_io::atomic_write(&path, &b)?;
    }
    c.execute("UPDATE board_meta SET snapshot_hash=?,published_revision=?,dirty_since=CASE WHEN board_revision=? THEN NULL ELSE dirty_since END,last_error=NULL,manifest_hash=?",params![digest,snapshot.board_revision,snapshot.board_revision,manifest_hash])?;
    if expected.as_deref() != Some(&digest) {
        crate::projects::put_setting(&c, "local.last_snapshot_at", &now())?;
    }
    if folder.join(".state/operations/folder-rules.json").is_file() {
        std::fs::remove_file(folder.join(".state/operations/folder-rules.json"))?;
    }
    if publication_receipt.is_file() {
        std::fs::remove_file(publication_receipt)?;
    }
    let (backup_revision, backup_at): (i64, Option<String>) = c.query_row(
        "SELECT backup_revision,backup_at FROM board_meta",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let backup_due = backup_revision < snapshot.board_revision
        && backup_at
            .and_then(|at| {
                time::OffsetDateTime::parse(&at, &time::format_description::well_known::Rfc3339)
                    .ok()
            })
            .is_none_or(|at| time::OffsetDateTime::now_utc() - at >= time::Duration::minutes(5));
    if backup_due {
        Store::open(folder.join(".state/board.db"))?.backup_board("automatic", false)?;
    }
    Ok(())
}
struct Pending {
    first: Instant,
    last: Instant,
}
static PENDING: OnceLock<Mutex<HashMap<PathBuf, Pending>>> = OnceLock::new();
static QUIET: OnceLock<Mutex<std::collections::BTreeSet<PathBuf>>> = OnceLock::new();
fn is_quiet(folder: &Path) -> bool {
    QUIET
        .get()
        .and_then(|m| m.lock().ok())
        .is_some_and(|q| q.contains(folder))
}
pub(crate) fn quiesce(folder: &Path) {
    if let Ok(mut q) = QUIET.get_or_init(Default::default).lock() {
        q.insert(folder.into());
    }
    forget_pending(folder);
}
pub(crate) fn forget_pending(folder: &Path) {
    if let Some(map) = PENDING.get()
        && let Ok(mut pending) = map.lock()
    {
        pending.remove(folder);
    }
}
pub(crate) fn schedule(folder: &Path) {
    if is_quiet(folder) {
        return;
    }
    let map = PENDING.get_or_init(Default::default);
    let Ok(mut pending) = map.lock() else { return };
    let key = folder.to_path_buf();
    if let Some(p) = pending.get_mut(&key) {
        p.last = Instant::now();
        return;
    }
    pending.insert(
        key.clone(),
        Pending {
            first: Instant::now(),
            last: Instant::now(),
        },
    );
    drop(pending);
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let Ok(mut pending) = map.lock() else { return };
            let Some(p) = pending.get(&key) else { return };
            if p.last.elapsed() < Duration::from_millis(750)
                && p.first.elapsed() < Duration::from_secs(5)
            {
                continue;
            }
            pending.remove(&key);
            break;
        }
        let result = publish(&key);
        if !is_quiet(&key)
            && let Ok(c) = crate::db::connect(&key.join(".state/board.db"))
        {
            match result {
                Err(error) => {
                    let retry =
                        matches!(&error,Error::Validation{field,..} if field=="projectFolder");
                    let _ = c.execute("UPDATE board_meta SET last_error=?", [error.to_string()]);
                    if retry {
                        schedule(&key);
                    }
                }
                Ok(()) => {
                    if c.query_row(
                        "SELECT board_revision>published_revision FROM board_meta",
                        [],
                        |r| r.get::<_, bool>(0),
                    )
                    .unwrap_or(false)
                    {
                        schedule(&key);
                    }
                }
            }
        }
    });
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupReceipt {
    pub version: u32,
    pub id: String,
    pub revision: i64,
    pub created_at: String,
    pub reason: String,
    pub pinned: bool,
    pub database_hash: String,
    pub manifest_hash: String,
    pub owned_files: BTreeMap<String, String>,
}
impl Store {
    pub fn backup_board(&self, reason: &str, pinned: bool) -> Result<BackupReceipt> {
        let folder = crate::project_folders::folder_for_db(&self.path)
            .ok_or_else(|| invalid("backup", "Folder project required"))?;
        let _coordinator = crate::storage_io::lock(&folder.join(".state/backup.lock"))?;
        let backup_id = id();
        let dest = folder.join(".state/backups").join(&backup_id);
        std::fs::create_dir(&dest)?;
        let c = crate::db::connect(&self.path)?;
        crate::storage_io::backup(&c, &dest.join("board.db"))?;
        let manifest = std::fs::read(folder.join("jamboard.json"))?;
        crate::storage_io::atomic_write(&dest.join("jamboard.json"), &manifest)?;
        let captured = crate::db::connect(&dest.join("board.db"))?;
        let owned=captured.prepare("SELECT stored_path FROM assets WHERE storage_type='board_file' ORDER BY stored_path")?.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let mut inventory = BTreeMap::new();
        for stored_path in owned {
            let p = crate::storage_io::contained(&folder, &stored_path)?;
            let fingerprint = match std::fs::File::open(p) {
                Ok(f) => crate::storage_io::hash_reader(f)?.0,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing".into(),
                Err(e) => return Err(e.into()),
            };
            inventory.insert(stored_path, fingerprint);
        }
        let receipt = BackupReceipt {
            version: 1,
            id: backup_id,
            revision: captured
                .query_row("SELECT board_revision FROM board_meta", [], |r| r.get(0))?,
            created_at: now(),
            reason: reason.into(),
            pinned,
            database_hash: crate::storage_io::hash_reader(std::fs::File::open(
                dest.join("board.db"),
            )?)?
            .0,
            manifest_hash: crate::storage_io::hash(&manifest),
            owned_files: inventory,
        };
        crate::storage_io::atomic_write(
            &dest.join("receipt.json"),
            &serde_json::to_vec_pretty(&receipt)?,
        )?;
        c.execute(
            "UPDATE board_meta SET backup_revision=?,backup_at=?",
            params![receipt.revision, receipt.created_at],
        )?;
        rotate(&folder, self)?;
        Ok(receipt)
    }
}
fn rotate(folder: &Path, store: &Store) -> Result<()> {
    let recent = store
        .setting("backup_recent_count")?
        .and_then(|s| s.parse().ok())
        .unwrap_or(10usize);
    let daily = store
        .setting("backup_daily_count")?
        .and_then(|s| s.parse().ok())
        .unwrap_or(7usize);
    let root = folder.join(".state/backups").canonicalize()?;
    let mut receipts = Vec::new();
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() || !entry.file_type()?.is_dir() {
            continue;
        }
        if let Ok(b) = std::fs::read(entry.path().join("receipt.json"))
            && let Ok(r) = serde_json::from_slice::<BackupReceipt>(&b)
            && r.version == 1
            && entry.file_name().to_str() == Some(&r.id)
        {
            receipts.push((r, entry.path()));
        }
    }
    receipts.sort_by(|a, b| b.0.created_at.cmp(&a.0.created_at));
    let mut days = std::collections::BTreeSet::new();
    let mut kept = 0;
    for (r, p) in receipts {
        if r.pinned {
            continue;
        }
        let day = r.created_at.chars().take(10).collect::<String>();
        let keep_daily = days.contains(&day) || days.len() < daily;
        let first = days.insert(day);
        let keep = kept < recent || (first && keep_daily);
        kept += 1;
        if !keep && p.canonicalize()?.parent() == Some(root.as_path()) {
            std::fs::remove_dir_all(p)?;
        }
    }
    Ok(())
}
pub(crate) fn restore_into(snapshot: &BoardSnapshot, path: &Path) -> Result<Store> {
    if snapshot.format_version != 3 {
        return Err(invalid("formatVersion", "Recovery requires snapshot v3"));
    }
    if snapshot.tables.len() != TABLES.len()
        || snapshot
            .tables
            .keys()
            .any(|table| !TABLES.iter().any(|(name, _)| name == table))
    {
        return Err(invalid("snapshot", "Unexpected or missing durable tables"));
    }
    let store = Store::open(path)?;
    let mut c = crate::db::connect(path)?;
    c.execute_batch("PRAGMA foreign_keys=OFF;")?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    for (table, columns) in TABLES {
        let rows = snapshot
            .tables
            .get(*table)
            .ok_or_else(|| invalid("snapshot", "Missing allowlisted table"))?;
        let names: Vec<_> = columns.split(',').collect();
        for row in rows {
            if row.len() != names.len() || row.keys().any(|k| !names.contains(&k.as_str())) {
                return Err(invalid("snapshot", "Unexpected/missing snapshot field"));
            }
            let values: Vec<_> = names
                .iter()
                .map(|k| match &row[*k] {
                    Value::Null => Ok(SqlValue::Null),
                    Value::String(s) => Ok(SqlValue::Text(s.clone())),
                    Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            Ok(SqlValue::Integer(i))
                        } else {
                            n.as_f64()
                                .map(SqlValue::Real)
                                .ok_or_else(|| invalid("snapshot", "Invalid number"))
                        }
                    }
                    _ => Err(invalid("snapshot", "Invalid column value")),
                })
                .collect::<Result<_>>()?;
            tx.execute(
                &format!(
                    "INSERT INTO {table}({columns}) VALUES({})",
                    vec!["?"; names.len()].join(",")
                ),
                rusqlite::params_from_iter(values),
            )?;
        }
    }
    for (key, value) in &snapshot.content_settings {
        if !["color_by", "estimates_enabled", "wip_limit"]
            .iter()
            .any(|s| key == &format!("board.{}.{}", snapshot.project_id, s))
        {
            return Err(invalid("snapshot", "Unknown content setting"));
        }
        crate::projects::put_setting(&tx, key, value)?;
    }
    crate::projects::put_setting(&tx, "current_project_id", &snapshot.project_id)?;
    if tx.query_row(
        "SELECT count(*) FROM jams WHERE id=?",
        [&snapshot.project_id],
        |r| r.get::<_, i64>(0),
    )? != 1
        || tx.query_row("SELECT count(*) FROM jams", [], |r| r.get::<_, i64>(0))? != 1
    {
        return Err(invalid(
            "snapshot",
            "Recovery must contain exactly the manifest project",
        ));
    }
    tx.execute(
        "UPDATE board_meta SET board_revision=?,database_generation=?,instance_id=?",
        params![snapshot.board_revision, id(), id()],
    )?;
    crate::storage_io::integrity(&tx)?;
    tx.commit()?;
    drop(c);
    Ok(store)
}
impl ProjectManager {
    pub fn recover(&self, folder: &Path, cloud_acknowledged: bool) -> Result<Arc<ProjectHandle>> {
        let _guard = self.selection_guard()?;
        self.recover_inner(folder, cloud_acknowledged)
    }
    fn recover_inner(&self, folder: &Path, cloud_acknowledged: bool) -> Result<Arc<ProjectHandle>> {
        check_wal_runtime()?;
        validate_storage_path(folder, cloud_acknowledged)?;
        let (manifest, _) = read_manifest(folder)?;
        initialize_layout(folder)?;
        let lock = crate::storage_io::lock(&folder.join(".state/maintenance.lock"))?;
        let snapshot: BoardSnapshot =
            serde_json::from_slice(&std::fs::read(folder.join("board.json"))?)?;
        if snapshot.project_id != manifest.id {
            return Err(invalid("snapshot", "Manifest/snapshot ID mismatch"));
        }
        if self.capture_selected().is_ok_and(|h| h.folder == folder) {
            return Err(invalid(
                "recovery",
                "Close the project and disconnect its MCP/agent owners first",
            ));
        }
        let target = folder.join(".state/board.db");
        let _owners =
            crate::storage_io::lock(&crate::project_move::owner_path(&target, &manifest.id))
                .map_err(|_| {
                    invalid(
                        "recovery",
                        "Disconnect all MCP and agent owners before recovery",
                    )
                })?;
        if target.exists() {
            let source = Store::open(&target)?;
            source.backup_board("pre-recovery", true)?;
        }
        let stage = folder.join(format!(".state/recovery-{}.db", id()));
        let restored = restore_into(&snapshot, &stage)?;
        // Validate all file authorities without opening or executing anything.
        for a in restored.list_file_assets(FileAssetQuery::default())? {
            if a.storage_type == "board_file" {
                crate::storage_io::contained(folder, &a.stored_path)?;
            }
        }
        crate::storage_io::atomic_write(
            &folder.join(format!(".state/operations/recovery-evidence-{}.json", id())),
            &serde_json::to_vec_pretty(&snapshot)?,
        )?;
        restored.write(|c| {
            c.execute(
                "UPDATE execution_states SET own_state='paused',revision=revision+1",
                [],
            )?;
            c.execute(
                "UPDATE execution_requests SET status='superseded' WHERE status='pending'",
                [],
            )?;
            Ok(())
        })?;
        let c = crate::db::connect(&stage)?;
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        drop(c);
        drop(restored);
        if target.exists() {
            std::fs::rename(
                &target,
                folder.join(format!(".state/pre-recovery-{}.db", id())),
            )?;
        }
        for suffix in ["-wal", "-shm"] {
            let side = PathBuf::from(format!("{}{suffix}", target.display()));
            if side.exists() {
                std::fs::rename(&side, side.with_extension(format!("retained-{}", id())))?;
            }
        }
        std::fs::rename(&stage, &target)?;
        let store = Store::open(&target)?;
        store.write(|c| {
            c.execute(
                "UPDATE board_meta SET snapshot_hash=?",
                [crate::storage_io::hash(&std::fs::read(
                    folder.join("board.json"),
                )?)],
            )?;
            Ok(())
        })?;
        drop(lock);
        self.open_inner(folder, cloud_acknowledged, false, None)
    }
}
