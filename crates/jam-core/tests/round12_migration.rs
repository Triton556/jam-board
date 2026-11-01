use jam_core::*;
use rusqlite::{Connection, params};
use std::collections::BTreeMap;
use std::path::Path;

fn v9(path: &Path) -> Connection {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let c = Connection::open(path).unwrap();
    c.execute_batch(include_str!("../src/migration.sql"))
        .unwrap();
    c.execute_batch(
        "ALTER TABLE jams ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));",
    )
    .unwrap();
    c.execute_batch(include_str!("../src/migration_v3.sql"))
        .unwrap();
    // The historical Rust v3 hook replaces this empty table after moving legacy tasks.
    c.execute_batch("DROP TABLE tasks; ALTER TABLE tasks_v3 RENAME TO tasks;")
        .unwrap();
    c.execute_batch("ALTER TABLE ref_items ADD COLUMN metadata TEXT; ALTER TABLE ref_frames ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN (0,1));").unwrap();
    for migration in [
        include_str!("../src/migration_v5.sql"),
        include_str!("../src/migration_v6.sql"),
        include_str!("../src/migration_v7.sql"),
        include_str!("../src/migration_v8.sql"),
        include_str!("../src/migration_v9.sql"),
    ] {
        c.execute_batch(migration).unwrap();
    }
    c.execute_batch("PRAGMA user_version=9; PRAGMA foreign_keys=ON;
INSERT INTO jams(id,name,timezone,key_prefix,created_at,epic_seq,story_seq,task_seq) VALUES('j','Little Stones','UTC','JB','2026-10-31T00:00:00Z',58,143,192);
INSERT INTO members(id,kind,name,handle,color,created_at) VALUES('h','human','Human','human','#5B8DEF','2026-10-31T00:00:00Z');
INSERT INTO project_members(jam_id,member_id) VALUES('j','h');
INSERT INTO settings(key,value) VALUES('current_project_id','j'),('current_member_id','h'),('project.j.current_member_id','h');").unwrap();
    for i in 0..58 {
        c.execute("INSERT INTO epics(id,jam_id,key,title,color,status,position,created_by,updated_by,created_at,updated_at) VALUES(?,'j',?,?,'m1','draft',?,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')",params![format!("e{i}"),format!("JB-E{}",i+1),format!("Эпик — {i} 🪨"),i]).unwrap();
    }
    for i in 0..143 {
        c.execute("INSERT INTO stories(id,jam_id,key,epic_id,title,status,position,created_by,updated_by,created_at,updated_at) VALUES(?,'j',?, ?,?,'draft',?,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')",params![format!("s{i}"),format!("JB-S{}",i+1),format!("e{}",i%58),format!("Story {i}"),i]).unwrap();
    }
    for i in 0..192 {
        c.execute("INSERT INTO tasks(id,jam_id,key,story_id,title,status,position,created_by,updated_by,created_at,updated_at) VALUES(?,'j',?,?,?,'backlog',?,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')",params![format!("t{i}"),format!("JB-{}",i+1),format!("s{}",i%143),format!("Task {i}"),i]).unwrap();
    }
    for tag in ["size-m", "design", "alpha"] {
        c.execute("INSERT INTO task_tags(task_id,tag) VALUES('t0',?)", [tag])
            .unwrap();
    }
    c.execute_batch("INSERT INTO task_idempotency(jam_id,actor_id,token,task_id) VALUES('j','h','old-task','t0'),('j','h','old-unlinked-task','t1');
INSERT INTO assets(id,jam_id,kind,name,location,created_by,created_at,storage_type,path_base,stored_path,original_name,metadata_json) VALUES
('a0','j','document','Plan.md','files/Plan.md','h','2026-10-31T00:00:00Z','board_file','board','files/Plan.md','Plan.md','{\"version\":1}'),
('a1','j','model','Stone.glb','files/Stone.glb','h','2026-10-31T00:00:00Z','board_file','board','files/Stone.glb','Stone.glb','{\"version\":1}'),
('a2','j','document','Linked.md','docs/Linked.md','h','2026-10-31T00:00:00Z','linked_file','repo','docs/Linked.md','Linked.md','{\"version\":1}'),
('a3','j','other','URL','https://example.test','h','2026-10-31T00:00:00Z','url','url','https://example.test','URL','{\"version\":1}');
INSERT INTO task_assets(task_id,asset_id,role,position,created_by,created_at) VALUES('t0','a0','reference',1024,'h','2026-10-31T00:00:00Z');
INSERT INTO task_presentation(task_id,cover_asset_id) VALUES('t0','a1');
INSERT INTO asset_components VALUES('a1','plan.md','a0');
INSERT INTO file_operations VALUES('j','h','old-file','old-hash','committed','{\"operationId\":\"old-file\"}','2026-10-31T00:00:00Z');").unwrap();
    c.execute_batch("INSERT INTO ref_frames(id,jam_id,title,x,y,w,h,color) VALUES('frame','j','Old frame',0,0,800,600,'m1');
INSERT INTO ref_items(id,jam_id,kind,title,caption_md,tags_json,x,y,w,h,z,frame_id,position,created_by,updated_by,created_at,updated_at,verdict) VALUES('ref','j','link','Old ref','Source in caption','[]',24,56,240,180,0,'frame',1,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z','keep');").unwrap();
    c
}

fn counts(c: &Connection) -> BTreeMap<String, i64> {
    c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().map(|name| {
        let name = name.unwrap();
        let count = c.query_row(&format!("SELECT count(*) FROM {name}"),[],|r|r.get(0)).unwrap();
        (name,count)
    }).collect()
}

fn migrate_fixture(folder: bool) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(if folder {
        "Board/.state/board.db"
    } else {
        "fictional-appdata/jam.db"
    });
    let c = v9(&path);
    let before = counts(&c);
    drop(c);
    let store = Store::open(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    let after = counts(&c);
    assert_eq!(
        c.query_row(
            "SELECT inbox_seen_seq FROM project_members WHERE member_id='h'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(c.query_row("SELECT count(*) FROM ref_items WHERE id='ref' AND title='Old ref' AND caption_md='Source in caption' AND verdict='keep' AND verdict_note IS NULL AND source_url IS NULL AND origin IS NULL AND derived_from IS NULL AND copied_from IS NULL", [], |r|r.get::<_,i64>(0)).unwrap(), 1);
    assert_eq!(c.query_row("SELECT count(*) FROM ref_frames WHERE id='frame' AND title='Old frame' AND review_sent_at IS NULL AND review_sent_by IS NULL AND review_hash IS NULL", [], |r|r.get::<_,i64>(0)).unwrap(), 1);

    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        10
    );
    for (table, count) in before {
        assert_eq!(after[&table], count, "row count changed for {table}");
    }
    assert_eq!(after["epics"], 58);
    assert_eq!(after["stories"], 143);
    assert_eq!(after["tasks"], 192);
    assert_eq!(after["assets"], 4);
    assert_eq!(after["write_receipts"], 3);
    let primary_key = c
        .prepare("SELECT name FROM pragma_table_info('write_receipts') WHERE pk>0 ORDER BY pk")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(primary_key, ["jam_id", "actor_id", "tool", "request_id"]);
    let revision: i64 = c
        .query_row("SELECT board_revision FROM board_meta", [], |r| r.get(0))
        .unwrap();
    let retry = store
        .create_task(
            "h",
            CreateTask {
                request_id: "old-unlinked-task".into(),
                title: "Ignored legacy retry".into(),
                story_key: Some("absent".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(retry.replayed);
    assert_eq!(retry.task.id, "t1");
    assert_eq!(
        c.query_row("SELECT board_revision FROM board_meta", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        revision
    );
    assert_eq!(
        c.query_row("SELECT title FROM epics WHERE id='e0'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "Эпик — 0 🪨"
    );
    assert_eq!(
        c.prepare("SELECT tag FROM task_tags WHERE task_id='t0' ORDER BY position")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap(),
        ["size-m", "design", "alpha"]
    );
    assert!(
        !c.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
    c.execute("UPDATE assets SET kind='video' WHERE id='a1'", [])
        .unwrap();
    // Trigger SQL remains valid after the assets table rebuild.
    c.execute(
        "UPDATE task_presentation SET cover_asset_id='a1' WHERE task_id='t0'",
        [],
    )
    .unwrap();
    drop(store);
}

#[test]
fn v9_legacy_little_stones_is_lossless() {
    migrate_fixture(false);
}

#[test]
fn v9_folder_little_stones_is_lossless() {
    migrate_fixture(true);
}
