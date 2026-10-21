ALTER TABLE jams ADD COLUMN template TEXT NOT NULL DEFAULT 'game_jam' CHECK(template IN ('game_jam','gamedev','webapp','custom'));
ALTER TABLE jams ADD COLUMN milestone_at TEXT;
ALTER TABLE jams ADD COLUMN epic_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jams ADD COLUMN story_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN status_text TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN status_scope_json TEXT;
ALTER TABLE members ADD COLUMN status_at TEXT;
ALTER TABLE assets ADD COLUMN role TEXT NOT NULL DEFAULT 'asset' CHECK(role IN ('asset','reference'));
CREATE TABLE epics(
 id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),key TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 140),color TEXT NOT NULL CHECK(color IN ('m1','m2','m3','m4','m5','m6')),
 status TEXT NOT NULL CHECK(status IN ('draft','active','done','archived')),
 goal_md TEXT NOT NULL DEFAULT '',done_when_md TEXT NOT NULL DEFAULT '',not_included_md TEXT NOT NULL DEFAULT '',
 decided_md TEXT NOT NULL DEFAULT '',open_questions_md TEXT NOT NULL DEFAULT '',
 participation TEXT NOT NULL DEFAULT 'first_sketch' CHECK(participation IN ('each_iteration','first_sketch','autonomous')),
 reviewer TEXT NOT NULL DEFAULT 'none' CHECK(reviewer IN ('none','final','stages')),worker_model TEXT,
 brain_member_id TEXT REFERENCES members(id),position REAL NOT NULL,created_by TEXT NOT NULL REFERENCES members(id),
 updated_by TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT);
CREATE TABLE stories(
 id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),key TEXT UNIQUE NOT NULL,epic_id TEXT NOT NULL REFERENCES epics(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 140),status TEXT NOT NULL CHECK(status IN ('draft','active','done','archived')),
 outcome_md TEXT NOT NULL DEFAULT '',basis_md TEXT NOT NULL DEFAULT '',preserve_md TEXT NOT NULL DEFAULT '',scale_md TEXT NOT NULL DEFAULT '',
 rejection_risks_md TEXT NOT NULL DEFAULT '',open_decisions_md TEXT NOT NULL DEFAULT '',acceptance_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(acceptance_json)),
 position REAL NOT NULL,created_by TEXT NOT NULL REFERENCES members(id),updated_by TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT);
CREATE TABLE tasks_v3(
 id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),key TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 140),description_md TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('backlog','ready','in_progress','review','done')),
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
 estimate INTEGER CHECK(estimate IN (1,2,3,5,8)),due_at TEXT,position REAL NOT NULL,assignee_id TEXT REFERENCES members(id),
 created_by TEXT NOT NULL REFERENCES members(id),updated_by TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 archived_at TEXT,idempotency_key TEXT,story_id TEXT NOT NULL REFERENCES stories(id),
 goal_md TEXT NOT NULL DEFAULT '',context_md TEXT NOT NULL DEFAULT '',where_md TEXT NOT NULL DEFAULT '',
 changes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(changes_json)),tests_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tests_json)),
 boundaries_md TEXT NOT NULL DEFAULT '',result_md TEXT NOT NULL DEFAULT '',user_quotes_md TEXT NOT NULL DEFAULT '',
 changes_requested INTEGER NOT NULL DEFAULT 0 CHECK(changes_requested IN(0,1)),review_round INTEGER NOT NULL DEFAULT 0 CHECK(review_round>=0),
 UNIQUE(created_by,idempotency_key));
CREATE TABLE reports(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),round INTEGER NOT NULL,author_id TEXT NOT NULL REFERENCES members(id),
 summary_md TEXT NOT NULL,changed_files_json TEXT NOT NULL CHECK(json_valid(changed_files_json)),tests_json TEXT NOT NULL CHECK(json_valid(tests_json)),
 deviations_md TEXT NOT NULL,not_verified_md TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(task_id,round));
CREATE TABLE reviews(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),round INTEGER NOT NULL,reviewer_id TEXT NOT NULL REFERENCES members(id),
 verdict TEXT NOT NULL CHECK(verdict IN ('accept','changes_requested')),comments_md TEXT NOT NULL,failed_tests_json TEXT NOT NULL CHECK(json_valid(failed_tests_json)),
 created_at TEXT NOT NULL,UNIQUE(task_id,round));
CREATE TABLE questions(id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),epic_id TEXT REFERENCES epics(id),
 scope_type TEXT NOT NULL CHECK(scope_type IN ('project','epic','story','task')),scope_id TEXT NOT NULL,
 asked_by TEXT NOT NULL REFERENCES members(id),round_label TEXT,title TEXT NOT NULL,body_md TEXT NOT NULL,
 options_json TEXT NOT NULL CHECK(json_valid(options_json)),recommended_index INTEGER,allow_free_text INTEGER NOT NULL DEFAULT 1 CHECK(allow_free_text IN(0,1)),
 status TEXT NOT NULL CHECK(status IN ('open','answered','withdrawn')),answer_index INTEGER,answer_text TEXT,answered_by TEXT REFERENCES members(id),answered_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX questions_scope ON questions(jam_id,scope_type,scope_id,status);
ALTER TABLE activity ADD COLUMN epic_id TEXT REFERENCES epics(id);
CREATE INDEX epic_journal ON activity(epic_id,seq);
CREATE TABLE ref_frames(id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),epic_id TEXT REFERENCES epics(id),title TEXT NOT NULL,
 x REAL NOT NULL,y REAL NOT NULL,w REAL NOT NULL,h REAL NOT NULL,color TEXT NOT NULL,archived_at TEXT);
CREATE TABLE ref_items(id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),kind TEXT NOT NULL CHECK(kind IN ('asset','link','note')),
 asset_id TEXT REFERENCES assets(id),url TEXT,link_preview TEXT,title TEXT NOT NULL,caption_md TEXT NOT NULL,tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
 x REAL NOT NULL,y REAL NOT NULL,w REAL NOT NULL,h REAL NOT NULL,z REAL NOT NULL,frame_id TEXT REFERENCES ref_frames(id),position REAL NOT NULL,
 created_by TEXT NOT NULL REFERENCES members(id),updated_by TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT);
CREATE TABLE ref_edges(id TEXT PRIMARY KEY,jam_id TEXT NOT NULL REFERENCES jams(id),from_item TEXT NOT NULL REFERENCES ref_items(id),
 to_item TEXT NOT NULL REFERENCES ref_items(id),label TEXT NOT NULL,archived_at TEXT);
CREATE TABLE ref_links(item_id TEXT NOT NULL REFERENCES ref_items(id),target_type TEXT NOT NULL CHECK(target_type IN ('epic','story','task')),
 target_id TEXT NOT NULL,archived_at TEXT,PRIMARY KEY(item_id,target_type,target_id));
