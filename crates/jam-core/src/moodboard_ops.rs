use crate::planning::*;
use crate::*;
use rusqlite::{Connection, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendReferenceReviewInput {
    /// Active nonempty moodboard frame in this project; humans only.
    pub frame_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectKeptInput {
    /// Required stable retry ID, 1–100 characters. Reuse only for the same collection intent.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
    /// 1–20 active source frames in this project, in section order.
    #[schemars(length(min = 1, max = 20))]
    pub source_frame_ids: Vec<String>,
    /// New frame heading, 1–140 characters; default Moodboard — kept.
    pub title: Option<String>,
    /// Optional epic, story or task key to link the new frame to.
    pub link_to: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeptSection {
    pub source_frame_id: String,
    pub title: String,
    pub count: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollectKeptResult {
    pub frame: RefFrame,
    pub sections: Vec<KeptSection>,
    pub item_ids: Vec<String>,
}

fn active_frame(c: &Connection, id: &str) -> Result<RefFrame> {
    let frame: RefFrame = fetch(c, "ref_frames", "id", id)?;
    if frame.archived_at.is_some() {
        return Err(Error::Archived(id.into()));
    }
    Ok(frame)
}
fn frame_epic(c: &Connection, frame: &RefFrame) -> Result<Option<String>> {
    if frame.epic_id.is_some() {
        return Ok(frame.epic_id.clone());
    }
    if let Some(link) = frame.links.first() {
        return Ok(Some(crate::references::target(c, &link.target_key)?.2));
    }
    Ok(None)
}
pub(crate) fn row_major(items: &mut [RefItem]) {
    items.sort_by(|a, b| {
        a.y.total_cmp(&b.y)
            .then(a.x.total_cmp(&b.x))
            .then(a.audit.id.cmp(&b.audit.id))
    });
    let mut start = 0;
    while start < items.len() {
        let y = items[start].y;
        let mut end = start + 1;
        while end < items.len() && items[end].y - y < 24. {
            end += 1;
        }
        items[start..end].sort_by(|a, b| a.x.total_cmp(&b.x).then(a.audit.id.cmp(&b.audit.id)));
        start = end;
    }
}
impl Store {
    pub fn send_reference_review(&self, actor: &str, frame_id: &str) -> Result<RefFrame> {
        self.write(|c| {
            if crate::service::member(c,actor)?.kind!="human" { return Err(Error::Forbidden("Only humans send a review".into())); }
            let frame=active_frame(c,frame_id)?;
            let review=frame.review.as_ref().ok_or_else(||invalid("frameId","This frame has nothing to review"))?;
            let items: Vec<RefItem>=records(c,"ref_items","frame_id=? AND archived_at IS NULL AND kind!='note' ORDER BY id",&[&frame_id])?;
            c.execute("UPDATE ref_frames SET review_sent_at=?,review_sent_by=?,review_hash=? WHERE id=?",params![now(),actor,crate::moodboard::review_hash(&items),frame_id])?;
            let item_ids=items.iter().filter(|i|i.verdict.is_some()).take(200).map(|i|&i.audit.id).collect::<Vec<_>>();
            v2_event(c,actor,frame_epic(c,&frame)?.as_deref(),"reference.review_sent",None,json!({"frameId":frame_id,"frameTitle":frame.title,"total":review.total,"keep":review.keep,"reject":review.reject,"unrated":review.unrated,"comments":review.comments,"itemIds":item_ids}))?;
            fetch(c,"ref_frames","id",frame_id)
        })
    }
    pub fn collect_kept_references(
        &self,
        actor: &str,
        input: CollectKeptInput,
    ) -> Result<CollectKeptResult> {
        if input.source_frame_ids.is_empty() || input.source_frame_ids.len() > 20 {
            return Err(invalid("sourceFrameIds", "Choose 1 to 20 frames"));
        }
        let payload = serde_json::to_value(&input)?;
        self.write(|c| Ok(crate::receipts::with_receipt_if(c,actor,Some(&input.request_id),"collect_kept_references",None,&payload,|| {
            crate::service::member(c,actor)?;
            let title=input.title.clone().unwrap_or_else(||"Moodboard — kept".into());crate::m5::validate_name("title",&title,140)?;
            let target=input.link_to.as_deref().map(|key|crate::references::target(c,key)).transpose()?;
            let mut sources=vec![];
            for id in &input.source_frame_ids {
                let frame=active_frame(c,id)?;
                let mut items:Vec<RefItem>=records(c,"ref_items","frame_id=? AND archived_at IS NULL AND kind!='note' AND verdict='keep'",&[id])?;
                row_major(&mut items);if !items.is_empty() {sources.push((frame,items));}
            }
            if sources.is_empty() {return Err(invalid("sourceFrameIds","No Keep items in these frames"));}
            let project=crate::service::jam(c)?.id;
            if let Some((_,_,eid))=&target && epic(c,eid)?.audit.jam_id!=project {return Err(invalid("linkTo","Choose a target in this project"));}
            let mut frame=crate::references::create_frame_record(c,actor,RefFrame {replayed:false,updated_at:String::new(),id:String::new(),jam_id:project.clone(),epic_id:None,title,x:crate::references::free_frame_x(c,&project)?,y:0.,w:1080.,h:600.,color:"m4".into(),archived_at:None,collapsed:false,links:vec![],review:None})?;
            let mut cursor=24.;let mut bottom=0.;let mut sections=vec![];let mut item_ids=vec![];
            for (source,items) in sources {
                let header=crate::references::add_reference_tx(c,actor,AddReference {kind:ReferenceKind::Note,title:Some(source.title.clone()),frame_id:Some(frame.id.clone()),x:Some(24.),y:Some(cursor),..Default::default()},false,None)?;
                c.execute("UPDATE ref_items SET w=1032,h=48 WHERE id=?",[&header.audit.id])?;
                cursor+=72.;
                sections.push(KeptSection {source_frame_id:source.id,title:source.title,count:items.len() as u32});
                for (index,original) in items.into_iter().enumerate() {
                    let mut item=original.clone();item.audit=audit(c,actor)?;item.file=None;item.replayed=false;item.frame_id=Some(frame.id.clone());item.verdict=None;item.verdict_note=None;item.copied_from=Some(original.audit.id);item.via=None;item.frame_title=None;item.archived_by=None;
                    item.x=24.+(index%4) as f64*264.;item.y=cursor+(index/4) as f64*230.;item.w=240.;item.h=180.;item.z=0.;
                    bottom=item.y+180.;insert(c,"ref_items",&item)?;
                    v2_event(c,actor,None,"reference.added",None,json!({"itemId":item.audit.id,"title":item.title,"assetId":item.asset_id,"frameId":frame.id}))?;
                    item_ids.push(item.audit.id);
                }
                cursor=bottom+32.;
            }
            c.execute("UPDATE ref_frames SET h=? WHERE id=?",params![bottom+24.,frame.id])?;
            if let Some((kind,id,eid))=target {
                c.execute("INSERT INTO ref_frame_links(frame_id,target_type,target_id) VALUES(?,?,?)",params![frame.id,kind,id])?;
                v2_event(c,actor,Some(&eid),"reference.updated",None,json!({"frameId":frame.id,"key":input.link_to}))?;
            }
            frame=fetch(c,"ref_frames","id",&frame.id)?;
            Ok((CollectKeptResult{frame,sections,item_ids},true))
        },|value|Ok(serde_json::from_value(value.clone())?))?.value))
    }
}
