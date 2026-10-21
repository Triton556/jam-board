use crate::*;
use rusqlite::params;
use std::time::{Duration, Instant};

/// Persisted activity vocabulary accepted by the long-poll filter.
pub const ACTIVITY_ACTIONS: &[&str] = &[
    "agent.status",
    "asset.created",
    "asset.linked",
    "asset.unlinked",
    "asset.updated",
    "comment.added",
    "epic.created",
    "epic.status",
    "epic.updated",
    "jam.archived",
    "jam.imported",
    "jam.updated",
    "member.joined",
    "member.updated",
    "project.updated",
    "question.answered",
    "question.asked",
    "question.withdrawn",
    "reference.added",
    "reference.linked",
    "reference.updated",
    "report.submitted",
    "review.recorded",
    "story.created",
    "story.status",
    "story.updated",
    "task.archived",
    "task.brief_updated",
    "task.claimed",
    "task.created",
    "task.moved",
    "task.ready_override",
    "task.released",
    "task.updated",
];

impl Store {
    /// Scan every observed seq, retaining at most 100 matches without skipping later matches.
    /// Each scan ends its read snapshot before waiting on PRAGMA data_version.
    pub fn wait_for_changes(&self, actor: &str, input: ChangesWaitInput) -> Result<ChangesWait> {
        if input.cursor < 0 {
            return Err(invalid("cursor", "Use a non-negative activity cursor"));
        }
        if !(1..=60).contains(&input.timeout_seconds) {
            return Err(invalid("timeoutSeconds", "Use 1–60 seconds"));
        }
        if input
            .actor_kind
            .as_deref()
            .is_some_and(|k| !["human", "agent"].contains(&k))
        {
            return Err(invalid("actorKind", "Choose human or agent"));
        }
        if input
            .actions
            .as_ref()
            .is_some_and(|a| a.iter().any(|a| !ACTIVITY_ACTIONS.contains(&a.as_str())))
        {
            return Err(invalid("actions", "Unknown activity action"));
        }
        let (project, epic_id) = self.read(|c| {
            let project = crate::service::jam(c)?.id;
            let epic_id = input
                .epic_key
                .as_deref()
                .map(|k| crate::planning::epic(c, k).map(|e| e.audit.id))
                .transpose()?;
            Ok((project, epic_id))
        })?;
        // Presence metadata only: never append activity for a wait.
        self.write(|c| {
            crate::service::member(c, actor)?;
            c.execute(
                "UPDATE members SET last_seen_at=? WHERE id=?",
                params![now(), actor],
            )?;
            Ok(())
        })?;
        let deadline = Instant::now() + Duration::from_secs(input.timeout_seconds);
        // Open the version observer BEFORE the initial scan, so a concurrent commit cannot be lost.
        let mut feed = ChangeFeed::open(&self.path, input.cursor)?;
        loop {
            let mut events = Vec::new();
            {
                let mut stmt = feed.connection.prepare(
                    "SELECT a.seq,a.action,m.id,m.kind,m.name,m.handle,m.color,t.key,a.payload,a.created_at,a.epic_id,a.jam_id FROM activity a JOIN members m ON m.id=a.actor_id LEFT JOIN tasks t ON t.id=a.task_id WHERE a.seq>? ORDER BY a.seq ASC"
                )?;
                let mut rows = stmt.query([feed.last_seq])?;
                while let Some(row) = rows.next()? {
                    let event = crate::db::activity_row(row)?;
                    feed.last_seq = event.seq;
                    let jam_id: Option<String> = row.get(11)?;
                    let in_scope = epic_id.as_ref().is_none_or(|id| {
                        event.epic_id.as_ref() == Some(id)
                            || (input.include_project
                                && event.epic_id.is_none()
                                && event.actor.kind == "human")
                    });
                    if jam_id.as_deref() == Some(&project)
                        && in_scope
                        && input
                            .actions
                            .as_ref()
                            .is_none_or(|a| a.contains(&event.action))
                        && input
                            .actor_kind
                            .as_ref()
                            .is_none_or(|k| k == &event.actor.kind)
                        && (!input.exclude_self || event.actor.id != actor)
                    {
                        events.push(event);
                        if events.len() == 100 {
                            break;
                        }
                    }
                }
            }
            if !events.is_empty() || Instant::now() >= deadline {
                return Ok(ChangesWait {
                    timed_out: events.is_empty(),
                    events,
                    next_cursor: feed.last_seq,
                });
            }
            // A non-matching commit advances the cursor but never completes the call.
            while !feed.wait_until_changed(deadline)? && Instant::now() < deadline {}
        }
    }
}
