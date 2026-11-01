use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InboxEventFilter {
    #[default]
    All,
    NeedsAction,
    Updates,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InboxEventGroup {
    NeedsAction,
    Updates,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboxEventsQuery {
    pub before_seq: Option<i64>,
    pub limit: Option<u32>,
    pub filter: Option<InboxEventFilter>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxEventsPage {
    pub events: Vec<InboxEvent>,
    pub unread: u32,
    pub open_actions: u32,
    pub seen_seq: i64,
    pub next_before_seq: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InboxEvent {
    pub seq: i64,
    pub first_seq: i64,
    pub action: String,
    pub group: InboxEventGroup,
    pub actor: MemberRef,
    pub sentence: String,
    pub count: u32,
    pub task_key: Option<String>,
    pub epic_key: Option<String>,
    pub story_key: Option<String>,
    pub frame_id: Option<String>,
    pub frame_title: Option<String>,
    pub request_id: Option<String>,
    pub resolved: bool,
    pub unread: bool,
    pub created_at: String,
}
fn group(event: &ActivityEvent, viewer: &str) -> Option<InboxEventGroup> {
    match event.action.as_str() {
        "report.submitted" | "execution.requested" => Some(InboxEventGroup::NeedsAction),
        "reference.review_sent" => Some(InboxEventGroup::Updates),
        "review.recorded"
        | "task.claimed"
        | "task.released"
        | "task.created"
        | "story.created"
        | "epic.created"
        | "task.moved"
        | "story_moved"
        | "task_moved_to_story"
        | "reference.added"
        | "comment.added"
        | "question.withdrawn"
        | "jam.imported"
            if event.actor.id != viewer =>
        {
            Some(InboxEventGroup::Updates)
        }
        _ => None,
    }
}
fn resolved(event: &ActivityEvent, events: &[ActivityEvent]) -> bool {
    events.iter().any(|later| {
        later.seq > event.seq
            && match event.action.as_str() {
                "report.submitted" => {
                    later.action == "review.recorded"
                        && event.task_key.is_some()
                        && later.task_key == event.task_key
                }
                "execution.requested" => {
                    later.action == "execution.request_resolved"
                        && event.payload["requestId"].is_string()
                        && later.payload["requestId"] == event.payload["requestId"]
                }
                _ => false,
            }
    })
}
fn seen(c: &Connection, project: &str, viewer: &str) -> Result<i64> {
    c.query_row(
        "SELECT inbox_seen_seq FROM project_members WHERE jam_id=? AND member_id=?",
        params![project, viewer],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| Error::Forbidden("Viewer is not a member of this project".into()))
}
fn grouped_sentence(row: &InboxEvent) -> String {
    let actor = &row.actor.name;
    let count = row.count;
    let action = match row.action.as_str() {
        "reference.added" => "added",
        "task.created" | "story.created" | "epic.created" => "created",
        "task.claimed" => "claimed",
        "task.released" => "released",
        "comment.added" => "added",
        "review.recorded" => "reviewed",
        "task.moved" | "story_moved" | "task_moved_to_story" => "moved",
        "question.withdrawn" => "withdrew",
        _ => "recorded",
    };
    let noun = match row.action.as_str() {
        "reference.added" => "references",
        "story.created" | "story_moved" => "stories",
        "epic.created" => "epics",
        "comment.added" => "comments",
        "question.withdrawn" => "questions",
        "reference.review_sent" => "moodboard reviews",
        _ => "tasks",
    };
    let scope = row
        .epic_key
        .as_ref()
        .filter(|_| row.action != "reference.added")
        .map(|key| format!(" in {key}"))
        .unwrap_or_default();
    format!("{actor} {action} {count} {noun}{scope}")
}
fn timestamp(value: &str) -> Option<time::OffsetDateTime> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()
}
impl Store {
    pub fn list_inbox_events(
        &self,
        viewer: &str,
        input: InboxEventsQuery,
    ) -> Result<InboxEventsPage> {
        let limit = input.limit.unwrap_or(50) as usize;
        if !(1..=200).contains(&limit) {
            return Err(invalid("limit", "Use 1 to 200 events"));
        }
        if input.before_seq.is_some_and(|seq| seq < 1) {
            return Err(invalid("beforeSeq", "Use a positive sequence"));
        }
        self.read(|c|{
            crate::service::member(c,viewer)?;let project=crate::service::jam(c)?.id;let seen_seq=seen(c,&project,viewer)?;
            let events=c.prepare("SELECT a.seq,a.action,m.id,m.kind,m.name,m.handle,m.color,t.key,a.payload,a.created_at,a.epic_id,a.client FROM activity a JOIN members m ON m.id=a.actor_id LEFT JOIN tasks t ON t.id=a.task_id WHERE a.jam_id=? ORDER BY a.seq DESC")?.query_map([&project],crate::db::activity_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
            let shown=events.iter().filter_map(|event|group(event,viewer).map(|group|(event,group))).collect::<Vec<_>>();
            let unread=shown.iter().filter(|(e,_)|e.seq>seen_seq && (e.actor.id!=viewer || e.action=="reference.review_sent")).count().min(99) as u32;
            let open_actions=shown.iter().filter(|(e,g)|*g==InboxEventGroup::NeedsAction && !resolved(e,&events)).count() as u32;
            let filter=input.filter.unwrap_or_default();
            let page=shown.into_iter().filter(|(e,g)|input.before_seq.is_none_or(|before|e.seq<before) && match filter {InboxEventFilter::All=>true,InboxEventFilter::NeedsAction=>*g==InboxEventGroup::NeedsAction,InboxEventFilter::Updates=>*g==InboxEventGroup::Updates}).take(limit+1).collect::<Vec<_>>();
            let next_before_seq=(page.len()>limit).then(||page[limit-1].0.seq);
            let mut rows:Vec<InboxEvent>=vec![];let mut previous:Option<(&ActivityEvent,InboxEventGroup)>=None;
            for (event,group) in page.into_iter().take(limit) {
                let adjacent=previous.is_some_and(|(prior,prior_group)|prior_group==group && prior.actor.id==event.actor.id && prior.action==event.action && prior.epic_id==event.epic_id && timestamp(&prior.created_at).zip(timestamp(&event.created_at)).is_some_and(|(a,b)|{let gap=(a-b).whole_seconds();(0..=600).contains(&gap)}));
                previous=Some((event,group));
                if group==InboxEventGroup::Updates && adjacent && let Some(row)=rows.last_mut(){row.first_seq=event.seq;row.count+=1;row.sentence=grouped_sentence(row);continue;}
                let scope_key=event.payload["scopeKey"].as_str().or_else(||event.payload["key"].as_str());
                let task_key=event.task_key.clone().or_else(||scope_key.filter(|key|!key.rsplit('-').next().is_some_and(|tail|tail.starts_with('S')||tail.starts_with('E'))).map(str::to_owned));
                let story_key=scope_key.filter(|key|key.rsplit('-').next().is_some_and(|tail|tail.starts_with('S'))).map(str::to_owned);
                let epic_key=event.epic_id.as_deref().map(|id|crate::planning::epic(c,id).map(|e|e.key)).transpose()?;
                let mut frame_id=event.payload["frameId"].as_str().map(str::to_owned);
                if frame_id.is_none() && event.action=="reference.added" && let Some(id)=event.payload["itemId"].as_str(){frame_id=c.query_row("SELECT frame_id FROM ref_items WHERE id=? AND jam_id=?",params![id,project],|r|r.get::<_,Option<String>>(0)).optional()?.flatten();}
                let frame_title=if let Some(title)=event.payload["frameTitle"].as_str(){Some(title.into())}else if let Some(id)=&frame_id{c.query_row("SELECT title FROM ref_frames WHERE id=? AND jam_id=?",params![id,project],|r|r.get(0)).optional()?}else{None};
                rows.push(InboxEvent{seq:event.seq,first_seq:event.seq,action:event.action.clone(),group,actor:event.actor.clone(),sentence:crate::activity_sentence(&event.action,if event.actor.id==viewer{"You"}else{&event.actor.name},event.task_key.as_deref(),&event.payload),count:1,task_key,epic_key,story_key,frame_id,frame_title,request_id:if event.action=="execution.requested"{event.payload["requestId"].as_str().map(str::to_owned)}else{None},resolved:resolved(event,&events),unread:event.seq>seen_seq,created_at:event.created_at.clone()});
            }
            Ok(InboxEventsPage{events:rows,unread,open_actions,seen_seq,next_before_seq})
        })
    }
    pub fn mark_inbox_events_seen(&self, viewer: &str, seq: i64) -> Result<i64> {
        if seq < 0 {
            return Err(invalid("seq", "Use a non-negative sequence"));
        }
        self.write(|c|{if crate::service::member(c,viewer)?.kind!="human"{return Err(Error::Forbidden("Only humans mark Inbox events seen".into()));}let project=crate::service::jam(c)?.id;seen(c,&project,viewer)?;c.execute("UPDATE project_members SET inbox_seen_seq=max(inbox_seen_seq,?) WHERE jam_id=? AND member_id=?",params![seq,project,viewer])?;seen(c,&project,viewer)})
    }
}
