use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveStoryInput {
    /// Stable story key, e.g. JB-S3; required and retained after the move.
    pub key: String,
    /// Destination epic key in this project, e.g. JB-E2; required.
    pub to_epic_key: String,
    /// Optional destination sibling to place before, e.g. JB-S7; cannot combine with afterKey.
    pub before_key: Option<String>,
    /// Optional destination sibling to place after, e.g. JB-S7; omitted appends unless beforeKey is supplied.
    pub after_key: Option<String>,
    /// Exact updatedAt inspected before deciding the move; optional. Never refresh merely to replay a rejection.
    #[specta(optional)]
    pub expected_updated_at: Option<String>,
    /// Stable request ID, 1–100 chars, e.g. move-ls-S3; required. Reuse only for the same move intent.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveTaskToStoryInput {
    /// Stable task key, e.g. JB-12; required and retained after the move.
    pub key: String,
    /// Destination story key in this project, e.g. JB-S7; required.
    pub to_story_key: String,
    /// Exact updatedAt inspected before deciding the move; required. Never refresh merely to replay a rejection.
    pub expected_updated_at: String,
    /// Exact claimGeneration inspected before deciding the move; required. Example: generation:task:3.
    pub expected_claim_generation: String,
    /// Stable request ID, 1–100 chars, e.g. move-ls-task-12; required. Reuse only for the same payload.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
}
fn receipt_id(receipt: &Value) -> Result<&str> {
    receipt["id"]
        .as_str()
        .ok_or_else(|| invalid("receipt", "Missing ID"))
}

pub(crate) fn movable_story(c: &Connection, story: &Story) -> Result<()> {
    let blocked=c.prepare("SELECT key FROM tasks WHERE story_id=? AND status IN ('in_progress','review') ORDER BY key")?.query_map([&story.audit.id],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    if !["draft", "active"].contains(&story.status.as_str()) || !blocked.is_empty() {
        return Err(Error::WrongStatus(format!(
            "Story {} can move only while draft or active, with no task in progress or review; blocking keys: {}",
            story.key,
            if blocked.is_empty() {
                story.key.clone()
            } else {
                blocked.join(", ")
            }
        )));
    }
    crate::planning::editable_audit(&story.audit)
}
fn story_position(
    c: &Connection,
    parent: &str,
    before: Option<&str>,
    after: Option<&str>,
) -> Result<f64> {
    if before.is_some() && after.is_some() {
        return Err(invalid("position", "Choose beforeKey or afterKey"));
    }
    let Some(key) = before.or(after) else {
        return Ok(c.query_row("SELECT coalesce(max(position),0)+1024 FROM stories WHERE epic_id=? AND archived_at IS NULL",[parent],|r|r.get(0))?);
    };
    let position = c
        .query_row(
            "SELECT position FROM stories WHERE epic_id=? AND key=? AND archived_at IS NULL",
            params![parent, key],
            |r| r.get::<_, f64>(0),
        )
        .optional()?
        .ok_or_else(|| invalid("position", "Choose a sibling in the destination epic"))?;
    let neighbor = if before.is_some() {
        c.query_row("SELECT max(position) FROM stories WHERE epic_id=? AND position<? AND archived_at IS NULL",params![parent,position],|r|r.get::<_,Option<f64>>(0))?.unwrap_or(position-2048.)
    } else {
        c.query_row("SELECT min(position) FROM stories WHERE epic_id=? AND position>? AND archived_at IS NULL",params![parent,position],|r|r.get::<_,Option<f64>>(0))?.unwrap_or(position+2048.)
    };
    let next = position / 2. + neighbor / 2.;
    if !next.is_finite() || next == position || next == neighbor {
        return Err(invalid(
            "position",
            "No representable gap; reorder destination stories first",
        ));
    }
    Ok(next)
}

impl Store {
    pub fn move_story(&self, actor: &str, input: MoveStoryInput) -> Result<Story> {
        let payload = serde_json::to_value(&input)?;
        let request = input.request_id.clone();
        self.write(|c|Ok(crate::receipts::with_receipt(c,actor,Some(&request),"move_story","story",&payload,||{
            crate::service::member(c,actor)?;
            let story=crate::planning::story(c,&input.key)?;
            if story.audit.jam_id!=crate::service::jam(c)?.id {return Err(Error::Forbidden("Story belongs to another project".into()));}
            if input.expected_updated_at.as_ref().is_some_and(|expected| expected != &story.audit.updated_at) {return Err(Error::Conflict);}
            movable_story(c,&story)?;
            let from=crate::planning::epic(c,&story.epic_id)?;
            let to=crate::planning::epic(c,&input.to_epic_key)?;
            crate::planning::editable_audit(&to.audit)?;
            if from.audit.jam_id!=to.audit.jam_id {return Err(invalid("toEpicKey","Choose an epic in this project"));}
            if story.epic_id==to.audit.id {return Err(invalid("toEpicKey","Choose another epic"));}
            let position=story_position(c,&to.audit.id,input.before_key.as_deref(),input.after_key.as_deref())?;
            c.execute("UPDATE stories SET epic_id=?,position=?,updated_by=?,updated_at=? WHERE id=?",params![to.audit.id,position,actor,crate::context::next_version(&story.audit.updated_at)?,story.audit.id])?;
            let details=json!({"key":story.key,"fromKey":from.key,"toKey":to.key});
            for epic in [&from.audit.id,&to.audit.id] {crate::planning::v2_event(c,actor,Some(epic),"story_moved",None,details.clone())?;}
            crate::planning::story(c,&story.key)
        },|receipt|crate::planning::story(c,receipt_id(receipt)?))?.value))
    }

    pub fn move_task_to_story(
        &self,
        actor: &str,
        input: MoveTaskToStoryInput,
    ) -> Result<TaskDetail> {
        let payload = serde_json::to_value(&input)?;
        let request = input.request_id.clone();
        self.write(|c|Ok(crate::receipts::with_receipt(c,actor,Some(&request),"move_task_to_story","task",&payload,||{
            let task=crate::service::editable(c,&input.key,actor)?;
            if task.jam_id!=crate::service::jam(c)?.id {return Err(Error::Forbidden("Task belongs to another project".into()));}
            crate::context::check_write(c,actor,&task,Some(&TaskWriteContext{expected_updated_at:input.expected_updated_at,expected_claim_generation:input.expected_claim_generation}))?;
            if !["backlog","ready"].contains(&task.status.as_str()) {return Err(Error::WrongStatus(format!("Task {} can move only in backlog or ready",task.key)));}
            let from=crate::planning::story(c,&task.story_id)?;
            let to=crate::planning::story(c,&input.to_story_key)?;
            crate::planning::editable_audit(&to.audit)?;
            let epic=crate::planning::epic(c,&to.epic_id)?;
            crate::planning::editable_audit(&epic.audit)?;
            if task.jam_id!=to.audit.jam_id {return Err(invalid("toStoryKey","Choose a story in this project"));}
            if task.story_id==to.audit.id {return Err(invalid("toStoryKey","Choose another story"));}
            let position:f64=c.query_row("SELECT coalesce(max(position),0)+1024 FROM tasks WHERE story_id=? AND archived_at IS NULL",[&to.audit.id],|r|r.get(0))?;
            c.execute("UPDATE tasks SET story_id=?,position=? WHERE id=?",params![to.audit.id,position,task.id])?;
            crate::service::touch(c,&task.id,actor)?;
            crate::planning::v2_event(c,actor,Some(&to.epic_id),"task_moved_to_story",Some(&task.id),json!({"key":task.key,"fromKey":from.key,"toKey":to.key}))?;
            crate::service::detail(c,&task.key)
        },|receipt|crate::service::detail(c,receipt["key"].as_str().ok_or_else(||invalid("receipt","Missing key"))?))?.value))
    }
}
