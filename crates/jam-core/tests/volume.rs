//! Opt in: JAM_VOLUME_KEEP=1 cargo test -p jam-core --test volume -- --ignored --nocapture
//! Fresh disposable fictional data only. Timings are observations, never CI latency budgets.
mod volume_support;
use jam_core::*;
use std::collections::{BTreeMap, BTreeSet};
use volume_support::*;

fn keys(tasks: &[TaskSummary]) -> BTreeSet<String> {
    tasks.iter().map(|t| t.key.clone()).collect()
}
fn paginate(store: &Store, mut filter: TaskFilter) -> Vec<TaskSummary> {
    let mut tasks = Vec::new();
    let mut seen_cursors = BTreeSet::new();
    loop {
        let page = store.list_tasks(None, filter.clone()).unwrap();
        assert!(page.tasks.len() <= filter.limit.unwrap_or(50));
        tasks.extend(page.tasks);
        match page.next_cursor {
            Some(cursor) => {
                assert!(seen_cursors.insert(cursor.clone()));
                filter.cursor = Some(cursor);
            }
            None => break,
        }
    }
    assert_eq!(
        tasks.len(),
        keys(&tasks).len(),
        "No duplicates across cursor pages"
    );
    tasks
}
fn check_fixture(f: &Fixture) {
    let summaries = f.store.list_projects(false).unwrap();
    assert_eq!(summaries.len(), f.projects.len());
    for (i, p) in f.projects.iter().enumerate() {
        // Select another UI project while checking a previously captured Store.
        f.store
            .select_project(&f.projects[(i + 1) % f.projects.len()].project.id)
            .unwrap();
        let active = p
            .tasks
            .iter()
            .filter(|t| t.archived_at.is_none())
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(p.store.get_project().unwrap().tasks, active.len() as i64);
        let summary = summaries.iter().find(|s| s.jam.id == p.project.id).unwrap();
        assert_eq!(summary.task_count, active.len() as i64);
        assert_eq!(summary.in_progress_count, 0);
        let board = p.store.list_board_tasks().unwrap();
        let all = board.values().flatten().cloned().collect::<Vec<_>>();
        assert_eq!(keys(&all), keys(&active));
        for (status, tasks) in board {
            assert!(
                tasks
                    .iter()
                    .all(|t| t.status == status && t.jam_id == p.project.id)
            );
        }
        let mut expected_tags = BTreeMap::<String, i64>::new();
        for task in &active {
            for tag in &task.tags {
                *expected_tags.entry(tag.clone()).or_default() += 1;
            }
        }
        assert_eq!(
            p.store
                .list_tags()
                .unwrap()
                .into_iter()
                .map(|t| (t.tag, t.count))
                .collect::<BTreeMap<_, _>>(),
            expected_tags
        );
        let all = paginate(
            &p.store,
            TaskFilter {
                limit: Some(200),
                include_archived: Some(true),
                ..Default::default()
            },
        );
        assert_eq!(keys(&all), keys(&p.tasks));
        assert!(
            all.windows(2)
                .all(|w| (w[0].position, &w[0].key) <= (w[1].position, &w[1].key))
        );
        let first = p.store.list_tasks(None, TaskFilter::default()).unwrap();
        assert_eq!(first.tasks.len(), active.len().min(50));
        let second = p
            .store
            .list_tasks(
                None,
                TaskFilter {
                    cursor: Some("50".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(keys(&first.tasks).is_disjoint(&keys(&second.tasks)));
        for ready in [true, false] {
            let expected = active
                .iter()
                .filter(|t| t.ready == ready && t.tags.iter().any(|tag| tag == "hotspot"))
                .cloned()
                .collect::<Vec<_>>();
            let actual = paginate(
                &p.store,
                TaskFilter {
                    ready: Some(ready),
                    tag: Some(" HOTSPOT ".into()),
                    limit: Some(200),
                    ..Default::default()
                },
            );
            assert_eq!(keys(&actual), keys(&expected));
            let table = p
                .store
                .query_tasks(TaskQuery {
                    ready: Some(ready),
                    tags: Some(vec!["hotspot".into()]),
                    ..Default::default()
                })
                .unwrap();
            assert_eq!(table.total, expected.len() as i64);
            assert_eq!(keys(&table.tasks), keys(&expected));
        }
        let expected = active
            .iter()
            .filter(|t| t.status == "ready" && t.title.contains("needle"))
            .cloned()
            .collect::<Vec<_>>();
        let result = paginate(
            &p.store,
            TaskFilter {
                status: Some(vec!["ready".into()]),
                query: Some("needle".into()),
                limit: Some(200),
                ..Default::default()
            },
        );
        assert_eq!(keys(&result), keys(&expected));
        let scoped = paginate(
            &p.store,
            TaskFilter {
                epic: Some(p.epics[0].audit.id.clone()),
                story: Some(p.stories[0].audit.id.clone()),
                limit: Some(200),
                ..Default::default()
            },
        );
        assert_eq!(
            keys(&scoped),
            keys(
                &active
                    .iter()
                    .filter(|t| t.story_id == p.stories[0].audit.id)
                    .cloned()
                    .collect::<Vec<_>>()
            )
        );
        let foreign = &f.projects[(i + 1) % f.projects.len()];
        assert!(matches!(
            p.store.get_task(&foreign.tasks[0].key),
            Err(Error::Forbidden(_))
        ));
        assert!(matches!(
            p.store.get_epic(&foreign.epics[0].audit.id),
            Err(Error::Forbidden(_))
        ));
        assert!(matches!(
            p.store.get_story(&foreign.stories[0].audit.id),
            Err(Error::Forbidden(_))
        ));
    }
}

#[test]
fn small_volume_fixture_checks_filters_counts_pagination_and_project_isolation() {
    check_fixture(&Fixture::new(&[60, 24, 8]));
}

#[test]
#[ignore = "opt-in: creates 3,040 synthetic tasks and records non-budgeted volume measurements"]
fn real_store_volume_baseline() {
    let fixture = Fixture::new(&VOLUME_SIZES);
    check_fixture(&fixture);
    for p in &fixture.projects {
        let n = p.tasks.len();
        measure("core.list_tasks.limit50", n, || {
            p.store.list_tasks(None, TaskFilter::default()).unwrap()
        });
        measure("core.list_tasks.limit1", n, || {
            p.store
                .list_tasks(
                    None,
                    TaskFilter {
                        limit: Some(1),
                        ..Default::default()
                    },
                )
                .unwrap()
        });
        measure("core.list_tasks.ready_hotspot.limit50", n, || {
            p.store
                .list_tasks(
                    None,
                    TaskFilter {
                        ready: Some(true),
                        tag: Some("hotspot".into()),
                        ..Default::default()
                    },
                )
                .unwrap()
        });
        measure("core.list_board_tasks.all_visible", n, || {
            p.store.list_board_tasks().unwrap()
        });
        measure("core.get_board.summary", n, || {
            p.store.board(Some(&p.human.id)).unwrap()
        });
        measure("core.query_tasks.all_visible", n, || {
            p.store.query_tasks(TaskQuery::default()).unwrap()
        });
        measure("core.query_tasks.ready_hotspot", n, || {
            p.store
                .query_tasks(TaskQuery {
                    ready: Some(true),
                    tags: Some(vec!["hotspot".into()]),
                    ..Default::default()
                })
                .unwrap()
        });
        measure("core.list_tags", n, || p.store.list_tags().unwrap());
        measure("core.get_project.counts", n, || {
            p.store.get_project().unwrap()
        });
        measure("core.get_task", n, || {
            p.store.get_task(&p.tasks[0].key).unwrap()
        });
    }
    measure("core.list_projects", VOLUME_SIZES.iter().sum(), || {
        fixture.store.list_projects(false).unwrap()
    });
    println!(
        "VOLUME correctness=passed no_execution_grants=true fixture={}",
        fixture.path.display()
    );
}
