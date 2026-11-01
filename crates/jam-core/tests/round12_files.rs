use jam_core::*;
use rusqlite::{Connection, params};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

struct Fixture {
    store: Arc<Store>,
    actor: String,
    anchor: PathBuf,
    folder: bool,
    _handle: Option<Arc<ProjectHandle>>,
    _manager: Option<ProjectManager>,
    dir: tempfile::TempDir,
}
fn fixture(folder: bool) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    if folder {
        let manager = ProjectManager::new(dir.path().join("fictional-appdata")).unwrap();
        let handle = manager
            .create(&dir.path().join("Board"), "Files", false)
            .unwrap();
        Fixture {
            store: handle.store.clone(),
            actor: handle.store.current_member().unwrap().id,
            anchor: handle.folder.clone(),
            folder,
            _handle: Some(handle),
            _manager: Some(manager),
            dir,
        }
    } else {
        let store = Arc::new(Store::open(dir.path().join("fictional-appdata/jam.db")).unwrap());
        let (jam, actor) = store
            .create_jam("Files", None, None, None, "UTC", "Human")
            .unwrap();
        Fixture {
            store,
            actor: actor.id,
            anchor: dir.path().join("fictional-appdata/projects").join(jam.id),
            folder,
            _handle: None,
            _manager: None,
            dir,
        }
    }
}
impl Fixture {
    fn state(&self) -> PathBuf {
        if self.folder {
            self.anchor.join(".state")
        } else {
            self.anchor.clone()
        }
    }
    fn source(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
    fn register(&self, path: &Path, storage: FileStorageType, request: &str) -> FileAsset {
        self.store
            .register_file(
                &self.actor,
                RegisterFile {
                    storage_type: storage,
                    source_path: Some(display_path(path)),
                    url: None,
                    path_base: None,
                    file_kind: None,
                    name: None,
                    notes: None,
                    companions: None,
                    request_id: Some(request.into()),
                    task_key: None,
                    role: None,
                    expected_claim_generation: None,
                    expected_updated_at: None,
                    working_directory: None,
                },
            )
            .unwrap()
            .asset
            .unwrap()
    }
    fn fresh(&self, id: &str) -> FileAsset {
        self.store
            .file_asset_fresh(ResolveFile {
                asset_id: id.into(),
                working_directory: None,
            })
            .unwrap()
    }
    fn project_link(&self, id: &str, request: &str) -> CompactMutation {
        self.store
            .link_file(
                &self.actor,
                LinkFileInput {
                    scope: FileScope {
                        kind: ScopeKind::Project,
                        key: None,
                    },
                    asset_id: id.into(),
                    role: None,
                    request_id: Some(request.into()),
                    expected_updated_at: None,
                    expected_claim_generation: None,
                },
            )
            .unwrap()
    }
}

#[test]
fn unused_board_file_deletion_moves_bytes_to_trash_in_folder_and_legacy_layouts() {
    for folder in [true, false] {
        let f = fixture(folder);
        let source = f.source("plan.md", b"retained plan bytes");
        let asset = f.register(&source, FileStorageType::BoardFile, "register-plan");
        let path = PathBuf::from(asset.resolution.resolved_path.clone().unwrap());
        let input = DeleteAssetInput {
            asset_id: asset.asset.id.clone(),
            request_id: Some("delete-plan".into()),
            force: false,
        };
        let result = f.store.delete_asset(&f.actor, input.clone()).unwrap();
        assert!(!path.exists());
        assert_eq!(std::fs::read(&source).unwrap(), b"retained plan bytes");
        let date = std::fs::read_dir(f.state().join("trash"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(date.file_name().unwrap().to_string_lossy().len(), 8);
        let trash = date.join(format!("{}-plan.md", asset.asset.id));
        assert_eq!(std::fs::read(trash).unwrap(), b"retained plan bytes");
        assert_eq!(
            Connection::open(&f.store.path)
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM assets WHERE id=?",
                    [&asset.asset.id],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let version = f.store.folder_session_context().unwrap().board_revision;
        let replay = f.store.delete_asset(&f.actor, input).unwrap();
        assert_eq!(replay.id, result.id);
        assert_eq!(replay.replayed, Some(true));
        assert_eq!(
            f.store.folder_session_context().unwrap().board_revision,
            version
        );
    }
}

#[test]
fn in_use_error_preserves_every_link_and_force_archives_canvas_and_removes_links() {
    let f = fixture(true);
    let source = f.source("reference.md", b"reference bytes");
    let item = f
        .store
        .add_reference(
            &f.actor,
            AddReference {
                kind: ReferenceKind::Asset,
                file_path: Some(display_path(&source)),
                storage_type: Some(FileStorageType::BoardFile),
                request_id: Some("reference".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let id = item.asset_id.clone().unwrap();
    let asset = f.fresh(&id);
    let path = PathBuf::from(asset.resolution.resolved_path.unwrap());
    let story = f.store.default_task_story(&f.actor).unwrap();
    let task = f
        .store
        .create_task(
            &f.actor,
            CreateTask {
                title: "Task".into(),
                story_key: Some(story.key),
                ..Default::default()
            },
        )
        .unwrap();
    f.store
        .link_file(
            &f.actor,
            LinkFileInput {
                scope: FileScope {
                    kind: ScopeKind::Task,
                    key: Some(task.task.key.clone()),
                },
                asset_id: id.clone(),
                role: None,
                request_id: Some("task-link".into()),
                expected_updated_at: Some(task.task.updated_at),
                expected_claim_generation: Some(task.task.claim_generation),
            },
        )
        .unwrap();
    f.project_link(&id, "project-link");
    let parent = f
        .store
        .create_asset(
            &f.actor,
            "model",
            "Parent",
            "https://example.test/model",
            None,
        )
        .unwrap();
    let c = Connection::open(&f.store.path).unwrap();
    c.execute(
        "INSERT INTO task_presentation(task_id,cover_asset_id) VALUES(?,?)",
        params![task.task.id, id],
    )
    .unwrap();
    c.execute(
        "INSERT INTO asset_components VALUES(?,'reference.md',?)",
        params![parent.id, id],
    )
    .unwrap();
    let usage = f.store.asset_usage(&id).unwrap();
    assert_eq!(usage.count(), 4);
    assert_eq!(usage.tasks.len(), 1);
    assert_eq!(usage.scopes.len(), 1);
    assert_eq!(usage.canvas.len(), 1);
    assert_eq!(usage.covers.len(), 1);
    assert_eq!(usage.components, [parent.id]);
    let before = f.store.folder_session_context().unwrap().board_revision;
    let result = f.store.delete_asset(
        &f.actor,
        DeleteAssetInput {
            asset_id: id.clone(),
            request_id: Some("warn-delete".into()),
            force: false,
        },
    );
    assert!(matches!(result,Err(Error::InUse{usage:ref returned}) if returned.count()==4));
    assert_eq!(
        f.store.folder_session_context().unwrap().board_revision,
        before
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"reference bytes");
    assert_eq!(f.store.asset_usage(&id).unwrap().count(), 4);
    f.store
        .delete_asset(
            &f.actor,
            DeleteAssetInput {
                asset_id: id.clone(),
                request_id: Some("force-delete".into()),
                force: true,
            },
        )
        .unwrap();
    assert!(!path.exists());
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM task_assets WHERE asset_id=?",
            [&id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM scope_files WHERE asset_id=?",
            [&id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        c.query_row(
            "SELECT cover_asset_id FROM task_presentation WHERE task_id=?",
            [&task.task.id],
            |r| r.get::<_, Option<String>>(0)
        )
        .unwrap(),
        None
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM asset_components WHERE component_asset_id=?",
            [&id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    let canvas = c
        .query_row(
            "SELECT archived_at,asset_id,caption_md FROM ref_items WHERE id=?",
            [&item.audit.id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .unwrap();
    assert!(canvas.0.is_some());
    assert!(canvas.1.is_none());
    assert_eq!(canvas.2, item.caption_md);
    let export = f.store.export_jam().unwrap();
    let destination = Store::open(f.dir.path().join("restored.db")).unwrap();
    let (_, human) = destination
        .create_jam("Destination", None, None, None, "UTC", "Human")
        .unwrap();
    destination
        .import_jam_json(&human.id, &serde_json::to_string(&export).unwrap())
        .unwrap();
}

#[test]
fn deleting_linked_file_never_changes_project_bytes() {
    let f = fixture(false);
    let source = f.source("project.txt", b"project-owned bytes");
    let file = f.register(&source, FileStorageType::LinkedFile, "linked");
    f.store
        .delete_asset(
            &f.actor,
            DeleteAssetInput {
                asset_id: file.asset.id,
                request_id: Some("delete-link".into()),
                force: false,
            },
        )
        .unwrap();
    assert_eq!(std::fs::read(source).unwrap(), b"project-owned bytes");
    assert!(!f.state().join("trash").exists());
}

#[test]
fn replace_keeps_revisions_newest_first_replays_and_rename_keeps_disk_name() {
    for folder in [true, false] {
        let f = fixture(folder);
        let source = f.source("plan.md", b"old plan");
        let file = f.register(&source, FileStorageType::BoardFile, "plan");
        let id = file.asset.id.clone();
        let disk = PathBuf::from(file.resolution.resolved_path.clone().unwrap());
        f.store
            .rename_asset(
                &f.actor,
                RenameAssetInput {
                    asset_id: id.clone(),
                    name: "Renamed plan".into(),
                    request_id: Some("rename".into()),
                },
            )
            .unwrap();
        let renamed = f.fresh(&id);
        assert_eq!(renamed.asset.name, "Renamed plan");
        assert_eq!(renamed.stored_path, file.stored_path);
        assert!(disk.is_file());
        let new = f.source("new.webm", b"new video fixture");
        let input = ReplaceAssetInput {
            asset_id: id.clone(),
            source_path: Some(display_path(&new)),
            url: None,
            request_id: Some("replace-1".into()),
        };
        f.store.replace_asset(&f.actor, input.clone()).unwrap();
        let replaced = f.fresh(&id);
        assert_eq!(replaced.content_revision, 2);
        assert_eq!(replaced.asset.kind, "video");
        assert_eq!(replaced.mime_type.as_deref(), Some("video/webm"));
        assert_eq!(replaced.stored_path, file.stored_path);
        assert_eq!(replaced.asset.name, "Renamed plan");
        assert_eq!(std::fs::read(&disk).unwrap(), b"new video fixture");
        let history = f.store.list_asset_revisions(&id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].revision, 1);
        assert_eq!(history[0].created_by, f.actor);
        assert_eq!(std::fs::read(&history[0].stored_path).unwrap(), b"old plan");
        assert!(
            Path::new(&history[0].stored_path)
                .canonicalize()
                .unwrap()
                .starts_with(f.state().canonicalize().unwrap())
        );
        assert_eq!(
            f.store
                .replace_asset(&f.actor, input.clone())
                .unwrap()
                .replayed,
            Some(true)
        );
        assert_eq!(f.fresh(&id).content_revision, 2);
        let third = f.source("third.txt", b"third document");
        assert!(matches!(
            f.store.replace_asset(
                &f.actor,
                ReplaceAssetInput {
                    source_path: Some(display_path(&third)),
                    ..input
                }
            ),
            Err(Error::IdempotencyConflict(_))
        ));
        f.store
            .replace_asset(
                &f.actor,
                ReplaceAssetInput {
                    asset_id: id.clone(),
                    source_path: Some(display_path(&third)),
                    url: None,
                    request_id: Some("replace-2".into()),
                },
            )
            .unwrap();
        let history = f.store.list_asset_revisions(&id).unwrap();
        assert_eq!(
            history.iter().map(|r| r.revision).collect::<Vec<_>>(),
            [2, 1]
        );
        assert_eq!(
            std::fs::read(&history[0].stored_path).unwrap(),
            b"new video fixture"
        );
    }
}

#[test]
fn scope_uniqueness_archive_filters_and_unlink_preserve_bytes() {
    let f = fixture(true);
    let source = f.source("plan.md", b"plan");
    let asset = f.register(&source, FileStorageType::BoardFile, "plan");
    let id = asset.asset.id;
    let first = f.project_link(&id, "project-link");
    assert_eq!(f.project_link(&id, "project-link").replayed, Some(true));
    assert_eq!(f.project_link(&id, "another-logical-link").id, first.id);
    assert_eq!(
        Connection::open(&f.store.path)
            .unwrap()
            .query_row("SELECT count(*) FROM scope_files", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    let query = FileAssetQuery {
        scope: Some(FileScope {
            kind: ScopeKind::Project,
            key: None,
        }),
        ..Default::default()
    };
    assert_eq!(
        f.store.list_file_assets(query.clone()).unwrap()[0].usage_count,
        1
    );
    f.store
        .archive_asset(
            &f.actor,
            AssetRequestInput {
                asset_id: id.clone(),
                request_id: Some("archive".into()),
            },
        )
        .unwrap();
    assert!(f.store.list_file_assets(query.clone()).unwrap().is_empty());
    assert!(
        f.store
            .assets_with_tasks(AssetQuery {
                scope: query.scope.clone(),
                ..Default::default()
            })
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        f.store
            .assets_with_tasks(AssetQuery {
                scope: query.scope.clone(),
                include_archived: true,
                ..Default::default()
            })
            .unwrap()
            .len(),
        1
    );
    let archived = f
        .store
        .list_file_assets(FileAssetQuery {
            include_archived: Some(true),
            ..query.clone()
        })
        .unwrap();
    assert_eq!(archived.len(), 1);
    assert!(archived[0].asset.archived_at.is_some());
    assert_eq!(archived[0].usage_count, 1);
    f.store
        .unarchive_asset(
            &f.actor,
            AssetRequestInput {
                asset_id: id.clone(),
                request_id: Some("unarchive".into()),
            },
        )
        .unwrap();
    assert_eq!(f.store.list_file_assets(query).unwrap().len(), 1);
    f.store
        .unlink_file(
            &f.actor,
            UnlinkFileInput {
                scope: FileScope {
                    kind: ScopeKind::Project,
                    key: None,
                },
                asset_id: id.clone(),
                request_id: Some("unlink".into()),
                expected_updated_at: None,
                expected_claim_generation: None,
            },
        )
        .unwrap();
    assert_eq!(f.store.asset_usage(&id).unwrap().count(), 0);
    assert_eq!(
        std::fs::read(f.fresh(&id).resolution.resolved_path.unwrap()).unwrap(),
        b"plan"
    );
}

#[test]
fn failed_database_delete_and_replace_restore_the_current_bytes_and_allow_retry() {
    let f = fixture(false);
    let source = f.source("plan.md", b"old plan");
    let file = f.register(&source, FileStorageType::BoardFile, "plan");
    let id = file.asset.id.clone();
    let path = PathBuf::from(file.resolution.resolved_path.unwrap());
    let c = Connection::open(&f.store.path).unwrap();
    c.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT,'fixture interruption'); END;").unwrap();
    let before = f.store.folder_session_context().unwrap().board_revision;
    assert!(
        f.store
            .delete_asset(
                &f.actor,
                DeleteAssetInput {
                    asset_id: id.clone(),
                    request_id: Some("interrupted-delete".into()),
                    force: false
                }
            )
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"old plan");
    assert_eq!(
        f.store.folder_session_context().unwrap().board_revision,
        before
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM write_receipts WHERE tool='delete_asset'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    c.execute_batch("DROP TRIGGER fail_delete; CREATE TRIGGER fail_replace BEFORE INSERT ON asset_revisions BEGIN SELECT RAISE(ABORT,'fixture interruption'); END;").unwrap();
    let replacement = f.source("replacement.txt", b"new bytes");
    let input = ReplaceAssetInput {
        asset_id: id.clone(),
        source_path: Some(display_path(&replacement)),
        url: None,
        request_id: Some("interrupted-replace".into()),
    };
    assert!(f.store.replace_asset(&f.actor, input.clone()).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"old plan");
    assert_eq!(f.fresh(&id).content_revision, 1);
    assert!(f.store.list_asset_revisions(&id).unwrap().is_empty());
    c.execute_batch("DROP TRIGGER fail_replace;").unwrap();
    f.store.replace_asset(&f.actor, input.clone()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new bytes");
    assert_eq!(f.store.list_asset_revisions(&id).unwrap().len(), 1);
    assert_eq!(
        f.store.replace_asset(&f.actor, input).unwrap().replayed,
        Some(true)
    );
}

#[test]
fn opening_after_an_interrupted_trash_move_recovers_the_uncommitted_file() {
    let f = fixture(false);
    let source = f.source("plan.md", b"retained bytes");
    let asset = f.register(&source, FileStorageType::BoardFile, "plan");
    let path = PathBuf::from(asset.resolution.resolved_path.unwrap());
    let relative = format!("trash/20261031/{}-plan.md", asset.asset.id);
    let trash = f.state().join(&relative);
    std::fs::create_dir_all(trash.parent().unwrap()).unwrap();
    let operations = f.state().join("asset-operations");
    std::fs::create_dir_all(&operations).unwrap();
    std::fs::write(operations.join("asset-interrupted.json"),serde_json::to_vec(&serde_json::json!({"assetId":asset.asset.id,"databaseGeneration":f.store.folder_session_context().unwrap().database_generation,"action":"delete","retainedPath":relative,"oldRevision":1,"oldHash":asset.content_hash,"newHash":null})).unwrap()).unwrap();
    std::fs::rename(&path, &trash).unwrap();
    assert!(!path.exists());
    let reopened = Store::open(&f.store.path).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"retained bytes");
    assert!(!trash.exists());
    assert_eq!(
        reopened.list_file_assets(Default::default()).unwrap().len(),
        1
    );
}

#[test]
fn project_move_preserves_archived_files_revisions_trash_and_scope_links() {
    let f = fixture(false);
    let source = f.source("plan.md", b"old");
    let asset = f.register(&source, FileStorageType::BoardFile, "plan");
    let id = asset.asset.id.clone();
    f.project_link(&id, "project");
    let new = f.source("new.txt", b"new");
    f.store
        .replace_asset(
            &f.actor,
            ReplaceAssetInput {
                asset_id: id.clone(),
                source_path: Some(display_path(&new)),
                url: None,
                request_id: Some("replace".into()),
            },
        )
        .unwrap();
    f.store
        .archive_asset(
            &f.actor,
            AssetRequestInput {
                asset_id: id.clone(),
                request_id: Some("archive".into()),
            },
        )
        .unwrap();
    let deleted = f.register(
        &f.source("deleted.txt", b"trashed"),
        FileStorageType::BoardFile,
        "trash-source",
    );
    f.store
        .delete_asset(
            &f.actor,
            DeleteAssetInput {
                asset_id: deleted.asset.id,
                request_id: Some("trash".into()),
                force: false,
            },
        )
        .unwrap();
    let manager = ProjectManager::new(f.dir.path().join("move-appdata")).unwrap();
    let project = f.store.active_jam().unwrap().id;
    let receipt = manager
        .move_project(
            &f.store,
            MoveProject {
                project_id: project.clone(),
                destination: display_path(&f.dir.path().join("Moved")),
                request_id: "move-with-history".into(),
                cloud_acknowledged: false,
            },
        )
        .unwrap();
    assert_eq!(receipt.state, "committed");
    let moved = manager.resolve_handle(Some(&project), None).unwrap();
    let file = moved
        .store
        .file_asset_fresh(ResolveFile {
            asset_id: id.clone(),
            working_directory: None,
        })
        .unwrap();
    assert_eq!(
        std::fs::read(file.resolution.resolved_path.unwrap()).unwrap(),
        b"new"
    );
    assert!(file.asset.archived_at.is_some());
    assert_eq!(file.usage_count, 1);
    let history = moved.store.list_asset_revisions(&id).unwrap();
    assert_eq!(std::fs::read(&history[0].stored_path).unwrap(), b"old");
    assert!(moved.folder.join(".state/trash").is_dir());
    assert!(
        receipt
            .file_hashes
            .keys()
            .any(|path| path.starts_with(".state/revisions/"))
    );
    assert!(
        receipt
            .file_hashes
            .keys()
            .any(|path| path.starts_with(".state/trash/"))
    );
}
