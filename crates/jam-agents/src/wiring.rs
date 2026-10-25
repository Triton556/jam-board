use crate::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
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
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<Env>,
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
    entries.extend_from_slice(extra);
    Ok(entries)
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
        let servers: serde_json::Map<String, serde_json::Value> = entries.iter().map(|e| (e.name.clone(), serde_json::json!({"command":e.command,"args":e.args,"env":e.env.iter().map(|v|(v.name.clone(),v.value.clone())).collect::<std::collections::BTreeMap<_,_>>()}))).collect();
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
