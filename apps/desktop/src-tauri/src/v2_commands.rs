//! Thin human-side adapters for the planning and work services.
use crate::{
    DesktopState,
    commands::{ApiError, execute},
};
use jam_core::*;
use std::result::Result;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn list_plan_stories(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<Story>, ApiError> {
    execute(&state, app, false, move |s| s.plan_stories()).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_plan_epics(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<Epic>, ApiError> {
    execute(&state, app, false, move |s| s.plan_epics()).await
}
#[tauri::command]
#[specta::specta]
pub async fn clear_brain(
    key: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Epic, ApiError> {
    execute(&state, app, true, move |s| {
        s.clear_brain(&s.current_member()?.id, &key)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn reorder_story(
    key: String,
    before_key: Option<String>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Story, ApiError> {
    execute(&state, app, true, move |s| {
        s.reorder_story(&s.current_member()?.id, &key, before_key.as_deref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_project(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Project, ApiError> {
    execute(&state, app, false, move |s| s.get_project()).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_project(
    input: ProjectEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Project, ApiError> {
    execute(&state, app, true, move |s| {
        s.edit_project(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_epics(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<Epic>, ApiError> {
    execute(&state, app, false, move |s| s.list_epics()).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_epic(
    key: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<EpicTree, ApiError> {
    execute(&state, app, false, move |s| s.get_epic(&key)).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_story(
    key: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<StoryTree, ApiError> {
    execute(&state, app, false, move |s| s.get_story(&key)).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_epic(
    input: NewEpic,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Epic, ApiError> {
    execute(&state, app, true, move |s| {
        s.create_epic(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_epic(
    input: EpicEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Epic, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_epic(&s.current_member()?.id, &input.key, input.patch)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn set_epic_status(
    input: PlanningStatusInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Epic, ApiError> {
    execute(&state, app, true, move |s| {
        s.set_epic_status(
            &s.current_member()?.id,
            &input.key,
            &input.status,
            input.override_reason.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_story(
    input: NewStory,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Story, ApiError> {
    execute(&state, app, true, move |s| {
        s.create_story(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_story(
    input: StoryEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Story, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_story(&s.current_member()?.id, &input.key, input.patch)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn set_story_status(
    input: PlanningStatusInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Story, ApiError> {
    execute(&state, app, true, move |s| {
        s.set_story_status(
            &s.current_member()?.id,
            &input.key,
            &input.status,
            input.override_reason.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_task_brief(
    input: BriefEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskDetail, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_task_brief(&s.current_member()?.id, &input.key, input.patch, None)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn check_ready(
    key: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Readiness, ApiError> {
    execute(&state, app, false, move |s| s.check_ready(&key)).await
}

#[tauri::command]
#[specta::specta]
pub async fn mark_ready(
    input: ReadyInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TaskSummary, ApiError> {
    execute(&state, app, true, move |s| s.mark_current_task_ready(input)).await
}

#[tauri::command]
#[specta::specta]
pub async fn answer_question(
    input: AnswerQuestion,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Question, ApiError> {
    execute(&state, app, true, move |s| {
        s.answer_question(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ask_user(
    input: AskUser,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Question, ApiError> {
    execute(&state, app, true, move |s| {
        s.ask_user(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn withdraw_question(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Question, ApiError> {
    execute(&state, app, true, move |s| {
        s.withdraw_question(&s.current_member()?.id, &id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_questions(
    input: QuestionListInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<Question>, ApiError> {
    execute(&state, app, false, move |s| {
        s.list_questions(input.status.as_deref(), input.scope.as_ref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn review_task(
    input: ReviewTask,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Review, ApiError> {
    execute(&state, app, true, move |s| {
        s.review_task(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn submit_report(
    input: SubmitReport,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Report, ApiError> {
    execute(&state, app, true, move |s| {
        s.submit_report(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn set_brain(
    input: BrainInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Epic, ApiError> {
    execute(&state, app, true, move |s| {
        s.set_brain(
            &s.current_member()?.id,
            &input.epic_key,
            &input.member_handle,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_changes_since(
    input: ChangesInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<ActivityEvent>, ApiError> {
    execute(&state, app, false, move |s| {
        s.list_changes_since(input.cursor, input.epic_key.as_deref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn epic_journal(
    epic_key: String,
    after: i64,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<ActivityEvent>, ApiError> {
    execute(&state, app, false, move |s| {
        s.epic_journal(&epic_key, after)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_reference(
    input: AddReference,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.add_reference(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_references(
    input: ReferenceListInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<RefItem>, ApiError> {
    execute(&state, app, false, move |s| {
        s.list_references(
            input.epic_key.as_deref(),
            input.story_key.as_deref(),
            input.task_key.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_reference(
    input: ReferenceEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_reference(&s.current_member()?.id, &input.item_id, input.patch)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn link_reference(
    input: ReferenceLinkInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.link_reference(&s.current_member()?.id, &input.item_id, &input.target_key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn unlink_reference(
    input: ReferenceLinkInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    execute(&state, app, true, move |s| {
        s.unlink_reference(&s.current_member()?.id, &input.item_id, &input.target_key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn archive_reference(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    execute(&state, app, true, move |s| {
        s.archive_reference(&s.current_member()?.id, &id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_ref_frames(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<RefFrame>, ApiError> {
    execute(&state, app, false, move |s| s.list_ref_frames()).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_ref_frame(
    input: RefFrame,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefFrame, ApiError> {
    execute(&state, app, true, move |s| {
        s.create_ref_frame(&s.current_member()?.id, input)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_ref_frame(
    input: FrameEditInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefFrame, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_ref_frame(&s.current_member()?.id, &input.id, input.patch)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn archive_ref_frame(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    execute(&state, app, true, move |s| {
        s.archive_ref_frame(&s.current_member()?.id, &id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_ref_edges(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Vec<RefEdge>, ApiError> {
    execute(&state, app, false, move |s| s.list_ref_edges()).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_ref_edge(
    input: EdgeInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefEdge, ApiError> {
    execute(&state, app, true, move |s| {
        s.create_ref_edge(
            &s.current_member()?.id,
            &input.from_item,
            &input.to_item,
            &input.label,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn archive_ref_edge(
    id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), ApiError> {
    execute(&state, app, true, move |s| {
        s.archive_ref_edge(&s.current_member()?.id, &id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_ref_geometry(
    input: GeometryInput,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RefItem, ApiError> {
    execute(&state, app, true, move |s| {
        s.update_ref_geometry(
            &s.current_member()?.id,
            &input.id,
            input.x,
            input.y,
            input.w,
            input.h,
        )
    })
    .await
}
