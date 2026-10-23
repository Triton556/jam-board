-- Projects share identity profiles, not active selection, presence or status.
CREATE TABLE project_members (
  jam_id TEXT NOT NULL REFERENCES jams(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  last_seen_at TEXT,
  status_text TEXT NOT NULL DEFAULT '',
  status_scope_json TEXT,
  status_at TEXT,
  PRIMARY KEY (jam_id, member_id)
);
INSERT OR IGNORE INTO project_members(jam_id, member_id)
SELECT jam_id, actor_id FROM activity WHERE jam_id IS NOT NULL;
INSERT OR IGNORE INTO project_members(jam_id, member_id)
SELECT jam_id, json_extract(payload, '$.memberId') FROM activity
WHERE jam_id IS NOT NULL AND action='member.joined'
AND json_extract(payload, '$.memberId') IN (SELECT id FROM members);
INSERT OR IGNORE INTO project_members(jam_id, member_id)
SELECT jam_id, created_by FROM tasks UNION SELECT jam_id, updated_by FROM tasks
UNION SELECT jam_id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL;
INSERT OR IGNORE INTO project_members(jam_id, member_id)
SELECT jam_id, brain_member_id FROM epics WHERE brain_member_id IS NOT NULL;
INSERT OR IGNORE INTO settings(key, value)
SELECT 'current_project_id', id FROM jams WHERE archived=0 ORDER BY created_at DESC,id DESC LIMIT 1;
INSERT OR IGNORE INTO settings(key, value)
SELECT 'project.' || j.id || '.current_member_id', s.value FROM jams j JOIN settings s ON s.key='current_member_id'
WHERE j.id=(SELECT value FROM settings WHERE key='current_project_id');
-- Legacy presence had no project. Retain it only on the formerly active project.
UPDATE project_members SET
  last_seen_at=(SELECT last_seen_at FROM members WHERE id=member_id),
  status_text=(SELECT status_text FROM members WHERE id=member_id),
  status_scope_json=(SELECT status_scope_json FROM members WHERE id=member_id),
  status_at=(SELECT status_at FROM members WHERE id=member_id)
WHERE jam_id=(SELECT value FROM settings WHERE key='current_project_id');

-- The old canvas preference belonged to the formerly selected board only.
INSERT OR IGNORE INTO settings(key,value)
SELECT 'canvas_viewport:' || p.value || ':' || substr(s.key,17), s.value
FROM settings s JOIN settings p ON p.key='current_project_id'
WHERE s.key LIKE 'canvas_viewport:%';

-- Idempotency belongs to a project, even when an agent profile is reused.
-- Keep the legacy tasks column untouched for backwards data preservation; new
-- writes use this additive mapping instead of its global UNIQUE constraint.
CREATE TABLE task_idempotency (
  jam_id TEXT NOT NULL REFERENCES jams(id),
  actor_id TEXT NOT NULL REFERENCES members(id),
  token TEXT NOT NULL,
  task_id TEXT UNIQUE NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (jam_id, actor_id, token)
);
INSERT INTO task_idempotency(jam_id,actor_id,token,task_id)
SELECT jam_id,created_by,idempotency_key,id FROM tasks WHERE idempotency_key IS NOT NULL;
