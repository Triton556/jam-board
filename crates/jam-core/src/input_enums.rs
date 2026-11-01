use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

macro_rules! input_enum {
    ($(#[$meta:meta])* $name:ident { $($(#[$variant_meta:meta])* $variant:ident => $value:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
        #[serde(rename_all="snake_case")]
        pub enum $name { $($(#[$variant_meta])* $variant),+ }
        impl $name {
            pub fn as_str(&self) -> &'static str { match self { $(Self::$variant => $value),+ } }
        }
        impl std::ops::Deref for $name {
            type Target = str;
            fn deref(&self) -> &str { self.as_str() }
        }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(self.as_str()) }
        }
        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> { Ok(self.as_str().into()) }
        }
        impl From<$name> for String { fn from(value: $name) -> Self { value.as_str().into() } }
        impl PartialEq<str> for $name { fn eq(&self, other: &str) -> bool { self.as_str() == other } }
        impl PartialEq<&str> for $name { fn eq(&self, other: &&str) -> bool { self.as_str() == *other } }
        impl std::str::FromStr for $name {
            type Err = crate::Error;
            fn from_str(value: &str) -> crate::Result<Self> {
                serde_json::from_value(serde_json::json!(value)).map_err(|e| crate::invalid(stringify!($name),&e.to_string()))
            }
        }
    };
}

input_enum! {
    /// Palette slot used only to tell epics apart; it carries no meaning. If omitted, the board picks the next slot in rotation.
    EpicColor {
        /// Palette color 1; no semantic meaning.
        M1 => "m1",
        /// Palette color 2; no semantic meaning.
        M2 => "m2",
        /// Palette color 3; no semantic meaning.
        M3 => "m3",
        /// Palette color 4; no semantic meaning.
        M4 => "m4",
        /// Palette color 5; no semantic meaning.
        M5 => "m5",
        /// Palette color 6; no semantic meaning.
        M6 => "m6"
    }
}
input_enum! {
    /// How often the human reviews planned iterations; default first_sketch.
    Participation {
        /// Human reviews every iteration.
        EachIteration => "each_iteration",
        /// Default; human sees the first sketch, then the agents continue.
        FirstSketch => "first_sketch",
        /// Agents run without check-ins.
        Autonomous => "autonomous"
    }
}
input_enum! {
    /// Human review schedule; default none. This does not grant execution permission.
    Reviewer {
        /// Default; no scheduled human review.
        None => "none",
        /// One human review at the end.
        Final => "final",
        /// Review after each stage.
        Stages => "stages"
    }
}
input_enum! {
    /// Task planning/workflow status; creating Ready work does not authorize execution.
    TaskStatus {
        /// Unscheduled draft work; default on create.
        Backlog => "backlog",
        /// Planned work with readiness validation; separate from execution permission.
        Ready => "ready",
        /// Claimed work under an explicit human execution grant.
        InProgress => "in_progress",
        /// Submitted evidence awaiting independent review.
        Review => "review",
        /// Accepted work.
        Done => "done"
    }
}
input_enum! {
    /// Relative scheduling priority; default medium.
    Priority {
        /// Lower scheduling priority.
        Low => "low",
        /// Default scheduling priority.
        Medium => "medium",
        /// Higher scheduling priority.
        High => "high",
        /// Critical scheduling priority.
        Critical => "critical"
    }
}
input_enum! {
    /// Epic or story planning status. Activation is separate from execution permission.
    #[derive(Default)]
    PlanningStatus {
        /// Draft intent; default on create.
        #[default]
        Draft => "draft",
        /// Active planning scope.
        Active => "active",
        /// Completed planning scope.
        Done => "done",
        /// Archived planning scope.
        Archived => "archived"
    }
}

input_enum! {
    /// Scope kind for questions and status; supply its project ID or entity ID.
    ScopeKind {
        /// The connected project.
        Project => "project",
        /// One epic in the connected project.
        Epic => "epic",
        /// One story in the connected project.
        Story => "story",
        /// One task in the connected project.
        Task => "task"
    }
}
input_enum! {
    /// Question lifecycle filter; omission includes all states.
    QuestionStatus {
        /// Waiting for an explicit human answer.
        Open => "open",
        /// Answered by a human.
        Answered => "answered",
        /// Withdrawn without an answer.
        Withdrawn => "withdrawn"
    }
}
input_enum! {
    /// Independent review decision on the exact report inspected.
    #[derive(Default)]
    ReviewVerdict {
        /// Accept the submitted evidence.
        #[default]
        Accept => "accept",
        /// Return the task to Ready with requested changes.
        ChangesRequested => "changes_requested"
    }
}
input_enum! {
    /// Reference content kind; this does not launch a native application.
    #[derive(Default)]
    ReferenceKind {
        /// A registered file reference.
        Asset => "asset",
        /// An HTTP(S) link.
        Link => "link",
        /// A note with Markdown text.
        #[default]
        Note => "note"
    }
}
input_enum! {
    /// Recorded check outcome; NOT_RUN is never a pass.
    #[derive(Default)]
    ReportResult {
        /// The named check ran and passed.
        #[serde(rename="PASS")]
        Pass => "PASS",
        /// The named check ran and failed.
        #[serde(rename="FAIL")]
        Fail => "FAIL",
        /// The named check was not run.
        #[serde(rename="NOT_RUN")]
        #[default]
        NotRun => "NOT_RUN"
    }
}
input_enum! {
    /// Project planning template; default game_jam.
    #[derive(Default)]
    ProjectTemplate {
        /// Short game jam project.
        #[default]
        GameJam => "game_jam",
        /// Ongoing game development project.
        Gamedev => "gamedev",
        /// Web application project.
        Webapp => "webapp",
        /// Custom project vocabulary.
        Custom => "custom"
    }
}
input_enum! {
    /// Desktop color mode preference; default system.
    ThemePreference {
        /// Follow the operating system.
        System=>"system",
        /// Light palette.
        Light=>"light",
        /// Dark palette.
        Dark=>"dark"
    }
}
input_enum! {
    /// Optional board-card color grouping; default none.
    BoardColorBy {
        /// No grouping color.
        None=>"none",
        /// Color by assigned member.
        Assignee=>"assignee",
        /// Color by epic palette slot.
        Epic=>"epic"
    }
}
input_enum! {
    /// Asset collection presentation; default grid.
    AssetsView {
        /// Cards in a grid.
        Grid=>"grid",
        /// Compact rows.
        List=>"list"
    }
}
input_enum! {
    /// Member palette color; only distinguishes people and agents.
    MemberColor {
        /// Blue palette slot.
        #[serde(rename="#5B8DEF")]
        Blue=>"#5B8DEF",
        /// Pink palette slot.
        #[serde(rename="#E0679A")]
        Pink=>"#E0679A",
        /// Green palette slot.
        #[serde(rename="#3FA37A")]
        Green=>"#3FA37A",
        /// Purple palette slot.
        #[serde(rename="#9B7BE0")]
        Purple=>"#9B7BE0",
        /// Orange palette slot.
        #[serde(rename="#F07E5F")]
        Orange=>"#F07E5F",
        /// Gold palette slot.
        #[serde(rename="#D8A630")]
        Gold=>"#D8A630"
    }
}
input_enum! {
    /// Stable task-table sort column; default numeric key order when omitted.
    TaskSortField {
        /// Numeric board key.
        Key=>"key",
        /// Case-insensitive title.
        Title=>"title",
        /// Workflow status order.
        Status=>"status",
        /// Scheduling priority order.
        Priority=>"priority",
        /// Assignee display name.
        Assignee=>"assignee",
        /// Story-point estimate.
        Estimate=>"estimate",
        /// Monotonic update timestamp.
        #[serde(rename="updatedAt")]
        UpdatedAt=>"updatedAt"
    }
}
input_enum! {
    /// Task-table sort direction; required when a sort is supplied.
    SortDirection {
        /// Ascending values.
        Asc=>"asc",
        /// Descending values.
        Desc=>"desc"
    }
}
input_enum! {
    /// Canvas entity addressed by an archive operation.
    #[derive(Default)]
    CanvasEntityKind {
        /// One canvas reference or note.
        #[default]
        Item => "item",
        /// One canvas frame.
        Frame => "frame",
        /// One directed connection.
        Edge => "edge"
    }
}
input_enum! {
    /// Kind of planning record matched within the connected project.
    RecordKind {
        /// Epic intent and planning scope.
        Epic => "epic",
        /// Story outcome and acceptance.
        Story => "story",
        /// Individual task and its brief.
        Task => "task"
    }
}
input_enum! {
    /// File classifier category; default is detected from the source extension.
    FileKind {
        /// Raster or vector image.
        Sprite => "sprite",
        /// Audio recording.
        Audio => "audio",
        /// Video recording.
        Video => "video",
        /// Three-dimensional model or scene.
        Model => "model",
        /// Text, PDF or office document.
        Document => "document",
        /// Level or map data.
        Level => "level",
        /// Font file.
        Font => "font",
        /// Other file format.
        Other => "other"
    }
}
input_enum! {
    /// File path authority; internal path comparisons remain canonical.
    FilePathBase {
        /// Portable path under the board folder.
        Board => "board",
        /// Portable path relative to a verified repository.
        Repo => "repo",
        /// Absolute linked file path.
        Absolute => "absolute",
        /// Validated HTTP(S) URL.
        Url => "url"
    }
}
input_enum! {
    /// File purpose on an individual task; default reference.
    TaskFileRole {
        /// Input file to edit.
        ToEdit => "to_edit",
        /// Supporting reference.
        Reference => "reference",
        /// Task output or result.
        Result => "result"
    }
}
input_enum! {
    /// Member kind for activity filters; omission includes both kinds.
    ActorKind {
        /// Human board member.
        Human => "human",
        /// Connected agent board member.
        Agent => "agent"
    }
}

/// Story points (relative effort), not hours; use 1, 2, 3, 5 or 8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(try_from = "i64", into = "i64")]
#[schemars(with="i64", transform=estimate_schema)]
pub enum Estimate {
    /// One story point.
    One,
    /// Two story points.
    Two,
    /// Three story points.
    Three,
    /// Five story points.
    Five,
    /// Eight story points.
    Eight,
}
fn estimate_schema(schema: &mut schemars::Schema) {
    schema.insert("enum".into(), serde_json::json!([1, 2, 3, 5, 8]));
}
impl From<Estimate> for i64 {
    fn from(value: Estimate) -> Self {
        match value {
            Estimate::One => 1,
            Estimate::Two => 2,
            Estimate::Three => 3,
            Estimate::Five => 5,
            Estimate::Eight => 8,
        }
    }
}
impl TryFrom<i64> for Estimate {
    type Error = String;
    fn try_from(value: i64) -> std::result::Result<Self, String> {
        match value {
            1 => Ok(Self::One),
            2 => Ok(Self::Two),
            3 => Ok(Self::Three),
            5 => Ok(Self::Five),
            8 => Ok(Self::Eight),
            _ => Err("estimate: expected one of 1, 2, 3, 5, 8".into()),
        }
    }
}
impl rusqlite::types::ToSql for Estimate {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(i64::from(*self).into())
    }
}

input_enum! {
    /// Persisted activity action accepted by the long-poll filter; omission includes all events.
    ActivityAction {
        /// A planning import batch was applied without starting work.
        ImportApplied => "import_applied",
        /// Recorded agent status event.
        #[serde(rename="agent.status")]
        AgentStatus => "agent.status",
        /// Recorded asset created event.
        #[serde(rename="asset.created")]
        AssetCreated => "asset.created",
        /// Recorded asset linked event.
        #[serde(rename="asset.linked")]
        AssetLinked => "asset.linked",
        /// Recorded asset unlinked event.
        #[serde(rename="asset.unlinked")]
        AssetUnlinked => "asset.unlinked",
        /// Recorded asset updated event.
        #[serde(rename="asset.updated")]
        AssetUpdated => "asset.updated",
        /// Recorded comment added event.
        #[serde(rename="comment.added")]
        CommentAdded => "comment.added",
        /// Recorded epic created event.
        #[serde(rename="epic.created")]
        EpicCreated => "epic.created",
        /// Recorded epic status event.
        #[serde(rename="epic.status")]
        EpicStatus => "epic.status",
        /// Recorded epic updated event.
        #[serde(rename="epic.updated")]
        EpicUpdated => "epic.updated",
        /// Recorded execution started event.
        #[serde(rename="execution.started")]
        ExecutionStarted => "execution.started",
        /// Recorded execution paused event.
        #[serde(rename="execution.paused")]
        ExecutionPaused => "execution.paused",
        /// Recorded execution requested event.
        #[serde(rename="execution.requested")]
        ExecutionRequested => "execution.requested",
        /// Recorded execution request resolved event.
        #[serde(rename="execution.request_resolved")]
        ExecutionRequestResolved => "execution.request_resolved",
        /// Recorded jam archived event.
        #[serde(rename="jam.archived")]
        JamArchived => "jam.archived",
        /// Recorded jam imported event.
        #[serde(rename="jam.imported")]
        JamImported => "jam.imported",
        /// Recorded jam restored event.
        #[serde(rename="jam.restored")]
        JamRestored => "jam.restored",
        /// Recorded jam updated event.
        #[serde(rename="jam.updated")]
        JamUpdated => "jam.updated",
        /// Recorded member joined event.
        #[serde(rename="member.joined")]
        MemberJoined => "member.joined",
        /// Recorded member updated event.
        #[serde(rename="member.updated")]
        MemberUpdated => "member.updated",
        /// Recorded project updated event.
        #[serde(rename="project.updated")]
        ProjectUpdated => "project.updated",
        /// Recorded question answered event.
        #[serde(rename="question.answered")]
        QuestionAnswered => "question.answered",
        /// Recorded question asked event.
        #[serde(rename="question.asked")]
        QuestionAsked => "question.asked",
        /// Recorded question withdrawn event.
        #[serde(rename="question.withdrawn")]
        QuestionWithdrawn => "question.withdrawn",
        /// Recorded reference added event.
        #[serde(rename="reference.added")]
        ReferenceAdded => "reference.added",
        /// Human explicitly sent a moodboard review to the brain.
        #[serde(rename="reference.review_sent")]
        ReferenceReviewSent => "reference.review_sent",
        /// Recorded reference linked event.
        #[serde(rename="reference.linked")]
        ReferenceLinked => "reference.linked",
        /// Recorded reference updated event.
        #[serde(rename="reference.updated")]
        ReferenceUpdated => "reference.updated",
        /// Recorded report submitted event.
        #[serde(rename="report.submitted")]
        ReportSubmitted => "report.submitted",
        /// Recorded review recorded event.
        #[serde(rename="review.recorded")]
        ReviewRecorded => "review.recorded",
        /// Recorded story created event.
        #[serde(rename="story.created")]
        StoryCreated => "story.created",
        /// Recorded story status event.
        #[serde(rename="story.status")]
        StoryStatus => "story.status",
        /// Recorded story updated event.
        #[serde(rename="story.updated")]
        StoryUpdated => "story.updated",
        /// Recorded task archived event.
        #[serde(rename="task.archived")]
        TaskArchived => "task.archived",
        /// Recorded task brief updated event.
        #[serde(rename="task.brief_updated")]
        TaskBriefUpdated => "task.brief_updated",
        /// Recorded task claimed event.
        #[serde(rename="task.claimed")]
        TaskClaimed => "task.claimed",
        /// Recorded task created event.
        #[serde(rename="task.created")]
        TaskCreated => "task.created",
        /// Recorded task moved event.
        #[serde(rename="task.moved")]
        TaskMoved => "task.moved",
        /// Recorded task ready override event.
        #[serde(rename="task.ready_override")]
        TaskReadyOverride => "task.ready_override",
        /// Recorded task released event.
        #[serde(rename="task.released")]
        TaskReleased => "task.released",
        /// Recorded task updated event.
        #[serde(rename="task.updated")]
        TaskUpdated => "task.updated",
        /// A story moved between epics, retaining its key.
        StoryMoved => "story_moved",
        /// A task moved between stories, retaining its key.
        TaskMovedToStory => "task_moved_to_story"
    }
}

input_enum! {
    /// Top-level task row fields requested by list_tasks; key is always returned.
    TaskField {
        /// Include the task external ref field.
        #[serde(rename="externalRef")]
        ExternalRef => "externalRef",
        /// Include the task id field.
        #[serde(rename="id")]
        Id => "id",
        /// Include the task jam id field.
        #[serde(rename="jamId")]
        JamId => "jamId",
        /// Include the task key field.
        #[serde(rename="key")]
        Key => "key",
        /// Include the task title field.
        #[serde(rename="title")]
        Title => "title",
        /// Include the task description md field.
        #[serde(rename="descriptionMd")]
        DescriptionMd => "descriptionMd",
        /// Include the task status field.
        #[serde(rename="status")]
        Status => "status",
        /// Include the task priority field.
        #[serde(rename="priority")]
        Priority => "priority",
        /// Include the task estimate field.
        #[serde(rename="estimate")]
        Estimate => "estimate",
        /// Include the task due at field.
        #[serde(rename="dueAt")]
        DueAt => "dueAt",
        /// Include the task position field.
        #[serde(rename="position")]
        Position => "position",
        /// Include the task assignee id field.
        #[serde(rename="assigneeId")]
        AssigneeId => "assigneeId",
        /// Include the task created by field.
        #[serde(rename="createdBy")]
        CreatedBy => "createdBy",
        /// Include the task updated by field.
        #[serde(rename="updatedBy")]
        UpdatedBy => "updatedBy",
        /// Include the task created at field.
        #[serde(rename="createdAt")]
        CreatedAt => "createdAt",
        /// Include the task updated at field.
        #[serde(rename="updatedAt")]
        UpdatedAt => "updatedAt",
        /// Include the task archived at field.
        #[serde(rename="archivedAt")]
        ArchivedAt => "archivedAt",
        /// Include the task idempotency key field.
        #[serde(rename="idempotencyKey")]
        IdempotencyKey => "idempotencyKey",
        /// Include the task tags field.
        #[serde(rename="tags")]
        Tags => "tags",
        /// Include the task comment count field.
        #[serde(rename="commentCount")]
        CommentCount => "commentCount",
        /// Include the task story id field.
        #[serde(rename="storyId")]
        StoryId => "storyId",
        /// Include the task story key field.
        #[serde(rename="storyKey")]
        StoryKey => "storyKey",
        /// Include the task ready field.
        #[serde(rename="ready")]
        Ready => "ready",
        /// Include the task epic id field.
        #[serde(rename="epicId")]
        EpicId => "epicId",
        /// Include the task epic key field.
        #[serde(rename="epicKey")]
        EpicKey => "epicKey",
        /// Include the task epic color field.
        #[serde(rename="epicColor")]
        EpicColor => "epicColor",
        /// Include the task changes requested field.
        #[serde(rename="changesRequested")]
        ChangesRequested => "changesRequested",
        /// Include the task needs info field.
        #[serde(rename="needsInfo")]
        NeedsInfo => "needsInfo",
        /// Include the task review round field.
        #[serde(rename="reviewRound")]
        ReviewRound => "reviewRound",
        /// Include the task claim generation field.
        #[serde(rename="claimGeneration")]
        ClaimGeneration => "claimGeneration"
    }
}
