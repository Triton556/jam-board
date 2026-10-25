//! AC14: agent canvas organization through the actual tool dispatcher.
use crate::v2::execute;
use jam_core::*;
use serde_json::{Value, json};

struct Fixture {
    _dir: tempfile::TempDir,
    root: Store,
    store: Store,
    actor: Member,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = Store::open(dir.path().join("jam.db")).unwrap();
        let (project, _) = root
            .create_jam("Canvas", None, None, None, "UTC", "Human")
            .unwrap();
        let store = root.for_project(&project.id).unwrap();
        let actor = store.identify_agent("Canvas organizer", "codex").unwrap();
        Self {
            _dir: dir,
            root,
            store,
            actor,
        }
    }
    fn call(&self, name: &str, args: Value) -> Value {
        execute(&self.store, &self.actor, name, args)
            .unwrap()
            .unwrap()
    }
    fn reject(&self, name: &str, args: Value) -> String {
        execute(&self.store, &self.actor, name, args)
            .unwrap()
            .unwrap_err()
            .to_string()
    }
    fn note(&self, title: &str) -> Value {
        self.call(
            "add_reference",
            json!({"kind":"note","title":title,"text":"🦀".repeat(250)}),
        )
    }
}

#[test]
fn ac14_frame_link_shapes_feedback_and_foreign_projects() {
    let f = Fixture::new();
    let epic = f.call("create_epic", json!({"title":"Moodboard"}));
    let frame = f.call("create_frame", json!({"title":"Moodboard candidates"}));
    let item = f.call(
        "add_reference",
        json!({"kind":"note","text":"Candidate","frameId":frame["id"]}),
    );
    for name in ["link_reference", "unlink_reference"] {
        assert!(
            f.reject(name, json!({"targetKey":epic["key"]}))
                .contains("exactly one")
        );
        assert!(
            f.reject(
                name,
                json!({"itemId":item["id"],"frameId":frame["id"],"targetKey":epic["key"]})
            )
            .contains("exactly one")
        );
    }
    let linked = f.call(
        "link_reference",
        json!({"frameId":frame["id"],"targetKey":epic["key"]}),
    );
    assert_eq!(linked["links"][0]["targetKey"], epic["key"]);
    let rows = f.call("list_references", json!({"epicKey":epic["key"]}));
    assert_eq!(rows[0]["via"], "frame");
    assert_eq!(rows[0]["frameId"], frame["id"]);
    assert_eq!(rows[0]["frameTitle"], "Moodboard candidates");
    assert_eq!(rows[0]["verdict"], Value::Null);
    let canvas = f.call("get_canvas", json!({"epicKey":epic["key"]}));
    assert_eq!(canvas["references"][0]["linkedKeys"], json!([epic["key"]]));
    assert!(canvas["references"][0]["attachedTo"].is_array());
    assert!(
        execute(
            &f.store,
            &f.actor,
            "set_reference_verdict",
            json!({"itemId":item["id"],"verdict":"keep"})
        )
        .is_none()
    );
    assert!(
        f.reject(
            "update_reference",
            json!({"itemId":item["id"],"verdict":"keep"})
        )
        .contains("verdict")
    );

    let (other, h) = f
        .root
        .create_jam("Foreign", None, None, None, "UTC", "Foreign human")
        .unwrap();
    let foreign = f.root.for_project(&other.id).unwrap();
    let foreign_frame = foreign
        .create_canvas_frame(
            &h.id,
            serde_json::from_value(json!({"title":"Foreign"})).unwrap(),
        )
        .unwrap();
    let foreign_epic = foreign
        .create_epic(
            &h.id,
            NewEpic {
                title: "Foreign epic".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let before = f.store.activity_count().unwrap();
    for name in ["link_reference", "unlink_reference"] {
        for args in [
            json!({"frameId":foreign_frame.id,"targetKey":epic["key"]}),
            json!({"frameId":frame["id"],"targetKey":foreign_epic.key}),
            json!({"itemId":item["id"],"targetKey":foreign_epic.key}),
        ] {
            assert!(f.reject(name, args).contains("project"));
        }
    }
    assert_eq!(f.store.activity_count().unwrap(), before);
    f.call(
        "unlink_reference",
        json!({"frameId":frame["id"],"targetKey":epic["key"]}),
    );
    assert!(
        f.call("list_references", json!({"epicKey":epic["key"]}))
            .as_array()
            .unwrap()
            .is_empty()
    );
    f.call(
        "link_reference",
        json!({"itemId":item["id"],"targetKey":epic["key"]}),
    );
    assert_eq!(
        f.call(
            "unlink_reference",
            json!({"itemId":item["id"],"targetKey":epic["key"]})
        )["unlinked"],
        true
    );
}

#[test]
fn ac14_canvas_organize_read_archive_and_activity() {
    let f = Fixture::new();
    let epic = f.call("create_epic", json!({"title":"Ideas"}));
    let a = f.note("A");
    let b = f.note("B");
    let before = f.call("get_canvas", json!({}));
    let right_edge = ["frames", "references"]
        .into_iter()
        .flat_map(|kind| before[kind].as_array().unwrap())
        .map(|row| row["x"].as_f64().unwrap() + row["w"].as_f64().unwrap())
        .reduce(f64::max)
        .unwrap();
    let frame = f.call(
        "create_frame",
        json!({"title":"Epic ideas","epicKey":epic["key"],"y":100}),
    );
    assert!(frame["x"].as_f64().unwrap() >= right_edge + 80.);
    let edge = f.call(
        "connect_references",
        json!({"from":a["id"],"to":b["id"],"label":"supports"}),
    );
    assert!(
        f.reject("connect_references", json!({"from":a["id"],"to":b["id"]}))
            .contains("already exists")
    );
    assert!(
        f.reject("connect_references", json!({"from":a["id"],"to":a["id"]}))
            .contains("itself")
    );
    assert!(
        f.reject(
            "connect_references",
            json!({"from":b["id"],"to":a["id"],"label":"x".repeat(241)})
        )
        .contains("240")
    );
    let moved=f.call("arrange_references",json!({"items":[{"itemId":a["id"]},{"itemId":b["id"]}],"frameId":frame["id"],"layout":"grid"}));
    let rows = moved.as_array().unwrap();
    let frame_x = frame["x"].as_f64().unwrap();
    let frame_y = frame["y"].as_f64().unwrap();
    assert!(frame_x > 0. && frame_y > 0.);
    for i in rows {
        assert_eq!(i["frameId"], frame["id"]);
        assert!(
            i["x"].as_f64().unwrap() >= frame_x + 24. && i["y"].as_f64().unwrap() >= frame_y + 56.
        );
        assert!(
            i["x"].as_f64().unwrap() + i["w"].as_f64().unwrap()
                <= frame_x + frame["w"].as_f64().unwrap() - 24.
        );
        assert!(
            i["y"].as_f64().unwrap() + i["h"].as_f64().unwrap()
                <= frame_y + frame["h"].as_f64().unwrap() - 24.
        );
    }
    assert!(
        rows[0]["x"].as_f64().unwrap() + rows[0]["w"].as_f64().unwrap()
            <= rows[1]["x"].as_f64().unwrap()
    );
    let page = f.call("get_canvas", json!({"epicKey":epic["key"]}));
    assert_eq!(page["references"].as_array().unwrap().len(), 2);
    assert_eq!(page["edges"][0]["label"], "supports");
    let stored = f.store.reference_canvas().unwrap();
    for returned in rows {
        let observed = page["references"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["id"] == returned["id"])
            .unwrap();
        for field in ["x", "y", "w", "h", "frameId"] {
            assert_eq!(
                returned[field], observed[field],
                "{field} differs between arrange and get_canvas"
            );
        }
        let persisted = stored
            .items
            .iter()
            .find(|i| i.audit.id == returned["id"].as_str().unwrap())
            .unwrap();
        assert_eq!(returned["x"].as_f64().unwrap(), persisted.x + frame_x);
        assert_eq!(returned["y"].as_f64().unwrap(), persisted.y + frame_y);
    }
    let view = page["references"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == a["id"])
        .unwrap();
    assert_eq!(view["text"].as_str().unwrap().chars().count(), 200);
    assert_eq!(view["linkedKeys"][0], epic["key"]);
    assert_eq!(view["x"].as_f64().unwrap(), rows[0]["x"].as_f64().unwrap());
    f.call(
        "update_connection",
        json!({"id":edge["id"],"label":"related"}),
    );
    f.call(
        "update_frame",
        json!({"id":frame["id"],"title":"Renamed","x":1000,"w":1100,"epicKey":null}),
    );
    let updated = f.call("get_canvas", json!({"frameId":frame["id"]}));
    assert_eq!(updated["frames"][0]["title"], "Renamed");
    assert_eq!(updated["frames"][0]["epicKey"], Value::Null);
    assert_eq!(updated["edges"][0]["label"], "related");
    f.call("remove_connection", json!({"id":edge["id"]}));
    let replacement = f.call("connect_references", json!({"from":a["id"],"to":b["id"]}));
    f.call("remove_connection", json!({"id":replacement["id"]}));
    f.store
        .archive_reference(&f.actor.id, a["id"].as_str().unwrap())
        .unwrap();
    f.store
        .archive_ref_frame(&f.actor.id, frame["id"].as_str().unwrap())
        .unwrap();
    let active = f.call("get_canvas", json!({}));
    let reopened = Store::open(f._dir.path().join("jam.db"))
        .unwrap()
        .for_project(&f.store.active_jam().unwrap().id)
        .unwrap();
    assert_eq!(
        active,
        execute(&reopened, &f.actor, "get_canvas", json!({}))
            .unwrap()
            .unwrap()
    );
    assert!(
        active["frames"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != frame["id"])
    );
    assert_eq!(active["references"].as_array().unwrap().len(), 1);
    assert!(active["edges"].as_array().unwrap().is_empty());
    let archived = f.call("get_canvas", json!({"includeArchived":true}));
    assert_eq!(archived["references"].as_array().unwrap().len(), 2);
    assert_eq!(archived["edges"].as_array().unwrap().len(), 2);
    assert!(
        archived["frames"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == frame["id"])
    );
    // Archived endpoints still cannot receive new connections.
    assert!(
        f.reject("connect_references", json!({"from":a["id"],"to":b["id"]}))
            .contains("archived")
    );
    let events = f.store.list_changes_since(0, None).unwrap();
    for id in [&frame["id"], &edge["id"], &a["id"]] {
        assert!(
            events.iter().any(|e| e.actor.id == f.actor.id
                && e.payload.to_string().contains(id.as_str().unwrap()))
        );
    }
}

#[test]
fn ac14_grid_preserves_occupants_and_failed_batch_rolls_back() {
    let f = Fixture::new();
    let a = f.note("A");
    let b = f.note("B");
    let c = f.note("C");
    let frame = f.call(
        "create_frame",
        json!({"title":"Frame","x":600,"y":400,"w":560,"h":600}),
    );
    f.call(
        "arrange_references",
        json!({"items":[{"itemId":a["id"]}],"frameId":frame["id"],"layout":"grid"}),
    );
    let before = f.call("get_canvas", json!({}));
    let moved = f.call(
        "arrange_references",
        json!({"items":[{"itemId":b["id"]}],"frameId":frame["id"],"layout":"grid"}),
    );
    assert!(moved[0]["x"].as_f64().unwrap() >= 600. + 288.);
    let baseline = f.call("get_canvas", json!({}));
    let count = f.store.activity_count().unwrap();
    assert!(
        f.reject(
            "arrange_references",
            json!({"items":[{"itemId":c["id"]},{"itemId":b["id"]}],"frameId":frame["id"],"x":3})
        )
        .contains("unknown field")
    );
    let tiny = f.call("create_frame", json!({"title":"Tiny","w":300,"h":300}));
    let small = f.call("get_canvas", json!({}));
    let small_count = f.store.activity_count().unwrap();
    assert!(f.reject("arrange_references",json!({"items":[{"itemId":b["id"]},{"itemId":c["id"]}],"frameId":tiny["id"],"layout":"grid"})).contains("do not fit"));
    assert_eq!(small, f.call("get_canvas", json!({})));
    assert_eq!(small_count, f.store.activity_count().unwrap());
    assert!(count < small_count);
    assert_ne!(before, baseline);
    // Reparent without coordinates keeps world position; explicit world input is converted.
    let old = f.call("get_canvas", json!({}))["references"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == a["id"])
        .unwrap()
        .clone();
    f.call(
        "arrange_references",
        json!({"items":[{"itemId":a["id"]}],"frameId":null}),
    );
    let detached = f
        .store
        .reference_canvas()
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.audit.id == a["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(detached.x, old["x"].as_f64().unwrap());
    f.call(
        "arrange_references",
        json!({"items":[{"itemId":a["id"],"x":750,"y":500}],"frameId":frame["id"]}),
    );
    let saved = f
        .store
        .reference_canvas()
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.audit.id == a["id"].as_str().unwrap())
        .unwrap();
    assert_eq!((saved.x, saved.y), (150., 100.));
    assert!(
        f.reject(
            "arrange_references",
            json!({"items":[{"itemId":a["id"]},{"itemId":a["id"]}]})
        )
        .contains("only once")
    );
    assert!(
        f.reject("arrange_references", json!({"items":[],"layout":"grid"}))
            .contains("1 to 100")
    );
}

#[test]
fn ac14_paging_filters_links_and_foreign_ids_fail_closed() {
    let f = Fixture::new();
    let a = f.note("A");
    let b = f.note("B");
    let epic = f.call("create_epic", json!({"title":"Linked"}));
    let story = f.call(
        "create_story",
        json!({"epicKey":epic["key"],"title":"Linked story"}),
    );
    let task = serde_json::to_value(
        f.store
            .create_task(
                &f.actor.id,
                serde_json::from_value(json!({"storyKey":story["key"],"title":"Linked task"}))
                    .unwrap(),
            )
            .unwrap(),
    )
    .unwrap();
    for key in [&epic["key"], &story["key"], &task["key"]] {
        f.call("link_reference", json!({"itemId":a["id"],"targetKey":key}));
    }
    let linked = f.call("get_canvas", json!({"epicKey":epic["key"]}));
    assert_eq!(linked["references"].as_array().unwrap().len(), 1);
    assert_eq!(
        linked["references"][0]["linkedKeys"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let first = f.call("get_canvas", json!({"limit":1}));
    assert_eq!(first["truncated"], true);
    assert_eq!(first["nextCursor"], 1);
    let mut ids = std::collections::HashSet::new();
    let mut page = first;
    loop {
        let records = ["frames", "references", "edges"]
            .into_iter()
            .flat_map(|k| page[k].as_array().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(records.len(), 1);
        assert!(ids.insert(records[0]["id"].as_str().unwrap().to_owned()));
        if page["truncated"] == false {
            assert_eq!(page["nextCursor"], Value::Null);
            break;
        }
        page = f.call("get_canvas", json!({"limit":1,"cursor":page["nextCursor"]}));
    }
    assert_eq!(ids.len(), 3); // Agent inbox frame plus the two notes.
    assert!(
        f.reject("get_canvas", json!({"limit":201}))
            .contains("1 to 200")
    );
    assert!(
        f.reject("get_canvas", json!({"cursor":20}))
            .contains("Cursor")
    );
    let (other, h) = f
        .root
        .create_jam("Other", None, None, None, "UTC", "Other human")
        .unwrap();
    let foreign = f.root.for_project(&other.id).unwrap();
    let note = foreign
        .add_reference(
            &h.id,
            AddReference {
                kind: "note".into(),
                text: Some("Foreign".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let frame = foreign
        .create_canvas_frame(
            &h.id,
            serde_json::from_value(json!({"title":"Foreign"})).unwrap(),
        )
        .unwrap();
    let edge = foreign
        .create_ref_edge(&h.id, &note.audit.id, &note.audit.id, "")
        .unwrap();
    let epic = foreign
        .create_epic(
            &h.id,
            NewEpic {
                title: "Foreign".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let before = f.call("get_canvas", json!({}));
    let count = f.store.activity_count().unwrap();
    for (name, args) in [
        ("get_canvas", json!({"frameId":frame.id})),
        ("get_canvas", json!({"epicKey":epic.key})),
        ("create_frame", json!({"title":"No","epicKey":epic.key})),
        ("update_frame", json!({"id":frame.id,"title":"No"})),
        (
            "connect_references",
            json!({"from":a["id"],"to":note.audit.id}),
        ),
        ("update_connection", json!({"id":edge.id,"label":"No"})),
        ("remove_connection", json!({"id":edge.id})),
        (
            "arrange_references",
            json!({"items":[{"itemId":a["id"],"x":123},{"itemId":note.audit.id,"x":123}]}),
        ),
        (
            "arrange_references",
            json!({"items":[{"itemId":b["id"]}],"frameId":frame.id}),
        ),
    ] {
        let error = f.reject(name, args);
        assert!(error.contains("project"), "{name}: {error}");
    }
    assert_eq!(before, f.call("get_canvas", json!({})));
    assert_eq!(count, f.store.activity_count().unwrap());
}
