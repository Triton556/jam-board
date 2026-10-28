//! Read-only diagnostics for stale agent MCP configuration. Config contents and
//! credentials must never be included in a warning or a parser error.
use crate::*;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LaunchWarning {
    pub config_path: String,
    pub server_name: String,
    pub injected_server_name: String,
    pub suggested_fix: String,
}

pub(crate) fn launch_warnings(
    profile: &crate::profiles::Profile,
    cwd: &Path,
    env: &[Env],
    injected: &str,
) -> Vec<LaunchWarning> {
    if profile.kind == RuntimeKind::Api {
        return vec![];
    }
    let identity = format!(
        "{} {} {}",
        profile.preset.as_deref().unwrap_or_default(),
        profile.command,
        profile.args.join(" ")
    )
    .to_ascii_lowercase();
    let family = if identity.contains("codex") {
        "codex"
    } else if identity.contains("claude") {
        "claude"
    } else {
        return vec![];
    };
    let variable = |name: &str| {
        env.iter()
            .rev()
            .find(|e| e.name == name)
            .map(|e| PathBuf::from(&e.value))
            .or_else(|| std::env::var_os(name).map(PathBuf::from))
    };
    #[cfg(windows)]
    let home = variable("USERPROFILE");
    #[cfg(not(windows))]
    let home = variable("HOME");
    let mut paths = BTreeSet::new();
    if family == "codex" {
        if let Some(dir) =
            variable("CODEX_HOME").or_else(|| home.as_ref().map(|p| p.join(".codex")))
        {
            paths.insert(dir.join("config.toml"));
        }
    } else {
        if let Some(home) = &home {
            paths.insert(home.join(".claude.json"));
        }
        if let Some(dir) = variable("CLAUDE_CONFIG_DIR") {
            paths.insert(dir.join(".claude.json"));
        }
    }
    for dir in cwd.ancestors() {
        paths.insert(if family == "codex" {
            dir.join(".codex/config.toml")
        } else {
            dir.join(".mcp.json")
        });
    }
    let mut warnings = vec![];
    for path in paths {
        let Ok(source) = std::fs::read_to_string(&path) else {
            continue;
        };
        for name in stale_servers(&source, family == "codex") {
            warnings.push(LaunchWarning {
                config_path: path.to_string_lossy().into_owned(),
                server_name: name,
                injected_server_name: injected.into(),
                suggested_fix: "Remove or disable this stale MCP entry in the indicated file after review. Jam Board uses its separate session-specific server; do not use the stale connection for this board.".into(),
            });
        }
    }
    warnings
}

fn jam_binary(value: &str) -> bool {
    value.to_ascii_lowercase().contains("jam-board-mcp")
}

fn stale_servers(source: &str, toml: bool) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    if toml {
        let mut parser = ConfigScan {
            tokens: tokens(source),
            at: 0,
            names: &mut names,
            all_mcp: false,
        };
        parser.document();
    } else if let Ok(value) = serde_json::from_str::<serde_json::Value>(source) {
        fn scan(value: &serde_json::Value, names: &mut BTreeSet<String>) {
            if let Some(servers) = value.get("mcpServers").and_then(|v| v.as_object()) {
                for (name, spec) in servers {
                    let binary = spec
                        .get("command")
                        .and_then(|v| v.as_str())
                        .is_some_and(jam_binary)
                        || spec
                            .get("args")
                            .and_then(|v| v.as_array())
                            .is_some_and(|a| a.iter().any(|v| v.as_str().is_some_and(jam_binary)));
                    if name == "jam-board" || binary {
                        names.insert(name.clone());
                    }
                }
            }
            // Claude local-scope entries live under projects.<cwd>.mcpServers.
            if let Some(projects) = value.get("projects").and_then(|v| v.as_object()) {
                for project in projects.values() {
                    scan(project, names);
                }
            }
        }
        scan(&value, &mut names);
    }
    names
}

// A bounded lexical scan, not a TOML deserializer: only table/key paths and
// string values are needed. Handles quoted/dotted keys, inline tables, arrays
// and multiline strings without echoing untrusted configuration diagnostics.
#[derive(Clone)]
enum Token {
    Text(String),
    Mark(char),
}
fn tokens(source: &str) -> Vec<Token> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = vec![];
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        i += 1;
        match ch {
            '#' => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            ' ' | '\t' | '\r' => {}
            '"' | '\'' => {
                let triple = chars.get(i) == Some(&ch) && chars.get(i + 1) == Some(&ch);
                if triple {
                    i += 2;
                }
                let mut value = String::new();
                while i < chars.len() {
                    let c = chars[i];
                    i += 1;
                    if c == ch {
                        if !triple {
                            break;
                        }
                        if chars.get(i) == Some(&ch) && chars.get(i + 1) == Some(&ch) {
                            i += 2;
                            break;
                        }
                    }
                    if ch == '"' && c == '\\' && i < chars.len() {
                        value.push(chars[i]);
                        i += 1;
                    } else {
                        value.push(c);
                    }
                }
                out.push(Token::Text(value));
            }
            '\n' | '[' | ']' | '{' | '}' | '.' | '=' | ',' => out.push(Token::Mark(ch)),
            _ => {
                let mut value = String::from(ch);
                while i < chars.len() && !" \t\r\n[]{}.=,#\"'".contains(chars[i]) {
                    value.push(chars[i]);
                    i += 1;
                }
                out.push(Token::Text(value));
            }
        }
    }
    out
}
struct ConfigScan<'a> {
    tokens: Vec<Token>,
    at: usize,
    names: &'a mut BTreeSet<String>,
    all_mcp: bool,
}
impl ConfigScan<'_> {
    fn mark(&mut self, ch: char) -> bool {
        if matches!(self.tokens.get(self.at), Some(Token::Mark(c)) if *c == ch) {
            self.at += 1;
            true
        } else {
            false
        }
    }
    fn key(&mut self) -> Vec<String> {
        let mut path = vec![];
        while let Some(Token::Text(text)) = self.tokens.get(self.at) {
            path.push(text.clone());
            self.at += 1;
            if !self.mark('.') {
                break;
            }
        }
        path
    }
    fn record(&mut self, path: &[String], value: Option<&str>) {
        if self.all_mcp {
            if let Some(at) = path.iter().position(|p| p == "mcp_servers")
                && let Some(name) = path.get(at + 1)
            {
                self.names.insert(name.clone());
            }
            return;
        }
        if path.len() >= 2
            && path[0] == "mcp_servers"
            && (path[1] == "jam-board"
                || (path.get(2).is_some_and(|s| s == "command" || s == "args")
                    && value.is_some_and(jam_binary)))
        {
            self.names.insert(path[1].clone());
        }
    }
    fn value(&mut self, path: &[String], depth: usize) {
        if depth > 32 {
            self.at = self.tokens.len();
            return;
        }
        self.record(path, None);
        if self.mark('{') {
            while self.at < self.tokens.len() && !self.mark('}') {
                let start = self.at;
                let mut child = path.to_vec();
                child.extend(self.key());
                if self.mark('=') {
                    self.value(&child, depth + 1);
                }
                if self.at == start {
                    self.at += 1;
                }
                self.mark(',');
                self.mark('\n');
            }
        } else if self.mark('[') {
            while self.at < self.tokens.len() && !self.mark(']') {
                let start = self.at;
                self.value(path, depth + 1);
                if self.at == start {
                    self.at += 1;
                }
                self.mark(',');
                self.mark('\n');
            }
        } else if let Some(token) = self.tokens.get(self.at).cloned() {
            self.at += 1;
            if let Token::Text(value) = token {
                self.record(path, Some(&value));
            }
        }
    }
    fn document(&mut self) {
        let mut table = vec![];
        while self.at < self.tokens.len() {
            let start = self.at;
            if self.mark('[') {
                self.mark('[');
                table = self.key();
                self.mark(']');
                self.mark(']');
                self.record(&table, None);
            } else {
                let mut path = table.clone();
                path.extend(self.key());
                if self.mark('=') {
                    self.value(&path, 0);
                }
            }
            if self.at == start {
                self.at += 1;
            }
        }
    }
}

pub(crate) fn config_family(profile: &crate::profiles::Profile) -> Option<&'static str> {
    let identity = format!(
        "{} {} {}",
        profile.preset.as_deref().unwrap_or_default(),
        profile.command,
        profile.args.join(" ")
    )
    .to_ascii_lowercase();
    if identity.contains("claude") {
        Some("claude")
    } else if identity.contains("codex") {
        Some("codex")
    } else {
        None
    }
}
pub(crate) fn exclude_description(profile: &crate::profiles::Profile) -> (bool, String) {
    if profile.kind == RuntimeKind::Api {
        return (true, "API chat does not load Claude or Codex user configuration. Profile credentials and board MCP connections stay available.".into());
    }
    match config_family(profile) {
        Some("claude") => (true, "Excludes personal MCP servers and disables settings hooks. Excludes user settings unless they declare authentication helpers or environment values, or cannot be inspected; in those cases user settings stay loaded to preserve authentication. Authentication stays in its original location. Project/local settings, global CLAUDE.md, skills, plugins, memory and managed policy may still apply. The ACP adapter also reads global settings for its own model/permission/auth metadata. This is partial exclusion, not a clean-room session.".into()),
        Some("codex") => (true, format!("Disables MCP entries found in the global config.toml (including inline/profile entries) and notify commands; requests disabled lifecycle hooks using per-session overrides. Authentication stays in its original location. {}Global AGENTS.md, skills, plugins, model/provider/permission settings, project config, profile/environment overrides and managed policy still apply. This is partial exclusion, not a clean-room session.", if profile.kind == RuntimeKind::Acp { "The ACP app-server may apply startup hooks before session overrides, so hooks are not fully excluded. " } else { "" })),
        _ => (false, "This custom agent has no verified user-config exclusion mechanism. Choose include or configure an isolated wrapper that preserves authentication.".into()),
    }
}
pub(crate) fn apply_user_config(
    profile: &crate::profiles::Profile,
    choice: UserConfigChoice,
    args: &mut Vec<String>,
    env: &mut Vec<Env>,
) -> Result<Option<serde_json::Value>> {
    if choice == UserConfigChoice::Include || profile.kind == RuntimeKind::Api {
        return Ok(None);
    }
    match config_family(profile) {
        Some("claude") => {
            let sources = claude_setting_sources(env);
            if profile.kind == RuntimeKind::Acp {
                Ok(Some(serde_json::json!({"claudeCode":{"options":{
                    "settingSources":sources, "strictMcpConfig":true,
                    "settings":{"disableAllHooks":true}
                }}})))
            } else {
                args.extend([
                    "--setting-sources".into(),
                    sources.join(","),
                    "--strict-mcp-config".into(),
                    "--settings".into(),
                    "{\"disableAllHooks\":true}".into(),
                ]);
                Ok(None)
            }
        }
        Some("codex") => {
            let variable = |name: &str| {
                env.iter()
                    .rev()
                    .find(|e| e.name.eq_ignore_ascii_case(name))
                    .map(|e| PathBuf::from(&e.value))
                    .or_else(|| std::env::var_os(name).map(PathBuf::from))
            };
            #[cfg(windows)]
            let home = variable("USERPROFILE");
            #[cfg(not(windows))]
            let home = variable("HOME");
            let dir = variable("CODEX_HOME")
                .or_else(|| home.map(|p| p.join(".codex")))
                .ok_or_else(|| err("Cannot locate Codex user configuration for exclusion"))?;
            let path = dir.join("config.toml");
            let source = match std::fs::read_to_string(&path) {
                Ok(source) if source.len() <= 2_000_000 => source,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
                _ => return Err(err("Cannot read Codex user configuration for exclusion")),
            };
            let mut names = BTreeSet::new();
            ConfigScan {
                tokens: tokens(&source),
                at: 0,
                names: &mut names,
                all_mcp: true,
            }
            .document();
            let mut overrides = serde_json::Map::new();
            overrides.insert("features.hooks".into(), serde_json::json!(false));
            overrides.insert("features.codex_hooks".into(), serde_json::json!(false));
            overrides.insert("notify".into(), serde_json::json!([]));
            for name in names {
                overrides.insert(
                    format!("mcp_servers.{}.enabled", serde_json::to_string(&name)?),
                    serde_json::json!(false),
                );
            }
            if profile.kind == RuntimeKind::Acp {
                let existing = env
                    .iter()
                    .rev()
                    .find(|e| e.name == "CODEX_CONFIG")
                    .map(|e| e.value.clone())
                    .or_else(|| std::env::var("CODEX_CONFIG").ok());
                let mut config = match existing {
                    Some(text) => serde_json::from_str::<serde_json::Value>(&text)
                        .ok()
                        .and_then(|v| v.as_object().cloned())
                        .ok_or_else(|| err("CODEX_CONFIG must be a JSON object"))?,
                    None => serde_json::Map::new(),
                };
                config.extend(overrides);
                env.retain(|e| e.name != "CODEX_CONFIG");
                env.push(Env {
                    name: "CODEX_CONFIG".into(),
                    value: serde_json::to_string(&config)?,
                });
            } else {
                for (key, value) in overrides {
                    args.extend(["-c".into(), format!("{key}={value}")]);
                }
            }
            Ok(None)
        }
        _ => Err(err("User config exclusion is not supported for this agent")),
    }
}

fn claude_setting_sources(env: &[Env]) -> Vec<&'static str> {
    let variable = |name: &str| {
        env.iter()
            .rev()
            .find(|e| e.name.eq_ignore_ascii_case(name))
            .map(|e| PathBuf::from(&e.value))
            .or_else(|| std::env::var_os(name).map(PathBuf::from))
    };
    #[cfg(windows)]
    let home = variable("USERPROFILE");
    #[cfg(not(windows))]
    let home = variable("HOME");
    let dir = variable("CLAUDE_CONFIG_DIR").or_else(|| home.map(|p| p.join(".claude")));
    let keep_user = match dir.map(|p| std::fs::read_to_string(p.join("settings.json"))) {
        Some(Ok(source)) if source.len() <= 2_000_000 => {
            serde_json::from_str::<serde_json::Value>(&source)
                .ok()
                .filter(|v| v.is_object())
                .is_none_or(|settings| {
                    [
                        "apiKeyHelper",
                        "awsAuthRefresh",
                        "awsCredentialExport",
                        "env",
                    ]
                    .iter()
                    .any(|key| settings.get(*key).is_some_and(|value| !value.is_null()))
                })
        }
        Some(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => false,
        _ => true,
    };
    if keep_user {
        vec!["user", "project", "local"]
    } else {
        vec!["project", "local"]
    }
}

/// Defense in depth for adapter diagnostics containing credentials we did not
/// inject (for example an adapter's own authentication header).
pub(crate) fn redact_diagnostic(source: &str) -> String {
    let mut text = source.to_owned();
    for marker in [
        "bearer ",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "password",
        "authorization",
    ] {
        let mut offset = 0;
        loop {
            let lower = text.to_ascii_lowercase();
            let Some(at) = lower[offset..]
                .find(marker)
                .map(|i| i + offset + marker.len())
            else {
                break;
            };
            let mut start = at;
            while text
                .as_bytes()
                .get(start)
                .is_some_and(|b| b" \t\"':=".contains(b))
            {
                start += 1;
            }
            for scheme in ["bearer ", "basic "] {
                if lower.get(start..).is_some_and(|s| s.starts_with(scheme)) {
                    start += scheme.len();
                    break;
                }
            }
            if text[start..].starts_with("[REDACTED]") {
                offset = start + 10;
                continue;
            }
            let end = text[start..]
                .find(|c: char| c.is_whitespace() || "\"',;}]".contains(c))
                .map_or(text.len(), |n| start + n);
            if start < end {
                text.replace_range(start..end, "[REDACTED]");
                offset = start + 10;
            } else {
                offset = at;
            }
            if offset >= text.len() {
                break;
            }
        }
    }
    text
}

#[cfg(test)]
#[path = "launch_config_tests.rs"]
mod tests;
