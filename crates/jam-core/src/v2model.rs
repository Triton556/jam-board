//! Planning and work contracts shared by the native and MCP adapters.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    pub id: String,
    pub jam_id: String,
    pub position: f64,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Epic {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    #[serde(default)]
    pub external_ref: Option<String>,
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
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEpic {
    /// Source reference, 1–120 characters, unique per project and entity kind. Example: ls/S0.1; omitted creates have no external reference.
    #[schemars(length(min = 1, max = 120))]
    #[specta(optional)]
    pub external_ref: Option<String>,
    /// Stable request ID, 1–100 characters, e.g. ls-E0; required for retry-safe creation.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Palette slot m1–m6; only tells epics apart and carries no meaning. Omitted creates rotate slots; omitted updates preserve it.
    pub color: Option<crate::EpicColor>,
    /// Task or epic goal in Markdown; defaults to empty on create. Example: Keep snow edges visible. Omitted updates preserve it.
    pub goal_md: Option<String>,
    /// Observable completion conditions in Markdown, e.g. The player reaches the cabin. Defaults to empty; omitted updates preserve it.
    pub done_when_md: Option<String>,
    /// Excluded scope in Markdown, e.g. No new combat system. Defaults to empty; omitted updates preserve it.
    pub not_included_md: Option<String>,
    /// Agreed decisions and reasons in Markdown, e.g. Preserve the existing palette. Defaults to empty; omitted updates preserve it.
    pub decided_md: Option<String>,
    /// Unresolved planning questions in Markdown, e.g. Which controller layout? Defaults to empty; omitted updates preserve it.
    pub open_questions_md: Option<String>,
    /// Human iteration review schedule; default first_sketch on create. Example: each_iteration. Omitted updates preserve it.
    pub participation: Option<crate::Participation>,
    /// Human review schedule; default none on create. Example: final. Omitted updates preserve it.
    pub reviewer: Option<crate::Reviewer>,
    /// Model id preferred for workers, e.g. gpt-6.1-sol; informational. Omitted creates use no preference; null clears an update.
    pub worker_model: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpicPatch {
    /// Source reference, 1–120 characters, e.g. ls/S0.1; omitted preserves it and null clears it.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type=Option<String>)]
    pub external_ref: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Palette slot m1–m6; only tells epics apart and carries no meaning. Omitted creates rotate slots; omitted updates preserve it.
    pub color: Option<crate::EpicColor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Task or epic goal in Markdown; defaults to empty on create. Example: Keep snow edges visible. Omitted updates preserve it.
    pub goal_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Observable completion conditions in Markdown, e.g. The player reaches the cabin. Defaults to empty; omitted updates preserve it.
    pub done_when_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Excluded scope in Markdown, e.g. No new combat system. Defaults to empty; omitted updates preserve it.
    pub not_included_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Agreed decisions and reasons in Markdown, e.g. Preserve the existing palette. Defaults to empty; omitted updates preserve it.
    pub decided_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Unresolved planning questions in Markdown, e.g. Which controller layout? Defaults to empty; omitted updates preserve it.
    pub open_questions_md: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Human iteration review schedule; default first_sketch on create. Example: each_iteration. Omitted updates preserve it.
    pub participation: Option<crate::Participation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Human review schedule; default none on create. Example: final. Omitted updates preserve it.
    pub reviewer: Option<crate::Reviewer>,
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<String>)]
    /// Model id preferred for workers, e.g. gpt-6.1-sol; informational. Omitted creates use no preference; null clears an update.
    pub worker_model: Option<Option<String>>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Acceptance {
    /// Stable criterion ID within this story, e.g. movement; required.
    pub id: String,
    /// Observable acceptance condition, e.g. One interaction collects the lantern; required.
    pub criterion: String,
    /// Whether this criterion must pass; explicit boolean, e.g. true.
    pub mandatory: bool,
    /// Reproducible acceptance check, e.g. Press Interact once at the cabin; required.
    pub check: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    #[serde(default)]
    pub external_ref: Option<String>,
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
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewStory {
    /// Source reference, 1–120 characters, unique per project and entity kind. Example: ls/S0.1; omitted creates have no external reference.
    #[schemars(length(min = 1, max = 120))]
    #[specta(optional)]
    pub external_ref: Option<String>,
    /// Stable request ID, 1–100 characters, e.g. ls-E0; required for retry-safe creation.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Human-readable story outcome in Markdown, e.g. Players can cross the bridge. Defaults to empty; omitted updates preserve it.
    pub outcome_md: Option<String>,
    /// Story sources and rationale in Markdown, e.g. The current Godot prototype. Defaults to empty; omitted updates preserve it.
    pub basis_md: Option<String>,
    /// Behavior to preserve in Markdown, e.g. Keep the jump arc. Defaults to empty; omitted updates preserve it.
    pub preserve_md: Option<String>,
    /// Expected scale in Markdown, e.g. Extend one scene. Defaults to empty; omitted updates preserve it.
    pub scale_md: Option<String>,
    /// Concrete rejection risks in Markdown, e.g. Cues rely only on color. Defaults to empty; omitted updates preserve it.
    pub rejection_risks_md: Option<String>,
    /// Unresolved story decisions in Markdown, e.g. Ask before replacing the title image. Defaults to empty; omitted updates preserve it.
    pub open_decisions_md: Option<String>,
    /// Story acceptance criteria with stable IDs and observable checks. Defaults to empty on create; omitted updates preserve it.
    pub acceptance: Option<Vec<Acceptance>>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryPatch {
    /// Source reference, 1–120 characters, e.g. ls/S0.1; omitted preserves it and null clears it.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type=Option<String>)]
    pub external_ref: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Human-readable story outcome in Markdown, e.g. Players can cross the bridge. Defaults to empty; omitted updates preserve it.
    pub outcome_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Story sources and rationale in Markdown, e.g. The current Godot prototype. Defaults to empty; omitted updates preserve it.
    pub basis_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Behavior to preserve in Markdown, e.g. Keep the jump arc. Defaults to empty; omitted updates preserve it.
    pub preserve_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Expected scale in Markdown, e.g. Extend one scene. Defaults to empty; omitted updates preserve it.
    pub scale_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Concrete rejection risks in Markdown, e.g. Cues rely only on color. Defaults to empty; omitted updates preserve it.
    pub rejection_risks_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Unresolved story decisions in Markdown, e.g. Ask before replacing the title image. Defaults to empty; omitted updates preserve it.
    pub open_decisions_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Story acceptance criteria with stable IDs and observable checks. Defaults to empty on create; omitted updates preserve it.
    pub acceptance: Option<Vec<Acceptance>>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    #[serde(default)]
    /// Current behavior in a requested change, e.g. Pickup fires twice. Defaults to empty.
    pub now: String,
    #[serde(default)]
    /// Known cause, e.g. Input is polled each frame. Defaults to empty; do not invent an unverified cause.
    pub cause: String,
    /// Required behavior in a requested change, e.g. One pickup per press; required for each change.
    pub required: String,
    #[serde(default)]
    /// Location for this change, e.g. game/lantern.gd. Defaults to empty.
    pub r#where: String,
    #[serde(default)]
    /// Existing pattern to follow, e.g. the checkpoint input handler. Defaults to empty.
    pub follow: String,
    #[serde(default)]
    /// Behavior to preserve, e.g. the first burst. Defaults to empty.
    pub keep: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BriefTest {
    /// Reproducible test setup, e.g. Start at the cabin and hold Interact; required for a brief test.
    pub setup: String,
    /// Observable expected result, e.g. Exactly one pickup; required in a test.
    pub expected: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskBrief {
    /// Task or epic goal in Markdown; defaults to empty on create. Example: Keep snow edges visible. Omitted updates preserve it.
    pub goal_md: String,
    /// Task context in Markdown, e.g. Existing lantern shader. Defaults to empty; omitted updates preserve it.
    pub context_md: String,
    /// Files and locations in Markdown, e.g. game/player.gd. Defaults to empty; omitted updates preserve it.
    pub where_md: String,
    /// Concrete requested changes recording current and required behavior. Defaults to empty; omitted updates preserve them.
    pub changes: Vec<Change>,
    /// Named brief checks or reported evidence. Example: one pickup per keypress. Briefs default to empty; reports require explicit results.
    pub tests: Vec<BriefTest>,
    /// Task boundaries in Markdown, e.g. No scene rewrite. Defaults to empty; omitted updates preserve it.
    pub boundaries_md: String,
    /// Required deliverable in Markdown, e.g. Patch and check results. Defaults to empty; omitted updates preserve it.
    pub result_md: String,
    /// Relevant exact human quotations in Markdown; preserve their language. Defaults to empty; omitted updates preserve it.
    pub user_quotes_md: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BriefPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Task or epic goal in Markdown; defaults to empty on create. Example: Keep snow edges visible. Omitted updates preserve it.
    pub goal_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Task context in Markdown, e.g. Existing lantern shader. Defaults to empty; omitted updates preserve it.
    pub context_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Files and locations in Markdown, e.g. game/player.gd. Defaults to empty; omitted updates preserve it.
    pub where_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Concrete requested changes recording current and required behavior. Defaults to empty; omitted updates preserve them.
    pub changes: Option<Vec<Change>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Named brief checks or reported evidence. Example: one pickup per keypress. Briefs default to empty; reports require explicit results.
    pub tests: Option<Vec<BriefTest>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Task boundaries in Markdown, e.g. No scene rewrite. Defaults to empty; omitted updates preserve it.
    pub boundaries_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Required deliverable in Markdown, e.g. Patch and check results. Defaults to empty; omitted updates preserve it.
    pub result_md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Relevant exact human quotations in Markdown; preserve their language. Defaults to empty; omitted updates preserve it.
    pub user_quotes_md: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessIssue {
    pub code: String,
    pub message: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub ready: bool,
    pub missing: Vec<ReadinessIssue>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReportTest {
    /// Display name, e.g. Bridge design; optional when inferred from a file. Renaming assets does not rename disk files.
    pub name: String,
    /// Executed check command, e.g. cargo test; required in report evidence. Mark unrun checks honestly.
    pub command: String,
    /// Observable expected result, e.g. Exactly one pickup; required in a test.
    pub expected: String,
    /// Observed outcome, e.g. One pickup event recorded; required in report evidence.
    pub actual: String,
    /// Reported test result: PASS, FAIL or NOT_RUN. Required; use NOT_RUN for an unrun check.
    pub result: crate::ReportResult,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub task_id: String,
    pub round: i64,
    pub author_id: String,
    pub summary_md: String,
    pub changed_files: Vec<String>,
    pub tests: Vec<ReportTest>,
    pub deviations_md: String,
    pub not_verified_md: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitReport {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    pub expected_claim_generation: String,
    /// Report summary in Markdown, e.g. Pickup is debounced; required.
    pub summary_md: String,
    /// Changed paths, e.g. game/lantern.gd; explicit list, which may be empty.
    pub changed_files: Vec<String>,
    /// Named brief checks or reported evidence. Example: one pickup per keypress. Briefs default to empty; reports require explicit results.
    pub tests: Vec<ReportTest>,
    /// Deviations from the brief in Markdown; omitted means none. Example: Fixture uses a synthetic picker.
    pub deviations_md: Option<String>,
    /// Unverified checks and surfaces in Markdown; omitted means no additional note. Example: Native picker not run.
    pub not_verified_md: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    pub task_id: String,
    pub round: i64,
    pub reviewer_id: String,
    pub verdict: String,
    pub comments_md: String,
    pub failed_tests: Vec<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewTask {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    /// ID of the exact report inspected for review; required. Example: 01JREPORT. Re-read evidence after a conflict.
    pub expected_report_id: String,
    /// Opaque reviewContextRevision of the task/report/story/epic context inspected; required. Never blindly refresh a rejected review.
    pub expected_review_context_revision: String,
    /// Enumerated independent review decision. Example: changes_requested. Null clears a reference verdict when supported.
    pub verdict: crate::ReviewVerdict,
    /// Reason for a review decision in Markdown; required. Example: Repeated input still fails.
    pub comments_md: String,
    /// Failed test names from the matching report; omitted means none. Example: ["repeated input"].
    pub failed_tests: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    #[serde(rename = "type")]
    /// Operation-specific enumerated kind, e.g. note for a text reference or story for a question scope; required unless stated otherwise.
    pub kind: crate::ScopeKind,
    /// Stable object ID or accepted scope key, e.g. JB-S3; required for ID-specific operations.
    pub id: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    /// Human-readable option or connection label, e.g. Keep existing; required for options, optional for connections.
    pub label: String,
    /// Human-readable description, e.g. Preserve the existing image. Omitted task descriptions default to empty; updates preserve omissions.
    pub description: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub updated_at: String,
    pub id: String,
    pub jam_id: String,
    pub epic_id: Option<String>,
    pub scope_type: String,
    pub scope_id: String,
    pub asked_by: String,
    pub round_label: Option<String>,
    pub title: String,
    pub body_md: String,
    pub options: Vec<QuestionOption>,
    pub recommended_index: Option<usize>,
    pub allow_free_text: bool,
    pub status: String,
    pub answer_index: Option<usize>,
    pub answer_text: Option<String>,
    pub answered_by: Option<String>,
    pub answered_at: Option<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskUser {
    /// Optional stable retry ID, 1–100 characters, e.g. interview-scope-1; recommended to avoid duplicate questions.
    #[schemars(length(min = 1, max = 100))]
    #[specta(optional)]
    pub request_id: Option<String>,
    /// Exact project/epic/story/task scope; required where requested. Example: {"type":"story","id":"JB-S3"}. Questions never grant execution.
    pub scope: Scope,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Question details in Markdown; omitted means empty. Example: Keep the existing title image?
    pub body_md: Option<String>,
    /// Suggested choices, at most 6 for a question. Omitted means free text only. Example: [{"label":"Keep","description":"Preserve the image"}].
    pub options: Option<Vec<QuestionOption>>,
    /// Zero-based option index; omitted means no recommendation. Example: 0. A recommendation is not approval.
    pub recommended_index: Option<usize>,
    /// Whether a human may answer in free text; default true. Example: true.
    pub allow_free_text: Option<bool>,
    /// Optional interview round label, e.g. Scope; omitted means none.
    pub round_label: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnswerQuestion {
    /// Stable object ID or accepted scope key, e.g. JB-S3; required for ID-specific operations.
    pub id: String,
    /// Zero-based selected answer index; omitted means no choice. Example: 0. Supply this or answerText.
    pub answer_index: Option<usize>,
    /// Human-authored answer; optional if a choice is selected. Example: Keep the original image.
    pub answer_text: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnswerWait {
    pub answered: Vec<Question>,
    pub pending: Vec<Question>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub jam: crate::Jam,
    pub template: String,
    pub milestone_at: Option<String>,
    pub template_label: String,
    pub tag_suggestions: Vec<String>,
    pub epics: i64,
    pub stories: i64,
    pub tasks: i64,
    pub open_questions: i64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StoryTree {
    pub story: Story,
    pub tasks: Vec<TaskReady>,
    #[serde(default)]
    pub scope_files: Vec<crate::ScopeFile>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskReady {
    pub task: crate::TaskSummary,
    pub readiness: Readiness,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EpicTree {
    pub epic: Epic,
    pub stories: Vec<StoryTree>,
    pub journal: Vec<crate::ActivityEvent>,
    pub open_questions: Vec<Question>,
    #[serde(default)]
    pub scope_files: Vec<crate::ScopeFile>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefFrame {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub updated_at: String,
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
    #[serde(default)]
    pub review: Option<FrameReview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrameReview {
    pub total: u32,
    pub keep: u32,
    pub reject: u32,
    pub unrated: u32,
    pub comments: u32,
    pub sent_at: Option<String>,
    pub sent_by: Option<String>,
    pub changed_since_sent: bool,
}

/// Where a reference came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceOrigin {
    /// Found on the web or in an existing work; sourceUrl should point to it.
    Found,
    /// Generated by an AI tool; may be refined further in the art pipeline.
    Generated,
    /// Made by the team (sketch, photo, own style test).
    Own,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
/// Kind of entity linked to a reference frame.
pub enum ReferenceTargetKind {
    #[default]
    /// An epic in the connected project.
    Epic,
    /// A story in the connected project.
    Story,
    /// A task in the connected project.
    Task,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefFrameTarget {
    pub target_key: String,
    pub kind: ReferenceTargetKind,
    pub title: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefFrameLink {
    pub frame_id: String,
    pub target_type: String,
    pub target_id: String,
    pub archived_at: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
/// Human verdict on a reference; null clears it.
pub enum ReferenceVerdict {
    /// Keep as a useful reference.
    Keep,
    /// Reject this reference.
    Reject,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceVerdictInput {
    /// Existing reference ID in this project, e.g. 01JITEM; required for item-specific operations.
    pub item_id: String,
    /// Human decision: keep or reject. Omitted preserves it; null clears it.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(optional)]
    #[specta(type = Option<Option<ReferenceVerdict>>)]
    pub verdict: Option<Option<ReferenceVerdict>>,
    /// Short reason in plain text, at most 500 characters. Omitted preserves it; null or empty clears it.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(optional)]
    #[specta(type = Option<Option<String>>)]
    pub verdict_note: Option<Option<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefFrameLinkInput {
    /// Existing frame ID, e.g. 01JFRAME. Omitted updates preserve the parent; null detaches where supported.
    pub frame_id: String,
    /// Target epic/story/task key in this project, e.g. JB-S3; required for associations.
    pub target_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefItem {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<crate::FileAsset>,
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
    pub verdict_note: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub origin: Option<ReferenceOrigin>,
    #[serde(default)]
    pub derived_from: Option<String>,
    #[serde(default)]
    pub copied_from: Option<String>,
    #[serde(default)]
    pub archived_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_title: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefEdge {
    pub id: String,
    pub jam_id: String,
    pub from_item: String,
    pub to_item: String,
    pub label: String,
    pub archived_at: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefLink {
    pub item_id: String,
    pub target_type: String,
    pub target_id: String,
    pub archived_at: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddReference {
    /// Original HTTP(S) source without credentials or whitespace, at most 2048 characters; optional.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Where this reference came from: found, generated or own; optional.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ReferenceOrigin>,
    /// Existing active reference in this project that this variation derives from; optional, no cycles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<String>,
    #[specta(optional)]
    /// File authority: board_file, linked_file or url. Required for registration; references may infer it from copy/filePath.
    pub storage_type: Option<crate::FileStorageType>,
    #[specta(optional)]
    /// Optional classifier override, e.g. document. Omitted detects kind from the extension.
    pub file_kind: Option<crate::FileKind>,
    #[specta(optional)]
    /// Stable retry ID for this logical operation; 1–100 characters, e.g. ls-S0.1.1. Reuse only for the same payload.
    pub request_id: Option<String>,
    #[specta(optional)]
    /// Task file purpose; default reference. Example: to_edit. Task associations require captured validators.
    pub file_role: Option<crate::TaskFileRole>,
    #[specta(optional)]
    /// Opaque claimGeneration from the inspected task; required for covered writes. Preserve the exact captured token, e.g. generation:task:3.
    pub expected_claim_generation: Option<String>,
    #[specta(optional)]
    /// Exact updatedAt captured before deciding this mutation, e.g. 2026-10-31T00:00:00Z. Never refresh it merely to replay a rejection.
    pub expected_updated_at: Option<String>,
    /// Operation-specific enumerated kind, e.g. note for a text reference or story for a question scope; required unless stated otherwise.
    pub kind: crate::ReferenceKind,
    /// Readable source file, e.g. C:/game/docs/plan.md; required for file references. Never a directory or wildcard.
    pub file_path: Option<String>,
    #[serde(default)]
    /// Whether to create a managed board copy; inferred from storageType when omitted. Example: true. Linked files remain project-owned.
    pub copy: Option<bool>,
    /// HTTP(S) URL without credentials or whitespace, e.g. https://example.test/design; required for URL assets.
    pub url: Option<String>,
    /// Text or search substring, e.g. lantern. Omitted filters match all text.
    pub text: Option<String>,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    /// Reference caption in Markdown, e.g. Approved palette. Omitted creates use empty text; omitted updates preserve it.
    pub caption: Option<String>,
    /// 1–24 chars each; stored lowercase (size-M → size-m); order is kept as given. Omitted creates have no tags; omitted updates preserve tags.
    pub tags: Option<Vec<String>>,
    /// Epic key for the reference frame, e.g. JB-E2; omitted means no added frame association.
    pub frame_epic_key: Option<String>,
    /// Existing frame ID, e.g. 01JFRAME. Omitted updates preserve the parent; null detaches where supported.
    pub frame_id: Option<String>,
    /// Board key to associate, e.g. JB-S3; omitted means no additional link.
    pub link_to: Option<String>,
    /// Horizontal canvas/world coordinate, e.g. 120; omitted preserves updates or uses create placement.
    pub x: Option<f64>,
    /// Vertical canvas/world coordinate, e.g. 80; omitted preserves updates or uses create placement.
    pub y: Option<f64>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferencePatch {
    /// Original HTTP(S) source without credentials or whitespace, at most 2048 characters; omitted preserves, null clears.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<Option<String>>)]
    pub source_url: Option<Option<String>>,
    /// Where this reference came from: found, generated or own; omitted preserves, null clears.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<Option<ReferenceOrigin>>)]
    pub origin: Option<Option<ReferenceOrigin>>,
    /// Active original reference in this project; omitted preserves, null clears. Cycles are forbidden.
    #[serde(
        default,
        deserialize_with = "crate::model::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(type = Option<Option<String>>)]
    pub derived_from: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Reference caption in Markdown, e.g. Approved palette. Omitted creates use empty text; omitted updates preserve it.
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// 1–24 chars each; stored lowercase (size-M → size-m); order is kept as given. Omitted creates have no tags; omitted updates preserve tags.
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
}
/// Optional human-editor compare-and-set boundary. Kept separate from the MCP
/// ReferenceEditInput contract so existing agent clients remain unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceContentExpectation {
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Reference caption in Markdown, e.g. Approved palette. Omitted creates use empty text; omitted updates preserve it.
    pub caption: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCanvas {
    pub items: Vec<RefItem>,
    pub frames: Vec<RefFrame>,
    pub edges: Vec<RefEdge>,
    pub links: Vec<RefLink>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGeometry {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: f64,
    pub frame_id: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasArchive {
    pub kind: crate::CanvasEntityKind,
    pub id: String,
    pub archived: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub title: String,
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpicEditInput {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    #[serde(flatten)]
    /// Update fields; omitted fields keep their values. Example: {"title":"Revised title"}.
    pub patch: EpicPatch,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryEditInput {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    #[serde(flatten)]
    /// Update fields; omitted fields keep their values. Example: {"title":"Revised title"}.
    pub patch: StoryPatch,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BriefEditInput {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    #[serde(flatten)]
    /// Update fields; omitted fields keep their values. Example: {"title":"Revised title"}.
    pub patch: BriefPatch,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceEditInput {
    /// Existing reference ID in this project, e.g. 01JITEM; required for item-specific operations.
    pub item_id: String,
    #[serde(flatten)]
    /// Update fields; omitted fields keep their values. Example: {"title":"Revised title"}.
    pub patch: ReferencePatch,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanningStatusInput {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    pub status: crate::PlanningStatus,
    /// Reason for a permitted human override; omitted uses normal validation. Example: Review manually accepted this evidence.
    pub override_reason: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadyInput {
    /// Stable board key of the item inspected, e.g. JB-12 or JB-E2; required for item operations.
    pub key: String,
    /// Exact updatedAt captured before deciding this mutation, e.g. 2026-10-31T00:00:00Z. Never refresh it merely to replay a rejection.
    pub expected_updated_at: String,
    /// Reason for a permitted human override; omitted uses normal validation. Example: Review manually accepted this evidence.
    pub override_reason: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrainInput {
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: String,
    /// Existing member handle, e.g. claude; required for appointment. Does not launch an agent.
    pub member_handle: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpicKeyInput {
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionListInput {
    /// Enumerated workflow state or state filter. Creates default to backlog for tasks and draft for planning scopes; omitted updates preserve it.
    pub status: Option<crate::QuestionStatus>,
    /// Exact project/epic/story/task scope; required where requested. Example: {"type":"story","id":"JB-S3"}. Questions never grant execution.
    pub scope: Option<Scope>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaitInput {
    /// Question IDs to wait for, e.g. ["01JQUESTION"]; required. Only explicit human answers resolve them.
    pub question_ids: Vec<String>,
    /// Wait duration in seconds. wait_for_changes defaults to 30 and allows 1–60; example 10. A timeout grants no permission.
    pub timeout_seconds: u64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusTextInput {
    /// Text or search substring, e.g. lantern. Omitted filters match all text.
    pub text: String,
    /// Exact project/epic/story/task scope; required where requested. Example: {"type":"story","id":"JB-S3"}. Questions never grant execution.
    pub scope: Option<Scope>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangesInput {
    /// Captured activity cursor or paging offset; starts at 0. Follow nextCursor; pages are not an atomic snapshot.
    pub cursor: i64,
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangesWaitInput {
    /// Captured activity cursor or paging offset; starts at 0. Follow nextCursor; pages are not an atomic snapshot.
    pub cursor: i64,
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: Option<String>,
    #[serde(default)]
    /// Include project-wide human events when filtering an epic; default false. Example: true.
    pub include_project: bool,
    /// Optional activity action filter; omitted includes all actions. Example: ["task.created"]. Use advertised values.
    pub actions: Option<Vec<crate::ActivityAction>>,
    /// Optional member filter: human or agent. Omitted includes both.
    pub actor_kind: Option<crate::ActorKind>,
    #[serde(default = "default_exclude_self")]
    /// Exclude this agent’s activity; default true. Example: false to inspect all matching events.
    pub exclude_self: bool,
    #[serde(default = "default_changes_timeout")]
    /// Wait duration in seconds. wait_for_changes defaults to 30 and allows 1–60; example 10. A timeout grants no permission.
    pub timeout_seconds: u64,
}
fn default_exclude_self() -> bool {
    true
}
fn default_changes_timeout() -> u64 {
    30
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangesWait {
    pub events: Vec<crate::ActivityEvent>,
    pub next_cursor: i64,
    pub timed_out: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceListInput {
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: Option<String>,
    /// Parent story key in this project, e.g. JB-S3. Every task belongs to a story.
    pub story_key: Option<String>,
    /// Task key for a file association, e.g. JB-12. Omitted registration is unlinked; task links require captured validators.
    pub task_key: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceLinkInput {
    /// Existing reference ID in this project, e.g. 01JITEM; required for item-specific operations.
    pub item_id: String,
    /// Target epic/story/task key in this project, e.g. JB-S3; required for associations.
    pub target_key: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeometryInput {
    /// Stable object ID or accepted scope key, e.g. JB-S3; required for ID-specific operations.
    pub id: String,
    /// Horizontal canvas/world coordinate, e.g. 120; omitted preserves updates or uses create placement.
    pub x: f64,
    /// Vertical canvas/world coordinate, e.g. 80; omitted preserves updates or uses create placement.
    pub y: f64,
    /// Positive canvas width, e.g. 900 world units; omitted preserves updates or uses create size.
    pub w: f64,
    /// Positive canvas height, e.g. 600 world units; omitted preserves updates or uses create size.
    pub h: f64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EdgeInput {
    /// Source reference ID, e.g. 01JFROM; required. Self-connections are refused.
    pub from_item: String,
    /// Destination reference ID, e.g. 01JTO; required and different from fromItem.
    pub to_item: String,
    /// Human-readable option or connection label, e.g. Keep existing; required for options, optional for connections.
    pub label: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectEditInput {
    /// Planning template: game_jam, gamedev, webapp or custom; required when changing it. Example: gamedev.
    pub template: crate::ProjectTemplate,
    /// Optional ISO-8601 milestone, e.g. 2026-11-01T12:00:00Z; null clears it.
    pub milestone_at: Option<String>,
    /// Display name, e.g. Bridge design; optional when inferred from a file. Renaming assets does not rename disk files.
    pub name: Option<String>,
    /// ISO-8601 project start, e.g. 2026-11-01T00:00:00Z; omitted updates preserve it.
    pub starts_at: Option<String>,
    /// ISO-8601 project end, e.g. 2026-11-03T00:00:00Z; omitted updates preserve it.
    pub ends_at: Option<String>,
    /// IANA timezone, e.g. UTC; omitted updates preserve it.
    pub timezone: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FramePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Canvas frame color string, e.g. m4; omitted preserves the existing color.
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Horizontal canvas/world coordinate, e.g. 120; omitted preserves updates or uses create placement.
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Vertical canvas/world coordinate, e.g. 80; omitted preserves updates or uses create placement.
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Positive canvas width, e.g. 900 world units; omitted preserves updates or uses create size.
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Positive canvas height, e.g. 600 world units; omitted preserves updates or uses create size.
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
    /// Stable object ID or accepted scope key, e.g. JB-S3; required for ID-specific operations.
    pub id: String,
    #[serde(flatten)]
    /// Update fields; omitted fields keep their values. Example: {"title":"Revised title"}.
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

impl Default for NewEpic {
    fn default() -> Self {
        Self {
            external_ref: None,
            request_id: crate::id(),
            title: Default::default(),
            color: None,
            goal_md: None,
            done_when_md: None,
            not_included_md: None,
            decided_md: None,
            open_questions_md: None,
            participation: None,
            reviewer: None,
            worker_model: None,
        }
    }
}

impl Default for NewStory {
    fn default() -> Self {
        Self {
            external_ref: None,
            request_id: crate::id(),
            epic_key: Default::default(),
            title: Default::default(),
            outcome_md: None,
            basis_md: None,
            preserve_md: None,
            scale_md: None,
            rejection_risks_md: None,
            open_decisions_md: None,
            acceptance: None,
        }
    }
}
