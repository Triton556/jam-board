use crate::server::{parse, tool, value};
use jam_core::*;
use rmcp::model::Tool;
use serde_json::Value;

pub(crate) fn execute(
    store: &Store,
    actor: &Member,
    name: &str,
    args: Value,
) -> Option<jam_core::Result<Value>> {
    Some((|| {
        Ok(match name {
            "get_execution" => {
                value(store.get_execution(&parse::<ExecutionScopeInput>(args)?.scope)?)?
            }
            "list_execution" => {
                parse::<crate::server::Empty>(args)?;
                value(store.list_execution()?)?
            }
            "list_execution_requests" => value(
                store.list_execution_requests(parse::<ExecutionRequestListInput>(args)?.status)?,
            )?,
            "request_execution" => value(store.request_execution(&actor.id, parse(args)?)?)?,
            "get_project" => {
                parse::<crate::server::Empty>(args)?;
                value(store.get_project()?)?
            }
            "list_epics" => {
                parse::<crate::server::Empty>(args)?;
                value(store.list_epics()?)?
            }
            "get_epic" => value(store.get_epic(&parse::<crate::server::Key>(args)?.key)?)?,
            "create_epic" => value(store.create_epic(&actor.id, parse(args)?)?)?,
            "update_epic" => {
                let a: EpicEditInput = parse(args)?;
                value(store.update_epic(&actor.id, &a.key, a.patch)?)?
            }
            "set_epic_status" => {
                let a: PlanningStatusInput = parse(args)?;
                value(store.set_epic_status(
                    &actor.id,
                    &a.key,
                    &a.status,
                    a.override_reason.as_deref(),
                )?)?
            }
            "become_brain" => {
                value(store.become_brain(&actor.id, &parse::<EpicKeyInput>(args)?.epic_key)?)?
            }
            "set_brain" => {
                let a: BrainInput = parse(args)?;
                value(store.set_brain(&actor.id, &a.epic_key, &a.member_handle)?)?
            }
            "create_story" => value(store.create_story(&actor.id, parse(args)?)?)?,
            "update_story" => {
                let a: StoryEditInput = parse(args)?;
                value(store.update_story(&actor.id, &a.key, a.patch)?)?
            }
            "set_story_status" => {
                let a: PlanningStatusInput = parse(args)?;
                value(store.set_story_status(
                    &actor.id,
                    &a.key,
                    &a.status,
                    a.override_reason.as_deref(),
                )?)?
            }
            "update_task_brief" => {
                let a: AgentBriefEdit = parse(args)?;
                let context = a.context();
                value(store.update_task_brief(&actor.id, &a.key, a.patch, Some(&context))?)?
            }
            "check_ready" => value(store.check_ready(&parse::<crate::server::Key>(args)?.key)?)?,
            "mark_ready" => {
                let a: AgentReady = parse(args)?;
                value(store.mark_ready(
                    &actor.id,
                    &a.key,
                    a.override_reason.as_deref(),
                    Some(&a.context()),
                )?)?
            }
            "submit_report" => value(store.submit_report(&actor.id, parse(args)?)?)?,
            "review_task" => value(store.review_task(&actor.id, parse(args)?)?)?,
            "ask_user" => value(store.ask_user(&actor.id, parse(args)?)?)?,
            "wait_for_answer" => {
                let a: WaitInput = parse(args)?;
                value(store.wait_for_answer(&a.question_ids, a.timeout_seconds)?)?
            }
            "list_questions" => {
                let a: QuestionListInput = parse(args)?;
                value(store.list_questions(a.status.as_deref(), a.scope.as_ref())?)?
            }
            "withdraw_question" => {
                value(store.withdraw_question(&actor.id, &parse::<IdInput>(args)?.id)?)?
            }
            "set_status" => {
                let a: StatusTextInput = parse(args)?;
                value(store.set_status(&actor.id, &a.text, a.scope)?)?
            }
            "list_changes_since" => {
                let a: ChangesInput = parse(args)?;
                value(store.list_changes_since(a.cursor, a.epic_key.as_deref())?)?
            }
            "wait_for_changes" => value(store.wait_for_changes(&actor.id, parse(args)?)?)?,
            "add_reference" => value(store.add_reference(&actor.id, parse(args)?)?)?,
            "list_references" => {
                let a: ReferenceListInput = parse(args)?;
                value(store.list_references(
                    a.epic_key.as_deref(),
                    a.story_key.as_deref(),
                    a.task_key.as_deref(),
                )?)?
            }
            "link_reference" => {
                let a: ReferenceLinkInput = parse(args)?;
                value(store.link_reference(&actor.id, &a.item_id, &a.target_key)?)?
            }
            "update_reference" => {
                let a: ReferenceEditInput = parse(args)?;
                value(store.update_reference(&actor.id, &a.item_id, a.patch)?)?
            }
            _ => return Err(Error::NotFound("unhandled".into())),
        })
    })())
    .filter(|result| !matches!(result,Err(Error::NotFound(s))if s=="unhandled"))
}
#[derive(serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct IdInput {
    id: String,
}

pub(crate) fn tools() -> Vec<Tool> {
    vec![
        tool::<ExecutionScopeInput>(
            "get_execution",
            "Read the exact story/epic execution permission and revision. Ready is separate; only a human can start work.",
            true,
        ),
        tool::<crate::server::Empty>(
            "list_execution",
            "Read execution states for this pinned project. A paused epic may have explicitly started stories.",
            true,
        ),
        tool::<ExecutionRequestListInput>(
            "list_execution_requests",
            "Read typed execution requests and approval status in this project. No tool can approve or start work.",
            true,
        ),
        tool::<RequestExecution>(
            "request_execution",
            "Appointed epic brain only: request human approval to start an exact story or epic. This does not start work or launch executors. The human confirms in the app Inbox; generic questions or chat text cannot authorize execution.",
            false,
        ),
        tool::<crate::server::Empty>(
            "get_project",
            "Read the active project's template, dates, suggested tags and hierarchy counts. Non-jam projects use milestoneAt rather than a countdown.",
            true,
        ),
        tool::<crate::server::Empty>(
            "list_epics",
            "List non-archived epics in project order, including their brain and worker model.",
            true,
        ),
        tool::<crate::server::Key>(
            "get_epic",
            "Read an epic tree, task readiness, the last 30 journal rows and open questions. Example: key=JB-E1.",
            true,
        ),
        tool::<NewEpic>(
            "create_epic",
            "Create a draft epic from the interview summary. Define goalMd and doneWhenMd before activating it.",
            false,
        ),
        tool::<EpicEditInput>(
            "update_epic",
            "Edit the supplied interview fields without replacing omitted fields. Human edits remain visible in the change feed.",
            false,
        ),
        tool::<PlanningStatusInput>(
            "set_epic_status",
            "Change an epic's lifecycle status as its brain. Done requires completed stories or an explicit overrideReason.",
            false,
        ),
        tool::<EpicKeyInput>(
            "become_brain",
            "Become the planner and reviewer of an epic that has no brain. If another brain is appointed, forbidden names that agent.",
            false,
        ),
        tool::<BrainInput>(
            "set_brain",
            "Appoint an existing agent by handle as the epic's brain. Only the current brain or a human may replace it.",
            false,
        ),
        tool::<NewStory>(
            "create_story",
            "Create a draft story under epicKey using an intent card and acceptance criteria. Each criterion has id, criterion, mandatory and check.",
            false,
        ),
        tool::<StoryEditInput>(
            "update_story",
            "Edit a story's intent card and acceptance array. A supplied acceptance array replaces the entire list.",
            false,
        ),
        tool::<PlanningStatusInput>(
            "set_story_status",
            "Activate a story after defining its outcome and mandatory acceptance. Done requires completed tasks or an authorized overrideReason.",
            false,
        ),
        tool::<AgentBriefEdit>(
            "update_task_brief",
            "Update supplied brief fields; changes and tests replace their whole arrays. Keep the human-readable description and wishes in update_task; do not replace them with the structured plan.",
            false,
        ),
        tool::<crate::server::Key>(
            "check_ready",
            "Read the exact missing readiness codes and messages for a task. This does not change the task.",
            true,
        ),
        tool::<AgentReady>(
            "mark_ready",
            "Move a complete brief to Ready. A human or this epic's brain may pass a non-empty overrideReason, recorded in the journal.",
            false,
        ),
        tool::<SubmitReport>(
            "submit_report",
            "Submit the assignee's report and move In progress to Review. Tests record name, command, expected, actual and PASS, FAIL or NOT_RUN.",
            false,
        ),
        tool::<ReviewTask>(
            "review_task",
            "As the epic's brain, compare the report to the brief tests and story acceptance. Accept completes the task; changes_requested returns it to Ready for the same worker.",
            false,
        ),
        tool::<AskUser>(
            "ask_user",
            "Ask a scoped interview or implementation question with up to six options. Scope is {type:'project'|'epic'|'story'|'task', id:<ID or key>}; only humans answer.",
            false,
        ),
        tool::<WaitInput>(
            "wait_for_answer",
            "Wait on the activity feed until any listed question is answered or the timeout expires. timeoutSeconds is at most 60 and the SQLite writer remains available.",
            true,
        ),
        tool::<QuestionListInput>(
            "list_questions",
            "Read questions and human answers, optionally filtered by status and scope.",
            true,
        ),
        tool::<IdInput>(
            "withdraw_question",
            "Withdraw an open question you asked. A human can withdraw any question.",
            false,
        ),
        tool::<StatusTextInput>(
            "set_status",
            "Publish a short status line with an optional epic, story or task scope. Lines older than 30 minutes are marked stale.",
            false,
        ),
        tool::<ChangesInput>(
            "list_changes_since",
            "Read ordered activity after cursor, optionally scoped to epicKey. Save the last seq to react to human edits, answers and reports.",
            true,
        ),
        tool::<ChangesWaitInput>(
            "wait_for_changes",
            "Wait for up to 100 ordered matching activity events after cursor. Defaults: excludeSelf=true, includeProject=false, timeoutSeconds=30 (1–60). nextCursor advances past all inspected events, including non-matches. With epicKey, includeProject adds only project-wide human events. Holds no SQLite writer.",
            true,
        ),
        tool::<AddReference>(
            "add_reference",
            "Add an existing readable file, a URL or a note without copying files or fetching links. Optionally place it in an epic frame and link it to an epic, story or task key.",
            false,
        ),
        tool::<ReferenceListInput>(
            "list_references",
            "List active references, optionally filtered by epicKey, storyKey or taskKey. Archived items are hidden.",
            true,
        ),
        tool::<ReferenceLinkInput>(
            "link_reference",
            "Link a reference item to a task, story or epic by targetKey. References and targets must belong to the same project.",
            false,
        ),
        tool::<ReferenceEditInput>(
            "update_reference",
            "Edit a reference title, caption or tags; supplied tags replace the list. Links are stored without network previews.",
            false,
        ),
    ]
}

// Shared by handoff resources and prompts so bootstrap/recovery policy stays aligned.
pub(crate) const OBSERVATION_GUIDANCE: &str = "Use the human's established language. Verify get_session_context against the intended exact project ID before reads; matching names/prefixes are insufficient. Unknown/mismatched ID: stop and ask. Preserve saved cursor and project/epic/filter identity; never replace/reset unprocessed checkpoints. Fresh bootstrap only: capture latestActivityCursor BEFORE baseline reads, then replay; finish the baseline before checkpointing. No historical-audit shortcut. Missing differs from 0: older servers require conservative saved-checkpoint recovery, or cursor0 for genuinely new history. Recover with wait_for_changes(cursor, epicKey, includeProject=true, excludeSelf=false, timeoutSeconds=1), omitting actions/actorKind unless intentionally filtering. Handle each page before checkpointing nextCursor, including timeouts; drain until timedOut=true, not a short page, use timeoutSeconds=60 only if the assigned role/request requires continued observation. Finish/report at the assigned stopping condition; recovery creates no monitoring assignment. With epicKey, includeProject adds only project-wide human events; otherwise it does not narrow scope. Filters consume exclusions: widening needs explicit reconciliation. Foreign/nonmatching sequences advance nextCursor beyond project high-water; never infer rewind. No database-generation identity: restore needs explicit reconciliation, not automatic recovery. 100 events is not a byte cap; continuous catch-up may never finish. Checkpoint handled progress and honestly summarize incompleteness before context limits. Baseline/replay is neither atomic snapshot nor audit; deduplicate overlapping observations. Use targeted list_tasks/get_task while preserving required questions/comments/reports/reviews/linked evidence and inspected validators; resource duplication only for missing content. list_changes_since remains for deliberate audit. No execution grant or OS-session launch follows from bootstrap/waiting.";

pub(crate) fn epic_markdown(tree: &EpicTree) -> String {
    let e = &tree.epic;
    let mut md = format!(
        "# {} · {}\n\nStatus: {}\nWorker model: {}\nParticipation: {}\nReviewer: {}\n\n",
        e.key,
        e.title,
        e.status,
        e.worker_model.as_deref().unwrap_or("Not chosen"),
        e.participation,
        e.reviewer
    );
    for (heading, text) in [
        ("Goal and audience", &e.goal_md),
        ("Done when", &e.done_when_md),
        ("Not included", &e.not_included_md),
        ("Decided", &e.decided_md),
        ("Open questions", &e.open_questions_md),
    ] {
        md.push_str(&format!("## {heading}\n\n{text}\n\n"));
    }
    md.push_str("## Work tree\n\n");
    for story in &tree.stories {
        md.push_str(&format!(
            "### {} · {} · {}\n\n",
            story.story.key, story.story.title, story.story.status
        ));
        for task in &story.tasks {
            md.push_str(&format!(
                "- {} · {} · {} · brief {}{}{}\n",
                task.task.key,
                task.task.title,
                task.task.status,
                if task.readiness.ready {
                    "complete"
                } else {
                    "incomplete"
                },
                if task.task.changes_requested {
                    " · Changes requested"
                } else {
                    ""
                },
                if task.task.needs_info {
                    " · Needs info"
                } else {
                    ""
                }
            ));
        }
    }
    md.push_str("\n## Inbox\n\n");
    for q in &tree.open_questions {
        md.push_str(&format!("- {} · {}\n", q.id, q.title));
    }
    md.push_str("\n## Journal\n\n");
    md.push_str(OBSERVATION_GUIDANCE);
    md.push_str("\n\n");
    for event in &tree.journal {
        md.push_str(&format!("- {} · {}\n", event.created_at, event.sentence));
    }
    md
}

pub(crate) fn story_markdown(tree: &StoryTree) -> String {
    let s = &tree.story;
    let mut md = format!("# {} · {}\n\nStatus: {}\n\n", s.key, s.title, s.status);
    for (heading, text) in [
        ("Outcome", &s.outcome_md),
        ("Whose material is the basis", &s.basis_md),
        ("What already works", &s.preserve_md),
        ("Scale of change", &s.scale_md),
        ("How it could fail", &s.rejection_risks_md),
        ("Open decisions", &s.open_decisions_md),
    ] {
        md.push_str(&format!("## {heading}\n\n{text}\n\n"));
    }
    md.push_str("## Acceptance\n\n");
    for a in &s.acceptance {
        md.push_str(&format!(
            "- {} · {} · {}\n  Check: {}\n",
            a.id,
            if a.mandatory { "Mandatory" } else { "Optional" },
            a.criterion,
            a.check
        ));
    }
    md.push_str("\n## Tasks\n\n");
    for task in &tree.tasks {
        md.push_str(&format!(
            "- {} · {} · {}\n",
            task.task.key, task.task.title, task.task.status
        ));
    }
    md
}

pub(crate) fn task_markdown(t: &TaskDetail) -> String {
    let mut md = format!(
        "# {} · {}\n\nStory: {} · {}\nEpic: {} · {}\nStatus: {}\n\n",
        t.task.key,
        t.task.title,
        t.story.key,
        t.story.title,
        t.epic.key,
        t.epic.title,
        t.task.status
    );
    md.push_str(&format!(
        "Claim generation (opaque): `{}`\nTask version (opaque): `{}`\n",
        t.task.claim_generation, t.task.updated_at
    ));
    if let Some(revision) = &t.review_context_revision {
        let report = t
            .reports
            .iter()
            .find(|r| r.round == t.task.review_round)
            .map(|r| r.id.as_str())
            .unwrap_or("");
        md.push_str(&format!(
            "Current report ID: `{report}`\nReview context revision (opaque): `{revision}`\n"
        ));
    }
    md.push_str("\nCapture these validators before deciding a mutation. Do not silently refresh them to replay stale work.\n\n");
    for (name, text) in [
        ("Goal", &t.brief.goal_md),
        ("Context", &t.brief.context_md),
        ("Where", &t.brief.where_md),
    ] {
        md.push_str(&format!("## {name}\n\n{text}\n\n"));
    }
    md.push_str("## Changes\n\n");
    for change in &t.brief.changes {
        md.push_str(&format!("### {}\n\nNow: {}\n\nCause: {}\n\nRequired: {}\n\nWhere: {}\n\nFollow: {}\n\nKeep: {}\n\n",change.title,change.now,change.cause,change.required,change.r#where,change.follow,change.keep));
    }
    md.push_str("## Tests\n\n");
    for (i, test) in t.brief.tests.iter().enumerate() {
        md.push_str(&format!(
            "{}. Setup: {}\n   Expected: {}\n\n",
            i + 1,
            test.setup,
            test.expected
        ));
    }
    md.push_str(&format!("## Boundaries\n\n{}\n\n## Result\n\n{}\n\n## User quotes\n\n{}\n\n## Notes\n\n{}\n\n## Comments\n\n",t.brief.boundaries_md,t.brief.result_md,t.brief.user_quotes_md,t.task.description_md));
    for c in &t.comments {
        md.push_str(&format!("- {} · {}\n", c.created_at, c.body_md));
    }
    if !t.ancestor_questions.is_empty() {
        md.push_str("\n## Open questions above this task\n\n");
        for q in &t.ancestor_questions {
            md.push_str(&format!("- {}: {}\n", q.scope_type, q.title));
        }
    }
    md
}
pub(crate) fn prompt(name: &str) -> Option<String> {
    let mut text: String = match name{
    "plan_epic"=>"Read the connected tool schemas first. Optional agent-playbook procedures (requirements-interview.md, task-brief-and-acceptance.md and brief-writing.md) are workflow guidance, not a protocol guarantee; older examples may omit required validators. If they are unavailable, use these instructions and the live schemas without installing anything automatically. Interview the human in rounds using ask_user and wait_for_answer; a recommendation is not permission for an irreversible action. Play back Goal, Done when, Not included and Decided and obtain confirmation. Inspect the requested existing epic, its stories/tasks, questions, comments and linked sources before proposing changes; reconcile human edits without duplicating existing work. Create a draft epic only when a new one is intended. Use become_brain only for an unassigned epic after explicit appointment, never to replace another brain. Record the agreed participation/reviewer/workerModel, create or refine stories with intent cards and mandatory acceptance, and tasks with complete Goal, Context, Where, Changes, Tests, Boundaries and Result briefs. Fill an EMPTY task description with a concise human-readable outcome in the language of the original human notes or latest human request; if unclear, ask which language. Preserve existing human descriptions and wishes without automatic translation or rewriting; use the story outcome for its human description and the structured brief for implementation detail. Activate complete epics/stories, check_ready and mark_ready for actionable tasks using expectedClaimGeneration and expectedUpdatedAt from get_task. Use those captured validators for every task edit/brief edit/status/archive intent; on conflict reread and reconcile instead of replaying, then set_status scoped to the epic. Planning and Ready do not authorize execution. If the human asks to start, request_execution for that exact story or epic and wait for typed Inbox approval; do not treat generic question answers or chat text as a grant. Planning stays planning even when a scope is already running. Only a later, separately requested execution phase may coordinate workers within the human-started scope without requesting approval for each worker. Keep unresolved decisions visible as questions. Never invent the user's worker model.".into(),
    "work_on_next_task"=>"Read the connected tool schemas first. Optional agent-playbook procedures such as brief-writing.md are workflow guidance, not a protocol guarantee; older examples may omit required validators. If unavailable, use these instructions and the live schemas without installing anything automatically. Prefer changesRequested tasks already assigned to you; otherwise choose the highest-priority unassigned ready task. Read get_task, including the story acceptance and epic scope/model. Call get_execution for the story and confirm effectiveState=running before claim_task. Supply expectedClaimGeneration and expectedUpdatedAt from the task you inspected; retain the returned claimGeneration for this work attempt. If paused, wait for the human to start the scope; do not work or request a grant as a worker. Work within the brief; ask_user and wait_for_answer if a material decision is missing, and publish set_status. submit_report with expectedClaimGeneration from that claim, summaryMd, changedFiles, named tests (command, expected, actual, PASS/FAIL/NOT_RUN), deviationsMd and notVerifiedMd. A stale_claim/conflict means the context changed: reread and reconcile, never fetch a new token merely to replay old evidence. Task edits, brief edits, moves, Ready and archive require both expectedClaimGeneration and expectedUpdatedAt from the context you decided against. Do not mark your work done or review your own task; the brain/human reviews it.".into(),
    "review_task"=>"Read the connected tool schemas first. Optional agent-playbook procedures such as task-brief-and-acceptance.md are workflow guidance, not a protocol guarantee; older examples may omit required validators. If unavailable, use these instructions and the live schemas without installing anything automatically. As the appointed brain, read get_task and its current report. Compare actual results with the brief's tests, the story's mandatory acceptance and the epic's goal/done-when/not-included. Check preserved behavior and distinguish observed evidence from assumptions. Retain the exact report ID and TaskDetail.reviewContextRevision while assessing it. Call review_task with expectedReportId and expectedReviewContextRevision from that inspected snapshot, never an auto-refreshed latest token; on conflict inspect the new context and reconsider. Use accept only when mandatory evidence is sufficient; otherwise use changes_requested, explain corrections and name failed report tests. Never review your own worker submission. Publish set_status and follow the shared observation policy below for human corrections and recovery.".into(),
    _=>return None,
};
    text.push_str("\n\n");
    text.push_str(OBSERVATION_GUIDANCE);
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_use_live_contracts_and_optional_guidance_without_implicit_setup() {
        for name in ["plan_epic", "work_on_next_task", "review_task"] {
            let text = prompt(name).unwrap();
            assert!(text.starts_with("Read the connected tool schemas first."));
            assert!(text.contains("Optional agent-playbook"));
            assert!(text.contains("without installing anything automatically"));
            assert!(text.contains("intended exact project ID"));
            assert!(text.contains("matching names/prefixes are insufficient"));
            assert!(!text.contains("1.1.0"));
            if name == "plan_epic" {
                assert!(text.contains("Inspect the requested existing epic"));
                assert!(text.contains("Create a draft epic only when a new one is intended"));
                assert!(text.contains("never to replace another brain"));
                assert!(text.contains("EMPTY task description"));
                assert!(
                    text.contains("language of the original human notes or latest human request")
                );
                assert!(text.contains("if unclear, ask which language"));
                assert!(text.contains("Preserve existing human descriptions and wishes"));
                assert!(text.contains("structured brief for implementation detail"));
                assert!(text.contains("later, separately requested execution phase"));
            }
        }
    }

    #[test]
    fn worker_resource_playbook_headings_snapshot() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../apps/desktop/src/lib/demo-fixture.json"
        ))
        .unwrap();
        let mut task: TaskDetail = serde_json::from_value(
            fixture["details"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["key"] == "JB-9")
                .unwrap()
                .clone(),
        )
        .unwrap();
        assert!(!task.ancestor_questions.is_empty());
        let ancestor = &task.ancestor_questions[0];
        let contextual_markdown = task_markdown(&task);
        assert!(contextual_markdown.contains("## Open questions above this task"));
        assert!(contextual_markdown.contains(&ancestor.title));
        task.task.key = "JB-9".into();
        task.task.title = "Lantern cue".into();
        task.task.status = "review".into();
        task.task.claim_generation = "task-id:3".into();
        task.task.updated_at = "task-version".into();
        task.task.description_md = "Keep notes here.".into();
        task.story.key = "JB-S1".into();
        task.story.title = "Safe bridge".into();
        task.epic.key = "JB-E1".into();
        task.epic.title = "Lantern levels".into();
        task.comments.clear();
        task.ancestor_questions.clear();
        task.brief = TaskBrief {
            goal_md: "Light the next safe tile.".into(),
            context_md: "The bridge exists.".into(),
            where_md: "game/lantern.gd".into(),
            changes: vec![Change {
                title: "Cue".into(),
                now: "No cue".into(),
                cause: "Tiles look alike".into(),
                required: "Highlight one tile".into(),
                r#where: "Bridge scene".into(),
                follow: "Paper palette".into(),
                keep: "Keyboard controls".into(),
            }],
            tests: vec![BriefTest {
                setup: "Hold the lantern".into(),
                expected: "One tile lights up".into(),
            }],
            boundaries_md: "No new engine.".into(),
            result_md: "Report tests and changed files.".into(),
            user_quotes_md: "".into(),
        };
        assert_eq!(
            task_markdown(&task),
            include_str!("../tests/fixtures/task-brief.md")
        );
    }
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentBriefEdit {
    key: String,
    #[serde(flatten)]
    patch: BriefPatch,
    expected_claim_generation: String,
    expected_updated_at: String,
}
#[derive(serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentReady {
    key: String,
    override_reason: Option<String>,
    expected_claim_generation: String,
    expected_updated_at: String,
}
impl AgentBriefEdit {
    fn context(&self) -> TaskWriteContext {
        TaskWriteContext {
            expected_claim_generation: self.expected_claim_generation.clone(),
            expected_updated_at: self.expected_updated_at.clone(),
        }
    }
}
impl AgentReady {
    fn context(&self) -> TaskWriteContext {
        TaskWriteContext {
            expected_claim_generation: self.expected_claim_generation.clone(),
            expected_updated_at: self.expected_updated_at.clone(),
        }
    }
}

#[cfg(test)]
mod observation_guidance_tests {
    use super::*;

    #[test]
    fn prompts_preserve_bootstrap_recovery_and_evidence_boundaries() {
        for name in ["plan_epic", "work_on_next_task", "review_task"] {
            let text = prompt(name).unwrap();
            // Assert operational boundaries, not a verbatim long prose snapshot.
            for required in [
                "intended exact project ID",
                "BEFORE baseline reads",
                "finish the baseline before checkpointing",
                "never replace/reset unprocessed checkpoints",
                "project/epic/filter identity",
                "excludeSelf=false",
                "timeoutSeconds=1",
                "timeoutSeconds=60 only if the assigned role/request",
                "Finish/report at the assigned stopping condition",
                "recovery creates no monitoring assignment",
                "before checkpointing nextCursor",
                "until timedOut=true, not a short page",
                "project-wide human events",
                "widening needs explicit reconciliation",
                "beyond project high-water; never infer rewind",
                "not automatic recovery",
                "Missing differs from 0",
                "not a byte cap",
                "catch-up may never finish",
                "summarize incompleteness",
                "neither atomic snapshot nor audit",
                "questions/comments/reports/reviews/linked evidence",
                "inspected validators",
                "established language",
                "No execution grant or OS-session launch",
            ] {
                assert!(text.contains(required), "{name} missing {required}");
            }
            assert!(!text.contains("Recover with list_changes_since at turn start"));
            assert!(!text.contains("Read get_task and jam://task/{key}"));
        }
        assert!(
            prompt("review_task")
                .unwrap()
                .contains("expectedReviewContextRevision")
        );
        assert!(
            prompt("work_on_next_task")
                .unwrap()
                .contains("effectiveState=running")
        );
    }
}
