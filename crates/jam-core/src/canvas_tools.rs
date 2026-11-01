//! Bounded agent canvas reads and atomic layout operations; coordinates are world units.
use crate::planning::*;
use crate::references::{create_edge_record, create_frame_record, free_frame_x};
use crate::service::jam;
use crate::*;

pub(crate) fn attached_to(
    note: &RefItem,
    items: &[RefItem],
    frames: &[RefFrame],
    include_archived: bool,
) -> Vec<String> {
    let world = |item: &RefItem| {
        let frame = frames
            .iter()
            .find(|f| Some(&f.id) == item.frame_id.as_ref());
        (
            item.x + frame.map_or(0., |f| f.x),
            item.y + frame.map_or(0., |f| f.y),
        )
    };
    let (x, y) = world(note);
    let (cx, cy) = (x + note.w / 2., y + note.h / 2.);
    items
        .iter()
        .filter(|item| {
            item.audit.id != note.audit.id && (include_archived || item.audit.archived_at.is_none())
        })
        .filter(|item| {
            let (ix, iy) = world(item);
            let centre = cx >= ix && cx <= ix + item.w && cy >= iy && cy <= iy + item.h;
            let overlap = (x + note.w).min(ix + item.w) - x.max(ix);
            let height = (y + note.h).min(iy + item.h) - y.max(iy);
            centre || overlap.max(0.) * height.max(0.) >= 0.3 * note.w * note.h
        })
        .map(|item| item.audit.id.clone())
        .collect()
}
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

fn frame_in_epic(c: &rusqlite::Connection, frame: &RefFrame, epic_id: &str) -> Result<bool> {
    if frame.epic_id.as_deref() == Some(epic_id) {
        return Ok(true);
    }
    for link in &frame.links {
        let eid = match link.kind {
            ReferenceTargetKind::Epic => epic(c, &link.target_key)?.audit.id,
            ReferenceTargetKind::Story => story(c, &link.target_key)?.epic_id,
            ReferenceTargetKind::Task => crate::service::task(c, &link.target_key)?.epic_id,
        };
        if eid == epic_id {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasQuery {
    /// Filter active non-note references by keep, reject or unrated; attached notes follow matching references.
    pub verdict: Option<VerdictFilter>,
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: Option<String>,
    /// Existing frame ID, e.g. 01JFRAME. Omitted updates preserve the parent; null detaches where supported.
    pub frame_id: Option<String>,
    #[serde(default)]
    /// Include archived records; default false. Example: true.
    pub include_archived: bool,
    #[schemars(range(min = 1, max = 200))]
    /// Maximum rows per page. Canvas allows 1–200; files allow 1–500. Omitted uses the operation default; example 50.
    pub limit: Option<usize>,
    /// Captured activity cursor or paging offset; starts at 0. Follow nextCursor; pages are not an atomic snapshot.
    pub cursor: Option<usize>,
}

/// Human feedback filter for a moodboard canvas read.
#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VerdictFilter {
    /// References explicitly kept by a human.
    Keep,
    /// References explicitly rejected by a human.
    Reject,
    /// References without a human verdict.
    Unrated,
}
impl VerdictFilter {
    fn matches(self, item: &RefItem) -> bool {
        match self {
            Self::Keep => item.verdict == Some(ReferenceVerdict::Keep),
            Self::Reject => item.verdict == Some(ReferenceVerdict::Reject),
            Self::Unrated => item.verdict.is_none(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasFrameCreate {
    /// Optional stable retry ID, 1–100 characters, e.g. design-frame-1; recommended to avoid duplicate frames.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: Option<String>,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: String,
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: Option<String>,
    /// Horizontal canvas/world coordinate, e.g. 120; omitted preserves updates or uses create placement.
    pub x: Option<f64>,
    /// Vertical canvas/world coordinate, e.g. 80; omitted preserves updates or uses create placement.
    pub y: Option<f64>,
    /// Positive canvas width, e.g. 900 world units; omitted preserves updates or uses create size.
    pub w: Option<f64>,
    /// Positive canvas height, e.g. 600 world units; omitted preserves updates or uses create size.
    pub h: Option<f64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasFrameUpdate {
    /// Stable object ID or accepted scope key, e.g. JB-S3; required for ID-specific operations.
    pub id: String,
    /// Short human-readable title; tasks, epics and stories allow 1–140 characters. Example: Add lantern pickup. Omitted updates keep it.
    pub title: Option<String>,
    /// Horizontal canvas/world coordinate, e.g. 120; omitted preserves updates or uses create placement.
    pub x: Option<f64>,
    /// Vertical canvas/world coordinate, e.g. 80; omitted preserves updates or uses create placement.
    pub y: Option<f64>,
    /// Positive canvas width, e.g. 900 world units; omitted preserves updates or uses create size.
    pub w: Option<f64>,
    /// Positive canvas height, e.g. 600 world units; omitted preserves updates or uses create size.
    pub h: Option<f64>,
    #[serde(default, deserialize_with = "crate::model::nullable")]
    /// Epic key in the connected project, e.g. JB-E2; required for epic-specific operations, optional for filters.
    pub epic_key: Option<Option<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasPlacement {
    /// Existing reference ID in this project, e.g. 01JITEM; required for item-specific operations.
    pub item_id: String,
    /// Horizontal canvas/world coordinate, e.g. 120; omitted preserves updates or uses create placement.
    pub x: Option<f64>,
    /// Vertical canvas/world coordinate, e.g. 80; omitted preserves updates or uses create placement.
    pub y: Option<f64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasArrange {
    #[schemars(length(min = 1, max = 100))]
    /// References to arrange atomically, 1–100 items. Example: [{"itemId":"01JITEM","x":120,"y":80}].
    pub items: Vec<CanvasPlacement>,
    #[serde(default, deserialize_with = "crate::model::nullable")]
    /// Existing frame ID, e.g. 01JFRAME. Omitted updates preserve the parent; null detaches where supported.
    pub frame_id: Option<Option<String>>,
    /// Optional automatic layout: grid. Requires a frameId and no explicit coordinates; omission uses explicit placement.
    pub layout: Option<CanvasLayout>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CanvasLayout {
    Grid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPage {
    pub frames: Vec<serde_json::Value>,
    pub references: Vec<serde_json::Value>,
    pub edges: Vec<serde_json::Value>,
    pub total: usize,
    pub truncated: bool,
    pub next_cursor: Option<usize>,
}

impl Store {
    /// Offset paging is deterministic for an unchanged canvas, not a multi-call snapshot.
    pub fn get_canvas(&self, input: CanvasQuery) -> Result<CanvasPage> {
        let limit = input.limit.unwrap_or(100);
        if !(1..=200).contains(&limit) {
            return Err(invalid("limit", "Use 1 to 200 records"));
        }
        self.read(|c| {
            let project = jam(c)?;
            let epic_id = input.epic_key.as_deref().map(|k| epic(c, k).map(|e| e.audit.id)).transpose()?;
            if let Some(id) = &input.frame_id {
                let _: RefFrame = fetch(c, "ref_frames", "id", id)?;
            }
            let frames: Vec<RefFrame> = records(c, "ref_frames", "jam_id=? ORDER BY id", &[&project.id])?;
            let items: Vec<RefItem> = records(c, "ref_items", "jam_id=? ORDER BY id", &[&project.id])?;
            let edges: Vec<RefEdge> = records(c, "ref_edges", "jam_id=? ORDER BY id", &[&project.id])?;
            let links: Vec<RefLink> = records(c, "ref_links", "item_id IN (SELECT id FROM ref_items WHERE jam_id=?) AND archived_at IS NULL ORDER BY target_type,target_id", &[&project.id])?;
            let mut rows = Vec::new();
            for f in &frames {
                if (input.include_archived || f.archived_at.is_none())
                    && input.frame_id.as_ref().is_none_or(|id| id == &f.id)
                    && match &epic_id { None=>true,Some(id)=>frame_in_epic(c,f,id)? } {
                    let epic_key = f.epic_id.as_deref().map(|id| epic(c, id).map(|e| e.key)).transpose()?;
                    rows.push((0, json!({"id":f.id,"title":f.title,"epicKey":epic_key,"x":f.x,"y":f.y,"w":f.w,"h":f.h,"collapsed":f.collapsed,"archivedAt":f.archived_at,"links":f.links,"review":f.review})));
                }
            }
            let mut visible = HashSet::new();
            let matches_verdict = items.iter().filter(|i| i.kind != "note" && (input.include_archived || i.audit.archived_at.is_none()) && input.verdict.is_none_or(|filter| filter.matches(i))).map(|i|i.audit.id.clone()).collect::<HashSet<_>>();
            for item in &items {
                if input.verdict.is_some() && item.kind != "note" && !matches_verdict.contains(&item.audit.id) { continue; }
                if !input.include_archived && item.audit.archived_at.is_some() { continue; }
                if input.frame_id.as_ref().is_some_and(|id| item.frame_id.as_ref() != Some(id)) { continue; }
                let frame = frames.iter().find(|f| Some(&f.id) == item.frame_id.as_ref());
                let mut keys = Vec::new();
                if let Some(f) = frame.filter(|f| input.include_archived || f.archived_at.is_none())
                    && let Some(id) = &f.epic_id {
                    keys.push(epic(c, id)?.key);
                }
                let mut matches_epic = epic_id.is_none() || frame.is_some_and(|f| (input.include_archived || f.archived_at.is_none()) && f.epic_id == epic_id);
                if let Some(f)=frame.filter(|f| input.include_archived || f.archived_at.is_none()) {
                    if let Some(id)=&epic_id { matches_epic |= frame_in_epic(c,f,id)?; }
                    for link in &f.links {
                        keys.push(link.target_key.clone());
                    }
                }
                for link in links.iter().filter(|l| l.item_id == item.audit.id) {
                    let (key, eid) = match link.target_type.as_str() {
                        "epic" => { let e = epic(c, &link.target_id)?; (e.key, e.audit.id) },
                        "story" => { let s = story(c, &link.target_id)?; (s.key, s.epic_id) },
                        "task" => { let t: serde_json::Value = fetch(c, "tasks", "id", &link.target_id)?; let t = crate::service::task(c, t["key"].as_str().ok_or_else(||invalid("key", "Task has no key"))?)?; (t.key, t.epic_id) },
                        _ => continue,
                    };
                    matches_epic |= epic_id.as_ref() == Some(&eid);
                    keys.push(key);
                }
                if !matches_epic { continue; }
                keys.sort(); keys.dedup();
                let keys_truncated = keys.len() > 50;
                keys.truncate(50);
                visible.insert(item.audit.id.clone());
                let mut row=json!({"id":item.audit.id,"kind":item.kind,"title":item.title,"text":item.caption_md.chars().take(200).collect::<String>(),"x":item.x+frame.map_or(0.,|f|f.x),"y":item.y+frame.map_or(0.,|f|f.y),"w":item.w,"h":item.h,"frameId":item.frame_id,"linkedKeys":keys,"linkedKeysTruncated":keys_truncated,"verdict":item.verdict,"verdictNote":item.verdict_note,"sourceUrl":item.source_url,"origin":item.origin,"derivedFrom":item.derived_from,"copiedFrom":item.copied_from,"archivedAt":item.audit.archived_at,"archivedBy":item.archived_by});
                if item.kind=="note" {
                    row["attachedTo"]=json!(attached_to(item,&items,&frames,input.include_archived));
                }
                rows.push((1,row));
            }
            if input.verdict.is_some() {
                let shown_items=rows.iter().filter(|(kind,row)|*kind==1 && row["kind"]!="note").filter_map(|(_,row)|row["id"].as_str().map(str::to_owned)).collect::<HashSet<_>>();
                rows.retain(|(kind,row)|*kind!=1 || row["kind"]!="note" || row["attachedTo"].as_array().is_some_and(|ids|ids.iter().filter_map(serde_json::Value::as_str).any(|id|shown_items.contains(id))));
                visible=rows.iter().filter(|(kind,_)|*kind==1).filter_map(|(_,row)|row["id"].as_str().map(str::to_owned)).collect();
            }
            for e in edges {
                if (input.include_archived || e.archived_at.is_none()) && visible.contains(&e.from_item) && visible.contains(&e.to_item) {
                    rows.push((2, json!({"id":e.id,"from":e.from_item,"to":e.to_item,"label":e.label.chars().take(240).collect::<String>(),"archivedAt":e.archived_at})));
                }
            }
            let total = rows.len();
            let start = input.cursor.unwrap_or(0);
            if start > total { return Err(invalid("cursor", "Cursor exceeds the filtered canvas; reread from the beginning")); }
            let end = start.saturating_add(limit).min(total);
            let mut page = CanvasPage {frames:vec![],references:vec![],edges:vec![],total,truncated:end<total,next_cursor:(end<total).then_some(end)};
            for (kind, row) in rows.into_iter().skip(start).take(limit) {
                match kind { 0=>page.frames.push(row), 1=>page.references.push(row), _=>page.edges.push(row) }
            }
            Ok(page)
        })
    }

    pub fn create_canvas_frame(&self, actor: &str, input: CanvasFrameCreate) -> Result<RefFrame> {
        let payload = serde_json::to_value(&input)?;
        let request = input.request_id.clone();
        self.write(|c| {
            Ok(crate::receipts::with_receipt(
                c,
                actor,
                request.as_deref(),
                "create_frame",
                "frame",
                &payload,
                || {
                    let project = jam(c)?;
                    let epic_id = input
                        .epic_key
                        .as_deref()
                        .map(|key| epic(c, key).map(|e| e.audit.id))
                        .transpose()?;
                    create_frame_record(
                        c,
                        actor,
                        RefFrame {
                            replayed: false,
                            updated_at: String::new(),
                            id: String::new(),
                            jam_id: project.id.clone(),
                            epic_id,
                            title: input.title,
                            x: input.x.unwrap_or(free_frame_x(c, &project.id)?),
                            y: input.y.unwrap_or(0.),
                            w: input.w.unwrap_or(900.),
                            h: input.h.unwrap_or(600.),
                            color: "m4".into(),
                            archived_at: None,
                            collapsed: false,
                            links: vec![],
                            review: None,
                        },
                    )
                },
                |receipt| {
                    crate::planning::fetch(
                        c,
                        "ref_frames",
                        "id",
                        receipt["id"]
                            .as_str()
                            .ok_or_else(|| invalid("receipt", "Missing ID"))?,
                    )
                },
            )?
            .value)
        })
    }

    pub fn update_canvas_frame(&self, actor: &str, input: CanvasFrameUpdate) -> Result<RefFrame> {
        // Keys resolve in this same pinned project. The shared write revalidates the epic.
        let epic_id = input
            .epic_key
            .map(|key| {
                key.map(|key| self.read(|c| epic(c, &key).map(|e| e.audit.id)))
                    .transpose()
            })
            .transpose()?;
        self.update_ref_frame(
            actor,
            &input.id,
            FramePatch {
                title: input.title,
                x: input.x,
                y: input.y,
                w: input.w,
                h: input.h,
                epic_id,
                ..Default::default()
            },
        )
    }

    pub fn connect_canvas_references(
        &self,
        actor: &str,
        from: &str,
        to: &str,
        label: &str,
    ) -> Result<RefEdge> {
        if from == to {
            return Err(invalid("to", "A reference cannot connect to itself"));
        }
        if label.chars().count() > 240 {
            return Err(invalid("label", "Use at most 240 characters"));
        }
        self.write(|c| {
            // Resolve both endpoints before checking duplicates to preserve scope validation.
            let _: RefItem = fetch(c, "ref_items", "id", from)?;
            let _: RefItem = fetch(c, "ref_items", "id", to)?;
            let exists: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM ref_edges WHERE from_item=? AND to_item=? AND archived_at IS NULL)", [from,to], |r| r.get(0))?;
            if exists { return Err(invalid("to", "An active connection already exists from this reference to that reference")); }
            create_edge_record(c, actor, from, to, label)
        })
    }

    /// One immediate transaction: invalid input or insufficient space rolls back every move/event.
    /// Returned x/y are world coordinates; persisted geometry stays frame-local.
    pub fn arrange_canvas_references(
        &self,
        actor: &str,
        input: CanvasArrange,
    ) -> Result<Vec<RefItem>> {
        if input.items.is_empty() || input.items.len() > 100 {
            return Err(invalid("items", "Choose 1 to 100 references"));
        }
        self.write(|c| {
            crate::service::member(c, actor)?;
            let mut ids = HashSet::new();
            let mut items = Vec::new();
            for p in &input.items {
                if !ids.insert(p.item_id.clone()) { return Err(invalid("items", "Each reference may appear only once")); }
                let item:RefItem=fetch(c,"ref_items","id",&p.item_id)?;
                editable_audit(&item.audit)?;
                items.push(item);
            }
            let destination = input.frame_id.as_ref().and_then(|id|id.as_deref()).map(|id| fetch::<RefFrame>(c,"ref_frames","id",id)).transpose()?;
            if destination.as_ref().is_some_and(|f|f.archived_at.is_some()) { return Err(invalid("frameId", "Choose an active frame in this project")); }
            let mut obstacles = Vec::new();
            if input.layout.is_some() {
                let f=destination.as_ref().ok_or_else(||invalid("frameId","Grid requires an explicit active frameId"))?;
                if input.items.iter().any(|p| p.x.is_some() || p.y.is_some()) { return Err(invalid("items", "Grid chooses positions; omit x and y")); }
                let occupants:Vec<RefItem>=records(c,"ref_items","frame_id=? AND archived_at IS NULL",&[&f.id])?;
                obstacles.extend(occupants.into_iter().filter(|i|!ids.contains(&i.audit.id)).map(|i|(i.x,i.y,i.w,i.h)));
            }
            let mut result=Vec::new();
            for (item,p) in items.into_iter().zip(input.items) {
                let frame_id=input.frame_id.clone().unwrap_or(item.frame_id.clone());
                let frame=frame_id.as_deref().map(|id|fetch::<RefFrame>(c,"ref_frames","id",id)).transpose()?;
                let (ox,oy)=frame.as_ref().map_or((0.,0.),|f|(f.x,f.y));
                let old_frame=item.frame_id.as_deref().map(|id|fetch::<RefFrame>(c,"ref_frames","id",id)).transpose()?;
                let (old_x,old_y)=old_frame.as_ref().map_or((item.x,item.y),|f|(item.x+f.x,item.y+f.y));
                let (x,y)=if input.layout.is_some() {
                    let f=destination.as_ref().unwrap();
                    let mut ys=vec![56.];
                    ys.extend(obstacles.iter().map(|&(_,y,_,h)|y+h+24.));
                    ys.sort_by(f64::total_cmp);
                    let mut chosen=None;
                    for y in ys {
                        let mut xs=vec![24.];
                        xs.extend(obstacles.iter().map(|&(x,_,w,_)|x+w+24.));
                        xs.sort_by(f64::total_cmp);
                        for x in xs {
                            if x+item.w <= f.w-24. && y+item.h <= f.h-24. && obstacles.iter().all(|&(a,b,w,h)|x+item.w+24.<=a || a+w+24.<=x || y+item.h+24.<=b || b+h+24.<=y) {
                                chosen=Some((x,y));break;
                            }
                        }
                        if chosen.is_some(){break;}
                    }
                    let point=chosen.ok_or_else(||invalid("layout","References do not fit without overlap; resize the frame or select fewer references"))?;
                    obstacles.push((point.0,point.1,item.w,item.h));point
                } else { (p.x.unwrap_or(old_x)-ox,p.y.unwrap_or(old_y)-oy) };
                let mut updated = crate::canvas::geometry_record(c,actor,CanvasGeometry {id:item.audit.id,x,y,w:item.w,h:item.h,z:item.z,frame_id})?;
                updated.x += ox;
                updated.y += oy;
                result.push(updated);
            }
            Ok(result)
        })
    }
}
