use crate::*;
use rusqlite::{Connection, OptionalExtension};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

struct Connections {
    writer: Mutex<Connection>,
    readers: [Mutex<Connection>; 2],
    next_reader: AtomicUsize,
}
#[derive(Clone)]
pub struct Store {
    connections: Arc<Connections>,
    pub(crate) project_id: Option<String>,
    pub path: PathBuf,
    expected_generation: String,
    pub(crate) app_data_dir: Option<PathBuf>,
}

pub fn resolve_db_path(explicit: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        return Ok(path);
    }
    if let Some(path) = std::env::var_os("JAM_BOARD_DB") {
        return Ok(path.into());
    }
    if let Some(path) = std::env::var_os("JAM_BOARD_DATA_DIR") {
        return Ok(PathBuf::from(path).join("jam.db"));
    }
    let base = std::env::var_os("APPDATA").ok_or_else(|| {
        invalid(
            "database",
            "set --db, JAM_BOARD_DB or JAM_BOARD_DATA_DIR when APPDATA is unavailable",
        )
    })?;
    Ok(PathBuf::from(base).join("dev.triton556.jamboard/jam.db"))
}

pub(crate) fn connect(path: &Path) -> Result<Connection> {
    let c = Connection::open(sqlite_path(path)?)?;
    c.busy_timeout(std::time::Duration::from_millis(5000))?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
CREATE TEMP TABLE jam_project_context(project_id TEXT); INSERT INTO jam_project_context VALUES (NULL);")?;
    if crate::project_folders::folder_for_db(path).is_some() {
        c.execute_batch("PRAGMA synchronous=FULL;")?;
    }
    Ok(c)
}
pub(crate) fn sqlite_path(path: &Path) -> Result<PathBuf> {
    #[cfg(windows)]
    {
        if path.as_os_str() == ":memory:" {
            return Ok(path.into());
        }
        let absolute = std::path::absolute(path)?;
        Ok(absolute
            .parent()
            .ok_or_else(|| invalid("database", "Missing parent"))?
            .canonicalize()?
            .join(
                absolute
                    .file_name()
                    .ok_or_else(|| invalid("database", "Missing filename"))?,
            ))
    }
    #[cfg(not(windows))]
    {
        Ok(path.into())
    }
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let _schema_lock = crate::storage_io::lock(&path.with_extension("schema.lock"))?;
        if path.is_file() {
            let existing = Connection::open_with_flags(
                sqlite_path(path)?,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            let version: i64 = existing.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            if version > 9 {
                return Err(invalid("database", "Newer schema: writable open refused"));
            }
            if (1..9).contains(&version) {
                let backup = if let Some(folder) = crate::project_folders::folder_for_db(path) {
                    let root = folder
                        .join(".state/backups")
                        .join(format!("schema-v{version}-{}", id()));
                    std::fs::create_dir_all(&root)?;
                    root.join("board.db")
                } else {
                    path.with_extension(format!("pre-v9-{}.backup.db", id()))
                };
                crate::storage_io::backup(&existing, &backup)?;
            }
        }
        let mut writer = connect(path)?;
        writer.set_transaction_behavior(rusqlite::TransactionBehavior::Immediate);
        let migrations = rusqlite_migration::Migrations::new(vec![
            rusqlite_migration::M::up(include_str!("migration.sql")),
            rusqlite_migration::M::up(
                "ALTER TABLE jams ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));",
            ),
            rusqlite_migration::M::up_with_hook(
                include_str!("migration_v3.sql"),
                crate::migration_v3::migrate,
            )
            .foreign_key_check(),
            rusqlite_migration::M::up(
                "ALTER TABLE ref_items ADD COLUMN metadata TEXT; ALTER TABLE ref_frames ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN (0,1));",
            ),
            rusqlite_migration::M::up(include_str!("migration_v5.sql")),
            rusqlite_migration::M::up(include_str!("migration_v6.sql")),
            rusqlite_migration::M::up(include_str!("migration_v7.sql")),
            rusqlite_migration::M::up(include_str!("migration_v8.sql")),
            rusqlite_migration::M::up(include_str!("migration_v9.sql")).foreign_key_check(),
        ]);
        writer.pragma_update(None, "foreign_keys", "OFF")?;
        let migrated = migrations.to_latest(&mut writer);
        writer.pragma_update(None, "foreign_keys", "ON")?;
        migrated?;
        crate::board_snapshot::install_dirty_tracking(&writer)?;
        let expected_generation =
            writer.query_row("SELECT database_generation FROM board_meta", [], |r| {
                r.get(0)
            })?;
        Ok(Self {
            expected_generation,
            app_data_dir: None,
            connections: Arc::new(Connections {
                writer: Mutex::new(writer),
                readers: [Mutex::new(connect(path)?), Mutex::new(connect(path)?)],
                next_reader: AtomicUsize::new(0),
            }),
            project_id: None,
            path: path.into(),
        })
    }
    pub(crate) fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        self.check_physical_generation()?;
        let i = self.connections.next_reader.fetch_add(1, Ordering::Relaxed) % 2;
        let c = self.connections.readers[i]
            .lock()
            .map_err(|_| invalid("database", "reader lock poisoned"))?;
        // The connection mutex covers context installation and the entire transaction.
        // Every borrower resets it, including unbound readers; no task/thread-local state.
        c.execute(
            "UPDATE temp.jam_project_context SET project_id=?",
            [&self.project_id],
        )?;
        let tx = c.unchecked_transaction()?;
        if self.project_id.is_some() {
            crate::projects::selected_jam(&tx)?;
        }
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }
    pub(crate) fn write<T>(
        &self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        self.write_internal(f, false)
    }
    pub(crate) fn write_control<T>(
        &self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        if self.project_id.is_some() {
            return Err(Error::Forbidden(
                "A bound project cannot change global selection or local connection settings"
                    .into(),
            ));
        }
        self.write_internal(f, true)
    }
    fn write_internal<T>(
        &self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
        control: bool,
    ) -> Result<T> {
        self.check_physical_generation()?;
        let mut c = self
            .connections
            .writer
            .lock()
            .map_err(|_| invalid("database", "writer lock poisoned"))?;
        c.execute(
            "UPDATE temp.jam_project_context SET project_id=?",
            [&self.project_id],
        )?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if self.project_id.is_some() {
            crate::projects::selected_jam(&tx)?;
        }
        if !control {
            crate::project_move::check_writable(&tx)?;
        }
        let value = f(&tx)?;
        tx.commit()?;
        if let Some(folder) = crate::project_folders::folder_for_db(&self.path) {
            crate::board_snapshot::schedule(&folder);
        }
        Ok(value)
    }
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        self.read(|c| {
            Ok(
                c.query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                    r.get(0)
                })
                .optional()?,
            )
        })
    }
    fn check_physical_generation(&self) -> Result<()> {
        if crate::project_folders::folder_for_db(&self.path).is_some() {
            let c = Connection::open_with_flags(
                sqlite_path(&self.path)?,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            let generation: String =
                c.query_row("SELECT database_generation FROM board_meta", [], |r| {
                    r.get(0)
                })?;
            if generation != self.expected_generation {
                return Err(Error::Forbidden("Database was replaced/recovered; reconnect and reconcile the observation baseline".into()));
            }
        }
        Ok(())
    }
    /// Local configuration is metadata, not a jam activity event.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        if self.project_id.is_none() && key.starts_with("mcp_") {
            return self.write_control(|tx| crate::projects::put_setting(tx, key, value));
        }
        self.write(|tx| { tx.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key,value])?; Ok(()) })
    }
    pub fn activity_count(&self) -> Result<i64> {
        self.read(|c| Ok(c.query_row("SELECT count(*) FROM activity", [], |r| r.get(0))?))
    }
    /// Project identity and its activity high-water from one read snapshot.
    /// The cursor is a global sequence value filtered to this exact project, not
    /// a per-project counter or database-generation identifier. A saved wait
    /// cursor may legitimately be larger after scanning foreign events.
    pub fn project_activity_context(&self) -> Result<(Jam, i64)> {
        self.read(project_activity_context)
    }
    pub fn latest_seq(&self) -> Result<i64> {
        self.read(|c| {
            Ok(
                c.query_row("SELECT coalesce(max(seq),0) FROM activity", [], |r| {
                    r.get(0)
                })?,
            )
        })
    }
}

pub struct ChangeFeed {
    pub(crate) connection: Connection,
    pub last_seq: i64,
    data_version: i64,
}
impl ChangeFeed {
    pub fn open(path: impl AsRef<Path>, last_seq: i64) -> Result<Self> {
        let connection = connect(path.as_ref())?;
        let data_version = connection.query_row("PRAGMA data_version", [], |r| r.get(0))?;
        Ok(Self {
            connection,
            last_seq,
            data_version,
        })
    }
    pub fn poll(&mut self) -> Result<Vec<ActivityEvent>> {
        let events = activity(&self.connection, self.last_seq, None, None)?;
        if let Some(last) = events.last() {
            self.last_seq = last.seq;
        }
        Ok(events)
    }
    pub fn data_changed(&mut self) -> Result<bool> {
        let version = self
            .connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))?;
        let changed = version != self.data_version;
        self.data_version = version;
        Ok(changed)
    }
    /// Shared bounded wait for question and activity long-polls. No transaction survives sleep.
    pub(crate) fn wait_until_changed(&mut self, deadline: std::time::Instant) -> Result<bool> {
        std::thread::sleep(
            std::time::Duration::from_millis(250)
                .min(deadline.saturating_duration_since(std::time::Instant::now())),
        );
        self.data_changed()
    }
}

pub(crate) fn activity(
    c: &Connection,
    after: i64,
    task_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<ActivityEvent>> {
    let mut stmt = c.prepare("SELECT a.seq,a.action,m.id,m.kind,m.name,m.handle,m.color,t.key,a.payload,a.created_at,a.epic_id FROM activity a JOIN members m ON m.id=a.actor_id LEFT JOIN tasks t ON t.id=a.task_id WHERE a.seq>?1 AND (?2 IS NULL OR a.task_id=?2) ORDER BY a.seq ASC")?;
    let rows = stmt.query_map(rusqlite::params![after, task_id], activity_row)?;
    let mut events = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    if let Some(limit) = limit {
        let keep = usize::try_from(limit).unwrap_or(0);
        if events.len() > keep {
            events.drain(..events.len() - keep);
        }
    }
    Ok(events)
}

pub(crate) fn activity_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityEvent> {
    let raw: String = r.get(8)?;
    let payload: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let action: String = r.get(1)?;
    let actor_name: String = r.get(4)?;
    let task_key: Option<String> = r.get(7)?;
    let sentence = crate::activity_sentence(&action, &actor_name, task_key.as_deref(), &payload);
    Ok(ActivityEvent {
        seq: r.get(0)?,
        action,
        actor: MemberRef {
            id: r.get(2)?,
            kind: r.get(3)?,
            name: r.get(4)?,
            handle: r.get(5)?,
            color: r.get(6)?,
        },
        task_key,
        payload,
        created_at: r.get(9)?,
        epic_id: r.get(10)?,
        sentence,
    })
}

fn project_activity_context(c: &Connection) -> Result<(Jam, i64)> {
    let project = crate::projects::selected_jam(c)?;
    let cursor = c.query_row(
        "SELECT coalesce(max(seq),0) FROM activity WHERE jam_id=?",
        [&project.id],
        |row| row.get(0),
    )?;
    Ok((project, cursor))
}

#[cfg(test)]
mod context_snapshot_tests {
    use super::*;

    #[test]
    fn identity_and_cursor_share_the_read_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("fictional.db")).unwrap();
        let (project, human) = store
            .create_jam("Fictional snapshot", None, None, None, "UTC", "Human")
            .unwrap();
        let pinned = store.for_project(&project.id).unwrap();
        let before = pinned.project_activity_context().unwrap().1;
        pinned
            .read(|c| {
                // Establish identity in this WAL snapshot, then commit a concurrent
                // writer before the cursor query. Both reads must stay on the old snapshot.
                assert_eq!(crate::projects::selected_jam(c)?.id, project.id);
                pinned.set_status(&human.id, "Committed during snapshot", None)?;
                let (identity, cursor) = project_activity_context(c)?;
                assert_eq!(identity.id, project.id);
                assert_eq!(cursor, before);
                Ok(())
            })
            .unwrap();
        assert!(pinned.project_activity_context().unwrap().1 > before);
    }
}

#[cfg(test)]
mod v9_migration_tests {
    use super::*;
    #[test]
    fn db_folder_writer_and_reader_connections_use_full_durability() {
        let d = tempfile::tempdir().unwrap();
        let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
        let h = m
            .create(&d.path().join("Board"), "Durability fixture", false)
            .unwrap();
        let writer = h.store.connections.writer.lock().unwrap();
        assert_eq!(
            writer
                .pragma_query_value(None, "synchronous", |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        for reader in &h.store.connections.readers {
            assert_eq!(
                reader
                    .lock()
                    .unwrap()
                    .pragma_query_value(None, "synchronous", |r| r.get::<_, i64>(0))
                    .unwrap(),
                2
            );
        }
        crate::storage_io::integrity(&writer).unwrap();
        println!(
            "Bundled SQLite: {} ({})",
            rusqlite::version(),
            rusqlite::version_number()
        );
    }
    #[test]
    fn mv_v8_real_shaped_multi_project_fixture_is_lossless() {
        let d = tempfile::tempdir().unwrap();
        let fixture = Store::open(d.path().join("fixture-generator.db")).unwrap();
        fixture.seed_demo().unwrap();
        let first = fixture.active_jam().unwrap();
        fixture.seed_demo().unwrap();
        let second = fixture.active_jam().unwrap();
        fixture
            .set_setting("provider_secret", "CANARY_V8_SECRET")
            .unwrap();
        fixture
            .set_setting("agent_history_locator", "fictional-private-history-only")
            .unwrap();
        std::fs::create_dir(d.path().join("references")).unwrap();
        let pinned = fixture.for_project(&first.id).unwrap();
        let human = pinned.current_member().unwrap();
        for (name, kind, bytes) in [
            (
                "clipboard-fixture.png",
                "sprite",
                b"managed PNG fixture".as_slice(),
            ),
            (
                "readable-model.blend",
                "other",
                b"managed model fixture".as_slice(),
            ),
        ] {
            let file = d.path().join("references").join(name);
            std::fs::write(&file, bytes).unwrap();
            pinned
                .create_asset(&human.id, kind, name, file.to_str().unwrap(), None)
                .unwrap();
        }
        let external = d.path().join("external-linked.txt");
        std::fs::write(&external, b"linked bytes stay external").unwrap();
        pinned
            .create_asset(
                &human.id,
                "other",
                "Outside linked",
                external.to_str().unwrap(),
                None,
            )
            .unwrap();
        pinned
            .create_asset(
                &human.id,
                "other",
                "Missing linked",
                d.path().join("missing-linked.fbx").to_str().unwrap(),
                None,
            )
            .unwrap();
        let story = pinned.default_task_story(&human.id).unwrap();
        pinned
            .create_task(
                &human.id,
                CreateTask {
                    title: "Scoped idempotent fixture".into(),
                    story_key: Some(story.key),
                    idempotency_key: Some("v8-fixture-idempotency".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let generator = connect(&fixture.path).unwrap();
        generator
            .execute("DELETE FROM activity WHERE seq%5=0", [])
            .unwrap();
        let epic: String = generator
            .query_row(
                "SELECT id FROM epics WHERE jam_id=? ORDER BY id LIMIT 1",
                [&first.id],
                |r| r.get(0),
            )
            .unwrap();
        generator.execute("INSERT INTO execution_states(jam_id,scope_type,scope_id,own_state,revision,changed_by,changed_at) VALUES(?,'epic',?,'running',7,?,?) ON CONFLICT(scope_type,scope_id) DO UPDATE SET own_state='running',revision=7",rusqlite::params![first.id,epic,human.id,now()]).unwrap();
        generator.execute("INSERT INTO execution_requests(id,jam_id,epic_id,scope_type,scope_id,requested_by,reason,status,revision,created_at,resolved_by,resolved_at) VALUES(?,?,?,'epic',?,?,'Fictional historical grant','approved','fixture-r1',?,?,?)",rusqlite::params![id(),first.id,epic,epic,human.id,now(),human.id,now()]).unwrap();
        drop(generator);
        let path = d.path().join("synthetic-v8.db");
        let mut old = connect(&path).unwrap();
        let migrations = rusqlite_migration::Migrations::new(vec![
            rusqlite_migration::M::up(include_str!("migration.sql")),
            rusqlite_migration::M::up(
                "ALTER TABLE jams ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));",
            ),
            rusqlite_migration::M::up_with_hook(
                include_str!("migration_v3.sql"),
                crate::migration_v3::migrate,
            ),
            rusqlite_migration::M::up(
                "ALTER TABLE ref_items ADD COLUMN metadata TEXT; ALTER TABLE ref_frames ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN (0,1));",
            ),
            rusqlite_migration::M::up(include_str!("migration_v5.sql")),
            rusqlite_migration::M::up(include_str!("migration_v6.sql")),
            rusqlite_migration::M::up(include_str!("migration_v7.sql")),
            rusqlite_migration::M::up(include_str!("migration_v8.sql")),
        ]);
        old.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
        migrations.to_latest(&mut old).unwrap();
        assert_eq!(
            old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            8
        );
        let source = connect(&fixture.path).unwrap();
        let tables=old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
        let mut before = std::collections::BTreeMap::new();
        for table in &tables {
            let cols = old
                .prepare(&format!("PRAGMA table_info({table})"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();
            let columns = cols.join(",");
            old.execute(&format!("DELETE FROM {table}"), []).unwrap();
            let mut stmt = source
                .prepare(&format!("SELECT {columns} FROM {table}"))
                .unwrap();
            let rows = stmt
                .query_map([], |r| {
                    (0..cols.len())
                        .map(|i| r.get::<_, rusqlite::types::Value>(i))
                        .collect::<std::result::Result<Vec<_>, _>>()
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();
            for row in rows {
                old.execute(
                    &format!(
                        "INSERT INTO {table}({columns}) VALUES({})",
                        vec!["?"; cols.len()].join(",")
                    ),
                    rusqlite::params_from_iter(row),
                )
                .unwrap();
            }
            before.insert(
                table.clone(),
                (
                    columns.clone(),
                    crate::board_snapshot::rows(&old, table, &columns, "").unwrap(),
                ),
            );
        }
        crate::storage_io::integrity(&old).unwrap();
        drop(old);
        let migrated = Store::open(&path).unwrap();
        let check = connect(&path).unwrap();
        assert_eq!(
            check
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            9
        );
        for (table, (columns, rows)) in before {
            assert_eq!(
                rows,
                crate::board_snapshot::rows(&check, &table, &columns, "").unwrap(),
                "{table}"
            );
        }
        crate::storage_io::integrity(&check).unwrap();
        let m = ProjectManager::new(d.path().join("fictional-appdata")).unwrap();
        let before_second = serde_json::to_string(
            &migrated
                .for_project(&second.id)
                .unwrap()
                .export_jam()
                .unwrap(),
        )
        .unwrap();
        let receipt = m
            .move_project(
                &migrated,
                MoveProject {
                    project_id: first.id.clone(),
                    destination: d.path().join("moved").to_string_lossy().into(),
                    request_id: "multi-project".into(),
                    cloud_acknowledged: false,
                },
            )
            .unwrap();
        assert_eq!(receipt.state, "committed");
        assert_eq!(m.capture_selected().unwrap().project_id, first.id);
        assert_eq!(
            serde_json::to_string(
                &migrated
                    .for_project(&second.id)
                    .unwrap()
                    .export_jam()
                    .unwrap()
            )
            .unwrap(),
            before_second
        );
        let snapshot = std::fs::read_to_string(d.path().join("moved/board.json")).unwrap();
        assert!(!snapshot.contains("CANARY_V8_SECRET"));
        assert!(!snapshot.contains(&second.id));
        assert!(!snapshot.contains("fictional-private-history-only"));
        assert_eq!(receipt.file_hashes.len(), 2);
        let destination_bytes = std::fs::read(d.path().join("moved/.state/board.db")).unwrap();
        assert!(
            !destination_bytes
                .windows(b"CANARY_V8_SECRET".len())
                .any(|w| w == b"CANARY_V8_SECRET")
        );
    }
}
