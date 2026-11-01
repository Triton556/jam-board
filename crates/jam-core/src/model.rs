use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

pub const STATUSES: [&str; 5] = ["backlog", "ready", "in_progress", "review", "done"];
pub const PRIORITIES: [&str; 4] = ["low", "medium", "high", "critical"];
pub const MEMBER_COLORS: [&str; 6] = [
    "#5B8DEF", "#E0679A", "#3FA37A", "#9B7BE0", "#F07E5F", "#D8A630",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Jam {
    pub id: String,
    pub name: String,
    pub theme: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub timezone: String,
    pub task_seq: i64,
    pub key_prefix: String,
    pub created_at: String,
    #[serde(default = "default_template")]
    pub template: String,
    #[serde(default)]
    pub milestone_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub handle: String,
    pub color: String,
    pub avatar: Option<String>,
    pub client: Option<String>,
    pub last_seen_at: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub status_text: String,
    #[serde(default)]
    pub status_scope: Option<crate::Scope>,
    #[serde(default)]
    pub status_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberRef {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub handle: String,
    pub color: String,
}
impl From<&Member> for MemberRef {
    fn from(m: &Member) -> Self {
        Self {
            id: m.id.clone(),
            kind: m.kind.clone(),
            name: m.name.clone(),
            handle: m.handle.clone(),
            color: m.color.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    #[serde(default)]
    pub external_ref: Option<String>,
    pub id: String,
    pub jam_id: String,
    pub key: String,
    pub title: String,
    pub description_md: String,
    pub status: String,
    pub priority: String,
    pub estimate: Option<i64>,
    pub due_at: Option<String>,
    pub position: f64,
    pub assignee_id: Option<String>,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub idempotency_key: Option<String>,
    pub tags: Vec<String>,
    pub comment_count: i64,
    #[serde(default)]
    pub story_id: String,
    #[serde(default)]
    pub story_key: String,
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub epic_id: String,
    #[serde(default)]
    pub epic_key: String,
    #[serde(default)]
    pub epic_color: String,
    #[serde(default)]
    pub changes_requested: bool,
    #[serde(default)]
    pub needs_info: bool,
    #[serde(default)]
    pub review_round: i64,
    /// Opaque, task-bound lifecycle validator. Read again after a successful mutation.
    #[serde(default)]
    pub claim_generation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    #[serde(default)]
    #[specta(optional)]
    pub files: Vec<crate::TaskFile>,
    #[serde(flatten)]
    pub task: TaskSummary,
    pub assets: Vec<Asset>,
    pub comments: Vec<Comment>,
    pub activity: Vec<ActivityEvent>,
    pub history: Vec<ActivityEvent>,
    pub brief: crate::TaskBrief,
    /// Binds the current report to the task, story and epic versions reviewed.
    #[serde(default)]
    pub review_context_revision: Option<String>,
    #[serde(default)]
    pub ancestor_questions: Vec<crate::Question>,
    pub story: crate::Story,
    pub epic: crate::Epic,
    pub reports: Vec<crate::Report>,
    pub reviews: Vec<crate::Review>,
    pub references: Vec<crate::RefItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub archived_by: Option<String>,
    pub id: String,
    pub jam_id: String,
    pub kind: String,
    pub name: String,
    pub location: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: String,
    #[serde(default = "default_asset_role")]
    pub role: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub author_id: String,
    pub body_md: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    /// Raw MCP client name/version; absent for human or historical events.
    #[serde(default)]
    pub client: Option<String>,
    pub seq: i64,
    pub action: String,
    pub actor: MemberRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_key: Option<String>,
    #[specta(type = JsonPayload)]
    pub payload: serde_json::Value,
    pub created_at: String,
    #[serde(default)]
    pub epic_id: Option<String>,
    #[serde(default)]
    pub sentence: String,
}

/// Named, recursive metadata for the JSON wire format. Keeping this named avoids
/// Specta's infinitely recursive inline expansion of serde_json::Value.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum JsonPayload {
    Null(()),
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonPayload>),
    Object(std::collections::BTreeMap<String, JsonPayload>),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTask {
    /// Source reference, 1–120 characters, unique per project and entity kind. Example: ls/S0.1; omitted creates have no external reference.
    #[schemars(length(min = 1, max = 120))]
    #[specta(optional)]
    pub external_ref: Option<String>,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Human-readable description, e.g. Preserve the existing image. Omitted task descriptions default to empty; updates preserve omissions.
    pub description: Option<String>,
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    pub status: Option<crate::TaskStatus>,
    /// Scheduling priority; default medium on create. Example: high. Omitted updates preserve it.
    pub priority: Option<crate::Priority>,
    /// 1–24 chars each; stored lowercase (size-M → size-m); order is kept as given. Omitted creates have no tags; omitted updates preserve tags.
    pub tags: Option<Vec<String>>,
    /// Story points (relative effort), not hours: 1, 2, 3, 5 or 8. Omitted creates are unestimated; null clears an estimate in updates.
    pub estimate: Option<crate::Estimate>,
    /// Optional UTC due date, e.g. 2026-11-01T12:00:00Z; omitted means no due date.
    pub due_at: Option<String>,
    /// Stable retry ID, 1–100 characters, e.g. ls-S0.1.1; required. Reuse only for the same task payload.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
    /// Parent story key in this project, e.g. JB-S3. Every task belongs to a story.
    pub story_key: Option<String>,
    #[serde(flatten)]
    /// Structured work brief; omitted fields default to empty. Planning never grants execution permission.
    pub brief: crate::TaskBrief,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewJamInput {
    pub name: String,
    pub theme: Option<String>,
    pub starts_at: String,
    pub ends_at: String,
    pub timezone: String,
    pub your_name: String,
    #[serde(default)]
    pub template: Option<crate::ProjectTemplate>,
    #[serde(default)]
    pub milestone_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub has_jam: bool,
    pub current_member: Option<Member>,
    pub jam: Option<Jam>,
    pub theme: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardSummary {
    pub jam: BoardJam,
    pub columns: Vec<BoardColumn>,
    pub in_progress: Vec<BoardTask>,
    pub my_tasks: Vec<BoardTask>,
    pub online_agents: Vec<MemberStats>,
    pub tag_suggestions: Vec<String>,
    pub open_question_count: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardJam {
    pub name: String,
    pub theme: Option<String>,
    pub ends_at: Option<String>,
    pub time_left: Option<i64>,
    pub template: String,
    pub milestone_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BoardColumn {
    pub status: String,
    pub count: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardTask {
    pub key: String,
    pub title: String,
    pub priority: String,
    pub status: String,
    pub assignee: Option<MemberRef>,
    pub changes_requested: bool,
    pub needs_info: bool,
    pub epic_key: String,
}

fn default_template() -> String {
    "game_jam".into()
}
fn default_asset_role() -> String {
    "asset".into()
}
pub type BoardTasks = std::collections::BTreeMap<String, Vec<TaskSummary>>;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTask {
    /// Source reference, 1–120 characters, e.g. ls/S0.1; omitted preserves it and null clears it.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub external_ref: Option<Option<String>>,
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    pub expected_claim_generation: String,
    /// Exact updatedAt captured before deciding this mutation, e.g. 2026-10-31T00:00:00Z. Never refresh it merely to replay a rejection.
    pub expected_updated_at: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    /// Human-readable description, e.g. Preserve the existing image. Omitted task descriptions default to empty; updates preserve omissions.
    pub description: Option<String>,
    /// Scheduling priority; default medium on create. Example: high. Omitted updates preserve it.
    pub priority: Option<crate::Priority>,
    /// 1–24 chars each; stored lowercase (size-M → size-m); order is kept as given. Omitted creates have no tags; omitted updates preserve tags.
    pub tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    /// Story points (relative effort), not hours: 1, 2, 3, 5 or 8. Omitted creates are unestimated; null clears an estimate in updates.
    pub estimate: Option<Option<crate::Estimate>>,
    #[serde(default, deserialize_with = "nullable")]
    /// Optional UTC due date, e.g. 2026-11-01T12:00:00Z; omitted preserves it and null clears it.
    pub due_at: Option<Option<String>>,
}
pub(crate) fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskPatch {
    /// Source reference, 1–120 characters, e.g. ls/S0.1; omitted preserves it and null clears it.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type=Option<String>)]
    pub external_ref: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Replacement structured work brief; omitted preserves it. Example: a complete goal/context/change/test record.
    pub brief: Option<crate::TaskBrief>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Human task description in Markdown; omitted preserves it. Example: Debounce lantern pickup.
    pub description_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    pub status: Option<crate::TaskStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Scheduling priority; default medium on create. Example: high. Omitted updates preserve it.
    pub priority: Option<crate::Priority>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<String>)]
    /// Existing project member ID, e.g. 01JMEMBER; omitted preserves it, null unassigns it. Does not launch a session.
    pub assignee_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// 1–24 chars each; stored lowercase (size-M → size-m); order is kept as given. Omitted creates have no tags; omitted updates preserve tags.
    pub tags: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<i64>)]
    /// Story points (relative effort), not hours: 1, 2, 3, 5 or 8. Omitted creates are unestimated; null clears an estimate in updates.
    pub estimate: Option<Option<crate::Estimate>>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<String>)]
    /// Optional UTC due date, e.g. 2026-11-01T12:00:00Z; omitted preserves it and null clears it.
    pub due_at: Option<Option<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskEditInput {
    pub key: String,
    pub expected_updated_at: String,
    #[serde(flatten)]
    pub patch: TaskPatch,
}
/// Human confirmation of a captured claim; neither actor nor destination is caller-controlled.
#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseClaim {
    pub key: String,
    pub expected_updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskQuery {
    pub epic: Option<String>,
    pub story: Option<String>,
    pub ready: Option<bool>,
    pub changes_requested: Option<bool>,
    pub needs_info: Option<bool>,
    pub status: Option<Vec<crate::TaskStatus>>,
    pub assignee: Option<String>,
    pub tags: Option<Vec<String>>,
    pub text: Option<String>,
    pub include_archived: Option<bool>,
    pub sort: Option<TaskSort>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, schemars::JsonSchema)]
pub struct TaskSort {
    pub field: crate::TaskSortField,
    pub dir: crate::SortDirection,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TaskListPage {
    pub tasks: Vec<TaskSummary>,
    pub total: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskFilter {
    /// Optional task-row projection; omitted returns every core field. Example: ["title","status","updatedAt"]. key is always present.
    pub fields: Option<Vec<crate::TaskField>>,
    /// Source reference, 1–120 characters, unique per project and entity kind. Example: ls/S0.1; omitted creates have no external reference.
    #[schemars(length(min = 1, max = 120))]
    pub external_ref: Option<String>,
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    pub status: Option<Vec<crate::TaskStatus>>,
    /// Optional assignee handle filter, e.g. claude; omitted includes all assignees.
    pub assignee: Option<String>,
    /// Optional task tag filter, e.g. design; omitted includes all tags.
    pub tag: Option<String>,
    /// Optional case-insensitive search substring, e.g. design; omission includes all matches.
    pub query: Option<String>,
    /// Include archived records; default false. Example: true.
    pub include_archived: Option<bool>,
    /// Maximum rows per page. Canvas allows 1–200; files allow 1–500. Omitted uses the operation default; example 50.
    pub limit: Option<usize>,
    /// Captured activity cursor or paging offset; starts at 0. Follow nextCursor; pages are not an atomic snapshot.
    pub cursor: Option<String>,
    /// Optional parent epic key filter, e.g. JB-E2; omission includes all epics.
    pub epic: Option<String>,
    /// Optional parent story key filter, e.g. JB-S3; omission includes all stories.
    pub story: Option<String>,
    /// Optional readiness filter, e.g. true; omitted includes both. Readiness is separate from execution authority.
    pub ready: Option<bool>,
    /// Optional requested-changes filter, e.g. true; omitted includes both values.
    pub changes_requested: Option<bool>,
    /// Optional unanswered-question filter, e.g. true; omitted includes both values.
    pub needs_info: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPage {
    pub tasks: Vec<TaskSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberStats {
    #[serde(flatten)]
    pub member: Member,
    pub counts: std::collections::BTreeMap<String, i64>,
    pub online: bool,
    pub working_on: Vec<String>,
    pub status_stale: bool,
}

impl Default for CreateTask {
    fn default() -> Self {
        Self {
            external_ref: None,
            title: Default::default(),
            description: None,
            status: None,
            priority: None,
            tags: None,
            estimate: None,
            due_at: None,
            request_id: crate::id(),
            story_key: None,
            brief: Default::default(),
        }
    }
}
