use crate::{Error, Member, Result, Store, invalid, service};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rusqlite::params;
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentAvatarInput {
    /// A PNG data URL, or explicit null to restore the provider default.
    pub avatar: AgentAvatar,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum AgentAvatar {
    Png(String),
    Default(()),
}

fn validate(value: &str) -> Result<()> {
    const MAX_BYTES: usize = 32 * 1024;
    const MAX_DIMENSION: u32 = 128;
    let invalid_avatar = || {
        invalid(
            "avatar",
            "Use a valid PNG data URL, at most 32 KiB and 128×128",
        )
    };
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(invalid_avatar)?;
    if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err(invalid_avatar());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid_avatar())?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid_avatar());
    }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: 256 * 1024 });
    let mut reader = decoder.read_info().map_err(|_| invalid_avatar())?;
    let info = reader.info();
    if info.width > MAX_DIMENSION || info.height > MAX_DIMENSION || info.animation_control.is_some()
    {
        return Err(invalid_avatar());
    }
    let size = reader.output_buffer_size().ok_or_else(invalid_avatar)?;
    reader
        .next_frame(&mut vec![0; size])
        .map_err(|_| invalid_avatar())?;
    reader.finish().map_err(|_| invalid_avatar())?;
    Ok(())
}

impl Store {
    pub fn set_agent_avatar(&self, actor: &str, input: AgentAvatarInput) -> Result<Member> {
        let avatar = match &input.avatar {
            AgentAvatar::Default(()) => None,
            AgentAvatar::Png(value) => {
                validate(value)?;
                Some(value.as_str())
            }
        };
        self.write(|c| {
            crate::projects::ensure_member_scope(c, actor)?;
            let old = service::member(c, actor)?;
            if old.kind != "agent" {
                return Err(Error::Forbidden(
                    "Only agents can set an agent avatar".into(),
                ));
            }
            if old.avatar.as_deref() == avatar {
                return Ok(old);
            }
            c.execute(
                "UPDATE members SET avatar=? WHERE id=?",
                params![avatar, actor],
            )?;
            service::event(
                c,
                Some(&service::jam(c)?.id),
                actor,
                "member.updated",
                None,
                serde_json::json!({"memberId": actor}),
            )?;
            service::member(c, actor)
        })
    }
}
