use crate::*;
use rusqlite::Connection;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
use std::collections::BTreeMap;

/// Amount of child planning content returned by get_epic; default stories.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EpicDepth {
    /// Epic fields and counts only.
    Summary,
    /// Default; add compact story rows and task counts.
    #[default]
    Stories,
    /// Add compact task rows under each story.
    Tasks,
}
/// Optional extra content in a compact epic read; omitted means none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EpicInclude {
    /// Per-task readiness issue codes.
    Readiness,
    /// Recent epic journal rows, bounded by journalLimit.
    Journal,
    /// Open questions in this epic.
    Questions,
    /// Files linked directly to this epic scope.
    Files,
}
/// Optional expanded task content; short story/epic summaries are always present.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskInclude {
    /// Expand the short parent story to its full intent and acceptance.
    Story,
    /// Expand the short parent epic to its full intent fields.
    Epic,
    /// Linked canvas references.
    References,
    /// Submitted reports and their evidence.
    Reports,
    /// Independent review records.
    Reviews,
    /// Human and agent comments.
    Comments,
    /// Recent task activity, bounded by activityLimit.
    Activity,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetEpicInput {
    /// Epic key in this project, e.g. JB-E2; required.
    pub key: String,
    /// Child detail level; default stories. Example: summary for counts only.
    #[serde(default)]
    pub depth: EpicDepth,
    /// Optional extra sections; default none. Example: ["files","questions"].
    pub include: Option<Vec<EpicInclude>>,
    /// Journal row cap, 1–50; default 10. Applies only when include contains journal.
    #[schemars(range(min = 1, max = 50))]
    pub journal_limit: Option<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetTaskInput {
    /// Task key in this project, e.g. JB-12; required.
    pub key: String,
    /// Optional expanded sections; default none. Example: ["reports","reviews"].
    pub include: Option<Vec<TaskInclude>>,
    /// Activity row cap, 1–50; default 10. Applies only when include contains activity.
    #[schemars(range(min = 1, max = 50))]
    pub activity_limit: Option<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompactMutation {
    pub kind: String,
    pub id: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim_generation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replayed: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompactEpic {
    #[serde(flatten)]
    pub epic: Epic,
    pub story_counts: BTreeMap<String, i64>,
    pub task_counts: BTreeMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stories: Option<Vec<CompactStory>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readiness: Option<BTreeMap<String, Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journal: Option<Vec<ActivityEvent>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub questions: Option<Vec<Question>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<ScopeFile>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompactStory {
    pub key: String,
    pub title: String,
    pub status: String,
    pub external_ref: Option<String>,
    pub task_counts: BTreeMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks: Option<Vec<CompactEpicTask>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompactEpicTask {
    pub key: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub external_ref: Option<String>,
    pub ready_issue_count: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompactTask {
    #[serde(flatten)]
    pub task: TaskSummary,
    pub brief: TaskBrief,
    pub files: Vec<TaskFile>,
    pub review_context_revision: Option<String>,
    pub story: Value,
    pub epic: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<RefItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reports: Option<Vec<Report>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviews: Option<Vec<Review>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<Comment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<Vec<ActivityEvent>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedTask {
    pub key: String,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedTaskPage {
    pub tasks: Vec<ProjectedTask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

fn counts(
    c: &Connection,
    table: &str,
    filter: &str,
    id: &str,
    statuses: &[&str],
) -> Result<BTreeMap<String, i64>> {
    let mut result = statuses
        .iter()
        .map(|s| ((*s).into(), 0))
        .collect::<BTreeMap<_, _>>();
    let rows=c.prepare(&format!("SELECT status,count(*) FROM {table} WHERE {filter} AND archived_at IS NULL GROUP BY status"))?.query_map([id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    result.extend(rows);
    Ok(result)
}
fn limit(value: Option<usize>, field: &str) -> Result<usize> {
    let value = value.unwrap_or(10);
    if !(1..=50).contains(&value) {
        return Err(invalid(field, "Use 1–50"));
    }
    Ok(value)
}
impl Store {
    pub fn get_epic_compact(&self, input: GetEpicInput) -> Result<Value> {
        let journal_limit = limit(input.journal_limit, "journalLimit")?;
        let include = input.include.unwrap_or_default();
        self.read(|c| {
            let epic=crate::planning::epic(c,&input.key)?;
            let mut result=serde_json::to_value(&epic)?;
            result["storyCounts"]=serde_json::to_value(counts(c,"stories","epic_id=?",&epic.audit.id,&["draft","active","done","archived"])?)?;
            result["taskCounts"]=serde_json::to_value(counts(c,"tasks","story_id IN (SELECT id FROM stories WHERE epic_id=?)",&epic.audit.id,&STATUSES)?)?;
            if input.depth!=EpicDepth::Summary || include.contains(&EpicInclude::Readiness) {
                let stories:Vec<Story>=crate::planning::records(c,"stories","epic_id=? AND archived_at IS NULL ORDER BY position,id",&[&epic.audit.id])?;
                let mut rows=vec![];
                let mut readiness=BTreeMap::<String,Vec<String>>::new();
                for story in stories {
                    let mut row=json!({"key":story.key,"title":story.title,"status":story.status,"externalRef":story.external_ref,"taskCounts":counts(c,"tasks","story_id=?",&story.audit.id,&STATUSES)?});
                    if input.depth==EpicDepth::Tasks || include.contains(&EpicInclude::Readiness) {
                        let keys=c.prepare("SELECT key FROM tasks WHERE story_id=? AND archived_at IS NULL ORDER BY position,key")?.query_map([&story.audit.id],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
                        let mut tasks=vec![];
                        for key in keys {
                            let task=crate::service::task(c,&key)?;
                            let ready=crate::workflow::readiness_for(c,&task)?;
                            if include.contains(&EpicInclude::Readiness) { readiness.insert(key.clone(),ready.missing.iter().map(|i|i.code.clone()).collect()); }
                            tasks.push(json!({"key":key,"title":task.title,"status":task.status,"priority":task.priority,"externalRef":task.external_ref,"readyIssueCount":ready.missing.len()}));
                        }
                        if input.depth==EpicDepth::Tasks { row["tasks"]=json!(tasks); }
                    }
                    rows.push(row);
                }
                if input.depth!=EpicDepth::Summary { result["stories"]=json!(rows); }
                if include.contains(&EpicInclude::Readiness) { result["readiness"]=json!(readiness); }
            }
            if include.contains(&EpicInclude::Journal) {
                let mut events=crate::db::activity(c,0,None,None)?.into_iter().filter(|a|a.epic_id.as_deref()==Some(&epic.audit.id)).collect::<Vec<_>>();
                if events.len()>journal_limit { events.drain(..events.len()-journal_limit); }
                result["journal"]=serde_json::to_value(events)?;
            }
            if include.contains(&EpicInclude::Questions) {
                let questions:Vec<Question>=crate::planning::records(c,"questions","epic_id=? AND status='open' ORDER BY created_at,id",&[&epic.audit.id])?;
                result["questions"]=serde_json::to_value(questions)?;
            }
            if include.contains(&EpicInclude::Files) {
                let files:Vec<ScopeFile>=crate::planning::records(c,"scope_files","target_type='epic' AND target_id=? ORDER BY position,id",&[&epic.audit.id])?;
                result["files"]=serde_json::to_value(files)?;
            }
            Ok(result)
        })
    }

    pub fn get_task_compact(&self, input: GetTaskInput) -> Result<Value> {
        let activity_limit = limit(input.activity_limit, "activityLimit")?;
        let include = input.include.unwrap_or_default();
        self.read(|c| {
            let task = crate::service::detail(c, &input.key)?;
            let mut result = serde_json::to_value(&task.task)?;
            result["brief"] = serde_json::to_value(&task.brief)?;
            result["files"] = serde_json::to_value(&task.files)?;
            result["reviewContextRevision"] = json!(task.review_context_revision);
            result["story"] = if include.contains(&TaskInclude::Story) {
                serde_json::to_value(&task.story)?
            } else {
                json!({"key":task.story.key,"title":task.story.title,"status":task.story.status})
            };
            result["epic"] = if include.contains(&TaskInclude::Epic) {
                serde_json::to_value(&task.epic)?
            } else {
                json!({"key":task.epic.key,"title":task.epic.title})
            };
            for (flag, name, value) in [
                (
                    TaskInclude::References,
                    "references",
                    serde_json::to_value(task.references)?,
                ),
                (
                    TaskInclude::Reports,
                    "reports",
                    serde_json::to_value(task.reports)?,
                ),
                (
                    TaskInclude::Reviews,
                    "reviews",
                    serde_json::to_value(task.reviews)?,
                ),
                (
                    TaskInclude::Comments,
                    "comments",
                    serde_json::to_value(task.comments)?,
                ),
            ] {
                if include.contains(&flag) {
                    result[name] = value;
                }
            }
            if include.contains(&TaskInclude::Activity) {
                result["activity"] = serde_json::to_value(crate::db::activity(
                    c,
                    0,
                    Some(&task.task.id),
                    Some(activity_limit as i64),
                )?)?;
            }
            Ok(result)
        })
    }
}
