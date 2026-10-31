//! Project-local event log. Disk records contain redacted dock events and non-secret launch metadata.
use crate::*;
use crate::{profiles::Profile, session::now};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

pub const MAX_HISTORY_RESPONSE: usize = 20 * 1024 * 1024;
#[path = "terminal_history.rs"]
mod terminal_history;
pub(crate) use terminal_history::TerminalHistory;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Resumable {
    Native,
    Transcript,
    None,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    #[default]
    #[serde(alias = "acp", alias = "api")]
    Chat,
    Terminal,
}
// Source compatibility for existing chat callers; persisted/API kinds are chat/terminal.
#[allow(non_upper_case_globals)]
impl HistoryKind {
    pub const Acp: Self = Self::Chat;
    pub const Api: Self = Self::Chat;
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryProvider {
    pub label: String,
    pub agent_kind: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub project_id: String,
    pub profile_id: String,
    pub profile_label: String,
    #[serde(default)]
    pub kind: HistoryKind,
    #[serde(default)]
    pub provider: HistoryProvider,
    #[serde(default)]
    pub empty: bool,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub model: Option<String>,
    pub effort: Option<String>,
    pub agent_session_id: Option<String>,
    pub resumable: Resumable,
    pub message_count: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistorySettings {
    pub keep_history: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredHistory {
    #[serde(flatten)]
    pub entry: HistoryEntry,
    pub board: BoardContext,
    pub cwd: String,
    pub profile: Profile,
    #[serde(default)]
    pub renamed: bool,
    #[serde(default)]
    pub has_user_message: bool,
    #[serde(default)]
    pub last_agent_message_id: Option<String>,
    #[serde(default)]
    pub terminal: Option<TerminalHistory>,
}
#[derive(Clone)]
pub(crate) struct HistoryStore {
    pub dir: PathBuf,
    pub enabled: Arc<AtomicBool>,
    pub lock: Arc<Mutex<()>>,
}
fn safe_id(value: &str) -> Result<()> {
    if value.is_empty()
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(err("Invalid history identifier"));
    }
    Ok(())
}
impl HistoryStore {
    // Additive private metadata, outside the public history DTO. Existing records
    // without this field retain their original cwd/transcript matching rules.
    pub fn load_binding(&self, id: &str) -> Result<Option<crate::wiring::ProjectBinding>> {
        match File::open(self.path(id, false)?) {
            Ok(file) => {
                let value: serde_json::Value = serde_json::from_reader(file)?;
                value
                    .get("projectBinding")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(Into::into)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    pub(crate) fn recover_all(data_dir: &Path, enabled: Arc<AtomicBool>, lock: Arc<Mutex<()>>) {
        if !enabled.load(Ordering::SeqCst) {
            return;
        }
        let Ok(projects) = fs::read_dir(data_dir.join("agent-history")) else {
            return;
        };
        for project in projects.flatten() {
            if !project.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let Some(id) = project.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if Self::new(data_dir, &id, enabled.clone(), lock.clone())
                .and_then(|store| store.list(None, None))
                .is_err()
            {
                // A damaged history must not prevent the application opening.
                // Never log transcript contents or connection configuration.
                tracing::warn!("Cannot reconcile a project's terminal history at startup");
            }
        }
    }
    pub fn new(
        data_dir: &Path,
        project_id: &str,
        enabled: Arc<AtomicBool>,
        lock: Arc<Mutex<()>>,
    ) -> Result<Self> {
        safe_id(project_id)?;
        Ok(Self {
            dir: data_dir.join("agent-history").join(project_id),
            enabled,
            lock,
        })
    }
    fn path(&self, id: &str, events: bool) -> Result<PathBuf> {
        safe_id(id)?;
        Ok(self.dir.join(format!(
            "{id}{}",
            if events { ".events.jsonl" } else { ".json" }
        )))
    }
    pub fn load(&self, id: &str) -> Result<StoredHistory> {
        let mut record: StoredHistory =
            serde_json::from_reader(File::open(self.path(id, false)?)?)?;
        record.fill_provider();
        Ok(record)
    }
    fn save(&self, record: &StoredHistory) -> Result<()> {
        let path = self.path(&record.entry.id, false)?;
        let mut value = serde_json::to_value(record)?;
        if let Some(binding) = self.load_binding(&record.entry.id)? {
            value["projectBinding"] = serde_json::to_value(binding)?;
        }
        Self::save_json(&path, &value)
    }
    fn save_json(path: &Path, value: &serde_json::Value) -> Result<()> {
        // Serialize before writing so a serialization failure cannot destroy metadata.
        let bytes = serde_json::to_vec(value)?;
        let temporary = path.with_extension("json.tmp");
        let mut file = File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_data()?;
        drop(file);
        fs::rename(temporary, path)?;
        Ok(())
    }
    #[cfg(test)]
    pub fn create(&self, record: StoredHistory) -> Result<Option<HistoryWriter>> {
        self.create_bound(record, None)
    }
    pub fn create_bound(
        &self,
        mut record: StoredHistory,
        binding: Option<&crate::wiring::ProjectBinding>,
    ) -> Result<Option<HistoryWriter>> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        fs::create_dir_all(&self.dir)?;
        record.fill_provider();
        if record.entry.kind == HistoryKind::Chat {
            record.entry.empty = false;
        }
        if let Some(binding) = binding {
            let mut value = serde_json::to_value(&record)?;
            value["projectBinding"] = serde_json::to_value(binding)?;
            Self::save_json(&self.path(&record.entry.id, false)?, &value)?;
        } else {
            self.save(&record)?;
        }
        let path = self.path(&record.entry.id, true)?;
        let repair = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)?;
        repair_incomplete_tail(&repair)?;
        drop(repair);
        let file = OpenOptions::new().append(true).open(path)?;
        Ok(Some(HistoryWriter {
            store: self.clone(),
            record,
            file,
        }))
    }
    pub fn list(&self, limit: Option<u32>, query: Option<&str>) -> Result<Vec<HistoryEntry>> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        if !self.dir.exists() {
            return Ok(vec![]);
        }
        let query = query.unwrap_or_default().to_lowercase();
        let mut entries = vec![];
        for item in fs::read_dir(&self.dir)? {
            let path = item?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let mut record: StoredHistory = serde_json::from_reader(File::open(path)?)?;
                record.fill_provider();
                // Reconcile interrupted sessions on the first history read after restart.
                // Transcript files are only read; deletion remains project-local.
                if record.entry.kind == HistoryKind::Terminal && self.enabled.load(Ordering::SeqCst)
                {
                    record.refresh_terminal()?;
                    self.save(&record)?;
                }
                if record.entry.title.to_lowercase().contains(&query) {
                    entries.push(record.entry);
                }
            }
        }
        entries.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        entries.truncate(limit.unwrap_or(100).min(1000) as usize);
        Ok(entries)
    }
    pub fn events(&self, id: &str) -> Result<Vec<AgentDockEvent>> {
        self.read_events(id, true)
    }
    pub fn events_for_resume(&self, id: &str) -> Result<Vec<AgentDockEvent>> {
        self.read_events(id, false)
    }
    fn read_events(&self, id: &str, bounded: bool) -> Result<Vec<AgentDockEvent>> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        self.load(id)?;
        let file = File::open(self.path(id, true)?)?;
        let mut reader = BufReader::new(file);
        let mut events = vec![];
        let mut used = 2;
        let mut line = vec![];
        loop {
            line.clear();
            // A malicious or interrupted oversized line must not allocate unbounded memory.
            use std::io::Read;
            let remaining = if bounded {
                MAX_HISTORY_RESPONSE.saturating_sub(used + 1024)
            } else {
                usize::MAX - 1024
            };
            let n = reader
                .by_ref()
                .take((remaining + 1) as u64)
                .read_until(b'\n', &mut line)?;
            if n == 0 {
                break;
            }
            if n > remaining || line.last() != Some(&b'\n') {
                events.push(AgentDockEvent { session_id: id.into(), seq: events.last().map_or(1, |e: &AgentDockEvent| e.seq + 1), at: now(), event: AgentEventKind::Status { status: SessionStatus::Stopped, message: Some(if n > remaining { "History truncated at 20 MB; the remaining events are retained on disk." } else { "History ends with an incomplete event; it was omitted." }.into()) } });
                break;
            }
            let event: AgentDockEvent = serde_json::from_slice(&line)?;
            used += serde_json::to_vec(&event)?.len() + 1;
            events.push(event);
        }
        Ok(events)
    }
    pub fn rename(&self, id: &str, title: &str) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        if title.trim().is_empty() {
            return Err(err("History title is required"));
        }
        let mut record = self.load(id)?;
        record.entry.title = title.trim().chars().take(60).collect();
        record.entry.updated_at = now();
        record.renamed = true;
        self.save(&record)
    }
    pub fn delete(&self, id: &str) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        for events in [false, true] {
            match fs::remove_file(self.path(id, events)?) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
    pub fn clear(&self) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        if !self.dir.exists() {
            return Ok(());
        }
        // Only files in this validated project's history directory; never follow subdirectories.
        for item in fs::read_dir(&self.dir)? {
            let item = item?;
            if item.file_type()?.is_file() {
                fs::remove_file(item.path())?;
            }
        }
        Ok(())
    }
}
pub(crate) struct HistoryWriter {
    pub record: StoredHistory,
    store: HistoryStore,
    file: File,
}
impl HistoryWriter {
    pub fn append(&mut self, event: &AgentDockEvent, view: &AgentSessionView) -> Result<()> {
        if !self.store.enabled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let _guard = self
            .store
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        // Delete/clear is permanent even while the session continues emitting.
        if !self.store.path(&self.record.entry.id, false)?.exists() {
            return Ok(());
        }
        let current = self.store.load(&self.record.entry.id)?;
        if self.record.entry.kind == HistoryKind::Terminal {
            // A history read may already have linked this transcript or renamed
            // its row. Keep that identity and summary across later lifecycle events.
            self.record = current;
            if matches!(
                event.event,
                AgentEventKind::Status {
                    status: SessionStatus::Stopped | SessionStatus::Failed,
                    ..
                }
            ) {
                self.record.refresh_terminal()?;
                self.store.save(&self.record)?;
            }
            // Retain launch/status diagnostics, never raw PTY output.
            serde_json::to_writer(&mut self.file, event)?;
            self.file.write_all(b"\n")?;
            if matches!(event.event, AgentEventKind::Status { .. }) {
                self.file.sync_data()?;
            }
            return Ok(());
        }
        if current.renamed {
            self.record.entry.title = current.entry.title;
            self.record.renamed = true;
        }
        if let AgentEventKind::UserMessage { content, .. } = &event.event {
            if !self.record.has_user_message && !self.record.renamed {
                let text = content
                    .iter()
                    .find_map(|p| match p {
                        PromptPart::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .unwrap_or_default();
                self.record.entry.title = text
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .chars()
                    .take(60)
                    .collect();
            }
            self.record.has_user_message = true;
            self.record.entry.message_count += 1;
        }
        if let AgentEventKind::AgentMessageDelta { message_id, .. } = &event.event
            && self.record.last_agent_message_id.as_ref() != Some(message_id)
        {
            self.record.last_agent_message_id = Some(message_id.clone());
            self.record.entry.message_count += 1;
        }
        self.record.entry.updated_at = event.at.clone();
        if let AgentEventKind::ConfigOptions { options } = &event.event {
            if let Some(option) = options
                .iter()
                .find(|o| o.category.as_deref() == Some("model") || o.id == "model")
            {
                self.record.entry.model = Some(option.value.clone());
            }
        } else if self.record.entry.model.is_none() {
            self.record.entry.model = view.model.clone();
        }
        self.record.entry.effort = view.effort.clone();
        serde_json::to_writer(&mut self.file, event)?;
        self.file.write_all(b"\n")?;
        // File is unbuffered; sync the completed turn and lifecycle boundaries explicitly.
        if matches!(
            event.event,
            AgentEventKind::TurnEnd { .. } | AgentEventKind::Status { .. }
        ) {
            self.file.sync_data()?;
        }
        if matches!(
            event.event,
            AgentEventKind::TurnEnd { .. }
                | AgentEventKind::Status { .. }
                | AgentEventKind::UserMessage { .. }
                | AgentEventKind::ConfigOptions { .. }
        ) {
            self.store.save(&self.record)?;
        }
        Ok(())
    }
    pub fn native(&mut self, id: String, supported: bool) -> Result<()> {
        self.record.entry.agent_session_id = Some(id);
        self.record.entry.resumable = if supported {
            Resumable::Native
        } else {
            Resumable::None
        };
        let _guard = self
            .store
            .lock
            .lock()
            .map_err(|_| err("History lock unavailable"))?;
        if self.store.path(&self.record.entry.id, false)?.exists() {
            let current = self.store.load(&self.record.entry.id)?;
            if current.renamed {
                self.record.entry.title = current.entry.title;
                self.record.renamed = true;
            }
            self.store.save(&self.record)?;
        }
        Ok(())
    }
}

/// Interrupted writes may leave a partial last JSONL line. Recover only that tail;
/// completed lines remain byte-for-byte intact. Scan backwards with bounded memory.
fn repair_incomplete_tail(mut file: &File) -> Result<()> {
    use std::io::{Read, Seek, SeekFrom};
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(());
    }
    let mut end = len;
    let mut bytes = [0u8; 8192];
    while end > 0 {
        let start = end.saturating_sub(bytes.len() as u64);
        let size = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut bytes[..size])?;
        if let Some(last) = bytes[..size].iter().rposition(|b| *b == b'\n') {
            let valid = start + last as u64 + 1;
            if valid != len {
                file.set_len(valid)?;
                file.sync_data()?;
            }
            return Ok(());
        }
        end = start;
    }
    file.set_len(0)?;
    file.sync_data()?;
    Ok(())
}
