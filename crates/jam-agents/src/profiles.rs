use crate::*;
use jam_core::Store;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

const SETTINGS_KEY: &str = "agent_profiles";
pub trait CredentialStore: Send + Sync {
    fn get(&self, profile: &str, key: &str) -> Result<Option<String>>;
    fn set(&self, profile: &str, key: &str, value: &str) -> Result<()>;
    fn clear(&self, profile: &str, key: &str) -> Result<()>;
}
pub struct OsCredentials;
impl OsCredentials {
    fn entry(profile: &str, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new("dev.triton556.jamboard", &format!("{profile}:{key}"))
            .map_err(|_| err("OS credential store is unavailable"))
    }
}
impl CredentialStore for OsCredentials {
    fn get(&self, profile: &str, key: &str) -> Result<Option<String>> {
        match Self::entry(profile, key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(err("Cannot read OS credential store")),
        }
    }
    fn set(&self, profile: &str, key: &str, value: &str) -> Result<()> {
        Self::entry(profile, key)?
            .set_password(value)
            .map_err(|_| err("Cannot save credential in OS credential store"))
    }
    fn clear(&self, profile: &str, key: &str) -> Result<()> {
        match Self::entry(profile, key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(err("Cannot clear OS credential")),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Profile {
    pub id: String,
    pub label: String,
    pub kind: RuntimeKind,
    pub preset: Option<String>,
    pub agent_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub effort_style: EffortStyle,
    pub env: Vec<Env>,
    pub hidden: bool,
    pub secret_keys: Vec<SecretKey>,
    #[serde(default)]
    pub extra_mcp_servers: Vec<McpEntry>,
}
impl Profile {
    pub fn launch_command(&self) -> Result<(std::path::PathBuf, Vec<String>)> {
        self.launch_command_with(|command| which::which(command))
    }
    pub(crate) fn launch_command_with(
        &self,
        find: impl Fn(&str) -> std::result::Result<std::path::PathBuf, which::Error>,
    ) -> Result<(std::path::PathBuf, Vec<String>)> {
        let mut tokens = command_tokens(&self.command)?;
        let command = tokens.remove(0);
        let path = match find(&command) {
            Ok(path) => path,
            Err(_) if self.preset.as_deref() == Some("claude-cli") => {
                let path = find("npx").map_err(|_| {
                    err("claude and npx not found — install Claude Code or Node.js 20+")
                })?;
                let mut args = vec!["-y".into(), "@anthropic-ai/claude-code".into()];
                args.extend(self.args.clone());
                return Ok((path, args));
            }
            Err(_) => {
                return Err(err(if command == "npx" {
                    "npx not found — install Node.js 20+".into()
                } else {
                    format!("{command} not found on PATH")
                }));
            }
        };
        tokens.extend(self.args.clone());
        Ok((path, tokens))
    }
}
/// Commands are argv, never shell scripts. Accept an executable/path and optional
/// quoted tokens, preserving Windows backslashes; args remains the preferred UI.
pub(crate) fn command_tokens(command: &str) -> Result<Vec<String>> {
    if std::path::Path::new(command).is_file() {
        return Ok(vec![command.into()]);
    }
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    for c in command.chars() {
        match c {
            '\'' | '"' if quote == Some(c) => quote = None,
            '\'' | '"' if quote.is_none() => quote = Some(c),
            c if c.is_whitespace() && quote.is_none() => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
            }
            c => token.push(c),
        }
    }
    if quote.is_some() {
        return Err(err("Unclosed quote in agent command"));
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    if tokens.is_empty() {
        return Err(err("An executable command is required"));
    }
    Ok(tokens)
}
pub struct Profiles {
    store: Arc<Store>,
    pub(crate) credentials: Arc<dyn CredentialStore>,
    lock: Mutex<()>,
}
impl Profiles {
    pub fn user_config_default(&self) -> Result<UserConfigDefault> {
        Ok(
            match self.store.setting("agent_user_config_default")?.as_deref() {
                Some("include") => UserConfigDefault::Include,
                Some("exclude") => UserConfigDefault::Exclude,
                _ => UserConfigDefault::Ask,
            },
        )
    }
    pub fn save_user_config_default(&self, choice: UserConfigDefault) -> Result<UserConfigDefault> {
        self.store.set_setting(
            "agent_user_config_default",
            match choice {
                UserConfigDefault::Ask => "ask",
                UserConfigDefault::Include => "include",
                UserConfigDefault::Exclude => "exclude",
            },
        )?;
        Ok(choice)
    }
    pub fn launch_options(&self, id: &str) -> Result<AgentLaunchOptions> {
        let profile = self.get(id)?;
        let (exclude_supported, exclude_description) =
            crate::wiring::launch_config::exclude_description(&profile);
        Ok(AgentLaunchOptions {
            user_config_default: self.user_config_default()?,
            exclude_supported,
            exclude_description,
        })
    }
    pub(crate) fn user_config_choice(
        &self,
        choice: Option<UserConfigChoice>,
        kind: RuntimeKind,
    ) -> Result<UserConfigChoice> {
        if kind == RuntimeKind::Api {
            return Ok(choice.unwrap_or(UserConfigChoice::Exclude));
        }
        // The Settings value preselects the launch question; it never replaces
        // the owner's explicit choice for this new or resumed process.
        choice.ok_or_else(|| {
            err("Choose whether to include user configuration before launching this agent")
        })
    }
    pub fn new(store: Arc<Store>, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            store,
            credentials,
            lock: Mutex::new(()),
        }
    }
    fn load(&self) -> Result<BTreeMap<String, Profile>> {
        let mut profiles = presets();
        if let Some(json) = self.store.setting(SETTINGS_KEY)? {
            let mut saved_json: serde_json::Value = serde_json::from_str(&json)?;
            for p in saved_json.as_array_mut().into_iter().flatten() {
                for server in p["extraMcpServers"].as_array_mut().into_iter().flatten() {
                    // Entries saved before switches existed were explicitly configured and enabled.
                    if server.get("enabled").is_none() {
                        server["enabled"] = serde_json::json!(true);
                    }
                }
                if p.get("effortStyle").is_none() {
                    p["effortStyle"] = serde_json::json!(match p["id"].as_str() {
                        Some("api-openrouter") => "openrouter",
                        Some("api-zai") => "zai",
                        _ => "none",
                    });
                }
            }
            let saved: Vec<Profile> = serde_json::from_value(saved_json)?;
            for mut profile in saved {
                // Newly added built-in credential declarations survive older
                // saved profile overrides without losing the person's edits.
                if let Some(default) = profiles.get(&profile.id) {
                    for key in &default.secret_keys {
                        if !profile.secret_keys.iter().any(|k| k.key == key.key) {
                            profile.secret_keys.push(key.clone());
                        }
                    }
                }
                profiles.insert(profile.id.clone(), profile);
            }
        }
        Ok(profiles)
    }
    fn persist(&self, profiles: BTreeMap<String, Profile>) -> Result<()> {
        self.store.set_setting(
            SETTINGS_KEY,
            &serde_json::to_string(&profiles.into_values().collect::<Vec<_>>())?,
        )?;
        Ok(())
    }
    pub(crate) fn get(&self, id: &str) -> Result<Profile> {
        self.load()?
            .remove(id)
            .ok_or_else(|| err("Agent profile not found"))
    }
    fn view(&self, p: Profile) -> Result<AgentProfileView> {
        let reason = if p.kind == RuntimeKind::Api {
            None
        } else {
            match p.launch_command() {
                Ok((_, args))
                    if p.preset.as_deref() == Some("claude-cli")
                        && args
                            .get(1)
                            .is_some_and(|s| s == "@anthropic-ai/claude-code") =>
                {
                    Some("via npx".into())
                }
                Ok(_) => None,
                Err(e) => Some(e.to_string()),
            }
        };
        let secret_keys = p
            .secret_keys
            .iter()
            .map(|s| {
                Ok(SecretView {
                    key: s.key.clone(),
                    label: s.label.clone(),
                    is_set: self.credentials.get(&p.id, &s.key)?.is_some(),
                })
            })
            .collect::<Result<_>>()?;
        let built_in = presets().contains_key(&p.id);
        Ok(AgentProfileView {
            id: p.id,
            label: p.label,
            kind: p.kind,
            preset: p.preset,
            agent_name: p.agent_name,
            command: (!p.command.is_empty()).then_some(p.command),
            args: p.args,
            base_url: p.base_url,
            model: p.model,
            effort: p.effort,
            effort_style: p.effort_style,
            env: p.env,
            hidden: p.hidden,
            secret_keys,
            available: reason.as_deref().is_none_or(|s| s == "via npx"),
            unavailable_reason: reason,
            built_in,
            extra_mcp_servers: p
                .extra_mcp_servers
                .into_iter()
                .map(|mut entry| {
                    entry.trust_read_only = Some(entry.trusts_read_only());
                    entry
                })
                .collect(),
        })
    }
    pub fn list(&self) -> Result<Vec<AgentProfileView>> {
        self.load()?.into_values().map(|p| self.view(p)).collect()
    }
    pub fn save(&self, input: AgentProfileInput) -> Result<AgentProfileView> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("Profile lock unavailable"))?;
        if input.label.trim().is_empty() {
            return Err(err("Profile label is required"));
        }
        let mut all = self.load()?;
        let id = input
            .id
            .unwrap_or_else(|| ulid::Ulid::generate().to_string());
        let existing = all.get(&id).cloned();
        let builtin = presets().remove(&id);
        let mut p = existing.unwrap_or_else(|| Profile {
            id: id.clone(),
            label: input.label.clone(),
            kind: input.kind,
            preset: None,
            agent_name: format!("{} · dock", input.label.trim()),
            command: String::new(),
            args: Vec::new(),
            base_url: None,
            model: None,
            effort: None,
            effort_style: EffortStyle::None,
            env: Vec::new(),
            hidden: false,
            secret_keys: Vec::new(),
            extra_mcp_servers: Vec::new(),
        });
        p.label = input.label.trim().into();
        if let Some(v) = input.agent_name {
            p.agent_name = v.trim().into();
        }
        if p.agent_name.is_empty() {
            p.agent_name = format!("{} · dock", p.label);
        }
        if builtin.is_none() {
            p.kind = input.kind;
            if let Some(v) = input.command {
                p.command = v.trim().into();
            }
            if let Some(v) = input.args {
                p.args = v;
            }
            if let Some(v) = input.secret_keys {
                p.secret_keys = v;
            }
        }
        if let Some(v) = input.base_url {
            p.base_url = v.filter(|v| !v.trim().is_empty());
        }
        if let Some(v) = input.model {
            p.model = v.filter(|v| !v.trim().is_empty());
        }
        if let Some(v) = input.effort {
            p.effort = v.filter(|v| !v.trim().is_empty());
        }
        if let Some(v) = input.effort_style {
            p.effort_style = v;
        }
        if let Some(v) = input.env {
            p.env = v;
        }
        if let Some(v) = input.hidden {
            p.hidden = v;
        }
        if let Some(v) = input.extra_mcp_servers {
            p.extra_mcp_servers = v;
        }
        if p.kind != RuntimeKind::Api && p.command.is_empty() {
            return Err(err(
                "An executable command is required; pass arguments separately",
            ));
        }
        for mcp in &p.extra_mcp_servers {
            if let Some(key) = mcp.http.as_ref().and_then(|h| h.bearer_secret_key.as_ref())
                && !p.secret_keys.iter().any(|k| &k.key == key)
            {
                p.secret_keys.push(SecretKey {
                    key: key.clone(),
                    label: format!("{} bearer token", mcp.name),
                });
            }
        }
        for key in &p.secret_keys {
            validate_key(&key.key)?;
        }
        for env in &p.env {
            validate_key(&env.name)?;
            if is_secret_name(&env.name)
                || p.secret_keys
                    .iter()
                    .any(|k| k.key.eq_ignore_ascii_case(&env.name))
            {
                return Err(err(
                    "Secret values must be saved in the OS credential store",
                ));
            }
            if env.name.to_ascii_uppercase().starts_with("JAM_BOARD_")
                || env.name.eq_ignore_ascii_case("JAM_AGENT_NAME")
            {
                return Err(err("Board environment is managed by the dock"));
            }
        }
        for mcp in &p.extra_mcp_servers {
            if mcp.name == "jam-board" {
                return Err(err("The jam-board MCP entry cannot be overridden"));
            }
            if mcp.name.is_empty()
                || !mcp
                    .name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                || mcp.name.contains("__")
            {
                return Err(err("Invalid MCP server name"));
            }
            if let Some(http) = &mcp.http {
                crate::wiring::validate_mcp_url(&http.url)?;
                if let Some(key) = &http.bearer_secret_key {
                    validate_key(key)?;
                }
            } else if mcp.enabled && matches!(mcp.preset, McpPreset::Custom | McpPreset::Desktop) {
                command_tokens(&mcp.command)?;
            }
            for env in &mcp.env {
                validate_key(&env.name)?;
                if is_secret_name(&env.name)
                    || p.secret_keys
                        .iter()
                        .any(|k| k.key.eq_ignore_ascii_case(&env.name))
                {
                    return Err(err(
                        "Extra MCP server settings must not contain credentials",
                    ));
                }
            }
        }
        let mut names = std::collections::BTreeSet::new();
        if p.extra_mcp_servers.iter().any(|e| !names.insert(&e.name)) {
            return Err(err("MCP server names must be unique"));
        }
        if p.kind != RuntimeKind::Api {
            command_tokens(&p.command)?;
        }
        let view = self.view(p.clone())?;
        all.insert(id, p);
        self.persist(all)?;
        Ok(view)
    }
    pub fn delete(&self, id: &str) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("Profile lock unavailable"))?;
        if presets().contains_key(id) {
            return Err(err(
                "Built-in profiles cannot be deleted; hide the profile instead",
            ));
        }
        let mut all = self.load()?;
        let p = all
            .remove(id)
            .ok_or_else(|| err("Agent profile not found"))?;
        for key in p.secret_keys {
            self.credentials.clear(id, &key.key)?;
        }
        self.persist(all)
    }
    fn require_key(&self, id: &str, key: &str) -> Result<()> {
        validate_key(key)?;
        if !self.get(id)?.secret_keys.iter().any(|k| k.key == key) {
            return Err(err("Secret key is not declared by this profile"));
        }
        Ok(())
    }
    pub fn set_secret(&self, id: &str, key: &str, value: &str) -> Result<()> {
        self.require_key(id, key)?;
        self.credentials.set(id, key, value)
    }
    pub fn clear_secret(&self, id: &str, key: &str) -> Result<()> {
        self.require_key(id, key)?;
        self.credentials.clear(id, key)
    }
    pub(crate) fn child_env(&self, p: &Profile) -> Result<Vec<Env>> {
        let mut env = p.env.clone();
        if p.preset.as_deref().is_some_and(|v| v.starts_with("claude")) {
            if let Some(v) = &p.base_url {
                env.push(Env {
                    name: "ANTHROPIC_BASE_URL".into(),
                    value: v.clone(),
                });
            }
            if let Some(v) = &p.model {
                env.push(Env {
                    name: "ANTHROPIC_MODEL".into(),
                    value: v.clone(),
                });
            }
            if p.preset.as_deref() == Some("claude-openrouter") {
                env.push(Env {
                    name: "ANTHROPIC_API_KEY".into(),
                    value: String::new(),
                });
            }
        }
        for key in &p.secret_keys {
            if p.kind == RuntimeKind::Api {
                continue;
            }
            if let Some(value) = self.credentials.get(&p.id, &key.key)? {
                env.push(Env {
                    name: key.key.clone(),
                    value,
                });
            }
        }
        Ok(env)
    }
    pub(crate) fn api_key(&self, profile: &str) -> Result<Option<String>> {
        self.credentials.get(profile, "API_KEY")
    }
}
pub(crate) fn is_secret_name(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    ["TOKEN", "PASSWORD", "SECRET", "API_KEY", "PRIVATE_KEY"]
        .iter()
        .any(|s| name.contains(s))
}
fn validate_key(key: &str) -> Result<()> {
    if key.is_empty()
        || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        || key.as_bytes()[0].is_ascii_digit()
    {
        return Err(err(
            "Environment keys must use letters, digits and underscores",
        ));
    }
    Ok(())
}
fn presets() -> BTreeMap<String, Profile> {
    [
        (
            "claude-code",
            "Claude Code",
            RuntimeKind::Acp,
            "npx",
            vec!["-y", "@agentclientprotocol/claude-agent-acp"],
            None,
        ),
        (
            "codex",
            "Codex",
            RuntimeKind::Acp,
            "npx",
            vec!["-y", "@agentclientprotocol/codex-acp"],
            None,
        ),
        (
            "opencode",
            "OpenCode",
            RuntimeKind::Acp,
            "opencode",
            vec!["acp"],
            None,
        ),
        (
            "claude-zai",
            "Claude Code · z.ai",
            RuntimeKind::Acp,
            "npx",
            vec!["-y", "@agentclientprotocol/claude-agent-acp"],
            Some("https://api.z.ai/api/anthropic"),
        ),
        (
            "claude-openrouter",
            "Claude Code · OpenRouter",
            RuntimeKind::Acp,
            "npx",
            vec!["-y", "@agentclientprotocol/claude-agent-acp"],
            Some("https://openrouter.ai/api"),
        ),
        (
            "claude-cli",
            "Claude CLI",
            RuntimeKind::Terminal,
            "claude",
            vec![],
            None,
        ),
        (
            "codex-cli",
            "Codex CLI",
            RuntimeKind::Terminal,
            "codex",
            vec![],
            None,
        ),
        (
            "api-openrouter",
            "OpenRouter API",
            RuntimeKind::Api,
            "",
            vec![],
            Some("https://openrouter.ai/api/v1"),
        ),
        (
            "api-zai",
            "z.ai API",
            RuntimeKind::Api,
            "",
            vec![],
            Some("https://api.z.ai/api/paas/v4"),
        ),
        (
            "api-custom",
            "Custom API",
            RuntimeKind::Api,
            "",
            vec![],
            None,
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, command, args, url)| {
        (
            id.into(),
            Profile {
                id: id.into(),
                label: label.into(),
                kind,
                preset: Some(id.into()),
                agent_name: format!("{label} · dock"),
                command: command.into(),
                args: args.into_iter().map(str::to_owned).collect(),
                base_url: url.map(str::to_owned),
                model: None,
                effort: None,
                effort_style: match id {
                    "api-openrouter" => EffortStyle::Openrouter,
                    "api-zai" => EffortStyle::Zai,
                    _ => EffortStyle::None,
                },
                env: vec![],
                hidden: false,
                secret_keys: if kind == RuntimeKind::Api {
                    vec![SecretKey {
                        key: "API_KEY".into(),
                        label: "API key".into(),
                    }]
                } else if id == "claude-code" {
                    vec![SecretKey {
                        key: "ANTHROPIC_API_KEY".into(),
                        label: "API key (optional)".into(),
                    }]
                } else if url.is_some() {
                    vec![SecretKey {
                        key: "ANTHROPIC_AUTH_TOKEN".into(),
                        label: "Authentication token".into(),
                    }]
                } else {
                    vec![]
                },
                extra_mcp_servers: vec![],
            },
        )
    })
    .collect()
}

/// Resolve an MCP command independently of profile credentials or runtime presets.
pub(crate) fn mcp_launch_command(
    command: &str,
    args: &[String],
) -> Result<(std::path::PathBuf, Vec<String>)> {
    let mut tokens = command_tokens(command)?;
    let path =
        which::which(tokens.remove(0)).map_err(|_| err("MCP executable not found on PATH"))?;
    tokens.extend_from_slice(args);
    Ok((path, tokens))
}
