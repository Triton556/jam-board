use crate::*;
use rusqlite::{Connection, OptionalExtension};
use std::{
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

pub struct Store {
    pub(crate) writer: Mutex<Connection>,
    readers: [Mutex<Connection>; 2],
    next_reader: AtomicUsize,
    pub path: PathBuf,
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
    let c = Connection::open(path)?;
    c.busy_timeout(std::time::Duration::from_millis(5000))?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")?;
    Ok(c)
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
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
        ]);
        writer.pragma_update(None, "foreign_keys", "OFF")?;
        let migrated = migrations.to_latest(&mut writer);
        writer.pragma_update(None, "foreign_keys", "ON")?;
        migrated?;
        Ok(Self {
            writer: Mutex::new(writer),
            readers: [Mutex::new(connect(path)?), Mutex::new(connect(path)?)],
            next_reader: AtomicUsize::new(0),
            path: path.into(),
        })
    }
    pub(crate) fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let i = self.next_reader.fetch_add(1, Ordering::Relaxed) % 2;
        let c = self.readers[i]
            .lock()
            .map_err(|_| invalid("database", "reader lock poisoned"))?;
        let tx = c.unchecked_transaction()?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }
    pub(crate) fn write<T>(
        &self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        let mut c = self
            .writer
            .lock()
            .map_err(|_| invalid("database", "writer lock poisoned"))?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        tx.commit()?;
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
    /// Local configuration is metadata, not a jam activity event.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.write(|tx| { tx.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key,value])?; Ok(()) })
    }
    pub fn activity_count(&self) -> Result<i64> {
        self.read(|c| Ok(c.query_row("SELECT count(*) FROM activity", [], |r| r.get(0))?))
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
