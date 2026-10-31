use crate::*;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub instance_id: String,
    pub project_id: String,
    #[serde(default)]
    pub project_name: String,
    pub canonical_folder: String,
    pub display_folder: String,
    pub repo_common_dir: Option<String>,
    pub last_opened_at: String,
    pub availability: String,
    pub migration_id: Option<String>,
}

impl Store {
    /// Retain the last known name in app-local recents when a folder goes missing.
    pub(crate) fn refresh_registry_name(&self) -> Result<()> {
        if let Some(data_dir) = &self.app_data_dir {
            let project = self.active_jam()?;
            let registry = ProjectRegistry::open(data_dir)?;
            for mut entry in registry.entries()? {
                if entry.project_id == project.id {
                    entry.project_name = project.name.clone();
                    registry.register(&entry)?;
                }
            }
        }
        Ok(())
    }
}
pub struct ProjectRegistry {
    pub data_dir: PathBuf,
    connection: Mutex<Connection>,
}
impl ProjectRegistry {
    pub(crate) fn relocate(
        &self,
        project: &str,
        old_folder: Option<&Path>,
        entry: &RegistryEntry,
    ) -> Result<()> {
        let mut c = self
            .connection
            .lock()
            .map_err(|_| invalid("registry", "Lock poisoned"))?;
        let tx = c.transaction()?;
        if let Some(old) = old_folder {
            tx.execute(
                "DELETE FROM projects WHERE project_id=? AND canonical_folder=?",
                params![project, old.to_string_lossy()],
            )?;
        }
        tx.execute("INSERT INTO projects VALUES(?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET canonical_folder=excluded.canonical_folder,entry_json=excluded.entry_json ON CONFLICT(canonical_folder) DO UPDATE SET instance_id=excluded.instance_id,entry_json=excluded.entry_json",params![entry.instance_id,entry.project_id,entry.canonical_folder,serde_json::to_string(entry)?])?;
        tx.commit()?;
        Ok(())
    }
    /// Caller supplies the app-local directory; folder contents never determine credential location.
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        std::fs::create_dir_all(data_dir.as_ref())?;
        let c = Connection::open(data_dir.as_ref().join("registry.db"))?;
        c.busy_timeout(std::time::Duration::from_secs(5))?;
        c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS projects(instance_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,canonical_folder TEXT UNIQUE NOT NULL,entry_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);")?;
        Ok(Self {
            data_dir: data_dir.as_ref().into(),
            connection: Mutex::new(c),
        })
    }
    pub fn entries(&self) -> Result<Vec<RegistryEntry>> {
        let c = self
            .connection
            .lock()
            .map_err(|_| invalid("registry", "Lock poisoned"))?;
        let rows = c
            .prepare("SELECT entry_json FROM projects ORDER BY project_id,canonical_folder")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|r| Ok(serde_json::from_str(&r)?))
            .collect()
    }
    pub fn resolve(&self, project: &str, folder: Option<&Path>) -> Result<RegistryEntry> {
        let canonical = folder.map(Path::canonicalize).transpose()?;
        let entries: Vec<_> = self
            .entries()?
            .into_iter()
            .filter(|e| {
                e.project_id == project
                    && canonical
                        .as_ref()
                        .is_none_or(|p| Path::new(&e.canonical_folder) == p)
            })
            .collect();
        if entries.len() != 1 {
            return Err(invalid(
                "projectFolder",
                "Exact project ID and an unambiguous registered folder are required",
            ));
        }
        Ok(entries[0].clone())
    }
    pub(crate) fn register(&self, entry: &RegistryEntry) -> Result<()> {
        let c = self
            .connection
            .lock()
            .map_err(|_| invalid("registry", "Lock poisoned"))?;
        c.execute("INSERT INTO projects VALUES(?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET project_id=excluded.project_id,canonical_folder=excluded.canonical_folder,entry_json=excluded.entry_json ON CONFLICT(canonical_folder) DO UPDATE SET instance_id=excluded.instance_id,project_id=excluded.project_id,entry_json=excluded.entry_json",params![entry.instance_id,entry.project_id,entry.canonical_folder,serde_json::to_string(entry)?])?;
        Ok(())
    }
    pub(crate) fn remove(&self, instance: &str) -> Result<()> {
        let c = self
            .connection
            .lock()
            .map_err(|_| invalid("registry", "Lock poisoned"))?;
        if c.execute("DELETE FROM projects WHERE instance_id=?", [instance])? == 0 {
            return Err(Error::NotFound("Recent project instance".into()));
        }
        Ok(())
    }
    pub fn local_setting(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self
            .connection
            .lock()
            .map_err(|_| invalid("registry", "Lock poisoned"))?
            .query_row("SELECT value FROM local_settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }
    pub fn set_local_setting(&self, key: &str, value: &str) -> Result<()> {
        self.connection.lock().map_err(|_|invalid("registry","Lock poisoned"))?.execute("INSERT INTO local_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,value])?;
        Ok(())
    }
}
