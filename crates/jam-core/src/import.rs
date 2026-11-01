//! Atomic planning imports. Imported fields never grant execution permission.
use crate::*;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportPlanInput {
    /// Stable request ID, 1–100 nonblank characters, e.g. ls-import-1; required. Reuse only for the same file and choices.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
    /// Preview without persisting any changes; defaults to false. Example: true before applying a file.
    #[serde(default)]
    pub dry_run: bool,
    /// Conflict externalRefs explicitly chosen to use the file; defaults to empty. Tasks in work are never overwritten.
    #[serde(default)]
    pub overwrite: Vec<String>,
    /// Ordered plan hierarchy; at most 1000 total epics, stories and tasks. Example: [{externalRef:"ls/E1",title:"Lanterns"}].
    pub epics: Vec<ImportEpic>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoImportInput {
    /// Batch ID returned by import_plan or list_import_batches; required. Example: 01JBATCH.
    pub batch_id: String,
    /// Stable undo request ID, 1–100 nonblank characters, e.g. undo-ls-1; required.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportBatchListInput {
    /// Maximum newest batches, 1–20; defaults to 5. Example: 5.
    #[schemars(range(min = 1, max = 20))]
    pub limit: Option<u32>,
}
/// Where a planning import was submitted.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportSource {
    /// Submitted by an MCP client; no work is started.
    #[default]
    Mcp,
    /// Submitted by the desktop import dialog.
    Ui,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportCounts {
    pub created: usize,
    pub updated: usize,
    pub moved: usize,
    pub unchanged: usize,
    pub conflicts: usize,
    pub skipped: usize,
    pub not_in_file: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    pub kind: RecordKind,
    pub external_ref: String,
    pub key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportUpdated {
    #[serde(flatten)]
    pub record: ImportRecord,
    pub fields: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportMoved {
    #[serde(flatten)]
    pub record: ImportRecord,
    pub from: String,
    pub to: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportConflictField {
    pub field: String,
    #[specta(type=crate::JsonPayload)]
    pub board: Value,
    #[specta(type=crate::JsonPayload)]
    pub file: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    #[serde(flatten)]
    pub record: ImportRecord,
    pub fields: Vec<ImportConflictField>,
    pub board_updated_by: String,
    pub board_updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportSkipped {
    #[serde(flatten)]
    pub record: ImportRecord,
    pub reason: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanReport {
    pub batch_id: Option<String>,
    pub dry_run: bool,
    pub no_changes: bool,
    pub counts: ImportCounts,
    pub created: Vec<ImportRecord>,
    pub updated: Vec<ImportUpdated>,
    pub moved: Vec<ImportMoved>,
    pub conflicts: Vec<ImportConflict>,
    pub skipped: Vec<ImportSkipped>,
    pub not_in_file: Vec<ImportRecord>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportKept {
    pub kind: RecordKind,
    pub key: String,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UndoImportReport {
    pub batch_id: String,
    pub undone: usize,
    pub kept: Vec<ImportKept>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportActor {
    pub name: String,
    pub kind: ActorKind,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchSummary {
    pub batch_id: String,
    pub created_at: String,
    pub actor: ImportActor,
    pub source: ImportSource,
    pub counts: ImportCounts,
    pub undone_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportEpic {
    /// Required source reference, 1 to 120 nonblank characters, unique per entity kind. Example: ls/S0.1.
    #[schemars(length(min = 1, max = 120))]
    pub external_ref: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Palette slot m1–m6; only tells epics apart and carries no meaning. Omitted creates rotate slots; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub color: Option<crate::EpicColor>,
    /// Task or epic goal in Markdown; defaults to empty on create. Example: Keep snow edges visible. Omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub goal_md: Option<String>,
    /// Observable completion conditions in Markdown, e.g. The player reaches the cabin. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub done_when_md: Option<String>,
    /// Excluded scope in Markdown, e.g. No new combat system. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub not_included_md: Option<String>,
    /// Agreed decisions and reasons in Markdown, e.g. Preserve the existing palette. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub decided_md: Option<String>,
    /// Unresolved planning questions in Markdown, e.g. Which controller layout? Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub open_questions_md: Option<String>,
    /// Human iteration review schedule; default first_sketch on create. Example: each_iteration. Omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub participation: Option<crate::Participation>,
    /// Human review schedule; default none on create. Example: final. Omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub reviewer: Option<crate::Reviewer>,
    /// Model id preferred for workers, e.g. gpt-6.1-sol; informational. Omitted creates use no preference; null clears an update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub worker_model: Option<String>,
    /// Ordered nested records; omitted means no children in this file, and never deletes board records.
    #[serde(default)]
    pub stories: Vec<ImportStory>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportStory {
    /// Required source reference, 1 to 120 nonblank characters, unique per entity kind. Example: ls/S0.1.
    #[schemars(length(min = 1, max = 120))]
    pub external_ref: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Human-readable story outcome in Markdown, e.g. Players can cross the bridge. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub outcome_md: Option<String>,
    /// Story sources and rationale in Markdown, e.g. The current Godot prototype. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub basis_md: Option<String>,
    /// Behavior to preserve in Markdown, e.g. Keep the jump arc. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub preserve_md: Option<String>,
    /// Expected scale in Markdown, e.g. Extend one scene. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub scale_md: Option<String>,
    /// Concrete rejection risks in Markdown, e.g. Cues rely only on color. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub rejection_risks_md: Option<String>,
    /// Unresolved story decisions in Markdown, e.g. Ask before replacing the title image. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub open_decisions_md: Option<String>,
    /// Story acceptance criteria with stable IDs and observable checks. Defaults to empty on create; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub acceptance: Option<Vec<Acceptance>>,
    /// Ordered nested records; omitted means no children in this file, and never deletes board records.
    #[serde(default)]
    pub tasks: Vec<ImportTask>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportTask {
    /// Required source reference, 1 to 120 nonblank characters, unique per entity kind. Example: ls/S0.1.
    #[schemars(length(min = 1, max = 120))]
    pub external_ref: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Human-readable description, e.g. Preserve the existing image. Omitted task descriptions default to empty; updates preserve omissions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub description: Option<String>,
    /// Scheduling priority; default medium on create. Example: high. Omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub priority: Option<crate::Priority>,
    /// 1–24 chars each; stored lowercase (size-M → size-m); order is kept as given. Omitted creates have no tags; omitted updates preserve tags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub tags: Option<Vec<String>>,
    /// Story points (relative effort), not hours: 1, 2, 3, 5 or 8. Omitted creates are unestimated; null clears an estimate in updates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub estimate: Option<crate::Estimate>,
    /// Optional UTC due date, e.g. 2026-11-01T12:00:00Z; omitted means no due date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub due_at: Option<String>,
    /// Task or epic goal in Markdown; defaults to empty on create. Example: Keep snow edges visible. Omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub goal_md: Option<String>,
    /// Task context in Markdown, e.g. Existing lantern shader. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub context_md: Option<String>,
    /// Files and locations in Markdown, e.g. game/player.gd. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub where_md: Option<String>,
    /// Concrete requested changes recording current and required behavior. Defaults to empty; omitted updates preserve them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub changes: Option<Vec<Change>>,
    /// Named brief checks or reported evidence. Example: one pickup per keypress. Briefs default to empty; reports require explicit results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub tests: Option<Vec<BriefTest>>,
    /// Task boundaries in Markdown, e.g. No scene rewrite. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub boundaries_md: Option<String>,
    /// Required deliverable in Markdown, e.g. Patch and check results. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub result_md: Option<String>,
    /// Relevant exact human quotations in Markdown; preserve their language. Defaults to empty; omitted updates preserve it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub user_quotes_md: Option<String>,
}

#[derive(Clone)]
struct Entry {
    kind: RecordKind,
    fields: Value,
    parent_ref: Option<String>,
    position: f64,
    path: String,
}
fn table(kind: RecordKind) -> &'static str {
    match kind {
        RecordKind::Epic => "epics",
        RecordKind::Story => "stories",
        RecordKind::Task => "tasks",
    }
}
fn parent_column(kind: RecordKind) -> Option<&'static str> {
    match kind {
        RecordKind::Epic => None,
        RecordKind::Story => Some("epicId"),
        RecordKind::Task => Some("storyId"),
    }
}
fn parent_kind(kind: RecordKind) -> RecordKind {
    if kind == RecordKind::Task {
        RecordKind::Story
    } else {
        RecordKind::Epic
    }
}
fn lookup(
    c: &Connection,
    project: &str,
    kind: RecordKind,
    reference: &str,
) -> Result<Option<Value>> {
    let sql = format!(
        "SELECT * FROM {} WHERE jam_id=? AND external_ref=?",
        table(kind)
    );
    Ok(c.query_row(
        &sql,
        params![project, reference],
        crate::planning::row_value,
    )
    .optional()?)
}
fn load(c: &Connection, kind: RecordKind, id: &str) -> Result<Value> {
    let mut value = c.query_row(
        &format!("SELECT * FROM {} WHERE id=?", table(kind)),
        [id],
        crate::planning::row_value,
    )?;
    if kind == RecordKind::Task {
        value["tags"] =
            serde_json::to_value(crate::service::task(c, value["key"].as_str().unwrap())?.tags)?;
    }
    Ok(value)
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn flatten(input: &ImportPlanInput) -> Result<Vec<Entry>> {
    let mut entries = vec![];
    for (ei, epic) in input.epics.iter().enumerate() {
        entries.push(Entry {
            kind: RecordKind::Epic,
            fields: serde_json::to_value(epic)?,
            parent_ref: None,
            position: (ei + 1) as f64 * 1024.,
            path: format!("epics[{ei}]"),
        });
        for (si, story) in epic.stories.iter().enumerate() {
            entries.push(Entry {
                kind: RecordKind::Story,
                fields: serde_json::to_value(story)?,
                parent_ref: Some(epic.external_ref.clone()),
                position: (si + 1) as f64 * 1024.,
                path: format!("epics[{ei}].stories[{si}]"),
            });
            for (ti, task) in story.tasks.iter().enumerate() {
                entries.push(Entry {
                    kind: RecordKind::Task,
                    fields: serde_json::to_value(task)?,
                    parent_ref: Some(story.external_ref.clone()),
                    position: (ti + 1) as f64 * 1024.,
                    path: format!("epics[{ei}].stories[{si}].tasks[{ti}]"),
                });
            }
        }
    }
    if entries.len() > 1000 {
        return Err(invalid(
            "epics",
            "Use at most 1000 total epics, stories and tasks",
        ));
    }
    let mut seen = std::collections::BTreeMap::new();
    for entry in &mut entries {
        let fields = entry.fields.as_object_mut().unwrap();
        fields.remove("stories");
        fields.remove("tasks");
        let reference = fields["externalRef"].as_str().unwrap().to_owned();
        crate::external_refs::validate_external_ref(Some(&reference))?;
        if let Some(first) =
            seen.insert((entry.kind.as_str(), reference.clone()), entry.path.clone())
        {
            return Err(invalid(
                "externalRef",
                &format!("Duplicate {reference}: {first} and {}", entry.path),
            ));
        }
        crate::m5::validate_name("title", fields["title"].as_str().unwrap(), 140)?;
        if entry.kind == RecordKind::Task {
            if let Some(tags) = fields.get("tags") {
                fields.insert(
                    "tags".into(),
                    serde_json::to_value(crate::service::normalize_tags(
                        &serde_json::from_value::<Vec<String>>(tags.clone())?,
                    )?)?,
                );
            }
            if let Some(due) = fields.get("dueAt") {
                fields.insert(
                    "dueAt".into(),
                    serde_json::to_value(crate::service::utc_date(due.as_str())?)?,
                );
            }
            if let Some(description) = fields.remove("description") {
                fields.insert("descriptionMd".into(), description);
            }
        }
    }
    Ok(entries)
}
fn patch(c: &Connection, kind: RecordKind, id: &str, fields: &Value) -> Result<()> {
    let mut fields = fields.clone();
    if let Some(tags) = fields.as_object_mut().unwrap().remove("tags") {
        crate::service::set_tags(c, id, &serde_json::from_value::<Vec<String>>(tags)?)?;
    }
    crate::planning::patch_record(c, table(kind), id, &fields)?;
    match kind {
        RecordKind::Epic => crate::planning::validate_epic(&crate::planning::epic(c, id)?)?,
        RecordKind::Story => crate::planning::validate_story(&crate::planning::story(c, id)?)?,
        RecordKind::Task => {
            let board = load(c, kind, id)?;
            crate::workflow::validate_brief(&crate::workflow::brief(c, text(&board, "key"))?)?;
        }
    }
    Ok(())
}
fn insert_record(
    c: &Connection,
    actor: &str,
    project: &str,
    entry: &Entry,
    parent: Option<&str>,
) -> Result<Value> {
    let id = id();
    let stamp = now();
    let (key, number) = if entry.kind == RecordKind::Task {
        let j = crate::service::jam(c)?;
        c.execute("UPDATE jams SET task_seq=task_seq+1 WHERE id=?", [project])?;
        (
            format!("{}-{}", j.key_prefix, j.task_seq + 1),
            j.task_seq + 1,
        )
    } else {
        crate::planning::next(c, entry.kind.as_str())?
    };
    let mut fields = entry.fields.clone();
    let values = fields.as_object_mut().unwrap();
    values.extend(json!({"id":id,"jamId":project,"key":key,"status":if entry.kind==RecordKind::Task {"backlog"} else {"draft"},"position":entry.position,"createdBy":actor,"updatedBy":actor,"createdAt":stamp,"updatedAt":stamp}).as_object().unwrap().clone());
    if entry.kind == RecordKind::Epic && !values.contains_key("color") {
        values.insert("color".into(), json!(format!("m{}", (number - 1) % 6 + 1)));
    }
    if let Some(column) = parent_column(entry.kind) {
        values.insert(column.into(), json!(parent.unwrap()));
    }
    let tags = values.remove("tags");
    crate::planning::insert(c, table(entry.kind), &fields)?;
    if let Some(tags) = tags {
        crate::service::set_tags(c, &id, &serde_json::from_value::<Vec<String>>(tags)?)?;
    }
    // Validate the same domain fields as the single-record planning tools.
    patch(c, entry.kind, &id, &json!({}))?;
    load(c, entry.kind, &id)
}
fn short(value: &Value) -> Value {
    let raw = value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string());
    if raw.chars().count() > 500 {
        json!(format!("{}…", raw.chars().take(500).collect::<String>()))
    } else {
        value.clone()
    }
}
fn sync(
    c: &Connection,
    project: &str,
    entry: &Entry,
    id: &str,
    hash: &str,
    stamp: &str,
    batch: Option<&str>,
) -> Result<()> {
    c.execute("INSERT INTO external_sync(jam_id,entity_type,entity_id,external_ref,imported_hash,imported_updated_at,batch_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET external_ref=excluded.external_ref,imported_hash=excluded.imported_hash,imported_updated_at=excluded.imported_updated_at,batch_id=excluded.batch_id",params![project,entry.kind.as_str(),id,text(&entry.fields,"externalRef"),hash,stamp,batch])?;
    Ok(())
}
struct BatchItem {
    kind: RecordKind,
    id: String,
    action: &'static str,
    before: Option<Value>,
    after: String,
}

fn apply(
    tx: &Transaction<'_>,
    actor: &str,
    input: &ImportPlanInput,
    source: ImportSource,
    entries: &[Entry],
) -> Result<(ImportPlanReport, bool)> {
    crate::service::member(tx, actor)?;
    let project = crate::service::jam(tx)?.id;
    if input.dry_run {
        tx.execute_batch("SAVEPOINT import_preview")?;
    }
    let mut report = ImportPlanReport {
        dry_run: input.dry_run,
        ..Default::default()
    };
    let mut items = vec![];
    let mut links = vec![];
    let mut syncs = vec![];
    let mut included = std::collections::BTreeSet::new();
    for entry in entries {
        let reference = text(&entry.fields, "externalRef");
        included.insert((entry.kind.as_str(), reference));
        let parent = entry
            .parent_ref
            .as_deref()
            .map(|reference| {
                lookup(tx, &project, parent_kind(entry.kind), reference)?
                    .ok_or_else(|| invalid("parent", "Imported parent is absent"))
            })
            .transpose()?;
        if parent.as_ref().is_some_and(|v| !v["archivedAt"].is_null()) {
            return Err(Error::Archived("Imported parent".into()));
        }
        let mut imported = entry.fields.clone();
        imported["position"] = json!(entry.position);
        if let Some(column) = parent_column(entry.kind) {
            imported[column] = parent.as_ref().unwrap()["id"].clone();
        }
        let mut hash_fields = entry.fields.clone();
        hash_fields["parentRef"] = json!(entry.parent_ref);
        hash_fields["position"] = json!(entry.position);
        let hash = crate::receipts::canonical_hash(&hash_fields)?;
        let existing = lookup(tx, &project, entry.kind, reference)?;
        let Some(existing) = existing else {
            let record = insert_record(
                tx,
                actor,
                &project,
                entry,
                parent.as_ref().map(|v| text(v, "id")),
            )?;
            report.created.push(ImportRecord {
                kind: entry.kind,
                external_ref: reference.into(),
                key: text(&record, "key").into(),
            });
            items.push(BatchItem {
                kind: entry.kind,
                id: text(&record, "id").into(),
                action: "created",
                before: None,
                after: text(&record, "updatedAt").into(),
            });
            syncs.push((
                entry.clone(),
                text(&record, "id").to_owned(),
                hash,
                text(&record, "updatedAt").to_owned(),
            ));
            continue;
        };
        let board = load(tx, entry.kind, text(&existing, "id"))?;
        if !board["archivedAt"].is_null() {
            return Err(Error::Archived(text(&board, "key").into()));
        }
        let record = ImportRecord {
            kind: entry.kind,
            external_ref: reference.into(),
            key: text(&board, "key").into(),
        };
        if entry.kind == RecordKind::Task
            && ["in_progress", "review", "done"].contains(&text(&board, "status"))
        {
            report.skipped.push(ImportSkipped {
                record,
                reason: "task_in_work".into(),
            });
            continue;
        }
        let previous_sync=tx.query_row("SELECT imported_hash,imported_updated_at,batch_id FROM external_sync WHERE jam_id=? AND entity_type=? AND entity_id=?",params![project,entry.kind.as_str(),text(&board,"id")],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?))).optional()?;
        let differences = imported
            .as_object()
            .unwrap()
            .iter()
            .filter(|(field, value)| board.get(*field) != Some(*value))
            .map(|(field, _)| field.clone())
            .collect::<Vec<_>>();
        let moved =
            parent_column(entry.kind).is_some_and(|column| board[column] != imported[column]);
        // First-time equal-field matches only link. Their existing board position
        // is not a content conflict; a different imported parent is a real move.
        let content_differs = differences
            .iter()
            .any(|field| field != "position" && Some(field.as_str()) != parent_column(entry.kind));
        let changed_on_board = previous_sync
            .as_ref()
            .is_some_and(|(_, stamp, _)| stamp != text(&board, "updatedAt"));
        let file_same = previous_sync
            .as_ref()
            .is_some_and(|(known, _, _)| known == &hash);
        if changed_on_board && file_same {
            report.skipped.push(ImportSkipped {
                record,
                reason: "board_newer".into(),
            });
            continue;
        }
        let conflict = previous_sync.is_none() && content_differs || changed_on_board && !file_same;
        if conflict && !input.overwrite.iter().any(|r| r == reference) {
            report.conflicts.push(ImportConflict {
                record,
                fields: differences
                    .iter()
                    .map(|field| ImportConflictField {
                        field: field.clone(),
                        board: short(&board[field]),
                        file: short(&imported[field]),
                    })
                    .collect(),
                board_updated_by: text(&board, "updatedBy").into(),
                board_updated_at: text(&board, "updatedAt").into(),
            });
            continue;
        }
        if previous_sync.is_none() && !content_differs && !moved {
            report.counts.unchanged += 1;
            links.push((
                entry.clone(),
                text(&board, "id").to_owned(),
                hash,
                text(&board, "updatedAt").to_owned(),
            ));
            continue;
        }
        if file_same && !moved {
            report.counts.unchanged += 1;
            continue;
        }
        if moved {
            if entry.kind == RecordKind::Story {
                crate::moves::movable_story(tx, &crate::planning::story(tx, text(&board, "id"))?)?;
            }
            let column = parent_column(entry.kind).unwrap();
            let from = load(tx, parent_kind(entry.kind), text(&board, column))?;
            report.moved.push(ImportMoved {
                record,
                from: text(&from, "key").into(),
                to: text(parent.as_ref().unwrap(), "key").into(),
            });
        } else {
            report.updated.push(ImportUpdated {
                record,
                fields: differences.clone(),
            });
        }
        let mut before = json!({});
        for field in imported.as_object().unwrap().keys() {
            before[field] = board[field].clone();
        }
        before["_sync"] = json!(previous_sync);
        let stamp = crate::context::next_version(text(&board, "updatedAt"))?;
        imported["updatedBy"] = json!(actor);
        imported["updatedAt"] = json!(stamp);
        patch(tx, entry.kind, text(&board, "id"), &imported)?;
        items.push(BatchItem {
            kind: entry.kind,
            id: text(&board, "id").into(),
            action: if moved { "moved" } else { "updated" },
            before: Some(before),
            after: stamp.clone(),
        });
        syncs.push((entry.clone(), text(&board, "id").to_owned(), hash, stamp));
    }
    for kind in [RecordKind::Epic, RecordKind::Story, RecordKind::Task] {
        let mut stmt=tx.prepare(&format!("SELECT external_ref,key FROM {} WHERE jam_id=? AND external_ref IS NOT NULL AND archived_at IS NULL ORDER BY position,key",table(kind)))?;
        for row in stmt.query_map([&project], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            let (external_ref, key) = row?;
            if !included.contains(&(kind.as_str(), external_ref.as_str())) {
                report.not_in_file.push(ImportRecord {
                    kind,
                    external_ref,
                    key,
                });
            }
        }
    }
    report.counts.created = report.created.len();
    report.counts.updated = report.updated.len();
    report.counts.moved = report.moved.len();
    report.counts.conflicts = report.conflicts.len();
    report.counts.skipped = report.skipped.len();
    report.counts.not_in_file = report.not_in_file.len();
    let written = !items.is_empty() || !links.is_empty();
    report.no_changes = !written;
    if input.dry_run {
        tx.execute_batch("ROLLBACK TO import_preview; RELEASE import_preview")?;
        return Ok((report, false));
    }
    if !items.is_empty() {
        let batch = id();
        tx.execute("INSERT INTO import_batches(id,jam_id,actor_id,request_id,source,summary_json,created_at) VALUES(?,?,?,?,?,?,?)",params![batch,project,actor,input.request_id,if matches!(source,ImportSource::Ui) {"ui"} else {"mcp"},serde_json::to_string(&report.counts)?,now()])?;
        for (seq, item) in items.iter().enumerate() {
            tx.execute("INSERT INTO import_batch_items(batch_id,seq,entity_type,entity_id,action,before_json,after_updated_at) VALUES(?,?,?,?,?,?,?)",params![batch,seq as i64,item.kind.as_str(),item.id,item.action,item.before.as_ref().map(Value::to_string),item.after])?;
        }
        report.batch_id = Some(batch);
        crate::service::event(
            tx,
            Some(&project),
            actor,
            "import_applied",
            None,
            json!({"batchId":report.batch_id,"counts":report.counts}),
        )?;
    }
    for (entry, id, hash, stamp) in syncs.into_iter().chain(links) {
        sync(
            tx,
            &project,
            &entry,
            &id,
            &hash,
            &stamp,
            report.batch_id.as_deref(),
        )?;
    }
    Ok((report, written))
}

impl Store {
    pub fn import_plan(
        &self,
        actor: &str,
        input: ImportPlanInput,
        source: ImportSource,
    ) -> Result<ImportPlanReport> {
        if !(1..=100).contains(&input.request_id.chars().count())
            || input.request_id.trim().is_empty()
        {
            return Err(invalid("requestId", "Use 1–100 nonblank characters"));
        }
        for reference in &input.overwrite {
            crate::external_refs::validate_external_ref(Some(reference))?;
        }
        let entries = flatten(&input)?;
        self.write_publishing_if(
            |tx| {
                Ok(crate::receipts::with_receipt_if(
                    tx,
                    actor,
                    if input.dry_run {
                        None
                    } else {
                        Some(&input.request_id)
                    },
                    "import_plan",
                    None,
                    &input,
                    || apply(tx, actor, &input, source, &entries),
                    |receipt| Ok(serde_json::from_value(receipt.clone())?),
                )?
                .value)
            },
            |report: &ImportPlanReport| {
                report.batch_id.is_some() && !report.dry_run && !report.replayed
            },
        )
    }
    pub fn list_import_batches(
        &self,
        input: ImportBatchListInput,
    ) -> Result<Vec<ImportBatchSummary>> {
        let limit = input.limit.unwrap_or(5);
        if !(1..=20).contains(&limit) {
            return Err(invalid("limit", "Use 1–20 batches"));
        }
        self.read(|c| {
            let project=crate::service::jam(c)?.id;
            let mut stmt=c.prepare("SELECT b.id,b.created_at,m.name,m.kind,b.source,b.summary_json,b.undone_at FROM import_batches b JOIN members m ON m.id=b.actor_id WHERE b.jam_id=? ORDER BY b.created_at DESC,b.id DESC LIMIT ?")?;
            let rows=stmt.query_map(params![project,limit],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
            rows.into_iter().map(|(batch_id,created_at,name,kind,source,counts,undone_at)|Ok(ImportBatchSummary { batch_id,created_at,actor:ImportActor {name,kind:kind.parse()?},source:serde_json::from_value(json!(source))?,counts:serde_json::from_str(&counts)?,undone_at })).collect()
        })
    }
    pub fn undo_import(&self, actor: &str, input: UndoImportInput) -> Result<UndoImportReport> {
        self.write(|tx| {
            crate::service::member(tx,actor)?;
            let project=crate::service::jam(tx)?.id;
            let undone=tx.query_row("SELECT undone_at FROM import_batches WHERE id=? AND jam_id=?",params![input.batch_id,project],|r|r.get::<_,Option<String>>(0)).optional()?.ok_or_else(||Error::NotFound("Import batch".into()))?;
            if undone.is_some() { return Err(Error::AlreadyUndone(input.batch_id.clone())); }
            Ok(crate::receipts::with_receipt_if(tx,actor,Some(&input.request_id),"undo_import",None,&input,|| {
                let mut report=UndoImportReport {batch_id:input.batch_id.clone(),undone:0,kept:vec![]};
                let rows=tx.prepare("SELECT entity_type,entity_id,action,before_json,after_updated_at FROM import_batch_items WHERE batch_id=? ORDER BY seq DESC")?.query_map([&input.batch_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,String>(4)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
                for (kind,id,action,before,after) in rows {
                    let kind:RecordKind=kind.parse()?;
                    let board=load(tx,kind,&id)?;
                    if text(&board,"updatedAt")!=after { report.kept.push(ImportKept {kind,key:text(&board,"key").into(),reason:"changed_after_import".into()});continue; }
                    let stamp=crate::context::next_version(&after)?;
                    if action=="created" {
                        let mut fields=json!({"archivedAt":stamp,"updatedAt":stamp,"updatedBy":actor});
                        if kind!=RecordKind::Task {fields["status"]=json!("archived");}
                        crate::planning::patch_record(tx,table(kind),&id,&fields)?;
                        tx.execute("DELETE FROM external_sync WHERE jam_id=? AND entity_type=? AND entity_id=?",params![project,kind.as_str(),id])?;
                    } else {
                        let mut fields:Value=serde_json::from_str(before.as_deref().ok_or_else(||invalid("batch","Missing previous fields"))?)?;
                        let previous=fields.as_object_mut().unwrap().remove("_sync").unwrap_or(Value::Null);
                        fields["updatedAt"]=json!(stamp);fields["updatedBy"]=json!(actor);
                        patch(tx,kind,&id,&fields)?;
                        if let Some(previous)=previous.as_array() {
                            tx.execute("UPDATE external_sync SET imported_hash=?,imported_updated_at=?,batch_id=? WHERE jam_id=? AND entity_type=? AND entity_id=?",params![previous[0].as_str(),previous[1].as_str(),previous[2].as_str(),project,kind.as_str(),id])?;
                        } else {tx.execute("DELETE FROM external_sync WHERE jam_id=? AND entity_type=? AND entity_id=?",params![project,kind.as_str(),id])?;}
                    }
                    report.undone+=1;
                }
                tx.execute("UPDATE import_batches SET undone_at=?,undone_by=? WHERE id=? AND jam_id=?",params![now(),actor,input.batch_id,project])?;
                Ok((report,true))
            },|receipt|Ok(serde_json::from_value(receipt.clone())?))?.value)
        })
    }
}
