//! Reference storage never fetches remote URLs. Preview fetching is a separate explicit operation.
use crate::planning::*;
use crate::service::{jam, normalize_tags};
use crate::*;
use rusqlite::{Connection, params};
use serde_json::json;

pub(crate) fn file_kind(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "aseprite" => "sprite",
        "wav" | "ogg" | "mp3" => "audio",
        "ttf" | "otf" | "woff2" => "font",
        "tmx" | "ldtk" | "json" => "level",
        _ => "other",
    }
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
    records(
        c,
        "ref_items",
        "archived_at IS NULL AND (id IN (SELECT item_id FROM ref_links WHERE archived_at IS NULL AND ((target_type='task' AND target_id=?) OR (target_type='story' AND target_id=?) OR (target_type='epic' AND target_id=?))) OR frame_id IN (SELECT id FROM ref_frames WHERE epic_id=? AND archived_at IS NULL)) ORDER BY z,id",
        &[&t.id, &t.story_id, &t.epic_id, &t.epic_id],
    )
}
impl Store {
    pub fn add_reference(&self, actor: &str, input: AddReference) -> Result<RefItem> {
        self.write(|c| {
            let a = audit(c, actor)?;
            if !["asset", "link", "note"].contains(&input.kind.as_str()) {
                return Err(invalid("kind", "Choose asset, link or note"));
            }
            let mut asset_id = None;
            let mut url = None;
            let mut default_title = String::new();
            let mut metadata = None;
            if input.kind == "asset" {
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
            } else if input.text.as_deref().is_none_or(|s| s.trim().is_empty()) {
                return Err(invalid("text", "A note needs text"));
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
            crate::m5::validate_name("title", &title, 140)?;
            let item = RefItem {
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
        })
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
        self.write(|c| {
            crate::service::member(c, actor)?;
            let item: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&item.audit)?;
            let mut patch = serde_json::to_value(input)?;
            if let Some(title) = patch["title"].as_str() {
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
                "UPDATE ref_items SET archived_at=?,updated_by=?,updated_at=? WHERE id=?",
                params![now(), actor, now(), id],
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
            let j = jam(c)?;
            let mut rows: Vec<RefItem> = records(
                c,
                "ref_items",
                "jam_id=? AND archived_at IS NULL ORDER BY z,id",
                &[&j.id],
            )?;
            let targets = [epic_key, story_key, task_key]
                .into_iter()
                .flatten()
                .map(|k| target(c, k))
                .collect::<Result<Vec<_>>>()?;
            if !targets.is_empty() {
                let links: Vec<RefLink> = records(c, "ref_links", "archived_at IS NULL", &[])?;
                let frames: Vec<RefFrame> = records(c, "ref_frames", "archived_at IS NULL", &[])?;
                rows.retain(|item| {
                    targets.iter().any(|(kind, id, _)| {
                        links.iter().any(|l| {
                            l.item_id == item.audit.id
                                && l.target_type == *kind
                                && l.target_id == *id
                        }) || (kind == "epic"
                            && frames.iter().any(|f| {
                                Some(&f.id) == item.frame_id.as_ref()
                                    && f.epic_id.as_ref() == Some(id)
                            }))
                    })
                });
            }
            Ok(rows)
        })
    }
    pub fn create_ref_frame(&self, actor: &str, mut frame: RefFrame) -> Result<RefFrame> {
        self.write(|c| {
            let a = audit(c, actor)?;
            frame.id = id();
            frame.jam_id = a.jam_id;
            frame.archived_at = None;
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
        })
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
        self.write(|c| {
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
        })
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

fn free_frame_x(c: &Connection, jam_id: &str) -> Result<f64> {
    Ok(c.query_row("SELECT coalesce(max(right_edge),-80)+80 FROM (SELECT x+w AS right_edge FROM ref_frames WHERE jam_id=?1 AND archived_at IS NULL UNION ALL SELECT i.x+i.w+coalesce(f.x,0) AS right_edge FROM ref_items i LEFT JOIN ref_frames f ON f.id=i.frame_id WHERE i.jam_id=?1 AND i.archived_at IS NULL)",[jam_id],|r|r.get(0))?)
}
