use jam_core::*;
use rusqlite::Connection;
use std::path::Path;

fn manager(root: &Path) -> ProjectManager {
    ProjectManager::new(root.join("fictional-appdata")).unwrap()
}
fn folder(root: &Path) -> (ProjectManager, std::sync::Arc<ProjectHandle>) {
    let m = manager(root);
    let h = m
        .create(&root.join("Доска With Spaces"), "Fictional board", false)
        .unwrap();
    (m, h)
}
fn register(path: &Path, storage: FileStorageType, request: &str) -> RegisterFile {
    RegisterFile {
        storage_type: storage,
        source_path: Some(path.to_string_lossy().into()),
        url: None,
        path_base: None,
        file_kind: None,
        name: None,
        notes: None,
        companions: None,
        request_id: request.into(),
        task_key: None,
        role: None,
        expected_claim_generation: None,
        expected_updated_at: None,
        working_directory: None,
    }
}

#[test]
fn st_create_open_epochs_close_and_registry() {
    let d = tempfile::tempdir().unwrap();
    let (m, a) = folder(d.path());
    assert_eq!(a.store.active_jam().unwrap().id, a.project_id);
    let b = m.open(&a.folder, false, false).unwrap();
    assert!(b.selection_epoch > a.selection_epoch);
    assert_eq!(a.instance_id, b.instance_id);
    assert!(a.folder.join("files/models").is_dir());
    assert!(
        std::fs::read_to_string(a.folder.join(".gitignore"))
            .unwrap()
            .contains("/.state/")
    );
    assert!(d.path().join("fictional-appdata/registry.db").is_file());
    m.close().unwrap();
    assert!(m.capture_selected().is_err());
    assert_eq!(a.store.active_jam().unwrap().id, a.project_id);
}
#[test]
fn st_unknown_manifest_and_rule_escape_refused() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    let info = h.info().unwrap();
    let mut rules = info.manifest.folder_rules.clone();
    rules.insert("model".into(), "files/../../outside".into());
    assert!(m.set_folder_rules(rules, &info.manifest_revision).is_err());
    let mut manifest = info.manifest;
    manifest.schema_version = 2;
    std::fs::write(
        h.folder.join("jamboard.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    assert!(m.open(&h.folder, false, false).is_err());
}
#[test]
fn st_create_collision_preserves_existing() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let p = d.path().join("existing");
    std::fs::create_dir(&p).unwrap();
    std::fs::write(p.join("owner.txt"), b"untouched").unwrap();
    assert!(m.create(&p, "No", false).is_err());
    assert_eq!(std::fs::read(p.join("owner.txt")).unwrap(), b"untouched");
}
#[test]
fn st_storage_policy_cloud_unc_relative_reserved() {
    let d = tempfile::tempdir().unwrap();
    assert!(validate_storage_path(Path::new(r"\\server\share\board"), true).is_err());
    assert!(validate_storage_path(Path::new(r"\\?\UNC\server\share\board"), true).is_err());
    assert!(validate_storage_path(Path::new("D:relative"), true).is_err());
    assert!(validate_storage_path(&d.path().join("NUL"), true).is_err());
    let cloud = d.path().join("OneDrive/Board");
    assert!(validate_storage_path(&cloud, false).is_err());
    assert!(validate_storage_path(&cloud, true).is_ok());
}
#[test]
fn st_duplicate_identity_requires_explicit_copy() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    m.close().unwrap();
    let clone = d.path().join("clone");
    std::fs::create_dir(&clone).unwrap();
    std::fs::create_dir(clone.join(".state")).unwrap();
    for file in ["jamboard.json", "board.json", ".state/board.db"] {
        std::fs::copy(h.folder.join(file), clone.join(file)).unwrap();
    }
    assert!(m.open(&clone, false, false).is_err());
    let copied = m.open(&clone, false, true).unwrap();
    assert_ne!(copied.project_id, h.project_id);
    assert_ne!(copied.instance_id, h.instance_id);
}
#[test]
fn db_runtime_full_integrity_and_independent_stores() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    println!(
        "Bundled SQLite {} ({})",
        sqlite_runtime_version(),
        rusqlite::version_number()
    );
    check_wal_runtime().unwrap();
    let c = Connection::open(&h.store.path).unwrap();
    assert_eq!(
        c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert!(
        !c.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
    let a = h.store.clone();
    let b = Store::open(&a.path)
        .unwrap()
        .for_project(&h.project_id)
        .unwrap();
    let actor = a.current_member().unwrap().id;
    let actor2 = actor.clone();
    std::thread::scope(|scope| {
        let task = scope.spawn(move || {
            for i in 0..20 {
                a.create_asset(&actor, "model", &format!("A{i}"), "opaque", None)
                    .unwrap();
            }
        });
        for i in 0..20 {
            b.create_asset(&actor2, "document", &format!("B{i}"), "opaque", None)
                .unwrap();
        }
        task.join().unwrap();
    });
    assert_eq!(h.store.list_assets(None, None).unwrap().len(), 40);
}
#[test]
fn fi_classification_and_readable_names() {
    for ext in [
        "glb", "gltf", "obj", "fbx", "blend", "stl", "ply", "dae", "3mf", "usd", "usda", "usdc",
        "usdz",
    ] {
        assert_eq!(classify_file(Path::new(&format!("model.{ext}"))), "model");
    }
    for ext in ["md", "txt", "pdf", "docx"] {
        assert_eq!(classify_file(Path::new(&format!("note.{ext}"))), "document");
    }
    assert_eq!(readable_file_name("CON.fbx"), "_CON.fbx");
    assert_eq!(readable_file_name("Игры?.blend"), "Игры_.blend");
}
#[test]
fn fi_copy_link_idempotency_collision_and_missing() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    let src = d.path().join("Корабль.fbx");
    std::fs::write(&src, b"model fixture").unwrap();
    let actor = h.store.current_member().unwrap().id;
    let input = register(&src, FileStorageType::BoardFile, "copy-1");
    let a = h
        .store
        .register_file(&actor, input.clone())
        .unwrap()
        .asset
        .unwrap();
    assert_eq!(a.storage_type, "board_file");
    assert_eq!(
        a.content_hash.as_deref(),
        Some("21249a290a4255a0f3ee6685ff7933bffa241c3e35bb13a52dc0c7a679bed3b2")
    );
    let retry = h.store.register_file(&actor, input).unwrap().asset.unwrap();
    assert_eq!(a.asset.id, retry.asset.id);
    let b = h
        .store
        .register_file(&actor, register(&src, FileStorageType::BoardFile, "copy-2"))
        .unwrap()
        .asset
        .unwrap();
    assert!(b.stored_path.contains("(2)"));
    let linked = h
        .store
        .register_file(
            &actor,
            register(&src, FileStorageType::LinkedFile, "link-1"),
        )
        .unwrap()
        .asset
        .unwrap();
    std::fs::remove_file(src).unwrap();
    assert_eq!(
        h.store
            .resolve_file(ResolveFile {
                asset_id: linked.asset.id,
                working_directory: None
            })
            .unwrap()
            .status,
        "missing"
    );
    assert_eq!(
        h.store
            .resolve_file(ResolveFile {
                asset_id: a.asset.id,
                working_directory: None
            })
            .unwrap()
            .status,
        "available"
    );
}
#[test]
fn fi_request_payload_conflict() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    let p = d.path().join("a.txt");
    std::fs::write(&p, b"one").unwrap();
    let actor = h.store.current_member().unwrap().id;
    let mut input = register(&p, FileStorageType::BoardFile, "same");
    h.store.register_file(&actor, input.clone()).unwrap();
    input.name = Some("Changed".into());
    assert!(matches!(
        h.store.register_file(&actor, input),
        Err(Error::Conflict)
    ));
}
#[test]
fn fi_legacy_gallery_and_reference_media_use_canonical_board_file_paths() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    let source = d.path().join("picture.png");
    std::fs::write(&source, b"fixture image").unwrap();
    let actor = h.store.current_member().unwrap().id;
    let file = h
        .store
        .register_file(
            &actor,
            register(&source, FileStorageType::BoardFile, "preview"),
        )
        .unwrap()
        .asset
        .unwrap();
    let expected = h.folder.join(&file.stored_path).canonicalize().unwrap();
    assert_eq!(
        h.store.asset_preview_path(&file.asset.id).unwrap(),
        Some(expected.clone())
    );
    assert_eq!(
        h.store
            .reference_media_path(&file.asset.id)
            .unwrap()
            .unwrap(),
        expected.to_string_lossy()
    );
    let legacy = h
        .store
        .list_assets(None, None)
        .unwrap()
        .into_iter()
        .find(|a| a.id == file.asset.id)
        .unwrap();
    assert_eq!(
        std::path::Path::new(&legacy.location)
            .canonicalize()
            .unwrap(),
        expected
    );
    std::fs::remove_file(expected).unwrap();
    // Explicit previews bypass the brief list-status cache after filesystem changes.
    assert_eq!(h.store.asset_preview_path(&file.asset.id).unwrap(), None);
    assert_eq!(h.store.reference_media_path(&file.asset.id).unwrap(), None);
}
#[test]
fn sn_deterministic_allowlist_and_external_edit_guard() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    h.store
        .set_setting("provider_api_key", "CANARY_SECRET_NEVER_EXPORT")
        .unwrap();
    h.store.flush_board_snapshot().unwrap();
    let path = h.folder.join("board.json");
    let a = std::fs::read(&path).unwrap();
    h.store.flush_board_snapshot().unwrap();
    assert_eq!(a, std::fs::read(&path).unwrap());
    assert!(!String::from_utf8(a).unwrap().contains("CANARY_SECRET"));
    std::fs::write(&path, b"external edit").unwrap();
    assert!(h.store.flush_board_snapshot().is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"external edit");
    let comparison = h.store.compare_board_snapshot().unwrap();
    assert!(!comparison.external_valid);
    assert!(h.store.keep_live_board("stale-external-hash").is_err());
    h.store.keep_live_board(&comparison.external_hash).unwrap();
    let published: BoardSnapshot = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(published.project_id, h.project_id);
}
#[test]
fn sn_missing_db_explicit_recovery_preserves_identity() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    let id = h.project_id.clone();
    let path = h.folder.clone();
    m.close().unwrap();
    drop(h);
    for suffix in ["", "-wal", "-shm"] {
        let p = path.join(format!(".state/board.db{suffix}"));
        if p.exists() {
            std::fs::remove_file(p).unwrap();
        }
    }
    assert!(m.open(&path, false, false).is_err());
    let h = m.recover(&path, false).unwrap();
    assert_eq!(h.project_id, id);
}
#[test]
fn sn_rotation_keeps_pinned_backup() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    h.store.set_setting("backup_recent_count", "2").unwrap();
    h.store.set_setting("backup_daily_count", "0").unwrap();
    let pinned = h.store.backup_board("pre-recovery", true).unwrap();
    for _ in 0..4 {
        h.store.backup_board("test", false).unwrap();
    }
    assert!(h.folder.join(".state/backups").join(pinned.id).is_dir());
    assert_eq!(
        std::fs::read_dir(h.folder.join(".state/backups"))
            .unwrap()
            .count(),
        3
    );
}
#[test]
fn sn_sustained_writes_publish_before_the_writer_becomes_idle() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    let actor = h.store.current_member().unwrap().id;
    h.store.flush_board_snapshot().unwrap();
    let path = h.folder.join("board.json");
    let initial = std::fs::read(&path).unwrap();
    let started = std::time::Instant::now();
    let mut writes = 0;
    while started.elapsed() < std::time::Duration::from_secs(6) {
        h.store
            .create_asset(
                &actor,
                "document",
                &format!("Visible {writes}"),
                "missing.txt",
                None,
            )
            .unwrap();
        writes += 1;
        if std::fs::read(&path).unwrap() != initial {
            assert!(writes > 1);
            h.store.flush_board_snapshot().unwrap();
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    panic!("No publication during sustained writes (5 s cap plus 1 s scheduling allowance)");
}
#[test]
fn sn_recovery_refuses_truncated_newer_and_escaping_snapshots_without_replacing_live_db() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    let source = d.path().join("retained.txt");
    std::fs::write(&source, b"retained").unwrap();
    let actor = h.store.current_member().unwrap().id;
    h.store
        .register_file(
            &actor,
            register(&source, FileStorageType::BoardFile, "recovery-guard"),
        )
        .unwrap();
    m.close().unwrap();
    let path = h.folder.join("board.json");
    let original = std::fs::read(&path).unwrap();
    let mut snapshot: BoardSnapshot = serde_json::from_slice(&original).unwrap();
    std::fs::write(&path, b"{truncated").unwrap();
    assert!(m.recover(&h.folder, false).is_err());
    snapshot.format_version = 4;
    std::fs::write(&path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
    assert!(m.recover(&h.folder, false).is_err());
    snapshot.format_version = 3;
    snapshot.tables.get_mut("assets").unwrap()[0].insert(
        "stored_path".into(),
        serde_json::json!("files/../../outside.txt"),
    );
    std::fs::write(&path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
    assert!(m.recover(&h.folder, false).is_err());
    assert_eq!(h.store.active_jam().unwrap().id, h.project_id);
    assert_eq!(
        h.store
            .folder_session_context()
            .unwrap()
            .database_generation,
        h.database_generation
    );
    std::fs::write(path, original).unwrap();
}
#[test]
fn mv_interruption_resume_each_state_and_source_fence() {
    for state in ["prepared", "frozen", "copied", "verified", "published"] {
        let d = tempfile::tempdir().unwrap();
        let m = manager(d.path());
        let s = Store::open(d.path().join("legacy.db")).unwrap();
        let (j, actor) = s
            .create_jam("Source", None, None, None, "UTC", "Human")
            .unwrap();
        s.create_asset(&actor.id, "model", "Missing link", "C:\\missing.fbx", None)
            .unwrap();
        let input = MoveProject {
            project_id: j.id.clone(),
            destination: d.path().join("destination").to_string_lossy().into(),
            request_id: format!("move-{state}"),
            cloud_acknowledged: false,
        };
        let r = m
            .advance_project_move(&s, input.clone(), Some(state))
            .unwrap();
        assert_eq!(r.state, state);
        if state != "prepared" {
            assert!(s.set_setting("test", "fenced").is_err());
        }
        let r = m.move_project(&s, input).unwrap();
        assert_eq!(r.state, "committed");
        assert!(
            s.create_asset(&actor.id, "model", "Blocked", "none", None)
                .is_err()
        );
        assert_eq!(
            m.capture_selected()
                .unwrap()
                .store
                .list_assets(None, None)
                .unwrap()
                .len(),
            1
        );
    }
}
#[test]
fn mv_pre_cutover_rollback_and_bound_client_refusal() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let s = Store::open(d.path().join("legacy.db")).unwrap();
    let (j, _) = s
        .create_jam("Source", None, None, None, "UTC", "Human")
        .unwrap();
    let input = MoveProject {
        project_id: j.id,
        destination: d.path().join("destination").to_string_lossy().into(),
        request_id: "rollback".into(),
        cloud_acknowledged: false,
    };
    let lease = s.project_lease().unwrap();
    assert!(m.move_project(&s, input.clone()).is_err());
    drop(lease);
    m.advance_project_move(&s, input, Some("verified")).unwrap();
    assert_eq!(
        m.rollback_project_move(&s, "rollback").unwrap().state,
        "rolled_back"
    );
    s.set_setting("test", "writable").unwrap();
    assert!(!d.path().join("destination").exists());
}

#[test]
fn fi_task_roles_stale_context_unlink_and_companions() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    let s = &h.store;
    let actor = s.current_member().unwrap().id;
    let story = s.default_task_story(&actor).unwrap();
    let task = s
        .create_task(
            &actor,
            CreateTask {
                title: "File roles".into(),
                story_key: Some(story.key),
                ..Default::default()
            },
        )
        .unwrap();
    let src = d.path().join("Ship.gltf");
    std::fs::write(&src, b"model").unwrap();
    let buffer = d.path().join("Ship.bin");
    std::fs::write(&buffer, b"buffer").unwrap();
    let mut req = register(&src, FileStorageType::BoardFile, "compound");
    req.companions = Some(vec![FileCompanion {
        source_path: buffer.to_string_lossy().into(),
        relative_uri: "buffers/Ship.bin".into(),
    }]);
    req.task_key = Some(task.task.key.clone());
    req.role = Some("to_edit".into());
    req.expected_updated_at = Some(task.task.updated_at.clone());
    req.expected_claim_generation = Some(task.task.claim_generation.clone());
    let result = s.register_file(&actor, req.clone()).unwrap();
    let asset = result.asset.unwrap();
    assert_eq!(result.task_file.unwrap().role, "to_edit");
    assert_eq!(
        s.register_file(&actor, req)
            .unwrap()
            .asset
            .unwrap()
            .asset
            .id,
        asset.asset.id
    );
    assert!(
        Path::new(asset.resolution.resolved_path.as_ref().unwrap())
            .parent()
            .unwrap()
            .join("buffers/Ship.bin")
            .is_file()
    );
    let c = Connection::open(&s.path).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM asset_components", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    let mut input = TaskFileInput {
        task_key: task.task.key.clone(),
        asset_id: asset.asset.id.clone(),
        role: Some("result".into()),
        position: Some(12.),
        expected_claim_generation: task.task.claim_generation.clone(),
        expected_updated_at: task.task.updated_at,
        request_id: "stale-role".into(),
    };
    assert!(matches!(
        s.set_task_file_role(&actor, input.clone()),
        Err(Error::Conflict)
    ));
    let fresh = s.get_task(&input.task_key).unwrap();
    input.expected_updated_at = fresh.task.updated_at;
    input.request_id = "role".into();
    s.set_task_file_role(&actor, input.clone()).unwrap();
    let fresh = s.get_task(&input.task_key).unwrap();
    assert_eq!(fresh.files[0].role, "result");
    assert_eq!(fresh.files[0].position, 12.);
    input.expected_updated_at = fresh.task.updated_at;
    input.request_id = "unlink".into();
    s.unlink_task_file(&actor, input).unwrap();
    assert!(s.get_task(&task.task.key).unwrap().files.is_empty());
    assert!(Path::new(asset.resolution.resolved_path.as_ref().unwrap()).is_file());
}
#[test]
fn sn_heartbeats_do_not_churn_and_rules_compare_and_set() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    h.store.identify_agent("Fixture agent", "fixture").unwrap();
    h.store.flush_board_snapshot().unwrap();
    let before = std::fs::read(h.folder.join("board.json")).unwrap();
    for _ in 0..3 {
        h.store.identify_agent("Fixture agent", "fixture").unwrap();
    }
    h.store.flush_board_snapshot().unwrap();
    assert_eq!(before, std::fs::read(h.folder.join("board.json")).unwrap());
    let info = h.info().unwrap();
    let mut rules = info.manifest.folder_rules;
    rules.insert("model".into(), "files/custom-models".into());
    m.set_folder_rules(rules.clone(), &info.manifest_revision)
        .unwrap();
    assert!(m.set_folder_rules(rules, &info.manifest_revision).is_err());
}
#[test]
fn st_windows_long_verbatim_and_junction_matrix() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let mut root = d.path().to_path_buf();
    for _ in 0..8 {
        root = root.join("Long Cyrillic Игры folder component");
    }
    let board = root.join("Board");
    assert!(board.to_string_lossy().len() > 260);
    let h = m.create(&board, "Long path", false).unwrap();
    assert_eq!(h.store.active_jam().unwrap().id, h.project_id);
    #[cfg(windows)]
    {
        let verbatim = board.canonicalize().unwrap();
        assert!(verbatim.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(
            m.open(&verbatim, false, false).unwrap().instance_id,
            h.instance_id
        );
        let outside = d.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        let link = h.folder.join("files/escape");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success(), "Fixture junction creation failed");
        let info = h.info().unwrap();
        let mut rules = info.manifest.folder_rules;
        rules.insert("model".into(), "files/escape/models".into());
        assert!(m.set_folder_rules(rules, &info.manifest_revision).is_err());
    }
}

#[test]
fn fi_cancel_during_streamed_copy_keeps_no_asset_and_idempotent_tombstone() {
    let d = tempfile::tempdir().unwrap();
    let (_, h) = folder(d.path());
    let source = d.path().join("large-fixture.blend");
    std::fs::File::create(&source)
        .unwrap()
        .set_len(64 * 1024 * 1024)
        .unwrap();
    let actor = h.store.current_member().unwrap().id;
    let input = register(&source, FileStorageType::BoardFile, "cancel-copy");
    let store = h.store.clone();
    let worker_actor = actor.clone();
    let worker = std::thread::spawn(move || store.register_file(&worker_actor, input));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if h.store.file_operation_status(&actor, "cancel-copy").is_ok() {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        h.store
            .cancel_file_operation(&actor, "cancel-copy")
            .unwrap()
            .state,
        "cancelled"
    );
    assert!(worker.join().unwrap().is_err());
    assert!(h.store.list_assets(None, None).unwrap().is_empty());
    assert!(
        h.store
            .register_file(
                &actor,
                register(&source, FileStorageType::BoardFile, "cancel-copy")
            )
            .is_err()
    );
}
#[test]
fn mv_managed_bytes_and_folder_reverse_move_preserve_identity() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let legacy = Store::open(d.path().join("legacy.db")).unwrap();
    let (j, actor) = legacy
        .create_jam("Managed fixture", None, None, None, "UTC", "Human")
        .unwrap();
    std::fs::create_dir(d.path().join("references")).unwrap();
    let source = d.path().join("references/managed.blend");
    std::fs::write(&source, b"managed model bytes").unwrap();
    let asset = legacy
        .create_asset(
            &actor.id,
            "other",
            "Managed",
            source.to_str().unwrap(),
            None,
        )
        .unwrap();
    let first = d.path().join("first");
    m.move_project(
        &legacy,
        MoveProject {
            project_id: j.id.clone(),
            destination: first.to_string_lossy().into(),
            request_id: "managed".into(),
            cloud_acknowledged: false,
        },
    )
    .unwrap();
    let moved = m.capture_selected().unwrap();
    let file = moved
        .store
        .list_file_assets(FileAssetQuery::default())
        .unwrap()
        .remove(0);
    assert_eq!(file.asset.id, asset.id);
    assert_eq!(file.storage_type, "board_file");
    assert_eq!(
        std::fs::read(file.resolution.resolved_path.unwrap()).unwrap(),
        b"managed model bytes"
    );
    assert!(source.is_file());
    let second = d.path().join("second");
    m.move_project(
        &moved.store,
        MoveProject {
            project_id: j.id.clone(),
            destination: second.to_string_lossy().into(),
            request_id: "physical".into(),
            cloud_acknowledged: false,
        },
    )
    .unwrap();
    let latest = m.capture_selected().unwrap();
    assert_eq!(latest.project_id, j.id);
    let file = latest
        .store
        .list_file_assets(FileAssetQuery::default())
        .unwrap()
        .remove(0);
    assert_eq!(
        std::fs::read(file.resolution.resolved_path.unwrap()).unwrap(),
        b"managed model bytes"
    );
    assert!(
        moved
            .store
            .create_asset(&actor.id, "other", "No stale write", "opaque", None)
            .is_err()
    );
}

#[test]
fn sn_large_snapshot_recovery_preserves_files_and_pauses_authority() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    let actor = h.store.current_member().unwrap().id;
    let story = h.store.default_task_story(&actor).unwrap();
    let task = h
        .store
        .create_task(
            &actor,
            CreateTask {
                title: "Large recovered task".into(),
                story_key: Some(story.key.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    let source = d.path().join("result.blend");
    std::fs::write(&source, b"retained model bytes").unwrap();
    let asset = h
        .store
        .register_file(
            &actor,
            register(&source, FileStorageType::BoardFile, "large-result"),
        )
        .unwrap()
        .asset
        .unwrap();
    let content = "large snapshot fixture\n".repeat(1_550_000);
    assert!(content.len() > 32 * 1024 * 1024);
    let c = Connection::open(&h.store.path).unwrap();
    c.execute(
        "UPDATE tasks SET description_md=? WHERE id=?",
        rusqlite::params![content, task.task.id],
    )
    .unwrap();
    drop(c);
    // The background coordinator can already be serializing this >32 MiB board.
    // An explicit flush reports bounded contention; retry that documented outcome.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match h.store.flush_board_snapshot() {
            Ok(()) => break,
            Err(Error::Validation { field, reason })
                if field == "projectFolder"
                    && reason.contains("retry")
                    && std::time::Instant::now() < deadline => {}
            Err(error) => panic!("Large-board flush failed: {error}"),
        }
    }
    assert!(
        std::fs::metadata(h.folder.join("board.json"))
            .unwrap()
            .len()
            > 32 * 1024 * 1024
    );
    let path = h.folder.clone();
    let old_generation = h.database_generation.clone();
    let id = h.project_id.clone();
    m.close().unwrap();
    drop(h);
    let recovered = m.recover(&path, false).unwrap();
    assert_eq!(recovered.project_id, id);
    assert_ne!(recovered.database_generation, old_generation);
    let restored = recovered.store.get_task(&task.task.key).unwrap();
    assert_eq!(restored.task.description_md, content);
    assert_ne!(restored.task.claim_generation, task.task.claim_generation);
    assert_eq!(
        recovered
            .store
            .resolve_file(ResolveFile {
                asset_id: asset.asset.id,
                working_directory: None
            })
            .unwrap()
            .status,
        "available"
    );
}
#[test]
fn fi_roles_are_per_task_and_cross_project_files_are_refused() {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fictional.db")).unwrap();
    let (a, human) = s
        .create_jam("First", None, None, None, "UTC", "Human")
        .unwrap();
    let first = s.for_project(&a.id).unwrap();
    let story = first.default_task_story(&human.id).unwrap();
    let create = |title: &str| {
        first
            .create_task(
                &human.id,
                CreateTask {
                    title: title.into(),
                    story_key: Some(story.key.clone()),
                    ..Default::default()
                },
            )
            .unwrap()
    };
    let one = create("Edit");
    let two = create("Reference");
    let path = d.path().join("linked.obj");
    std::fs::write(&path, b"model").unwrap();
    let file = first
        .register_file(
            &human.id,
            register(&path, FileStorageType::LinkedFile, "per-task"),
        )
        .unwrap()
        .asset
        .unwrap();
    for (t, role, request) in [(&one, "to_edit", "one"), (&two, "reference", "two")] {
        first
            .link_task_file(
                &human.id,
                TaskFileInput {
                    task_key: t.task.key.clone(),
                    asset_id: file.asset.id.clone(),
                    role: Some(role.into()),
                    position: None,
                    expected_claim_generation: t.task.claim_generation.clone(),
                    expected_updated_at: t.task.updated_at.clone(),
                    request_id: request.into(),
                },
            )
            .unwrap();
    }
    assert_eq!(
        first.get_task(&one.task.key).unwrap().files[0].role,
        "to_edit"
    );
    assert_eq!(
        first.get_task(&two.task.key).unwrap().files[0].role,
        "reference"
    );
    let (b, other) = s
        .create_jam("Other", None, None, None, "UTC", "Other human")
        .unwrap();
    let second = s.for_project(&b.id).unwrap();
    let story = second.default_task_story(&other.id).unwrap();
    let task = second
        .create_task(
            &other.id,
            CreateTask {
                title: "Foreign attempt".into(),
                story_key: Some(story.key),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        second
            .link_task_file(
                &other.id,
                TaskFileInput {
                    task_key: task.task.key,
                    asset_id: file.asset.id,
                    role: Some("reference".into()),
                    position: None,
                    expected_claim_generation: task.task.claim_generation,
                    expected_updated_at: task.task.updated_at,
                    request_id: "foreign".into()
                }
            )
            .is_err()
    );
}
#[test]
fn mv_io_boundaries_resume_and_registry_reconcile_without_reactivating_source() {
    for point in ["file_copy", "file_commit", "rename", "source_commit"] {
        let d = tempfile::tempdir().unwrap();
        let m = manager(d.path());
        let s = Store::open(d.path().join("legacy.db")).unwrap();
        let (j, human) = s
            .create_jam("Interrupted IO", None, None, None, "UTC", "Human")
            .unwrap();
        std::fs::create_dir(d.path().join("references")).unwrap();
        let file = d.path().join("references/managed.png");
        std::fs::write(&file, b"fixture managed bytes").unwrap();
        s.create_asset(&human.id, "sprite", "Managed", file.to_str().unwrap(), None)
            .unwrap();
        let destination = d.path().join("destination");
        let req = MoveProject {
            project_id: j.id.clone(),
            destination: destination.to_string_lossy().into(),
            request_id: point.into(),
            cloud_acknowledged: false,
        };
        m.advance_project_move(&s, req.clone(), Some(point))
            .unwrap();
        if point == "source_commit" {
            assert_eq!(m.open(&destination, false, false).unwrap().project_id, j.id);
        } else if destination.exists() {
            assert!(m.open(&destination, false, false).is_err());
        }
        let receipt = m.move_project(&s, req).unwrap();
        assert_eq!(receipt.state, "committed");
        assert_eq!(
            m.registry.resolve(&j.id, None).unwrap().canonical_folder,
            destination.canonicalize().unwrap().to_string_lossy()
        );
    }
}
#[test]
fn st_worktree_alias_and_fi_repository_resolution_use_one_anchor() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("repo");
    let git = root.join(".git");
    std::fs::create_dir_all(git.join("objects")).unwrap();
    std::fs::create_dir_all(git.join("refs/heads")).unwrap();
    std::fs::write(git.join("HEAD"), "ref: refs/heads/fixture\n").unwrap();
    std::fs::write(
        git.join("config"),
        "[core]\nrepositoryformatversion = 0\nbare = false\n",
    )
    .unwrap();
    let worktree = d.path().join("other-worktree");
    std::fs::create_dir(&worktree).unwrap();
    let workgit = git.join("worktrees/fixture");
    std::fs::create_dir_all(&workgit).unwrap();
    std::fs::write(workgit.join("commondir"), "../..\n").unwrap();
    std::fs::write(workgit.join("HEAD"), "ref: refs/heads/fixture\n").unwrap();
    std::fs::write(
        workgit.join("gitdir"),
        worktree.join(".git").to_string_lossy().as_bytes(),
    )
    .unwrap();
    std::fs::write(
        worktree.join(".git"),
        format!("gitdir: {}\n", workgit.display()),
    )
    .unwrap();
    let m = manager(d.path());
    let h = m
        .create(&root.join("JamBoard"), "Worktree board", false)
        .unwrap();
    assert_eq!(
        h.info().unwrap().manifest.repository.unwrap().root_relative,
        ".."
    );
    let alias = worktree.join("JamBoard");
    std::fs::create_dir(&alias).unwrap();
    std::fs::copy(h.folder.join("jamboard.json"), alias.join("jamboard.json")).unwrap();
    assert_eq!(m.open(&alias, false, false).unwrap().folder, h.folder);
    std::fs::write(root.join("model.obj"), b"anchor model").unwrap();
    std::fs::write(worktree.join("model.obj"), b"worktree model").unwrap();
    let actor = h.store.current_member().unwrap().id;
    let file = h
        .store
        .register_file(
            &actor,
            register(
                &root.join("model.obj"),
                FileStorageType::LinkedFile,
                "repo-link",
            ),
        )
        .unwrap()
        .asset
        .unwrap();
    assert_eq!(file.path_base, "repo");
    let resolved = h
        .store
        .resolve_file(ResolveFile {
            asset_id: file.asset.id.clone(),
            working_directory: Some(worktree.to_string_lossy().into()),
        })
        .unwrap();
    assert_eq!(resolved.resolution_basis, "caller_worktree");
    assert_eq!(
        std::fs::read(resolved.resolved_path.unwrap()).unwrap(),
        b"worktree model"
    );
    assert!(
        h.store
            .resolve_file(ResolveFile {
                asset_id: file.asset.id,
                working_directory: Some(d.path().to_string_lossy().into())
            })
            .is_err()
    );
}
#[cfg(windows)]
#[test]
fn mv_cross_volume_copy_verify_publish_and_locked_staging_recovery() {
    use std::os::windows::fs::OpenOptionsExt;
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let s = Store::open(d.path().join("legacy.db")).unwrap();
    let (j, _) = s
        .create_jam("Cross-volume fixture", None, None, None, "UTC", "Human")
        .unwrap();
    let root =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-visuals/round11/r11-c/cross-volume");
    std::fs::create_dir_all(&root).unwrap();
    let target = tempfile::tempdir_in(root).unwrap();
    let dest = target.path().join("Board");
    let source_path = s.path.canonicalize().unwrap();
    let destination_path = target.path().canonicalize().unwrap();
    let drive = |p: &Path| match p.components().next() {
        Some(std::path::Component::Prefix(prefix)) => match prefix.kind() {
            std::path::Prefix::Disk(d) | std::path::Prefix::VerbatimDisk(d) => d,
            _ => panic!("Expected local drive"),
        },
        _ => panic!("Expected Windows path"),
    };
    assert_ne!(drive(&source_path), drive(&destination_path));
    let req = MoveProject {
        project_id: j.id.clone(),
        destination: dest.to_string_lossy().into(),
        request_id: "cross-volume".into(),
        cloud_acknowledged: false,
    };
    let receipt = m
        .advance_project_move(&s, req.clone(), Some("verified"))
        .unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        // Permit SQLite reads/writes, but hold back FILE_SHARE_DELETE so directory
        // publication encounters a real Windows file-lock/rename denial.
        .share_mode(3)
        .open(Path::new(&receipt.staging).join(".state/board.db"))
        .unwrap();
    assert!(m.move_project(&s, req.clone()).is_err());
    assert_eq!(
        s.project_operation_status("cross-volume").unwrap().state,
        "verified"
    );
    drop(lock);
    assert_eq!(m.move_project(&s, req).unwrap().state, "committed");
    assert_eq!(m.capture_selected().unwrap().project_id, j.id);
}
#[test]
fn fi_restart_reconciles_cancelled_verified_orphans_after_grace_without_deleting_unowned_bytes() {
    let d = tempfile::tempdir().unwrap();
    let (m, h) = folder(d.path());
    let actor = h.store.current_member().unwrap().id;
    let source = d.path().join("orphan.blend");
    std::fs::write(&source, b"verified operation-owned bytes").unwrap();
    let c = Connection::open(&h.store.path).unwrap();
    c.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'fixture asset failure'); END;").unwrap();
    assert!(
        h.store
            .register_file(
                &actor,
                register(&source, FileStorageType::BoardFile, "orphan-request")
            )
            .is_err()
    );
    c.execute_batch("DROP TRIGGER fail_import;").unwrap();
    let stored: String = c
        .query_row(
            "SELECT result_json FROM file_operations WHERE request_id='orphan-request'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let stored: String = serde_json::from_str(&stored).unwrap();
    let target = h.folder.join(stored);
    assert!(target.is_file());
    h.store
        .cancel_file_operation(&actor, "orphan-request")
        .unwrap();
    c.execute("UPDATE file_operations SET created_at='2000-01-01T00:00:00Z' WHERE request_id='orphan-request'",[]).unwrap();
    let unrelated = h.folder.join("files/other/keep-owner-data.txt");
    std::fs::write(&unrelated, b"never operation-owned").unwrap();
    m.open(&h.folder, false, false).unwrap();
    assert!(!target.exists());
    assert!(source.is_file());
    assert_eq!(std::fs::read(unrelated).unwrap(), b"never operation-owned");
}
