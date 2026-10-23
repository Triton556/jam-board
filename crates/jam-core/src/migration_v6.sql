-- No existing/imported planning state grants execution. Missing rows mean
-- paused epics and inheriting stories; in-flight task evidence stays intact.
CREATE TABLE execution_states (
  jam_id TEXT NOT NULL REFERENCES jams(id),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('epic','story')),
  scope_id TEXT NOT NULL,
  own_state TEXT NOT NULL CHECK(own_state IN ('inherit','running','paused')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  changed_by TEXT NOT NULL REFERENCES members(id),
  changed_at TEXT NOT NULL,
  PRIMARY KEY(scope_type,scope_id),
  CHECK(scope_type!='epic' OR own_state!='inherit')
);
CREATE INDEX execution_project ON execution_states(jam_id,scope_type);
CREATE TABLE execution_requests (
  id TEXT PRIMARY KEY,
  jam_id TEXT NOT NULL REFERENCES jams(id),
  epic_id TEXT NOT NULL REFERENCES epics(id),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('epic','story')),
  scope_id TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES members(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','declined','superseded')),
  revision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES members(id),
  resolved_at TEXT
);
CREATE UNIQUE INDEX execution_request_pending ON execution_requests(jam_id,scope_type,scope_id) WHERE status='pending';
CREATE INDEX execution_request_inbox ON execution_requests(jam_id,status,created_at);
