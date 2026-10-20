//! All business mutations are atomic and append exactly one activity event.
use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn jam(c: &Connection) -> Result<Jam> {
    c.query_row(
        "SELECT id, name, theme, starts_at, ends_at, timezone, task_seq, key_prefix,
created_at FROM jams WHERE archived=0 AND id=(SELECT id FROM jams ORDER BY created_at DESC,id DESC LIMIT 1)",
        [],
        |r| {
            Ok(Jam {
                id: r.get(0)?,
                name: r.get(1)?,
                theme: r.get(2)?,
                starts_at: r.get(3)?,
                ends_at: r.get(4)?,
                timezone: r.get(5)?,
                task_seq: r.get(6)?,
                key_prefix: r.get(7)?,
                created_at: r.get(8)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| Error::NotFound("active jam".into()))
}
pub(crate) fn member(c: &Connection, id: &str) -> Result<Member> {
    c.query_row(
        "SELECT id, kind, name, handle, color, avatar, client, last_seen_at, created_at
FROM members WHERE id=?",
        [id],
        member_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound(format!("member {id}")))
}
pub(crate) fn member_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Member> {
    Ok(Member {
        id: r.get(0)?,
        kind: r.get(1)?,
        name: r.get(2)?,
        handle: r.get(3)?,
        color: r.get(4)?,
        avatar: r.get(5)?,
        client: r.get(6)?,
        last_seen_at: r.get(7)?,
        created_at: r.get(8)?,
    })
}
pub(crate) fn task_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<TaskSummary> {
    Ok(TaskSummary {
        id: r.get(0)?,
        jam_id: r.get(1)?,
        key: r.get(2)?,
        title: r.get(3)?,
        description_md: r.get(4)?,
        status: r.get(5)?,
        priority: r.get(6)?,
        estimate: r.get(7)?,
        due_at: r.get(8)?,
        position: r.get(9)?,
        assignee_id: r.get(10)?,
        created_by: r.get(11)?,
        updated_by: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
        archived_at: r.get(15)?,
        idempotency_key: r.get(16)?,
        tags: Vec::new(),
        comment_count: 0,
    })
}
pub(crate) const TASK_COLUMNS: &str = "id,jam_id,key,title,description_md,status,priority,estimate,due_at,position,assignee_id,created_by,updated_by,created_at,updated_at,archived_at,idempotency_key";
pub(crate) fn task(c: &Connection, key: &str) -> Result<TaskSummary> {
    let mut t = c
        .query_row(
            &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE key=?"),
            [key],
            task_row,
        )
        .optional()?
        .ok_or_else(|| Error::NotFound(key.into()))?;
    t.tags = tags(c, &t.id)?;
    t.comment_count = c.query_row(
        "SELECT count(*) FROM comments WHERE task_id=?",
        [&t.id],
        |r| r.get(0),
    )?;
    Ok(t)
}
fn tags(c: &Connection, id: &str) -> Result<Vec<String>> {
    Ok(
        c.prepare("SELECT tag FROM task_tags WHERE task_id=? ORDER BY tag")?
            .query_map([id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?,
    )
}
pub(crate) fn normalize_tags(tags: &[String]) -> Result<Vec<String>> {
    let mut out = BTreeSet::new();
    for tag in tags {
        let tag = tag.trim().to_lowercase();
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > 24 {
            return Err(invalid(
                "tags",
                "each tag must contain at most 24 characters",
            ));
        }
        out.insert(tag);
    }
    Ok(out.into_iter().collect())
}
fn set_tags(c: &Connection, id: &str, tags: &[String]) -> Result<()> {
    let tags = normalize_tags(tags)?;
    c.execute("DELETE FROM task_tags WHERE task_id=?", [id])?;
    for tag in tags {
        c.execute("INSERT INTO task_tags VALUES (?,?)", [id, &tag])?;
    }
    Ok(())
}
pub(crate) fn event(
    c: &Connection,
    jam_id: Option<&str>,
    actor: &str,
    action: &str,
    task_id: Option<&str>,
    payload: Value,
) -> Result<()> {
    c.execute(
        "INSERT INTO activity(id, jam_id, actor_id, action, task_id, payload,
created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            id(),
            jam_id,
            actor,
            action,
            task_id,
            payload.to_string(),
            now()
        ],
    )?;
    Ok(())
}
fn editable(c: &Connection, key: &str, actor: &str) -> Result<TaskSummary> {
    member(c, actor)?;
    let t = task(c, key)?;
    if t.archived_at.is_some() {
        return Err(Error::Archived(key.into()));
    }
    Ok(t)
}
fn status(value: &str) -> Result<()> {
    if STATUSES.contains(&value) {
        Ok(())
    } else {
        Err(invalid(
            "status",
            "expected backlog, todo, in_progress, review or done",
        ))
    }
}
fn priority(value: &str) -> Result<()> {
    if PRIORITIES.contains(&value) {
        Ok(())
    } else {
        Err(invalid(
            "priority",
            "expected low, medium, high or critical",
        ))
    }
}
fn title(value: &str) -> Result<()> {
    if (1..=140).contains(&value.chars().count()) && !value.trim().is_empty() {
        Ok(())
    } else {
        Err(invalid(
            "title",
            "must contain 1–140 characters and not be blank",
        ))
    }
}
fn estimate(value: Option<i64>) -> Result<()> {
    if value.is_none_or(|v| [1, 2, 3, 5, 8].contains(&v)) {
        Ok(())
    } else {
        Err(invalid("estimate", "expected 1, 2, 3, 5 or 8"))
    }
}
fn utc_date(value: Option<&str>) -> Result<Option<String>> {
    value
        .map(|v| {
            time::OffsetDateTime::parse(v, &time::format_description::well_known::Rfc3339)
                .map_err(|_| invalid("dueAt", "expected RFC 3339 timestamp"))
                .map(|t| {
                    t.to_offset(time::UtcOffset::UTC)
                        .format(&time::format_description::well_known::Rfc3339)
                        .expect("UTC")
                })
        })
        .transpose()
}
fn end_position(c: &Connection, jam_id: &str, status: &str) -> Result<f64> {
    Ok(c.query_row(
        "SELECT coalesce(max(position), 0)+1024 FROM tasks WHERE jam_id=? AND status=?
AND archived_at IS NULL",
        [jam_id, status],
        |r| r.get(0),
    )?)
}
pub(crate) fn touch(c: &Connection, id: &str, actor: &str) -> Result<()> {
    let previous: String = c.query_row("SELECT updated_at FROM tasks WHERE id=?", [id], |row| {
        row.get(0)
    })?;
    let format = &time::format_description::well_known::Rfc3339;
    let previous = time::OffsetDateTime::parse(&previous, format)
        .map_err(|_| invalid("updatedAt", "Invalid stored version"))?;
    let stamp = time::OffsetDateTime::now_utc()
        .max(previous + time::Duration::nanoseconds(1))
        .format(format)
        .expect("UTC");
    c.execute(
        "UPDATE tasks SET updated_at=?,updated_by=? WHERE id=?",
        params![stamp, actor, id],
    )?;
    Ok(())
}

impl Store {
    pub fn active_jam(&self) -> Result<Jam> {
        self.read(jam)
    }
    pub fn get_member(&self, id: &str) -> Result<Member> {
        self.read(|c| member(c, id))
    }
    pub fn create_jam(
        &self,
        name: &str,
        theme: Option<&str>,
        starts_at: Option<&str>,
        ends_at: Option<&str>,
        timezone: &str,
        your_name: &str,
    ) -> Result<(Jam, Member)> {
        title(name)?;
        title(your_name)?;
        let starts_at = utc_date(starts_at)?;
        let ends_at = utc_date(ends_at)?;
        if timezone.trim().is_empty() {
            return Err(invalid("timezone", "must not be empty"));
        }
        self.write(|c| {
            let mid=id();
 let jid=id();
 let stamp=now();
            let handle=unique_handle(c,your_name)?;
            c.execute("INSERT INTO members(id,kind,name,handle,color,created_at) VALUES (?,'human',?,?,?,?)",params![mid,your_name,handle,MEMBER_COLORS[0],stamp])?;
            let mut prefix="JB".to_string();
 let mut number=2;
            while c.query_row("SELECT 1 FROM jams WHERE key_prefix=?",[&prefix],|r|r.get::<_,i64>(0)).optional()?.is_some(){
prefix=format!("JB{number}");
number+=1;
}
            c.execute("INSERT INTO jams(id, name, theme, starts_at, ends_at, timezone, key_prefix,
created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",params![jid,name,theme,starts_at,ends_at,timezone,prefix,stamp])?;
            event(c,Some(&jid),&mid,"jam.updated",None,json!({
"name":[null,name],"created":true,"humanJoined":mid}
))?;
            c.execute("INSERT INTO settings VALUES ('current_member_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[&mid])?;
            Ok((jam(c)?,member(c,&mid)?))
        }
)
    }
    pub fn update_jam(
        &self,
        actor: &str,
        name: &str,
        theme: Option<&str>,
        ends_at: Option<&str>,
    ) -> Result<Jam> {
        title(name)?;
        let ends_at = utc_date(ends_at)?;
        self.write(|c| {
            let m = member(c, actor)?;
            if m.kind != "human" {
                return Err(invalid("actor", "only a human can edit jam settings"));
            }
            let old = jam(c)?;
            c.execute(
                "UPDATE jams SET name=?,theme=?,ends_at=? WHERE id=?",
                params![name, theme, ends_at, old.id],
            )?;
            event(
                c,
                Some(&old.id),
                actor,
                "jam.updated",
                None,
                json!({
                "name":[old.name,name],"theme":[old.theme,theme],"endsAt":[old.ends_at,ends_at]}
                ),
            )?;
            jam(c)
        })
    }
    pub fn add_human(
        &self,
        actor: &str,
        name: &str,
        color: &str,
        avatar: Option<&str>,
    ) -> Result<Member> {
        crate::m5::validate_name("name", name, 40)?;
        if avatar.is_some_and(|a| a.chars().count() > 16) {
            return Err(invalid("avatar", "Use an emoji of at most 16 characters"));
        }
        validate_color(color)?;
        self.write(|c| {
            if member(c, actor)?.kind != "human" {
                return Err(invalid("actor", "only a human can add people"));
            }
            let jid = jam(c)?.id;
            let mid = id();
            let handle = unique_handle(c, name)?;
            c.execute(
                "INSERT INTO members(id, kind, name, handle, color, avatar, created_at) VALUES
(?, 'human', ?, ?, ?, ?, ?)",
                params![mid, name, handle, color, avatar, now()],
            )?;
            event(
                c,
                Some(&jid),
                actor,
                "member.joined",
                None,
                json!({
                "memberId":mid,"name":name}
                ),
            )?;
            member(c, &mid)
        })
    }
    pub fn update_member(
        &self,
        actor: &str,
        target: &str,
        name: &str,
        color: &str,
        avatar: Option<&str>,
    ) -> Result<Member> {
        self.edit_member(
            actor,
            crate::MemberEdit {
                id: target.into(),
                name: Some(name.into()),
                color: Some(color.into()),
                avatar: avatar.map(str::to_string),
            },
        )
    }
    /// Presence heartbeats do not add activity; first registration is one domain event.
    pub fn identify_agent(&self, name: &str, client: &str) -> Result<Member> {
        title(name)?;
        self.write(|c| {
            let handle = handle(name);
            if let Some(mid) = c
                .query_row("SELECT id FROM members WHERE handle=?", [&handle], |r| {
                    r.get::<_, String>(0)
                })
                .optional()?
            {
                let m = member(c, &mid)?;
                if m.kind != "agent" {
                    return Err(invalid("agent", "handle belongs to a human"));
                }
                c.execute(
                    "UPDATE members SET last_seen_at=? WHERE id=?",
                    params![now(), mid],
                )?;
                return member(c, &mid);
            }
            let used = c
                .prepare("SELECT color FROM members")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let color = MEMBER_COLORS
                .iter()
                .find(|color| !used.iter().any(|u| u == **color))
                .copied()
                .unwrap_or(MEMBER_COLORS[used.len() % 6]);
            let mid = id();
            let stamp = now();
            c.execute(
                "INSERT INTO members(id, kind, name, handle, color, client, last_seen_at,
created_at) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?)",
                params![mid, name, handle, color, client, stamp, stamp],
            )?;
            event(
                c,
                jam(c).ok().as_ref().map(|j| j.id.as_str()),
                &mid,
                "member.joined",
                None,
                json!({
                "name":name,"handle":handle}
                ),
            )?;
            member(c, &mid)
        })
    }
    pub fn create_task(&self, actor: &str, input: CreateTask) -> Result<TaskDetail> {
        let key = self.write(|c| {
            member(c, actor)?;
            if let Some(token) = &input.idempotency_key
                && let Some(key) = c
                    .query_row(
                        "SELECT key FROM tasks WHERE created_by=? AND idempotency_key=?",
                        [actor, token],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?
            {
                return Ok(key);
            }
            title(&input.title)?;
            let s = input.status.as_deref().unwrap_or("todo");
            let p = input.priority.as_deref().unwrap_or("medium");
            status(s)?;
            priority(p)?;
            estimate(input.estimate)?;
            let due_at = utc_date(input.due_at.as_deref())?;
            let j = jam(c)?;
            let key = format!("{}-{}", j.key_prefix, j.task_seq + 1);
            let tid = id();
            let stamp = now();
            let position = end_position(c, &j.id, s)?;
            c.execute("UPDATE jams SET task_seq=task_seq+1 WHERE id=?", [&j.id])?;
            c.execute(
                "INSERT INTO tasks(id, jam_id, key, title, description_md, status, priority,
estimate, due_at, position, created_by, updated_by, created_at, updated_at,
idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    tid,
                    j.id,
                    key,
                    input.title,
                    input.description.as_deref().unwrap_or(""),
                    s,
                    p,
                    input.estimate,
                    due_at,
                    position,
                    actor,
                    actor,
                    stamp,
                    stamp,
                    input.idempotency_key
                ],
            )?;
            set_tags(c, &tid, input.tags.as_deref().unwrap_or(&[]))?;
            event(
                c,
                Some(&j.id),
                actor,
                "task.created",
                Some(&tid),
                json!({
                "title":input.title,"status":s}
                ),
            )?;
            Ok(key)
        })?;
        self.get_task(&key)
    }
    pub fn get_task(&self, key: &str) -> Result<TaskDetail> {
        self.read(|c| detail(c, key))
    }
    pub fn update_task(&self, actor: &str, input: UpdateTask) -> Result<TaskDetail> {
        self.apply_task_update(
            actor,
            &input.key,
            None,
            TaskPatch {
                title: input.title,
                description_md: input.description,
                priority: input.priority,
                tags: input.tags,
                estimate: input.estimate,
                due_at: input.due_at,
                ..Default::default()
            },
        )
    }
    pub(crate) fn apply_task_update(
        &self,
        actor: &str,
        key: &str,
        expected: Option<&str>,
        input: TaskPatch,
    ) -> Result<TaskDetail> {
        self.write(|c| {
 let old=editable(c,key,actor)?;
 if expected.is_some_and(|stamp| stamp != old.updated_at) { return Err(Error::Conflict); }
 let mut new=old.clone();
            if let Some(v)=input.title {
 title(&v)?;
 new.title=v;
 }
            if let Some(v)=input.description_md {
 new.description_md=v;
 }
            if let Some(v)=input.status { status(&v)?; if v != old.status { new.position=end_position(c,&old.jam_id,&v)?; new.status=v; } }
            if let Some(v)=input.assignee_id { if let Some(id)=&v { member(c,id)?; } new.assignee_id=v; }
            if let Some(v)=input.priority {
 priority(&v)?;
 new.priority=v;
 }
            if let Some(v)=input.estimate {
 estimate(v)?;
 new.estimate=v;
 }
            if let Some(v)=input.due_at {
 new.due_at=utc_date(v.as_deref())?;
 }
            if let Some(v)=input.tags {
 set_tags(c,&old.id,&v)?;
 new.tags=normalize_tags(&v)?;
 }
            c.execute("UPDATE tasks SET title=?,description_md=?,status=?,position=?,priority=?,assignee_id=?,estimate=?,due_at=? WHERE id=?",params![new.title,new.description_md,new.status,new.position,new.priority,new.assignee_id,new.estimate,new.due_at,old.id])?;
            touch(c,&old.id,actor)?;
 event(c,Some(&old.jam_id),actor,"task.updated",Some(&old.id),diff(&old,&new)?)?;
 Ok(())
        }
)?;
        self.get_task(key)
    }
    pub fn move_task(
        &self,
        actor: &str,
        key: &str,
        target: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<TaskSummary> {
        status(target)?;
        self.write(|c| {
            let old = editable(c, key, actor)?;
            let mut rows = c
                .prepare(
                    "SELECT key, position FROM tasks WHERE jam_id=? AND status=? AND archived_at IS
NULL AND key<>? ORDER BY position, key",
                )?
                .query_map(params![old.jam_id, target, key], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let lookup = |k: &str| {
                rows.iter().position(|r| r.0 == k).ok_or_else(|| {
                    invalid(
                        "position",
                        "neighbor must be an active task in the target column",
                    )
                })
            };
            let index = match (before, after) {
                (Some(b), Some(a)) => {
                    let bi = lookup(b)?;
                    let ai = lookup(a)?;
                    if ai + 1 != bi {
                        return Err(invalid(
                            "position",
                            "afterKey must immediately precede beforeKey",
                        ));
                    }
                    bi
                }
                (Some(b), None) => lookup(b)?,
                (None, Some(a)) => lookup(a)? + 1,
                (None, None) => rows.len(),
            };
            let insertion_too_close =
                index > 0 && index < rows.len() && (rows[index].1 - rows[index - 1].1) / 2.0 < 1e-6;
            let renumber =
                rows.windows(2).any(|pair| pair[1].1 - pair[0].1 < 1e-6) || insertion_too_close;
            let position = if renumber {
                rows.insert(index, (key.to_string(), 0.0));
                for (i, row) in rows.iter_mut().enumerate() {
                    row.1 = (i + 1) as f64 * 1024.0;
                    c.execute(
                        "UPDATE tasks SET position=? WHERE key=?",
                        params![row.1, row.0],
                    )?;
                }
                (index + 1) as f64 * 1024.0
            } else {
                match (
                    index.checked_sub(1).and_then(|i| rows.get(i)),
                    rows.get(index),
                ) {
                    (Some(a), Some(b)) => (a.1 + b.1) / 2.0,
                    (Some(a), None) => a.1 + 1024.0,
                    (None, Some(b)) => b.1 - 1024.0,
                    (None, None) => 1024.0,
                }
            };
            c.execute(
                "UPDATE tasks SET status=?,position=? WHERE id=?",
                params![target, position, old.id],
            )?;
            touch(c, &old.id, actor)?;
            event(
                c,
                Some(&old.jam_id),
                actor,
                "task.moved",
                Some(&old.id),
                json!({
                "status":[old.status,target],"position":[old.position,position]}
                ),
            )?;
            task(c, key)
        })
    }
    pub fn claim_task(&self, actor: &str, key: &str) -> Result<TaskDetail> {
        self.write(|c| {
            let old = editable(c, key, actor)?;
            if let Some(holder) = &old.assignee_id
                && holder != actor
            {
                return Err(Error::ClaimConflict {
                    holder: member(c, holder)?.name,
                });
            }
            let s = if ["backlog", "todo"].contains(&old.status.as_str()) {
                "in_progress"
            } else {
                &old.status
            };
            let pos = if s != old.status {
                end_position(c, &old.jam_id, s)?
            } else {
                old.position
            };
            c.execute(
                "UPDATE tasks SET assignee_id=?,status=?,position=? WHERE id=?",
                params![actor, s, pos, old.id],
            )?;
            touch(c, &old.id, actor)?;
            event(
                c,
                Some(&old.jam_id),
                actor,
                "task.claimed",
                Some(&old.id),
                json!({
                "assigneeId":[old.assignee_id,actor],"status":[old.status,s]}
                ),
            )?;
            Ok(())
        })?;
        self.get_task(key)
    }
    pub fn release_task(
        &self,
        actor: &str,
        key: &str,
        target: Option<&str>,
    ) -> Result<TaskSummary> {
        let target = target.unwrap_or("todo");
        status(target)?;
        self.write(|c| {
            let old = editable(c, key, actor)?;
            if old.assignee_id.as_deref() != Some(actor) && member(c, actor)?.kind != "human" {
                return Err(invalid(
                    "actor",
                    "only the holder or a human can release this task",
                ));
            }
            let pos = if target != old.status {
                end_position(c, &old.jam_id, target)?
            } else {
                old.position
            };
            c.execute(
                "UPDATE tasks SET assignee_id=NULL,status=?,position=? WHERE id=?",
                params![target, pos, old.id],
            )?;
            touch(c, &old.id, actor)?;
            event(
                c,
                Some(&old.jam_id),
                actor,
                "task.released",
                Some(&old.id),
                json!({
                "assigneeId":[old.assignee_id,null],"status":[old.status,target]}
                ),
            )?;
            task(c, key)
        })
    }
    pub fn assign_task(
        &self,
        actor: &str,
        key: &str,
        assignee: Option<&str>,
    ) -> Result<TaskSummary> {
        self.write(|c| {
            let old = editable(c, key, actor)?;
            if member(c, actor)?.kind != "human" {
                return Err(invalid("actor", "only a human can assign tasks"));
            }
            if let Some(a) = assignee {
                member(c, a)?;
            }
            c.execute(
                "UPDATE tasks SET assignee_id=? WHERE id=?",
                params![assignee, old.id],
            )?;
            touch(c, &old.id, actor)?;
            event(
                c,
                Some(&old.jam_id),
                actor,
                "task.updated",
                Some(&old.id),
                json!({
                "assigneeId":[old.assignee_id,assignee]}
                ),
            )?;
            task(c, key)
        })
    }
    pub fn archive_task(
        &self,
        actor: &str,
        key: &str,
        reason: Option<&str>,
    ) -> Result<TaskSummary> {
        if let Some(body) = reason {
            comment_body(body)?;
        }
        self.write(|c| {
            let old = editable(c, key, actor)?;
            let stamp = now();
            c.execute(
                "UPDATE tasks SET archived_at=? WHERE id=?",
                params![stamp, old.id],
            )?;
            touch(c, &old.id, actor)?;
            if let Some(body) = reason {
                insert_comment(c, &old.id, actor, body)?;
            }
            event(
                c,
                Some(&old.jam_id),
                actor,
                "task.archived",
                Some(&old.id),
                json!({
                "archivedAt":[null,stamp],"reason":reason}
                ),
            )?;
            task(c, key)
        })
    }
    pub fn unarchive_task(&self, actor: &str, key: &str) -> Result<TaskSummary> {
        self.write(|c| {
            if member(c, actor)?.kind != "human" {
                return Err(invalid("actor", "only a human can unarchive"));
            }
            let old = task(c, key)?;
            c.execute("UPDATE tasks SET archived_at=NULL WHERE id=?", [&old.id])?;
            touch(c, &old.id, actor)?;
            event(
                c,
                Some(&old.jam_id),
                actor,
                "task.updated",
                Some(&old.id),
                json!({
                "archivedAt":[old.archived_at,null]}
                ),
            )?;
            task(c, key)
        })
    }
    pub fn add_comment(&self, actor: &str, key: &str, body: &str) -> Result<Comment> {
        comment_body(body)?;
        self.write(|c| {
            let old = editable(c, key, actor)?;
            let comment = insert_comment(c, &old.id, actor, body)?;
            touch(c, &old.id, actor)?;
            event(
                c,
                Some(&old.jam_id),
                actor,
                "comment.added",
                Some(&old.id),
                json!({
                "commentId":comment.id,"body":body}
                ),
            )?;
            Ok(comment)
        })
    }
    pub fn create_asset(
        &self,
        actor: &str,
        kind: &str,
        name: &str,
        location: &str,
        notes: Option<&str>,
    ) -> Result<Asset> {
        if !["sprite", "audio", "level", "font", "other"].contains(&kind) {
            return Err(invalid("kind", "invalid asset kind"));
        }
        title(name)?;
        if location.trim().is_empty() {
            return Err(invalid("location", "must not be empty"));
        }
        if notes.is_some_and(|n| n.chars().count() > 4000) {
            return Err(invalid("notes", "Use at most 4000 characters"));
        }
        self.write(|c| {
            member(c, actor)?;
            let a = Asset {
                id: id(),
                jam_id: jam(c)?.id,
                kind: kind.into(),
                name: name.into(),
                location: location.into(),
                notes: notes.map(Into::into),
                created_by: actor.into(),
                created_at: now(),
            };
            c.execute(
                "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
                params![
                    a.id,
                    a.jam_id,
                    a.kind,
                    a.name,
                    a.location,
                    a.notes,
                    a.created_by,
                    a.created_at
                ],
            )?;
            event(
                c,
                Some(&a.jam_id),
                actor,
                "asset.created",
                None,
                json!({
                "assetId":a.id,"name":name}
                ),
            )?;
            Ok(a)
        })
    }
    pub fn link_asset(&self, actor: &str, key: &str, asset_id: &str) -> Result<TaskDetail> {
        self.write(|c| {
            let t = editable(c, key, actor)?;
            let aj = c
                .query_row(
                    "SELECT jam_id,name FROM assets WHERE id=?",
                    [asset_id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .optional()?
                .ok_or_else(|| Error::NotFound(asset_id.into()))?;
            if aj.0 != t.jam_id {
                return Err(invalid("asset", "belongs to another jam"));
            }
            c.execute(
                "INSERT OR IGNORE INTO task_assets VALUES (?,?)",
                [&t.id, asset_id],
            )?;
            touch(c, &t.id, actor)?;
            event(
                c,
                Some(&t.jam_id),
                actor,
                "asset.linked",
                Some(&t.id),
                json!({
                "assetId":asset_id,"name":aj.1}
                ),
            )?;
            Ok(())
        })?;
        self.get_task(key)
    }
    pub fn list_tasks(&self, actor: Option<&str>, filter: TaskFilter) -> Result<TaskPage> {
        let limit = filter.limit.unwrap_or(50);
        if limit == 0 || limit > 200 {
            return Err(invalid("limit", "must be 1–200"));
        }
        if let Some(ss) = &filter.status {
            for s in ss {
                status(s)?;
            }
        }
        let offset = filter
            .cursor
            .as_deref()
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(|_| invalid("cursor", "expected a non-negative offset"))?;
        self.read(|c| {
            let j = jam(c)?;
            let mut rows = c
                .prepare(&format!(
                    "SELECT {TASK_COLUMNS} FROM tasks WHERE jam_id=? ORDER BY position,key"
                ))?
                .query_map([&j.id], task_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for t in &mut rows {
                t.tags = tags(c, &t.id)?;
                t.comment_count = c.query_row(
                    "SELECT count(*) FROM comments WHERE task_id=?",
                    [&t.id],
                    |r| r.get(0),
                )?;
            }
            let members = c
                .prepare("SELECT id,handle FROM members")?
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<std::result::Result<BTreeMap<_, _>, _>>()?;
            rows.retain(|t| {
                if !filter.include_archived.unwrap_or(false) && t.archived_at.is_some() {
                    return false;
                }
                if filter
                    .status
                    .as_ref()
                    .is_some_and(|ss| !ss.contains(&t.status))
                {
                    return false;
                }
                if let Some(a) = &filter.assignee {
                    let matches = match a.as_str() {
                        "unassigned" => t.assignee_id.is_none(),
                        "me" => actor.is_some() && t.assignee_id.as_deref() == actor,
                        _ => t.assignee_id.as_ref().and_then(|id| members.get(id)) == Some(a),
                    };
                    if !matches {
                        return false;
                    }
                }
                if filter
                    .tag
                    .as_ref()
                    .is_some_and(|tag| !t.tags.contains(&tag.trim().to_lowercase()))
                {
                    return false;
                }
                if let Some(q) = &filter.query {
                    let q = q.to_lowercase();
                    if !t.title.to_lowercase().contains(&q)
                        && !t.description_md.to_lowercase().contains(&q)
                    {
                        return false;
                    }
                }
                true
            });
            let next = if offset.saturating_add(limit) < rows.len() {
                Some(offset.saturating_add(limit).to_string())
            } else {
                None
            };
            Ok(TaskPage {
                tasks: rows.into_iter().skip(offset).take(limit).collect(),
                next_cursor: next,
            })
        })
    }
    pub fn list_members(&self) -> Result<Vec<MemberStats>> {
        self.read(|c| {
let j=jam(c).ok();
 let members=c.prepare("SELECT id, kind, name, handle, color, avatar, client, last_seen_at, created_at
FROM members ORDER BY created_at, id")?.query_map([],member_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
            members.into_iter().map(|m| {
let counts=c.prepare("SELECT status, count(*) FROM tasks WHERE assignee_id=? AND jam_id=? AND
archived_at IS NULL GROUP BY status")?.query_map(params![m.id,j.as_ref().map(|j|&j.id)],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?.collect::<std::result::Result<BTreeMap<_,_>,_>>()?;
                let working=c.prepare("SELECT key FROM tasks WHERE assignee_id=? AND jam_id=? AND status='in_progress'
AND archived_at IS NULL ORDER BY key")?.query_map(params![m.id,j.as_ref().map(|j|&j.id)],|r|r.get(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
                let online=m.last_seen_at.as_deref().and_then(|s|time::OffsetDateTime::parse(s,&time::format_description::well_known::Rfc3339).ok()).is_some_and(|t|time::OffsetDateTime::now_utc()-t<=time::Duration::seconds(120));
                Ok(MemberStats{
member:m,counts,online,working_on:working}
) }
).collect() }
)
    }
    pub fn list_assets(&self, kind: Option<&str>, query: Option<&str>) -> Result<Vec<Asset>> {
        if let Some(k) = kind
            && !["sprite", "audio", "level", "font", "other"].contains(&k)
        {
            return Err(invalid("kind", "invalid asset kind"));
        }
        self.read(|c| {
            let j = jam(c)?;
            let mut rows = all_assets(c, &j.id)?;
            rows.retain(|a| {
                kind.is_none_or(|k| a.kind == k)
                    && query.is_none_or(|q| {
                        format!(
                            "{} {} {}",
                            a.name,
                            a.location,
                            a.notes.as_deref().unwrap_or("")
                        )
                        .to_lowercase()
                        .contains(&q.to_lowercase())
                    })
            });
            Ok(rows)
        })
    }
    pub fn board(&self, actor: Option<&str>) -> Result<Value> {
        let j = self.active_jam()?;
        self.read(|c| {
let ts=c.prepare(&format!("SELECT {TASK_COLUMNS} FROM tasks WHERE jam_id=? AND archived_at IS NULL ORDER
BY position, key"))?.query_map([&j.id],task_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
            let summarize=|t:&TaskSummary|json!({
"key":t.key,"title":t.title,"priority":t.priority,"status":t.status,"assignee":t.assignee_id.as_deref().and_then(|id|member(c,id).ok()).as_ref().map(MemberRef::from)}
);
            let seconds=j.ends_at.as_deref().and_then(|s|time::OffsetDateTime::parse(s,&time::format_description::well_known::Rfc3339).ok()).map(|t|(t-time::OffsetDateTime::now_utc()).whole_seconds().max(0));
            Ok(json!({
"jam":{
"name":j.name,"theme":j.theme,"endsAt":j.ends_at,"timeLeft":seconds}
,"columns":STATUSES.iter().map(|s|json!({
"status":s,"count":ts.iter().filter(|t|&t.status==s).count()}
)).collect::<Vec<_>>(),"inProgress":ts.iter().filter(|t|t.status=="in_progress").map(summarize).collect::<Vec<_>>(),"myTasks":ts.iter().filter(|t|actor.is_some()&&t.assignee_id.as_deref()==actor).map(summarize).collect::<Vec<_>>() }
))
        }
).and_then(|mut board| {
board["onlineAgents"]=serde_json::to_value(self.list_members()?.into_iter().filter(|m|m.member.kind=="agent"&&m.online).collect::<Vec<_>>())?;
 Ok(board)}
)
    }
}

fn comment_body(body: &str) -> Result<()> {
    if !(1..=4000).contains(&body.chars().count()) || body.trim().is_empty() {
        Err(invalid(
            "body",
            "must contain 1–4000 characters and not be blank",
        ))
    } else {
        Ok(())
    }
}
fn insert_comment(c: &Connection, tid: &str, actor: &str, body: &str) -> Result<Comment> {
    let comment = Comment {
        id: id(),
        task_id: tid.into(),
        author_id: actor.into(),
        body_md: body.into(),
        created_at: now(),
    };
    c.execute(
        "INSERT INTO comments VALUES (?,?,?,?,?)",
        params![
            comment.id,
            comment.task_id,
            comment.author_id,
            comment.body_md,
            comment.created_at
        ],
    )?;
    Ok(comment)
}
fn validate_color(color: &str) -> Result<()> {
    if MEMBER_COLORS.contains(&color) {
        Ok(())
    } else {
        Err(invalid("color", "expected a member palette token value"))
    }
}
fn handle(name: &str) -> String {
    let s = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if s.is_empty() { "agent".into() } else { s }
}
fn unique_handle(c: &Connection, name: &str) -> Result<String> {
    let base = handle(name);
    let mut next = base.clone();
    let mut n = 2;
    while c
        .query_row("SELECT 1 FROM members WHERE handle=?", [&next], |r| {
            r.get::<_, i64>(0)
        })
        .optional()?
        .is_some()
    {
        next = format!("{base}-{n}");
        n += 1;
    }
    Ok(next)
}
fn diff(old: &TaskSummary, new: &TaskSummary) -> Result<Value> {
    let a = serde_json::to_value(old)?;
    let b = serde_json::to_value(new)?;
    let mut out = serde_json::Map::new();
    if let Some(fields) = b.as_object() {
        for (k, v) in fields {
            if a.get(k) != Some(v) {
                out.insert(k.clone(), json!([a.get(k), v]));
            }
        }
    }
    Ok(Value::Object(out))
}
pub(crate) fn asset_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    Ok(Asset {
        id: r.get(0)?,
        jam_id: r.get(1)?,
        kind: r.get(2)?,
        name: r.get(3)?,
        location: r.get(4)?,
        notes: r.get(5)?,
        created_by: r.get(6)?,
        created_at: r.get(7)?,
    })
}
pub(crate) fn all_assets(c: &Connection, jid: &str) -> Result<Vec<Asset>> {
    Ok(c.prepare(
        "SELECT id, jam_id, kind, name, location, notes, created_by, created_at FROM
assets WHERE jam_id=? ORDER BY created_at, id",
    )?
    .query_map([jid], asset_row)?
    .collect::<std::result::Result<_, _>>()?)
}
pub(crate) fn detail(c: &Connection, key: &str) -> Result<TaskDetail> {
    let t = task(c, key)?;
    let assets = c
        .prepare(
            "SELECT a.id, a.jam_id, a.kind, a.name, a.location, a.notes, a.created_by,
a.created_at FROM assets a JOIN task_assets ta ON ta.asset_id=a.id WHERE
ta.task_id=?",
        )?
        .query_map([&t.id], asset_row)?
        .collect::<std::result::Result<_, _>>()?;
    let comments = c
        .prepare(
            "SELECT id, task_id, author_id, body_md, created_at FROM comments WHERE
task_id=? ORDER BY created_at, id",
        )?
        .query_map([&t.id], |r| {
            Ok(Comment {
                id: r.get(0)?,
                task_id: r.get(1)?,
                author_id: r.get(2)?,
                body_md: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    let activity = crate::db::activity(c, 0, Some(&t.id), Some(20))?;
    let history = crate::db::activity(c, 0, Some(&t.id), Some(50))?;
    Ok(TaskDetail {
        task: t,
        assets,
        comments,
        activity,
        history,
    })
}
