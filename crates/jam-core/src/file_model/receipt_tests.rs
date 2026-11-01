use super::*;
use serde_json::{Value, json};

// These shadow the released v9 string DTOs and field order, independently of
// the new enum/optional-request types. The old hash serializes these tuples
// directly; serializing through a sorted JSON map would change that hash.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct V9Register {
    storage_type: String,
    source_path: Option<String>,
    url: Option<String>,
    path_base: Option<String>,
    file_kind: Option<String>,
    name: Option<String>,
    notes: Option<String>,
    companions: Option<Vec<FileCompanion>>,
    request_id: String,
    task_key: Option<String>,
    role: Option<String>,
    expected_claim_generation: Option<String>,
    expected_updated_at: Option<String>,
    working_directory: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct V9TaskFile {
    task_key: String,
    asset_id: String,
    role: Option<String>,
    position: Option<f64>,
    expected_claim_generation: String,
    expected_updated_at: String,
    request_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct V9Reference {
    storage_type: Option<String>,
    file_kind: Option<String>,
    request_id: Option<String>,
    file_role: Option<String>,
    expected_claim_generation: Option<String>,
    expected_updated_at: Option<String>,
    kind: String,
    file_path: Option<String>,
    copy: Option<bool>,
    url: Option<String>,
    text: Option<String>,
    title: Option<String>,
    caption: Option<String>,
    tags: Option<Vec<String>>,
    frame_epic_key: Option<String>,
    frame_id: Option<String>,
    link_to: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
}
fn old_register_hash(input: &RegisterFile) -> String {
    let old: V9Register = serde_json::from_value(serde_json::to_value(input).unwrap()).unwrap();
    crate::storage_io::hash(&serde_json::to_vec(&("register", (&old, None::<Value>))).unwrap())
}
fn old_link_hash(input: &TaskFileInput, action: &str) -> String {
    let old: V9TaskFile = serde_json::from_value(serde_json::to_value(input).unwrap()).unwrap();
    crate::storage_io::hash(&serde_json::to_vec(&(action, old)).unwrap())
}
const STAMP: &str = "2026-10-31T00:00:00Z";
fn fixture(folder: bool) -> (tempfile::TempDir, PathBuf, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(if folder {
        "Board/.state/board.db"
    } else {
        "legacy/board-data.db"
    });
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    if folder {
        let root = path.parent().unwrap().parent().unwrap();
        crate::project_folders::initialize_layout(root).unwrap();
        std::fs::write(
            root.join("jamboard.json"),
            serde_json::to_vec(&ProjectManifest {
                schema_version: 1,
                id: "j".into(),
                name: "Legacy receipts".into(),
                folder_rules: default_folder_rules(),
                repository: None,
            })
            .unwrap(),
        )
        .unwrap();
        crate::board_snapshot::quiesce(root);
    } else {
        std::fs::create_dir_all(path.parent().unwrap().join("projects/j")).unwrap();
    }
    let c = Connection::open(&path).unwrap();
    c.execute_batch(include_str!("../migration.sql")).unwrap();
    c.execute_batch(
        "ALTER TABLE jams ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));",
    )
    .unwrap();
    c.execute_batch(include_str!("../migration_v3.sql"))
        .unwrap();
    c.execute_batch("DROP TABLE tasks;ALTER TABLE tasks_v3 RENAME TO tasks;ALTER TABLE ref_items ADD COLUMN metadata TEXT;ALTER TABLE ref_frames ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN(0,1));").unwrap();
    for sql in [
        include_str!("../migration_v5.sql"),
        include_str!("../migration_v6.sql"),
        include_str!("../migration_v7.sql"),
        include_str!("../migration_v8.sql"),
        include_str!("../migration_v9.sql"),
    ] {
        c.execute_batch(sql).unwrap();
    }
    c.execute_batch("PRAGMA user_version=9;PRAGMA foreign_keys=ON;
INSERT INTO jams(id,name,timezone,key_prefix,created_at,epic_seq,story_seq,task_seq) VALUES('j','Legacy receipts','UTC','JB','2026-10-31T00:00:00Z',1,1,2);
INSERT INTO members(id,kind,name,handle,color,created_at) VALUES('h','human','Human','human','#5B8DEF','2026-10-31T00:00:00Z');
INSERT INTO project_members(jam_id,member_id) VALUES('j','h');
INSERT INTO settings(key,value) VALUES('current_project_id','j'),('current_member_id','h'),('project.j.current_member_id','h');
INSERT INTO epics(id,jam_id,key,title,color,status,position,created_by,updated_by,created_at,updated_at) VALUES('e','j','JB-E1','Epic','m1','draft',1024,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z');
INSERT INTO stories(id,jam_id,key,epic_id,title,status,position,created_by,updated_by,created_at,updated_at) VALUES('s','j','JB-S1','e','Story','draft',1024,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z');
INSERT INTO tasks(id,jam_id,key,story_id,title,status,position,created_by,updated_by,created_at,updated_at) VALUES('t','j','JB-1','s','Linked task','backlog',1024,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z'),('t2','j','JB-2','s','Legacy task','backlog',2048,'h','h','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z');
INSERT INTO task_idempotency(jam_id,actor_id,token,task_id) VALUES('j','h','shared','t2');
INSERT INTO assets(id,jam_id,kind,name,location,created_by,created_at,storage_type,path_base,stored_path,original_name) VALUES('a1','j','other','Linked','https://example.test/linked','h','2026-10-31T00:00:00Z','url','url','https://example.test/linked','Linked'),('a2','j','other','Registered','https://example.test/registered','h','2026-10-31T00:00:00Z','url','url','https://example.test/registered','Registered');
INSERT INTO task_assets(task_id,asset_id,role,position,created_by,created_at) VALUES('t','a1','reference',1024,'h','2026-10-31T00:00:00Z');").unwrap();
    c.execute(
        "UPDATE board_meta SET database_generation='v9-fixture-generation'",
        [],
    )
    .unwrap();
    (dir, path, c)
}
fn url(request: &str) -> RegisterFile {
    serde_json::from_value(json!({"requestId":request,"storageType":"url","url":"https://example.test/registered","name":"Registered"})).unwrap()
}
fn task_input(request: &str) -> TaskFileInput {
    serde_json::from_value(json!({"requestId":request,"taskKey":"JB-1","assetId":"a1","role":"reference","position":1024.0,"expectedUpdatedAt":STAMP,"expectedClaimGeneration":"v9-fixture-generation:t:0"})).unwrap()
}
fn stored_result(request: &str, linked: bool) -> Value {
    let id = if linked { "a1" } else { "a2" };
    let name = if linked { "Linked" } else { "Registered" };
    let path = if linked {
        "https://example.test/linked"
    } else {
        "https://example.test/registered"
    };
    let asset = json!({"id":id,"jamId":"j","kind":"other","name":name,"location":path,"notes":null,"createdBy":"h","createdAt":STAMP,"role":"asset","storageType":"url","pathBase":"url","storedPath":path,"originalName":name,"mimeType":null,"byteSize":null,"contentHash":null,"contentRevision":1,"metadata":{"version":1},"resolution":{"storageType":"url","pathBase":"url","storedPath":path,"resolvedPath":null,"worktreeRoot":null,"resolutionBasis":"url","status":"url","checkedAt":STAMP}});
    json!({"asset":asset,"reference":null,"taskFile":if linked {json!({"asset":asset,"role":"reference","position":1024.0})}else{Value::Null},"taskVersion":if linked {json!({"updatedAt":STAMP,"claimGeneration":"v9-fixture-generation:t:0"})}else{Value::Null},"operationId":request,"unlinked":false,"warnings":["Original v9 warning"]})
}
fn insert_old(c: &Connection, request: &str, hash: &str, state: &str, result: &Value) {
    c.execute(
        "INSERT INTO file_operations VALUES('j','h',?,?,?,?,'2026-10-31T00:00:00Z')",
        params![request, hash, state, result.to_string()],
    )
    .unwrap();
}
fn count(c: &Connection, table: &str) -> i64 {
    c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn committed_v9_receipts_keep_exact_bytes_and_replay_each_tool_and_task_collision() {
    for folder in [false, true] {
        let (_dir, path, c) = fixture(folder);
        let reg = url("shared");
        let link = task_input("old-link");
        assert_eq!(
            old_register_hash(&reg),
            payload_hash("register", &(&reg, None::<AddReference>)).unwrap()
        );
        assert_eq!(
            old_link_hash(&link, "link"),
            payload_hash("link", &link).unwrap()
        );
        let old_reg = stored_result("shared", false);
        let old_link = stored_result("old-link", true);
        insert_old(
            &c,
            "shared",
            &old_register_hash(&reg),
            "committed",
            &old_reg,
        );
        insert_old(
            &c,
            "old-link",
            &old_link_hash(&link, "link"),
            "committed",
            &old_link,
        );
        let cancelled = url("cancelled-old");
        insert_old(
            &c,
            "cancelled-old",
            &old_register_hash(&cancelled),
            "cancelled",
            &json!("files/other/cancelled"),
        );
        let old_rows = count(&c, "file_operations");
        drop(c);
        let store = Store::open(&path).unwrap();
        let c = Connection::open(&path).unwrap();
        assert_eq!(count(&c, "write_receipts"), 3);
        for (request, hash, result) in [
            ("shared", old_register_hash(&reg), old_reg),
            ("old-link", old_link_hash(&link, "link"), old_link),
        ] {
            let row=c.query_row("SELECT payload_hash,result_json FROM write_receipts WHERE tool='file_legacy' AND request_id=?",[request],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).unwrap();
            assert_eq!(row, (hash, result.to_string()));
        }
        assert_eq!(
            c.query_row(
                "SELECT state FROM file_operations WHERE request_id='cancelled-old'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "cancelled"
        );
        let revision = c
            .query_row("SELECT board_revision FROM board_meta", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap();
        let events = store.activity_count().unwrap();
        let replay = store.register_file("h", reg.clone()).unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.asset.unwrap().asset.id, "a2");
        assert_eq!(replay.warnings, ["Original v9 warning"]);
        let replay = store.link_task_file("h", link.clone()).unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.asset.unwrap().asset.id, "a1");
        assert_eq!(replay.task_version.unwrap().updated_at, STAMP);
        let retry = store
            .create_task(
                "h",
                CreateTask {
                    request_id: "shared".into(),
                    title: "Ignored different payload".into(),
                    story_key: Some("absent".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(retry.replayed);
        assert_eq!(retry.task.id, "t2");
        assert_eq!(store.activity_count().unwrap(), events);
        assert_eq!(
            c.query_row("SELECT board_revision FROM board_meta", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            revision
        );
        assert!(matches!(
            store.set_task_file_role("h", link.clone()),
            Err(Error::IdempotencyConflict(_))
        ));
        assert!(matches!(
            store.unlink_task_file("h", link.clone()),
            Err(Error::IdempotencyConflict(_))
        ));
        let mut different = link.clone();
        different.role = Some(TaskFileRole::Result);
        assert!(matches!(
            store.link_task_file("h", different),
            Err(Error::IdempotencyConflict(_))
        ));
        let mut different = reg.clone();
        different.name = Some("Different".into());
        assert!(matches!(
            store.register_file("h", different),
            Err(Error::IdempotencyConflict(_))
        ));
        let mut wrong = task_input("shared");
        wrong.asset_id = "a2".into();
        assert!(matches!(
            store.link_task_file("h", wrong),
            Err(Error::IdempotencyConflict(_))
        ));
        assert!(store.register_file("h", cancelled).is_err());
        let created = store.register_file("h", url("new-register")).unwrap();
        let asset = created.asset.unwrap().asset.id;
        let task = store.get_task("JB-1").unwrap().task;
        let mut new_link = task_input("new-link");
        new_link.asset_id = asset;
        new_link.expected_updated_at = task.updated_at;
        new_link.expected_claim_generation = task.claim_generation;
        let created = store.link_task_file("h", new_link.clone()).unwrap();
        let replay = store.link_task_file("h", new_link).unwrap();
        assert!(replay.replayed);
        assert_eq!(
            created.task_version.unwrap().updated_at,
            replay.task_version.unwrap().updated_at
        );
        assert_eq!(count(&c, "file_operations"), old_rows);
        assert_eq!(count(&c, "write_receipts"), 5);
        assert_eq!(
            c.query_row(
                "SELECT tool FROM write_receipts WHERE request_id='new-register'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "register_file"
        );
        let compact: Value = serde_json::from_str(
            &c.query_row(
                "SELECT result_json FROM write_receipts WHERE request_id='new-link'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(compact.get("asset").is_none());
        assert!(compact["claimGeneration"].is_string());
    }
}

#[test]
fn v9_copying_resumes_existing_reservation_and_cancelled_copy_retains_tombstone() {
    let (dir, path, c) = fixture(true);
    let root = path.parent().unwrap().parent().unwrap();
    let source = dir.path().join("source.txt");
    std::fs::write(&source, b"v9 resumable bytes").unwrap();
    let mut input = url("old-copy");
    input.storage_type = FileStorageType::BoardFile;
    input.url = None;
    input.source_path = Some(display_path(&source));
    input.name = Some("Resumed.txt".into());
    let stored = "files/docs/Reserved.txt";
    std::fs::write(root.join(stored), b"").unwrap();
    insert_old(
        &c,
        "old-copy",
        &old_register_hash(&input),
        "copying",
        &json!(stored),
    );
    let mut cancelled = input.clone();
    cancelled.request_id = Some("cancel-old".into());
    insert_old(
        &c,
        "cancel-old",
        &old_register_hash(&cancelled),
        "copying",
        &json!("files/docs/Cancelled.txt"),
    );
    let before=c.query_row("SELECT payload_hash,state,result_json FROM file_operations WHERE request_id='old-copy'",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).unwrap();
    drop(c);
    let store = Store::open(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    assert_eq!(c.query_row("SELECT payload_hash,state,result_json FROM file_operations WHERE request_id='old-copy'",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).unwrap(),before);
    assert_eq!(
        store.file_operation_status("h", "old-copy").unwrap().state,
        "copying"
    );
    let result = store.register_file("h", input.clone()).unwrap();
    assert_eq!(result.asset.unwrap().stored_path, stored);
    assert_eq!(
        std::fs::read(root.join(stored)).unwrap(),
        b"v9 resumable bytes"
    );
    assert_eq!(
        store.file_operation_status("h", "old-copy").unwrap().state,
        "committed"
    );
    assert!(store.register_file("h", input).unwrap().replayed);
    assert_eq!(
        store
            .cancel_file_operation("h", "cancel-old")
            .unwrap()
            .state,
        "cancelled"
    );
    assert!(store.register_file("h", cancelled).is_err());
    assert_eq!(count(&c, "file_operations"), 2);
    assert_eq!(count(&c, "write_receipts"), 2); // legacy task plus recovered exact-tool receipt
    assert_eq!(
        c.query_row(
            "SELECT state FROM file_operations WHERE request_id='old-copy'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "committed"
    );
}

#[test]
fn legacy_file_backed_reference_replays_old_tuple_before_reading_deleted_source() {
    let (dir, path, c) = fixture(false);
    let source = dir.path().join("old-reference.txt");
    std::fs::write(&source, b"old bytes").unwrap();
    let reference:AddReference=serde_json::from_value(json!({"kind":"asset","storageType":"linked_file","filePath":display_path(&source),"copy":false,"title":"Legacy reference","requestId":"old-ref"})).unwrap();
    let input:RegisterFile=serde_json::from_value(json!({"storageType":"linked_file","sourcePath":display_path(&source),"name":"Legacy reference","requestId":"old-ref"})).unwrap();
    let old: V9Register = serde_json::from_value(serde_json::to_value(&input).unwrap()).unwrap();
    let old_ref: V9Reference =
        serde_json::from_value(serde_json::to_value(&reference).unwrap()).unwrap();
    let hash =
        crate::storage_io::hash(&serde_json::to_vec(&("register", (&old, Some(old_ref)))).unwrap());
    assert_eq!(
        hash,
        payload_hash("register", &(&input, Some(&reference))).unwrap()
    );
    let mut stored = stored_result("old-ref", false);
    for field in ["location", "storedPath"] {
        stored["asset"][field] = json!(display_path(&source));
    }
    stored["asset"]["name"] = json!("Legacy reference");
    stored["asset"]["storageType"] = json!("linked_file");
    stored["asset"]["pathBase"] = json!("absolute");
    stored["reference"] = json!({"id":"r1","jamId":"j","position":0.0,"createdBy":"h","updatedBy":"h","createdAt":STAMP,"updatedAt":STAMP,"archivedAt":null,"kind":"asset","assetId":"a2","url":null,"title":"Legacy reference","captionMd":"Original caption","tags":[],"x":0.0,"y":0.0,"w":200.0,"h":120.0,"z":0.0,"frameId":null,"linkPreview":null});
    c.execute("UPDATE assets SET name='Legacy reference',location=?,stored_path=?,storage_type='linked_file',path_base='absolute' WHERE id='a2'",params![display_path(&source),display_path(&source)]).unwrap();
    c.execute("INSERT INTO ref_items(id,jam_id,kind,asset_id,title,caption_md,tags_json,x,y,w,h,z,position,created_by,updated_by,created_at,updated_at) VALUES('r1','j','asset','a2','Legacy reference','Original caption','[]',0,0,200,120,0,0,'h','h',?,?)",[STAMP,STAMP]).unwrap();
    insert_old(&c, "old-ref", &hash, "committed", &stored);
    drop(c);
    std::fs::remove_file(&source).unwrap();
    let store = Store::open(&path).unwrap();
    let result = store.add_reference("h", reference.clone()).unwrap();
    assert!(result.replayed);
    assert_eq!(result.audit.id, "r1");
    assert_eq!(result.caption_md, "Original caption");
    let mut changed = reference;
    changed.caption = Some("Different".into());
    assert!(matches!(
        store.add_reference("h", changed),
        Err(Error::IdempotencyConflict(_))
    ));
}

#[test]
fn new_file_tools_have_independent_compact_receipts_and_replay_original_validators() {
    let (_dir, path, c) = fixture(false);
    drop(c);
    let store = Store::open(&path).unwrap();
    let asset = store
        .register_file("h", url("same-new-id"))
        .unwrap()
        .asset
        .unwrap()
        .asset
        .id;
    let task = store.get_task("JB-1").unwrap().task;
    let mut link = task_input("same-new-id");
    link.asset_id = asset;
    link.expected_claim_generation = task.claim_generation;
    link.expected_updated_at = task.updated_at;
    let linked = store.link_task_file("h", link.clone()).unwrap();
    let mut role = link.clone();
    role.role = Some(TaskFileRole::Result);
    role.expected_updated_at = linked.task_version.as_ref().unwrap().updated_at.clone();
    let changed = store.set_task_file_role("h", role.clone()).unwrap();
    let mut unlink = role.clone();
    unlink.expected_updated_at = changed.task_version.as_ref().unwrap().updated_at.clone();
    let removed = store.unlink_task_file("h", unlink.clone()).unwrap();
    assert!(removed.unlinked);
    for (first, replay) in [
        (&linked, store.link_task_file("h", link.clone()).unwrap()),
        (
            &changed,
            store.set_task_file_role("h", role.clone()).unwrap(),
        ),
        (
            &removed,
            store.unlink_task_file("h", unlink.clone()).unwrap(),
        ),
    ] {
        assert!(replay.replayed);
        let mut compact = crate::compact_mutation("asset", &serde_json::to_value(first).unwrap());
        compact["replayed"] = json!(true);
        assert_eq!(
            crate::compact_mutation("asset", &serde_json::to_value(replay).unwrap()),
            compact
        );
    }
    let mut wrong = link;
    wrong.role = None;
    assert!(matches!(
        store.link_task_file("h", wrong),
        Err(Error::IdempotencyConflict(_))
    ));
    let c = Connection::open(&path).unwrap();
    assert_eq!(count(&c, "file_operations"), 0);
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM write_receipts WHERE request_id='same-new-id'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        4
    );
    // Exact-tool receipts take precedence over an incompatible legacy fallback.
    c.execute("INSERT INTO write_receipts(jam_id,actor_id,tool,request_id,payload_hash,result_json,created_at) VALUES('j','h','file_legacy','same-new-id','unrelated','{}',?)",[STAMP]).unwrap();
    assert!(
        store
            .register_file("h", url("same-new-id"))
            .unwrap()
            .replayed
    );
}

#[test]
fn new_copy_restarts_in_shared_journal_and_file_backed_reference_namespace_is_independent() {
    let (dir, path, c) = fixture(true);
    drop(c);
    let store = Store::open(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    let source = dir.path().join("new-source.txt");
    std::fs::write(&source, b"new copied bytes").unwrap();
    let input:RegisterFile=serde_json::from_value(json!({"requestId":"shared-copy","storageType":"board_file","sourcePath":display_path(&source)})).unwrap();
    c.execute_batch("CREATE TRIGGER fixture_fail BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(store.register_file("h", input.clone()).is_err());
    let stored:String=c.query_row("SELECT json_extract(result_json,'$.fileOperation.path') FROM write_receipts WHERE tool='register_file' AND request_id='shared-copy'",[],|r|r.get(0)).unwrap();
    assert_eq!(count(&c, "file_operations"), 0);
    c.execute_batch("DROP TRIGGER fixture_fail;").unwrap();
    drop(c);
    drop(store);
    let store = Store::open(&path).unwrap();
    assert!(
        store
            .reconcile_file_operations()
            .unwrap()
            .iter()
            .any(|r| r.request_id == "shared-copy" && r.state == "copying")
    );
    let copied = store.register_file("h", input.clone()).unwrap();
    assert_eq!(copied.asset.unwrap().stored_path, stored);
    assert!(store.register_file("h", input).unwrap().replayed);
    let reference:AddReference=serde_json::from_value(json!({"requestId":"shared-copy","kind":"asset","copy":true,"filePath":display_path(&source),"title":"Reference"})).unwrap();
    let created = store.add_reference("h", reference.clone()).unwrap();
    std::fs::remove_file(&source).unwrap();
    let replay = store.add_reference("h", reference).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.audit.id, created.audit.id);
    let c = Connection::open(&path).unwrap();
    assert_eq!(count(&c, "file_operations"), 0);
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM write_receipts WHERE request_id='shared-copy'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}

#[test]
fn legacy_copied_reference_keeps_directory_and_replays_before_source_io() {
    let (dir, path, c) = fixture(false);
    drop(c);
    let store = Store::open(&path).unwrap();
    let source = dir.path().join("legacy-copy.txt");
    std::fs::write(&source, b"legacy copy").unwrap();
    let input:AddReference=serde_json::from_value(json!({"requestId":"copied-reference","kind":"asset","copy":true,"filePath":display_path(&source)})).unwrap();
    let created = store.add_reference("h", input.clone()).unwrap();
    std::fs::remove_file(&source).unwrap();
    let replay = store.add_reference("h", input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.audit.id, created.audit.id);
    let c = Connection::open(&path).unwrap();
    assert_eq!(count(&c, "file_operations"), 0);
    assert_eq!(c.query_row("SELECT count(*) FROM write_receipts WHERE tool='add_reference' AND request_id='copied-reference'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap().join("references"))
            .unwrap()
            .count(),
        1
    );
    std::fs::write(&source, b"plain linked reference").unwrap();
    let input:AddReference=serde_json::from_value(json!({"requestId":"plain-linked-reference","kind":"asset","filePath":display_path(&source)})).unwrap();
    let created = store.add_reference("h", input.clone()).unwrap();
    std::fs::remove_file(&source).unwrap();
    let replay = store.add_reference("h", input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.audit.id, created.audit.id);
}
