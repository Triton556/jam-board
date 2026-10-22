//! Shared, synthetic volume fixture. No direct SQL writes, imports or execution grants.
use jam_core::*;
use serde::Serialize;
use serde_json::json;
use std::{path::PathBuf, sync::Arc, time::Instant};

pub const WARMUP: usize = 3;
pub const SAMPLES: usize = 20;
pub const VOLUME_SIZES: [usize; 3] = [2_000, 1_000, 40];

pub struct ProjectFixture {
    pub store: Store,
    pub project: Jam,
    pub human: Member,
    pub epics: Vec<Epic>,
    pub stories: Vec<Story>,
    pub tasks: Vec<TaskSummary>,
}
pub struct Fixture {
    pub store: Arc<Store>,
    pub projects: Vec<ProjectFixture>,
    pub path: PathBuf,
    _dir: Option<tempfile::TempDir>,
}
impl Fixture {
    pub fn new(sizes: &[usize]) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/volume");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let path = dir.path().join("fictional-volume.db");
        let store = Arc::new(Store::open(&path).unwrap());
        let started = Instant::now();
        let mut projects = Vec::new();
        for (p, count) in sizes.iter().enumerate() {
            let (project, human) = store
                .create_jam(
                    &format!("Fictional volume project {}", p + 1),
                    None,
                    None,
                    None,
                    "UTC",
                    "QA human",
                )
                .unwrap();
            let pinned = store.for_project(&project.id).unwrap();
            let mut epics = Vec::new();
            let mut stories = Vec::new();
            for e in 0..2 {
                let epic = pinned
                    .create_epic(
                        &human.id,
                        NewEpic {
                            title: format!("Fictional epic {}", e + 1),
                            goal_md: Some("Measure a synthetic board, not live work".into()),
                            done_when_md: Some("The harness checks the fictional data".into()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                for s in 0..2 {
                    let story = pinned
                        .create_story(
                            &human.id,
                            NewStory {
                                epic_key: epic.key.clone(),
                                title: format!("Fictional story {}-{}", e + 1, s + 1),
                                outcome_md: Some("Deterministic fixture records".into()),
                                acceptance: Some(vec![Acceptance {
                                    id: "fixture".into(),
                                    criterion: "Expected records match".into(),
                                    mandatory: true,
                                    check: "Run the volume harness".into(),
                                }]),
                                ..Default::default()
                            },
                        )
                        .unwrap();
                    pinned
                        .set_story_status(&human.id, &story.key, "active", None)
                        .unwrap();
                    stories.push(story);
                }
                epics.push(epic);
            }
            let mut tasks = Vec::new();
            for i in 0..*count {
                let status = match i % 4 {
                    0 => "ready",
                    1 => "done",
                    _ => "backlog",
                };
                let complete = status == "ready" || i % 3 != 0;
                let mut tags = vec!["volume".into(), format!("lane-{}", i % 8)];
                if i % 5 == 0 {
                    tags.push("hotspot".into());
                }
                let marker = if i % 11 == 0 { "needle" } else { "ordinary" };
                let mut task = pinned
                    .create_task(
                        &human.id,
                        CreateTask {
                            story_key: Some(stories[i % stories.len()].key.clone()),
                            title: format!("Fictional item {i:04} {marker}"),
                            description: Some(
                                "Synthetic text for repeatable serialized payload measurements. "
                                    .repeat(4),
                            ),
                            status: Some(status.into()),
                            tags: Some(tags),
                            brief: if complete {
                                TaskBrief {
                                    goal_md: "A deterministic fictional result".into(),
                                    where_md: "fictional/module.rs".into(),
                                    changes: vec![Change {
                                        title: "Fictional change".into(),
                                        required: "Keep the measured fixture deterministic".into(),
                                        ..Default::default()
                                    }],
                                    tests: vec![BriefTest {
                                        setup: "Run synthetic assertions".into(),
                                        expected: "Counts and boundaries match".into(),
                                    }],
                                    result_md: "Return only synthetic evidence".into(),
                                    ..Default::default()
                                }
                            } else {
                                TaskBrief::default()
                            },
                            ..Default::default()
                        },
                    )
                    .unwrap()
                    .task;
                if i % 13 == 0 {
                    pinned
                        .add_comment(&human.id, &task.key, "Fictional fixture note")
                        .unwrap();
                    task = pinned.get_task(&task.key).unwrap().task;
                }
                if i % 17 == 16 {
                    task = pinned
                        .archive_task(
                            &human.id,
                            &task.key,
                            Some("Fictional archived sample"),
                            None,
                        )
                        .unwrap();
                }
                tasks.push(task);
            }
            // Planning Active is not execution permission. No task is ever claimed.
            assert!(
                pinned
                    .list_execution()
                    .unwrap()
                    .iter()
                    .all(|e| e.effective_state == ExecutionEffectiveState::Paused)
            );
            projects.push(ProjectFixture {
                store: pinned,
                project,
                human,
                epics,
                stories,
                tasks,
            });
        }
        let keep = std::env::var_os("JAM_VOLUME_KEEP").is_some_and(|v| v == "1");
        println!(
            "VOLUME {}",
            json!({"kind":"fixture","path":path,"retained":keep,"sizes":sizes,"creationMs":started.elapsed().as_secs_f64()*1000.0,"version":env!("CARGO_PKG_VERSION"),"debugAssertions":cfg!(debug_assertions),"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"parallelism":std::thread::available_parallelism().map(|n|n.get()).ok(),"executable":std::env::current_exe().ok()})
        );
        // This marker is produced only inside this newly created temporary fixture,
        // never beside a caller-supplied database. The comparison probe separately
        // verifies the actual schema version before opening Store connections.
        let marker = json!({
            "fictional": true,
            "fixtureManifestVersion": 1,
            "expectedDatabaseSchemaVersion": 7,
            "packageVersion": env!("CARGO_PKG_VERSION"),
            "projects": projects.iter().map(|p| json!({
                "id": p.project.id, "name": p.project.name,
                "tasks": p.tasks.len(),
                "epics": p.epics.iter().map(|e| json!({"id":e.audit.id,"key":e.key})).collect::<Vec<_>>(),
                "stories": p.stories.iter().map(|s| json!({"id":s.audit.id,"key":s.key})).collect::<Vec<_>>(),
                "sampleTasks": p.tasks.iter().take(4).map(|t| json!({"id":t.id,"key":t.key,"status":t.status})).collect::<Vec<_>>()
            })).collect::<Vec<_>>()
        });
        serde_json::to_writer_pretty(
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dir.path().join("fixture-manifest.json"))
                .unwrap(),
            &marker,
        )
        .unwrap();
        let dir = if keep {
            let _ = dir.keep();
            None
        } else {
            Some(dir)
        };
        Self {
            store,
            projects,
            path,
            _dir: dir,
        }
    }
}

pub struct Observation {
    pub operation_ms: f64,
    pub serialization_ms: f64,
    pub bytes: usize,
}
pub fn measure<T: Serialize>(label: &str, tasks: usize, mut operation: impl FnMut() -> T) {
    let mut samples = Vec::new();
    for i in 0..WARMUP + SAMPLES {
        let started = Instant::now();
        let value = operation();
        let operation_ms = started.elapsed().as_secs_f64() * 1000.0;
        let serialize = Instant::now();
        let bytes = serde_json::to_vec(&value).unwrap().len();
        if i >= WARMUP {
            samples.push(Observation {
                operation_ms,
                serialization_ms: serialize.elapsed().as_secs_f64() * 1000.0,
                bytes,
            });
        }
    }
    report(label, tasks, &samples);
}
pub fn report(label: &str, tasks: usize, samples: &[Observation]) {
    fn percentiles(mut values: Vec<f64>) -> serde_json::Value {
        values.sort_by(f64::total_cmp);
        let n = values.len();
        json!({"median":(values[(n-1)/2]+values[n/2])/2.0,"p95":values[(n*95).div_ceil(100)-1],"min":values[0],"max":values[n-1]})
    }
    assert!(!samples.is_empty());
    println!(
        "VOLUME {}",
        json!({"kind":"measurement","label":label,"tasks":tasks,"warmup":WARMUP,"samples":samples.len(),"p95Method":"nearest-rank","operationMs":percentiles(samples.iter().map(|s|s.operation_ms).collect()),"serializationMs":percentiles(samples.iter().map(|s|s.serialization_ms).collect()),"jsonBytesMin":samples.iter().map(|s|s.bytes).min(),"jsonBytesMax":samples.iter().map(|s|s.bytes).max()})
    );
}
