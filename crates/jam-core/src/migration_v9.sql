-- Additive, identity-preserving folder/file schema. Old binaries are not supported writers.
CREATE TABLE assets_v9(
 id TEXT PRIMARY KEY, jam_id TEXT NOT NULL REFERENCES jams(id),
 kind TEXT NOT NULL CHECK(kind IN ('sprite','audio','level','font','other','model','document')),
 name TEXT NOT NULL, location TEXT NOT NULL, notes TEXT,
 created_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'asset' CHECK(role IN ('asset','reference')),
 storage_type TEXT NOT NULL DEFAULT 'linked_file' CHECK(storage_type IN ('board_file','linked_file','url')),
 path_base TEXT NOT NULL DEFAULT 'absolute', stored_path TEXT NOT NULL DEFAULT '',
 original_name TEXT NOT NULL DEFAULT '', mime_type TEXT, byte_size INTEGER CHECK(byte_size>=0),
 content_hash TEXT, content_revision INTEGER NOT NULL DEFAULT 1 CHECK(content_revision>=1),
 metadata_json TEXT NOT NULL DEFAULT '{"version":1}' CHECK(json_valid(metadata_json)),
 CHECK((storage_type='board_file' AND path_base='board') OR
       (storage_type='linked_file' AND path_base IN ('repo','absolute')) OR
       (storage_type='url' AND path_base='url'))
);
INSERT INTO assets_v9(id,jam_id,kind,name,location,notes,created_by,created_at,role,storage_type,path_base,stored_path,original_name)
 SELECT id,jam_id,kind,name,location,notes,created_by,created_at,role,
 CASE WHEN location LIKE 'https://%' OR location LIKE 'http://%' THEN 'url' ELSE 'linked_file' END,
 CASE WHEN location LIKE 'https://%' OR location LIKE 'http://%' THEN 'url' ELSE 'absolute' END,location,name FROM assets;
DROP TABLE assets;
ALTER TABLE assets_v9 RENAME TO assets;
ALTER TABLE task_assets ADD COLUMN role TEXT NOT NULL DEFAULT 'reference' CHECK(role IN ('to_edit','reference','result'));
ALTER TABLE task_assets ADD COLUMN position REAL NOT NULL DEFAULT 0;
ALTER TABLE task_assets ADD COLUMN created_by TEXT REFERENCES members(id);
ALTER TABLE task_assets ADD COLUMN created_at TEXT;
ALTER TABLE jams ADD COLUMN moved_to TEXT;
ALTER TABLE jams ADD COLUMN migration_id TEXT;
CREATE TABLE file_operations(
 project_id TEXT NOT NULL REFERENCES jams(id), actor_id TEXT NOT NULL REFERENCES members(id),
 request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, state TEXT NOT NULL,
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,actor_id,request_id)
);
CREATE TABLE asset_components(asset_id TEXT NOT NULL REFERENCES assets(id), relative_uri TEXT NOT NULL,
 component_asset_id TEXT NOT NULL REFERENCES assets(id), PRIMARY KEY(asset_id,relative_uri));
CREATE TABLE task_presentation(task_id TEXT PRIMARY KEY REFERENCES tasks(id), cover_asset_id TEXT REFERENCES assets(id),
 cover_mode TEXT NOT NULL DEFAULT 'contain', metadata_json TEXT NOT NULL DEFAULT '{"version":1}' CHECK(json_valid(metadata_json)));
CREATE TABLE file_previews(asset_id TEXT NOT NULL REFERENCES assets(id), variant TEXT NOT NULL,
 source_fingerprint TEXT NOT NULL, renderer_version TEXT NOT NULL, status TEXT NOT NULL,
 cache_relative_path TEXT, error_code TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(asset_id,variant));
CREATE TABLE work_contexts(id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), member_id TEXT REFERENCES members(id),
 agent_session_id TEXT, cwd TEXT NOT NULL, repo_common_dir TEXT, repo_root TEXT, worktree_root TEXT,
 branch TEXT, head_oid TEXT, captured_at TEXT NOT NULL, source TEXT NOT NULL,
 metadata_json TEXT NOT NULL DEFAULT '{"version":1}' CHECK(json_valid(metadata_json)));
ALTER TABLE tasks ADD COLUMN preferred_work_context_id TEXT REFERENCES work_contexts(id);
ALTER TABLE tasks ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{"version":1}' CHECK(json_valid(metadata_json));
CREATE TABLE board_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), instance_id TEXT NOT NULL,
 database_generation TEXT NOT NULL, board_revision INTEGER NOT NULL DEFAULT 0, published_revision INTEGER NOT NULL DEFAULT -1,
 snapshot_hash TEXT, manifest_hash TEXT, dirty_since TEXT, last_error TEXT, backup_revision INTEGER NOT NULL DEFAULT -1, backup_at TEXT);
INSERT INTO board_meta(singleton,instance_id,database_generation) VALUES(1,lower(hex(randomblob(16))),lower(hex(randomblob(16))));
CREATE TABLE project_moves(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES jams(id),state TEXT NOT NULL,
 destination TEXT NOT NULL, receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),created_at TEXT NOT NULL);
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
