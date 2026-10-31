use crate::service::{event, jam, member, task};
use crate::*;
use rusqlite::{
    Connection, OptionalExtension, params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

fn camel(s: &str) -> String {
    let mut upper = false;
    let mut out = String::new();
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}
fn snake(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_uppercase() {
            out.push('_');
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}
pub(crate) fn column(field: &str) -> String {
    let s = snake(field);
    if [
        "acceptance",
        "changes",
        "tests",
        "changed_files",
        "failed_tests",
        "options",
        "tags",
    ]
    .contains(&s.as_str())
    {
        format!("{s}_json")
    } else {
        s
    }
}
pub(crate) fn row_value(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let mut map = serde_json::Map::new();
    for (i, name) in r.as_ref().column_names().iter().enumerate() {
        let raw = r.get_ref(i)?;
        let value = match raw {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n)
                if ["allow_free_text", "changes_requested", "collapsed"].contains(name) =>
            {
                json!(n != 0)
            }
            ValueRef::Integer(n) => json!(n),
            ValueRef::Real(n) => json!(n),
            ValueRef::Text(t) => {
                let s = String::from_utf8_lossy(t);
                if name.ends_with("_json") {
                    serde_json::from_str(&s).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            i,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?
                } else {
                    json!(s)
                }
            }
            ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidQuery),
        };
        map.insert(camel(name.strip_suffix("_json").unwrap_or(name)), value);
    }
    Ok(Value::Object(map))
}
pub(crate) fn fetch<T: DeserializeOwned>(
    c: &Connection,
    table: &str,
    column: &str,
    key: &str,
) -> Result<T> {
    let mut value = c
        .query_row(
            &format!("SELECT * FROM {table} WHERE {column}=?"),
            [key],
            row_value,
        )
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("{table} {key}")))?;
    if let Some(project) = value.get("jamId").and_then(Value::as_str) {
        crate::projects::ensure_scope(c, project)?;
    }
    if table == "ref_frames" {
        value["links"] = serde_json::to_value(crate::references::frame_targets(
            c,
            value["id"].as_str().unwrap_or(""),
        )?)?;
    }
    if table == "ref_items"
        && let Some(asset) = value.get("assetId").and_then(Value::as_str)
    {
        let file = crate::file_model::load_file(c, asset, None)?;
        value["file"] = serde_json::to_value(file)?;
    }
    Ok(serde_json::from_value(value)?)
}
pub(crate) fn records<T: DeserializeOwned>(
    c: &Connection,
    table: &str,
    filter: &str,
    values: &[&dyn rusqlite::ToSql],
) -> Result<Vec<T>> {
    c.prepare(&format!("SELECT * FROM {table} WHERE {filter}"))?
        .query_map(values, row_value)?
        .map(|r| {
            let mut value = r?;
            if let Some(project) = value.get("jamId").and_then(Value::as_str) {
                crate::projects::ensure_scope(c, project)?;
            }
            if table == "ref_frames" {
                value["links"] = serde_json::to_value(crate::references::frame_targets(
                    c,
                    value["id"].as_str().unwrap_or(""),
                )?)?;
            }
            if table == "ref_items"
                && let Some(asset) = value.get("assetId").and_then(Value::as_str)
            {
                let file = crate::file_model::load_file(c, asset, None)?;
                value["file"] = serde_json::to_value(file)?;
            }
            Ok(serde_json::from_value(value)?)
        })
        .collect()
}
fn sql_value(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.))),
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => SqlValue::Text(v.to_string()),
    }
}
pub(crate) fn insert(c: &Connection, table: &str, data: &impl Serialize) -> Result<()> {
    let mut object = serde_json::to_value(data)?;
    if let Some(fields) = object.as_object_mut() {
        if table == "ref_frames" {
            fields.remove("links");
        }
        if table == "ref_items" {
            fields.remove("file");
            fields.remove("via");
            fields.remove("frameTitle");
        }
    }
    let object = object
        .as_object()
        .ok_or_else(|| invalid("record", "Expected object"))?;
    let columns = object.keys().map(|k| column(k)).collect::<Vec<_>>();
    let values = object.values().map(sql_value).collect::<Vec<_>>();
    c.execute(
        &format!(
            "INSERT INTO {table}({}) VALUES ({})",
            columns.join(","),
            vec!["?"; columns.len()].join(",")
        ),
        params_from_iter(values),
    )?;
    Ok(())
}
pub(crate) fn patch_record(c: &Connection, table: &str, id: &str, patch: &Value) -> Result<()> {
    let object = patch
        .as_object()
        .ok_or_else(|| invalid("patch", "Expected object"))?;
    if object.is_empty() {
        return Ok(());
    }
    let fields = object
        .keys()
        .map(|k| format!("{}=?", column(k)))
        .collect::<Vec<_>>();
    let mut values = object.values().map(sql_value).collect::<Vec<_>>();
    values.push(SqlValue::Text(id.into()));
    c.execute(
        &format!("UPDATE {table} SET {} WHERE id=?", fields.join(",")),
        params_from_iter(values),
    )?;
    Ok(())
}
pub(crate) fn audit(c: &Connection, actor: &str) -> Result<Audit> {
    let j = jam(c)?;
    member(c, actor)?;
    let stamp = now();
    Ok(Audit {
        id: id(),
        jam_id: j.id,
        position: 1024.,
        created_by: actor.into(),
        updated_by: actor.into(),
        created_at: stamp.clone(),
        updated_at: stamp,
        archived_at: None,
    })
}
pub(crate) fn editable_audit(a: &Audit) -> Result<()> {
    if a.archived_at.is_some() {
        Err(Error::Archived(a.id.clone()))
    } else {
        Ok(())
    }
}
pub(crate) fn epic(c: &Connection, key: &str) -> Result<Epic> {
    let e: Epic = fetch(c, "epics", "key", key).or_else(|err| {
        if matches!(err, Error::NotFound(_)) {
            fetch(c, "epics", "id", key)
        } else {
            Err(err)
        }
    })?;
    Ok(e)
}
pub(crate) fn story(c: &Connection, key: &str) -> Result<Story> {
    fetch(c, "stories", "key", key).or_else(|err| {
        if matches!(err, Error::NotFound(_)) {
            fetch(c, "stories", "id", key)
        } else {
            Err(err)
        }
    })
}
pub(crate) fn task_epic(c: &Connection, t: &TaskSummary) -> Result<Epic> {
    epic(c, &story(c, &t.story_id)?.epic_id)
}
pub(crate) fn privileged(c: &Connection, actor: &str, e: &Epic) -> Result<bool> {
    Ok(member(c, actor)?.kind == "human" || e.brain_member_id.as_deref() == Some(actor))
}
pub(crate) fn require_privileged(c: &Connection, actor: &str, e: &Epic) -> Result<()> {
    if privileged(c, actor, e)? {
        Ok(())
    } else {
        Err(Error::Forbidden(
            "Only a human or this epic's brain may do this".into(),
        ))
    }
}
pub(crate) fn validate_epic(e: &Epic) -> Result<()> {
    crate::m5::validate_name("title", &e.title, 140)?;
    if e.status == "active" && (e.goal_md.trim().is_empty() || e.done_when_md.trim().is_empty()) {
        return Err(invalid(
            "epic",
            "Active epics require goalMd and doneWhenMd",
        ));
    }
    if !["m1", "m2", "m3", "m4", "m5", "m6"].contains(&e.color.as_str()) {
        return Err(invalid("color", "Choose m1 through m6"));
    }
    if !["each_iteration", "first_sketch", "autonomous"].contains(&e.participation.as_str()) {
        return Err(invalid(
            "participation",
            "Choose each_iteration, first_sketch or autonomous",
        ));
    }
    if !["none", "final", "stages"].contains(&e.reviewer.as_str()) {
        return Err(invalid("reviewer", "Choose none, final or stages"));
    }
    Ok(())
}
pub(crate) fn validate_story(s: &Story) -> Result<()> {
    crate::m5::validate_name("title", &s.title, 140)?;
    if s.status == "active"
        && (s.outcome_md.trim().is_empty() || !s.acceptance.iter().any(|a| a.mandatory))
    {
        return Err(invalid(
            "story",
            "Active stories require outcomeMd and mandatory acceptance",
        ));
    }
    let mut ids = std::collections::BTreeSet::new();
    for a in &s.acceptance {
        if a.id.trim().is_empty()
            || !ids.insert(&a.id)
            || a.criterion.trim().is_empty()
            || a.check.trim().is_empty()
        {
            return Err(invalid(
                "acceptance",
                "Each criterion needs a unique id, criterion and check",
            ));
        }
    }
    Ok(())
}
pub(crate) fn v2_event(
    c: &Connection,
    actor: &str,
    epic_id: Option<&str>,
    action: &str,
    task_id: Option<&str>,
    mut payload: Value,
) -> Result<()> {
    payload["epicId"] = json!(epic_id);
    // Explicit keys may address an older project. Attribute its event to that
    // project, and roll the whole transaction back if the project is archived.
    let mut project = epic_id
        .map(|id| epic(c, id).map(|e| e.audit.jam_id))
        .transpose()?;
    if project.is_none() {
        for (field, table) in [
            ("itemId", "ref_items"),
            ("frameId", "ref_frames"),
            ("edgeId", "ref_edges"),
            ("questionId", "questions"),
        ] {
            if let Some(id) = payload[field].as_str() {
                project = Some(c.query_row(
                    &format!("SELECT jam_id FROM {table} WHERE id=?"),
                    [id],
                    |r| r.get::<_, String>(0),
                )?);
                break;
            }
        }
    }
    let project = project.unwrap_or(jam(c)?.id);
    let archived: bool = c.query_row("SELECT archived FROM jams WHERE id=?", [&project], |r| {
        r.get(0)
    })?;
    if archived {
        return Err(Error::Archived("This project is archived".into()));
    }
    event(c, Some(&project), actor, action, task_id, payload)
}
fn next(c: &Connection, kind: &str) -> Result<(String, i64)> {
    let j = jam(c)?;
    let counter = format!("{kind}_seq");
    let n: i64 = c.query_row(
        &format!("UPDATE jams SET {counter}={counter}+1 WHERE id=? RETURNING {counter}"),
        [j.id],
        |r| r.get(0),
    )?;
    Ok((
        format!(
            "{}-{}{n}",
            j.key_prefix,
            if kind == "epic" { "E" } else { "S" }
        ),
        n,
    ))
}
impl Store {
    pub fn get_project(&self) -> Result<Project> {
        self.read(|c| {
            let j = jam(c)?;
            let count = |table: &str| {
                c.query_row(
                    &format!("SELECT count(*) FROM {table} WHERE jam_id=? AND archived_at IS NULL"),
                    [&j.id],
                    |r| r.get(0),
                )
            };
            Ok(Project {
                template: j.template.clone(),
                milestone_at: j.milestone_at.clone(),
                template_label: template_label(&j.template).into(),
                tag_suggestions: tag_suggestions(&j.template),
                epics: count("epics")?,
                stories: count("stories")?,
                tasks: count("tasks")?,
                open_questions: c.query_row(
                    "SELECT count(*) FROM questions WHERE jam_id=? AND status='open'",
                    [&j.id],
                    |r| r.get(0),
                )?,
                jam: j,
            })
        })
    }
    pub fn update_project(
        &self,
        actor: &str,
        template: &str,
        milestone: Option<&str>,
    ) -> Result<Project> {
        self.edit_project(
            actor,
            ProjectEditInput {
                template: template.into(),
                milestone_at: milestone.map(str::to_owned),
                ..Default::default()
            },
        )
    }
    pub fn edit_project(&self, actor: &str, input: ProjectEditInput) -> Result<Project> {
        validate_template(&input.template)?;
        let milestone = if matches!(input.template.as_str(), "gamedev" | "webapp") {
            crate::service::utc_date(input.milestone_at.as_deref())?
        } else {
            None
        };
        self.write(|c| {
            crate::m5::require_human(c, actor)?;
            let j = jam(c)?;
            let name = input.name.as_deref().unwrap_or(&j.name).trim();
            crate::m5::validate_name("name", name, 60)?;
            let timezone = input.timezone.as_deref().unwrap_or(&j.timezone);
            if timezone.trim().is_empty() {
                return Err(invalid("timezone", "Choose a timezone"));
            }
            let (start, end) = if input.template == "game_jam" {
                (input.starts_at.as_deref().or(j.starts_at.as_deref()),
                 input.ends_at.as_deref().or(j.ends_at.as_deref()))
            } else {
                (None, None)
            };
            if input.template == "game_jam" {
                validate_project_dates(start, end)?;
            }
            let start = crate::service::utc_date(start)?;
            let end = crate::service::utc_date(end)?;
            c.execute(
                "UPDATE jams SET name=?,template=?,milestone_at=?,starts_at=?,ends_at=?,timezone=? WHERE id=?",
                params![name, input.template, milestone, start, end, timezone, j.id],
            )?;
            event(c, Some(&j.id), actor, "project.updated", None,
                json!({"fields":["name","template","milestoneAt","startsAt","endsAt","timezone"]}))
        })?;
        self.refresh_registry_name()?;
        self.get_project()
    }
    pub fn create_epic(&self, actor: &str, input: NewEpic) -> Result<Epic> {
        self.write(|c| {
            let mut a = audit(c, actor)?;
            let (key, n) = next(c, "epic")?;
            a.position = n as f64 * 1024.;
            let e = Epic {
                audit: a,
                key,
                title: input.title,
                color: input
                    .color
                    .unwrap_or_else(|| format!("m{}", (n - 1) % 6 + 1)),
                status: "draft".into(),
                goal_md: input.goal_md.unwrap_or_default(),
                done_when_md: input.done_when_md.unwrap_or_default(),
                not_included_md: input.not_included_md.unwrap_or_default(),
                decided_md: input.decided_md.unwrap_or_default(),
                open_questions_md: input.open_questions_md.unwrap_or_default(),
                participation: input.participation.unwrap_or_else(|| "first_sketch".into()),
                reviewer: input.reviewer.unwrap_or_else(|| "none".into()),
                worker_model: input.worker_model,
                brain_member_id: None,
            };
            validate_epic(&e)?;
            insert(c, "epics", &e)?;
            v2_event(
                c,
                actor,
                Some(&e.audit.id),
                "epic.created",
                None,
                json!({"key":e.key,"title":e.title}),
            )?;
            Ok(e)
        })
    }
    pub fn update_epic(&self, actor: &str, key: &str, input: EpicPatch) -> Result<Epic> {
        self.write(|c| {
            member(c, actor)?;
            let old = epic(c, key)?;
            editable_audit(&old.audit)?;
            let patch = serde_json::to_value(input)?;
            let mut merged = serde_json::to_value(&old)?;
            for (k, v) in patch.as_object().unwrap() {
                merged[k] = v.clone();
            }
            let e: Epic = serde_json::from_value(merged)?;
            validate_epic(&e)?;
            patch_record(c, "epics", &old.audit.id, &patch)?;
            patch_record(
                c,
                "epics",
                &old.audit.id,
                &json!({"updatedBy":actor,"updatedAt":crate::context::next_version(&old.audit.updated_at)?}),
            )?;
            v2_event(
                c,
                actor,
                Some(&old.audit.id),
                "epic.updated",
                None,
                json!({"key":key,"fields":patch.as_object().unwrap().keys().collect::<Vec<_>>()}),
            )?;
            epic(c, key)
        })
    }
    pub fn list_epics(&self) -> Result<Vec<Epic>> {
        self.read(|c| {
            let j = jam(c)?;
            records(
                c,
                "epics",
                "jam_id=? AND archived_at IS NULL ORDER BY position,id",
                &[&j.id],
            )
        })
    }
    pub fn create_story(&self, actor: &str, input: NewStory) -> Result<Story> {
        self.write(|c| {
            let mut a = audit(c, actor)?;
            let e = epic(c, &input.epic_key)?;
            editable_audit(&e.audit)?;
            if e.audit.jam_id != a.jam_id {
                return Err(invalid("epicKey", "Choose an epic in the active project"));
            }
            let (key, n) = next(c, "story")?;
            a.position = n as f64 * 1024.;
            let s = Story {
                audit: a,
                key,
                epic_id: e.audit.id.clone(),
                title: input.title,
                status: "draft".into(),
                outcome_md: input.outcome_md.unwrap_or_default(),
                basis_md: input.basis_md.unwrap_or_default(),
                preserve_md: input.preserve_md.unwrap_or_default(),
                scale_md: input.scale_md.unwrap_or_default(),
                rejection_risks_md: input.rejection_risks_md.unwrap_or_default(),
                open_decisions_md: input.open_decisions_md.unwrap_or_default(),
                acceptance: input.acceptance.unwrap_or_default(),
            };
            validate_story(&s)?;
            insert(c, "stories", &s)?;
            v2_event(
                c,
                actor,
                Some(&e.audit.id),
                "story.created",
                None,
                json!({"key":s.key,"title":s.title}),
            )?;
            Ok(s)
        })
    }
    pub fn update_story(&self, actor: &str, key: &str, input: StoryPatch) -> Result<Story> {
        self.write(|c| {
            member(c, actor)?;
            let old = story(c, key)?;
            editable_audit(&old.audit)?;
            editable_audit(&epic(c, &old.epic_id)?.audit)?;
            let patch = serde_json::to_value(input)?;
            let mut merged = serde_json::to_value(&old)?;
            for (k, v) in patch.as_object().unwrap() {
                merged[k] = v.clone();
            }
            let s: Story = serde_json::from_value(merged)?;
            validate_story(&s)?;
            patch_record(c, "stories", &old.audit.id, &patch)?;
            patch_record(
                c,
                "stories",
                &old.audit.id,
                &json!({"updatedBy":actor,"updatedAt":crate::context::next_version(&old.audit.updated_at)?}),
            )?;
            v2_event(
                c,
                actor,
                Some(&old.epic_id),
                "story.updated",
                None,
                json!({"key":key,"fields":patch.as_object().unwrap().keys().collect::<Vec<_>>()}),
            )?;
            story(c, key)
        })
    }
    pub fn become_brain(&self, actor: &str, key: &str) -> Result<Epic> {
        self.write(|c| {
            let e = epic(c, key)?;
            editable_audit(&e.audit)?;
            let m = member(c, actor)?;
            if m.kind != "agent" {
                return Err(invalid("actor", "Choose an agent as brain"));
            }
            if let Some(current) = &e.brain_member_id
                && current != actor
            {
                return Err(Error::Forbidden(format!(
                    "The current brain is {}",
                    member(c, current)?.name
                )));
            }
            c.execute(
                "UPDATE epics SET brain_member_id=?,updated_by=?,updated_at=? WHERE id=?",
                params![
                    actor,
                    actor,
                    crate::context::next_version(&e.audit.updated_at)?,
                    e.audit.id
                ],
            )?;
            v2_event(
                c,
                actor,
                Some(&e.audit.id),
                "epic.updated",
                None,
                json!({"key":key,"fields":["brainMemberId"]}),
            )?;
            epic(c, key)
        })
    }
    pub fn set_brain(&self, actor: &str, key: &str, handle: &str) -> Result<Epic> {
        self.write(|c| {
            let e = epic(c, key)?;
            editable_audit(&e.audit)?;
            require_privileged(c, actor, &e)?;
            let id: String = c
                .query_row(
                    "SELECT id FROM members WHERE handle=? AND kind='agent'",
                    [handle],
                    |r| r.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::NotFound(format!("agent {handle}")))?;
            crate::projects::join_member(c, &e.audit.jam_id, &id)?;
            c.execute(
                "UPDATE epics SET brain_member_id=?,updated_by=?,updated_at=? WHERE id=?",
                params![
                    id,
                    actor,
                    crate::context::next_version(&e.audit.updated_at)?,
                    e.audit.id
                ],
            )?;
            v2_event(
                c,
                actor,
                Some(&e.audit.id),
                "epic.updated",
                None,
                json!({"key":key,"fields":["brainMemberId"]}),
            )?;
            epic(c, key)
        })
    }
    pub fn set_epic_status(
        &self,
        actor: &str,
        key: &str,
        status: &str,
        reason: Option<&str>,
    ) -> Result<Epic> {
        self.write(|c|{
        let e=epic(c,key)?;if member(c,actor)?.kind!="human"{editable_audit(&e.audit)?;}require_privileged(c,actor,&e)?;planning_status(status)?;
        if status=="active"{let missing=[("goalMd",&e.goal_md),("doneWhenMd",&e.done_when_md)].into_iter().filter(|(_,v)|v.trim().is_empty()).map(|(k,_)|k).collect::<Vec<_>>();if !missing.is_empty(){return Err(invalid("epic",&format!("Missing {}",missing.join(", "))));}}
        let incomplete:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM stories WHERE epic_id=? AND archived_at IS NULL AND status!='done')",[&e.audit.id],|r|r.get(0))?;if status=="done"&&incomplete{override_reason(reason)?;}
        if matches!(status,"done"|"archived") || matches!(e.status.as_str(),"done"|"archived") { crate::execution::revoke_scope(c,actor,&ExecutionScope{kind:ExecutionScopeType::Epic,id:e.audit.id.clone()})?; }
        c.execute("UPDATE epics SET status=?,archived_at=?,updated_by=?,updated_at=? WHERE id=?",params![status,if status=="archived"{Some(now())}else{None},actor,crate::context::next_version(&e.audit.updated_at)?,e.audit.id])?;v2_event(c,actor,Some(&e.audit.id),"epic.status",None,json!({"key":key,"status":[e.status,status],"overrideReason":reason}))?;epic(c,key)
    })
    }
    pub fn set_story_status(
        &self,
        actor: &str,
        key: &str,
        status: &str,
        reason: Option<&str>,
    ) -> Result<Story> {
        self.write(|c|{
        let s=story(c,key)?;if member(c,actor)?.kind!="human"{editable_audit(&s.audit)?;}let e=epic(c,&s.epic_id)?;editable_audit(&e.audit)?;require_privileged(c,actor,&e)?;planning_status(status)?;
        if status=="active"{let mut missing=vec![];if s.outcome_md.trim().is_empty(){missing.push("outcomeMd");}
if !s.acceptance.iter().any(|a|a.mandatory){missing.push("acceptance (mandatory)");}
if !missing.is_empty(){return Err(invalid("story",&format!("Missing {}",missing.join(", "))));}}
        let incomplete:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM tasks WHERE story_id=? AND archived_at IS NULL AND status!='done')",[&s.audit.id],|r|r.get(0))?;if status=="done"&&incomplete{override_reason(reason)?;}
        if matches!(status,"done"|"archived") || matches!(s.status.as_str(),"done"|"archived") { crate::execution::revoke_scope(c,actor,&ExecutionScope{kind:ExecutionScopeType::Story,id:s.audit.id.clone()})?; }
        c.execute("UPDATE stories SET status=?,archived_at=?,updated_by=?,updated_at=? WHERE id=?",params![status,if status=="archived"{Some(now())}else{None},actor,crate::context::next_version(&s.audit.updated_at)?,s.audit.id])?;v2_event(c,actor,Some(&s.epic_id),"story.status",None,json!({"key":key,"status":[s.status,status],"overrideReason":reason}))?;story(c,key)
    })
    }
    pub fn get_story(&self, key: &str) -> Result<StoryTree> {
        self.read(|c| story_tree(c, &story(c, key)?))
    }
    pub fn get_epic(&self, key: &str) -> Result<EpicTree> {
        self.read(|c| {
            let e = epic(c, key)?;
            let stories: Vec<Story> = records(
                c,
                "stories",
                "epic_id=? AND archived_at IS NULL ORDER BY position,id",
                &[&e.audit.id],
            )?;
            let stories = stories
                .iter()
                .map(|s| story_tree(c, s))
                .collect::<Result<Vec<_>>>()?;
            let journal = journal(c, &e.audit.id, 30)?;
            let open_questions = records(
                c,
                "questions",
                "epic_id=? AND status='open' ORDER BY created_at,id",
                &[&e.audit.id],
            )?;
            Ok(EpicTree {
                epic: e,
                stories,
                journal,
                open_questions,
            })
        })
    }
    pub fn epic_journal(&self, key: &str, after: i64) -> Result<Vec<ActivityEvent>> {
        self.read(|c| {
            let e = epic(c, key)?;
            Ok(crate::db::activity(c, after, None, None)?
                .into_iter()
                .filter(|a| a.epic_id.as_deref() == Some(&e.audit.id))
                .collect())
        })
    }
    pub fn list_changes_since(
        &self,
        cursor: i64,
        epic_key: Option<&str>,
    ) -> Result<Vec<ActivityEvent>> {
        if cursor < 0 {
            return Err(invalid("cursor", "Use a non-negative activity cursor"));
        }
        self.read(|c| {
            let j = jam(c)?;
            let eid = epic_key
                .map(|k| epic(c, k).map(|e| e.audit.id))
                .transpose()?;
            let ids = c
                .prepare("SELECT seq FROM activity WHERE jam_id=? AND seq>?")?
                .query_map(params![j.id, cursor], |r| r.get::<_, i64>(0))?
                .collect::<std::result::Result<std::collections::BTreeSet<_>, _>>()?;
            Ok(crate::db::activity(c, cursor, None, None)?
                .into_iter()
                .filter(|e| {
                    ids.contains(&e.seq)
                        && eid.as_ref().is_none_or(|id| e.epic_id.as_ref() == Some(id))
                })
                .collect())
        })
    }
}
fn planning_status(s: &str) -> Result<()> {
    if ["draft", "active", "done", "archived"].contains(&s) {
        Ok(())
    } else {
        Err(invalid("status", "Choose draft, active, done or archived"))
    }
}
pub(crate) fn override_reason(s: Option<&str>) -> Result<&str> {
    s.filter(|s| !s.trim().is_empty())
        .ok_or_else(|| invalid("overrideReason", "A non-empty override reason is required"))
}
fn story_tree(c: &Connection, s: &Story) -> Result<StoryTree> {
    let keys = c
        .prepare(
            "SELECT key FROM tasks WHERE story_id=? AND archived_at IS NULL ORDER BY position,key",
        )?
        .query_map([&s.audit.id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let tasks = keys
        .iter()
        .map(|key| {
            Ok(TaskReady {
                task: task(c, key)?,
                readiness: crate::workflow::readiness(c, key)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(StoryTree {
        story: s.clone(),
        tasks,
    })
}
fn journal(c: &Connection, epic_id: &str, limit: usize) -> Result<Vec<ActivityEvent>> {
    let mut rows = crate::db::activity(c, 0, None, None)?
        .into_iter()
        .filter(|a| a.epic_id.as_deref() == Some(epic_id))
        .collect::<Vec<_>>();
    if rows.len() > limit {
        rows.drain(..rows.len() - limit);
    }
    Ok(rows)
}

/// One sentence vocabulary for native events, resources and MCP journal reads.
pub fn activity_sentence(action: &str, actor: &str, key: Option<&str>, payload: &Value) -> String {
    let key = key.or_else(|| payload["key"].as_str()).unwrap_or("");
    let title = payload["title"].as_str().unwrap_or("");
    let status = payload["status"]
        .as_array()
        .and_then(|a| a.last())
        .and_then(Value::as_str)
        .or_else(|| payload["status"].as_str())
        .unwrap_or("");
    match action {
        "epic.created" => format!("{actor} created epic {key} · {title}"),
        "story.created" => format!("{actor} created story {key} · {title}"),
        "epic.status" | "story.status" => format!("{actor} set {key} to {status}"),
        "epic.updated" | "story.updated" | "task.brief_updated" => format!(
            "{actor} updated {key} · {}",
            payload["fields"]
                .as_array()
                .map(|a| a
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", "))
                .unwrap_or_default()
        ),
        "execution.started" => format!(
            "{actor} started work on {}",
            payload["scopeKey"].as_str().unwrap_or("")
        ),
        "execution.paused" => format!(
            "{actor} paused new work on {}",
            payload["scopeKey"].as_str().unwrap_or("")
        ),
        "execution.requested" => format!(
            "{actor} requested permission to start {}",
            payload["scopeKey"].as_str().unwrap_or("")
        ),
        "execution.request_resolved" => format!(
            "{actor} {} the start request for {}",
            if payload["decision"] == "approve" {
                "approved"
            } else {
                "declined"
            },
            payload["scopeKey"].as_str().unwrap_or("")
        ),
        "task.created" => format!("{actor} created {key} · {title}"),
        "task.moved" => format!(
            "{actor} moved {key} to {}",
            match status {
                "backlog" => "Backlog",
                "ready" => "Ready",
                "in_progress" => "In progress",
                "review" => "Review",
                "done" => "Done",
                _ => status,
            }
        ),
        "task.ready_override" => format!("{actor} moved {key} to Ready with an override"),
        "task.claimed" => format!("{actor} claimed {key}"),
        "report.submitted" => format!("{actor} submitted a report for {key}"),
        "review.recorded" if payload["verdict"] == "changes_requested" => {
            let tests = payload["failedTests"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" and ")
                })
                .unwrap_or_default();
            if tests.is_empty() {
                format!("{actor} returned {key} for changes")
            } else {
                format!("{actor} returned {key}: tests {tests} failed")
            }
        }
        "review.recorded" => format!("{actor} accepted {key}"),
        "question.asked" => format!(
            "{actor} asked a question{}",
            payload["roundLabel"]
                .as_str()
                .map(|s| format!(" ({s})"))
                .unwrap_or_default()
        ),
        "question.answered" => format!("{actor} answered a question"),
        "question.withdrawn" => format!("{actor} withdrew a question"),
        "agent.status" => format!(
            "{actor}: {}",
            payload["text"].as_str().unwrap_or("Status cleared")
        ),
        "reference.added" => format!("{actor} added reference {title}"),
        "reference.linked" => format!("{actor} linked a reference to {key}"),
        "reference.updated" => format!("{actor} updated a reference"),
        "comment.added" => format!("{actor} commented on {key}"),
        _ => format!("{actor} {} {key}", action.replace('.', " ")),
    }
}

pub(crate) fn validate_template(t: &str) -> Result<()> {
    if !["game_jam", "gamedev", "webapp", "custom"].contains(&t) {
        return Err(invalid("template", "Unknown project template"));
    }
    Ok(())
}
pub(crate) fn template_label(t: &str) -> &'static str {
    match t {
        "gamedev" => "Gamedev",
        "webapp" => "Web app",
        "custom" => "Custom",
        _ => "Game jam",
    }
}
pub(crate) fn validate_project_dates(start: Option<&str>, end: Option<&str>) -> Result<()> {
    let start = start.ok_or_else(|| invalid("startsAt", "Choose a start time"))?;
    let end = end.ok_or_else(|| invalid("endsAt", "Choose an end time"))?;
    let f = &time::format_description::well_known::Rfc3339;
    let start = time::OffsetDateTime::parse(start, f)
        .map_err(|_| invalid("startsAt", "Use a valid date and time"))?;
    let end = time::OffsetDateTime::parse(end, f)
        .map_err(|_| invalid("endsAt", "Use a valid date and time"))?;
    if end <= start {
        return Err(invalid("endsAt", "End must be after start"));
    }
    Ok(())
}
