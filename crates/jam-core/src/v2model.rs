//! Planning and work contracts shared by the native and MCP adapters.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
        #[serde(rename_all="camelCase")]
        pub struct $name { $(pub $field: $ty),* }
    };
}
macro_rules! patch {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        pub struct $name { $(#[serde(default,skip_serializing_if="Option::is_none")] pub $field: Option<$ty>),* }
    };
}
record!(Audit {
    id:String, jam_id:String, position:f64, created_by:String, updated_by:String,
    created_at:String, updated_at:String, archived_at:Option<String>
});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Epic {
    #[serde(flatten)]
    pub audit: Audit,
    pub key: String,
    pub title: String,
    pub color: String,
    pub status: String,
    pub goal_md: String,
    pub done_when_md: String,
    pub not_included_md: String,
    pub decided_md: String,
    pub open_questions_md: String,
    pub participation: String,
    pub reviewer: String,
    pub worker_model: Option<String>,
    pub brain_member_id: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEpic {
    pub title: String,
    pub color: Option<String>,
    pub goal_md: Option<String>,
    pub done_when_md: Option<String>,
    pub not_included_md: Option<String>,
    pub decided_md: Option<String>,
    pub open_questions_md: Option<String>,
    pub participation: Option<String>,
    pub reviewer: Option<String>,
    pub worker_model: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpicPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_when_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_included_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_questions_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewer: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<String>)]
    pub worker_model: Option<Option<String>>,
}
record!(Acceptance {
    id: String,
    criterion: String,
    mandatory: bool,
    check: String
});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    #[serde(flatten)]
    pub audit: Audit,
    pub key: String,
    pub epic_id: String,
    pub title: String,
    pub status: String,
    pub outcome_md: String,
    pub basis_md: String,
    pub preserve_md: String,
    pub scale_md: String,
    pub rejection_risks_md: String,
    pub open_decisions_md: String,
    pub acceptance: Vec<Acceptance>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewStory {
    pub epic_key: String,
    pub title: String,
    pub outcome_md: Option<String>,
    pub basis_md: Option<String>,
    pub preserve_md: Option<String>,
    pub scale_md: Option<String>,
    pub rejection_risks_md: Option<String>,
    pub open_decisions_md: Option<String>,
    pub acceptance: Option<Vec<Acceptance>>,
}
patch!(StoryPatch {title:String,outcome_md:String,basis_md:String,preserve_md:String,scale_md:String,
    rejection_risks_md:String,open_decisions_md:String,acceptance:Vec<Acceptance>});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub title: String,
    #[serde(default)]
    pub now: String,
    #[serde(default)]
    pub cause: String,
    pub required: String,
    #[serde(default)]
    pub r#where: String,
    #[serde(default)]
    pub follow: String,
    #[serde(default)]
    pub keep: String,
}
record!(BriefTest {
    setup: String,
    expected: String
});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskBrief {
    pub goal_md: String,
    pub context_md: String,
    pub where_md: String,
    pub changes: Vec<Change>,
    pub tests: Vec<BriefTest>,
    pub boundaries_md: String,
    pub result_md: String,
    pub user_quotes_md: String,
}
patch!(BriefPatch {goal_md:String,context_md:String,where_md:String,changes:Vec<Change>,tests:Vec<BriefTest>,
    boundaries_md:String,result_md:String,user_quotes_md:String});
record!(ReadinessIssue {
    code: String,
    message: String
});
record!(Readiness {ready:bool,missing:Vec<ReadinessIssue>});
record!(ReportTest {
    name: String,
    command: String,
    expected: String,
    actual: String,
    result: String
});
record!(Report {id:String,task_id:String,round:i64,author_id:String,summary_md:String,
    changed_files:Vec<String>,tests:Vec<ReportTest>,deviations_md:String,not_verified_md:String,created_at:String});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitReport {
    pub key: String,
    pub expected_claim_generation: String,
    pub summary_md: String,
    pub changed_files: Vec<String>,
    pub tests: Vec<ReportTest>,
    pub deviations_md: Option<String>,
    pub not_verified_md: Option<String>,
}
record!(Review {id:String,task_id:String,round:i64,reviewer_id:String,verdict:String,
    comments_md:String,failed_tests:Vec<String>,created_at:String});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewTask {
    pub key: String,
    pub expected_report_id: String,
    pub expected_review_context_revision: String,
    pub verdict: String,
    pub comments_md: String,
    pub failed_tests: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
}
record!(QuestionOption {
    label: String,
    description: String
});
record!(Question {id:String,jam_id:String,epic_id:Option<String>,scope_type:String,scope_id:String,
    asked_by:String,round_label:Option<String>,title:String,body_md:String,options:Vec<QuestionOption>,
    recommended_index:Option<usize>,allow_free_text:bool,status:String,answer_index:Option<usize>,
    answer_text:Option<String>,answered_by:Option<String>,answered_at:Option<String>,created_at:String});
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskUser {
    pub scope: Scope,
    pub title: String,
    pub body_md: Option<String>,
    pub options: Option<Vec<QuestionOption>>,
    pub recommended_index: Option<usize>,
    pub allow_free_text: Option<bool>,
    pub round_label: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnswerQuestion {
    pub id: String,
    pub answer_index: Option<usize>,
    pub answer_text: Option<String>,
}
record!(AnswerWait {answered:Vec<Question>,pending:Vec<Question>});
record!(Project {jam:crate::Jam,template:String,milestone_at:Option<String>,template_label:String,tag_suggestions:Vec<String>,epics:i64,stories:i64,tasks:i64,open_questions:i64});
record!(StoryTree {story:Story,tasks:Vec<TaskReady>});
record!(TaskReady {
    task: crate::TaskSummary,
    readiness: Readiness
});
record!(EpicTree {epic:Epic,stories:Vec<StoryTree>,journal:Vec<crate::ActivityEvent>,open_questions:Vec<Question>});
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefFrame {
    pub id: String,
    pub jam_id: String,
    pub epic_id: Option<String>,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub color: String,
    pub archived_at: Option<String>,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub links: Vec<RefFrameTarget>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceTargetKind {
    #[default]
    Epic,
    Story,
    Task,
}
record!(RefFrameTarget {
    target_key: String,
    kind: ReferenceTargetKind,
    title: String
});
record!(RefFrameLink {frame_id:String,target_type:String,target_id:String,archived_at:Option<String>});
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceVerdict {
    Keep,
    Reject,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceVerdictInput {
    pub item_id: String,
    pub verdict: Option<ReferenceVerdict>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefFrameLinkInput {
    pub frame_id: String,
    pub target_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefItem {
    #[serde(flatten)]
    pub audit: Audit,
    pub kind: String,
    pub asset_id: Option<String>,
    pub url: Option<String>,
    pub title: String,
    pub caption_md: String,
    pub tags: Vec<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: f64,
    pub frame_id: Option<String>,
    pub link_preview: Option<String>,
    #[serde(default)]
    pub metadata: Option<String>,
    #[serde(default)]
    pub verdict: Option<ReferenceVerdict>,
    #[serde(default)]
    pub archived_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_title: Option<String>,
}
record!(RefEdge {id:String,jam_id:String,from_item:String,to_item:String,label:String,archived_at:Option<String>});
record!(RefLink {item_id:String,target_type:String,target_id:String,archived_at:Option<String>});
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddReference {
    pub kind: String,
    pub file_path: Option<String>,
    #[serde(default)]
    pub copy: Option<bool>,
    pub url: Option<String>,
    pub text: Option<String>,
    pub title: Option<String>,
    pub caption: Option<String>,
    pub tags: Option<Vec<String>>,
    pub frame_epic_key: Option<String>,
    pub frame_id: Option<String>,
    pub link_to: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}
patch!(ReferencePatch {caption:String,tags:Vec<String>,title:String});
/// Optional human-editor compare-and-set boundary. Kept separate from the MCP
/// ReferenceEditInput contract so existing agent clients remain unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceContentExpectation {
    pub title: String,
    pub caption: String,
}
record!(ReferenceCanvas {items:Vec<RefItem>,frames:Vec<RefFrame>,edges:Vec<RefEdge>,links:Vec<RefLink>});
record!(CanvasGeometry {id:String,x:f64,y:f64,w:f64,h:f64,z:f64,frame_id:Option<String>});
record!(CanvasArchive {
    kind: String,
    id: String,
    archived: bool
});
record!(LinkPreview {title:String,image:Option<String>});

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpicEditInput {
    pub key: String,
    #[serde(flatten)]
    pub patch: EpicPatch,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryEditInput {
    pub key: String,
    #[serde(flatten)]
    pub patch: StoryPatch,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BriefEditInput {
    pub key: String,
    #[serde(flatten)]
    pub patch: BriefPatch,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceEditInput {
    pub item_id: String,
    #[serde(flatten)]
    pub patch: ReferencePatch,
}
macro_rules! input {
    ($name:ident{$($field:ident:$ty:ty),*$(,)?})=>{
        #[derive(Debug,Clone,Default,Serialize,Deserialize,Type,JsonSchema)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        pub struct $name{$(pub $field:$ty),*}
    };
}
input!(PlanningStatusInput{key:String,status:String,override_reason:Option<String>});
input!(ReadyInput{key:String,expected_updated_at:String,override_reason:Option<String>});
input!(BrainInput {
    epic_key: String,
    member_handle: String
});
input!(EpicKeyInput { epic_key: String });
input!(QuestionListInput{status:Option<String>,scope:Option<Scope>});
input!(WaitInput{question_ids:Vec<String>,timeout_seconds:u64});
input!(StatusTextInput{text:String,scope:Option<Scope>});
input!(ChangesInput{cursor:i64,epic_key:Option<String>});
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangesWaitInput {
    pub cursor: i64,
    pub epic_key: Option<String>,
    #[serde(default)]
    pub include_project: bool,
    pub actions: Option<Vec<String>>,
    pub actor_kind: Option<String>,
    #[serde(default = "default_exclude_self")]
    pub exclude_self: bool,
    #[serde(default = "default_changes_timeout")]
    pub timeout_seconds: u64,
}
fn default_exclude_self() -> bool {
    true
}
fn default_changes_timeout() -> u64 {
    30
}
record!(ChangesWait {events:Vec<crate::ActivityEvent>,next_cursor:i64,timed_out:bool});
input!(ReferenceListInput{epic_key:Option<String>,story_key:Option<String>,task_key:Option<String>});
input!(ReferenceLinkInput {
    item_id: String,
    target_key: String
});
input!(GeometryInput {
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64
});
input!(EdgeInput {
    from_item: String,
    to_item: String,
    label: String
});
input!(ProjectEditInput { template:String, milestone_at:Option<String>, name:Option<String>, starts_at:Option<String>, ends_at:Option<String>, timezone:Option<String> });
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FramePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::model::nullable"
    )]
    #[specta(type=Option<String>)]
    pub epic_id: Option<Option<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameEditInput {
    pub id: String,
    #[serde(flatten)]
    pub patch: FramePatch,
}

pub fn tag_suggestions(template: &str) -> Vec<String> {
    match template {
        "game_jam" => &["gameplay", "art", "audio", "ui", "tech", "polish", "bug"][..],
        "gamedev" => &[
            "gameplay",
            "level-design",
            "art",
            "audio",
            "ui",
            "tech",
            "narrative",
            "qa",
            "bug",
        ][..],
        "webapp" => &[
            "frontend", "backend", "design", "api", "infra", "qa", "bug", "docs",
        ][..],
        _ => &[],
    }
    .iter()
    .map(|s| s.to_string())
    .collect()
}
