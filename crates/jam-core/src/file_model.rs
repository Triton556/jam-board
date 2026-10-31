use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
};
struct CancelReader<'a> {
    file: &'a mut File,
    store: &'a Store,
    actor: &'a str,
    request: &'a str,
    last_check: std::time::Instant,
}
impl std::io::Read for CancelReader<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.last_check.elapsed() >= std::time::Duration::from_millis(50) {
            self.store
                .ensure_copy_active(self.actor, self.request)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            self.last_check = std::time::Instant::now();
        }
        std::io::Read::read(self.file, buf)
    }
}

pub const FILE_KINDS: [&str; 7] = [
    "sprite", "audio", "model", "document", "level", "font", "other",
];
pub const FILE_ROLES: [&str; 3] = ["to_edit", "reference", "result"];
pub fn classify_file(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "aseprite" | "bmp" | "svg" | "tiff" => "sprite",
        "wav" | "ogg" | "mp3" | "flac" | "m4a" | "aac" => "audio",
        "glb" | "gltf" | "obj" | "fbx" | "blend" | "stl" | "ply" | "dae" | "3mf" | "usd"
        | "usda" | "usdc" | "usdz" => "model",
        "md" | "txt" | "pdf" | "docx" | "doc" | "rtf" | "odt" | "csv" | "xlsx" | "html" => {
            "document"
        }
        "ttf" | "otf" | "woff" | "woff2" => "font",
        "tmx" | "ldtk" => "level",
        _ => "other",
    }
}
pub(crate) fn reserved_name(name: &str) -> bool {
    let base = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches([' ', '.'])
        .to_uppercase();
    ["CON", "PRN", "AUX", "NUL", "CLOCK$"].contains(&base.as_str())
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && base.as_bytes()[3].is_ascii_digit()
            && base.as_bytes()[3] != b'0')
}
pub fn readable_file_name(name: &str) -> String {
    let p = Path::new(name);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(16)
        .collect::<String>();
    let mut stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("File")
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(80)
        .collect::<String>()
        .trim_end_matches([' ', '.'])
        .to_string();
    if stem.is_empty() {
        stem = "File".into();
    }
    if reserved_name(&stem) {
        stem.insert(0, '_');
    }
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{ext}")
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FileStorageType {
    BoardFile,
    LinkedFile,
    Url,
}
impl FileStorageType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::BoardFile => "board_file",
            Self::LinkedFile => "linked_file",
            Self::Url => "url",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileCompanion {
    pub source_path: String,
    pub relative_uri: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterFile {
    pub storage_type: FileStorageType,
    pub source_path: Option<String>,
    pub url: Option<String>,
    pub path_base: Option<String>,
    pub file_kind: Option<String>,
    pub name: Option<String>,
    pub notes: Option<String>,
    pub companions: Option<Vec<FileCompanion>>,
    pub request_id: String,
    pub task_key: Option<String>,
    pub role: Option<String>,
    pub expected_claim_generation: Option<String>,
    pub expected_updated_at: Option<String>,
    pub working_directory: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskFileInput {
    pub task_key: String,
    pub asset_id: String,
    pub role: Option<String>,
    pub position: Option<f64>,
    pub expected_claim_generation: String,
    pub expected_updated_at: String,
    pub request_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveFile {
    pub asset_id: String,
    pub working_directory: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileAssetQuery {
    pub kind: Option<String>,
    pub query: Option<String>,
    pub storage_type: Option<String>,
    pub task_key: Option<String>,
    pub role: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
    pub working_directory: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileResolution {
    pub storage_type: String,
    pub path_base: String,
    pub stored_path: String,
    pub resolved_path: Option<String>,
    pub worktree_root: Option<String>,
    pub resolution_basis: String,
    pub status: String,
    pub checked_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileAsset {
    #[serde(flatten)]
    pub asset: Asset,
    pub storage_type: String,
    pub path_base: String,
    pub stored_path: String,
    pub original_name: String,
    pub mime_type: Option<String>,
    pub byte_size: Option<i64>,
    pub content_hash: Option<String>,
    pub content_revision: i64,
    #[specta(type = std::collections::BTreeMap<String,crate::JsonPayload>)]
    pub metadata: std::collections::BTreeMap<String, serde_json::Value>,
    pub resolution: FileResolution,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskFile {
    pub asset: FileAsset,
    pub role: String,
    pub position: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileTaskVersion {
    pub updated_at: String,
    pub claim_generation: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileMutationResult {
    pub reference: Option<RefItem>,
    pub asset: Option<FileAsset>,
    pub task_file: Option<TaskFile>,
    pub task_version: Option<FileTaskVersion>,
    pub operation_id: String,
    pub unlinked: bool,
    pub warnings: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationStatus {
    pub request_id: String,
    pub state: String,
    pub can_cancel: bool,
}

fn db_folder(c: &Connection) -> Result<Option<PathBuf>> {
    let p: String = c.query_row("PRAGMA database_list", [], |r| r.get(2))?;
    let path = Path::new(&p);
    if path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|n| n == ".state")
        && path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("recovery-"))
    {
        return Ok(path.parent().and_then(Path::parent).map(Path::to_path_buf));
    }
    Ok(crate::project_folders::folder_for_db(Path::new(&p)))
}
pub(crate) fn validate_private_source(db: &Path, app: Option<&Path>, source: &Path) -> Result<()> {
    let source = source
        .canonicalize()
        .map_err(|_| invalid("filePath", "The file must exist and be readable"))?;
    if let Some(app) = app
        && source.starts_with(app.canonicalize()?)
    {
        return Err(invalid(
            "sourcePath",
            "App-local credentials, connection settings and private history cannot become board files or links",
        ));
    }
    if db.canonicalize().is_ok_and(|p| p == source) {
        return Err(invalid(
            "sourcePath",
            "The live database is private local state",
        ));
    }
    let folder = crate::project_folders::folder_for_db(db);
    if let Some(anchor) = &folder
        && source.starts_with(anchor.join(".state"))
        && !source.starts_with(anchor.join(".state/references"))
    {
        return Err(invalid(
            "sourcePath",
            "Local board state, backups and receipts cannot be registered as portable files",
        ));
    }
    if let Some(parent) = db.parent()
        && let Ok(parent) = parent.canonicalize()
        && let Ok(relative) = source.strip_prefix(parent)
    {
        let first = relative
            .components()
            .next()
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if [
            "mcp-token",
            "registry.db",
            "credentials",
            "secrets",
            "logs",
            "agent-history",
            "agents",
        ]
        .contains(&first.as_str())
        {
            return Err(invalid(
                "sourcePath",
                "Credential/configuration/history storage cannot be registered",
            ));
        }
    }
    Ok(())
}
pub(crate) fn load_file(c: &Connection, id: &str, working: Option<&str>) -> Result<FileAsset> {
    load_file_with_refresh(c, id, working, false)
}
pub(crate) fn load_file_with_refresh(
    c: &Connection,
    id: &str,
    working: Option<&str>,
    fresh: bool,
) -> Result<FileAsset> {
    let asset: Asset = crate::planning::fetch(c, "assets", "id", id)?;
    let fields=c.query_row("SELECT storage_type,path_base,stored_path,original_name,mime_type,byte_size,content_hash,content_revision,metadata_json FROM assets WHERE id=?",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get::<_,String>(8)?)))?;
    let stored = if fields.2.is_empty() {
        asset.location.clone()
    } else {
        fields.2
    };
    let resolution = resolve(
        db_folder(c)?.as_deref(),
        &fields.0,
        &fields.1,
        &stored,
        working,
        fresh,
    )?;
    let mut asset = asset;
    asset.location = resolution
        .resolved_path
        .clone()
        .unwrap_or_else(|| stored.clone());
    Ok(FileAsset {
        asset,
        storage_type: fields.0,
        path_base: fields.1,
        stored_path: stored,
        original_name: fields.3,
        mime_type: fields.4,
        byte_size: fields.5,
        content_hash: fields.6,
        content_revision: fields.7,
        metadata: serde_json::from_str(&fields.8)?,
        resolution,
    })
}
pub(crate) fn task_files(c: &Connection, task_id: &str) -> Result<Vec<TaskFile>> {
    let links=c.prepare("SELECT asset_id,role,position FROM task_assets WHERE task_id=? ORDER BY position,asset_id")?.query_map([task_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,f64>(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    links
        .into_iter()
        .map(|(a, role, position)| {
            Ok(TaskFile {
                asset: load_file(c, &a, None)?,
                role,
                position,
            })
        })
        .collect()
}
fn valid_url(s: &str) -> Result<()> {
    let rest = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .ok_or_else(|| invalid("url", "Use HTTP(S)"))?;
    let host = rest.split('/').next().unwrap_or("");
    if host.is_empty()
        || host.contains('@')
        || s.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(invalid(
            "url",
            "Use a URL without credentials or whitespace",
        ));
    }
    Ok(())
}
fn resolve(
    folder: Option<&Path>,
    storage: &str,
    base: &str,
    stored: &str,
    working: Option<&str>,
    fresh: bool,
) -> Result<FileResolution> {
    let mut r = FileResolution {
        storage_type: storage.into(),
        path_base: base.into(),
        stored_path: stored.into(),
        resolved_path: None,
        worktree_root: None,
        resolution_basis: base.into(),
        status: "unknown".into(),
        checked_at: now(),
    };
    if storage == "url" {
        if valid_url(stored).is_ok() {
            r.resolved_path = Some(stored.into());
        }
        return Ok(r);
    }
    let path = match base {
        "board" => {
            let root =
                folder.ok_or_else(|| invalid("asset", "Board file has no canonical anchor"))?;
            if !stored.starts_with("files/") {
                return Err(invalid("storedPath", "Board file must stay under files/"));
            }
            r.resolution_basis = "board_anchor".into();
            crate::storage_io::contained(root, stored)?
        }
        "repo" => {
            let anchor = folder
                .and_then(|p| repository_context(p).ok().flatten())
                .ok_or_else(|| invalid("workingDirectory", "Board has no verified repository"))?;
            let root = if let Some(working) = working {
                let work = repository_context(Path::new(working))?
                    .ok_or_else(|| invalid("workingDirectory", "No containing repository"))?;
                if work.1 != anchor.1 {
                    return Err(invalid(
                        "workingDirectory",
                        "Worktree belongs to another repository",
                    ));
                }
                r.resolution_basis = "caller_worktree".into();
                work.0
            } else {
                r.resolution_basis = "anchor_repository".into();
                anchor.0
            };
            r.worktree_root = Some(root.to_string_lossy().into());
            crate::storage_io::contained(&root, stored)?
        }
        "absolute" => {
            let p = PathBuf::from(stored);
            if !p.is_absolute() {
                return Ok(r);
            }
            p
        }
        _ => return Err(invalid("pathBase", "Invalid storage discriminator")),
    };
    r.resolved_path = Some(path.to_string_lossy().into());
    let cache = FILE_STATUS_CACHE.get_or_init(Default::default);
    if !fresh
        && let Ok(entries) = cache.lock()
        && let Some((at, status, checked)) = entries.get(&path)
        && at.elapsed() < std::time::Duration::from_secs(2)
    {
        r.status = status.clone();
        r.checked_at = checked.clone();
        return Ok(r);
    }
    r.status = match File::open(&path) {
        Ok(f) => {
            if f.metadata()?.is_file() {
                "available"
            } else {
                "unknown"
            }
        }
        Err(e) => match e.kind() {
            std::io::ErrorKind::NotFound => "missing",
            std::io::ErrorKind::PermissionDenied => "unreadable",
            _ => "unknown",
        },
    }
    .into();
    if let Ok(mut entries) = cache.lock() {
        if entries.len() >= 4096 {
            entries.retain(|_, (at, _, _)| at.elapsed() < std::time::Duration::from_secs(2));
            if entries.len() >= 4096 {
                entries.clear();
            }
        }
        entries.insert(
            path,
            (
                std::time::Instant::now(),
                r.status.clone(),
                r.checked_at.clone(),
            ),
        );
    }
    Ok(r)
}
type StatusEntries = std::collections::HashMap<PathBuf, (std::time::Instant, String, String)>;
static FILE_STATUS_CACHE: std::sync::OnceLock<std::sync::Mutex<StatusEntries>> =
    std::sync::OnceLock::new();
fn role(value: Option<&str>) -> Result<&str> {
    let role = value.unwrap_or("reference");
    if !FILE_ROLES.contains(&role) {
        return Err(invalid("role", "Choose to_edit, reference or result"));
    }
    Ok(role)
}
fn payload_hash(kind: &str, input: &impl Serialize) -> Result<String> {
    Ok(crate::storage_io::hash(&serde_json::to_vec(&(
        kind, input,
    ))?))
}
fn replay(
    c: &Connection,
    project: &str,
    actor: &str,
    request: &str,
    hash: &str,
) -> Result<Option<FileMutationResult>> {
    let row=c.query_row("SELECT payload_hash,state,result_json FROM file_operations WHERE project_id=? AND actor_id=? AND request_id=?",params![project,actor,request],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?))).optional()?;
    if let Some((known, state, result)) = row {
        if known != hash {
            return Err(Error::Conflict);
        }
        if state == "committed" {
            return Ok(Some(serde_json::from_str(&result.ok_or_else(|| {
                invalid("operation", "Missing committed receipt")
            })?)?));
        }
        if state == "cancelled" {
            return Err(invalid(
                "requestId",
                "This file operation was cancelled; use a new request ID",
            ));
        }
    }
    Ok(None)
}
fn finish(
    c: &Connection,
    project: &str,
    actor: &str,
    request: &str,
    hash: &str,
    result: &FileMutationResult,
) -> Result<()> {
    c.execute("INSERT INTO file_operations VALUES(?,?,?,?,'committed',?,?) ON CONFLICT(project_id,actor_id,request_id) DO UPDATE SET state='committed',result_json=excluded.result_json",params![project,actor,request,hash,serde_json::to_string(result)?,now()])?;
    Ok(())
}
fn task_version(c: &Connection, key: &str) -> Result<FileTaskVersion> {
    let t = crate::service::task(c, key)?;
    Ok(FileTaskVersion {
        updated_at: t.updated_at,
        claim_generation: t.claim_generation,
    })
}
fn check_task(
    c: &Connection,
    actor: &str,
    key: &str,
    generation: &str,
    updated: &str,
) -> Result<TaskSummary> {
    let t = crate::service::editable(c, key, actor)?;
    crate::context::check_write(
        c,
        actor,
        &t,
        Some(&TaskWriteContext {
            expected_claim_generation: generation.into(),
            expected_updated_at: updated.into(),
        }),
    )?;
    Ok(t)
}
fn link(
    c: &Connection,
    actor: &str,
    input: &TaskFileInput,
    action: &str,
) -> Result<FileMutationResult> {
    let t = check_task(
        c,
        actor,
        &input.task_key,
        &input.expected_claim_generation,
        &input.expected_updated_at,
    )?;
    let a = load_file(c, &input.asset_id, None)?;
    if a.asset.jam_id != t.jam_id {
        return Err(invalid("assetId", "File belongs to another project"));
    }
    if input.position.is_some_and(|p| !p.is_finite()) {
        return Err(invalid("position", "Use a finite position"));
    }
    let chosen_role = role(input.role.as_deref())?;
    match action {"link"=>{c.execute("INSERT INTO task_assets(task_id,asset_id,role,position,created_by,created_at) VALUES(?,?,?,?,?,?)",params![t.id,input.asset_id,chosen_role,input.position.unwrap_or(0.),actor,now()])?;},"set_role"=>{if c.execute("UPDATE task_assets SET role=?,position=coalesce(?,position) WHERE task_id=? AND asset_id=?",params![chosen_role,input.position,t.id,input.asset_id])?!=1{return Err(Error::NotFound("Task file association".into()));}},"unlink"=>{if c.execute("DELETE FROM task_assets WHERE task_id=? AND asset_id=?",params![t.id,input.asset_id])?!=1{return Err(Error::NotFound("Task file association".into()));}},_=>return Err(invalid("operation","Unknown file mutation"))}
    crate::service::touch(c, &t.id, actor)?;
    crate::service::event(
        c,
        Some(&t.jam_id),
        actor,
        "asset.linked",
        Some(&t.id),
        serde_json::json!({"assetId":input.asset_id,"fileAction":action,"role":chosen_role}),
    )?;
    let task_file = if action == "unlink" {
        None
    } else {
        task_files(c, &t.id)?
            .into_iter()
            .find(|f| f.asset.asset.id == input.asset_id)
    };
    Ok(FileMutationResult {
        reference: None,
        asset: Some(a),
        task_file,
        task_version: Some(task_version(c, &t.key)?),
        operation_id: input.request_id.clone(),
        unlinked: action == "unlink",
        warnings: vec![],
    })
}
impl Store {
    /// Preserve resumable requests. Reap only cancelled, verified, unreferenced primary copies after a grace period.
    pub fn reconcile_file_operations(&self) -> Result<Vec<FileOperationStatus>> {
        let Some(folder) = crate::project_folders::folder_for_db(&self.path) else {
            return Ok(vec![]);
        };
        let project = self.active_jam()?.id;
        let grace = self
            .setting("file_operation_grace_seconds")?
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(86400)
            .max(0);
        let rows=self.read(|c|Ok(c.prepare("SELECT actor_id,request_id,state,result_json,created_at FROM file_operations WHERE project_id=? AND state IN ('copying','cancelled') ORDER BY actor_id,request_id")?.query_map([&project],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,String>(4)?)))?.collect::<std::result::Result<Vec<_>,_>>()?))?;
        let mut statuses = Vec::new();
        let ops = folder.join(".state/operations");
        for (actor, request, state, result, created) in rows {
            statuses.push(FileOperationStatus {
                request_id: request.clone(),
                can_cancel: state == "copying",
                state: state.clone(),
            });
            if state != "cancelled"
                || time::OffsetDateTime::parse(
                    &created,
                    &time::format_description::well_known::Rfc3339,
                )
                .ok()
                .is_none_or(|at| {
                    time::OffsetDateTime::now_utc() - at < time::Duration::seconds(grace)
                })
            {
                continue;
            }
            let key = crate::storage_io::hash(format!("{project}/{actor}/{request}").as_bytes());
            let file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(ops.join(format!("{key}.lock")))?;
            if file.try_lock().is_err() {
                continue;
            }
            let Some(stored) = result
                .and_then(|v| serde_json::from_str::<String>(&v).ok())
                .filter(|p| p.starts_with("files/"))
            else {
                continue;
            };
            let referenced = self.read(|c| {
                Ok(c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM assets WHERE jam_id=? AND stored_path=?)",
                    params![project, stored],
                    |r| r.get::<_, bool>(0),
                )?)
            })?;
            if referenced {
                continue;
            }
            let target = crate::storage_io::contained(&folder, &stored)?;
            let physical = target.canonicalize().ok();
            let adopted = self
                .list_file_assets(FileAssetQuery::default())
                .map(|assets| {
                    assets.into_iter().any(|asset| {
                        asset.storage_type != "url"
                            && (asset.resolution.resolved_path.is_none()
                                || asset
                                    .resolution
                                    .resolved_path
                                    .as_ref()
                                    .and_then(|p| Path::new(p).canonicalize().ok())
                                    .is_some_and(|p| Some(p) == physical))
                    })
                })
                .unwrap_or(true);
            if adopted {
                continue;
            }
            if let Ok(receipt) = std::fs::read(ops.join(format!("{key}.json")))
                && let Ok(receipt) = serde_json::from_slice::<serde_json::Value>(&receipt)
                && receipt["version"] == 1
                && receipt["target"] == stored
                && let Ok(bytes) = File::open(&target)
                && receipt["sha256"] == crate::storage_io::hash_reader(bytes)?.0
            {
                std::fs::remove_file(&target)?;
            }
            let stage = ops.join(format!("{key}.part"));
            if stage.is_file() && !std::fs::symlink_metadata(&stage)?.file_type().is_symlink() {
                std::fs::remove_file(stage)?;
            }
        }
        Ok(statuses)
    }
    pub fn file_operation_status(&self, actor: &str, request: &str) -> Result<FileOperationStatus> {
        self.read(|c|{let project=crate::service::jam(c)?.id;crate::projects::ensure_member_scope(c,actor)?;let state=c.query_row("SELECT state FROM file_operations WHERE project_id=? AND actor_id=? AND request_id=?",params![project,actor,request],|r|r.get::<_,String>(0)).optional()?.ok_or_else(||Error::NotFound("File operation".into()))?;Ok(FileOperationStatus{request_id:request.into(),can_cancel:state=="copying",state})})
    }
    pub fn cancel_file_operation(&self, actor: &str, request: &str) -> Result<FileOperationStatus> {
        self.write(|c|{let project=crate::service::jam(c)?.id;crate::projects::ensure_member_scope(c,actor)?;c.execute("UPDATE file_operations SET state='cancelled' WHERE project_id=? AND actor_id=? AND request_id=? AND state='copying'",params![project,actor,request])?;Ok(())})?;
        self.file_operation_status(actor, request)
    }
    fn ensure_copy_active(&self, actor: &str, request: &str) -> Result<()> {
        if self.file_operation_status(actor, request)?.state == "cancelled" {
            return Err(invalid(
                "operation",
                "File copy cancelled; no asset or task association was committed",
            ));
        }
        Ok(())
    }
    pub fn resolve_file(&self, input: ResolveFile) -> Result<FileResolution> {
        self.read(|c| {
            Ok(load_file_with_refresh(
                c,
                &input.asset_id,
                input.working_directory.as_deref(),
                true,
            )?
            .resolution)
        })
    }
    pub fn list_file_assets(&self, q: FileAssetQuery) -> Result<Vec<FileAsset>> {
        if let Some(kind) = &q.kind {
            crate::m5::validate_kind(kind)?;
        }
        if q.limit.is_some_and(|n| n == 0 || n > 500) {
            return Err(invalid("limit", "Use 1–500"));
        }
        self.read(|c| {
            let project = crate::service::jam(c)?;
            let ids = c
                .prepare("SELECT id FROM assets WHERE jam_id=? ORDER BY id")?
                .query_map([project.id], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let mut files = Vec::new();
            let links = if let Some(key) = &q.task_key {
                Some(task_files(c, &crate::service::task(c, key)?.id)?)
            } else {
                None
            };
            for id in ids {
                let a = load_file(c, &id, q.working_directory.as_deref())?;
                if q.kind.as_ref().is_some_and(|k| *k != a.asset.kind)
                    || q.storage_type
                        .as_ref()
                        .is_some_and(|s| *s != a.storage_type)
                    || q.query.as_ref().is_some_and(|s| {
                        !format!("{} {}", a.asset.name, a.stored_path)
                            .to_lowercase()
                            .contains(&s.to_lowercase())
                    })
                {
                    continue;
                }
                if let Some(links) = &links {
                    if !links.iter().any(|f| {
                        f.asset.asset.id == id && q.role.as_ref().is_none_or(|r| *r == f.role)
                    }) {
                        continue;
                    }
                } else if q.role.is_some() {
                    return Err(invalid("role", "taskKey is required for role filtering"));
                }
                files.push(a);
            }
            let offset = q
                .cursor
                .as_deref()
                .unwrap_or("0")
                .parse::<usize>()
                .map_err(|_| invalid("cursor", "Use a nonnegative offset"))?;
            Ok(files
                .into_iter()
                .skip(offset)
                .take(q.limit.unwrap_or(usize::MAX))
                .collect())
        })
    }
    pub fn link_task_file(&self, actor: &str, input: TaskFileInput) -> Result<FileMutationResult> {
        if input.role.is_none() {
            return Err(invalid("role", "Specify the file role"));
        }
        self.mutate_task_file(actor, input, "link")
    }
    pub fn set_task_file_role(
        &self,
        actor: &str,
        input: TaskFileInput,
    ) -> Result<FileMutationResult> {
        if input.role.is_none() {
            return Err(invalid("role", "Specify the new role"));
        }
        self.mutate_task_file(actor, input, "set_role")
    }
    pub fn unlink_task_file(
        &self,
        actor: &str,
        input: TaskFileInput,
    ) -> Result<FileMutationResult> {
        self.mutate_task_file(actor, input, "unlink")
    }
    fn mutate_task_file(
        &self,
        actor: &str,
        input: TaskFileInput,
        action: &str,
    ) -> Result<FileMutationResult> {
        crate::m5::validate_name("requestId", &input.request_id, 200)?;
        let hash = payload_hash(action, &input)?;
        self.write(|c| {
            let project = crate::service::jam(c)?.id;
            crate::projects::ensure_member_scope(c, actor)?;
            if let Some(r) = replay(c, &project, actor, &input.request_id, &hash)? {
                return Ok(r);
            }
            let r = link(c, actor, &input, action)?;
            finish(c, &project, actor, &input.request_id, &hash, &r)?;
            Ok(r)
        })
    }
    pub fn register_file(&self, actor: &str, input: RegisterFile) -> Result<FileMutationResult> {
        self.register_file_with_reference(actor, input, None)
    }
    pub(crate) fn register_file_with_reference(
        &self,
        actor: &str,
        input: RegisterFile,
        reference: Option<AddReference>,
    ) -> Result<FileMutationResult> {
        let _operation_lease = self.project_lease()?;
        crate::m5::validate_name("requestId", &input.request_id, 200)?;
        let hash = payload_hash("register", &(&input, &reference))?;
        if input.task_key.is_none() && input.role.is_some() {
            return Err(invalid("role", "Task role requires taskKey"));
        }
        if input
            .notes
            .as_ref()
            .is_some_and(|n| n.chars().count() > 4000)
        {
            return Err(invalid("notes", "Use at most 4000 characters"));
        }
        let project = self.active_jam()?.id;
        let folder = crate::project_folders::folder_for_db(&self.path);
        let ops = folder
            .as_ref()
            .map(|p| p.join(".state/operations"))
            .unwrap_or_else(|| {
                self.path
                    .parent()
                    .unwrap_or(Path::new("."))
                    .join("file-operations")
            });
        std::fs::create_dir_all(&ops)?;
        let _lock = crate::storage_io::lock(&ops.join(format!(
            "{}.lock",
            crate::storage_io::hash(format!("{project}/{actor}/{}", input.request_id).as_bytes())
        )))?;
        let existing = self.read(|c| {
            crate::service::member(c, actor)?;
            crate::projects::ensure_member_scope(c, actor)?;
            replay(c, &project, actor, &input.request_id, &hash)
        })?;
        if let Some(r) = existing {
            return Ok(r);
        }
        if let Some(key) = &input.task_key {
            self.read(|c| {
                check_task(
                    c,
                    actor,
                    key,
                    input
                        .expected_claim_generation
                        .as_deref()
                        .ok_or_else(|| invalid("expectedClaimGeneration", "Read get_task first"))?,
                    input
                        .expected_updated_at
                        .as_deref()
                        .ok_or_else(|| invalid("expectedUpdatedAt", "Read get_task first"))?,
                )
                .map(|_| ())
            })?;
        }
        let storage = input.storage_type.as_str();
        let companions = input.companions.clone().unwrap_or_default();
        if !companions.is_empty() && storage != "board_file" {
            return Err(invalid(
                "companions",
                "Companions require an owned board-file package",
            ));
        }
        let operation_hash =
            crate::storage_io::hash(format!("{project}/{actor}/{}", input.request_id).as_bytes());
        let mut base = input.path_base.clone().unwrap_or_else(|| {
            if storage == "board_file" {
                "board"
            } else if storage == "url" {
                "url"
            } else {
                "absolute"
            }
            .into()
        });
        let (source, mut stored) = if storage == "url" {
            if input.source_path.is_some() {
                return Err(invalid("sourcePath", "URL and sourcePath are exclusive"));
            }
            let url = input
                .url
                .clone()
                .ok_or_else(|| invalid("url", "URL is required"))?;
            valid_url(&url)?;
            (None, url)
        } else {
            if input.url.is_some() {
                return Err(invalid("url", "URL and sourcePath are exclusive"));
            }
            let raw = input
                .source_path
                .as_ref()
                .ok_or_else(|| invalid("sourcePath", "File source is required"))?;
            let mut source = PathBuf::from(raw);
            if !source.is_absolute() {
                if base != "repo" {
                    return Err(invalid(
                        "sourcePath",
                        "Use an absolute path or a validated repo-relative path",
                    ));
                }
                let root = input.working_directory.as_deref().ok_or_else(|| {
                    invalid("workingDirectory", "Relative repo paths require a worktree")
                })?;
                let anchor = folder
                    .as_deref()
                    .and_then(|f| repository_context(f).ok().flatten())
                    .ok_or_else(|| invalid("workingDirectory", "No anchor repository"))?;
                let work = repository_context(Path::new(root))?
                    .ok_or_else(|| invalid("workingDirectory", "No worktree repository"))?;
                if work.1 != anchor.1 {
                    return Err(invalid("workingDirectory", "Unrelated repository"));
                }
                source = crate::storage_io::contained(&work.0, raw)?;
            }
            let source = source.canonicalize()?;
            validate_private_source(&self.path, self.app_data_dir.as_deref(), &source)?;
            if !source.is_file() {
                return Err(invalid("sourcePath", "Choose a readable file"));
            }
            let mut stored = source.to_string_lossy().into_owned();
            if storage == "linked_file"
                && let Some(anchor) = folder
                    .as_deref()
                    .and_then(|f| repository_context(f).ok().flatten())
            {
                let context = input
                    .working_directory
                    .as_deref()
                    .map(Path::new)
                    .unwrap_or(&anchor.0);
                let work = repository_context(context)?
                    .ok_or_else(|| invalid("workingDirectory", "No worktree"))?;
                if work.1 != anchor.1 {
                    return Err(invalid("workingDirectory", "Unrelated repository"));
                }
                if let Ok(rel) = source.strip_prefix(&work.0) {
                    base = "repo".into();
                    stored = rel.to_string_lossy().replace('\\', "/");
                } else {
                    base = "absolute".into();
                }
            }
            (Some(source), stored)
        };
        if (storage == "board_file" && base != "board")
            || (storage == "url" && base != "url")
            || (storage == "linked_file" && base != "repo" && base != "absolute")
        {
            return Err(invalid("pathBase", "Invalid storage discriminator"));
        }
        let original = source
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or(&stored)
            .to_string();
        let name = input.name.clone().unwrap_or_else(|| original.clone());
        crate::m5::validate_name("name", &name, 140)?;
        let kind = input.file_kind.clone().unwrap_or_else(|| {
            classify_file(source.as_deref().unwrap_or(Path::new("link"))).into()
        });
        crate::m5::validate_kind(&kind)?;
        let mut content_hash = None;
        let mut size = None;
        let mut component_inventory = Vec::new();
        if storage == "board_file" {
            let anchor = folder.as_deref().ok_or_else(|| {
                invalid(
                    "storageType",
                    "Move this legacy project to a folder before copying board files",
                )
            })?;
            let (manifest, _) = read_manifest(anchor)?;
            let relative = &manifest.folder_rules[&kind];
            let mut dest_dir = crate::storage_io::contained(anchor, relative)?;
            std::fs::create_dir_all(&dest_dir)?;
            let mut required = source.as_ref().unwrap().metadata()?.len();
            for companion in &companions {
                validate_private_source(
                    &self.path,
                    self.app_data_dir.as_deref(),
                    Path::new(&companion.source_path),
                )?;
                required = required
                    .checked_add(std::fs::metadata(&companion.source_path)?.len())
                    .ok_or_else(|| invalid("diskSpace", "Aggregate file size overflow"))?;
            }
            crate::storage_io::require_space(&dest_dir, required)?;
            let source_name = source
                .as_ref()
                .unwrap()
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("File");
            let requested_name = if let Some(title) = input.name.as_ref() {
                let ext = Path::new(source_name).extension().and_then(|s| s.to_str());
                if Path::new(title).extension().is_none()
                    && let Some(ext) = ext
                {
                    format!("{title}.{ext}")
                } else {
                    title.clone()
                }
            } else {
                source_name.into()
            };
            let readable = readable_file_name(&requested_name);
            let pending:Option<String>=self.read(|c|Ok(c.query_row("SELECT result_json FROM file_operations WHERE project_id=? AND actor_id=? AND request_id=? AND state='copying'",params![project,actor,input.request_id],|r|r.get(0)).optional()?.flatten()))?;
            if !companions.is_empty() {
                dest_dir = dest_dir.join(format!(
                    "{}-{}",
                    Path::new(&readable).file_stem().unwrap().to_string_lossy(),
                    &operation_hash[..12]
                ));
                if pending.is_none() {
                    std::fs::create_dir(&dest_dir)?;
                } else if !dest_dir.is_dir() {
                    return Err(invalid("operation", "Pending companion package is absent"));
                }
                let mut uris = std::collections::BTreeSet::new();
                for companion in &companions {
                    crate::storage_io::contained(&dest_dir, &companion.relative_uri)?;
                    if !uris.insert(companion.relative_uri.clone())
                        || companion.relative_uri == readable
                    {
                        return Err(invalid(
                            "companions",
                            "Duplicate or primary-file companion URI",
                        ));
                    }
                }
            }
            let target = if let Some(path) = pending {
                stored = serde_json::from_str(&path)?;
                let target = crate::storage_io::contained(anchor, &stored)?;
                if self.read(|c| {
                    Ok(c.query_row(
                        "SELECT EXISTS(SELECT 1 FROM assets WHERE jam_id=? AND stored_path=?)",
                        params![project, stored],
                        |r| r.get::<_, bool>(0),
                    )?)
                })? {
                    return Err(Error::Conflict);
                }
                if target.metadata().is_ok_and(|m| m.len() > 0) {
                    let receipt: serde_json::Value = serde_json::from_slice(&std::fs::read(
                        ops.join(format!("{operation_hash}.json")),
                    )?)?;
                    let actual = crate::storage_io::hash_reader(File::open(&target)?)?.0;
                    if receipt["target"] != stored || receipt["sha256"] != actual {
                        return Err(Error::Conflict);
                    }
                }
                target
            } else {
                let mut n = 1;
                let target = loop {
                    let filename = if n == 1 {
                        readable.clone()
                    } else {
                        let p = Path::new(&readable);
                        let stem = p.file_stem().unwrap().to_string_lossy();
                        match p.extension() {
                            Some(e) => format!("{stem} ({n}).{}", e.to_string_lossy()),
                            None => format!("{stem} ({n})"),
                        }
                    };
                    let target = dest_dir.join(filename);
                    match OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&target)
                    {
                        Ok(_) => break target,
                        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                            n += 1;
                        }
                        Err(e) => return Err(e.into()),
                    }
                };
                stored = target
                    .strip_prefix(anchor)
                    .map_err(|_| invalid("path", "Escaping target"))?
                    .to_string_lossy()
                    .replace('\\', "/");
                self.write(|c| {
                    c.execute(
                        "INSERT INTO file_operations VALUES(?,?,?,?,'copying',?,?)",
                        params![
                            project,
                            actor,
                            input.request_id,
                            hash,
                            serde_json::to_string(&stored)?,
                            now()
                        ],
                    )?;
                    Ok(())
                })?;
                target
            };
            let mut from = File::open(source.as_ref().unwrap())?;
            self.ensure_copy_active(actor, &input.request_id)?;
            let before = crate::storage_io::hash_reader(CancelReader {
                file: &mut from,
                store: self,
                actor,
                request: &input.request_id,
                last_check: std::time::Instant::now(),
            })?;
            use std::io::Seek;
            if let Ok(bytes) = std::fs::read(ops.join(format!("{operation_hash}.json"))) {
                let receipt: serde_json::Value = serde_json::from_slice(&bytes)?;
                if receipt["target"] == stored
                    && receipt["sha256"]
                        .as_str()
                        .is_some_and(|hash| hash != before.0)
                {
                    return Err(Error::Conflict);
                }
            }
            from.rewind()?;
            let stage = ops.join(format!("{}.part", operation_hash));
            let mut dest = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&stage)?;
            std::io::copy(
                &mut CancelReader {
                    file: &mut from,
                    store: self,
                    actor,
                    request: &input.request_id,
                    last_check: std::time::Instant::now(),
                },
                &mut dest,
            )?;
            dest.sync_all()?;
            drop(dest);
            let after = crate::storage_io::hash_reader(File::open(&stage)?)?;
            if before != after {
                return Err(invalid(
                    "copy",
                    "Source changed or copy verification failed; retry",
                ));
            }
            crate::storage_io::atomic_write(
                &ops.join(format!("{}.json", operation_hash)),
                &serde_json::to_vec(
                    &serde_json::json!({"version":1,"target":stored,"sha256":after.0,"size":after.1}),
                )?,
            )?;
            // Exclusive reservation belongs to this operation; replacing it cannot overwrite another file.
            self.ensure_copy_active(actor, &input.request_id)?;
            crate::storage_io::replace_owned(&stage, &target)?;
            content_hash = Some(after.0);
            size = Some(i64::try_from(after.1).map_err(|_| invalid("file", "File too large"))?);
            for companion in &companions {
                let source = Path::new(&companion.source_path);
                if !source.is_absolute() || !source.is_file() {
                    return Err(invalid(
                        "companions",
                        "Choose existing absolute companion files",
                    ));
                }
                let target = crate::storage_io::contained(&dest_dir, &companion.relative_uri)?;
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let expected = crate::storage_io::hash_reader(File::open(source)?)?;
                if target.exists() {
                    if crate::storage_io::hash_reader(File::open(&target)?)? != expected {
                        return Err(invalid(
                            "companions",
                            "Companion target differs; never overwrite external bytes",
                        ));
                    }
                } else {
                    let mut src = File::open(source)?;
                    let mut dst = OpenOptions::new()
                        .create_new(true)
                        .write(true)
                        .open(&target)?;
                    self.ensure_copy_active(actor, &input.request_id)?;
                    std::io::copy(
                        &mut CancelReader {
                            file: &mut src,
                            store: self,
                            actor,
                            request: &input.request_id,
                            last_check: std::time::Instant::now(),
                        },
                        &mut dst,
                    )?;
                    dst.sync_all()?;
                    drop(dst);
                    if crate::storage_io::hash_reader(File::open(&target)?)? != expected {
                        return Err(invalid("companions", "Companion changed during copying"));
                    }
                }
                component_inventory.push((
                    id(),
                    companion.relative_uri.clone(),
                    target
                        .strip_prefix(anchor)
                        .map_err(|_| invalid("companions", "Escaping package"))?
                        .to_string_lossy()
                        .replace('\\', "/"),
                    expected.0,
                    i64::try_from(expected.1).map_err(|_| invalid("file", "File too large"))?,
                    source.file_name().unwrap().to_string_lossy().into_owned(),
                    classify_file(source),
                ));
            }
        }
        let asset_id = id();
        let location = resolve(
            folder.as_deref(),
            storage,
            &base,
            &stored,
            input.working_directory.as_deref(),
            true,
        )?
        .resolved_path
        .unwrap_or_else(|| stored.clone());
        self.write(|c|{if let Some(r)=replay(c,&project,actor,&input.request_id,&hash)?{return Ok(r);}
            c.execute("INSERT INTO assets(id,jam_id,kind,name,location,notes,created_by,created_at,storage_type,path_base,stored_path,original_name,byte_size,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",params![asset_id,project,kind,name,location,input.notes,actor,now(),storage,base,stored,original,size,content_hash])?;
            for (component_id,uri,path,hash,size,name,kind) in &component_inventory {
                c.execute("INSERT INTO assets(id,jam_id,kind,name,location,created_by,created_at,storage_type,path_base,stored_path,original_name,content_hash,byte_size) VALUES(?,?,?,?,?,?,?,'board_file','board',?,?,?,?)",params![component_id,project,kind,name,path,actor,now(),path,name,hash,size])?;
                c.execute("INSERT INTO asset_components VALUES(?,?,?)",params![asset_id,uri,component_id])?;
            }
            let mut result=if let Some(key)=&input.task_key {link(c,actor,&TaskFileInput{task_key:key.clone(),asset_id:asset_id.clone(),role:input.role.clone(),position:None,expected_claim_generation:input.expected_claim_generation.clone().unwrap(),expected_updated_at:input.expected_updated_at.clone().unwrap(),request_id:input.request_id.clone()},"link")?}else{crate::service::event(c,Some(&project),actor,"asset.created",None,serde_json::json!({"assetId":asset_id,"name":name}))?;FileMutationResult{reference:None,asset:Some(load_file(c,&asset_id,None)?),task_file:None,task_version:None,operation_id:input.request_id.clone(),unlinked:false,warnings:vec![]}};
            if ["gltf","obj"].contains(&source.as_ref().and_then(|p|p.extension()).and_then(|s|s.to_str()).unwrap_or("")){result.warnings.push("Companions may be unresolved; no remote dependency is fetched".into());}
            if size.is_some_and(|s|s>50*1024*1024){result.warnings.push("Large file: review your backup and Git/LFS policy".into());}
            if let Some(reference)=reference { result.reference=Some(crate::references::add_reference_tx(c,actor,reference,false,Some(&asset_id))?); }
            finish(c,&project,actor,&input.request_id,&hash,&result)?;Ok(result)})
    }
}
