//! Reference storage never fetches remote URLs. Preview fetching is a separate explicit operation.
use crate::planning::*;
use crate::service::{jam, normalize_tags};
use crate::*;
use rusqlite::{Connection, params};
use serde_json::json;

pub(crate) fn archive_actor(c: &Connection, actor: &str) -> Result<String> {
    let who = crate::service::member(c, actor)?;
    Ok(if who.kind == "human" {
        "human".into()
    } else {
        who.name
    })
}

pub(crate) fn file_kind(path: &std::path::Path) -> &'static str {
    crate::classify_file(path)
}

fn target(c: &Connection, key: &str) -> Result<(String, String, String)> {
    if key.rsplit('-').next().is_some_and(|s| s.starts_with('E')) {
        let e = epic(c, key)?;
        editable_audit(&e.audit)?;
        Ok(("epic".into(), e.audit.id.clone(), e.audit.id))
    } else if key.rsplit('-').next().is_some_and(|s| s.starts_with('S')) {
        let s = story(c, key)?;
        editable_audit(&s.audit)?;
        Ok(("story".into(), s.audit.id, s.epic_id))
    } else {
        let t = crate::service::task(c, key)?;
        if t.archived_at.is_some() {
            return Err(Error::Archived(key.into()));
        }
        Ok(("task".into(), t.id, t.epic_id))
    }
}
fn link(c: &Connection, item: &RefItem, key: &str) -> Result<(String, String, String)> {
    let (kind, id, epic_id) = target(c, key)?;
    let e = epic(c, &epic_id)?;
    if e.audit.jam_id != item.audit.jam_id {
        return Err(invalid(
            "targetKey",
            "Reference and target must belong to the same project",
        ));
    }
    c.execute("INSERT INTO ref_links(item_id,target_type,target_id) VALUES (?,?,?) ON CONFLICT(item_id,target_type,target_id) DO UPDATE SET archived_at=NULL",params![item.audit.id,kind,id])?;
    Ok((kind, id, epic_id))
}
pub(crate) fn task_references(c: &Connection, t: &TaskSummary) -> Result<Vec<RefItem>> {
    references_for(
        c,
        &[
            ("task".into(), t.id.clone(), t.epic_id.clone()),
            ("story".into(), t.story_id.clone(), t.epic_id.clone()),
            ("epic".into(), t.epic_id.clone(), t.epic_id.clone()),
        ],
    )
}

pub(crate) fn frame_targets(c: &Connection, frame_id: &str) -> Result<Vec<RefFrameTarget>> {
    let links: Vec<RefFrameLink> = records(
        c,
        "ref_frame_links",
        "frame_id=? AND archived_at IS NULL ORDER BY target_type,target_id",
        &[&frame_id],
    )?;
    links
        .into_iter()
        .map(|l| {
            let table = match l.target_type.as_str() {
                "epic" => "epics",
                "story" => "stories",
                _ => "tasks",
            };
            let row: serde_json::Value = fetch(c, table, "id", &l.target_id)?;
            Ok(RefFrameTarget {
                target_key: row["key"].as_str().unwrap_or("").into(),
                kind: serde_json::from_value(json!(l.target_type))?,
                title: row["title"].as_str().unwrap_or("").into(),
            })
        })
        .collect()
}

fn references_for(c: &Connection, targets: &[(String, String, String)]) -> Result<Vec<RefItem>> {
    let project_id = if let Some((_, _, eid)) = targets.first() {
        epic(c, eid)?.audit.jam_id
    } else {
        jam(c)?.id
    };
    let mut rows: Vec<RefItem> = records(
        c,
        "ref_items",
        "jam_id=? AND archived_at IS NULL ORDER BY z,id",
        &[&project_id],
    )?;
    if targets.is_empty() {
        return Ok(rows);
    }
    let links: Vec<RefLink> = records(
        c,
        "ref_links",
        "archived_at IS NULL AND item_id IN (SELECT id FROM ref_items WHERE jam_id=?)",
        &[&project_id],
    )?;
    let frames: Vec<RefFrame> = records(
        c,
        "ref_frames",
        "jam_id=? AND archived_at IS NULL",
        &[&project_id],
    )?;
    let frame_links: Vec<RefFrameLink> = records(
        c,
        "ref_frame_links",
        "archived_at IS NULL AND frame_id IN (SELECT id FROM ref_frames WHERE jam_id=?)",
        &[&project_id],
    )?;
    rows.retain_mut(|item| {
        let direct = targets.iter().any(|(kind, id, _)| {
            links
                .iter()
                .any(|l| l.item_id == item.audit.id && l.target_type == *kind && l.target_id == *id)
        });
        let frame = frames.iter().find(|f| {
            Some(&f.id) == item.frame_id.as_ref()
                && targets.iter().any(|(kind, id, _)| {
                    (kind == "epic" && f.epic_id.as_ref() == Some(id))
                        || frame_links.iter().any(|l| {
                            l.frame_id == f.id && l.target_type == *kind && l.target_id == *id
                        })
                })
        });
        if !direct && let Some(frame) = frame {
            item.via = Some("frame".into());
            item.frame_title = Some(frame.title.clone());
        }
        direct || frame.is_some()
    });
    Ok(rows)
}
impl Store {
    pub fn link_ref_frame(&self, actor: &str, frame_id: &str, key: &str) -> Result<RefFrame> {
        self.change_frame_link(actor, frame_id, key, false)
    }
    pub fn unlink_ref_frame(&self, actor: &str, frame_id: &str, key: &str) -> Result<RefFrame> {
        self.change_frame_link(actor, frame_id, key, true)
    }
    fn change_frame_link(
        &self,
        actor: &str,
        frame_id: &str,
        key: &str,
        unlink: bool,
    ) -> Result<RefFrame> {
        self.write(|c| {
            crate::service::member(c,actor)?;
            let frame: RefFrame=fetch(c,"ref_frames","id",frame_id)?;
            if frame.archived_at.is_some() { return Err(Error::Archived(frame_id.into())); }
            let (kind,target_id,eid)=target(c,key)?;
            if epic(c,&eid)?.audit.jam_id != frame.jam_id { return Err(invalid("targetKey","Frame and target must belong to the same project")); }
            if unlink {
                let changed=c.execute("UPDATE ref_frame_links SET archived_at=? WHERE frame_id=? AND target_type=? AND target_id=? AND archived_at IS NULL",params![now(),frame_id,kind,target_id])?;
                if changed==0 { return Err(Error::NotFound("frame link".into())); }
            } else {
                c.execute("INSERT INTO ref_frame_links(frame_id,target_type,target_id) VALUES (?,?,?) ON CONFLICT(frame_id,target_type,target_id) DO UPDATE SET archived_at=NULL",params![frame_id,kind,target_id])?;
            }
            v2_event(c,actor,Some(&eid),if unlink {"reference.updated"} else {"reference.linked"},if kind=="task" {Some(&target_id)} else {None},json!({"frameId":frame_id,"key":key,"unlinked":unlink}))?;
            fetch(c,"ref_frames","id",frame_id)
        })
    }
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
            let item: RefItem = fetch(c, "ref_items", "id", &input.item_id)?;
            editable_audit(&item.audit)?;
            patch_record(
                c,
                "ref_items",
                &input.item_id,
                &json!({"verdict":input.verdict,"updatedBy":actor,"updatedAt":now()}),
            )?;
            v2_event(
                c,
                actor,
                reference_epic(c, &item)?.as_deref(),
                "reference.updated",
                None,
                json!({"itemId":input.item_id,"verdict":input.verdict}),
            )?;
            fetch(c, "ref_items", "id", &input.item_id)
        })
    }
    pub fn add_reference(&self, actor: &str, input: AddReference) -> Result<RefItem> {
        if input.kind == "asset"
            && let Some(path) = input.file_path.as_deref().map(std::path::Path::new)
            && path.is_absolute()
        {
            crate::file_model::validate_private_source(
                &self.path,
                self.app_data_dir.as_deref(),
                path,
            )?;
        }
        if input.storage_type.is_some()
            || input.file_role.is_some()
            || input.request_id.is_some()
            || (input.copy == Some(true)
                && crate::project_folders::folder_for_db(&self.path).is_some())
        {
            if input.kind != "asset" {
                return Err(invalid(
                    "storageType",
                    "File fields apply only to asset references",
                ));
            }
            let storage = input
                .storage_type
                .as_deref()
                .unwrap_or(if input.copy == Some(true) {
                    "board_file"
                } else {
                    "linked_file"
                });
            if input
                .copy
                .is_some_and(|copy| copy != (storage == "board_file"))
            {
                return Err(invalid("copy", "copy and storageType conflict"));
            }
            if input.file_role.is_some() && input.link_to.is_none() {
                return Err(invalid(
                    "fileRole",
                    "A task linkTo and inspected validators are required",
                ));
            }
            if input.copy == Some(true)
                && std::fs::metadata(input.file_path.as_deref().unwrap_or(""))?.len()
                    > 50 * 1024 * 1024
            {
                return Err(invalid("filePath", "Legacy copy:true is limited to 50 MiB"));
            }
            let request = RegisterFile {
                storage_type: match storage {
                    "board_file" => FileStorageType::BoardFile,
                    "linked_file" => FileStorageType::LinkedFile,
                    _ => return Err(invalid("storageType", "Use board_file or linked_file")),
                },
                source_path: input.file_path.clone(),
                url: None,
                path_base: None,
                file_kind: input.file_kind.clone(),
                name: input.title.clone(),
                notes: input.caption.clone(),
                companions: None,
                request_id: input.request_id.clone().unwrap_or_else(id),
                task_key: input.file_role.as_ref().and(input.link_to.clone()),
                role: input.file_role.clone(),
                expected_claim_generation: input.expected_claim_generation.clone(),
                expected_updated_at: input.expected_updated_at.clone(),
                working_directory: None,
            };
            return self
                .register_file_with_reference(actor, request, Some(input))?
                .reference
                .ok_or_else(|| invalid("reference", "Missing reference receipt"));
        }

        if input.copy == Some(true) {
            return self.add_copied_reference(actor, input);
        }
        self.add_reference_with_title_mode(actor, input, false)
    }
    fn add_copied_reference(&self, actor: &str, mut input: AddReference) -> Result<RefItem> {
        use std::io::{Read, Write};
        if input.kind != "asset" {
            return Err(invalid("copy", "Copy is only supported for assets"));
        }
        let source = std::path::Path::new(
            input
                .file_path
                .as_deref()
                .ok_or_else(|| invalid("filePath", "A local file is required"))?,
        );
        if !source.is_absolute() {
            return Err(invalid("filePath", "Use an absolute local file path"));
        }
        crate::file_model::validate_private_source(
            &self.path,
            self.app_data_dir.as_deref(),
            source,
        )?;
        let file = std::fs::File::open(source)
            .map_err(|_| invalid("filePath", "The file must exist and be readable"))?;
        let metadata = file
            .metadata()
            .map_err(|_| invalid("filePath", "The file must exist and be readable"))?;
        if !metadata.is_file() {
            return Err(invalid("filePath", "Choose a file"));
        }
        const CAP: u64 = 50 * 1024 * 1024;
        if metadata.len() > CAP {
            return Err(invalid("filePath", "Copied assets must be at most 50 MiB"));
        }
        let mut bytes = Vec::new();
        file.take(CAP + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid("filePath", "The file must exist and be readable"))?;
        if bytes.len() as u64 > CAP {
            return Err(invalid("filePath", "Copied assets must be at most 50 MiB"));
        }
        if input.title.is_none() {
            input.title = Some(
                source
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Reference")
                    .into(),
            );
        }
        let extension = source.extension().and_then(|s| s.to_str()).unwrap_or("");
        let directory = self.reference_directory()?;
        let path = directory.join(format!(
            "clipboard-{}{}{}",
            id(),
            if extension.is_empty() { "" } else { "." },
            extension
        ));
        let result = (|| {
            let mut destination = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)?;
            destination.write_all(&bytes)?;
            drop(destination);
            input.file_path = Some(path.to_string_lossy().into_owned());
            input.copy = None;
            self.add_reference_with_title_mode(actor, input, false)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&path);
        }
        result
    }
    /// Native direct paper: retain an explicit no-heading choice without changing
    /// the legacy/MCP default title contract. No empty new records are accepted.
    pub fn add_reference_untitled(&self, actor: &str, mut input: AddReference) -> Result<RefItem> {
        if input.kind != "note"
            || input
                .title
                .as_deref()
                .is_some_and(|title| !title.is_empty())
        {
            return Err(invalid(
                "title",
                "Untitled mode requires a note without a heading",
            ));
        }
        input.title = Some(String::new());
        self.add_reference_with_title_mode(actor, input, true)
    }
    fn add_reference_with_title_mode(
        &self,
        actor: &str,
        input: AddReference,
        untitled: bool,
    ) -> Result<RefItem> {
        self.write(|c| add_reference_tx(c, actor, input, untitled, None))
    }
    pub fn link_reference(&self, actor: &str, id: &str, key: &str) -> Result<RefItem> {
        self.write(|c| {
            crate::service::member(c, actor)?;
            let item: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&item.audit)?;
            let (kind, target, eid) = link(c, &item, key)?;
            v2_event(
                c,
                actor,
                Some(&eid),
                "reference.linked",
                if kind == "task" { Some(&target) } else { None },
                json!({"itemId":id,"key":key}),
            )?;
            Ok(item)
        })
    }
    pub fn unlink_reference(&self, actor: &str, id: &str, key: &str) -> Result<()> {
        self.write(|c|{crate::service::member(c,actor)?;let item:RefItem=fetch(c,"ref_items","id",id)?;editable_audit(&item.audit)?;let(kind,target,eid)=target(c,key)?;let changed=c.execute("UPDATE ref_links SET archived_at=? WHERE item_id=? AND target_type=? AND target_id=? AND archived_at IS NULL",params![now(),id,kind,target])?;if changed==0{return Err(Error::NotFound("reference link".into()));}v2_event(c,actor,Some(&eid),"reference.updated",None,json!({"itemId":id,"unlinkedFrom":key}))})
    }
    pub fn update_reference(
        &self,
        actor: &str,
        id: &str,
        input: ReferencePatch,
    ) -> Result<RefItem> {
        self.update_reference_with_expectation(actor, id, input, None)
    }

    /// Human autosave checks the content it actually inspected in the same
    /// immediate transaction as the patch. Geometry/tag-only changes are not
    /// overwritten by this content patch and do not create spurious conflicts.
    pub fn update_reference_checked(
        &self,
        actor: &str,
        id: &str,
        input: ReferencePatch,
        expected: ReferenceContentExpectation,
    ) -> Result<RefItem> {
        self.update_reference_with_expectation(actor, id, input, Some(expected))
    }

    fn update_reference_with_expectation(
        &self,
        actor: &str,
        id: &str,
        input: ReferencePatch,
        expected: Option<ReferenceContentExpectation>,
    ) -> Result<RefItem> {
        self.write(|c| {
            crate::service::member(c, actor)?;
            let item: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&item.audit)?;
            if expected.as_ref().is_some_and(|expected| {
                expected.title != item.title || expected.caption != item.caption_md
            }) {
                return Err(Error::Conflict);
            }
            let mut patch = serde_json::to_value(input)?;
            if let Some(title) = patch["title"].as_str()
                && !(expected.is_some() && item.kind == "note" && title.is_empty())
            {
                crate::m5::validate_name("title", title, 140)?;
            }
            if let Some(tags) = patch.get("tags") {
                patch["tags"] = json!(normalize_tags(&serde_json::from_value::<Vec<String>>(
                    tags.clone()
                )?)?);
            }
            if let Some(caption) = patch.as_object_mut().unwrap().remove("caption") {
                patch["captionMd"] = caption;
            }
            patch_record(c, "ref_items", id, &patch)?;
            patch_record(
                c,
                "ref_items",
                id,
                &json!({"updatedBy":actor,"updatedAt":now()}),
            )?;
            let eid = reference_epic(c, &item)?;
            v2_event(
                c,
                actor,
                eid.as_deref(),
                "reference.updated",
                None,
                json!({"itemId":id,"fields":patch.as_object().unwrap().keys().collect::<Vec<_>>()}),
            )?;
            fetch(c, "ref_items", "id", id)
        })
    }
    pub fn archive_reference(&self, actor: &str, id: &str) -> Result<()> {
        self.write(|c| {
            crate::service::member(c, actor)?;
            let item: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&item.audit)?;
            c.execute(
                "UPDATE ref_items SET archived_at=?,updated_by=?,updated_at=?,archived_by=? WHERE id=?",
                params![now(), actor, now(), archive_actor(c,actor)?, id],
            )?;
            v2_event(
                c,
                actor,
                reference_epic(c, &item)?.as_deref(),
                "reference.updated",
                None,
                json!({"itemId":id,"archived":true}),
            )
        })
    }
    pub fn list_references(
        &self,
        epic_key: Option<&str>,
        story_key: Option<&str>,
        task_key: Option<&str>,
    ) -> Result<Vec<RefItem>> {
        self.read(|c| {
            let project = jam(c)?;
            let targets = [epic_key, story_key, task_key]
                .into_iter()
                .flatten()
                .map(|k| target(c, k))
                .collect::<Result<Vec<_>>>()?;
            for (_, _, eid) in &targets {
                if epic(c, eid)?.audit.jam_id != project.id {
                    return Err(invalid("targetKey", "Choose a target in this project"));
                }
            }
            references_for(c, &targets)
        })
    }
    pub fn create_ref_frame(&self, actor: &str, frame: RefFrame) -> Result<RefFrame> {
        self.write(|c| create_frame_record(c, actor, frame))
    }
    pub fn update_ref_geometry(
        &self,
        actor: &str,
        id: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<RefItem> {
        geometry(x, y, w, h)?;
        self.write(|c| {
            crate::service::member(c, actor)?;
            let item: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&item.audit)?;
            c.execute(
                "UPDATE ref_items SET x=?,y=?,w=?,h=?,updated_by=?,updated_at=? WHERE id=?",
                params![x, y, w, h, actor, now(), id],
            )?;
            v2_event(
                c,
                actor,
                reference_epic(c, &item)?.as_deref(),
                "reference.updated",
                None,
                json!({"itemId":id,"fields":["x","y","w","h"]}),
            )?;
            fetch(c, "ref_items", "id", id)
        })
    }
    pub fn create_ref_edge(
        &self,
        actor: &str,
        from: &str,
        to: &str,
        label: &str,
    ) -> Result<RefEdge> {
        self.write(|c| create_edge_record(c, actor, from, to, label))
    }
    pub fn list_ref_frames(&self) -> Result<Vec<RefFrame>> {
        self.read(|c| {
            let j = jam(c)?;
            records(
                c,
                "ref_frames",
                "jam_id=? AND archived_at IS NULL ORDER BY id",
                &[&j.id],
            )
        })
    }
    pub fn list_ref_edges(&self) -> Result<Vec<RefEdge>> {
        self.read(|c| {
            let j = jam(c)?;
            records(
                c,
                "ref_edges",
                "jam_id=? AND archived_at IS NULL ORDER BY id",
                &[&j.id],
            )
        })
    }
    pub fn update_ref_frame(&self, actor: &str, id: &str, input: FramePatch) -> Result<RefFrame> {
        self.write(|c|{crate::service::member(c,actor)?;let old:RefFrame=fetch(c,"ref_frames","id",id)?;if old.archived_at.is_some(){return Err(Error::Archived(id.into()));}
let patch=serde_json::to_value(input)?;let mut merged=serde_json::to_value(&old)?;for(k,v)in patch.as_object().unwrap(){merged[k]=v.clone();}
let frame:RefFrame=serde_json::from_value(merged)?;geometry(frame.x,frame.y,frame.w,frame.h)?;crate::m5::validate_name("title",&frame.title,140)?;
if let Some(eid)=&frame.epic_id{let e=epic(c,eid)?;editable_audit(&e.audit)?;if e.audit.jam_id!=frame.jam_id{return Err(invalid("epicId","Choose an epic in this project"));}}
patch_record(c,"ref_frames",id,&patch)?;v2_event(c,actor,frame.epic_id.as_deref().or(old.epic_id.as_deref()),"reference.updated",None,json!({"frameId":id,"fields":patch.as_object().unwrap().keys().collect::<Vec<_>>()}))?;Ok(frame)})
    }
    pub fn archive_ref_frame(&self, actor: &str, id: &str) -> Result<()> {
        self.write(|c| {
            crate::service::member(c, actor)?;
            let f: RefFrame = fetch(c, "ref_frames", "id", id)?;
            if f.archived_at.is_some() {
                return Err(Error::Archived(id.into()));
            }
            c.execute(
                "UPDATE ref_frames SET archived_at=? WHERE id=?",
                params![now(), id],
            )?;
            v2_event(
                c,
                actor,
                f.epic_id.as_deref(),
                "reference.updated",
                None,
                json!({"frameId":id,"archived":true}),
            )
        })
    }
    pub fn archive_ref_edge(&self, actor: &str, id: &str) -> Result<()> {
        self.write(|c| {
            crate::service::member(c, actor)?;
            let e: RefEdge = fetch(c, "ref_edges", "id", id)?;
            if e.archived_at.is_some() {
                return Err(Error::Archived(id.into()));
            }
            let item: RefItem = fetch(c, "ref_items", "id", &e.from_item)?;
            c.execute(
                "UPDATE ref_edges SET archived_at=? WHERE id=?",
                params![now(), id],
            )?;
            v2_event(
                c,
                actor,
                reference_epic(c, &item)?.as_deref(),
                "reference.updated",
                None,
                json!({"edgeId":id,"archived":true}),
            )
        })
    }
}
pub(crate) fn reference_epic(c: &Connection, item: &RefItem) -> Result<Option<String>> {
    if let Some(frame) = &item.frame_id {
        let frame: RefFrame = fetch(c, "ref_frames", "id", frame)?;
        if frame.epic_id.is_some() && frame.archived_at.is_none() {
            return Ok(frame.epic_id);
        }
    }
    let links: Vec<RefLink> = records(
        c,
        "ref_links",
        "item_id=? AND archived_at IS NULL ORDER BY target_type,target_id",
        &[&item.audit.id],
    )?;
    for l in links {
        match l.target_type.as_str() {
            "epic" => return Ok(Some(l.target_id)),
            "story" => return Ok(Some(story(c, &l.target_id)?.epic_id)),
            "task" => {
                let key: String =
                    c.query_row("SELECT key FROM tasks WHERE id=?", [l.target_id], |r| {
                        r.get(0)
                    })?;
                return Ok(Some(crate::service::task(c, &key)?.epic_id));
            }
            _ => {}
        }
    }
    Ok(None)
}
fn geometry(x: f64, y: f64, w: f64, h: f64) -> Result<()> {
    if [x, y, w, h].iter().any(|n| !n.is_finite()) || w <= 0. || h <= 0. {
        Err(invalid(
            "geometry",
            "Coordinates must be finite and dimensions positive",
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn free_frame_x(c: &Connection, jam_id: &str) -> Result<f64> {
    Ok(c.query_row("SELECT coalesce(max(right_edge),-80)+80 FROM (SELECT x+w AS right_edge FROM ref_frames WHERE jam_id=?1 AND archived_at IS NULL UNION ALL SELECT i.x+i.w+coalesce(f.x,0) AS right_edge FROM ref_items i LEFT JOIN ref_frames f ON f.id=i.frame_id WHERE i.jam_id=?1 AND i.archived_at IS NULL)",[jam_id],|r|r.get(0))?)
}

pub(crate) fn create_frame_record(
    c: &Connection,
    actor: &str,
    mut frame: RefFrame,
) -> Result<RefFrame> {
    let a = audit(c, actor)?;
    frame.id = id();
    frame.jam_id = a.jam_id;
    frame.archived_at = None;
    frame.links.clear();
    crate::m5::validate_name("title", &frame.title, 140)?;
    geometry(frame.x, frame.y, frame.w, frame.h)?;
    if let Some(eid) = &frame.epic_id {
        let e = epic(c, eid)?;
        editable_audit(&e.audit)?;
        if e.audit.jam_id != frame.jam_id {
            return Err(invalid("epicId", "Choose an epic in this project"));
        }
    }
    insert(c, "ref_frames", &frame)?;
    v2_event(
        c,
        actor,
        frame.epic_id.as_deref(),
        "reference.added",
        None,
        json!({"frameId":frame.id,"title":frame.title}),
    )?;
    Ok(frame)
}

pub(crate) fn create_edge_record(
    c: &Connection,
    actor: &str,
    from: &str,
    to: &str,
    label: &str,
) -> Result<RefEdge> {
    let a = audit(c, actor)?;
    let first: RefItem = fetch(c, "ref_items", "id", from)?;
    let second: RefItem = fetch(c, "ref_items", "id", to)?;
    editable_audit(&first.audit)?;
    editable_audit(&second.audit)?;
    if first.audit.jam_id != a.jam_id || second.audit.jam_id != a.jam_id {
        return Err(invalid("items", "Choose items in this project"));
    }
    let edge = RefEdge {
        id: id(),
        jam_id: a.jam_id,
        from_item: from.into(),
        to_item: to.into(),
        label: label.into(),
        archived_at: None,
    };
    insert(c, "ref_edges", &edge)?;
    v2_event(
        c,
        actor,
        reference_epic(c, &first)?.as_deref(),
        "reference.linked",
        None,
        json!({"edgeId":edge.id}),
    )?;
    Ok(edge)
}

pub(crate) fn add_reference_tx(
    c: &rusqlite::Connection,
    actor: &str,
    input: AddReference,
    untitled: bool,
    existing_asset: Option<&str>,
) -> Result<RefItem> {
    let a = audit(c, actor)?;
    if !["asset", "link", "note"].contains(&input.kind.as_str()) {
        return Err(invalid("kind", "Choose asset, link or note"));
    }
    let mut asset_id = None;
    let mut url = None;
    let mut default_title = String::new();
    let mut metadata = None;
    if input.kind == "asset"
        && let Some(existing_asset) = existing_asset
    {
        let asset = crate::file_model::load_file(c, existing_asset, None)?;
        default_title = asset.asset.name;
        asset_id = Some(asset.asset.id);
    } else if input.kind == "asset" {
        let raw = input
            .file_path
            .as_deref()
            .ok_or_else(|| invalid("filePath", "A local file is required"))?;
        let path = std::path::Path::new(raw);
        if !path.is_absolute() {
            return Err(invalid("filePath", "Use an absolute local file path"));
        }
        let path = path
            .canonicalize()
            .map_err(|_| invalid("filePath", "The file must exist and be readable"))?;
        let db: String = c.query_row("PRAGMA database_list", [], |r| r.get(2))?;
        crate::file_model::validate_private_source(std::path::Path::new(&db), None, &path)?;
        let file = std::fs::File::open(&path)
            .map_err(|_| invalid("filePath", "The file must exist and be readable"))?;
        if !file.metadata()?.is_file() {
            return Err(invalid("filePath", "Choose a file"));
        }
        metadata = Some(json!({"size":file.metadata()?.len()}).to_string());
        default_title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Reference")
            .into();
        let asset = Asset {
            id: id(),
            jam_id: a.jam_id.clone(),
            kind: file_kind(&path).into(),
            name: input.title.clone().unwrap_or_else(|| default_title.clone()),
            location: path.to_string_lossy().into_owned(),
            notes: input.caption.clone(),
            created_by: actor.into(),
            created_at: now(),
            role: "reference".into(),
        };
        crate::m5::validate_name("name", &asset.name, 140)?;
        insert(c, "assets", &asset)?;
        asset_id = Some(asset.id);
    } else if input.kind == "link" {
        let value = input
            .url
            .as_deref()
            .ok_or_else(|| invalid("url", "A URL is required"))?;
        if !(value.starts_with("http://") || value.starts_with("https://"))
            || value.chars().any(char::is_whitespace)
        {
            return Err(invalid("url", "Use an http or https URL without spaces"));
        }
        url = Some(value.into());
        default_title = value.chars().take(140).collect();
    } else if input.text.as_deref().is_none_or(|s| s.trim().is_empty())
        && input.title.as_deref().is_none_or(|s| s.trim().is_empty())
    {
        return Err(invalid("text", "A note needs text or a heading"));
    }
    let mut frame_id = None;
    let mut event_epic = None;
    if let Some(id) = input.frame_id.as_deref() {
        if input.frame_epic_key.is_some() {
            return Err(invalid(
                "frameId",
                "Choose frameId or frameEpicKey, not both",
            ));
        }
        let f: RefFrame = fetch(c, "ref_frames", "id", id)?;
        if f.archived_at.is_some() || f.jam_id != a.jam_id {
            return Err(invalid("frameId", "Choose an active frame in this project"));
        }
        event_epic = f.epic_id;
        frame_id = Some(f.id);
    }
    if let Some(key) = input.frame_epic_key.as_deref() {
        let e = epic(c, key)?;
        editable_audit(&e.audit)?;
        if e.audit.jam_id != a.jam_id {
            return Err(invalid(
                "frameEpicKey",
                "Choose an epic in the active project",
            ));
        }
        let frames: Vec<RefFrame> = records(
            c,
            "ref_frames",
            "epic_id=? AND archived_at IS NULL ORDER BY id",
            &[&e.audit.id],
        )?;
        frame_id = Some(if let Some(f) = frames.first() {
            f.id.clone()
        } else {
            let f = RefFrame {
                id: id(),
                jam_id: a.jam_id.clone(),
                epic_id: Some(e.audit.id.clone()),
                title: format!("{} references", e.title),
                x: free_frame_x(c, &a.jam_id)?,
                y: 0.,
                w: 800.,
                h: 600.,
                color: e.color,
                archived_at: None,
                collapsed: false,
                links: vec![],
            };
            insert(c, "ref_frames", &f)?;
            f.id
        });
        event_epic = Some(e.audit.id);
    }
    if frame_id.is_none() && crate::service::member(c, actor)?.kind == "agent" {
        let frames: Vec<RefFrame> = records(
            c,
            "ref_frames",
            "jam_id=? AND title='Agent inbox' AND archived_at IS NULL",
            &[&a.jam_id],
        )?;
        frame_id = Some(if let Some(f) = frames.first() {
            f.id.clone()
        } else {
            let f = RefFrame {
                id: id(),
                jam_id: a.jam_id.clone(),
                epic_id: None,
                title: "Agent inbox".into(),
                x: free_frame_x(c, &a.jam_id)?,
                y: 0.,
                w: 320.,
                h: 1200.,
                color: "m4".into(),
                archived_at: None,
                collapsed: false,
                links: vec![],
            };
            insert(c, "ref_frames", &f)?;
            f.id
        });
    }
    let count: i64 = if let Some(f) = &frame_id {
        c.query_row(
            "SELECT count(*) FROM ref_items WHERE frame_id=? AND archived_at IS NULL",
            [f],
            |r| r.get(0),
        )?
    } else {
        0
    };
    let columns = if let Some(f) = &frame_id {
        let frame: RefFrame = fetch(c, "ref_frames", "id", f)?;
        if frame.title == "Agent inbox" { 1 } else { 3 }
    } else {
        3
    };
    let x = input.x.unwrap_or(if frame_id.is_some() {
        24. + (count % columns) as f64 * 260.
    } else {
        0.
    });
    let y = input.y.unwrap_or(if frame_id.is_some() {
        56. + (count / columns) as f64 * 230.
    } else {
        0.
    });
    if let Some(f) = &frame_id {
        c.execute(
            "UPDATE ref_frames SET h=max(h,?) WHERE id=?",
            params![y + 230., f],
        )?;
    }
    geometry(x, y, 240., 180.)?;
    let title = input.title.unwrap_or_else(|| {
        if input.kind == "note" {
            "Note".into()
        } else {
            default_title
        }
    });
    if !untitled {
        crate::m5::validate_name("title", &title, 140)?;
    }
    let item = RefItem {
        file: None,
        audit: a,
        kind: input.kind,
        asset_id,
        url,
        title,
        caption_md: [input.text, input.caption]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        tags: normalize_tags(input.tags.as_deref().unwrap_or(&[]))?,
        x,
        y,
        w: 240.,
        h: 180.,
        z: 0.,
        frame_id,
        link_preview: None,
        metadata,
        verdict: None,
        archived_by: None,
        via: None,
        frame_title: None,
    };
    insert(c, "ref_items", &item)?;
    let mut tid = None;
    if let Some(key) = input.link_to.as_deref() {
        let (kind, target_id, eid) = link(c, &item, key)?;
        event_epic = Some(eid);
        if kind == "task" {
            tid = Some(target_id);
        }
    }
    v2_event(
        c,
        actor,
        event_epic.as_deref(),
        "reference.added",
        tid.as_deref(),
        json!({"itemId":item.audit.id,"title":item.title,"assetId":item.asset_id}),
    )?;
    Ok(item)
}
