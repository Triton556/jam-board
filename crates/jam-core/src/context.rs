//! Caller-captured optimistic context. This fences delayed board writes, not OS workers.
use crate::{Error, Result, TaskSummary, invalid};
use rusqlite::Connection;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskWriteContext {
    pub expected_claim_generation: String,
    pub expected_updated_at: String,
}

pub(crate) fn check_claim(task: &TaskSummary, expected: &str) -> Result<()> {
    if expected.is_empty() {
        return Err(invalid(
            "expectedClaimGeneration",
            "Read get_task and supply the claimGeneration you observed",
        ));
    }
    if expected != task.claim_generation {
        return Err(Error::StaleClaim);
    }
    Ok(())
}

pub(crate) fn check_write(
    c: &Connection,
    actor: &str,
    task: &TaskSummary,
    context: Option<&TaskWriteContext>,
) -> Result<()> {
    if let Some(context) = context {
        check_claim(task, &context.expected_claim_generation)?;
        if context.expected_updated_at != task.updated_at {
            return Err(Error::Conflict);
        }
    } else {
        require_human(c, actor)?;
    }
    Ok(())
}

pub(crate) fn require_human(c: &Connection, actor: &str) -> Result<()> {
    if crate::service::member(c, actor)?.kind != "human" {
        return Err(invalid(
            "expectedClaimGeneration",
            "Agents must supply caller-captured claim context; read get_task and reconcile before writing",
        ));
    }
    Ok(())
}

pub(crate) fn review_revision(c: &Connection, task: &TaskSummary) -> Result<Option<String>> {
    if task.status != "review" {
        return Ok(None);
    }
    use rusqlite::OptionalExtension;
    let report_id: Option<String> = c
        .query_row(
            "SELECT id FROM reports WHERE task_id=? AND round=?",
            rusqlite::params![task.id, task.review_round],
            |row| row.get(0),
        )
        .optional()?;
    let Some(report_id) = report_id else {
        return Ok(None);
    };
    let story = crate::planning::story(c, &task.story_id)?;
    let epic = crate::planning::task_epic(c, task)?;
    // File associations and content revisions are review evidence too. Replacing
    // a scoped file does not edit the task/story/epic timestamps.
    let files=c.prepare("SELECT json_object('scope',l.scope,'target',l.target,'id',a.id,'role',l.role,'position',l.position,'name',a.name,'kind',a.kind,'location',a.location,'path',a.stored_path,'revision',a.content_revision,'hash',a.content_hash,'archivedAt',a.archived_at) FROM (SELECT target_type AS scope,target_id AS target,asset_id,role,position FROM scope_files WHERE jam_id=?1 AND ((target_type='project' AND target_id=?1) OR (target_type='epic' AND target_id=?2) OR (target_type='story' AND target_id=?3)) UNION ALL SELECT 'task',task_id,asset_id,role,position FROM task_assets WHERE task_id=?4 UNION ALL SELECT 'cover',task_id,cover_asset_id,'cover',0 FROM task_presentation WHERE task_id=?4 AND cover_asset_id IS NOT NULL) l JOIN assets a ON a.id=l.asset_id ORDER BY l.scope,l.target,l.asset_id,l.role")?
        .query_map(rusqlite::params![task.jam_id,epic.audit.id,story.audit.id,task.id],|row|row.get::<_,String>(0))?
        .collect::<std::result::Result<Vec<_>,_>>()?;
    // JSON array gives unambiguous framing without hashing dependencies. Opaque to clients.
    Ok(Some(serde_json::to_string(&(
        "review-v2",
        &task.id,
        report_id,
        &task.updated_at,
        &story.audit.id,
        &story.audit.updated_at,
        &epic.audit.id,
        &epic.audit.updated_at,
        files,
    ))?))
}

// Strong versions remain monotonic if the wall clock moves backwards or a write
// happens at the same timestamp. Imported future versions are valid too.
pub(crate) fn next_version(previous: &str) -> Result<String> {
    let format = &time::format_description::well_known::Rfc3339;
    let previous = time::OffsetDateTime::parse(previous, format)
        .map_err(|_| invalid("updatedAt", "Invalid stored version"))?;
    let next = previous
        .checked_add(time::Duration::nanoseconds(1))
        .ok_or_else(|| invalid("updatedAt", "Stored version cannot advance"))?;
    time::OffsetDateTime::now_utc()
        .max(next)
        .format(format)
        .map_err(|_| invalid("updatedAt", "Stored version cannot be formatted"))
}
