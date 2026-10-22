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
    // JSON array gives unambiguous framing without hashing dependencies. Opaque to clients.
    Ok(Some(serde_json::to_string(&(
        "review-v1",
        &task.id,
        report_id,
        &task.updated_at,
        &story.audit.id,
        &story.audit.updated_at,
        &epic.audit.id,
        &epic.audit.updated_at,
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
