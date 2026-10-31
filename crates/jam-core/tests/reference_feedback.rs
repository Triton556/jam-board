//! W4 / AC14: persisted frame references and human moodboard feedback.
#[path = "support/v9_fixture.rs"]
mod v9_fixture;
use jam_core::*;
use serde_json::json;

fn setup() -> (tempfile::TempDir, Store, String, Member) {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-visuals/round5/w4");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let store = Store::open(dir.path().join("jam.db")).unwrap();
    let (project, human) = store
        .create_jam("Feedback", None, None, None, "UTC", "Human")
        .unwrap();
    let store = store.for_project(&project.id).unwrap();
    let agent = store.identify_agent("Moodboard brain", "codex").unwrap();
    (dir, store, human.id, agent)
}
fn frame(
    store: &Store,
    human: &str,
    title: &str,
    x: f64,
    y: f64,
    epic: Option<String>,
) -> RefFrame {
    store
        .create_canvas_frame(
            human,
            CanvasFrameCreate {
                title: title.into(),
                x: Some(x),
                y: Some(y),
                w: Some(900.),
                h: Some(600.),
                epic_key: epic,
            },
        )
        .unwrap()
}
fn note(store: &Store, actor: &str, frame: Option<&RefFrame>, title: &str) -> RefItem {
    store
        .add_reference(
            actor,
            AddReference {
                kind: "note".into(),
                title: Some(title.into()),
                text: Some("Feedback".into()),
                frame_id: frame.map(|f| f.id.clone()),
                ..Default::default()
            },
        )
        .unwrap()
}
fn geometry(store: &Store, human: &str, item: &RefItem, x: f64, y: f64, w: f64, h: f64) {
    store
        .canvas_geometry(
            human,
            CanvasGeometry {
                id: item.audit.id.clone(),
                x,
                y,
                w,
                h,
                z: 0.,
                frame_id: item.frame_id.clone(),
            },
        )
        .unwrap();
}

#[test]
fn ac14_frame_links_inherit_current_future_items_and_unlink_without_duplicates() {
    let (_dir, s, h, a) = setup();
    let e = s
        .create_epic(
            &h,
            NewEpic {
                title: "Epic".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let story = s
        .create_story(
            &h,
            NewStory {
                epic_key: e.key.clone(),
                title: "Story".into(),
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
                ..Default::default()
            },
        )
        .unwrap();
    let inherited = frame(&s, &h, "Epic references", 0., 0., Some(e.key.clone()));
    let explicit = frame(&s, &h, "Story moodboard", 1000., 0., None);
    let one = note(&s, &h, Some(&inherited), "One");
    let two = note(&s, &h, Some(&explicit), "Two");
    let linked = s.link_ref_frame(&a.id, &explicit.id, &story.key).unwrap();
    assert_eq!(linked.links[0].target_key, story.key);
    assert!(matches!(linked.links[0].kind, ReferenceTargetKind::Story));
    assert_eq!(linked.links[0].title, "Story");
    s.link_ref_frame(&a.id, &inherited.id, &story.key).unwrap();
    let three = note(&s, &h, Some(&explicit), "Future child");
    let refs = s.get_task(&task.task.key).unwrap().references;
    assert_eq!(refs.len(), 3);
    for item in &refs {
        assert_eq!(item.via.as_deref(), Some("frame"));
        assert!(item.frame_title.is_some());
    }
    assert!(refs.iter().any(|i| i.audit.id == one.audit.id));
    assert!(refs.iter().any(|i| i.audit.id == three.audit.id));
    assert_eq!(
        s.list_references(None, Some(&story.key), None)
            .unwrap()
            .len(),
        3
    );
    s.link_reference(&a.id, &two.audit.id, &story.key).unwrap();
    let refs = s.get_task(&task.task.key).unwrap().references;
    assert_eq!(refs.len(), 3);
    assert!(
        refs.iter()
            .find(|i| i.audit.id == two.audit.id)
            .unwrap()
            .via
            .is_none()
    );
    s.unlink_ref_frame(&a.id, &explicit.id, &story.key).unwrap();
    let events = s.list_changes_since(0, None).unwrap();
    assert!(events.iter().any(|event| event.action == "reference.linked"
        && event.actor.id == a.id
        && event.payload["frameId"] == explicit.id));
    assert!(
        events
            .iter()
            .any(|event| event.action == "reference.updated"
                && event.actor.id == a.id
                && event.payload["frameId"] == explicit.id
                && event.payload["unlinked"] == true)
    );
    assert_eq!(s.get_task(&task.task.key).unwrap().references.len(), 2);
    s.unlink_reference(&a.id, &two.audit.id, &story.key)
        .unwrap();
    assert_eq!(s.get_task(&task.task.key).unwrap().references.len(), 1);
    assert_eq!(s.reference_canvas().unwrap().items.len(), 3);
    assert!(
        s.list_ref_frames()
            .unwrap()
            .iter()
            .find(|f| f.id == explicit.id)
            .unwrap()
            .links
            .is_empty()
    );
    s.link_ref_frame(&a.id, &explicit.id, &task.task.key)
        .unwrap();
    assert_eq!(
        s.list_references(None, None, Some(&task.task.key))
            .unwrap()
            .len(),
        2
    );
    let exported = s.export_jam().unwrap();
    assert_eq!(exported.planning.as_ref().unwrap().frame_links.len(), 3);
    let root = Store::open(&s.path).unwrap();
    let imported = root
        .import_jam_json(&h, &serde_json::to_string(&exported).unwrap())
        .unwrap();
    let imported_store = root.for_project(&imported.jam.unwrap().id).unwrap();
    assert_eq!(
        imported_store
            .list_ref_frames()
            .unwrap()
            .iter()
            .map(|f| f.links.len())
            .sum::<usize>(),
        2
    );
}

#[test]
fn ac14_verdict_round_trip_and_archive_attribution_restore() {
    let (dir, s, h, a) = setup();
    let item = note(&s, &h, None, "Candidate");
    for verdict in [
        Some(ReferenceVerdict::Keep),
        Some(ReferenceVerdict::Reject),
        None,
    ] {
        let expected = serde_json::to_value(&verdict).unwrap();
        let updated = s
            .set_reference_verdict(
                &h,
                ReferenceVerdictInput {
                    item_id: item.audit.id.clone(),
                    verdict,
                },
            )
            .unwrap();
        assert_eq!(serde_json::to_value(updated).unwrap()["verdict"], expected);
        assert_eq!(
            serde_json::to_value(s.list_references(None, None, None).unwrap().remove(0)).unwrap()["verdict"],
            expected
        );
        assert_eq!(
            s.get_canvas(CanvasQuery::default()).unwrap().references[0]["verdict"],
            expected
        );
    }
    assert!(
        s.set_reference_verdict(
            &a.id,
            ReferenceVerdictInput {
                item_id: item.audit.id.clone(),
                verdict: Some(ReferenceVerdict::Keep)
            }
        )
        .is_err()
    );
    s.canvas_archive(
        &h,
        CanvasArchive {
            kind: "item".into(),
            id: item.audit.id.clone(),
            archived: true,
        },
    )
    .unwrap();
    let count = s.activity_count().unwrap();
    s.canvas_archive(
        &a.id,
        CanvasArchive {
            kind: "item".into(),
            id: item.audit.id.clone(),
            archived: true,
        },
    )
    .unwrap();
    assert_eq!(s.activity_count().unwrap(), count);
    assert!(
        s.get_canvas(CanvasQuery::default())
            .unwrap()
            .references
            .is_empty()
    );
    let page = s
        .get_canvas(CanvasQuery {
            include_archived: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.references[0]["archivedBy"], "human");
    assert!(page.references[0]["archivedAt"].is_string());
    assert!(
        s.canvas_archive(
            &a.id,
            CanvasArchive {
                kind: "item".into(),
                id: item.audit.id.clone(),
                archived: false
            }
        )
        .is_err()
    );
    s.canvas_archive(
        &h,
        CanvasArchive {
            kind: "item".into(),
            id: item.audit.id.clone(),
            archived: false,
        },
    )
    .unwrap();
    assert_eq!(
        s.get_canvas(CanvasQuery::default()).unwrap().references[0]["archivedBy"],
        json!(null)
    );
    s.archive_reference(&a.id, &item.audit.id).unwrap();
    let reopened = Store::open(dir.path().join("jam.db")).unwrap();
    let page = reopened
        .get_canvas(CanvasQuery {
            include_archived: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.references[0]["archivedBy"], a.name);
    assert!(page.references[0]["archivedAt"].is_string());
}

#[test]
fn ac14_attached_to_uses_world_offsets_centre_or_thirty_percent_of_note() {
    let (_dir, s, h, _) = setup();
    let f = frame(&s, &h, "Offset", 1000., 500., None);
    let target = note(&s, &h, Some(&f), "Target");
    geometry(&s, &h, &target, 0., 0., 100., 100.);
    let centre = note(&s, &h, None, "Centre");
    geometry(&s, &h, &centre, 1010., 510., 80., 50.);
    let note_frame = frame(&s, &h, "Feedback offset", 500., 200., None);
    let threshold = note(
        &s,
        &h,
        Some(&note_frame),
        "Exactly 30 percent, centre outside",
    );
    geometry(&s, &h, &threshold, 570., 300., 100., 100.);
    let below = note(&s, &h, None, "Below 30 percent");
    geometry(&s, &h, &below, 1071., 500., 100., 100.);
    let elsewhere = note(&s, &h, None, "Local coordinates are not world");
    geometry(&s, &h, &elsewhere, 10., 10., 80., 50.);
    let page = s.get_canvas(CanvasQuery::default()).unwrap();
    for (item, expected) in [
        (&centre, true),
        (&threshold, true),
        (&below, false),
        (&elsewhere, false),
    ] {
        let row = page
            .references
            .iter()
            .find(|r| r["id"] == item.audit.id)
            .unwrap();
        assert_eq!(
            row["attachedTo"]
                .as_array()
                .unwrap()
                .contains(&json!(target.audit.id)),
            expected,
            "{}",
            item.title
        );
    }
}

#[test]
fn ac14_copied_assets_survive_source_deletion_and_reject_large_missing_files() {
    let (dir, s, h, _) = setup();
    let source = dir.path().join("candidate.png");
    std::fs::write(&source, b"existing local media contract").unwrap();
    let add = |copy| AddReference {
        kind: "asset".into(),
        file_path: Some(source.to_string_lossy().into_owned()),
        copy: Some(copy),
        ..Default::default()
    };
    let original = s.add_reference(&h, add(false)).unwrap();
    let copied = s.add_reference(&h, add(true)).unwrap();
    let assets = s.list_assets(None, None).unwrap();
    let original_asset = assets
        .iter()
        .find(|a| Some(&a.id) == original.asset_id.as_ref())
        .unwrap();
    let copied_asset = assets
        .iter()
        .find(|a| Some(&a.id) == copied.asset_id.as_ref())
        .unwrap();
    assert_eq!(
        std::path::Path::new(&original_asset.location),
        source.canonicalize().unwrap()
    );
    let destination = std::path::Path::new(&copied_asset.location);
    assert_eq!(
        destination.parent().unwrap(),
        dir.path().canonicalize().unwrap().join("references")
    );
    assert!(
        destination
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("clipboard-")
    );
    assert_eq!(copied.title, "candidate");
    std::fs::remove_file(&source).unwrap();
    assert_eq!(
        std::fs::read(destination).unwrap(),
        b"existing local media contract"
    );
    assert!(
        s.add_reference(&h, add(true))
            .unwrap_err()
            .to_string()
            .contains("readable")
    );
    let large = std::fs::File::create(&source).unwrap();
    large.set_len(50 * 1024 * 1024 + 1).unwrap();
    assert!(
        s.add_reference(&h, add(true))
            .unwrap_err()
            .to_string()
            .contains("50 MiB")
    );
    assert_eq!(
        std::fs::read_dir(destination.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
    assert!(
        s.add_reference(
            &h,
            AddReference {
                kind: "note".into(),
                text: Some("Note".into()),
                copy: Some(true),
                ..Default::default()
            }
        )
        .is_err()
    );
    // A failed database mutation must also remove the managed copy.
    std::fs::write(&source, b"small").unwrap();
    let mut invalid = add(true);
    invalid.frame_id = Some("missing-frame".into());
    assert!(s.add_reference(&h, invalid).is_err());
    assert_eq!(
        std::fs::read_dir(destination.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn ac14_migration_from_schema_seven_preserves_records_and_defaults() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-visuals/round5/w4");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let path = dir.path().join("jam.db");
    // Start from a valid populated database, then reconstruct the previous schema.
    let store = Store::open(&path).unwrap();
    store.seed_demo().unwrap();
    let h = store.current_member().unwrap().id;
    let agent = store.identify_agent("Historical brain", "codex").unwrap();
    let item = note(&store, &agent.id, None, "Pre-migration");
    store
        .canvas_archive(
            &h,
            CanvasArchive {
                kind: "item".into(),
                id: item.audit.id.clone(),
                archived: true,
            },
        )
        .unwrap();
    let by_agent = note(&store, &h, None, "Agent archived");
    store
        .archive_reference(&agent.id, &by_agent.audit.id)
        .unwrap();
    let unknown = note(&store, &h, None, "No surviving archive activity");
    store.archive_reference(&h, &unknown.audit.id).unwrap();
    drop(store);
    let c = rusqlite::Connection::open(&path).unwrap();
    // Schema 7 canvas archives did not change updated_by. A last editor is
    // deliberately different from the archive actor, and must not be guessed.
    c.execute(
        "UPDATE ref_items SET updated_by=? WHERE id=?",
        [&agent.id, &item.audit.id],
    )
    .unwrap();
    c.execute("DELETE FROM activity WHERE json_extract(payload,'$.itemId')=? AND json_extract(payload,'$.archived')=1",[&unknown.audit.id]).unwrap();
    v9_fixture::strip(&c);
    c.execute_batch("DROP TABLE ref_frame_links; ALTER TABLE ref_items DROP COLUMN verdict; ALTER TABLE ref_items DROP COLUMN archived_by; PRAGMA user_version=7;").unwrap();
    drop(c);
    let store = Store::open(&path).unwrap();
    let page = store
        .get_canvas(CanvasQuery {
            include_archived: true,
            ..Default::default()
        })
        .unwrap();
    let row = page
        .references
        .iter()
        .find(|r| r["id"] == item.audit.id)
        .unwrap();
    assert_eq!(row["verdict"], json!(null));
    assert_eq!(row["archivedBy"], "human");
    assert_eq!(row["title"], "Pre-migration");
    assert_eq!(
        page.references
            .iter()
            .find(|r| r["id"] == by_agent.audit.id)
            .unwrap()["archivedBy"],
        agent.name
    );
    assert_eq!(
        page.references
            .iter()
            .find(|r| r["id"] == unknown.audit.id)
            .unwrap()["archivedBy"],
        json!(null)
    );
}
