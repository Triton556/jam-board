//! Remove only v9 additions before historical tests reconstruct an older fixture.
pub fn strip(c: &rusqlite::Connection) {
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let dirty = c
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'dirty_%'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    for name in dirty {
        c.execute_batch(&format!("DROP TRIGGER {name}")).unwrap();
    }
    c.execute_batch(
        "DROP INDEX ref_items_derived_from;
ALTER TABLE ref_items DROP COLUMN verdict_note;
ALTER TABLE ref_items DROP COLUMN source_url;
ALTER TABLE ref_items DROP COLUMN origin;
ALTER TABLE ref_items DROP COLUMN derived_from;
ALTER TABLE ref_items DROP COLUMN copied_from;
ALTER TABLE ref_frames DROP COLUMN review_sent_at;
ALTER TABLE ref_frames DROP COLUMN review_sent_by;
ALTER TABLE ref_frames DROP COLUMN review_hash;
ALTER TABLE project_members DROP COLUMN inbox_seen_seq;",
    )
    .unwrap();
    c.execute_batch("DROP TABLE IF EXISTS scope_files;DROP TABLE IF EXISTS asset_revisions;DROP TABLE IF EXISTS import_batch_items;DROP TABLE IF EXISTS import_batches;DROP TABLE IF EXISTS external_sync;DROP TABLE IF EXISTS write_receipts;DROP INDEX IF EXISTS epics_external_ref;DROP INDEX IF EXISTS stories_external_ref;DROP INDEX IF EXISTS tasks_external_ref;ALTER TABLE epics DROP COLUMN external_ref;ALTER TABLE stories DROP COLUMN external_ref;ALTER TABLE tasks DROP COLUMN external_ref;ALTER TABLE task_tags DROP COLUMN position;ALTER TABLE activity DROP COLUMN client;ALTER TABLE assets DROP COLUMN archived_at;ALTER TABLE assets DROP COLUMN archived_by;").unwrap();
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
