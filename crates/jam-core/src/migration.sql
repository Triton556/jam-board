CREATE TABLE jams(id TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, starts_at TEXT, ends_at TEXT, timezone TEXT NOT NULL,
 task_seq INTEGER NOT NULL DEFAULT 0, key_prefix TEXT NOT NULL DEFAULT 'JB', created_at TEXT NOT NULL);
CREATE TABLE members(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('human','agent')), name TEXT NOT NULL,
 handle TEXT UNIQUE NOT NULL, color TEXT NOT NULL, avatar TEXT, client TEXT, last_seen_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE tasks(id TEXT PRIMARY KEY, jam_id TEXT NOT NULL REFERENCES jams(id), key TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 140), description_md TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('backlog','todo','in_progress','review','done')),
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
 estimate INTEGER CHECK(estimate IN (1,2,3,5,8)), due_at TEXT, position REAL NOT NULL,
 assignee_id TEXT REFERENCES members(id), created_by TEXT NOT NULL REFERENCES members(id), updated_by TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, idempotency_key TEXT,
 UNIQUE(created_by,idempotency_key));
CREATE TABLE task_tags(task_id TEXT NOT NULL REFERENCES tasks(id), tag TEXT NOT NULL CHECK(tag=lower(tag) AND length(tag)<=24), PRIMARY KEY(task_id,tag));
CREATE TABLE assets(id TEXT PRIMARY KEY, jam_id TEXT NOT NULL REFERENCES jams(id), kind TEXT NOT NULL CHECK(kind IN ('sprite','audio','level','font','other')),
 name TEXT NOT NULL, location TEXT NOT NULL, notes TEXT, created_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL);
CREATE TABLE task_assets(task_id TEXT NOT NULL REFERENCES tasks(id), asset_id TEXT NOT NULL REFERENCES assets(id), PRIMARY KEY(task_id,asset_id));
CREATE TABLE comments(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), author_id TEXT NOT NULL REFERENCES members(id), body_md TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE activity(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, jam_id TEXT REFERENCES jams(id), actor_id TEXT NOT NULL REFERENCES members(id),
 action TEXT NOT NULL, task_id TEXT REFERENCES tasks(id), payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX tasks_column ON tasks(jam_id,status,position);
CREATE INDEX tasks_assignee ON tasks(assignee_id);
CREATE INDEX activity_feed ON activity(jam_id,seq);
INSERT INTO settings VALUES ('mcp_http_enabled','true'),('mcp_http_port','47321'),('theme','system');
