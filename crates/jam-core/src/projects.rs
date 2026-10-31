//! Durable human selection and immutable, connection-local agent project scopes.
use crate::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use specta::Type;

pub(crate) const JAM_COLUMNS: &str =
    "id,name,theme,starts_at,ends_at,timezone,task_seq,key_prefix,created_at,template,milestone_at";
pub(crate) fn jam_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Jam> {
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
        template: r.get(9)?,
        milestone_at: r.get(10)?,
    })
}

pub(crate) fn bound_project(c: &Connection) -> Result<Option<String>> {
    Ok(
        c.query_row("SELECT project_id FROM temp.jam_project_context", [], |r| {
            r.get(0)
        })?,
    )
}
pub(crate) fn selected_jam(c: &Connection) -> Result<Jam> {
    let pin = bound_project(c)?;
    let selected = if let Some(pin) = pin {
        Some(pin)
    } else {
        c.query_row(
            "SELECT value FROM settings WHERE key='current_project_id'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    };
    let Some(selected) = selected else {
        return Err(Error::NotFound(
            "active project: create or select a project first".into(),
        ));
    };
    let archived = c
        .query_row("SELECT archived FROM jams WHERE id=?", [&selected], |r| {
            r.get::<_, bool>(0)
        })
        .optional()?
        .ok_or_else(|| Error::NotFound("selected project".into()))?;
    if archived {
        return Err(Error::Archived(
            "This project is archived; restore it before continuing".into(),
        ));
    }
    Ok(c.query_row(
        &format!("SELECT {JAM_COLUMNS} FROM jams WHERE id=?"),
        [&selected],
        jam_row,
    )?)
}
/// An unbound Store retains the legacy explicit-key API. Agent Stores are strict.
pub(crate) fn ensure_scope(c: &Connection, project_id: &str) -> Result<()> {
    if let Some(pin) = bound_project(c)? {
        if pin != project_id {
            return Err(Error::Forbidden("This entity belongs to another project. Reconnect with the intended project binding.".into()));
        }
        selected_jam(c)?;
    }
    Ok(())
}
pub(crate) fn put_setting(c: &Connection, key: &str, value: &str) -> Result<()> {
    c.execute("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key,value])?;
    Ok(())
}
pub(crate) fn join_member(c: &Connection, project: &str, member: &str) -> Result<bool> {
    Ok(c.execute(
        "INSERT OR IGNORE INTO project_members(jam_id,member_id) VALUES (?,?)",
        [project, member],
    )? > 0)
}
pub(crate) fn ensure_member_scope(c: &Connection, member: &str) -> Result<()> {
    if let Some(project) = bound_project(c)? {
        let joined: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM project_members WHERE jam_id=? AND member_id=?)",
            [project.as_str(), member],
            |r| r.get(0),
        )?;
        if !joined {
            return Err(Error::Forbidden(
                "This member has not joined this project".into(),
            ));
        }
    }
    Ok(())
}
pub(crate) fn project_member(c: &Connection, mut m: Member) -> Result<Member> {
    if let Ok(j) = selected_jam(c) {
        let state = c.query_row("SELECT last_seen_at,status_text,status_scope_json,status_at FROM project_members WHERE jam_id=? AND member_id=?", params![j.id,m.id], |r| Ok((r.get::<_,Option<String>>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?))).optional()?;
        m.last_seen_at = None;
        m.status_text.clear();
        m.status_scope = None;
        m.status_at = None;
        if let Some((seen, text, scope, at)) = state {
            m.last_seen_at = seen;
            m.status_text = text;
            m.status_scope = scope.map(|v| serde_json::from_str(&v)).transpose()?;
            m.status_at = at;
        }
    }
    Ok(m)
}
pub(crate) fn select(c: &Connection, project: &str, actor: Option<&str>) -> Result<()> {
    if bound_project(c)?.is_some() {
        return Err(Error::Forbidden(
            "A bound session cannot change the selected project".into(),
        ));
    }
    let archived = c
        .query_row("SELECT archived FROM jams WHERE id=?", [project], |r| {
            r.get::<_, bool>(0)
        })
        .optional()?
        .ok_or_else(|| Error::NotFound("project".into()))?;
    if archived {
        return Err(Error::Archived(
            "Restore this project before opening it".into(),
        ));
    }
    put_setting(c, "current_project_id", project)?;
    let key = format!("project.{project}.current_member_id");
    let remembered = c
        .query_row("SELECT value FROM settings WHERE key=?", [&key], |r| {
            r.get::<_, String>(0)
        })
        .optional()?;
    let identity=remembered.or_else(||actor.map(str::to_owned)).or_else(||c.query_row("SELECT a.actor_id FROM activity a JOIN members m ON m.id=a.actor_id WHERE a.jam_id=? AND m.kind='human' ORDER BY a.seq LIMIT 1",[project],|r|r.get::<_,String>(0)).optional().ok().flatten());
    if let Some(identity) = identity {
        crate::m5::require_human(c, &identity)?;
        join_member(c, project, &identity)?;
        put_setting(c, "current_member_id", &identity)?;
        put_setting(c, &key, &identity)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub moved_to: Option<String>,
    #[serde(flatten)]
    pub jam: Jam,
    pub archived: bool,
    pub selected: bool,
    pub task_count: i64,
    pub in_progress_count: i64,
}
impl Store {
    pub fn moved_project_folder(&self, project: &str) -> Result<Option<String>> {
        self.read(|c| {
            Ok(
                c.query_row("SELECT moved_to FROM jams WHERE id=?", [project], |r| {
                    r.get::<_, Option<String>>(0)
                })
                .optional()?
                .flatten(),
            )
        })
    }
    /// Immutable per-Store project identity; pooled connections are scoped only while locked.
    pub fn for_project(&self, selector: &str) -> Result<Self> {
        let id = self.read(|c| {
            let (id, archived) = c
                .query_row(
                    "SELECT id,archived FROM jams WHERE id=?1 OR key_prefix=?1",
                    [selector],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)),
                )
                .optional()?
                .ok_or_else(|| Error::NotFound(format!("project {selector}")))?;
            if archived {
                return Err(Error::Archived(
                    "This project is archived; restore it before connecting".into(),
                ));
            }
            ensure_scope(c, &id)?;
            Ok(id)
        })?;
        let mut scoped = self.clone();
        scoped.project_id = Some(id);
        Ok(scoped)
    }
    pub fn bound_project_id(&self) -> Result<Option<String>> {
        Ok(self.project_id.clone())
    }
    pub fn selected_snapshot(&self) -> Result<Self> {
        self.for_project(&self.active_jam()?.id)
    }
    pub fn selected_events(&self, events: Vec<ActivityEvent>) -> Result<Vec<ActivityEvent>> {
        self.read(|c| {
            let selected = match selected_jam(c) {
                Ok(j) => j.id,
                Err(Error::NotFound(_) | Error::Archived(_)) => return Ok(Vec::new()),
                Err(e) => return Err(e),
            };
            events
                .into_iter()
                .filter_map(|event| {
                    match c.query_row(
                        "SELECT jam_id FROM activity WHERE seq=?",
                        [event.seq],
                        |r| r.get::<_, Option<String>>(0),
                    ) {
                        Ok(project) if project.as_deref() == Some(&selected) => Some(Ok(event)),
                        Ok(_) => None,
                        Err(e) => Some(Err(e.into())),
                    }
                })
                .collect()
        })
    }
    pub fn list_projects(&self, include_archived: bool) -> Result<Vec<ProjectSummary>> {
        self.read(|c| {
            let selected=selected_jam(c).ok().map(|j|j.id);
            let pin=bound_project(c)?;
            let mut statement=c.prepare(&format!("SELECT {JAM_COLUMNS},archived,(SELECT count(*) FROM tasks t WHERE t.jam_id=jams.id AND t.archived_at IS NULL),(SELECT count(*) FROM tasks t WHERE t.jam_id=jams.id AND t.status='in_progress'),moved_to FROM jams WHERE (?1 OR archived=0) AND (?2 IS NULL OR id=?2) ORDER BY archived,created_at DESC,id DESC"))?;
            Ok(statement.query_map(params![include_archived,pin],|r|{let jam=jam_row(r)?;Ok(ProjectSummary{moved_to:r.get(14)?,selected:selected.as_deref()==Some(&jam.id),jam,archived:r.get(11)?,task_count:r.get(12)?,in_progress_count:r.get(13)?})})?.collect::<std::result::Result<Vec<_>,_>>()?)
        })
    }
    pub fn select_project(&self, project_id: &str) -> Result<AppState> {
        if let Some(folder) = self.moved_project_folder(project_id)? {
            return Err(Error::Forbidden(format!(
                "moved → {folder}; open the registered board"
            )));
        }
        self.write_control(|c| {
            let actor = c
                .query_row(
                    "SELECT value FROM settings WHERE key='current_member_id'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .optional()?;
            select(c, project_id, actor.as_deref())
        })?;
        self.app_state()
    }
    pub fn restore_project(&self, project_id: &str) -> Result<AppState> {
        self.write(|c| {
            if bound_project(c)?.is_some() {
                return Err(Error::Forbidden(
                    "Only the desktop may restore projects".into(),
                ));
            }
            let actor = c
                .query_row(
                    "SELECT value FROM settings WHERE key='current_member_id'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| invalid("currentMember", "Choose a human identity"))?;
            crate::m5::require_human(c, &actor)?;
            let old = c
                .query_row(
                    "SELECT name,archived FROM jams WHERE id=?",
                    [project_id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)),
                )
                .optional()?
                .ok_or_else(|| Error::NotFound("project".into()))?;
            if old.1 {
                c.execute("UPDATE jams SET archived=0 WHERE id=?", [project_id])?;
                crate::service::event(
                    c,
                    Some(project_id),
                    &actor,
                    "jam.restored",
                    None,
                    serde_json::json!({"name":old.0}),
                )?;
            }
            select(c, project_id, Some(&actor))
        })?;
        self.app_state()
    }
}
