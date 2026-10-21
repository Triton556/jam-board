use crate::planning::*;
use crate::service::{member, task, touch};
use crate::*;
use rusqlite::{Connection, params};
use serde_json::json;
use std::time::{Duration, Instant};

pub(crate) fn brief(c: &Connection, key: &str) -> Result<TaskBrief> {
    let value=c.query_row("SELECT goal_md,context_md,where_md,changes_json,tests_json,boundaries_md,result_md,user_quotes_md FROM tasks WHERE key=?",[key],row_value)?;
    Ok(serde_json::from_value(value)?)
}
pub(crate) fn validate_brief(b: &TaskBrief) -> Result<()> {
    for change in &b.changes {
        if change.title.trim().is_empty() || change.required.trim().is_empty() {
            return Err(invalid(
                "changes",
                "Each change needs title and required text",
            ));
        }
    }
    for test in &b.tests {
        if test.setup.trim().is_empty() || test.expected.trim().is_empty() {
            return Err(invalid(
                "tests",
                "Each test needs setup and expected result",
            ));
        }
    }
    Ok(())
}
pub(crate) fn readiness(c: &Connection, key: &str) -> Result<Readiness> {
    let t = task(c, key)?;
    readiness_for(c, &t)
}
pub(crate) fn readiness_for(c: &Connection, t: &TaskSummary) -> Result<Readiness> {
    let b = brief(c, &t.key)?;
    let s = story(c, &t.story_id)?;
    let tests = [
        ("goal", "Goal is empty", b.goal_md.trim().is_empty()),
        ("where", "Where is empty", b.where_md.trim().is_empty()),
        (
            "change",
            "At least one change with a Required text",
            !b.changes
                .iter()
                .any(|x| !x.title.trim().is_empty() && !x.required.trim().is_empty()),
        ),
        (
            "test",
            "At least one test with setup and expected result",
            !b.tests
                .iter()
                .any(|x| !x.setup.trim().is_empty() && !x.expected.trim().is_empty()),
        ),
        (
            "result",
            "Result (report format) is empty",
            b.result_md.trim().is_empty(),
        ),
        (
            "story_active",
            "The story is still draft",
            s.status != "active",
        ),
    ];
    let missing = tests
        .into_iter()
        .filter(|(_, _, missing)| *missing)
        .map(|(code, message, _)| ReadinessIssue {
            code: code.into(),
            message: message.into(),
        })
        .collect::<Vec<_>>();
    Ok(Readiness {
        ready: missing.is_empty(),
        missing,
    })
}
pub(crate) fn not_ready(r: &Readiness) -> Error {
    Error::NotReady(
        r.missing
            .iter()
            .map(|i| format!("{}: {}", i.code, i.message))
            .collect::<Vec<_>>()
            .join("; "),
    )
}
pub(crate) fn transition(
    c: &Connection,
    actor: &str,
    t: &TaskSummary,
    target: &str,
    reason: Option<&str>,
) -> Result<bool> {
    let e = task_epic(c, t)?;
    if !privileged(c, actor, &e)? {
        if t.assignee_id
            .as_deref()
            .is_some_and(|holder| holder != actor)
        {
            return Err(Error::Forbidden(
                "Only the holder may move this task".into(),
            ));
        }
        if target == "in_progress"
            && (t.status != "in_progress" || t.assignee_id.as_deref() != Some(actor))
        {
            return Err(Error::Forbidden(
                "Claim a Ready task with claim_task before working".into(),
            ));
        }
        if target == "review" && (t.status != "review" || t.assignee_id.as_deref() != Some(actor)) {
            return Err(Error::Forbidden(
                "Use submit_report to send work for independent review".into(),
            ));
        }
    }
    if target == "in_progress" && t.status != "in_progress" {
        crate::execution::require_execution(c, &t.story_id)?;
    }
    let mut overridden = false;
    if target == "done" {
        require_privileged(c, actor, &e)?;
    }
    if target == "ready" && target != t.status {
        let r = readiness(c, &t.key)?;
        if !r.ready {
            if reason.is_none() {
                return Err(not_ready(&r));
            }
            require_privileged(c, actor, &e)?;
            override_reason(reason)?;
            overridden = true;
        }
    }
    if target != t.status
        && (t.status == "done" || ["backlog", "ready", "in_progress"].contains(&target))
    {
        // Submitted evidence is immutable. Any return to work allocates its
        // successor once, in the same transaction as the validated move.
        c.execute(
            "UPDATE tasks SET review_round=review_round+1,changes_requested=0 WHERE id=? AND EXISTS(SELECT 1 FROM reports WHERE task_id=? AND round=?)",
            params![t.id, t.id, t.review_round],
        )?;
    }
    Ok(overridden)
}
pub(crate) fn needs_info(c: &Connection, task_id: &str) -> Result<bool> {
    Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM questions WHERE status='open' AND scope_type='task' AND scope_id=?1)",params![task_id],|r|r.get(0))?)
}
pub(crate) fn scope(c: &Connection, s: &Scope) -> Result<(Scope, Option<String>, Option<String>)> {
    let j = crate::service::jam(c)?;
    let (id, jam_id, eid, tid) = match s.kind.as_str() {
        "project" => {
            if !s.id.is_empty() && s.id != j.id {
                return Err(Error::NotFound(format!("project {}", s.id)));
            }
            (j.id.clone(), j.id.clone(), None, None)
        }
        "epic" => {
            let e = epic(c, &s.id)?;
            editable_audit(&e.audit)?;
            (e.audit.id.clone(), e.audit.jam_id, Some(e.audit.id), None)
        }
        "story" => {
            let s = story(c, &s.id)?;
            editable_audit(&s.audit)?;
            (s.audit.id, s.audit.jam_id, Some(s.epic_id), None)
        }
        "task" => {
            let t = task(c, &s.id).or_else(|error| match error {
                Error::NotFound(_) => {
                    let key: String =
                        c.query_row("SELECT key FROM tasks WHERE id=?", [&s.id], |r| r.get(0))?;
                    task(c, &key)
                }
                other => Err(other),
            })?;
            if t.archived_at.is_some() {
                return Err(Error::Archived(t.key));
            }
            (t.id.clone(), t.jam_id, Some(t.epic_id), Some(t.id))
        }
        _ => return Err(invalid("scope.type", "Choose project, epic, story or task")),
    };
    if jam_id != j.id {
        return Err(invalid("scope", "Choose a scope in the active project"));
    }
    Ok((
        Scope {
            kind: s.kind.clone(),
            id,
        },
        eid,
        tid,
    ))
}
impl Store {
    pub fn check_ready(&self, key: &str) -> Result<Readiness> {
        self.read(|c| readiness(c, key))
    }
    pub fn mark_ready(&self, actor: &str, key: &str, reason: Option<&str>) -> Result<TaskSummary> {
        self.move_task_with_override(actor, key, "ready", None, None, reason)
    }
    pub fn update_task_brief(
        &self,
        actor: &str,
        key: &str,
        input: BriefPatch,
    ) -> Result<TaskDetail> {
        self.write(|c| {
            let t = crate::service::editable(c, key, actor)?;
            let patch = serde_json::to_value(input)?;
            let mut merged = serde_json::to_value(brief(c, key)?)?;
            for (k, v) in patch.as_object().unwrap() {
                merged[k] = v.clone();
            }
            validate_brief(&serde_json::from_value::<TaskBrief>(merged)?)?;
            patch_record(c, "tasks", &t.id, &patch)?;
            touch(c, &t.id, actor)?;
            v2_event(
                c,
                actor,
                Some(&t.epic_id),
                "task.brief_updated",
                Some(&t.id),
                json!({"key":key,"fields":patch.as_object().unwrap().keys().collect::<Vec<_>>()}),
            )
        })?;
        self.get_task(key)
    }
    pub fn submit_report(&self, actor: &str, input: SubmitReport) -> Result<Report> {
        self.write(|c|{
        let t=task(c,&input.key)?;member(c,actor)?;if t.assignee_id.as_deref()!=Some(actor){return Err(Error::Forbidden("Only the assignee may submit a report".into()));}
        if t.status!="in_progress"{return Err(Error::WrongStatus(format!("Expected in_progress, current status is {}",t.status)));}
        crate::m5::validate_name("summaryMd",&input.summary_md,20000)?;let mut names=std::collections::BTreeSet::new();for test in &input.tests{if test.name.trim().is_empty()||!names.insert(&test.name)||!["PASS","FAIL","NOT_RUN"].contains(&test.result.as_str()){return Err(invalid("tests","Each test needs a unique name and PASS, FAIL or NOT_RUN result"));}}
        let duplicate:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM reports WHERE task_id=? AND round=?)",params![t.id,t.review_round],|r|r.get(0))?;
        if duplicate{return Err(invalid("report",&format!("Report already submitted for round {}",t.review_round)));}
        let report=Report{id:id(),task_id:t.id.clone(),round:t.review_round,author_id:actor.into(),summary_md:input.summary_md,changed_files:input.changed_files,tests:input.tests,deviations_md:input.deviations_md.unwrap_or_default(),not_verified_md:input.not_verified_md.unwrap_or_default(),created_at:now()};insert(c,"reports",&report)?;
        c.execute("UPDATE tasks SET status='review',changes_requested=0,position=(SELECT coalesce(max(position),0)+1024 FROM tasks WHERE jam_id=? AND status='review' AND archived_at IS NULL) WHERE id=?",params![t.jam_id,t.id])?;touch(c,&t.id,actor)?;v2_event(c,actor,Some(&t.epic_id),"report.submitted",Some(&t.id),json!({"key":t.key,"round":t.review_round,"reportId":report.id}))?;Ok(report)
    })
    }
    pub fn review_task(&self, actor: &str, input: ReviewTask) -> Result<Review> {
        self.write(|c|{
        let t=task(c,&input.key)?;let e=task_epic(c,&t)?;require_privileged(c,actor,&e)?;
        if t.assignee_id.as_deref()==Some(actor){return Err(Error::Forbidden("A worker can never review its own task".into()));}
        let reports:Vec<Report>=records(c,"reports","task_id=? AND round=?",&[&t.id,&t.review_round])?;let report=reports.first().ok_or_else(||invalid("report",&format!("No report for round {}",t.review_round)))?;
        if report.author_id==actor{return Err(Error::Forbidden("A worker can never review its own report".into()));}
        if t.status!="review"{return Err(Error::WrongStatus(format!("Expected review, current status is {}",t.status)));}
        if !["accept","changes_requested"].contains(&input.verdict.as_str()){return Err(invalid("verdict","Choose accept or changes_requested"));}
        let failed=input.failed_tests.unwrap_or_default();for name in &failed{if !report.tests.iter().any(|t|t.name==*name){return Err(invalid("failedTests",&format!("Unknown report test {name}")));}}
        let review=Review{id:id(),task_id:t.id.clone(),round:t.review_round,reviewer_id:actor.into(),verdict:input.verdict.clone(),comments_md:input.comments_md,failed_tests:failed.clone(),created_at:now()};insert(c,"reviews",&review)?;
        let requested=input.verdict=="changes_requested";let target=if requested{"ready"}else{"done"};c.execute("UPDATE tasks SET status=?,changes_requested=?,review_round=review_round+?,position=(SELECT coalesce(max(position),0)+1024 FROM tasks WHERE jam_id=? AND status=? AND archived_at IS NULL) WHERE id=?",params![target,requested,i64::from(requested),t.jam_id,target,t.id])?;touch(c,&t.id,actor)?;
        v2_event(c,actor,Some(&t.epic_id),"review.recorded",Some(&t.id),json!({"key":t.key,"round":review.round,"verdict":review.verdict,"failedTests":failed,"reviewId":review.id}))?;Ok(review)
    })
    }
    pub fn ask_user(&self, actor: &str, input: AskUser) -> Result<Question> {
        self.write(|c| {
            member(c, actor)?;
            let (scope, eid, tid) = scope(c, &input.scope)?;
            crate::m5::validate_name("title", &input.title, 140)?;
            let options = input.options.unwrap_or_default();
            if options.len() > 6 || options.iter().any(|o| o.label.trim().is_empty()) {
                return Err(invalid("options", "Use zero to six named options"));
            }
            if input.recommended_index.is_some_and(|i| i >= options.len()) {
                return Err(invalid("recommendedIndex", "Choose an existing option"));
            }
            let allow = input.allow_free_text.unwrap_or(true);
            if options.is_empty() && !allow {
                return Err(invalid(
                    "allowFreeText",
                    "A question must allow at least one answer",
                ));
            }
            let q = Question {
                id: id(),
                jam_id: crate::service::jam(c)?.id,
                epic_id: eid.clone(),
                scope_type: scope.kind,
                scope_id: scope.id,
                asked_by: actor.into(),
                round_label: input.round_label,
                title: input.title,
                body_md: input.body_md.unwrap_or_default(),
                options,
                recommended_index: input.recommended_index,
                allow_free_text: allow,
                status: "open".into(),
                answer_index: None,
                answer_text: None,
                answered_by: None,
                answered_at: None,
                created_at: now(),
            };
            insert(c, "questions", &q)?;
            v2_event(
                c,
                actor,
                eid.as_deref(),
                "question.asked",
                tid.as_deref(),
                json!({"questionId":q.id,"title":q.title,"roundLabel":q.round_label}),
            )?;
            Ok(q)
        })
    }
    pub fn answer_question(&self, actor: &str, input: AnswerQuestion) -> Result<Question> {
        self.write(|c|{
        if member(c,actor)?.kind!="human"{return Err(Error::Forbidden("Only humans may answer questions".into()));}
let q:Question=fetch(c,"questions","id",&input.id)?;if q.status!="open"{return Err(invalid("status","This question is no longer open"));}
        if input.answer_index.is_some_and(|i|i>=q.options.len()){return Err(invalid("answerIndex","Choose an existing option"));}
let text=input.answer_text.as_deref().map(str::trim).filter(|s|!s.is_empty());if text.is_some()&&!q.allow_free_text{return Err(invalid("answerText","Free text is not allowed"));}
if input.answer_index.is_none()&&text.is_none(){return Err(invalid("answer","Choose an option or enter an answer"));}
        c.execute("UPDATE questions SET status='answered',answer_index=?,answer_text=?,answered_by=?,answered_at=? WHERE id=?",params![input.answer_index.map(|n|n as i64),text,actor,now(),q.id])?;
        v2_event(c,actor,q.epic_id.as_deref(),"question.answered",if q.scope_type=="task"{Some(q.scope_id.as_str())}else{None},json!({"questionId":q.id}))?;fetch(c,"questions","id",&q.id)
    })
    }
    pub fn withdraw_question(&self, actor: &str, id: &str) -> Result<Question> {
        self.write(|c| {
            let q: Question = fetch(c, "questions", "id", id)?;
            if q.asked_by != actor && member(c, actor)?.kind != "human" {
                return Err(Error::Forbidden(
                    "Only the asker or a human may withdraw this question".into(),
                ));
            }
            if q.status != "open" {
                return Err(invalid("status", "This question is no longer open"));
            }
            c.execute("UPDATE questions SET status='withdrawn' WHERE id=?", [id])?;
            v2_event(
                c,
                actor,
                q.epic_id.as_deref(),
                "question.withdrawn",
                if q.scope_type == "task" {
                    Some(&q.scope_id)
                } else {
                    None
                },
                json!({"questionId":id}),
            )?;
            fetch(c, "questions", "id", id)
        })
    }
    pub fn list_questions(
        &self,
        status: Option<&str>,
        scope_filter: Option<&Scope>,
    ) -> Result<Vec<Question>> {
        if status.is_some_and(|s| !["open", "answered", "withdrawn"].contains(&s)) {
            return Err(invalid("status", "Choose open, answered or withdrawn"));
        }
        self.read(|c| {
            let j = crate::service::jam(c)?;
            let scope_filter = scope_filter.map(|s| scope(c, s).map(|v| v.0)).transpose()?;
            let mut rows: Vec<Question> =
                records(c, "questions", "jam_id=? ORDER BY created_at,id", &[&j.id])?;
            rows.retain(|q| {
                status.is_none_or(|s| q.status == s)
                    && scope_filter
                        .as_ref()
                        .is_none_or(|s| q.scope_id == s.id && q.scope_type == s.kind)
            });
            Ok(rows)
        })
    }
    /// Cross-process waits sleep on the existing activity/data-version feed; they never hold a writer.
    pub fn wait_for_answer(&self, ids: &[String], seconds: u64) -> Result<AnswerWait> {
        if seconds > 60 || ids.is_empty() || ids.len() > 100 {
            return Err(invalid(
                "wait",
                "Supply 1–100 question IDs and a timeout of 0–60 seconds",
            ));
        }
        let mut feed = ChangeFeed::open(&self.path, self.latest_seq()?)?;
        let read = || {
            self.read(|c| {
                let mut result = AnswerWait::default();
                for id in ids {
                    let q: Question = fetch(c, "questions", "id", id)?;
                    if q.status == "answered" {
                        result.answered.push(q);
                    } else if q.status == "open" {
                        result.pending.push(q);
                    }
                }
                Ok(result)
            })
        };
        let deadline = Instant::now() + Duration::from_secs(seconds);
        let mut result = read()?;
        while result.answered.is_empty() && Instant::now() < deadline {
            if feed.wait_until_changed(deadline)? && !feed.poll()?.is_empty() {
                result = read()?;
            }
        }
        Ok(result)
    }
    pub fn set_status(&self, actor: &str, text: &str, target: Option<Scope>) -> Result<Member> {
        let text = text.trim();
        let target = if text.is_empty() { None } else { target };
        if text.chars().count() > 120 {
            return Err(invalid("text", "Use at most 120 characters"));
        }
        self.write(|c|{member(c,actor)?;let resolved=target.as_ref().map(|s|scope(c,s)).transpose()?;let normalized=resolved.as_ref().map(|(s,_,_)|serde_json::to_string(s)).transpose()?;let stamp=now();let project=crate::service::jam(c)?.id;crate::projects::join_member(c,&project,actor)?;c.execute("UPDATE project_members SET status_text=?,status_scope_json=?,status_at=?,last_seen_at=? WHERE jam_id=? AND member_id=?",params![text,normalized,stamp,stamp,project,actor])?;v2_event(c,actor,resolved.as_ref().and_then(|x|x.1.as_deref()),"agent.status",resolved.as_ref().and_then(|x|x.2.as_deref()),json!({"text":text}))?;member(c,actor)})
    }
}
