use jam_core::*;
fn setup() -> (tempfile::TempDir, Store) {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let store = Store::open(dir.path().join("jam.db")).unwrap();
    store.seed_demo().unwrap();
    (dir, store)
}
#[test]
fn debug_bulk_and_empty_state_command_errors() {
    let (_dir, store) = setup();
    let before = store.latest_seq().unwrap();
    store.seed_bulk(2).unwrap();
    assert_eq!(store.query_tasks(TaskQuery::default()).unwrap().total, 34);
    assert_eq!(store.latest_seq().unwrap(), before + 2);
    assert!(matches!(
        store.seed_bulk(5001),
        Err(Error::Validation { .. })
    ));
    assert!(matches!(
        store.unarchive_current_task("JB-404"),
        Err(Error::NotFound(_))
    ));
    store.archive_current_task("JB-1", None).unwrap();
    assert_eq!(store.query_tasks(TaskQuery::default()).unwrap().total, 33);
    assert_eq!(
        store
            .query_tasks(TaskQuery {
                include_archived: Some(true),
                ..Default::default()
            })
            .unwrap()
            .total,
        34
    );
}
fn edit(store: &Store, key: &str, fields: serde_json::Value) -> Result<TaskDetail> {
    let mut value = fields;
    value["key"] = key.into();
    value["expectedUpdatedAt"] = store.get_task(key)?.task.updated_at.into();
    store.update_current_task(serde_json::from_value(value).unwrap())
}
#[test]
fn sql_filters_and_ranked_numeric_sorts() {
    let (_dir, store) = setup();
    let list = |query| store.query_tasks(query).unwrap().tasks;
    let tasks = list(TaskQuery {
        sort: Some(TaskSort {
            field: "key".into(),
            dir: "asc".into(),
        }),
        ..Default::default()
    });
    assert_eq!(tasks.len(), 32);
    assert_eq!(tasks[8].key, "JB-9");
    assert_eq!(tasks[9].key, "JB-10");
    for (field, ranks) in [
        ("status", STATUSES.to_vec()),
        ("priority", PRIORITIES.to_vec()),
    ] {
        let tasks = list(TaskQuery {
            sort: Some(TaskSort {
                field: field.into(),
                dir: "asc".into(),
            }),
            ..Default::default()
        });
        let values = tasks
            .iter()
            .map(|t| {
                if field == "status" {
                    &t.status
                } else {
                    &t.priority
                }
            })
            .map(|s| ranks.iter().position(|rank| rank == s).unwrap())
            .collect::<Vec<_>>();
        assert!(values.windows(2).all(|p| p[0] <= p[1]));
    }
    let agents = list(TaskQuery {
        assignee: Some("agents".into()),
        ..Default::default()
    });
    assert_eq!(agents.len(), 3);
    let humans = list(TaskQuery {
        assignee: Some("humans".into()),
        ..Default::default()
    });
    assert!(humans.iter().all(|t| t.assignee_id.is_some()));
    let me = store.current_member().unwrap();
    assert!(
        list(TaskQuery {
            assignee: Some(me.id.clone()),
            ..Default::default()
        })
        .iter()
        .all(|t| t.assignee_id.as_deref() == Some(&me.id))
    );
    assert_eq!(
        list(TaskQuery {
            text: Some("JB-10".into()),
            ..Default::default()
        })
        .len(),
        1
    );
    assert!(
        !list(TaskQuery {
            tags: Some(vec![" UI ".into()]),
            status: Some(vec!["todo".into()]),
            ..Default::default()
        })
        .is_empty()
    );
    assert!(
        store
            .query_tasks(TaskQuery {
                status: Some(vec!["wrong".into()]),
                ..Default::default()
            })
            .is_err()
    );
    assert!(
        store
            .query_tasks(TaskQuery {
                sort: Some(TaskSort {
                    field: "key; DROP TABLE tasks".into(),
                    dir: "asc".into()
                }),
                ..Default::default()
            })
            .is_err()
    );
    assert!(
        store
            .query_tasks(TaskQuery {
                sort: Some(TaskSort {
                    field: "key".into(),
                    dir: "sideways".into()
                }),
                ..Default::default()
            })
            .is_err()
    );
}
#[test]
fn updated_sort_keeps_rfc3339_fraction_precision_and_query_is_read_only() {
    let (_dir, store) = setup();
    let connection = rusqlite::Connection::open(&store.path).unwrap();
    for (key, stamp) in [
        ("JB-1", "2026-10-19T12:00:00.1Z"),
        ("JB-2", "2026-10-19T12:00:00.11Z"),
        ("JB-3", "2026-10-19T12:00:00.100000001Z"),
    ] {
        connection
            .execute("UPDATE tasks SET updated_at=? WHERE key=?", [stamp, key])
            .unwrap();
    }
    let before = store.latest_seq().unwrap();
    let tasks = store
        .query_tasks(TaskQuery {
            text: Some("JB-".into()),
            sort: Some(TaskSort {
                field: "updatedAt".into(),
                dir: "desc".into(),
            }),
            ..Default::default()
        })
        .unwrap()
        .tasks;
    let selected = tasks
        .iter()
        .filter(|t| ["JB-1", "JB-2", "JB-3"].contains(&t.key.as_str()))
        .map(|t| t.key.as_str())
        .collect::<Vec<_>>();
    assert_eq!(selected, vec!["JB-2", "JB-3", "JB-1"]);
    assert_eq!(store.latest_seq().unwrap(), before);
}
#[test]
fn atomic_patch_version_conflict_nullable_fields_and_one_event() {
    let (_dir, store) = setup();
    let original = store.get_task("JB-7").unwrap();
    let seq = store.latest_seq().unwrap();
    let updated = edit(&store, "JB-7", serde_json::json!({"title":"Warm jump buffer", "status":"review", "priority":"low", "assigneeId":null, "estimate":null, "dueAt":null, "tags":[" UI ","ui"]})).unwrap();
    assert_eq!(updated.task.tags, ["ui"]);
    assert!(updated.task.estimate.is_none());
    assert!(updated.task.assignee_id.is_none());
    assert_eq!(updated.task.status, "review");
    assert_eq!(store.latest_seq().unwrap(), seq + 1);
    assert_ne!(updated.task.updated_at, original.task.updated_at);
    assert_eq!(
        store.list_board_tasks().unwrap()["review"]
            .last()
            .unwrap()
            .key,
        "JB-7"
    );
    let stale: TaskEditInput=serde_json::from_value(serde_json::json!({"key":"JB-7","expectedUpdatedAt":original.task.updated_at,"title":"Stale"})).unwrap();
    assert!(matches!(
        store.update_current_task(stale),
        Err(Error::Conflict)
    ));
    assert_eq!(store.latest_seq().unwrap(), seq + 1);
    assert_eq!(
        store.get_task("JB-7").unwrap().task.title,
        "Warm jump buffer"
    );
    for patch in [
        serde_json::json!({"title":""}),
        serde_json::json!({"priority":"urgent"}),
        serde_json::json!({"status":"hidden"}),
        serde_json::json!({"estimate":4}),
        serde_json::json!({"dueAt":"yesterday"}),
        serde_json::json!({"tags":["x".repeat(25)]}),
    ] {
        assert!(matches!(
            edit(&store, "JB-7", patch),
            Err(Error::Validation { .. })
        ));
    }
    let before = store.get_task("JB-7").unwrap();
    edit(
        &store,
        "JB-7",
        serde_json::json!({"descriptionMd":"New description"}),
    )
    .unwrap();
    let after = store.get_task("JB-7").unwrap();
    assert_eq!(after.task.title, before.task.title);
    assert_eq!(after.task.description_md, "New description");
}
#[test]
fn archive_comment_tags_and_fifty_history_entries() {
    let (_dir, store) = setup();
    assert!(
        store
            .list_tags()
            .unwrap()
            .iter()
            .any(|t| t.tag == "ui" && t.count > 0)
    );
    assert!(matches!(
        store.add_current_comment("JB-7", ""),
        Err(Error::Validation { .. })
    ));
    assert!(
        store
            .add_current_comment("JB-7", &"x".repeat(4001))
            .is_err()
    );
    for i in 0..55 {
        store
            .add_current_comment("JB-7", &format!("Note {i}"))
            .unwrap();
    }
    let detail = store.get_task("JB-7").unwrap();
    assert_eq!(detail.history.len(), 50);
    assert_eq!(detail.activity.len(), 20);
    assert!(detail.comments.len() >= 55);
    assert!(detail.history.windows(2).all(|p| p[0].seq < p[1].seq));
    assert!(store.archive_current_task("JB-7", Some("")).is_err());
    store
        .archive_current_task("JB-7", Some("Keep for later"))
        .unwrap();
    assert!(store.get_task("JB-7").unwrap().task.archived_at.is_some());
    assert!(edit(&store, "JB-7", serde_json::json!({"title":"No"})).is_err());
    store.unarchive_current_task("JB-7").unwrap();
    assert!(store.get_task("JB-7").unwrap().task.archived_at.is_none());
    assert!(matches!(
        store.archive_current_task("JB-404", None),
        Err(Error::NotFound(_))
    ));
    assert!(matches!(
        store.unarchive_current_task("JB-404"),
        Err(Error::NotFound(_))
    ));
    store.set_setting("current_member_id", "missing").unwrap();
    assert!(store.unarchive_current_task("JB-7").is_err());
}
