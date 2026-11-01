-- Lossless v9 -> v10. Foreign keys are checked by the migration runner.
ALTER TABLE epics ADD COLUMN external_ref TEXT;
ALTER TABLE stories ADD COLUMN external_ref TEXT;
ALTER TABLE tasks ADD COLUMN external_ref TEXT;
CREATE UNIQUE INDEX epics_external_ref ON epics(jam_id,external_ref) WHERE external_ref IS NOT NULL;
CREATE UNIQUE INDEX stories_external_ref ON stories(jam_id,external_ref) WHERE external_ref IS NOT NULL;
CREATE UNIQUE INDEX tasks_external_ref ON tasks(jam_id,external_ref) WHERE external_ref IS NOT NULL;
CREATE TABLE external_sync(
 jam_id TEXT NOT NULL REFERENCES jams(id),entity_type TEXT NOT NULL CHECK(entity_type IN ('epic','story','task')),
 entity_id TEXT NOT NULL,external_ref TEXT NOT NULL,imported_hash TEXT NOT NULL,imported_updated_at TEXT NOT NULL,
 batch_id TEXT,PRIMARY KEY(entity_type,entity_id));
CREATE TABLE import_batches(
 id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),actor_id TEXT NOT NULL REFERENCES members(id),
 request_id TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('mcp','ui')),summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
 created_at TEXT NOT NULL,undone_at TEXT,undone_by TEXT REFERENCES members(id));
CREATE TABLE import_batch_items(
 batch_id TEXT NOT NULL REFERENCES import_batches(id),seq INTEGER NOT NULL,entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('created','updated','moved')),
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),after_updated_at TEXT NOT NULL,
 PRIMARY KEY(batch_id,seq));
CREATE TABLE write_receipts(
 jam_id TEXT NOT NULL REFERENCES jams(id),actor_id TEXT NOT NULL REFERENCES members(id),request_id TEXT NOT NULL,
 tool TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),created_at TEXT NOT NULL,
 PRIMARY KEY(jam_id,actor_id,tool,request_id));
INSERT INTO write_receipts(jam_id,actor_id,request_id,tool,payload_hash,result_json,created_at)
 SELECT i.jam_id,i.actor_id,i.token,'create_task','legacy',json_object('key',t.key,'id',t.id),t.created_at
 FROM task_idempotency i JOIN tasks t ON t.id=i.task_id;
-- v9 did not persist an operation discriminator. Preserve its exact tuple hash
-- and full result under the brain's historical fallback namespace. Non-final
-- rows and the historical table remain intact for recovery/cancellation.
INSERT INTO write_receipts(jam_id,actor_id,request_id,tool,payload_hash,result_json,created_at)
 SELECT project_id,actor_id,request_id,'file_legacy',payload_hash,result_json,created_at
 FROM file_operations WHERE state='committed';
ALTER TABLE task_tags ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
-- v9's rowid is its only surviving record of insertion order.
UPDATE task_tags SET position=(SELECT count(*) FROM task_tags earlier
 WHERE earlier.task_id=task_tags.task_id AND earlier.rowid<task_tags.rowid);
ALTER TABLE activity ADD COLUMN client TEXT;
DROP TRIGGER IF EXISTS task_cover_project_insert;
DROP TRIGGER IF EXISTS task_cover_project_update;
CREATE TABLE assets_v10(
 id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),
 kind TEXT NOT NULL CHECK(kind IN ('sprite','audio','video','level','font','other','model','document')),
 name TEXT NOT NULL,location TEXT NOT NULL,notes TEXT,
 created_by TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'asset' CHECK(role IN ('asset','reference')),
 storage_type TEXT NOT NULL DEFAULT 'linked_file' CHECK(storage_type IN ('board_file','linked_file','url')),
 path_base TEXT NOT NULL DEFAULT 'absolute',stored_path TEXT NOT NULL DEFAULT '',original_name TEXT NOT NULL DEFAULT '',
 mime_type TEXT,byte_size INTEGER CHECK(byte_size>=0),content_hash TEXT,
 content_revision INTEGER NOT NULL DEFAULT 1 CHECK(content_revision>=1),
 metadata_json TEXT NOT NULL DEFAULT '{"version":1}' CHECK(json_valid(metadata_json)),
 archived_at TEXT,archived_by TEXT REFERENCES members(id),
 CHECK((storage_type='board_file' AND path_base='board') OR
 (storage_type='linked_file' AND path_base IN ('repo','absolute')) OR (storage_type='url' AND path_base='url')));
INSERT INTO assets_v10(id,jam_id,kind,name,location,notes,created_by,created_at,role,storage_type,path_base,stored_path,original_name,mime_type,byte_size,content_hash,content_revision,metadata_json)
 SELECT id,jam_id,kind,name,location,notes,created_by,created_at,role,storage_type,path_base,stored_path,original_name,mime_type,byte_size,content_hash,content_revision,metadata_json FROM assets;
DROP TABLE assets;
ALTER TABLE assets_v10 RENAME TO assets;
CREATE TRIGGER task_cover_project_insert BEFORE INSERT ON task_presentation WHEN NEW.cover_asset_id IS NOT NULL BEGIN
 SELECT CASE WHEN (SELECT jam_id FROM assets WHERE id=NEW.cover_asset_id)!=(SELECT jam_id FROM tasks WHERE id=NEW.task_id)
 THEN RAISE(ABORT,'cover belongs to another project') END; END;
CREATE TRIGGER task_cover_project_update BEFORE UPDATE ON task_presentation WHEN NEW.cover_asset_id IS NOT NULL BEGIN
 SELECT CASE WHEN (SELECT jam_id FROM assets WHERE id=NEW.cover_asset_id)!=(SELECT jam_id FROM tasks WHERE id=NEW.task_id)
 THEN RAISE(ABORT,'cover belongs to another project') END; END;
CREATE TRIGGER assets_legacy_storage_insert AFTER INSERT ON assets WHEN NEW.stored_path='' BEGIN
 UPDATE assets SET stored_path=NEW.location,original_name=NEW.name,
 storage_type=CASE WHEN NEW.location LIKE 'https://%' OR NEW.location LIKE 'http://%' THEN 'url' ELSE NEW.storage_type END,
 path_base=CASE WHEN NEW.location LIKE 'https://%' OR NEW.location LIKE 'http://%' THEN 'url' ELSE NEW.path_base END WHERE id=NEW.id;
END;
CREATE TABLE asset_revisions(
 asset_id TEXT NOT NULL REFERENCES assets(id),revision INTEGER NOT NULL,stored_path TEXT NOT NULL,
 byte_size INTEGER,content_hash TEXT,mime_type TEXT,created_by TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,
 PRIMARY KEY(asset_id,revision));
CREATE TABLE scope_files(
 id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),asset_id TEXT NOT NULL REFERENCES assets(id),
 target_type TEXT NOT NULL CHECK(target_type IN ('project','epic','story')),target_id TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'document' CHECK(role IN ('document','reference')),position REAL NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,UNIQUE(target_type,target_id,asset_id));
-- The runner recreates these with the v10 column allowlists.
DROP TRIGGER IF EXISTS dirty_epics_UPDATE;
DROP TRIGGER IF EXISTS dirty_stories_UPDATE;
DROP TRIGGER IF EXISTS dirty_tasks_UPDATE;
DROP TRIGGER IF EXISTS dirty_task_tags_UPDATE;
DROP TRIGGER IF EXISTS dirty_activity_UPDATE;

-- Round 12 moodboard feedback and Inbox read cursor (unreleased v10).
ALTER TABLE ref_items ADD COLUMN verdict_note TEXT CHECK(verdict_note IS NULL OR length(verdict_note) BETWEEN 1 AND 500);
ALTER TABLE ref_items ADD COLUMN source_url TEXT CHECK(source_url IS NULL OR length(source_url) BETWEEN 1 AND 2048);
ALTER TABLE ref_items ADD COLUMN origin TEXT CHECK(origin IS NULL OR origin IN ('found','generated','own'));
ALTER TABLE ref_items ADD COLUMN derived_from TEXT REFERENCES ref_items(id);
ALTER TABLE ref_items ADD COLUMN copied_from TEXT REFERENCES ref_items(id);
CREATE INDEX ref_items_derived_from ON ref_items(derived_from) WHERE derived_from IS NOT NULL;
ALTER TABLE ref_frames ADD COLUMN review_sent_at TEXT;
ALTER TABLE ref_frames ADD COLUMN review_sent_by TEXT REFERENCES members(id);
ALTER TABLE ref_frames ADD COLUMN review_hash TEXT;
ALTER TABLE project_members ADD COLUMN inbox_seen_seq INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER IF EXISTS dirty_ref_items_UPDATE;
DROP TRIGGER IF EXISTS dirty_ref_frames_UPDATE;
