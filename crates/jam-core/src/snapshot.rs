use crate::service::{TASK_COLUMNS, event, jam, task};
use crate::*;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskTagRow {
    pub task_id: String,
    pub tag: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskAssetRow {
    pub task_id: String,
    pub asset_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JamExport {
    pub version: u32,
    pub jam: Jam,
    pub members: Vec<Member>,
    pub tasks: Vec<TaskSummary>,
    pub tags: Vec<TaskTagRow>,
    pub assets: Vec<Asset>,
    pub links: Vec<TaskAssetRow>,
    pub comments: Vec<Comment>,
    pub activity: Vec<ActivityEvent>,
}

impl Store {
    pub fn import_jam_file(&self, actor: &str, path: &std::path::Path) -> Result<AppState> {
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(invalid("file", "Import is limited to 32 MiB"));
        }
        let json = std::str::from_utf8(&bytes)
            .map_err(|_| invalid("file", "Use a UTF-8 Jam Board JSON file"))?;
        self.import_jam_json(actor, json)
    }
    pub fn export_jam(&self) -> Result<JamExport> {
        self.read(|c|{
        let j=jam(c)?;
        let keys=c.prepare("SELECT key FROM tasks WHERE jam_id=? ORDER BY created_at,key")?.query_map([&j.id],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let tasks=keys.iter().map(|key|task(c,key)).collect::<Result<Vec<_>>>()?;
        let members=c.prepare("SELECT id,kind,name,handle,color,avatar,client,last_seen_at,created_at FROM members ORDER BY created_at,id")?.query_map([],crate::service::member_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
        let assets=crate::service::all_assets(c,&j.id)?;
        let tags=tasks.iter().flat_map(|t|t.tags.iter().map(|tag|TaskTagRow{task_id:t.id.clone(),tag:tag.clone()})).collect();
        let links=c.prepare("SELECT l.task_id,l.asset_id FROM task_assets l JOIN tasks t ON t.id=l.task_id WHERE t.jam_id=?")?.query_map([&j.id],|r|Ok(TaskAssetRow{task_id:r.get(0)?,asset_id:r.get(1)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let comments=c.prepare("SELECT c.id,c.task_id,c.author_id,c.body_md,c.created_at FROM comments c JOIN tasks t ON t.id=c.task_id WHERE t.jam_id=? ORDER BY c.created_at,c.id")?.query_map([&j.id],|r|Ok(Comment{id:r.get(0)?,task_id:r.get(1)?,author_id:r.get(2)?,body_md:r.get(3)?,created_at:r.get(4)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let seqs=c.prepare("SELECT seq FROM activity WHERE jam_id=? ORDER BY seq")?.query_map([&j.id],|r|r.get::<_,i64>(0))?.collect::<std::result::Result<BTreeSet<_>,_>>()?;
        let activity=crate::db::activity(c,0,None,None)?.into_iter().filter(|e|seqs.contains(&e.seq)).collect();
        Ok(JamExport{version:1,jam:j,members,tasks,tags,assets,links,comments,activity})
    })
    }
    pub fn import_jam_json(&self, actor: &str, json: &str) -> Result<AppState> {
        if json.len() > 32 * 1024 * 1024 {
            return Err(invalid("file", "Import is limited to 32 MiB"));
        }
        let snapshot: JamExport = serde_json::from_str(json)
            .map_err(|e| invalid("file", &format!("Invalid Jam Board JSON: {e}")))?;
        validate_snapshot(&snapshot)?;
        self.write(|c|{
            crate::m5::require_human(c,actor)?;
            let mut ids=BTreeMap::<String,String>::new();let mut keys=BTreeMap::<String,String>::new();
            for m in &snapshot.members {
                let existing=c.query_row("SELECT id,kind FROM members WHERE handle=?",[&m.handle],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
                let mid=if let Some((id,kind))=existing{if kind!=m.kind{return Err(invalid("members","An existing handle has a different member kind"));}id}else{
                    let mid=id();c.execute("INSERT INTO members VALUES (?,?,?,?,?,?,?,?,?)",params![mid,m.kind,m.name,m.handle,m.color,m.avatar,m.client,m.last_seen_at,m.created_at])?;mid
                };ids.insert(m.id.clone(),mid);
            }
            let jid=id();ids.insert(snapshot.jam.id.clone(),jid.clone());
            let mut index=1;let prefix=loop{let p=if index==1{"JB".into()}else{format!("JB{index}")};if !c.query_row("SELECT EXISTS(SELECT 1 FROM jams WHERE key_prefix=?)",[&p],|r|r.get::<_,bool>(0))?{break p;}index+=1;};
            c.execute("INSERT INTO jams(id,name,theme,starts_at,ends_at,timezone,task_seq,key_prefix,created_at) VALUES (?,?,?,?,?,?,?,?,?)",params![jid,snapshot.jam.name,snapshot.jam.theme,snapshot.jam.starts_at,snapshot.jam.ends_at,snapshot.jam.timezone,snapshot.tasks.len() as i64,prefix,now()])?;
            let mut tasks=snapshot.tasks.iter().collect::<Vec<_>>();tasks.sort_by_key(|t|t.key.rsplit('-').next().and_then(|n|n.parse::<u64>().ok()).unwrap_or(0));
            for (i,t) in tasks.iter().enumerate(){ids.insert(t.id.clone(),id());keys.insert(t.key.clone(),format!("{prefix}-{}",i+1));}
            for a in &snapshot.assets{ids.insert(a.id.clone(),id());}
            for comment in &snapshot.comments{ids.insert(comment.id.clone(),id());}
            let mapped=|old:&str|ids.get(old).cloned().ok_or_else(||invalid("file","Unresolved object reference"));
            for t in tasks {
                c.execute(&format!("INSERT INTO tasks({TASK_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),params![mapped(&t.id)?,jid,keys[&t.key],t.title,t.description_md,t.status,t.priority,t.estimate,t.due_at,t.position,t.assignee_id.as_deref().map(mapped).transpose()?,mapped(&t.created_by)?,mapped(&t.updated_by)?,t.created_at,t.updated_at,t.archived_at,Option::<String>::None])?;
            }
            for tag in &snapshot.tags{c.execute("INSERT INTO task_tags VALUES (?,?)",params![mapped(&tag.task_id)?,tag.tag])?;}
            for a in &snapshot.assets{c.execute("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",params![mapped(&a.id)?,jid,a.kind,a.name,a.location,a.notes,mapped(&a.created_by)?,a.created_at])?;}
            for l in &snapshot.links{c.execute("INSERT INTO task_assets VALUES (?,?)",params![mapped(&l.task_id)?,mapped(&l.asset_id)?])?;}
            for x in &snapshot.comments{c.execute("INSERT INTO comments VALUES (?,?,?,?,?)",params![mapped(&x.id)?,mapped(&x.task_id)?,mapped(&x.author_id)?,x.body_md,x.created_at])?;}
            for e in &snapshot.activity {
                let task_id=e.task_key.as_deref().map(|key|snapshot.tasks.iter().find(|t|t.key==key).ok_or_else(||invalid("activity","Unknown task key")).and_then(|t|mapped(&t.id))).transpose()?;
                c.execute("INSERT INTO activity(id,jam_id,actor_id,action,task_id,payload,created_at) VALUES (?,?,?,?,?,?,?)",params![id(),jid,mapped(&e.actor.id)?,e.action,task_id,remap_payload(&e.payload,&ids,&keys).to_string(),e.created_at])?;
            }
            event(c,Some(&jid),actor,"jam.imported",None,serde_json::json!({"name":snapshot.jam.name,"tasks":snapshot.tasks.len()}))?;
            c.execute("INSERT INTO settings VALUES ('current_member_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[actor])?;
            Ok(())
        })?;
        self.app_state()
    }
}
fn remap_payload(
    v: &serde_json::Value,
    ids: &BTreeMap<String, String>,
    keys: &BTreeMap<String, String>,
) -> serde_json::Value {
    match v {
        serde_json::Value::String(s) => {
            serde_json::Value::String(keys.get(s).or_else(|| ids.get(s)).unwrap_or(s).clone())
        }
        serde_json::Value::Array(a) => a.iter().map(|v| remap_payload(v, ids, keys)).collect(),
        serde_json::Value::Object(o) => o
            .iter()
            .map(|(k, v)| (k.clone(), remap_payload(v, ids, keys)))
            .collect(),
        _ => v.clone(),
    }
}
fn validate_snapshot(s: &JamExport) -> Result<()> {
    use crate::m5::{validate_kind, validate_name};
    if s.version != 1 {
        return Err(invalid(
            "version",
            "Only Jam Board JSON version 1 is supported",
        ));
    }
    validate_name("jam.name", &s.jam.name, 60)?;
    if s.tasks.len() > 5000 {
        return Err(invalid("tasks", "Import supports at most 5000 tasks"));
    }
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
    let assets = s
        .assets
        .iter()
        .map(|a| a.id.as_str())
        .collect::<BTreeSet<_>>();
    let unique =
        |values: Vec<&str>| values.len() == values.iter().copied().collect::<BTreeSet<_>>().len();
    if !unique(s.members.iter().map(|m| m.handle.as_str()).collect())
        || members.len() != s.members.len()
        || tasks.len() != s.tasks.len()
        || assets.len() != s.assets.len()
        || !unique(s.tasks.iter().map(|t| t.key.as_str()).collect())
        || !unique(s.comments.iter().map(|t| t.id.as_str()).collect())
    {
        return Err(invalid("file", "Duplicate IDs, handles or task keys"));
    }
    let mut all_ids = BTreeSet::new();
    for id in std::iter::once(s.jam.id.as_str())
        .chain(s.members.iter().map(|m| m.id.as_str()))
        .chain(s.tasks.iter().map(|t| t.id.as_str()))
        .chain(s.assets.iter().map(|a| a.id.as_str()))
        .chain(s.comments.iter().map(|c| c.id.as_str()))
    {
        if ulid::Ulid::from_string(id).is_err() || !all_ids.insert(id) {
            return Err(invalid(
                "file",
                "IDs must be unique ULIDs across all objects",
            ));
        }
    }
    if s.tasks.iter().any(|t| t.jam_id != s.jam.id) || s.assets.iter().any(|a| a.jam_id != s.jam.id)
    {
        return Err(invalid(
            "jamId",
            "Every task and asset must belong to the exported jam",
        ));
    }
    let date = |value: &str| {
        let parsed =
            time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                .map_err(|_| invalid("date", "Use RFC 3339 UTC timestamps"))?;
        if parsed.offset() != time::UtcOffset::UTC {
            return Err(invalid("date", "Use RFC 3339 UTC timestamps"));
        }
        Ok(())
    };
    for value in [
        s.jam.starts_at.as_deref(),
        s.jam.ends_at.as_deref(),
        Some(s.jam.created_at.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        date(value)?;
    }
    for m in &s.members {
        validate_name(
            "member.name",
            &m.name,
            if m.kind == "human" { 40 } else { 140 },
        )?;
        if !matches!(m.kind.as_str(), "human" | "agent")
            || m.handle.is_empty()
            || !MEMBER_COLORS.contains(&m.color.as_str())
        {
            return Err(invalid("members", "Invalid member kind, handle or color"));
        }
        date(&m.created_at)?;
        if let Some(t) = &m.last_seen_at {
            date(t)?;
        }
    }
    for t in &s.tasks {
        validate_name("title", &t.title, 140)?;
        if !STATUSES.contains(&t.status.as_str())
            || !PRIORITIES.contains(&t.priority.as_str())
            || t.estimate.is_some_and(|n| ![1, 2, 3, 5, 8].contains(&n))
            || !t.position.is_finite()
            || !members.contains(t.created_by.as_str())
            || !members.contains(t.updated_by.as_str())
            || t.assignee_id
                .as_ref()
                .is_some_and(|id| !members.contains(id.as_str()))
        {
            return Err(invalid("tasks", "Invalid task fields or member references"));
        }
        date(&t.created_at)?;
        date(&t.updated_at)?;
        for value in [t.due_at.as_deref(), t.archived_at.as_deref()]
            .into_iter()
            .flatten()
        {
            date(value)?;
        }
        let declared = s
            .tags
            .iter()
            .filter(|tag| tag.task_id == t.id)
            .map(|tag| tag.tag.clone())
            .collect::<Vec<_>>();
        if crate::service::normalize_tags(&t.tags)? != crate::service::normalize_tags(&declared)? {
            return Err(invalid("tags", "Task tags do not match the tag rows"));
        }
    }
    let mut tags = BTreeSet::new();
    for tag in &s.tags {
        if !tasks.contains(tag.task_id.as_str())
            || tag.tag.trim().is_empty()
            || tag.tag.trim() != tag.tag
            || tag.tag.to_lowercase() != tag.tag
            || tag.tag.chars().count() > 24
            || !tags.insert((&tag.task_id, &tag.tag))
        {
            return Err(invalid("tags", "Invalid or duplicate task tag"));
        }
    }
    for a in &s.assets {
        validate_kind(&a.kind)?;
        validate_name("asset.name", &a.name, 140)?;
        if a.location.trim().is_empty()
            || !members.contains(a.created_by.as_str())
            || a.notes.as_ref().is_some_and(|n| n.chars().count() > 4000)
        {
            return Err(invalid("assets", "Invalid asset location or creator"));
        }
        date(&a.created_at)?;
    }
    let mut links = BTreeSet::new();
    for l in &s.links {
        if !tasks.contains(l.task_id.as_str())
            || !assets.contains(l.asset_id.as_str())
            || !links.insert((&l.task_id, &l.asset_id))
        {
            return Err(invalid("links", "Invalid or duplicate asset link"));
        }
    }
    for x in &s.comments {
        if !tasks.contains(x.task_id.as_str())
            || !members.contains(x.author_id.as_str())
            || x.body_md.trim().is_empty()
            || x.body_md.chars().count() > 4000
        {
            return Err(invalid("comments", "Invalid comment or reference"));
        }
        date(&x.created_at)?;
    }
    for e in &s.activity {
        if !members.contains(e.actor.id.as_str())
            || e.task_key
                .as_ref()
                .is_some_and(|k| !s.tasks.iter().any(|t| t.key == *k))
        {
            return Err(invalid("activity", "Unknown actor or task"));
        }
        date(&e.created_at)?;
    }
    Ok(())
}
