//! Native planning operations that the human UI needs in addition to MCP planning.
use crate::planning::*;
use crate::*;
use rusqlite::params;
use serde_json::json;

impl Store {
    pub fn plan_stories(&self) -> Result<Vec<Story>> {
        self.read(|c| records(c,"stories","jam_id=? AND archived_at IS NULL AND epic_id IN (SELECT id FROM epics WHERE archived_at IS NULL) ORDER BY position,id",&[&crate::service::jam(c)?.id]))
    }
    pub fn plan_epics(&self) -> Result<Vec<Epic>> {
        self.read(|c| {
            records(
                c,
                "epics",
                "jam_id=? ORDER BY position,id",
                &[&crate::service::jam(c)?.id],
            )
        })
    }
    pub fn clear_brain(&self, actor: &str, key: &str) -> Result<Epic> {
        self.write(|c| {
            let e = epic(c, key)?;
            editable_audit(&e.audit)?;
            require_privileged(c, actor, &e)?;
            c.execute(
                "UPDATE epics SET brain_member_id=NULL,updated_by=?,updated_at=? WHERE id=?",
                params![actor, now(), e.audit.id],
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
    pub fn reorder_story(&self, actor: &str, key: &str, before_key: Option<&str>) -> Result<Story> {
        self.write(|c| {
            crate::service::member(c, actor)?;
            let s = story(c, key)?;
            editable_audit(&s.audit)?;
            editable_audit(&epic(c, &s.epic_id)?.audit)?;
            let mut rows: Vec<Story> = records(
                c,
                "stories",
                "epic_id=? AND archived_at IS NULL ORDER BY position,id",
                &[&s.epic_id],
            )?;
            rows.retain(|r| r.key != key);
            let index = if let Some(k) = before_key {
                rows.iter()
                    .position(|r| r.key == k)
                    .ok_or_else(|| crate::invalid("beforeKey", "Choose a story in this epic"))?
            } else {
                rows.len()
            };
            rows.insert(index, s.clone());
            for (i, row) in rows.iter().enumerate() {
                c.execute(
                    "UPDATE stories SET position=? WHERE id=?",
                    params![(i + 1) as f64 * 1024., row.audit.id],
                )?;
            }
            c.execute(
                "UPDATE stories SET updated_by=?,updated_at=? WHERE id=?",
                params![actor, now(), s.audit.id],
            )?;
            v2_event(
                c,
                actor,
                Some(&s.epic_id),
                "story.updated",
                None,
                json!({"key":key,"fields":["position"]}),
            )?;
            story(c, key)
        })
    }
}
