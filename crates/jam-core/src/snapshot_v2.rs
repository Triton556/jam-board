use crate::planning::{insert, records};
use crate::*;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BriefRow {
    pub task_id: String,
    pub brief: TaskBrief,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanningExport {
    pub epics: Vec<Epic>,
    pub stories: Vec<Story>,
    pub briefs: Vec<BriefRow>,
    pub reports: Vec<Report>,
    pub reviews: Vec<Review>,
    pub questions: Vec<Question>,
    pub frames: Vec<RefFrame>,
    pub items: Vec<RefItem>,
    pub edges: Vec<RefEdge>,
    pub reference_links: Vec<RefLink>,
}

/// Validate polymorphic relationships too: SQLite cannot put a foreign key on scope_id/target_id.
pub(crate) fn validate(s: &JamExport) -> Result<()> {
    use std::collections::BTreeSet;
    let Some(p) = &s.planning else {
        return if s.version == 2 {
            Err(invalid("planning", "Version 2 requires planning data"))
        } else {
            Ok(())
        };
    };
    let members = s
        .members
        .iter()
        .map(|m| m.id.as_str())
        .collect::<BTreeSet<_>>();
    let tasks = s
        .tasks
        .iter()
        .map(|t| t.id.as_str())
        .collect::<BTreeSet<_>>();
    let epics = p
        .epics
        .iter()
        .map(|e| e.audit.id.as_str())
        .collect::<BTreeSet<_>>();
    let stories = p
        .stories
        .iter()
        .map(|e| e.audit.id.as_str())
        .collect::<BTreeSet<_>>();
    let items = p
        .items
        .iter()
        .map(|e| e.audit.id.as_str())
        .collect::<BTreeSet<_>>();
    let frames = p
        .frames
        .iter()
        .map(|e| e.id.as_str())
        .collect::<BTreeSet<_>>();
    let target = |kind: &str, id: &str| match kind {
        "project" => id == s.jam.id,
        "epic" => epics.contains(id),
        "story" => stories.contains(id),
        "task" => tasks.contains(id),
        _ => false,
    };
    let audit = |a: &Audit| {
        a.jam_id == s.jam.id
            && members.contains(a.created_by.as_str())
            && members.contains(a.updated_by.as_str())
            && a.position.is_finite()
    };
    let status = |s: &str| ["draft", "active", "done", "archived"].contains(&s);
    for e in &p.epics {
        crate::planning::validate_epic(e)?;
        if !audit(&e.audit)
            || !status(&e.status)
            || e.brain_member_id
                .as_ref()
                .is_some_and(|id| !s.members.iter().any(|m| m.id == *id && m.kind == "agent"))
        {
            return Err(invalid("planning.epics", "Invalid epic audit or brain"));
        }
    }
    for st in &p.stories {
        crate::planning::validate_story(st)?;
        if !audit(&st.audit) || !status(&st.status) || !epics.contains(st.epic_id.as_str()) {
            return Err(invalid("planning.stories", "Invalid story audit or epic"));
        }
    }
    if s.tasks
        .iter()
        .any(|t| !stories.contains(t.story_id.as_str()) || t.review_round < 0)
        || p.briefs.len() != s.tasks.len()
    {
        return Err(invalid(
            "planning.briefs",
            "Every task needs one story and one brief",
        ));
    }
    let mut briefs = BTreeSet::new();
    for b in &p.briefs {
        if !tasks.contains(b.task_id.as_str()) || !briefs.insert(&b.task_id) {
            return Err(invalid("planning.briefs", "Unknown or duplicate task"));
        }
        crate::workflow::validate_brief(&b.brief)?;
    }
    for r in &p.reports {
        let mut names = BTreeSet::new();
        if !tasks.contains(r.task_id.as_str())
            || !members.contains(r.author_id.as_str())
            || r.round < 0
            || r.summary_md.trim().is_empty()
            || r.tests.iter().any(|t| {
                t.name.trim().is_empty()
                    || !names.insert(&t.name)
                    || !["PASS", "FAIL", "NOT_RUN"].contains(&t.result.as_str())
            })
        {
            return Err(invalid(
                "planning.reports",
                "Invalid report task, author, round or tests",
            ));
        }
    }
    for r in &p.reviews {
        let report = p
            .reports
            .iter()
            .find(|p| p.task_id == r.task_id && p.round == r.round);
        if !members.contains(r.reviewer_id.as_str())
            || !["accept", "changes_requested"].contains(&r.verdict.as_str())
            || report.is_none_or(|p| {
                p.author_id == r.reviewer_id
                    || r.failed_tests
                        .iter()
                        .any(|n| !p.tests.iter().any(|t| t.name == *n))
            })
        {
            return Err(invalid(
                "planning.reviews",
                "Review needs a matching report and a different reviewer",
            ));
        }
    }
    for q in &p.questions {
        if q.jam_id != s.jam.id
            || !target(&q.scope_type, &q.scope_id)
            || !members.contains(q.asked_by.as_str())
            || q.title.trim().is_empty()
            || q.options.len() > 6
            || q.recommended_index.is_some_and(|i| i >= q.options.len())
            || q.answer_index.is_some_and(|i| i >= q.options.len())
            || !["open", "answered", "withdrawn"].contains(&q.status.as_str())
            || q.answered_by
                .as_ref()
                .is_some_and(|id| !s.members.iter().any(|m| m.id == *id && m.kind == "human"))
        {
            return Err(invalid(
                "planning.questions",
                "Invalid question scope, options or answerer",
            ));
        }
    }
    for f in &p.frames {
        if f.jam_id != s.jam.id
            || f.epic_id
                .as_ref()
                .is_some_and(|id| !epics.contains(id.as_str()))
            || [f.x, f.y, f.w, f.h].iter().any(|n| !n.is_finite())
            || f.w <= 0.
            || f.h <= 0.
        {
            return Err(invalid(
                "planning.frames",
                "Invalid frame scope or geometry",
            ));
        }
    }
    for i in &p.items {
        let content = match i.kind.as_str() {
            "asset" => i.asset_id.as_ref().is_some_and(|id| {
                s.assets
                    .iter()
                    .any(|a| a.id == *id && a.role == "reference")
            }),
            "link" => i
                .url
                .as_ref()
                .is_some_and(|u| u.starts_with("https://") || u.starts_with("http://")),
            // Existing notes may deliberately be cleared without deleting the record.
            "note" => true,
            _ => false,
        };
        if !audit(&i.audit)
            || !content
            || i.frame_id
                .as_ref()
                .is_some_and(|id| !frames.contains(id.as_str()))
            || [i.x, i.y, i.w, i.h, i.z].iter().any(|n| !n.is_finite())
            || i.w <= 0.
            || i.h <= 0.
        {
            return Err(invalid(
                "planning.items",
                "Invalid reference content, scope or geometry",
            ));
        }
        crate::service::normalize_tags(&i.tags)?;
    }
    for e in &p.edges {
        if e.jam_id != s.jam.id
            || !items.contains(e.from_item.as_str())
            || !items.contains(e.to_item.as_str())
        {
            return Err(invalid("planning.edges", "Unknown reference endpoint"));
        }
    }
    for l in &p.reference_links {
        if !items.contains(l.item_id.as_str())
            || !target(&l.target_type, &l.target_id)
            || l.target_type == "project"
        {
            return Err(invalid(
                "planning.referenceLinks",
                "Unknown reference target",
            ));
        }
    }
    if s.activity.iter().any(|a| {
        a.epic_id
            .as_ref()
            .is_some_and(|id| !epics.contains(id.as_str()))
    }) {
        return Err(invalid("activity.epicId", "Unknown epic"));
    }
    Ok(())
}
pub(crate) fn export(c: &Connection, jam_id: &str) -> Result<PlanningExport> {
    let keys = c
        .prepare("SELECT id,key FROM tasks WHERE jam_id=?")?
        .query_map([jam_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(PlanningExport {
        epics: records(c, "epics", "jam_id=?", &[&jam_id])?,
        stories: records(c, "stories", "jam_id=?", &[&jam_id])?,
        briefs: keys
            .iter()
            .map(|(id, key)| {
                Ok(BriefRow {
                    task_id: id.clone(),
                    brief: crate::workflow::brief(c, key)?,
                })
            })
            .collect::<Result<_>>()?,
        reports: records(
            c,
            "reports",
            "task_id IN (SELECT id FROM tasks WHERE jam_id=?)",
            &[&jam_id],
        )?,
        reviews: records(
            c,
            "reviews",
            "task_id IN (SELECT id FROM tasks WHERE jam_id=?)",
            &[&jam_id],
        )?,
        questions: records(c, "questions", "jam_id=?", &[&jam_id])?,
        frames: records(c, "ref_frames", "jam_id=?", &[&jam_id])?,
        items: records(c, "ref_items", "jam_id=?", &[&jam_id])?,
        edges: records(c, "ref_edges", "jam_id=?", &[&jam_id])?,
        reference_links: records(
            c,
            "ref_links",
            "item_id IN (SELECT id FROM ref_items WHERE jam_id=?)",
            &[&jam_id],
        )?,
    })
}
fn remapped<T: Serialize>(
    data: &T,
    ids: &BTreeMap<String, String>,
    keys: &BTreeMap<String, String>,
) -> Result<serde_json::Value> {
    let value = serde_json::to_value(data)?;
    Ok(crate::snapshot::remap_payload(&value, ids, keys))
}
pub(crate) fn prepare(
    c: &Connection,
    p: Option<&PlanningExport>,
    actor: &str,
    jam_id: &str,
    prefix: &str,
    ids: &mut BTreeMap<String, String>,
    keys: &mut BTreeMap<String, String>,
) -> Result<String> {
    if let Some(p) = p {
        for value in [
            &p.epics as &dyn erased::Rows,
            &p.stories,
            &p.reports,
            &p.reviews,
            &p.questions,
            &p.frames,
            &p.items,
            &p.edges,
        ] {
            for record in value.values()? {
                let old = record["id"]
                    .as_str()
                    .ok_or_else(|| invalid("planning", "Missing record ID"))?;
                if ids.insert(old.into(), id()).is_some() {
                    return Err(invalid("planning", "Duplicate record ID"));
                }
            }
        }
        for (i, e) in p.epics.iter().enumerate() {
            keys.insert(e.key.clone(), format!("{prefix}-E{}", i + 1));
        }
        for (i, s) in p.stories.iter().enumerate() {
            keys.insert(s.key.clone(), format!("{prefix}-S{}", i + 1));
        }
        for e in &p.epics {
            insert(c, "epics", &remapped(e, ids, keys)?)?;
        }
        for s in &p.stories {
            insert(c, "stories", &remapped(s, ids, keys)?)?;
        }
        c.execute(
            "UPDATE jams SET epic_seq=?,story_seq=? WHERE id=?",
            params![p.epics.len() as i64, p.stories.len() as i64, jam_id],
        )?;
        Ok(String::new())
    } else {
        let stamp = now();
        let e = Epic {
            audit: Audit {
                id: id(),
                jam_id: jam_id.into(),
                position: 1024.,
                created_by: actor.into(),
                updated_by: actor.into(),
                created_at: stamp.clone(),
                updated_at: stamp.clone(),
                archived_at: None,
            },
            key: format!("{prefix}-E1"),
            title: "Imported tasks".into(),
            color: "m1".into(),
            status: "active".into(),
            goal_md: "Tasks created before epics existed.".into(),
            done_when_md: "Every imported task is done or archived.".into(),
            participation: "first_sketch".into(),
            reviewer: "none".into(),
            ..Default::default()
        };
        insert(c, "epics", &e)?;
        let s = Story {
            audit: Audit {
                id: id(),
                jam_id: jam_id.into(),
                position: 1024.,
                created_by: actor.into(),
                updated_by: actor.into(),
                created_at: stamp.clone(),
                updated_at: stamp,
                archived_at: None,
            },
            key: format!("{prefix}-S1"),
            epic_id: e.audit.id,
            title: "Imported tasks".into(),
            status: "active".into(),
            outcome_md: "Keep working on tasks created before stories existed.".into(),
            acceptance: vec![Acceptance {
                id: "1".into(),
                criterion: "All imported tasks are done or archived.".into(),
                mandatory: true,
                check: "Inspect task statuses.".into(),
            }],
            ..Default::default()
        };
        insert(c, "stories", &s)?;
        c.execute(
            "UPDATE jams SET epic_seq=1,story_seq=1 WHERE id=?",
            [jam_id],
        )?;
        Ok(s.audit.id)
    }
}
pub(crate) fn finish(
    c: &Connection,
    p: Option<&PlanningExport>,
    ids: &BTreeMap<String, String>,
    keys: &BTreeMap<String, String>,
) -> Result<()> {
    if let Some(p) = p {
        for b in &p.briefs {
            crate::workflow::validate_brief(&b.brief)?;
            let id = ids
                .get(&b.task_id)
                .ok_or_else(|| invalid("planning.briefs", "Unknown task"))?;
            crate::planning::patch_record(c, "tasks", id, &serde_json::to_value(&b.brief)?)?;
        }
        for (table, rows) in [
            ("reports", &p.reports as &dyn erased::Rows),
            ("reviews", &p.reviews),
            ("questions", &p.questions),
            ("ref_frames", &p.frames),
            ("ref_items", &p.items),
            ("ref_edges", &p.edges),
            ("ref_links", &p.reference_links),
        ] {
            for row in rows.values()? {
                insert(c, table, &crate::snapshot::remap_payload(&row, ids, keys))?;
            }
        }
    }
    Ok(())
}

// A private serialization adapter avoids a second persistence implementation per entity.
mod erased {
    pub trait Rows {
        fn values(&self) -> crate::Result<Vec<serde_json::Value>>;
    }
    impl<T: serde::Serialize> Rows for Vec<T> {
        fn values(&self) -> crate::Result<Vec<serde_json::Value>> {
            Ok(self
                .iter()
                .map(serde_json::to_value)
                .collect::<std::result::Result<_, _>>()?)
        }
    }
}
