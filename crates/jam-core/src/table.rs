use crate::*;
#[cfg(debug_assertions)]
use rusqlite::OptionalExtension;
use rusqlite::{params_from_iter, types::Value};

// SQLite's default trim removes only ASCII spaces. Keep the authoritative Rust
// str::trim whitespace semantics for every required readiness field. The unit
// test below detects changes to Rust's Unicode whitespace table.
const RUST_WHITESPACE: &str = "\u{0009}\u{000a}\u{000b}\u{000c}\u{000d}\u{0020}\u{0085}\u{00a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}";

impl Store {
    pub fn query_tasks(&self, input: TaskQuery) -> Result<TaskListPage> {
        let mut filters = vec!["t.jam_id=?".to_string()];
        let mut values = Vec::<Value>::new();
        for (value, column) in [(&input.epic, "e"), (&input.story, "s")] {
            if let Some(value) = value.as_ref().filter(|v| !v.is_empty()) {
                filters.push(format!("({column}.key=? OR {column}.id=?)"));
                values.extend([Value::Text(value.clone()), Value::Text(value.clone())]);
            }
        }
        for (value, expression) in [
            (input.changes_requested, "t.changes_requested"),
            (
                input.needs_info,
                "EXISTS(SELECT 1 FROM questions q WHERE q.scope_type='task' AND q.scope_id=t.id AND q.status='open')",
            ),
        ] {
            if let Some(value) = value {
                filters.push(format!("({expression})=?"));
                values.push(Value::Integer(i64::from(value)));
            }
        }
        // SQLite length(text) stops at NUL; accepted Rust strings do not.
        // Compare trimmed content directly rather than introducing validation.
        if let Some(ready) = input.ready {
            filters.push("(trim(t.goal_md,?)<>'' AND trim(t.where_md,?)<>'' AND trim(t.result_md,?)<>'' AND s.status='active' AND EXISTS(SELECT 1 FROM json_each(t.changes_json) j WHERE trim(json_extract(j.value,'$.title'),?)<>'' AND trim(json_extract(j.value,'$.required'),?)<>'') AND EXISTS(SELECT 1 FROM json_each(t.tests_json) j WHERE trim(json_extract(j.value,'$.setup'),?)<>'' AND trim(json_extract(j.value,'$.expected'),?)<>''))=?".into());
            values.extend((0..7).map(|_| Value::Text(RUST_WHITESPACE.into())));
            values.push(Value::Integer(i64::from(ready)));
        }
        if !input.include_archived.unwrap_or(false) {
            filters.push("t.archived_at IS NULL".into());
        }
        if let Some(statuses) = &input.status {
            for status in statuses {
                if !STATUSES.contains(&status.as_str()) {
                    return Err(invalid("status", "Unknown task status"));
                }
            }
            if !statuses.is_empty() {
                filters.push(format!(
                    "t.status IN ({})",
                    vec!["?"; statuses.len()].join(",")
                ));
                values.extend(statuses.iter().cloned().map(Value::Text));
            }
        }
        if let Some(assignee) = input.assignee.as_deref().filter(|s| !s.is_empty()) {
            match assignee {
                "unassigned" => filters.push("t.assignee_id IS NULL".into()),
                "agents" => filters.push("m.kind='agent'".into()),
                "humans" => filters.push("m.kind='human'".into()),
                id => {
                    filters.push("t.assignee_id=?".into());
                    values.push(Value::Text(id.to_string()));
                }
            }
        }
        if let Some(tags) = &input.tags {
            let tags = crate::service::normalize_tags(tags)?;
            if !tags.is_empty() {
                filters.push(format!("EXISTS (SELECT 1 FROM task_tags tag WHERE tag.task_id=t.id AND tag.tag IN ({}))", vec!["?"; tags.len()].join(",")));
                values.extend(tags.into_iter().map(Value::Text));
            }
        }
        if let Some(text) = input.text.as_deref().filter(|s| !s.is_empty()) {
            filters.push(
                "instr(lower(t.title || ' ' || t.description_md || ' ' || t.key), lower(?))>0"
                    .into(),
            );
            values.push(Value::Text(text.to_string()));
        }
        let numeric_key = "CAST(substr(t.key,instr(t.key,'-')+1) AS INTEGER)";
        let order = if let Some(sort) = input.sort {
            let field = match sort.field.as_str() {
                "key" => numeric_key,
                "title" => "t.title COLLATE NOCASE",
                "status" => {
                    "CASE t.status WHEN 'backlog' THEN 0 WHEN 'ready' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'review' THEN 3 ELSE 4 END"
                }
                "priority" => {
                    "CASE t.priority WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END"
                }
                "assignee" => "coalesce(m.name,'') COLLATE NOCASE",
                "estimate" => "t.estimate",
                "updatedAt" => {
                    "substr(t.updated_at,1,19) || CASE WHEN substr(t.updated_at,20,1)='.' THEN substr(substr(t.updated_at,21,length(t.updated_at)-21) || '000000000',1,9) ELSE '000000000' END"
                }
                _ => return Err(invalid("sort.field", "Unknown sort column")),
            };
            let dir = match sort.dir.as_str() {
                "asc" => "ASC",
                "desc" => "DESC",
                _ => return Err(invalid("sort.dir", "Choose asc or desc")),
            };
            format!("{field} {dir}, {numeric_key} ASC")
        } else {
            format!("{numeric_key} ASC")
        };
        self.read(|connection| {
            let jam = crate::service::jam(connection)?;
            if let Some(key) = input.epic.as_deref().filter(|v| !v.is_empty()) {
                crate::planning::epic(connection, key)?;
            }
            if let Some(key) = input.story.as_deref().filter(|v| !v.is_empty()) {
                crate::planning::story(connection, key)?;
            }
            values.insert(0, Value::Text(jam.id));
            let from = format!(
                "FROM tasks t JOIN stories s ON s.id=t.story_id JOIN epics e ON e.id=s.epic_id LEFT JOIN members m ON m.id=t.assignee_id WHERE {}",
                filters.join(" AND ")
            );
            let total: i64 = connection.query_row(
                &format!("SELECT count(*) {from}"),
                params_from_iter(&values),
                |row| row.get(0),
            )?;
            if total > 5000 {
                return Err(invalid("filters", "Refine filters to at most 5000 tasks"));
            }
            let keys = connection
                .prepare(&format!("SELECT t.key {from} ORDER BY {order} LIMIT 5000"))?
                .query_map(params_from_iter(&values), |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let tasks = keys
                .iter()
                .map(|key| crate::service::task(connection, key))
                .collect::<Result<Vec<_>>>()?;
            Ok(TaskListPage { tasks, total })
        })
    }
    pub fn list_tags(&self) -> Result<Vec<TagCount>> {
        self.read(|connection| {
            let jam = crate::service::jam(connection)?;
            Ok(connection.prepare("SELECT tag.tag,count(*) FROM task_tags tag JOIN tasks t ON t.id=tag.task_id WHERE t.jam_id=? AND t.archived_at IS NULL GROUP BY tag.tag ORDER BY tag.tag")?.query_map([jam.id], |row| Ok(TagCount { tag: row.get(0)?, count: row.get(1)? }))?.collect::<std::result::Result<Vec<_>, _>>()?)
        })
    }
    pub fn update_current_task(&self, input: TaskEditInput) -> Result<TaskDetail> {
        if input.expected_updated_at.is_empty() {
            return Err(invalid("expectedUpdatedAt", "A task version is required"));
        }
        self.apply_task_update(
            &self.current_member()?.id,
            &input.key,
            Some(&input.expected_updated_at),
            None,
            input.patch,
        )
    }
    pub fn archive_current_task(&self, key: &str, reason: Option<&str>) -> Result<TaskSummary> {
        self.archive_task(&self.current_member()?.id, key, reason, None)
    }
    pub fn unarchive_current_task(&self, key: &str) -> Result<TaskSummary> {
        self.unarchive_task(&self.current_member()?.id, key)
    }
    pub fn add_current_comment(&self, key: &str, body: &str) -> Result<Comment> {
        self.add_comment(&self.current_member()?.id, key, body)
    }
    #[cfg(debug_assertions)]
    pub fn seed_bulk(&self, n: usize) -> Result<()> {
        if n > 5000 {
            return Err(invalid("n", "Use at most 5000 tasks"));
        }
        let actor = self.current_member()?;
        let story=self.read(|c|{let j=crate::service::jam(c)?;Ok(c.query_row("SELECT key FROM stories WHERE jam_id=? AND archived_at IS NULL ORDER BY position,id LIMIT 1",[j.id],|r|r.get::<_,String>(0)).optional()?)})?.map(Ok).unwrap_or_else(||self.default_task_story(&actor.id).map(|s|s.key))?;
        for i in 0..n {
            self.create_task(
                &actor.id,
                CreateTask {
                    story_key: Some(story.clone()),
                    title: format!("Bulk task {}: lantern playtest", i + 1),
                    tags: Some(vec!["tech".into()]),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn sqlite_readiness_whitespace_matches_every_rust_unicode_scalar() {
        let rust = (0..=char::MAX as u32)
            .filter_map(char::from_u32)
            .filter(|c| c.is_whitespace())
            .collect::<String>();
        assert_eq!(super::RUST_WHITESPACE, rust);
        assert!(super::RUST_WHITESPACE.contains('\u{0085}'));
    }
}
