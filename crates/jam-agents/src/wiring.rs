use crate::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardContext {
    pub project_id: String,
    pub project_name: String,
    pub key_prefix: String,
    pub project_folder: Option<String>,
    pub data_dir: PathBuf,
    pub sidecar_path: PathBuf,
}
impl BoardContext {
    pub fn from_store(
        store: &jam_core::Store,
        data_dir: PathBuf,
        sidecar_path: PathBuf,
    ) -> Result<Self> {
        let pinned = store.selected_snapshot()?;
        let project = pinned.active_jam()?;
        let project_folder = pinned.get_settings()?.project_folder;
        Ok(Self {
            project_id: project.id,
            project_name: project.name,
            key_prefix: project.key_prefix,
            project_folder,
            data_dir: std::path::absolute(data_dir)?,
            sidecar_path: std::path::absolute(sidecar_path)?,
        })
    }
    pub fn preamble(&self) -> String {
        format!(
            "Board session context\nProject: {}\nKey prefix: {}\nProject ID: {}\nUse the jam-board MCP server for this board; read jam://guide first. A chat message is not Start approval.",
            self.project_name, self.key_prefix, self.project_id
        )
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpEntry {
    #[serde(default = "enabled_default")]
    pub enabled: bool,
    #[serde(default)]
    pub preset: McpPreset,
    #[serde(default)]
    pub trust_read_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http: Option<McpHttp>,
    /// Runtime-only authorization. Never serialized into profiles or history.
    #[serde(skip)]
    #[specta(skip)]
    pub bearer_token: Option<String>,
    pub name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<Env>,
}
fn enabled_default() -> bool {
    false
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum McpPreset {
    Web,
    Browser,
    Desktop,
    #[default]
    Custom,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpHttp {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bearer_secret_key: Option<String>,
}
impl Default for McpEntry {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: McpPreset::Custom,
            trust_read_only: None,
            http: None,
            bearer_token: None,
            name: String::new(),
            command: String::new(),
            args: vec![],
            env: vec![],
        }
    }
}
impl McpEntry {
    pub fn trusts_read_only(&self) -> bool {
        self.trust_read_only
            .unwrap_or(self.preset == McpPreset::Web)
    }
}
pub fn mcp_entries(
    board: &BoardContext,
    agent_name: &str,
    extra: &[McpEntry],
) -> Result<Vec<McpEntry>> {
    if !board.sidecar_path.is_absolute() {
        return Err(err("The MCP sidecar path must be absolute"));
    }
    if extra.iter().any(|e| e.name == "jam-board") {
        return Err(err("The jam-board MCP entry cannot be overridden"));
    }
    let mut entries = vec![McpEntry {
        enabled: true,
        preset: McpPreset::Custom,
        trust_read_only: Some(true),
        http: None,
        bearer_token: None,
        name: "jam-board".into(),
        command: board.sidecar_path.to_string_lossy().into_owned(),
        args: vec![],
        env: vec![
            Env {
                name: "JAM_BOARD_PROJECT".into(),
                value: board.project_id.clone(),
            },
            Env {
                name: "JAM_BOARD_DATA_DIR".into(),
                value: board.data_dir.to_string_lossy().into_owned(),
            },
            Env {
                name: "JAM_AGENT_NAME".into(),
                value: agent_name.into(),
            },
        ],
    }];
    let mut names = std::collections::BTreeSet::from(["jam-board".to_string()]);
    for entry in extra.iter().filter(|e| e.enabled) {
        if entry.name.is_empty()
            || !entry
                .name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            || entry.name.contains("__")
            || !names.insert(entry.name.clone())
        {
            return Err(err(
                "MCP server names must be unique letters, digits, hyphens or single underscores",
            ));
        }
        let mut entry = entry.clone();
        match entry.preset {
            McpPreset::Web => {
                entry.http = None;
                entry.command = web_sidecar_path(&board.sidecar_path)?
                    .to_string_lossy()
                    .into_owned();
                entry.args.clear();
                entry.env = web_sidecar_env(&board.data_dir, &board.project_id)?;
            }
            McpPreset::Browser => {
                entry.http = None;
                entry.command = "npx".into();
                entry.args = vec!["-y".into(), "@playwright/mcp@latest".into()];
            }
            _ => {}
        }
        if let Some(http) = &entry.http {
            validate_mcp_url(&http.url)?;
        } else if entry.command.trim().is_empty() {
            return Err(err("An MCP executable command is required"));
        }
        if entry.http.is_none() {
            let mut tokens = crate::profiles::command_tokens(&entry.command)?;
            entry.command = tokens.remove(0);
            tokens.extend(entry.args);
            entry.args = tokens;
            if entry.preset == McpPreset::Browser
                && let Ok(path) = which::which(&entry.command)
            {
                entry.command = path.to_string_lossy().into_owned();
            }
        }
        entries.push(entry);
    }
    Ok(entries)
}
pub(crate) fn validate_mcp_url(value: &str) -> Result<()> {
    let url = reqwest::Url::parse(value).map_err(|_| err("Enter a valid MCP HTTP URL"))?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(err(
            "MCP URL must use HTTP(S) without embedded credentials, query or fragment",
        ));
    }
    Ok(())
}
fn web_sidecar_path(board: &Path) -> Result<PathBuf> {
    let parent = board
        .parent()
        .ok_or_else(|| err("Cannot resolve bundled web MCP sidecar"))?;
    let name = board
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| err("Invalid sidecar filename"))?;
    Ok(parent.join(name.replacen("jam-board-mcp", "jam-web-mcp", 1)))
}
fn web_sidecar_env(data_dir: &Path, project_id: &str) -> Result<Vec<Env>> {
    jam_web_mcp::config::sidecar_env(data_dir, project_id)
        .map(|env| {
            env.into_iter()
                .map(|(name, value)| Env { name, value })
                .collect()
        })
        .map_err(|e| err(e.to_string()))
}
pub fn choose_cwd(board: &BoardContext, explicit: Option<&str>) -> Result<PathBuf> {
    if let Some(explicit) = explicit {
        let cwd = Path::new(explicit);
        if !cwd.is_dir() {
            return Err(err("The working directory must be an existing directory"));
        }
        return Ok(std::path::absolute(cwd)?);
    }
    if let Some(folder) = &board.project_folder
        && Path::new(folder).is_dir()
    {
        return Ok(std::path::absolute(folder)?);
    }
    // Project IDs come from the store, but also validate this public boundary.
    if board.project_id.is_empty()
        || board.project_id.contains(['/', '\\', ':'])
        || [".", ".."].contains(&board.project_id.as_str())
    {
        return Err(err("Invalid project ID for agent workspace"));
    }
    let cwd = board
        .data_dir
        .join("agent-workspace")
        .join(&board.project_id);
    std::fs::create_dir_all(&cwd)?;
    Ok(std::path::absolute(cwd)?)
}
/// Build CLI argv directly, without shell interpolation or credential values.
pub fn terminal_command(
    preset: Option<&str>,
    command: &str,
    args: &[String],
    entries: &[McpEntry],
) -> Result<(String, Vec<String>)> {
    let mut args = args.to_vec();
    let executable_name = std::path::Path::new(command)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(command);
    if preset == Some("claude-cli")
        || (preset.is_none() && executable_name.eq_ignore_ascii_case("claude"))
    {
        let servers: serde_json::Map<String, serde_json::Value> = entries.iter().map(|e| {
            let spec = if let Some(http) = &e.http {
                let headers: std::collections::BTreeMap<_, _> = e.bearer_token.as_ref().map(|v| ("Authorization", format!("Bearer {v}"))).into_iter().collect();
                serde_json::json!({"type":"http","url":http.url,"headers":headers})
            } else { serde_json::json!({"command":e.command,"args":e.args,"env":e.env.iter().map(|v|(v.name.clone(),v.value.clone())).collect::<std::collections::BTreeMap<_,_>>()}) };
            (e.name.clone(), spec)
        }).collect();
        args.extend([
            "--mcp-config".into(),
            serde_json::json!({"mcpServers":servers}).to_string(),
        ]);
    } else if preset == Some("codex-cli")
        || (preset.is_none() && executable_name.eq_ignore_ascii_case("codex"))
    {
        // codex --help: dotted keys; values parsed as TOML. JSON string escaping
        // is compatible with TOML basic strings for paths and these env values.
        for entry in entries {
            let key = format!("mcp_servers.{}", toml_string(&entry.name)?);
            if let Some(http) = &entry.http {
                args.extend([
                    "-c".into(),
                    format!("{key}.url={}", toml_string(&http.url)?),
                ]);
                if let Some(token) = &entry.bearer_token {
                    args.extend([
                        "-c".into(),
                        format!(
                            "{key}.http_headers.Authorization={}",
                            toml_string(&format!("Bearer {token}"))?
                        ),
                    ]);
                }
                continue;
            }
            args.extend([
                "-c".into(),
                format!("{key}.command={}", toml_string(&entry.command)?),
            ]);
            args.extend([
                "-c".into(),
                format!(
                    "{key}.args=[{}]",
                    entry
                        .args
                        .iter()
                        .map(|v| toml_string(v))
                        .collect::<Result<Vec<_>>>()?
                        .join(",")
                ),
            ]);
            for env in &entry.env {
                args.extend([
                    "-c".into(),
                    format!(
                        "{key}.env.{}={}",
                        toml_string(&env.name)?,
                        toml_string(&env.value)?
                    ),
                ]);
            }
        }
    }
    Ok((command.into(), args))
}
fn toml_string(value: &str) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}
