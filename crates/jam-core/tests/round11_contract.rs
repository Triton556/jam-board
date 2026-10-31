use jam_core::*;
use std::{collections::BTreeMap, path::Path, sync::Arc};

fn manager(root: &Path) -> ProjectManager {
    ProjectManager::new(root.join("fictional-appdata")).unwrap()
}
fn register(path: &Path, storage: &str, request: &str) -> RegisterFile {
    serde_json::from_value(serde_json::json!({"storageType":storage,"sourcePath":path.to_string_lossy(),"requestId":request})).unwrap()
}
fn tree(path: &Path) -> BTreeMap<String, u64> {
    fn visit(root: &Path, path: &Path, out: &mut BTreeMap<String, u64>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                visit(root, &p, out);
            } else {
                out.insert(
                    p.strip_prefix(root).unwrap().to_string_lossy().into(),
                    p.metadata().unwrap().len(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    visit(path, path, &mut out);
    out
}
#[test]
fn recent_removal_is_registry_only_and_refuses_current_or_unknown_instance() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let a = m.create(&d.path().join("A"), "A", false).unwrap();
    let before = serde_json::to_value(m.registry.entries().unwrap()).unwrap();
    assert!(m.remove_recent_project_folder(&a.instance_id).is_err());
    assert!(matches!(
        m.remove_recent_project_folder("unknown"),
        Err(Error::NotFound(_))
    ));
    assert_eq!(
        before,
        serde_json::to_value(m.registry.entries().unwrap()).unwrap()
    );
    m.close().unwrap();
    let files = tree(&a.folder);
    m.remove_recent_project_folder(&a.instance_id).unwrap();
    assert!(m.registry.entries().unwrap().is_empty());
    assert_eq!(tree(&a.folder), files);
    assert_eq!(
        m.open(&a.folder, false, false).unwrap().project_id,
        a.project_id
    );
}
#[test]
fn locate_checks_identity_before_mutation_and_replaces_old_path() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let a = m.create(&d.path().join("A"), "A", false).unwrap();
    let b = m.create(&d.path().join("B"), "B", false).unwrap();
    let before = serde_json::to_value(m.registry.entries().unwrap()).unwrap();
    for (instance, expected) in [
        (&a.instance_id, &a.project_id),
        (&a.instance_id, &b.project_id),
    ] {
        assert!(
            matches!(m.locate_project_folder(instance,expected,&b.folder,false),Err(Error::Validation { field,.. }) if field=="expectedProjectId")
        );
        assert_eq!(
            before,
            serde_json::to_value(m.registry.entries().unwrap()).unwrap()
        );
        assert_eq!(
            m.capture_selected().unwrap().command_context(),
            b.command_context()
        );
    }
    assert!(
        m.locate_project_folder("unknown", &a.project_id, &a.folder, false)
            .is_err()
    );
    m.close().unwrap();
    // Rename only after dropping all stores and allowing the publisher to quiesce via close.
    let old = a.folder.clone();
    let instance = a.instance_id.clone();
    let project = a.project_id.clone();
    drop(a);
    let target = d.path().join("Relocated");
    // A folder may still have a scheduled publisher; retry Windows rename briefly.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match std::fs::rename(&old, &target) {
            Ok(()) => break,
            Err(_) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(50))
            }
            Err(e) => panic!("{e}"),
        }
    }
    let located = m
        .locate_project_folder(&instance, &project, &target, false)
        .unwrap();
    assert_eq!(located.project_id, project);
    assert_eq!(located.instance_id, instance);
    assert_eq!(
        m.registry.resolve(&project, None).unwrap().canonical_folder,
        target.canonicalize().unwrap().to_string_lossy()
    );
}
#[test]
fn move_preview_is_read_only_and_counts_scoped_inventory_policy_and_ownership() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let legacy = Store::open(d.path().join("legacy.db")).unwrap();
    let (a, owner) = legacy
        .create_jam("A", None, None, None, "UTC", "Owner")
        .unwrap();
    let managed = d.path().join("references");
    std::fs::create_dir(&managed).unwrap();
    let copied = managed.join("owned.txt");
    std::fs::write(&copied, b"12345").unwrap();
    let linked = d.path().join("linked.txt");
    std::fs::write(&linked, b"1234567").unwrap();
    for (p, id) in [(&copied, "owned"), (&linked, "linked")] {
        legacy
            .register_file(&owner.id, register(p, "linked_file", id))
            .unwrap();
    }
    let missing = d.path().join("missing.txt");
    std::fs::write(&missing, b"x").unwrap();
    legacy
        .register_file(&owner.id, register(&missing, "linked_file", "missing"))
        .unwrap();
    std::fs::remove_file(&missing).unwrap();
    let task: CreateTask =
        serde_json::from_value(serde_json::json!({"title":"Scoped task"})).unwrap();
    legacy.create_current_task(task).unwrap();
    legacy
        .create_jam("Other", None, None, None, "UTC", "Other")
        .unwrap();
    let scoped = legacy.for_project(&a.id).unwrap();
    let lease = scoped.project_lease().unwrap();
    let before = tree(d.path());
    let database = rusqlite::Connection::open(&legacy.path).unwrap();
    let receipts: i64 = database
        .query_row("SELECT count(*) FROM project_moves", [], |r| r.get(0))
        .unwrap();
    let preview = scoped
        .preview_project_move(&a.id, &d.path().join("Destination"))
        .unwrap();
    assert_eq!(preview.tasks.count, 1);
    assert!(preview.tasks.bytes > 2);
    assert_eq!(preview.managed_copies.count, 1);
    assert_eq!(preview.managed_copies.bytes, 5);
    assert_eq!(preview.linked_files.count, 2);
    assert_eq!(preview.linked_files.bytes, 7);
    assert_eq!(preview.missing_file_count, 1);
    assert_eq!(preview.missing_files.len(), 1);
    assert!(preview.has_bound_owners);
    assert!(preview.destination_policy.allowed);
    assert_eq!(tree(d.path()), before);
    assert_eq!(
        database
            .query_row("SELECT count(*) FROM project_moves", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        receipts
    );
    drop(lease);
    assert!(
        !scoped
            .preview_project_move(&a.id, &d.path().join("Destination"))
            .unwrap()
            .has_bound_owners
    );
    assert!(
        !scoped
            .preview_project_move(&a.id, Path::new("\\\\server\\share\\Jam"))
            .unwrap()
            .destination_policy
            .allowed
    );
    assert!(
        scoped
            .preview_project_move(&a.id, &d.path().join("OneDrive/Jam"))
            .unwrap()
            .destination_policy
            .cloud_acknowledgement_needed
    );
    assert!(
        scoped
            .preview_project_move(&a.id, &managed)
            .unwrap()
            .destination_policy
            .non_empty
    );
    assert!(m.registry.entries().unwrap().is_empty());
    for n in 0..105 {
        database.execute("INSERT INTO assets(id,jam_id,kind,name,location,created_by,created_at,storage_type,path_base,stored_path) VALUES(?,?,'document','Missing',?,?,'2026-10-30T00:00:00Z','linked_file','absolute',?)",rusqlite::params![format!("extra-missing-{n}"),a.id,missing.to_string_lossy(),owner.id,missing.to_string_lossy()]).unwrap();
    }
    let capped = scoped
        .preview_project_move(&a.id, &d.path().join("Destination"))
        .unwrap();
    assert_eq!(capped.missing_file_count, 106);
    assert_eq!(capped.missing_files.len(), 100);
}
#[test]
fn snapshot_timestamp_is_persisted_and_reopen_does_not_replace_it() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let h = m.create(&d.path().join("A"), "A", false).unwrap();
    h.store.flush_board_snapshot().unwrap();
    let timestamp = h.info().unwrap().last_snapshot_at.unwrap();
    let c = rusqlite::Connection::open(&h.store.path).unwrap();
    assert_eq!(
        c.query_row(
            "SELECT value FROM settings WHERE key='local.last_snapshot_at'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        timestamp
    );
    m.close().unwrap();
    let reopened = m.open(&h.folder, false, false).unwrap();
    reopened.store.flush_board_snapshot().unwrap();
    assert_eq!(
        reopened.info().unwrap().last_snapshot_at.as_deref(),
        Some(timestamp.as_str())
    );
    assert_eq!(reopened.info().unwrap().context, reopened.command_context());
}

#[test]
fn preview_of_registered_unselected_folder_never_registers_selects_or_creates_files() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let h = m
        .create(&d.path().join("Доска with spaces"), "A", false)
        .unwrap();
    let project = h.project_id.clone();
    // Build a closed clone that has never had a publisher scheduled. Reading the
    // live source's tree would race its independently scheduled snapshot worker.
    let path = d.path().join("Закрытая доска with spaces");
    std::fs::create_dir_all(path.join(".state/operations")).unwrap();
    for name in ["jamboard.json", "board.json"] {
        std::fs::copy(h.folder.join(name), path.join(name)).unwrap();
    }
    let source = rusqlite::Connection::open(&h.store.path).unwrap();
    source
        .execute(
            "VACUUM INTO ?",
            [path.join(".state/board.db").to_string_lossy()],
        )
        .unwrap();
    let closed = rusqlite::Connection::open(path.join(".state/board.db")).unwrap();
    closed.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    drop(closed);
    m.close().unwrap();
    let mut entry = m.registry.entries().unwrap().remove(0);
    entry.canonical_folder = path.canonicalize().unwrap().to_string_lossy().into();
    entry.display_folder = entry.canonical_folder.clone();
    let registry_fixture =
        rusqlite::Connection::open(d.path().join("fictional-appdata/registry.db")).unwrap();
    registry_fixture
        .execute(
            "UPDATE projects SET canonical_folder=?,entry_json=? WHERE instance_id=?",
            rusqlite::params![
                entry.canonical_folder,
                serde_json::to_string(&entry).unwrap(),
                entry.instance_id
            ],
        )
        .unwrap();
    let legacy = Store::open(d.path().join("legacy.db")).unwrap();
    let before = tree(&path);
    let registry = serde_json::to_value(m.registry.entries().unwrap()).unwrap();
    assert_eq!(
        m.preview_project_move(&legacy, &project, &d.path().join("Destination"))
            .unwrap()
            .tasks
            .count,
        0
    );
    assert!(m.capture_selected().is_err());
    assert_eq!(
        registry,
        serde_json::to_value(m.registry.entries().unwrap()).unwrap()
    );
    assert_eq!(before, tree(&path));
    assert!(!path.join(".state/operations/move-owner.json").exists());
}
fn init(name: &str) -> NewJamInput {
    NewJamInput {
        name: name.into(),
        theme: Some("Ocean".into()),
        starts_at: "".into(),
        ends_at: "".into(),
        timezone: "Asia/Vladivostok".into(),
        your_name: "Fictional owner".into(),
        template: Some("webapp".into()),
        milestone_at: Some("2026-12-01T00:00:00Z".into()),
    }
}

#[test]
fn registered_unselected_preview_reads_live_wal_without_selecting_or_writing() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let legacy = Store::open(d.path().join("legacy.db")).unwrap();
    let a = m.create(&d.path().join("A"), "A", false).unwrap();
    let b = m.create(&d.path().join("B"), "B", false).unwrap();
    let task: CreateTask =
        serde_json::from_value(serde_json::json!({"title":"Unpublished WAL task"})).unwrap();
    a.store.create_current_task(task).unwrap();
    let before = tree(&a.folder);
    assert_eq!(
        m.preview_project_move(&legacy, &a.project_id, &d.path().join("Destination"))
            .unwrap()
            .tasks
            .count,
        1
    );
    assert_eq!(
        m.capture_selected().unwrap().command_context(),
        b.command_context()
    );
    assert_eq!(before, tree(&a.folder));
}

#[test]
fn closed_folder_context_returns_conflict_even_without_a_legacy_selection() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let legacy = Arc::new(Store::open(d.path().join("empty.db")).unwrap());
    let h = m.create(&d.path().join("A"), "A", false).unwrap();
    let info = h.info().unwrap();
    m.close().unwrap();
    assert!(matches!(
        m.with_expected_context::<()>(&legacy, Some(&info.context), |_| panic!(
            "stale callback ran"
        )),
        Err(Error::Conflict)
    ));
    assert!(matches!(
        m.set_folder_rules_checked(
            Some(&info.context),
            info.manifest.folder_rules,
            &info.manifest_revision
        ),
        Err(Error::Conflict)
    ));
    let input = MoveProject {
        project_id: h.project_id.clone(),
        destination: d.path().join("Must not exist").to_string_lossy().into(),
        request_id: "closed-move".into(),
        cloud_acknowledged: false,
    };
    assert!(matches!(
        m.move_project_with_context_check(&legacy, input.clone(), Some(&info.context), || panic!(
            "owners checked before stale epoch"
        )),
        Err(Error::Conflict)
    ));
    assert!(matches!(
        m.move_project_with_context(&legacy, input, Some(&info.context)),
        Err(Error::Conflict)
    ));
    assert!(
        m.registry
            .local_setting("move-source:closed-move")
            .unwrap()
            .is_none()
    );
}
#[test]
fn create_initialization_is_complete_and_failure_rolls_back() {
    let d = tempfile::tempdir().unwrap();
    let m = manager(d.path());
    let h = m
        .create_initialized(&d.path().join("A"), "A", false, Some(init("A")))
        .unwrap();
    let jam = h.store.active_jam().unwrap();
    assert_eq!(jam.template, "webapp");
    assert_eq!(jam.theme.as_deref(), Some("Ocean"));
    assert_eq!(jam.timezone, "Asia/Vladivostok");
    assert!(jam.milestone_at.is_some());
    assert_eq!(h.store.current_member().unwrap().name, "Fictional owner");
    let registry = serde_json::to_value(m.registry.entries().unwrap()).unwrap();
    let destination = d.path().join("Failure");
    std::fs::create_dir(&destination).unwrap();
    let mut invalid = init("Failure");
    invalid.milestone_at = Some("not-a-date".into());
    assert!(
        m.create_initialized(&destination, "Failure", false, Some(invalid))
            .is_err()
    );
    assert!(destination.is_dir());
    assert!(std::fs::read_dir(&destination).unwrap().next().is_none());
    assert!(!std::fs::read_dir(d.path()).unwrap().any(|p| {
        p.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".jam-create-")
    }));
    assert_eq!(
        registry,
        serde_json::to_value(m.registry.entries().unwrap()).unwrap()
    );
    assert_eq!(
        m.capture_selected().unwrap().command_context(),
        h.command_context()
    );
    assert!(
        m.create(&d.path().join("Old caller"), "Old caller", false)
            .is_ok()
    );
}
#[test]
fn folder_and_legacy_fences_reject_aba_and_serialize_selection_through_write() {
    let d = tempfile::tempdir().unwrap();
    let m = Arc::new(manager(d.path()));
    let legacy = Arc::new(Store::open(d.path().join("legacy.db")).unwrap());
    let (a, _) = legacy
        .create_jam("Legacy A", None, None, None, "UTC", "Owner")
        .unwrap();
    let old = m.selection_context(&legacy).unwrap();
    let (b, _) = legacy
        .create_jam("Legacy B", None, None, None, "UTC", "Owner")
        .unwrap();
    m.select_legacy_project(&legacy, &b.id).unwrap();
    m.select_legacy_project(&legacy, &a.id).unwrap();
    let current = m.selection_context(&legacy).unwrap();
    assert_ne!(old, current);
    let cwd = d
        .path()
        .join("fictional cwd")
        .to_string_lossy()
        .into_owned();
    let patch = || SettingsPatch {
        expected_project_id: Some(a.id.clone()),
        working_directory: Some(cwd.clone()),
        ..Default::default()
    };
    assert!(matches!(
        m.with_expected_context(&legacy, Some(&old), |s| s.set_settings(patch())),
        Err(Error::Conflict)
    ));
    assert_ne!(
        legacy.get_settings().unwrap().working_directory,
        Some(cwd.clone())
    );
    m.with_expected_context(&legacy, None, |s| s.set_settings(patch()))
        .unwrap();
    let folder = m.create(&d.path().join("Folder"), "Folder", false).unwrap();
    assert!(matches!(
        m.with_expected_context(&legacy, Some(&current), |s| s.set_settings(patch())),
        Err(Error::Conflict)
    ));
    let info = folder.info().unwrap();
    m.open(&folder.folder, false, false).unwrap();
    assert!(matches!(
        m.set_folder_rules_checked(
            Some(&info.context),
            info.manifest.folder_rules.clone(),
            &info.manifest_revision
        ),
        Err(Error::Conflict)
    ));
    let reopened = m.capture_selected().unwrap().info().unwrap();
    m.set_folder_rules_checked(
        None,
        reopened.manifest.folder_rules,
        &reopened.manifest_revision,
    )
    .unwrap();
    let move_input = MoveProject {
        project_id: folder.project_id.clone(),
        destination: d.path().join("Moved").to_string_lossy().into(),
        request_id: "stale-move".into(),
        cloud_acknowledged: false,
    };
    assert!(matches!(
        m.move_project_with_context(&legacy, move_input, Some(&info.context)),
        Err(Error::Conflict)
    ));
    assert!(
        m.registry
            .local_setting("move-source:stale-move")
            .unwrap()
            .is_none()
    );
    assert!(!d.path().join("Moved").exists());
    let context = m.selection_context(&legacy).unwrap();
    let (started, receive) = std::sync::mpsc::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let worker = m.clone();
    let data = legacy.clone();
    let write = std::thread::spawn(move || {
        worker.with_expected_context(&data, Some(&context), |s| {
            started.send(()).unwrap();
            wait.recv().unwrap();
            s.set_settings(SettingsPatch {
                expected_project_id: Some(s.active_jam()?.id),
                backup_recent_count: Some(3),
                ..Default::default()
            })
        })
    });
    receive.recv().unwrap();
    let switcher = m.clone();
    let data = legacy.clone();
    let target = a.id.clone();
    let (done, done_rx) = std::sync::mpsc::channel();
    let switch = std::thread::spawn(move || {
        switcher.select_legacy_project(&data, &target).unwrap();
        done.send(()).unwrap();
    });
    assert!(
        done_rx
            .recv_timeout(std::time::Duration::from_millis(60))
            .is_err()
    );
    release.send(()).unwrap();
    write.join().unwrap().unwrap();
    switch.join().unwrap();
    assert_eq!(folder.store.get_settings().unwrap().backup_recent_count, 3);
    assert_ne!(legacy.get_settings().unwrap().backup_recent_count, 3);
    let receipt = m
        .move_project_with_context(
            &legacy,
            MoveProject {
                project_id: a.id,
                destination: d.path().join("Old caller moved").to_string_lossy().into(),
                request_id: "old-caller-move".into(),
                cloud_acknowledged: false,
            },
            None,
        )
        .unwrap();
    assert_eq!(receipt.state, "committed");
}
