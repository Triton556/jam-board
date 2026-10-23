//! Human-authorized execution is separate from planning readiness.
use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionScopeType {
    Epic,
    Story,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExecutionScope {
    #[serde(rename = "type")]
    pub kind: ExecutionScopeType,
    pub id: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionOwnState {
    Inherit,
    Running,
    Paused,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionEffectiveState {
    Running,
    Paused,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionSource {
    Scope,
    Epic,
    None,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionAction {
    Start,
    Pause,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionRequestStatus {
    Pending,
    Approved,
    Declined,
    Superseded,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionDecision {
    Approve,
    Decline,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionState {
    pub project_id: String,
    pub scope: ExecutionScope,
    pub scope_key: String,
    pub scope_title: String,
    pub own_state: ExecutionOwnState,
    pub effective_state: ExecutionEffectiveState,
    pub source: ExecutionSource,
    pub revision: String,
    pub can_start: bool,
    pub blocked_reason: Option<String>,
    pub in_progress_count: i64,
    pub ready_count: i64,
    pub running_story_count: i64,
    pub changed_by: Option<String>,
    pub changed_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionScopeInput {
    pub scope: ExecutionScope,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetExecution {
    pub scope: ExecutionScope,
    pub action: ExecutionAction,
    pub expected_revision: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestExecution {
    pub scope: ExecutionScope,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveExecutionRequest {
    pub id: String,
    pub decision: ExecutionDecision,
    pub expected_revision: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionRequestListInput {
    pub status: Option<ExecutionRequestStatus>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub id: String,
    pub project_id: String,
    pub scope: ExecutionScope,
    pub scope_key: String,
    pub scope_title: String,
    pub requested_by: String,
    pub reason: String,
    pub status: ExecutionRequestStatus,
    pub revision: String,
    pub created_at: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
}

fn kind_text(kind: ExecutionScopeType) -> &'static str {
    match kind {
        ExecutionScopeType::Epic => "epic",
        ExecutionScopeType::Story => "story",
    }
}
fn state_text(state: ExecutionOwnState) -> &'static str {
    match state {
        ExecutionOwnState::Inherit => "inherit",
        ExecutionOwnState::Running => "running",
        ExecutionOwnState::Paused => "paused",
    }
}
fn request_status_text(status: ExecutionRequestStatus) -> &'static str {
    match status {
        ExecutionRequestStatus::Pending => "pending",
        ExecutionRequestStatus::Approved => "approved",
        ExecutionRequestStatus::Declined => "declined",
        ExecutionRequestStatus::Superseded => "superseded",
    }
}
struct Target {
    epic: Epic,
    story: Option<Story>,
}
impl Target {
    fn scope(&self) -> ExecutionScope {
        self.story
            .as_ref()
            .map(|s| ExecutionScope {
                kind: ExecutionScopeType::Story,
                id: s.audit.id.clone(),
            })
            .unwrap_or_else(|| ExecutionScope {
                kind: ExecutionScopeType::Epic,
                id: self.epic.audit.id.clone(),
            })
    }
    fn key(&self) -> &str {
        self.story
            .as_ref()
            .map(|s| s.key.as_str())
            .unwrap_or(&self.epic.key)
    }
    fn title(&self) -> &str {
        self.story
            .as_ref()
            .map(|s| s.title.as_str())
            .unwrap_or(&self.epic.title)
    }
    fn blocked(&self) -> Option<String> {
        if self.epic.audit.archived_at.is_some()
            || matches!(self.epic.status.as_str(), "done" | "archived")
        {
            return Some(format!(
                "Epic {} is closed. Reopen it, then explicitly start work again.",
                self.epic.key
            ));
        }
        if let Some(s) = &self.story
            && (s.audit.archived_at.is_some() || matches!(s.status.as_str(), "done" | "archived"))
        {
            return Some(format!(
                "Story {} is closed. Reopen it, then explicitly start work again.",
                s.key
            ));
        }
        None
    }
}
fn target(c: &Connection, scope: &ExecutionScope) -> Result<Target> {
    match scope.kind {
        ExecutionScopeType::Epic => Ok(Target {
            epic: crate::planning::epic(c, &scope.id)?,
            story: None,
        }),
        ExecutionScopeType::Story => {
            let story = crate::planning::story(c, &scope.id)?;
            Ok(Target {
                epic: crate::planning::epic(c, &story.epic_id)?,
                story: Some(story),
            })
        }
    }
}
#[derive(Default)]
struct StoredState {
    state: Option<ExecutionOwnState>,
    revision: i64,
    actor: Option<String>,
    at: Option<String>,
}
fn stored(c: &Connection, scope: &ExecutionScope) -> Result<StoredState> {
    let row=c.query_row("SELECT own_state,revision,changed_by,changed_at FROM execution_states WHERE scope_type=? AND scope_id=?",params![kind_text(scope.kind),scope.id],|r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    row.map(|(value, revision, actor, at)| {
        Ok(StoredState {
            state: Some(serde_json::from_value(serde_json::json!(value))?),
            revision,
            actor,
            at,
        })
    })
    .unwrap_or_else(|| Ok(StoredState::default()))
}
fn state(c: &Connection, t: &Target) -> Result<ExecutionState> {
    let scope = t.scope();
    let own = stored(c, &scope)?;
    let own_state = own.state.unwrap_or(if t.story.is_some() {
        ExecutionOwnState::Inherit
    } else {
        ExecutionOwnState::Paused
    });
    let parent = if t.story.is_some() {
        stored(
            c,
            &ExecutionScope {
                kind: ExecutionScopeType::Epic,
                id: t.epic.audit.id.clone(),
            },
        )?
    } else {
        StoredState::default()
    };
    let inherited =
        own_state == ExecutionOwnState::Inherit && parent.state == Some(ExecutionOwnState::Running);
    let blocked = t.blocked();
    let running = blocked.is_none() && (own_state == ExecutionOwnState::Running || inherited);
    let revision = if t.story.is_some() {
        format!("{}:{}", parent.revision, own.revision)
    } else {
        let children:i64=c.query_row("SELECT coalesce(sum(x.revision),0) FROM execution_states x JOIN stories s ON s.id=x.scope_id WHERE x.scope_type='story' AND s.epic_id=?",[&t.epic.audit.id],|r|r.get(0))?;
        format!("{}:{}", own.revision, children)
    };
    let (in_progress_count,ready_count)=c.query_row("SELECT coalesce(sum(t.status='in_progress'),0),coalesce(sum(t.status='ready' AND t.archived_at IS NULL),0) FROM tasks t JOIN stories s ON s.id=t.story_id WHERE s.epic_id=? AND (?2 IS NULL OR s.id=?2)",params![t.epic.audit.id,t.story.as_ref().map(|s|&s.audit.id)],|r|Ok((r.get(0)?,r.get(1)?)))?;
    let running_story_count = if t.story.is_none() && blocked.is_none() {
        c.query_row("SELECT count(*) FROM stories s LEFT JOIN execution_states x ON x.scope_type='story' AND x.scope_id=s.id WHERE s.epic_id=?1 AND s.archived_at IS NULL AND s.status NOT IN ('done','archived') AND (x.own_state='running' OR (coalesce(x.own_state,'inherit')='inherit' AND ?2))",params![t.epic.audit.id,own_state==ExecutionOwnState::Running],|r|r.get(0))?
    } else {
        0
    };
    let source = if own_state == ExecutionOwnState::Inherit {
        ExecutionSource::Epic
    } else if own.state.is_some() {
        ExecutionSource::Scope
    } else {
        ExecutionSource::None
    };
    Ok(ExecutionState {
        project_id: t.epic.audit.jam_id.clone(),
        scope,
        scope_key: t.key().into(),
        scope_title: t.title().into(),
        own_state,
        effective_state: if running {
            ExecutionEffectiveState::Running
        } else {
            ExecutionEffectiveState::Paused
        },
        source,
        revision,
        can_start: blocked.is_none(),
        blocked_reason: blocked,
        in_progress_count,
        ready_count,
        running_story_count,
        changed_by: own.actor,
        changed_at: own.at,
    })
}
fn put_state(c: &Connection, t: &Target, actor: &str, value: ExecutionOwnState) -> Result<()> {
    let scope = t.scope();
    c.execute("INSERT INTO execution_states(jam_id,scope_type,scope_id,own_state,revision,changed_by,changed_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(scope_type,scope_id) DO UPDATE SET own_state=excluded.own_state,revision=execution_states.revision+1,changed_by=excluded.changed_by,changed_at=excluded.changed_at",params![t.epic.audit.jam_id,kind_text(scope.kind),scope.id,state_text(value),actor,now()])?;
    Ok(())
}
fn supersede(c: &Connection, t: &Target, actor: &str) -> Result<usize> {
    // A child action invalidates its own request and a pending broad epic request,
    // not unrelated sibling requests. Epic actions invalidate the whole subtree.
    Ok(c.execute("UPDATE execution_requests SET status='superseded',resolved_by=?,resolved_at=? WHERE status='pending' AND epic_id=? AND (?4 IS NULL OR scope_type='epic' OR scope_id=?4)",params![actor,now(),t.epic.audit.id,t.story.as_ref().map(|s|&s.audit.id)])?)
}
fn change(
    c: &Connection,
    t: &Target,
    actor: &str,
    action: ExecutionAction,
) -> Result<ExecutionState> {
    if action == ExecutionAction::Start
        && let Some(reason) = t.blocked()
    {
        return Err(Error::ExecutionRequired(reason));
    }
    put_state(
        c,
        t,
        actor,
        if action == ExecutionAction::Start {
            ExecutionOwnState::Running
        } else {
            ExecutionOwnState::Paused
        },
    )?;
    if t.story.is_none() && action == ExecutionAction::Pause {
        c.execute("UPDATE execution_states SET own_state='inherit',revision=revision+1,changed_by=?,changed_at=? WHERE scope_type='story' AND own_state='running' AND scope_id IN (SELECT id FROM stories WHERE epic_id=?)",params![actor,now(),t.epic.audit.id])?;
    }
    let superseded = supersede(c, t, actor)?;
    crate::planning::v2_event(
        c,
        actor,
        Some(&t.epic.audit.id),
        if action == ExecutionAction::Start {
            "execution.started"
        } else {
            "execution.paused"
        },
        None,
        serde_json::json!({"scope":t.scope(),"scopeKey":t.key(),"supersededRequests":superseded}),
    )?;
    state(c, t)
}
/// Closing is not merely a temporary filter: reopening must require fresh authority.
pub(crate) fn revoke_scope(c: &Connection, actor: &str, scope: &ExecutionScope) -> Result<()> {
    let t = target(c, scope)?;
    put_state(c, &t, actor, ExecutionOwnState::Paused)?;
    if t.story.is_none() {
        c.execute("UPDATE execution_states SET own_state='inherit',revision=revision+1,changed_by=?,changed_at=? WHERE scope_type='story' AND own_state='running' AND scope_id IN (SELECT id FROM stories WHERE epic_id=?)",params![actor,now(),t.epic.audit.id])?;
    }
    supersede(c, &t, actor)?;
    Ok(())
}
pub(crate) fn revoke_project(c: &Connection, actor: &str, project: &str) -> Result<()> {
    let ids = c
        .prepare("SELECT id FROM epics WHERE jam_id=?")?
        .query_map([project], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for id in ids {
        revoke_scope(
            c,
            actor,
            &ExecutionScope {
                kind: ExecutionScopeType::Epic,
                id,
            },
        )?;
    }
    Ok(())
}
/// No role or readiness override may bypass the explicit execution gate.
pub(crate) fn require_execution(c: &Connection, story_id: &str) -> Result<()> {
    let t = target(
        c,
        &ExecutionScope {
            kind: ExecutionScopeType::Story,
            id: story_id.into(),
        },
    )?;
    let s = state(c, &t)?;
    if let Some(reason) = s.blocked_reason {
        return Err(Error::ExecutionRequired(reason));
    }
    if s.effective_state != ExecutionEffectiveState::Running {
        return Err(Error::ExecutionRequired(format!(
            "Work on {} has not been started, or is paused. A human must start this story or its epic; Ready does not authorize execution.",
            s.scope_key
        )));
    }
    if t.story.as_ref().is_some_and(|s| s.status != "active") {
        return Err(Error::NotReady("Activate the story before starting a task; execution permission does not replace planning readiness".into()));
    }
    Ok(())
}
fn request(c: &Connection, id: &str) -> Result<ExecutionRequest> {
    let raw=c.query_row("SELECT jam_id,scope_type,scope_id,requested_by,reason,status,revision,created_at,resolved_by,resolved_at FROM execution_requests WHERE id=?",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get::<_,String>(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?))).optional()?.ok_or_else(||Error::NotFound("execution request".into()))?;
    crate::projects::ensure_scope(c, &raw.0)?;
    let scope = ExecutionScope {
        kind: serde_json::from_value(serde_json::json!(raw.1))?,
        id: raw.2,
    };
    let t = target(c, &scope)?;
    Ok(ExecutionRequest {
        id: id.into(),
        project_id: raw.0,
        scope,
        scope_key: t.key().into(),
        scope_title: t.title().into(),
        requested_by: raw.3,
        reason: raw.4,
        status: serde_json::from_value(serde_json::json!(raw.5))?,
        revision: raw.6,
        created_at: raw.7,
        resolved_by: raw.8,
        resolved_at: raw.9,
    })
}
impl Store {
    pub fn get_execution(&self, scope: &ExecutionScope) -> Result<ExecutionState> {
        self.read(|c| state(c, &target(c, scope)?))
    }
    pub fn list_execution(&self) -> Result<Vec<ExecutionState>> {
        self.read(|c|{
            let project=crate::service::jam(c)?;
            let scopes=c.prepare("SELECT 'epic',id FROM epics WHERE jam_id=?1 UNION ALL SELECT 'story',id FROM stories WHERE jam_id=?1")?.query_map([project.id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
            scopes.into_iter().map(|(kind,id)|{let scope=ExecutionScope{kind:serde_json::from_value(serde_json::json!(kind))?,id};state(c,&target(c,&scope)?)}).collect()
        })
    }
    pub fn set_execution(&self, actor: &str, input: SetExecution) -> Result<ExecutionState> {
        self.write(|c| {
            if crate::service::member(c, actor)?.kind != "human" {
                return Err(Error::Forbidden(
                    "Only a human action in the app may authorize or pause execution".into(),
                ));
            }
            let t = target(c, &input.scope)?;
            if input.expected_revision != state(c, &t)?.revision {
                return Err(Error::Conflict);
            }
            change(c, &t, actor, input.action)
        })
    }
    pub fn request_execution(
        &self,
        actor: &str,
        input: RequestExecution,
    ) -> Result<ExecutionRequest> {
        crate::m5::validate_name("reason", &input.reason, 4000)?;
        self.write(|c|{
            let t=target(c,&input.scope)?;
            if crate::service::member(c,actor)?.kind!="agent" || t.epic.brain_member_id.as_deref()!=Some(actor){return Err(Error::Forbidden("Only this epic's appointed brain may request execution. Workers cannot authorize or request a start.".into()));}
            let current=state(c,&t)?;
            if !current.can_start{return Err(Error::ExecutionRequired(current.blocked_reason.unwrap_or_default()));}
            if current.effective_state==ExecutionEffectiveState::Running{return Err(invalid("scope","This scope is already running"));}
            let scope=t.scope();
            let existing=c.query_row("SELECT id FROM execution_requests WHERE jam_id=? AND scope_type=? AND scope_id=? AND status='pending'",params![current.project_id,kind_text(scope.kind),scope.id],|r|r.get::<_,String>(0)).optional()?;
            if let Some(existing)=existing {
                let old=request(c,&existing)?;
                if old.revision==current.revision{return Ok(old);}
                c.execute("UPDATE execution_requests SET status='superseded',resolved_by=?,resolved_at=? WHERE id=?",params![actor,now(),existing])?;
            }
            let id=id();
            c.execute("INSERT INTO execution_requests(id,jam_id,epic_id,scope_type,scope_id,requested_by,reason,status,revision,created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)",params![id,current.project_id,t.epic.audit.id,kind_text(scope.kind),scope.id,actor,input.reason,current.revision,now()])?;
            crate::planning::v2_event(c,actor,Some(&t.epic.audit.id),"execution.requested",None,serde_json::json!({"requestId":id,"scope":scope,"scopeKey":t.key()}))?;
            request(c,&id)
        })
    }
    pub fn list_execution_requests(
        &self,
        status: Option<ExecutionRequestStatus>,
    ) -> Result<Vec<ExecutionRequest>> {
        self.read(|c|{
            let project=crate::service::jam(c)?.id;
            let ids=c.prepare("SELECT id FROM execution_requests WHERE jam_id=?1 AND (?2 IS NULL OR status=?2) ORDER BY created_at DESC,id DESC")?.query_map(params![project,status.map(request_status_text)],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            ids.iter().map(|id|request(c,id)).collect()
        })
    }
    pub fn resolve_execution_request(
        &self,
        actor: &str,
        input: ResolveExecutionRequest,
    ) -> Result<ExecutionRequest> {
        self.write(|c|{
            if crate::service::member(c,actor)?.kind!="human" { return Err(Error::Forbidden("Only a human action in the app may resolve execution requests".into())); }
            let old=request(c,&input.id)?;
            if old.status!=ExecutionRequestStatus::Pending || old.revision!=input.expected_revision{return Err(Error::Conflict);}
            let t=target(c,&old.scope)?;
            if state(c,&t)?.revision!=old.revision{return Err(Error::Conflict);}
            let status=if input.decision==ExecutionDecision::Approve{ExecutionRequestStatus::Approved}else{ExecutionRequestStatus::Declined};
            c.execute("UPDATE execution_requests SET status=?,resolved_by=?,resolved_at=? WHERE id=?",params![request_status_text(status),actor,now(),input.id])?;
            if input.decision==ExecutionDecision::Approve{change(c,&t,actor,ExecutionAction::Start)?;}
            crate::planning::v2_event(c,actor,Some(&t.epic.audit.id),"execution.request_resolved",None,serde_json::json!({"requestId":input.id,"scope":old.scope,"scopeKey":t.key(),"decision":input.decision}))?;
            request(c,&input.id)
        })
    }
}
