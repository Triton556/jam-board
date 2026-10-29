//! Read-only adapters for CLI-owned JSONL transcripts. Never execute a CLI here.
use super::*;
use serde_json::Value;
use std::collections::HashSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const MAX_LINE: u64 = 4 * 1024 * 1024;
const MATCH_WINDOW_SECONDS: i128 = 120;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalHistory {
    pub transcript_path: Option<PathBuf>,
    #[serde(default)]
    pub config_dir: Option<PathBuf>,
}

impl StoredHistory {
    pub(crate) fn fill_provider(&mut self) {
        if self.entry.provider.label.is_empty() {
            self.entry.provider.label = self.profile.label.clone();
        }
        if self.entry.provider.agent_kind.is_empty() {
            self.entry.provider.agent_kind = self.profile.preset.clone().unwrap_or_else(|| {
                match self.profile.kind {
                    RuntimeKind::Acp => "acp",
                    RuntimeKind::Api => "api",
                    RuntimeKind::Terminal => "terminal",
                }
                .into()
            });
        }
    }

    pub(crate) fn prepare_terminal(&mut self, agent_session_id: Option<String>) {
        self.entry.kind = HistoryKind::Terminal;
        self.entry.agent_session_id = agent_session_id;
        self.entry.empty = true;
        self.entry.model = None;
        self.entry.resumable = Resumable::None;
        self.terminal = Some(TerminalHistory::default());
        let (key, fallback) = if self.family() == Some("claude") {
            ("CLAUDE_CONFIG_DIR", ".claude")
        } else {
            ("CODEX_HOME", ".codex")
        };
        let config_dir = self.config_dir(key, fallback);
        self.terminal
            .as_mut()
            .expect("terminal metadata")
            .config_dir = config_dir;
    }

    fn family(&self) -> Option<&'static str> {
        crate::wiring::terminal_family(self.profile.preset.as_deref(), &self.profile.command)
    }

    fn config_dir(&self, key: &str, default: &str) -> Option<PathBuf> {
        if let Some(root) = self.terminal.as_ref().and_then(|t| t.config_dir.clone()) {
            return Some(root);
        }
        self.profile
            .env
            .iter()
            .rev()
            .find(|e| {
                if cfg!(windows) {
                    e.name.eq_ignore_ascii_case(key)
                } else {
                    e.name == key
                }
            })
            .map(|e| PathBuf::from(&e.value))
            .or_else(|| std::env::var_os(key).map(PathBuf::from))
            .or_else(|| {
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                    .map(|home| PathBuf::from(home).join(default))
            })
            .map(|path| {
                if path.is_relative() {
                    Path::new(&self.cwd).join(path)
                } else {
                    path
                }
            })
    }

    fn find_transcript(&self) -> Result<Option<PathBuf>> {
        if let Some(path) = self
            .terminal
            .as_ref()
            .and_then(|t| t.transcript_path.as_ref())
            && path.is_file()
        {
            return Ok(Some(path.clone()));
        }
        match self.family() {
            Some("claude") => {
                let Some(id) = &self.entry.agent_session_id else {
                    return Ok(None);
                };
                safe_id(id)?;
                let Some(root) = self.config_dir("CLAUDE_CONFIG_DIR", ".claude") else {
                    return Ok(None);
                };
                let projects = root.join("projects");
                let filename = format!("{id}.jsonl");
                let path = projects
                    .join(claude_project_slug(&self.cwd))
                    .join(&filename);
                if path.is_file() {
                    return Ok(Some(path));
                }
                // CLI versions / canonical cwd spellings can use a different slug.
                // Our generated session UUID identifies exactly one transcript.
                let folders = match fs::read_dir(projects) {
                    Ok(folders) => folders,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                    Err(e) => return Err(e.into()),
                };
                for folder in folders {
                    let folder = folder?;
                    if folder.file_type()?.is_dir() {
                        let path = folder.path().join(&filename);
                        if path.is_file() {
                            return Ok(Some(path));
                        }
                    }
                }
                Ok(None)
            }
            Some("codex") => {
                let Some(root) = self.config_dir("CODEX_HOME", ".codex") else {
                    return Ok(None);
                };
                let Some(start) = timestamp(&self.entry.created_at) else {
                    return Ok(None);
                };
                let mut candidates = Vec::new();
                // A CLI can start across midnight; inspect the adjacent UTC dates too.
                for offset in [-1, 0, 1] {
                    let date = start.date() + time::Duration::days(offset);
                    let dir = root
                        .join("sessions")
                        .join(format!("{:04}", date.year()))
                        .join(format!("{:02}", u8::from(date.month())))
                        .join(format!("{:02}", date.day()));
                    let items = match fs::read_dir(dir) {
                        Ok(items) => items,
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                        Err(e) => return Err(e.into()),
                    };
                    for item in items {
                        let item = item?;
                        let path = item.path();
                        if !item.file_type()?.is_file()
                            || path.extension().and_then(|s| s.to_str()) != Some("jsonl")
                        {
                            continue;
                        }
                        if let Some((_, cwd, at)) = codex_identity(&path)?
                            && same_cwd(&cwd, &self.cwd)
                            && let Some(at) = timestamp(&at)
                        {
                            let distance = (at - start).whole_milliseconds().abs();
                            if distance <= MATCH_WINDOW_SECONDS * 1000 {
                                candidates.push((distance, path));
                            }
                        }
                    }
                }
                candidates.sort_by_key(|(distance, _)| *distance);
                // Equal nearest timestamps are ambiguous; never guess by filename.
                if candidates.len() > 1 && candidates[0].0 == candidates[1].0 {
                    return Ok(None);
                }
                Ok(candidates.into_iter().next().map(|(_, path)| path))
            }
            _ => Ok(None),
        }
    }

    pub(crate) fn refresh_terminal(&mut self) -> Result<()> {
        let Some(path) = self.find_transcript()? else {
            // Preserve a previously linked summary when its CLI transcript was removed.
            self.entry.resumable = Resumable::None;
            return Ok(());
        };
        let summary = summarize(&path, self.family() == Some("codex"))?;
        if self.family() == Some("claude")
            && summary
                .id
                .as_ref()
                .is_some_and(|id| Some(id) != self.entry.agent_session_id.as_ref())
        {
            return Err(err(
                "Claude transcript session ID does not match terminal history",
            ));
        }
        if let Some(id) = summary.id {
            self.entry.agent_session_id = Some(id);
        }
        if !self.renamed
            && let Some(title) = summary.title
        {
            self.entry.title = title;
        }
        if let Some(at) = summary.last_activity {
            self.entry.updated_at = at;
        }
        self.entry.model = summary.model;
        self.entry.message_count = summary.messages;
        self.entry.empty = !summary.has_user;
        self.entry.resumable = if self.entry.agent_session_id.is_some() && summary.has_user {
            Resumable::Native
        } else {
            Resumable::None
        };
        self.terminal
            .get_or_insert_with(TerminalHistory::default)
            .transcript_path = Some(path);
        Ok(())
    }

    pub(crate) fn terminal_resume_args(&self, args: &mut Vec<String>) -> Result<String> {
        self.terminal
            .as_ref()
            .and_then(|t| t.transcript_path.as_ref())
            .filter(|p| p.is_file())
            .ok_or_else(|| {
                err("Terminal transcript is missing; it may have been moved or deleted by the CLI")
            })?;
        let id = self
            .entry
            .agent_session_id
            .as_ref()
            .ok_or_else(|| err("Terminal transcript has no session ID"))?;
        safe_id(id)?;
        // Refuse conflicting user-supplied selectors instead of resuming another session.
        if args.iter().any(|a| {
            a == "--session-id"
                || a.starts_with("--session-id=")
                || a == "--resume"
                || a.starts_with("--resume=")
                || a == "resume"
                || a == "--continue"
                || a == "--last"
        }) {
            return Err(err(
                "Remove session selection arguments from the connection before resuming history",
            ));
        }
        let selector = match self.family() {
            Some("claude") => "--resume",
            Some("codex") => "resume",
            _ => return Err(err("This terminal connection does not support resume")),
        };
        args.extend([selector.into(), id.clone()]);
        Ok(id.clone())
    }
}

fn timestamp(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339).ok()
}
// Claude Code 2.1.309: bD / k / Le, with vpe's signed JS UTF-16 hash.
fn claude_project_slug(cwd: &str) -> String {
    let mut slug: String = cwd
        .encode_utf16()
        .map(|c| {
            if c <= 127 && (c as u8).is_ascii_alphanumeric() {
                c as u8 as char
            } else {
                '-'
            }
        })
        .collect();
    if slug.len() > 200 {
        let hash = cwd.encode_utf16().fold(0i32, |hash, c| {
            hash.wrapping_mul(31).wrapping_add(i32::from(c))
        });
        let mut magnitude = hash.unsigned_abs();
        let mut digits = Vec::new();
        loop {
            digits.push(char::from_digit(magnitude % 36, 36).expect("base36 digit"));
            magnitude /= 36;
            if magnitude == 0 {
                break;
            }
        }
        slug.truncate(200);
        slug.push('-');
        slug.extend(digits.into_iter().rev());
    }
    slug
}
fn same_cwd(a: &str, b: &str) -> bool {
    fn normalize(cwd: &str) -> String {
        let cwd = cwd.replace('\\', "/");
        let cwd = cwd.strip_prefix("//?/").unwrap_or(&cwd);
        let cwd = if cwd.get(..4).is_some_and(|s| s.eq_ignore_ascii_case("UNC/")) {
            format!("//{}", &cwd[4..])
        } else {
            cwd.to_owned()
        };
        cwd.trim_end_matches('/').to_owned()
    }
    let (a, b) = (normalize(a), normalize(b));
    let windows_path = |s: &str| s.as_bytes().get(1) == Some(&b':') || s.starts_with("//");
    if cfg!(windows) || (windows_path(&a) && windows_path(&b)) {
        a.eq_ignore_ascii_case(&b)
    } else {
        a == b
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn r8h_slug_matches_cli_ascii_utf16_and_long_path_rules() {
        assert_eq!(
            claude_project_slug(r"C:\work\dot.dir\under_score"),
            "C--work-dot-dir-under-score"
        );
        assert_eq!(
            claude_project_slug(
                r"C:\Users\Example\AppData\Roaming\dev.triton556.jamboard\agent-workspace\01M62WYWJVWKHMPN28EVCH660A"
            ),
            "C--Users-Example-AppData-Roaming-dev-triton556-jamboard-agent-workspace-01M62WYWJVWKHMPN28EVCH660A"
        );
        assert_eq!(
            claude_project_slug(&format!("C:\\{}", "a".repeat(210))),
            format!("C--{}-6d38w5", "a".repeat(197))
        );
        assert_eq!(
            claude_project_slug(&format!("C:\\{}", "é😀".repeat(80))),
            format!("C{}-tkfxt1", "-".repeat(199))
        );
    }

    #[test]
    fn r8h_cwd_does_not_merge_different_projects() {
        assert!(same_cwd(
            r"\\?\UNC\Server\Share\Project\",
            "//server/share/project/"
        ));
        assert!(!same_cwd(r"F:\work\sample-project", r"F:\work\other"));
        if !cfg!(windows) {
            assert!(!same_cwd("/work/Project", "/work/project"));
        }
    }
}

/// Interrupted final records and malformed CLI bookkeeping are ignored. Bounds
/// apply per record, so large transcripts stream without loading into memory.
fn records(path: &Path, mut visit: impl FnMut(Value) -> bool) -> Result<()> {
    use std::io::Read;
    let mut reader = BufReader::new(File::open(path)?);
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader
            .by_ref()
            .take(MAX_LINE + 1)
            .read_until(b'\n', &mut line)?;
        if n == 0 {
            break;
        }
        if n as u64 > MAX_LINE {
            // Discard the rest of this oversized record using bounded storage.
            while line.last() != Some(&b'\n') {
                line.clear();
                if reader
                    .by_ref()
                    .take(MAX_LINE)
                    .read_until(b'\n', &mut line)?
                    == 0
                {
                    break;
                }
            }
            continue;
        }
        if line.last() == Some(&b'\n')
            && let Ok(value) = serde_json::from_slice(&line)
            && !visit(value)
        {
            break;
        }
    }
    Ok(())
}

fn codex_identity(path: &Path) -> Result<Option<(String, String, String)>> {
    let mut identity = None;
    records(path, |v| {
        if v["type"] == "session_meta" {
            let p = &v["payload"];
            identity = p["id"]
                .as_str()
                .zip(p["cwd"].as_str())
                .zip(p["timestamp"].as_str())
                .map(|((id, cwd), at)| (id.into(), cwd.into(), at.into()));
        }
        false // Metadata is the first rollout record; never read unrelated conversations.
    })?;
    Ok(identity)
}

#[derive(Default)]
struct Summary {
    id: Option<String>,
    title: Option<String>,
    last_activity: Option<String>,
    model: Option<String>,
    messages: u64,
    has_user: bool,
}
fn text_content(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.into();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join(" ")
}
fn summarize(path: &Path, codex: bool) -> Result<Summary> {
    let mut summary = Summary::default();
    let mut seen = HashSet::new();
    records(path, |v| {
        let kind = v["type"].as_str().unwrap_or_default();
        if !codex && v["isSidechain"] == true {
            return true;
        }
        let mut message = None;
        if codex {
            let p = &v["payload"];
            if kind == "session_meta" {
                summary.id = p["id"].as_str().map(str::to_owned);
            }
            if (kind == "turn_context" || kind == "session_meta")
                && let Some(model) = p["model"].as_str()
            {
                summary.model = Some(model.into());
            }
            if kind == "response_item" && p["type"] == "message" {
                message = Some(p);
            }
        } else if v["isSidechain"] != true && v["isMeta"] != true && v["isCompactSummary"] != true {
            if let Some(id) = v["sessionId"].as_str() {
                summary.id = Some(id.into());
            }
            if kind == "user" || kind == "assistant" {
                message = Some(&v["message"]);
            }
            if let Some(model) = v["message"]["model"]
                .as_str()
                .filter(|m| *m != "<synthetic>")
            {
                summary.model = Some(model.into());
            }
        }
        if let Some(at) = v["timestamp"].as_str().filter(|s| timestamp(s).is_some())
            && summary
                .last_activity
                .as_ref()
                .is_none_or(|old| timestamp(old) < timestamp(at))
        {
            summary.last_activity = Some(at.into());
        }
        if let Some(m) = message {
            let role = m["role"].as_str().unwrap_or(kind);
            let text = text_content(&m["content"]);
            let has_image = m["content"].as_array().into_iter().flatten().any(|part| {
                matches!(
                    part["type"].as_str(),
                    Some("image" | "input_image" | "image_url")
                )
            });
            if matches!(role, "user" | "assistant") && (!text.trim().is_empty() || has_image) {
                let id = m["id"].as_str().or_else(|| v["uuid"].as_str());
                if id.is_none_or(|id| seen.insert(id.to_owned())) {
                    summary.messages += 1;
                }
                if role == "user" {
                    summary.has_user = true;
                    if summary.title.is_none() && !text.trim().is_empty() {
                        summary.title = Some(
                            text.trim()
                                .lines()
                                .next()
                                .unwrap_or_default()
                                .trim()
                                .chars()
                                .take(60)
                                .collect(),
                        );
                    }
                }
            }
        }
        true
    })?;
    Ok(summary)
}
