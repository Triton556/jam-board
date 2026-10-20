use crate::service::{event, jam, member, task};
use crate::*;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkedTask {
    pub key: String,
    pub title: String,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssetWithTasks {
    #[serde(flatten)]
    pub asset: Asset,
    pub tasks: Vec<LinkedTask>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MemberWithStats {
    #[serde(flatten)]
    pub member: Member,
    pub counts: BTreeMap<String, i64>,
    pub online: bool,
    pub working_on: Vec<LinkedTask>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetQuery {
    pub kind: Option<String>,
    pub text: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewAsset {
    pub kind: String,
    pub name: String,
    pub location: String,
    pub notes: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetEdit {
    pub id: String,
    pub name: Option<String>,
    pub notes: Option<String>,
    pub kind: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetLink {
    pub asset_id: String,
    pub task_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewMember {
    pub name: String,
    pub color: String,
    pub avatar: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberEdit {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
    pub avatar: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityQuery {
    pub before_seq: Option<i64>,
    pub limit: Option<i64>,
    pub actor_kind: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub color_by: String,
    pub estimates_enabled: bool,
    pub wip_limit: u32,
    pub assets_view: String,
    pub collapsed_asset_kinds: Vec<String>,
    pub theme: String,
    pub sound_enabled: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub color_by: Option<String>,
    pub estimates_enabled: Option<bool>,
    pub wip_limit: Option<u32>,
    pub assets_view: Option<String>,
    pub collapsed_asset_kinds: Option<Vec<String>>,
    pub theme: Option<String>,
    pub sound_enabled: Option<bool>,
}

impl Store {
    /// Registers a file and links it atomically; failure leaves neither asset nor link.
    pub fn attach_file(&self, actor: &str, key: &str, location: &str) -> Result<Asset> {
        let path = std::path::Path::new(location);
        if !path.is_absolute() || !path.is_file() {
            return Err(invalid("location", "Choose an existing local file"));
        }
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Asset");
        validate_name("name", name, 140)?;
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = match extension.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "aseprite" => "sprite",
            "wav" | "ogg" | "mp3" => "audio",
            "ttf" | "otf" | "woff2" => "font",
            "tmx" | "ldtk" | "json" => "level",
            _ => "other",
        };
        self.write(|c| {
            require_human(c, actor)?;
            let t = task(c, key)?;
            if t.archived_at.is_some() {
                return Err(Error::Archived(t.key));
            }
            if t.jam_id != jam(c)?.id {
                return Err(invalid("key", "Choose a task in the active jam"));
            }
            let a = Asset {
                id: id(),
                jam_id: t.jam_id.clone(),
                kind: kind.into(),
                name: name.into(),
                location: location.into(),
                notes: None,
                created_by: actor.into(),
                created_at: now(),
            };
            c.execute(
                "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
                params![
                    a.id,
                    a.jam_id,
                    a.kind,
                    a.name,
                    a.location,
                    a.notes,
                    a.created_by,
                    a.created_at
                ],
            )?;
            c.execute("INSERT INTO task_assets VALUES (?,?)", params![t.id, a.id])?;
            crate::service::touch(c, &t.id, actor)?;
            event(
                c,
                Some(&t.jam_id),
                actor,
                "asset.linked",
                Some(&t.id),
                serde_json::json!({"assetId":a.id,"name":a.name,"created":true}),
            )?;
            Ok(a)
        })
    }

    pub fn assets_with_tasks(&self, query: AssetQuery) -> Result<Vec<AssetWithTasks>> {
        let assets = self.list_assets(query.kind.as_deref(), query.text.as_deref())?;
        self.read(|c| assets.into_iter().map(|asset| {
            let tasks=c.prepare("SELECT t.key,t.title,t.status FROM tasks t JOIN task_assets l ON l.task_id=t.id WHERE l.asset_id=? ORDER BY t.position,t.key")?.query_map([&asset.id],|r|Ok(LinkedTask{key:r.get(0)?,title:r.get(1)?,status:r.get(2)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
            Ok(AssetWithTasks{asset,tasks})
        }).collect())
    }
    pub fn update_asset_fields(&self, actor: &str, input: AssetEdit) -> Result<()> {
        if let Some(name) = &input.name {
            validate_name("name", name, 140)?;
        }
        if let Some(kind) = &input.kind {
            validate_kind(kind)?;
        }
        if input
            .notes
            .as_ref()
            .is_some_and(|n| n.chars().count() > 4000)
        {
            return Err(invalid("notes", "Use at most 4000 characters"));
        }
        self.write(|c| {
            require_human(c, actor)?;
            let jid = jam(c)?.id;
            let old: Option<(String, String, Option<String>)> = c
                .query_row(
                    "SELECT name,kind,notes FROM assets WHERE id=? AND jam_id=?",
                    params![input.id, jid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let old = old.ok_or_else(|| Error::NotFound(input.id.clone()))?;
            c.execute(
                "UPDATE assets SET name=?,kind=?,notes=? WHERE id=?",
                params![
                    input.name.as_deref().unwrap_or(&old.0),
                    input.kind.as_deref().unwrap_or(&old.1),
                    input.notes.as_ref().or(old.2.as_ref()),
                    input.id
                ],
            )?;
            event(
                c,
                Some(&jid),
                actor,
                "asset.updated",
                None,
                serde_json::json!({"assetId":input.id,"name":input.name.unwrap_or(old.0)}),
            )
        })
    }
    pub fn unlink_asset(&self, actor: &str, input: AssetLink) -> Result<()> {
        self.write(|c| {
            require_human(c, actor)?;
            let t = task(c, &input.task_key)?;
            if t.archived_at.is_some() {
                return Err(Error::Archived(t.key));
            }
            if t.jam_id != jam(c)?.id {
                return Err(invalid("taskKey", "Choose a task in the active jam"));
            }
            if c.execute(
                "DELETE FROM task_assets WHERE task_id=? AND asset_id=?",
                params![t.id, input.asset_id],
            )? == 0
            {
                return Err(Error::NotFound("asset link".into()));
            }
            crate::service::touch(c, &t.id, actor)?;
            event(
                c,
                Some(&t.jam_id),
                actor,
                "asset.unlinked",
                Some(&t.id),
                serde_json::json!({"assetId":input.asset_id}),
            )
        })
    }
    /// Only an existing registered local image can be added to the desktop asset scope.
    pub fn asset_preview_path(&self, id: &str) -> Result<Option<std::path::PathBuf>> {
        let location = self.read(|c| {
            c.query_row("SELECT location FROM assets WHERE id=?", [id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .ok_or_else(|| Error::NotFound("asset".into()))
        })?;
        if location.starts_with("http://") || location.starts_with("https://") {
            return Ok(None);
        }
        let path = std::path::Path::new(&location);
        if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
            ["png", "jpg", "jpeg", "webp", "gif"].contains(&e.to_ascii_lowercase().as_str())
        }) {
            return Ok(None);
        }
        match path.canonicalize() {
            Ok(p) if p.is_file() => Ok(Some(p)),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    pub fn members_with_stats(&self) -> Result<Vec<MemberWithStats>> {
        let members = self.list_members()?;
        self.read(|c| {
            members
                .into_iter()
                .map(|m| {
                    let working_on = m
                        .working_on
                        .iter()
                        .map(|key| {
                            let t = task(c, key)?;
                            Ok(LinkedTask {
                                key: t.key,
                                title: t.title,
                                status: t.status,
                            })
                        })
                        .collect::<Result<Vec<_>>>()?;
                    let counts = STATUSES
                        .into_iter()
                        .map(|s| (s.into(), m.counts.get(s).copied().unwrap_or(0)))
                        .collect();
                    Ok(MemberWithStats {
                        member: m.member,
                        counts,
                        online: m.online,
                        working_on,
                    })
                })
                .collect()
        })
    }
    pub fn edit_member(&self, actor: &str, input: MemberEdit) -> Result<Member> {
        if let Some(name) = &input.name {
            validate_name("name", name, 40)?;
        }
        if let Some(color) = &input.color
            && !MEMBER_COLORS.contains(&color.as_str())
        {
            return Err(invalid("color", "Choose a member palette color"));
        }
        self.write(|c| {
            require_human(c, actor)?;
            let old = member(c, &input.id)?;
            if old.kind == "agent" && input.avatar.is_some() {
                return Err(invalid(
                    "avatar",
                    "Only name and color can be edited for agents",
                ));
            }
            if input
                .avatar
                .as_ref()
                .is_some_and(|a| a.chars().count() > 16)
            {
                return Err(invalid("avatar", "Use an emoji of at most 16 characters"));
            }
            c.execute(
                "UPDATE members SET name=?,color=?,avatar=? WHERE id=?",
                params![
                    input.name.as_deref().unwrap_or(&old.name),
                    input.color.as_deref().unwrap_or(&old.color),
                    input.avatar.as_ref().or(old.avatar.as_ref()),
                    input.id
                ],
            )?;
            event(
                c,
                Some(&jam(c)?.id),
                actor,
                "member.updated",
                None,
                serde_json::json!({"memberId":input.id}),
            )?;
            member(c, &input.id)
        })
    }
    pub fn activity_page(&self, input: ActivityQuery) -> Result<Vec<ActivityEvent>> {
        let limit = input.limit.unwrap_or(100);
        if !(1..=1000).contains(&limit) {
            return Err(invalid("limit", "Use 1-1000"));
        }
        if input.before_seq.is_some_and(|n| n < 1) {
            return Err(invalid("beforeSeq", "Use a positive sequence"));
        }
        if input
            .actor_kind
            .as_deref()
            .is_some_and(|k| !matches!(k, "human" | "agent"))
        {
            return Err(invalid("actorKind", "Choose human or agent"));
        }
        self.read(|c|{
            let jid=jam(c)?.id;
            let mut stmt=c.prepare("SELECT a.seq,a.action,m.id,m.kind,m.name,m.handle,m.color,t.key,a.payload,a.created_at FROM activity a JOIN members m ON m.id=a.actor_id LEFT JOIN tasks t ON t.id=a.task_id WHERE a.jam_id=?1 AND (?2 IS NULL OR a.seq<?2) AND (?3 IS NULL OR m.kind=?3) ORDER BY a.seq DESC LIMIT ?4")?;
            Ok(stmt.query_map(params![jid,input.before_seq,input.actor_kind,limit],crate::db::activity_row)?.collect::<std::result::Result<Vec<_>,_>>()?)
        })
    }
    pub fn get_settings(&self) -> Result<Settings> {
        let prefix = self
            .app_state()?
            .jam
            .map(|j| format!("board.{}.", j.id))
            .unwrap_or_default();
        Ok(Settings {
            color_by: self
                .setting(&format!("{prefix}color_by"))?
                .unwrap_or_else(|| "none".into()),
            estimates_enabled: self
                .setting(&format!("{prefix}estimates_enabled"))?
                .as_deref()
                == Some("true"),
            wip_limit: self
                .setting(&format!("{prefix}wip_limit"))?
                .and_then(|s| s.parse().ok())
                .unwrap_or(6),
            assets_view: self
                .setting("assets_view")?
                .unwrap_or_else(|| "grid".into()),
            collapsed_asset_kinds: self
                .setting("collapsed_asset_kinds")?
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
            theme: self.setting("theme")?.unwrap_or_else(|| "system".into()),
            sound_enabled: self.setting("sound_enabled")?.as_deref() == Some("true"),
        })
    }
    pub fn set_settings(&self, input: SettingsPatch) -> Result<Settings> {
        if input
            .theme
            .as_deref()
            .is_some_and(|t| !matches!(t, "system" | "light" | "dark"))
        {
            return Err(invalid("theme", "Choose system, light or dark"));
        }
        if input
            .color_by
            .as_deref()
            .is_some_and(|v| !matches!(v, "none" | "assignee"))
        {
            return Err(invalid("colorBy", "Choose none or assignee"));
        }
        if input.wip_limit.is_some_and(|v| !(1..=999).contains(&v)) {
            return Err(invalid("wipLimit", "Use 1-999"));
        }
        if input
            .assets_view
            .as_deref()
            .is_some_and(|v| !matches!(v, "grid" | "list"))
        {
            return Err(invalid("assetsView", "Choose grid or list"));
        }
        if let Some(kinds) = &input.collapsed_asset_kinds {
            for k in kinds {
                validate_kind(k)?;
            }
        }
        let prefix = self
            .app_state()?
            .jam
            .map(|j| format!("board.{}.", j.id))
            .unwrap_or_default();
        self.write(|c| {
            for (key,value) in [(format!("{prefix}color_by"),input.color_by),(format!("{prefix}estimates_enabled"),input.estimates_enabled.map(|v|v.to_string())),(format!("{prefix}wip_limit"),input.wip_limit.map(|v|v.to_string())),("theme".into(),input.theme),("sound_enabled".into(),input.sound_enabled.map(|v|v.to_string())),("assets_view".into(),input.assets_view),("collapsed_asset_kinds".into(), input.collapsed_asset_kinds.map(|v|serde_json::to_string(&v)).transpose()?)] {
                if let Some(v)=value { c.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,v])?; }
            }
            Ok(())
        })?;
        self.get_settings()
    }
    pub fn reset_jam(&self, actor: &str, confirm_name: &str) -> Result<AppState> {
        self.write(|c|{require_human(c,actor)?;let j=jam(c)?;if confirm_name!=j.name{return Err(invalid("confirmName","Type the exact jam name"));}
            let changed=c.execute("UPDATE tasks SET archived_at=?,updated_at=?,updated_by=? WHERE jam_id=? AND archived_at IS NULL",params![now(),now(),actor,j.id])?;
            c.execute("UPDATE jams SET archived=1 WHERE id=?",[&j.id])?;
            event(c,Some(&j.id),actor,"jam.archived",None,serde_json::json!({"name":j.name,"tasks":changed}))
        })?;
        self.app_state()
    }
}
pub(crate) fn require_human(c: &rusqlite::Connection, actor: &str) -> Result<()> {
    if member(c, actor)?.kind != "human" {
        return Err(invalid("actor", "A human is required"));
    }
    Ok(())
}
pub(crate) fn validate_name(field: &str, value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max {
        Err(invalid(field, &format!("Use 1-{max} characters")))
    } else {
        Ok(())
    }
}
pub(crate) fn validate_kind(kind: &str) -> Result<()> {
    if !["sprite", "audio", "level", "font", "other"].contains(&kind) {
        Err(invalid(
            "kind",
            "Choose sprite, audio, level, font or other",
        ))
    } else {
        Ok(())
    }
}
