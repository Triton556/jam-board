use jam_core::*;
use serde_json::json;

fn fixture() -> (tempfile::TempDir, Store, String, String, String) {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("fictional.db")).unwrap();
    let (_, h) = s
        .create_jam("Compact", None, None, None, "UTC", "Human")
        .unwrap();
    let epic = s
        .create_epic(
            &h.id,
            NewEpic {
                title: "Lantern levels".into(),
                goal_md: Some("Preserve a readable route".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let mut first_task = String::new();
    for i in 0..4 {
        let story = s
            .create_story(
                &h.id,
                NewStory {
                    epic_key: epic.key.clone(),
                    title: format!("Story {i}"),
                    ..Default::default()
                },
            )
            .unwrap();
        for j in 0..if i == 3 { 3 } else { 4 } {
            let task = s
                .create_task(
                    &h.id,
                    CreateTask {
                        story_key: Some(story.key.clone()),
                        title: format!("Task {i}.{j}"),
                        description: Some("Large description ".repeat(1024)),
                        ..Default::default()
                    },
                )
                .unwrap();
            if first_task.is_empty() {
                first_task = task.task.key;
            }
        }
    }
    (d, s, h.id, epic.key, first_task)
}

#[test]
fn default_epic_four_stories_fifteen_tasks_fits_six_kib() {
    let (_d, s, _actor, key, _task) = fixture();
    let input = |depth| GetEpicInput {
        key: key.clone(),
        depth,
        include: None,
        journal_limit: None,
    };
    let default = s.get_epic_compact(input(EpicDepth::Stories)).unwrap();
    let bytes = serde_json::to_vec(&default).unwrap().len();
    assert!(bytes <= 6144, "default epic is {bytes} bytes");
    assert_eq!(default["stories"].as_array().unwrap().len(), 4);
    assert_eq!(default["taskCounts"]["backlog"], 15);
    assert!(default["stories"][0].get("tasks").is_none());
    assert!(default.get("journal").is_none());
    assert!(default.get("questions").is_none());
    assert!(default.get("readiness").is_none());
    serde_json::from_value::<CompactEpic>(default).unwrap();
    assert!(
        s.get_epic_compact(input(EpicDepth::Summary))
            .unwrap()
            .get("stories")
            .is_none()
    );
    let tasks = s.get_epic_compact(input(EpicDepth::Tasks)).unwrap();
    assert_eq!(tasks["stories"][0]["tasks"].as_array().unwrap().len(), 4);
    assert!(
        tasks["stories"][0]["tasks"][0]
            .get("descriptionMd")
            .is_none()
    );
    assert!(
        tasks["stories"][0]["tasks"][0]
            .get("readyIssueCount")
            .is_some()
    );
}

#[test]
fn task_keeps_validators_brief_files_and_short_ancestors_while_includes_are_opt_in() {
    let (_d, s, actor, _epic, key) = fixture();
    s.add_comment(&actor, &key, "Human note").unwrap();
    let input = |include| GetTaskInput {
        key: key.clone(),
        include,
        activity_limit: Some(1),
    };
    let compact = s.get_task_compact(input(None)).unwrap();
    for field in [
        "updatedAt",
        "claimGeneration",
        "brief",
        "files",
        "story",
        "epic",
        "reviewContextRevision",
    ] {
        assert!(compact.get(field).is_some(), "missing {field}");
    }
    assert_eq!(compact["story"].as_object().unwrap().len(), 3);
    assert_eq!(compact["epic"].as_object().unwrap().len(), 2);
    for field in [
        "comments",
        "activity",
        "history",
        "references",
        "reports",
        "reviews",
        "assets",
        "ancestorQuestions",
    ] {
        assert!(compact.get(field).is_none(), "unexpected {field}");
    }
    serde_json::from_value::<CompactTask>(compact).unwrap();
    let expanded = s
        .get_task_compact(input(Some(vec![
            TaskInclude::Comments,
            TaskInclude::Activity,
            TaskInclude::Story,
            TaskInclude::Epic,
            TaskInclude::Reports,
            TaskInclude::Reviews,
            TaskInclude::References,
        ])))
        .unwrap();
    assert_eq!(expanded["comments"].as_array().unwrap().len(), 1);
    assert_eq!(expanded["activity"].as_array().unwrap().len(), 1);
    assert!(expanded["story"].get("acceptance").is_some());
    assert!(expanded["epic"].get("goalMd").is_some());
    let full = s.get_task(&key).unwrap();
    assert_eq!(full.comments.len(), 1, "full resource input remains full");
    assert!(!full.history.is_empty());
}

#[test]
fn epic_sections_limits_and_compact_mutation_shape() {
    let (_d, s, _actor, key, _task) = fixture();
    let value = s
        .get_epic_compact(GetEpicInput {
            key: key.clone(),
            depth: EpicDepth::Summary,
            include: Some(vec![
                EpicInclude::Journal,
                EpicInclude::Readiness,
                EpicInclude::Questions,
                EpicInclude::Files,
            ]),
            journal_limit: Some(2),
        })
        .unwrap();
    assert_eq!(value["journal"].as_array().unwrap().len(), 2);
    assert_eq!(value["readiness"].as_object().unwrap().len(), 15);
    assert!(value.get("questions").is_some());
    assert!(value.get("files").is_some());
    assert!(
        s.get_epic_compact(GetEpicInput {
            key,
            depth: EpicDepth::Summary,
            include: None,
            journal_limit: Some(51)
        })
        .is_err()
    );
    let compact = compact_mutation(
        "task",
        &json!({"id":"id","key":"JB-1","title":"Hidden","updatedAt":"v1","claimGeneration":"g1","status":"ready","externalRef":"ls/1","replayed":true,"brief":{"goalMd":"Hidden"}}),
    );
    assert_eq!(
        compact,
        json!({"kind":"task","id":"id","key":"JB-1","updatedAt":"v1","claimGeneration":"g1","status":"ready","externalRef":"ls/1","replayed":true})
    );
}
