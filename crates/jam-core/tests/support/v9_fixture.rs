//! Remove only v9 additions before historical tests reconstruct an older fixture.
pub fn strip(c: &rusqlite::Connection) {
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    c.execute_batch("DROP TRIGGER IF EXISTS assets_legacy_storage_insert;")
        .unwrap();
    let triggers=c.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'dirty_%' OR name LIKE 'task_cover_project_%')").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
    for name in triggers {
        c.execute_batch(&format!("DROP TRIGGER {name}")).unwrap();
    }
    c.execute_batch("ALTER TABLE tasks DROP COLUMN preferred_work_context_id; ALTER TABLE tasks DROP COLUMN metadata_json;
ALTER TABLE task_assets DROP COLUMN role;ALTER TABLE task_assets DROP COLUMN position;ALTER TABLE task_assets DROP COLUMN created_by;ALTER TABLE task_assets DROP COLUMN created_at;
ALTER TABLE jams DROP COLUMN moved_to;ALTER TABLE jams DROP COLUMN migration_id;
DROP TABLE file_operations;DROP TABLE asset_components;DROP TABLE task_presentation;DROP TABLE file_previews;DROP TABLE work_contexts;DROP TABLE board_meta;DROP TABLE project_moves;").unwrap();
}
