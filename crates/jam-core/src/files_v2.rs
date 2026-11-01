use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specta::Type;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};
fn current_asset(c: &Connection, id: &str) -> Result<Asset> {
    let asset: Asset = crate::planning::fetch(c, "assets", "id", id)?;
    if asset.jam_id != crate::service::jam(c)?.id {
        return Err(Error::Forbidden("Asset belongs to another project".into()));
    }
    Ok(asset)
}

/// Target of a file association; project scope needs no key.
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileScope {
    /// Target kind: project, epic, story or task; required. Example: story.
    #[serde(rename = "type")]
    pub kind: ScopeKind,
    /// Target board key, e.g. JB-S3; required for entity links. Omit for project scope or when filtering all targets of one kind.
    pub key: Option<String>,
}
/// Purpose of a file on its scope; task roles and document roles are checked separately.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FileLinkRole {
    /// Default on project, epic and story scopes.
    Document,
    /// Reference on any scope; default on tasks.
    Reference,
    /// Task input to edit.
    ToEdit,
    /// Task output.
    Result,
}
impl FileLinkRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Reference => "reference",
            Self::ToEdit => "to_edit",
            Self::Result => "result",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkFileInput {
    /// Exact association scope, e.g. {"type":"story","key":"JB-S3"}; required.
    pub scope: FileScope,
    /// Existing asset in this project, e.g. 01JASSET; required.
    pub asset_id: String,
    /// Optional role; defaults to document for project/epic/story, reference for tasks.
    pub role: Option<FileLinkRole>,
    /// Optional stable retry ID, 1–100 chars, e.g. link-design-S3; recommended.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
    /// Exact task updatedAt captured before deciding; required only for task scope.
    pub expected_updated_at: Option<String>,
    /// Exact task claimGeneration captured before deciding; required only for task scope.
    pub expected_claim_generation: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnlinkFileInput {
    /// Exact association scope; required. Example: {"type":"epic","key":"JB-E2"}.
    pub scope: FileScope,
    /// Asset to unlink, e.g. 01JASSET; required. Its bytes remain untouched.
    pub asset_id: String,
    /// Optional stable retry ID, 1–100 chars, e.g. unlink-design-E2; recommended.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
    /// Exact task updatedAt captured before deciding; required only for task scope.
    pub expected_updated_at: Option<String>,
    /// Exact task claimGeneration captured before deciding; required only for task scope.
    pub expected_claim_generation: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetReadInput {
    /// Existing asset ID in the connected project, e.g. 01JASSET; required.
    pub asset_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRequestInput {
    /// Existing asset ID in the connected project, e.g. 01JASSET; required.
    pub asset_id: String,
    /// Optional stable retry ID, 1–100 chars, e.g. archive-design; recommended.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameAssetInput {
    /// Existing asset ID in this project, e.g. 01JASSET; required.
    pub asset_id: String,
    /// Display name, 1–140 chars, e.g. Bridge design; required. The disk name stays unchanged.
    pub name: String,
    /// Optional stable retry ID, 1–100 chars, e.g. rename-design; recommended.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteAssetInput {
    /// Asset ID in this project, e.g. 01JASSET; required. Linked-file bytes are never removed.
    pub asset_id: String,
    /// Optional stable retry ID, 1–100 chars, e.g. delete-design; recommended.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
    /// Remove all associations after explicit human intent; default false. In-use assets otherwise return their usage.
    #[serde(default)]
    pub force: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceAssetInput {
    /// Existing asset ID in this project, e.g. 01JASSET; required.
    pub asset_id: String,
    /// New readable source path, e.g. C:/game/docs/new-plan.md; required for board or linked files, exclusive with url.
    pub source_path: Option<String>,
    /// New HTTP(S) URL without credentials or whitespace; required for URL assets, exclusive with sourcePath.
    pub url: Option<String>,
    /// Optional stable retry ID, 1–100 chars, e.g. replace-design-v2; recommended. Old board bytes are retained.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetTaskUsage {
    pub key: String,
    pub title: String,
    pub role: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetScopeUsage {
    #[serde(rename = "type")]
    pub kind: ScopeKind,
    pub key: Option<String>,
    pub title: String,
    pub role: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetCanvasUsage {
    pub item_id: String,
    pub frame_title: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetUsage {
    pub tasks: Vec<AssetTaskUsage>,
    pub scopes: Vec<AssetScopeUsage>,
    pub canvas: Vec<AssetCanvasUsage>,
    pub covers: Vec<String>,
    pub components: Vec<String>,
}
impl AssetUsage {
    pub fn count(&self) -> usize {
        let tasks = self
            .tasks
            .iter()
            .map(|t| t.key.as_str())
            .chain(self.covers.iter().map(String::as_str))
            .collect::<BTreeSet<_>>();
        tasks.len() + self.scopes.len() + self.canvas.len() + self.components.len()
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetRevision {
    pub asset_id: String,
    pub revision: i64,
    pub stored_path: String,
    pub byte_size: Option<i64>,
    pub content_hash: Option<String>,
    pub mime_type: Option<String>,
    pub created_by: String,
    pub created_at: String,
}
struct ScopeTarget {
    kind: ScopeKind,
    id: String,
    key: Option<String>,
    epic: Option<String>,
    task: Option<TaskSummary>,
}
fn scope_target(c: &Connection, scope: &FileScope) -> Result<ScopeTarget> {
    let project = crate::service::jam(c)?.id;
    let key = || {
        scope
            .key
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| invalid("scope.key", "Supply the target board key"))
    };
    let (id, key, epic, task) = match scope.kind {
        ScopeKind::Project => {
            if scope.key.is_some() {
                return Err(invalid("scope.key", "Project scope omits key"));
            }
            (crate::service::jam(c)?.id, None, None, None)
        }
        ScopeKind::Epic => {
            let e = crate::planning::epic(c, key()?)?;
            if e.audit.jam_id != project {
                return Err(Error::Forbidden("Scope belongs to another project".into()));
            }
            crate::planning::editable_audit(&e.audit)?;
            (e.audit.id.clone(), Some(e.key), Some(e.audit.id), None)
        }
        ScopeKind::Story => {
            let s = crate::planning::story(c, key()?)?;
            if s.audit.jam_id != project {
                return Err(Error::Forbidden("Scope belongs to another project".into()));
            }
            crate::planning::editable_audit(&s.audit)?;
            (s.audit.id, Some(s.key), Some(s.epic_id), None)
        }
        ScopeKind::Task => {
            let t = crate::service::task(c, key()?)?;
            if t.jam_id != project {
                return Err(Error::Forbidden("Scope belongs to another project".into()));
            }
            (
                t.id.clone(),
                Some(t.key.clone()),
                Some(t.epic_id.clone()),
                Some(t),
            )
        }
    };
    Ok(ScopeTarget {
        kind: scope.kind,
        id,
        key,
        epic,
        task,
    })
}
fn check_task_context(
    c: &Connection,
    actor: &str,
    target: &ScopeTarget,
    updated: Option<&str>,
    claim: Option<&str>,
) -> Result<()> {
    if let Some(task) = &target.task {
        let task = crate::service::editable(c, &task.key, actor)?;
        crate::context::check_write(
            c,
            actor,
            &task,
            Some(&TaskWriteContext {
                expected_updated_at: updated
                    .ok_or_else(|| invalid("expectedUpdatedAt", "Required for task scope"))?
                    .into(),
                expected_claim_generation: claim
                    .ok_or_else(|| invalid("expectedClaimGeneration", "Required for task scope"))?
                    .into(),
            }),
        )?;
    }
    Ok(())
}
fn result(kind: &str, id: &str, key: Option<String>, updated: String) -> CompactMutation {
    CompactMutation {
        kind: kind.into(),
        id: id.into(),
        key,
        updated_at: updated,
        claim_generation: None,
        external_ref: None,
        status: None,
        replayed: None,
    }
}
fn replay(receipt: &serde_json::Value) -> Result<CompactMutation> {
    Ok(serde_json::from_value(receipt.clone())?)
}
pub(crate) fn matches_scope(c: &Connection, asset: &str, scope: &FileScope) -> Result<bool> {
    if scope.kind == ScopeKind::Task {
        let task = scope
            .key
            .as_deref()
            .map(|key| crate::service::task(c, key))
            .transpose()?;
        return Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM task_assets WHERE asset_id=?1 AND (?2 IS NULL OR task_id=?2)) OR EXISTS(SELECT 1 FROM task_presentation WHERE cover_asset_id=?1 AND (?2 IS NULL OR task_id=?2))",params![asset,task.as_ref().map(|t|&t.id)],|r|r.get(0))?);
    }
    let id = match scope.kind {
        ScopeKind::Project => {
            if scope.key.is_some() {
                return Err(invalid("scope.key", "Project scope omits key"));
            }
            Some(crate::service::jam(c)?.id)
        }
        ScopeKind::Epic => scope
            .key
            .as_deref()
            .map(|key| crate::planning::epic(c, key).map(|e| e.audit.id))
            .transpose()?,
        ScopeKind::Story => scope
            .key
            .as_deref()
            .map(|key| crate::planning::story(c, key).map(|s| s.audit.id))
            .transpose()?,
        ScopeKind::Task => unreachable!(),
    };
    Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM scope_files WHERE asset_id=? AND target_type=? AND (? IS NULL OR target_id=?))",params![asset,scope.kind.as_str(),id,id],|r|r.get(0))?)
}
pub(crate) fn asset_usage_tx(c: &Connection, asset_id: &str) -> Result<AssetUsage> {
    let asset: Asset = crate::planning::fetch(c, "assets", "id", asset_id)?;
    let invalid_links:i64=c.query_row("SELECT EXISTS(SELECT 1 FROM task_assets l JOIN tasks t ON t.id=l.task_id WHERE l.asset_id=?1 AND t.jam_id!=?2) OR EXISTS(SELECT 1 FROM scope_files WHERE asset_id=?1 AND jam_id!=?2) OR EXISTS(SELECT 1 FROM ref_items WHERE asset_id=?1 AND jam_id!=?2) OR EXISTS(SELECT 1 FROM task_presentation l JOIN tasks t ON t.id=l.task_id WHERE l.cover_asset_id=?1 AND t.jam_id!=?2) OR EXISTS(SELECT 1 FROM asset_components l JOIN assets a ON a.id=CASE WHEN l.asset_id=?1 THEN l.component_asset_id ELSE l.asset_id END WHERE (l.asset_id=?1 OR l.component_asset_id=?1) AND a.jam_id!=?2)",params![asset_id,asset.jam_id],|r|r.get(0))?;
    if invalid_links != 0 {
        return Err(Error::Forbidden(
            "Asset has cross-project associations; repair them before changing links".into(),
        ));
    }
    let tasks=c.prepare("SELECT t.key,t.title,l.role FROM task_assets l JOIN tasks t ON t.id=l.task_id WHERE l.asset_id=? ORDER BY t.key")?.query_map([asset_id],|r|Ok(AssetTaskUsage{key:r.get(0)?,title:r.get(1)?,role:r.get(2)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let links: Vec<ScopeFile> = crate::planning::records(
        c,
        "scope_files",
        "asset_id=? ORDER BY target_type,target_id",
        &[&asset_id],
    )?;
    let mut scopes = vec![];
    for link in links {
        let kind: ScopeKind = link.target_type.parse()?;
        let (key, title) = match kind {
            ScopeKind::Project => {
                if asset.jam_id != link.target_id {
                    return Err(invalid("scopeFiles", "Invalid project scope"));
                }
                let name =
                    c.query_row("SELECT name FROM jams WHERE id=?", [&asset.jam_id], |r| {
                        r.get::<_, String>(0)
                    })?;
                (None, name)
            }
            ScopeKind::Epic => {
                let e = crate::planning::epic(c, &link.target_id)?;
                (Some(e.key), e.title)
            }
            ScopeKind::Story => {
                let s = crate::planning::story(c, &link.target_id)?;
                (Some(s.key), s.title)
            }
            ScopeKind::Task => {
                return Err(invalid(
                    "scopeFiles",
                    "Task associations belong in task_assets",
                ));
            }
        };
        scopes.push(AssetScopeUsage {
            kind,
            key,
            title,
            role: link.role,
        });
    }
    let canvas=c.prepare("SELECT i.id,f.title FROM ref_items i LEFT JOIN ref_frames f ON f.id=i.frame_id WHERE i.asset_id=? ORDER BY i.id")?.query_map([asset_id],|r|Ok(AssetCanvasUsage{item_id:r.get(0)?,frame_title:r.get(1)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let covers=c.prepare("SELECT t.key FROM task_presentation p JOIN tasks t ON t.id=p.task_id WHERE p.cover_asset_id=? ORDER BY t.key")?.query_map([asset_id],|r|r.get(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let components=c.prepare("SELECT DISTINCT asset_id FROM asset_components WHERE component_asset_id=? ORDER BY asset_id")?.query_map([asset_id],|r|r.get(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(AssetUsage {
        tasks,
        scopes,
        canvas,
        covers,
        components,
    })
}

impl Store {
    pub fn asset_usage(&self, asset_id: &str) -> Result<AssetUsage> {
        self.read(|c| {
            current_asset(c, asset_id)?;
            asset_usage_tx(c, asset_id)
        })
    }
    pub fn file_asset_fresh(&self, input: ResolveFile) -> Result<FileAsset> {
        self.read(|c| {
            current_asset(c, &input.asset_id)?;
            crate::file_model::load_file_with_refresh(
                c,
                &input.asset_id,
                input.working_directory.as_deref(),
                true,
            )
        })
    }
    pub fn link_file(&self, actor: &str, input: LinkFileInput) -> Result<CompactMutation> {
        let request = input.request_id.clone();
        let payload = serde_json::to_value(&input)?;
        self.write(|c|Ok(crate::receipts::with_receipt(c,actor,request.as_deref(),"link_file","scope_file",&payload,||{
            crate::service::member(c,actor)?;let asset=current_asset(c,&input.asset_id)?;
            let target=scope_target(c,&input.scope)?;check_task_context(c,actor,&target,input.expected_updated_at.as_deref(),input.expected_claim_generation.as_deref())?;
            let role=input.role.map(FileLinkRole::as_str).unwrap_or(if target.task.is_some(){"reference"}else{"document"});
            let id;if let Some(task)=&target.task {
                if !FILE_ROLES.contains(&role){return Err(invalid("role","Task role must be to_edit, reference or result"));}
                if let Some(old)=c.query_row("SELECT role FROM task_assets WHERE task_id=? AND asset_id=?",params![task.id,input.asset_id],|r|r.get::<_,String>(0)).optional()? {
                    if input.role.is_some() && old!=role{return Err(invalid("role","Association exists with another role; use set_task_file_role"));}
                    let mut r=result("scope_file",&format!("{}:{}",task.id,input.asset_id),Some(task.key.clone()),task.updated_at.clone());r.claim_generation=Some(task.claim_generation.clone());return Ok(r);
                }
                c.execute("INSERT INTO task_assets(task_id,asset_id,role,position,created_by,created_at) VALUES(?,?,?,(SELECT coalesce(max(position),0)+1024 FROM task_assets WHERE task_id=?),?,?)",params![task.id,input.asset_id,role,task.id,actor,now()])?;
                crate::service::touch(c,&task.id,actor)?;id=format!("{}:{}",task.id,input.asset_id);
            }else{
                if !["document","reference"].contains(&role){return Err(invalid("role","Document role must be document or reference"));}
                if let Some((existing,old,stamp))=c.query_row("SELECT id,role,created_at FROM scope_files WHERE target_type=? AND target_id=? AND asset_id=?",params![target.kind.as_str(),target.id,input.asset_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional()? {
                    if input.role.is_some() && old!=role{return Err(invalid("role","Association exists with another role"));}
                    return Ok(result("scope_file",&existing,target.key,stamp));
                }
                id=crate::id();c.execute("INSERT INTO scope_files(id,jam_id,asset_id,target_type,target_id,role,position,created_by,created_at) VALUES(?,?,?,?,?,?,(SELECT coalesce(max(position),0)+1024 FROM scope_files WHERE target_type=? AND target_id=?),?,?)",params![id,asset.jam_id,input.asset_id,target.kind.as_str(),target.id,role,target.kind.as_str(),target.id,actor,now()])?;
            }
            crate::planning::v2_event(c,actor,target.epic.as_deref(),"asset.linked",target.task.as_ref().map(|t|t.id.as_str()),json!({"assetId":input.asset_id,"scope":input.scope,"role":role}))?;
            let mut r=result("scope_file",&id,target.key,now());
            if let Some(task)=target.task {let task=crate::service::task(c,&task.key)?;r.updated_at=task.updated_at;r.claim_generation=Some(task.claim_generation);}
            Ok(r)
        },replay)?.value))
    }
    pub fn unlink_file(&self, actor: &str, input: UnlinkFileInput) -> Result<CompactMutation> {
        let request = input.request_id.clone();
        let payload = serde_json::to_value(&input)?;
        self.write(|c|Ok(crate::receipts::with_receipt(c,actor,request.as_deref(),"unlink_file","scope_file",&payload,||{
            crate::service::member(c,actor)?;current_asset(c,&input.asset_id)?;
            let target=scope_target(c,&input.scope)?;check_task_context(c,actor,&target,input.expected_updated_at.as_deref(),input.expected_claim_generation.as_deref())?;
            let id;if let Some(task)=&target.task {
                if c.execute("DELETE FROM task_assets WHERE task_id=? AND asset_id=?",params![task.id,input.asset_id])?!=1{return Err(Error::NotFound("Task file association".into()));}
                crate::service::touch(c,&task.id,actor)?;id=format!("{}:{}",task.id,input.asset_id);
            }else{
                id=c.query_row("SELECT id FROM scope_files WHERE target_type=? AND target_id=? AND asset_id=?",params![target.kind.as_str(),target.id,input.asset_id],|r|r.get::<_,String>(0)).optional()?.ok_or_else(||Error::NotFound("Scope file association".into()))?;
                c.execute("DELETE FROM scope_files WHERE id=?",[&id])?;
            }
            crate::planning::v2_event(c,actor,target.epic.as_deref(),"asset.unlinked",target.task.as_ref().map(|t|t.id.as_str()),json!({"assetId":input.asset_id,"scope":input.scope}))?;
            let mut r=result("scope_file",&id,target.key,now());if let Some(task)=target.task {let task=crate::service::task(c,&task.key)?;r.updated_at=task.updated_at;r.claim_generation=Some(task.claim_generation);}
            Ok(r)
        },replay)?.value))
    }
    pub fn archive_asset(&self, actor: &str, input: AssetRequestInput) -> Result<CompactMutation> {
        self.set_asset_archive(actor, input, true)
    }
    pub fn unarchive_asset(
        &self,
        actor: &str,
        input: AssetRequestInput,
    ) -> Result<CompactMutation> {
        self.set_asset_archive(actor, input, false)
    }
    fn set_asset_archive(
        &self,
        actor: &str,
        input: AssetRequestInput,
        archive: bool,
    ) -> Result<CompactMutation> {
        let payload = serde_json::to_value(&input)?;
        let request = input.request_id.clone();
        self.write(|c|Ok(crate::receipts::with_receipt(c,actor,request.as_deref(),if archive{"archive_asset"}else{"unarchive_asset"},"asset",&payload,||{
            crate::service::member(c,actor)?;let asset=current_asset(c,&input.asset_id)?;
            let stamp=now();if asset.archived_at.is_some()!=archive {
                c.execute("UPDATE assets SET archived_at=?,archived_by=? WHERE id=?",params![archive.then_some(&stamp),archive.then_some(actor),asset.id])?;
                crate::service::event(c,Some(&asset.jam_id),actor,"asset.updated",None,json!({"assetId":asset.id,"fileAction":if archive{"archived"}else{"unarchived"}}))?;
            }
            Ok(result("asset",&asset.id,None,stamp))
        },replay)?.value))
    }
    pub fn rename_asset(&self, actor: &str, input: RenameAssetInput) -> Result<CompactMutation> {
        crate::m5::validate_name("name", &input.name, 140)?;
        let payload = serde_json::to_value(&input)?;
        let request = input.request_id.clone();
        self.write(|c|Ok(crate::receipts::with_receipt(c,actor,request.as_deref(),"rename_asset","asset",&payload,||{
            crate::service::member(c,actor)?;let asset=current_asset(c,&input.asset_id)?;
            if asset.name!=input.name {c.execute("UPDATE assets SET name=? WHERE id=?",params![input.name,asset.id])?;crate::service::event(c,Some(&asset.jam_id),actor,"asset.updated",None,json!({"assetId":asset.id,"fileAction":"renamed","from":asset.name,"to":input.name}))?;}
            Ok(result("asset",&asset.id,None,now()))
        },replay)?.value))
    }
    pub fn list_asset_revisions(&self, asset_id: &str) -> Result<Vec<AssetRevision>> {
        let project = self.active_jam()?.id;
        let (root, _) = self.asset_state_root(&project)?;
        self.read(|c| {
            current_asset(c, asset_id)?;
            let mut rows: Vec<AssetRevision> = crate::planning::records(
                c,
                "asset_revisions",
                "asset_id=? ORDER BY revision DESC",
                &[&asset_id],
            )?;
            for row in &mut rows {
                row.stored_path =
                    display_path(&crate::storage_io::contained(&root, &row.stored_path)?);
            }
            Ok(rows)
        })
    }
}

pub(crate) fn mime_for_path(path: &Path) -> Option<String> {
    Some(
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "md" | "markdown" => "text/markdown",
            "txt" | "log" => "text/plain",
            "json" => "application/json",
            "csv" => "text/csv",
            "yaml" | "yml" | "toml" => "text/plain",
            "pdf" => "application/pdf",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            "wav" => "audio/wav",
            "mp3" => "audio/mpeg",
            "ogg" => "audio/ogg",
            "flac" => "audio/flac",
            "m4a" | "aac" => "audio/mp4",
            "mp4" | "m4v" => "video/mp4",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            "mkv" => "video/x-matroska",
            "avi" => "video/x-msvideo",
            _ => return None,
        }
        .into(),
    )
}
fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect()
}
fn source_path(store: &Store, raw: &str) -> Result<PathBuf> {
    let mut path = PathBuf::from(raw);
    if !path.is_absolute() {
        let anchor =
            store.read(|c| crate::file_model::file_anchor(c, &crate::service::jam(c)?.id))?;
        let repo = repository_context(&anchor)?.ok_or_else(|| {
            invalid(
                "sourcePath",
                "Relative source paths require the board's verified repository",
            )
        })?;
        path = crate::storage_io::contained(&repo.0, raw)?;
    }
    let path = path
        .canonicalize()
        .map_err(|e| invalid("sourcePath", &format!("File is missing or unreadable: {e}")))?;
    crate::file_model::validate_private_source(&store.path, store.app_data_dir.as_deref(), &path)?;
    if !path.is_file() {
        return Err(invalid("sourcePath", "Choose a readable file"));
    }
    Ok(path)
}
impl Store {
    pub fn delete_asset(&self, actor: &str, input: DeleteAssetInput) -> Result<CompactMutation> {
        let request = input.request_id.clone();
        let payload = serde_json::to_value(&input)?;
        let io = self.asset_io()?;
        let outcome=self.write(|c|Ok(crate::receipts::with_receipt(c,actor,request.as_deref(),"delete_asset","asset",&payload,||{
            crate::service::member(c,actor)?;let asset=current_asset(c,&input.asset_id)?;
            let usage=asset_usage_tx(c,&asset.id)?;
            if usage.count()>0 && !input.force{return Err(Error::InUse{usage:Box::new(usage)});}
            crate::asset_io::safe_id(&asset.id)?;
            let storage:String=c.query_row("SELECT storage_type FROM assets WHERE id=?",[&asset.id],|r|r.get(0))?;
            if storage=="board_file" {
                let file=crate::file_model::load_file_with_refresh(c,&asset.id,None,true)?;
                let source=file.resolution.resolved_path.as_deref().map(Path::new).filter(|_|file.resolution.status=="available").ok_or_else(||invalid("assetId","File is missing or unreadable; locate it before deleting its board copy"))?;
                let date=time::OffsetDateTime::now_utc().date();
                let relative=format!("trash/{:04}{:02}{:02}/{}-{}",date.year(),u8::from(date.month()),date.day(),asset.id,readable_file_name(&asset.name));
                let trash=io.retain_path(&relative)?;
                if trash.exists(){return Err(Error::Conflict);}
                std::fs::create_dir_all(trash.parent().ok_or_else(||invalid("path","Missing trash parent"))?)?;
                let old_hash=crate::storage_io::hash_reader(std::fs::File::open(source)?)?.0;
                io.journal(&crate::asset_io::AssetIoJournal{asset_id:asset.id.clone(),database_generation:io.generation.clone(),action:crate::asset_io::AssetIoAction::Delete,retained_path:relative,old_revision:file.content_revision,old_hash,new_hash:None})?;
                std::fs::rename(source,trash)?;
            }
            let affected=usage.tasks.iter().map(|t|t.key.as_str()).chain(usage.covers.iter().map(String::as_str)).collect::<BTreeSet<_>>();
            for key in &affected {let task=crate::service::task(c,key)?;crate::service::touch(c,&task.id,actor)?;}
            c.execute("DELETE FROM task_assets WHERE asset_id=?",[&asset.id])?;
            c.execute("DELETE FROM scope_files WHERE asset_id=?",[&asset.id])?;
            c.execute("UPDATE ref_items SET asset_id=NULL,archived_at=coalesce(archived_at,?),archived_by=coalesce(archived_by,?),updated_by=?,updated_at=? WHERE asset_id=?",params![now(),actor,actor,now(),asset.id])?;
            c.execute("UPDATE task_presentation SET cover_asset_id=NULL WHERE cover_asset_id=?",[&asset.id])?;
            c.execute("DELETE FROM asset_components WHERE asset_id=? OR component_asset_id=?",params![asset.id,asset.id])?;
            c.execute("DELETE FROM file_previews WHERE asset_id=?",[&asset.id])?;
            c.execute("DELETE FROM asset_revisions WHERE asset_id=?",[&asset.id])?;
            c.execute("DELETE FROM assets WHERE id=?",[&asset.id])?;
            crate::service::event(c,Some(&asset.jam_id),actor,"asset.updated",None,json!({"assetId":asset.id,"fileAction":"deleted","forced":input.force,"affectedTaskKeys":affected,"usage":usage}))?;
            Ok(result("asset",&asset.id,None,now()))
        },replay)?.value));
        let recovered = io.recover();
        match outcome {
            Ok(result) => {
                recovered?;
                Ok(result)
            }
            Err(error) => {
                recovered?;
                Err(error)
            }
        }
    }
    pub fn replace_asset(&self, actor: &str, input: ReplaceAssetInput) -> Result<CompactMutation> {
        let request = input.request_id.clone();
        let payload = serde_json::to_value(&input)?;
        let io = self.asset_io()?;
        let mut stage_path = None;
        let outcome=self.write(|c|Ok(crate::receipts::with_receipt(c,actor,request.as_deref(),"replace_asset","asset",&payload,||{
            crate::service::member(c,actor)?;let asset=current_asset(c,&input.asset_id)?;
            let file=crate::file_model::load_file_with_refresh(c,&asset.id,None,true)?;
            let (stored,base,original,kind,mime,size,hash,revision)=if file.storage_type=="url" {
                if input.source_path.is_some(){return Err(invalid("sourcePath","URL replacements use url only"));}
                let url=input.url.clone().ok_or_else(||invalid("url","Supply the new HTTP(S) URL"))?;crate::file_model::valid_url(&url)?;
                let kind=classify_file(Path::new(url.split(['?','#']).next().unwrap_or(&url))).to_string();
                (url.clone(),"url".into(),url,kind,None,None,None,file.content_revision)
            }else{
                if input.url.is_some(){return Err(invalid("url","File replacements use sourcePath only"));}
                let source=source_path(self,input.source_path.as_deref().ok_or_else(||invalid("sourcePath","Choose the replacement file"))?)?;
                let original=source.file_name().and_then(|s|s.to_str()).ok_or_else(||invalid("sourcePath","File name must be UTF-8"))?.to_string();
                let kind=classify_file(&source).to_string();let mime=mime_for_path(&source);
                if file.storage_type=="board_file" {
                    crate::asset_io::safe_id(&asset.id)?;
                    let current=file.resolution.resolved_path.as_deref().map(Path::new).filter(|_|file.resolution.status=="available").ok_or_else(||invalid("assetId","Current board file is missing or unreadable"))?;
                    let size=source.metadata()?.len();let old_size=current.metadata()?.len();
                    let required=size.checked_mul(2).and_then(|n|n.checked_add(old_size)).ok_or_else(||invalid("diskSpace","Aggregate file size overflow"))?;
                    crate::storage_io::require_space(&io.root,required)?;
                    let ext=extension(Path::new(&file.original_name));
                    let relative=format!("revisions/{}/{}{}{}",asset.id,file.content_revision,if ext.is_empty(){""}else{"."},ext);
                    let retained=io.retain_path(&relative)?;std::fs::create_dir_all(retained.parent().ok_or_else(||invalid("path","Missing revision parent"))?)?;
                    let old_hash=if retained.exists(){
                        let old=crate::storage_io::hash_reader(std::fs::File::open(current)?)?;
                        if crate::storage_io::hash_reader(std::fs::File::open(&retained)?)?!=old{return Err(Error::Conflict);}old.0
                    }else{crate::storage_io::atomic_copy(current,&retained)?.0};
                    let stage=io.retain_path(&format!("asset-operations/stage-{}",crate::id()))?;std::fs::create_dir_all(stage.parent().ok_or_else(||invalid("path","Missing stage parent"))?)?;
                    let next=crate::storage_io::atomic_copy(&source,&stage)?;stage_path=Some(stage.clone());
                    if crate::storage_io::hash_reader(std::fs::File::open(current)?)?.0!=old_hash{return Err(Error::Conflict);}
                    io.journal(&crate::asset_io::AssetIoJournal{asset_id:asset.id.clone(),database_generation:io.generation.clone(),action:crate::asset_io::AssetIoAction::Replace,retained_path:relative.clone(),old_revision:file.content_revision,old_hash:old_hash.clone(),new_hash:Some(next.0.clone())})?;
                    let copied=crate::storage_io::atomic_copy(&stage,current)?;if copied!=next{return Err(Error::Conflict);}
                    c.execute("INSERT INTO asset_revisions(asset_id,revision,stored_path,byte_size,content_hash,mime_type,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",params![asset.id,file.content_revision,relative,i64::try_from(old_size).map_err(|_|invalid("byteSize","File is too large"))?,old_hash,file.mime_type.or_else(||mime_for_path(Path::new(&file.original_name))),actor,now()])?;
                    (file.stored_path,file.path_base,original,kind,mime,Some(i64::try_from(next.1).map_err(|_|invalid("byteSize","File is too large"))?),Some(next.0),file.content_revision+1)
                }else{
                    let mut stored=display_path(&source);let mut base="absolute".to_string();
                    if let Some((root,_))=repository_context(&io.anchor)? && let Ok(relative)=source.strip_prefix(root){stored=relative.to_string_lossy().replace('\\',"/");base="repo".into();}
                    (stored,base,original,kind,mime,Some(i64::try_from(source.metadata()?.len()).map_err(|_|invalid("byteSize","File is too large"))?),None,file.content_revision)
                }
            };
            c.execute("UPDATE assets SET location=?,stored_path=?,path_base=?,original_name=?,kind=?,mime_type=?,byte_size=?,content_hash=?,content_revision=? WHERE id=?",params![stored,stored,base,original,kind,mime,size,hash,revision,asset.id])?;
            crate::service::event(c,Some(&asset.jam_id),actor,"asset.updated",None,json!({"assetId":asset.id,"fileAction":"replaced","contentRevision":revision}))?;
            Ok(result("asset",&asset.id,None,now()))
        },replay)?.value));
        let recovered = io.recover();
        if let Some(stage) = stage_path
            && stage.is_file()
        {
            std::fs::remove_file(stage)?;
        }
        match outcome {
            Ok(result) => {
                recovered?;
                Ok(result)
            }
            Err(error) => {
                recovered?;
                Err(error)
            }
        }
    }
}
