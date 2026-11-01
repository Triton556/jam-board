use jam_core::*;

fn fixture() -> (tempfile::TempDir, Store, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("fictional.db")).unwrap();
    let (_, human) = store
        .create_jam("Refs", None, None, None, "UTC", "Human")
        .unwrap();
    (dir, store, human.id)
}

#[test]
fn references_are_unique_per_kind_and_project_and_find_is_compact_and_pinned() {
    let (_dir, s, h) = fixture();
    let project = s.active_jam().unwrap().id;
    let epic = s
        .create_epic(
            &h,
            NewEpic {
                title: "Эпик — 🪨".into(),
                external_ref: Some("ls/shared".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let story = s
        .create_story(
            &h,
            NewStory {
                title: "История".into(),
                epic_key: epic.key.clone(),
                external_ref: Some("ls/shared".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let task = s
        .create_task(
            &h,
            CreateTask {
                title: "Задача".into(),
                story_key: Some(story.key.clone()),
                external_ref: Some("ls/shared".into()),
                ..Default::default()
            },
        )
        .unwrap();
    for kind in [RecordKind::Epic, RecordKind::Story, RecordKind::Task] {
        let rows = s
            .find(FindInput {
                kind: Some(kind),
                external_refs: Some(vec!["ls/shared".into()]),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, kind);
        assert_eq!(rows[0].claim_generation.is_some(), kind == RecordKind::Task);
    }
    let rows = s
        .find(FindInput {
            external_refs: Some(vec!["ls/shared".into()]),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(
        s.list_epics_with_ref(EpicListInput {
            external_ref: Some("ls/shared".into())
        })
        .unwrap()[0]
            .key,
        epic.key
    );
    assert_eq!(
        s.list_tasks(
            None,
            TaskFilter {
                external_ref: Some("ls/shared".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .tasks[0]
            .key,
        task.task.key
    );
    let revision = s.folder_session_context().unwrap().board_revision;
    assert!(
        matches!(s.create_epic(&h,NewEpic{title:"Duplicate".into(),external_ref:Some("ls/shared".into()),..Default::default()}),Err(Error::Validation{field,..}) if field=="externalRef")
    );
    assert_eq!(s.folder_session_context().unwrap().board_revision, revision);
    let pinned = s.for_project(&project).unwrap();
    let (_, other) = s
        .create_jam("Other", None, None, None, "UTC", "Other")
        .unwrap();
    s.create_epic(
        &other.id,
        NewEpic {
            title: "Same reference in another project".into(),
            external_ref: Some("ls/shared".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        pinned
            .find(FindInput {
                external_refs: Some(vec!["ls/shared".into()]),
                ..Default::default()
            })
            .unwrap()
            .len(),
        3
    );
    let wire = serde_json::to_value(rows).unwrap();
    assert!(
        wire.as_array()
            .unwrap()
            .iter()
            .all(|row| row.get("descriptionMd").is_none() && row.get("goalMd").is_none())
    );
}

#[test]
fn nullable_reference_patches_preserve_omissions_change_lookup_and_clear() {
    let (_dir, s, h) = fixture();
    let epic = s
        .create_epic(
            &h,
            NewEpic {
                title: "Epic".into(),
                external_ref: Some("old-epic".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let story = s
        .create_story(
            &h,
            NewStory {
                title: "Story".into(),
                epic_key: epic.key.clone(),
                external_ref: Some("old-story".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let task = s
        .create_task(
            &h,
            CreateTask {
                title: "Task".into(),
                story_key: Some(story.key.clone()),
                external_ref: Some("old-task".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let preserved = s
        .update_epic(
            &h,
            &epic.key,
            EpicPatch {
                title: Some("Revised title".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(preserved.external_ref.as_deref(), Some("old-epic"));
    s.update_epic(
        &h,
        &epic.key,
        EpicPatch {
            external_ref: Some(Some("new-epic".into())),
            ..Default::default()
        },
    )
    .unwrap();
    s.update_story(
        &h,
        &story.key,
        StoryPatch {
            external_ref: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    s.update_task(
        &h,
        UpdateTask {
            key: task.task.key.clone(),
            expected_updated_at: task.task.updated_at,
            expected_claim_generation: task.task.claim_generation,
            external_ref: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        s.get_story(&story.key)
            .unwrap()
            .story
            .external_ref
            .is_none()
    );
    assert!(
        s.get_task(&task.task.key)
            .unwrap()
            .task
            .external_ref
            .is_none()
    );
    assert!(
        s.find(FindInput {
            external_refs: Some(vec![
                "old-epic".into(),
                "old-story".into(),
                "old-task".into()
            ]),
            ..Default::default()
        })
        .unwrap()
        .is_empty()
    );
    assert_eq!(
        s.find(FindInput {
            external_refs: Some(vec!["new-epic".into()]),
            ..Default::default()
        })
        .unwrap()[0]
            .key,
        epic.key
    );
    s.update_epic(
        &h,
        &epic.key,
        EpicPatch {
            external_ref: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        s.list_epics_with_ref(EpicListInput {
            external_ref: Some("new-epic".into())
        })
        .unwrap()
        .is_empty()
    );
}

#[test]
fn invalid_references_and_lookup_bounds_write_nothing() {
    let (_dir, s, h) = fixture();
    let before = s.folder_session_context().unwrap().board_revision;
    for value in ["".into(), "   ".into(), "я".repeat(121)] {
        assert!(
            matches!(s.create_epic(&h,NewEpic{title:"Invalid reference".into(),external_ref:Some(value),..Default::default()}),Err(Error::Validation{field,..}) if field=="externalRef")
        );
    }
    for query in [
        FindInput {
            keys: Some(vec!["missing".into(); 501]),
            ..Default::default()
        },
        FindInput {
            external_refs: Some(vec!["ref".into(); 501]),
            ..Default::default()
        },
        FindInput {
            keys: Some(vec![" ".into()]),
            ..Default::default()
        },
    ] {
        assert!(matches!(s.find(query), Err(Error::Validation { .. })));
    }
    assert!(
        s.find(FindInput {
            keys: Some(vec!["missing".into(); 500]),
            ..Default::default()
        })
        .unwrap()
        .is_empty()
    );
    assert_eq!(s.folder_session_context().unwrap().board_revision, before);
}
