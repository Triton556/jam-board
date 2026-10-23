//! Explicit test-only human grants for scenarios whose subject is not authorization.
#![allow(dead_code)]
use jam_core::*;
pub fn start_story(store: &Store, human: &str, id: &str) {
    let scope = ExecutionScope {
        kind: ExecutionScopeType::Story,
        id: id.into(),
    };
    let expected_revision = store.get_execution(&scope).unwrap().revision;
    store
        .set_execution(
            human,
            SetExecution {
                scope,
                action: ExecutionAction::Start,
                expected_revision,
            },
        )
        .unwrap();
}
pub fn start_epic(store: &Store, human: &str, id: &str) {
    let scope = ExecutionScope {
        kind: ExecutionScopeType::Epic,
        id: id.into(),
    };
    let expected_revision = store.get_execution(&scope).unwrap().revision;
    store
        .set_execution(
            human,
            SetExecution {
                scope,
                action: ExecutionAction::Start,
                expected_revision,
            },
        )
        .unwrap();
}

/// Legacy scenarios unrelated to freshness explicitly observe fresh context before
/// each synchronous call. Claim-fencing tests use the real Store APIs instead.
/// Never use this convenience in production or retry a failed payload this way.
pub trait FreshContext {
    fn context_fresh(&self, key: &str) -> TaskWriteContext;
    fn claim_task_fresh(&self, actor: &str, key: &str) -> Result<TaskDetail>;
    fn release_task_fresh(
        &self,
        actor: &str,
        key: &str,
        target: Option<&str>,
    ) -> Result<TaskSummary>;
    fn move_task_fresh(
        &self,
        actor: &str,
        key: &str,
        target: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<TaskSummary>;
    fn move_task_with_override_fresh(
        &self,
        actor: &str,
        key: &str,
        target: &str,
        before: Option<&str>,
        after: Option<&str>,
        reason: Option<&str>,
    ) -> Result<TaskSummary>;
    fn archive_task_fresh(
        &self,
        actor: &str,
        key: &str,
        reason: Option<&str>,
    ) -> Result<TaskSummary>;
    fn mark_ready_fresh(&self, actor: &str, key: &str, reason: Option<&str>)
    -> Result<TaskSummary>;
    fn update_task_brief_fresh(
        &self,
        actor: &str,
        key: &str,
        patch: BriefPatch,
    ) -> Result<TaskDetail>;
    fn update_task_fresh(&self, actor: &str, input: UpdateTask) -> Result<TaskDetail>;
    fn submit_report_fresh(&self, actor: &str, input: SubmitReport) -> Result<Report>;
    fn review_task_fresh(&self, actor: &str, input: ReviewTask) -> Result<Review>;
}
impl FreshContext for Store {
    fn context_fresh(&self, key: &str) -> TaskWriteContext {
        let task = self.get_task(key).map(|d| d.task).unwrap_or_default();
        TaskWriteContext {
            expected_claim_generation: task.claim_generation,
            expected_updated_at: task.updated_at,
        }
    }
    fn claim_task_fresh(&self, actor: &str, key: &str) -> Result<TaskDetail> {
        self.claim_task(actor, key, Some(&self.context_fresh(key)))
    }
    fn release_task_fresh(
        &self,
        actor: &str,
        key: &str,
        target: Option<&str>,
    ) -> Result<TaskSummary> {
        self.release_task(
            actor,
            key,
            target,
            Some(&self.context_fresh(key).expected_claim_generation),
        )
    }
    fn move_task_fresh(
        &self,
        actor: &str,
        key: &str,
        target: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<TaskSummary> {
        self.move_task(
            actor,
            key,
            target,
            before,
            after,
            Some(&self.context_fresh(key)),
        )
    }
    fn move_task_with_override_fresh(
        &self,
        actor: &str,
        key: &str,
        target: &str,
        before: Option<&str>,
        after: Option<&str>,
        reason: Option<&str>,
    ) -> Result<TaskSummary> {
        self.move_task_with_override(
            actor,
            key,
            target,
            before,
            after,
            reason,
            Some(&self.context_fresh(key)),
        )
    }
    fn archive_task_fresh(
        &self,
        actor: &str,
        key: &str,
        reason: Option<&str>,
    ) -> Result<TaskSummary> {
        self.archive_task(actor, key, reason, Some(&self.context_fresh(key)))
    }
    fn mark_ready_fresh(
        &self,
        actor: &str,
        key: &str,
        reason: Option<&str>,
    ) -> Result<TaskSummary> {
        self.mark_ready(actor, key, reason, Some(&self.context_fresh(key)))
    }
    fn update_task_brief_fresh(
        &self,
        actor: &str,
        key: &str,
        patch: BriefPatch,
    ) -> Result<TaskDetail> {
        self.update_task_brief(actor, key, patch, Some(&self.context_fresh(key)))
    }
    fn update_task_fresh(&self, actor: &str, mut input: UpdateTask) -> Result<TaskDetail> {
        let context = self.context_fresh(&input.key);
        input.expected_claim_generation = context.expected_claim_generation;
        input.expected_updated_at = context.expected_updated_at;
        self.update_task(actor, input)
    }
    fn submit_report_fresh(&self, actor: &str, mut input: SubmitReport) -> Result<Report> {
        input.expected_claim_generation = self.context_fresh(&input.key).expected_claim_generation;
        self.submit_report(actor, input)
    }
    fn review_task_fresh(&self, actor: &str, mut input: ReviewTask) -> Result<Review> {
        if let Ok(detail) = self.get_task(&input.key) {
            input.expected_report_id = detail
                .reports
                .iter()
                .find(|r| r.round == detail.task.review_round)
                .map(|r| r.id.clone())
                .unwrap_or_default();
            input.expected_review_context_revision =
                detail.review_context_revision.unwrap_or_default();
        }
        self.review_task(actor, input)
    }
}
