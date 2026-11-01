//! Retained-byte journals bridge SQLite commits and atomic filesystem replacements.
use crate::*;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{fs::File, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AssetIoAction {
    Delete,
    Replace,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AssetIoJournal {
    pub asset_id: String,
    pub database_generation: String,
    pub action: AssetIoAction,
    pub retained_path: String,
    pub old_revision: i64,
    pub old_hash: String,
    pub new_hash: Option<String>,
}
pub(crate) struct AssetIoGuard<'a> {
    pub store: &'a Store,
    pub project: String,
    pub root: PathBuf,
    pub anchor: PathBuf,
    pub generation: String,
    _lock: File,
    _lease: Option<ProjectLease>,
}
pub(crate) fn safe_id(id: &str) -> Result<()> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err(invalid(
            "assetId",
            "Asset ID cannot form a retained-files path",
        ));
    }
    Ok(())
}
impl Store {
    pub(crate) fn asset_state_root(&self, project: &str) -> Result<(PathBuf, PathBuf)> {
        let anchor = self.read(|c| crate::file_model::file_anchor(c, project))?;
        let root = if crate::project_folders::folder_for_db(&self.path).is_some() {
            crate::storage_io::contained(&anchor, ".state")?
        } else {
            anchor.clone()
        };
        Ok((root, anchor))
    }
    pub(crate) fn asset_io(&self) -> Result<AssetIoGuard<'_>> {
        let project = self.active_jam()?.id;
        let (root, anchor) = self.asset_state_root(&project)?;
        std::fs::create_dir_all(&root)?;
        let lock = crate::storage_io::lock(&root.join("asset-operations.lock"))?;
        let generation = self.folder_session_context()?.database_generation;
        let guard = AssetIoGuard {
            store: self,
            project,
            root,
            anchor,
            generation,
            _lock: lock,
            _lease: Some(self.project_lease()?),
        };
        guard.recover()?;
        Ok(guard)
    }
    pub(crate) fn recover_asset_io(&self) -> Result<()> {
        if crate::project_folders::folder_for_db(&self.path).is_none()
            && self
                .path
                .parent()
                .and_then(|p| p.file_name())
                .is_some_and(|n| n == ".state")
        {
            return Ok(());
        }
        let projects = self.read(|c| {
            Ok(c.prepare("SELECT id FROM jams")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?)
        })?;
        for project in projects {
            if crate::project_folders::folder_for_db(&self.path).is_none()
                && safe_id(&project).is_err()
            {
                continue;
            }
            let (root, anchor) = self.asset_state_root(&project)?;
            if !root.join("asset-operations").is_dir() {
                continue;
            }
            let lock = crate::storage_io::lock(&root.join("asset-operations.lock"))?;
            let generation = self.read(|c| {
                Ok(
                    c.query_row("SELECT database_generation FROM board_meta", [], |r| {
                        r.get(0)
                    })?,
                )
            })?;
            AssetIoGuard {
                store: self,
                project,
                root,
                anchor,
                generation,
                _lock: lock,
                _lease: None,
            }
            .recover()?;
        }
        Ok(())
    }
}
impl AssetIoGuard<'_> {
    pub fn retain_path(&self, relative: &str) -> Result<PathBuf> {
        crate::storage_io::contained(&self.root, relative)
    }
    pub fn journal(&self, journal: &AssetIoJournal) -> Result<()> {
        let dir = self.retain_path("asset-operations")?;
        std::fs::create_dir_all(&dir)?;
        crate::storage_io::atomic_write(
            &dir.join(format!("asset-{}.json", crate::id())),
            &serde_json::to_vec(journal)?,
        )
    }
    pub fn recover(&self) -> Result<()> {
        let dir = self.retain_path("asset-operations")?;
        if !dir.is_dir() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            if path.canonicalize()?.parent() != Some(dir.canonicalize()?.as_path()) {
                return Err(invalid("assetOperation", "Journal escapes its directory"));
            }
            let journal: AssetIoJournal = serde_json::from_slice(&std::fs::read(&path)?)?;
            safe_id(&journal.asset_id)?;
            let pieces = journal.retained_path.split('/').collect::<Vec<_>>();
            let valid = match journal.action {
                AssetIoAction::Delete => {
                    pieces.len() == 3
                        && pieces[0] == "trash"
                        && pieces[1].len() == 8
                        && pieces[1].bytes().all(|b| b.is_ascii_digit())
                        && pieces[2].starts_with(&format!("{}-", journal.asset_id))
                }
                AssetIoAction::Replace => {
                    pieces.len() == 3
                        && pieces[0] == "revisions"
                        && pieces[1] == journal.asset_id
                        && (pieces[2] == journal.old_revision.to_string()
                            || pieces[2].starts_with(&format!("{}.", journal.old_revision)))
                        && journal.new_hash.is_some()
                }
            };
            if !valid {
                return Err(invalid("assetOperation", "Invalid retained-byte path"));
            }
            if journal.database_generation != self.generation {
                return Err(Error::Forbidden("Asset journal belongs to another database generation; inspect retained bytes before recovery".into()));
            }
            let asset=self.store.read(|c|Ok(c.query_row("SELECT storage_type,stored_path,content_revision,content_hash FROM assets WHERE id=? AND jam_id=?",params![journal.asset_id,self.project],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,Option<String>>(3)?))).optional()?))?;
            let retained = self.retain_path(&journal.retained_path)?;
            if let Some((storage, stored, revision, hash)) = asset {
                if storage != "board_file" {
                    return Err(invalid(
                        "assetOperation",
                        "Journal no longer identifies a board file",
                    ));
                }
                if !stored.starts_with("files/") {
                    return Err(invalid(
                        "assetOperation",
                        "Board file must stay under files/",
                    ));
                }
                let source = crate::storage_io::contained(&self.anchor, &stored)?;
                match journal.action {
                    AssetIoAction::Delete => {
                        if revision != journal.old_revision {
                            return Err(Error::Conflict);
                        }
                        if retained.is_file() && !source.exists() {
                            if crate::storage_io::hash_reader(File::open(&retained)?)?.0
                                != journal.old_hash
                            {
                                return Err(Error::Conflict);
                            }
                            std::fs::create_dir_all(
                                source
                                    .parent()
                                    .ok_or_else(|| invalid("path", "Missing parent"))?,
                            )?;
                            std::fs::rename(&retained, &source)?;
                        }
                    }
                    AssetIoAction::Replace => {
                        let committed =
                            revision == journal.old_revision + 1 && hash == journal.new_hash;
                        if !committed {
                            if revision != journal.old_revision {
                                return Err(Error::Conflict);
                            }
                            if retained.is_file() {
                                if crate::storage_io::hash_reader(File::open(&retained)?)?.0
                                    != journal.old_hash
                                {
                                    return Err(Error::Conflict);
                                }
                                let actual = if source.is_file() {
                                    Some(crate::storage_io::hash_reader(File::open(&source)?)?.0)
                                } else {
                                    None
                                };
                                if actual.as_ref().is_some_and(|h| {
                                    h != &journal.old_hash && Some(h) != journal.new_hash.as_ref()
                                }) {
                                    return Err(Error::Conflict);
                                }
                                if actual.as_deref() != Some(&journal.old_hash) {
                                    crate::storage_io::atomic_copy(&retained, &source)?;
                                }
                            }
                        }
                    }
                }
            }
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}
