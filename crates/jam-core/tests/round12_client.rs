use jam_core::*;

#[test]
fn activity_client_is_per_store_clone_and_never_leaks_between_writers() {
    let d = tempfile::tempdir().unwrap();
    let store = Store::open(d.path().join("fictional.db")).unwrap();
    let (_, actor) = store
        .create_jam("Clients", None, None, None, "UTC", "Human")
        .unwrap();
    let story = store.default_task_story(&actor.id).unwrap();
    let before = store.latest_seq().unwrap();
    std::thread::scope(|scope| {
        for client in ["fixture-a/1", "fixture-b/2"] {
            let store = store.with_activity_client(Some(client.into()));
            let actor = actor.id.clone();
            let story = story.key.clone();
            scope.spawn(move || {
                for i in 0..5 {
                    store
                        .create_task(
                            &actor,
                            CreateTask {
                                title: format!("{client} {i}"),
                                story_key: Some(story.clone()),
                                ..Default::default()
                            },
                        )
                        .unwrap();
                }
            });
        }
    });
    let events = store.list_changes_since(before, None).unwrap();
    let events = events
        .iter()
        .filter(|e| e.action == "task.created")
        .collect::<Vec<_>>();
    assert_eq!(events.len(), 10);
    for event in events {
        assert!(
            event.payload["title"]
                .as_str()
                .unwrap()
                .starts_with(event.client.as_deref().unwrap())
        );
    }
    let task = store
        .create_task(
            &actor.id,
            CreateTask {
                title: "Human write".into(),
                story_key: Some(story.key),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        store
            .get_task(&task.task.key)
            .unwrap()
            .activity
            .iter()
            .all(|e| e.client.is_none())
    );
}
