use crate::planning::*;
use crate::*;
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;

pub(crate) fn review_hash(items: &[RefItem]) -> String {
    let mut items = items.iter().collect::<Vec<_>>();
    items.sort_by(|a, b| a.audit.id.cmp(&b.audit.id));
    let mut lines = String::new();
    for item in items {
        let verdict = match item.verdict {
            Some(ReferenceVerdict::Keep) => "keep",
            Some(ReferenceVerdict::Reject) => "reject",
            None => "-",
        };
        lines.push_str(&format!(
            "{}\t{}\t{}\n",
            item.audit.id,
            verdict,
            item.verdict_note.as_deref().unwrap_or("-")
        ));
    }
    crate::storage_io::hash(lines.as_bytes())
}

pub(crate) fn frame_review(c: &Connection, frame_id: &str) -> Result<Option<FrameReview>> {
    let all: Vec<RefItem> = records(
        c,
        "ref_items",
        "frame_id=? AND archived_at IS NULL ORDER BY id",
        &[&frame_id],
    )?;
    let items = all
        .iter()
        .filter(|i| i.kind != "note")
        .cloned()
        .collect::<Vec<_>>();
    if items.is_empty() {
        return Ok(None);
    }
    let (sent_at,sent_by,hash) = c.query_row("SELECT f.review_sent_at,m.name,f.review_hash FROM ref_frames f LEFT JOIN members m ON m.id=f.review_sent_by WHERE f.id=?",[frame_id],|r|Ok((r.get::<_,Option<String>>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?)))?;
    let keep = items
        .iter()
        .filter(|i| i.verdict == Some(ReferenceVerdict::Keep))
        .count() as u32;
    let reject = items
        .iter()
        .filter(|i| i.verdict == Some(ReferenceVerdict::Reject))
        .count() as u32;
    let comments = items.iter().filter(|i| i.verdict_note.is_some()).count()
        + all
            .iter()
            .filter(|i| {
                i.kind == "note"
                    && !crate::canvas_tools::attached_to(i, &items, &[], false).is_empty()
            })
            .count();
    Ok(Some(FrameReview {
        total: items.len() as u32,
        keep,
        reject,
        unrated: items.len() as u32 - keep - reject,
        comments: comments as u32,
        changed_since_sent: sent_at.is_some() && hash.as_deref() != Some(&review_hash(&items)),
        sent_at,
        sent_by,
    }))
}

pub(crate) fn verdict_note(value: Option<String>) -> Result<Option<String>> {
    let value = value.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
    if value.as_ref().is_some_and(|s| s.chars().count() > 500) {
        return Err(invalid("verdictNote", "Use at most 500 characters"));
    }
    Ok(value)
}

pub(crate) fn source_url(value: Option<&str>) -> Result<()> {
    if let Some(value) = value
        && (value.chars().count() > 2048 || crate::file_model::valid_url(value).is_err())
    {
        return Err(invalid(
            "sourceUrl",
            "Use an http(s) URL without credentials",
        ));
    }
    Ok(())
}

pub(crate) fn derived_from(
    c: &Connection,
    project: &str,
    item: Option<&str>,
    original: Option<&str>,
) -> Result<()> {
    let Some(original) = original else {
        return Ok(());
    };
    if item == Some(original) {
        return Err(invalid(
            "derivedFrom",
            "A reference cannot derive from itself",
        ));
    }
    let mut next = Some(original.to_owned());
    let mut seen = std::collections::HashSet::new();
    for depth in 0..100 {
        let Some(id) = next.take() else {
            return Ok(());
        };
        if item == Some(id.as_str()) || !seen.insert(id.clone()) {
            return Err(invalid(
                "derivedFrom",
                "This would create a derivation loop",
            ));
        }
        let row = c
            .query_row(
                "SELECT jam_id,archived_at,derived_from FROM ref_items WHERE id=?",
                [&id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((scope, archived, parent)) = row else {
            return Err(invalid(
                "derivedFrom",
                "Choose another reference in this project",
            ));
        };
        if scope != project || (depth == 0 && archived.is_some()) {
            return Err(invalid(
                "derivedFrom",
                "Choose another reference in this project",
            ));
        }
        next = parent;
    }
    if next.is_some() {
        return Err(invalid(
            "derivedFrom",
            "This would create a derivation loop",
        ));
    }
    Ok(())
}

impl Store {
    pub fn set_reference_verdict(
        &self,
        actor: &str,
        input: ReferenceVerdictInput,
    ) -> Result<RefItem> {
        self.write(|c| {
            if crate::service::member(c, actor)?.kind != "human" {
                return Err(Error::Forbidden(
                    "Only humans set reference verdicts".into(),
                ));
            }
            if input.verdict.is_none() && input.verdict_note.is_none() {
                return Err(invalid("verdict", "Send a verdict, a verdictNote or both"));
            }
            let item: RefItem = fetch(c, "ref_items", "id", &input.item_id)?;
            editable_audit(&item.audit)?;
            if item.kind == "note" {
                return Err(invalid("itemId", "Notes cannot be rated"));
            }
            let mut patch = json!({});
            if let Some(verdict) = input.verdict
                && verdict != item.verdict
            {
                patch["verdict"] = json!(verdict);
            }
            if let Some(note) = input.verdict_note {
                let note = verdict_note(note)?;
                if note != item.verdict_note {
                    patch["verdictNote"] = json!(note);
                }
            }
            if patch.as_object().unwrap().is_empty() {
                return Ok(item);
            }
            let mut event = patch.clone();
            event["itemId"] = json!(item.audit.id);
            event["frameId"] = json!(item.frame_id);
            event["fields"] = json!(patch.as_object().unwrap().keys().collect::<Vec<_>>());
            patch["updatedBy"] = json!(actor);
            patch["updatedAt"] = json!(crate::context::next_version(&item.audit.updated_at)?);
            patch_record(c, "ref_items", &input.item_id, &patch)?;
            v2_event(
                c,
                actor,
                crate::references::reference_epic(c, &item)?.as_deref(),
                "reference.updated",
                None,
                event,
            )?;
            fetch(c, "ref_items", "id", &input.item_id)
        })
    }
}
