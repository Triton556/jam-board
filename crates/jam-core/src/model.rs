use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

pub const STATUSES: [&str; 5] = ["backlog", "todo", "in_progress", "review", "done"];
pub const PRIORITIES: [&str; 4] = ["low", "medium", "high", "critical"];
pub const MEMBER_COLORS: [&str; 6] = [
    "#5B8DEF", "#E0679A", "#3FA37A", "#9B7BE0", "#F07E5F", "#D8A630",
];

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(flatten)]
    pub task: TaskSummary,
    pub assets: Vec<Asset>,
    pub comments: Vec<Comment>,
    pub activity: Vec<ActivityEvent>,
    pub history: Vec<ActivityEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub jam_id: String,
    pub kind: String,
    pub name: String,
    pub location: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: String,
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
    pub seq: i64,
    pub action: String,
    pub actor: MemberRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_key: Option<String>,
    #[specta(type = JsonPayload)]
    pub payload: serde_json::Value,
    pub created_at: String,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTask {
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    pub estimate: Option<i64>,
    pub due_at: Option<String>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewJamInput {
    pub name: String,
    pub theme: Option<String>,
    pub starts_at: String,
    pub ends_at: String,
    pub timezone: String,
    pub your_name: String,
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
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardJam {
    pub name: String,
    pub theme: Option<String>,
    pub ends_at: Option<String>,
    pub time_left: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BoardColumn {
    pub status: String,
    pub count: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BoardTask {
    pub key: String,
    pub title: String,
    pub priority: String,
    pub status: String,
    pub assignee: Option<MemberRef>,
}
pub type BoardTasks = std::collections::BTreeMap<String, Vec<TaskSummary>>;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTask {
    pub key: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub estimate: Option<Option<i64>>,
    #[serde(default, deserialize_with = "nullable")]
    pub due_at: Option<Option<String>>,
}
pub(crate) fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<String>)]
    pub assignee_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<i64>)]
    pub estimate: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<String>)]
    pub due_at: Option<Option<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskEditInput {
    pub key: String,
    pub expected_updated_at: String,
    #[serde(flatten)]
    pub patch: TaskPatch,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskQuery {
    pub status: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub tags: Option<Vec<String>>,
    pub text: Option<String>,
    pub include_archived: Option<bool>,
    pub sort: Option<TaskSort>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TaskSort {
    pub field: String,
    pub dir: String,
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
    pub status: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub tag: Option<String>,
    pub query: Option<String>,
    pub include_archived: Option<bool>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
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
}
