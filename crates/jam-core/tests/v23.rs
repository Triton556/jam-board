use jam_core::*;
use std::io::{Read, Write};
fn setup() -> (tempfile::TempDir, Store, String) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
    std::fs::create_dir_all(&root).unwrap();
    let dir = tempfile::tempdir_in(root).unwrap();
    let s = Store::open(dir.path().join("jam.db")).unwrap();
    s.seed_demo().unwrap();
    let h = s.current_member().unwrap().id;
    (dir, s, h)
}
#[test]
fn clipboard_is_confined_registered_and_rejects_non_images() {
    let (d, s, h) = setup();
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src/assets/chibi/danil-laptop.png"),
    )
    .unwrap();
    let item = s.clipboard_reference(&h, &bytes, 24., 32.).unwrap();
    let asset = s
        .list_assets(None, None)
        .unwrap()
        .into_iter()
        .find(|a| Some(&a.id) == item.asset_id.as_ref())
        .unwrap();
    let path = std::path::Path::new(&asset.location);
    assert_eq!(
        path.parent().unwrap(),
        d.path().canonicalize().unwrap().join("references")
    );
    assert_eq!(std::fs::read(path).unwrap(), bytes);
    assert_eq!(asset.role, "reference");
    assert!(s.reference_media_path(&asset.id).unwrap().is_some());
    assert!(s.asset_preview_path("not-registered").is_err());
    assert!(s.reference_media_path("not-registered").is_err());
    assert!(s.clipboard_reference(&h, b"not png", 0., 0.).is_err());
}
#[test]
fn frames_parent_geometry_inheritance_and_reversible_archive() {
    let (_d, s, h) = setup();
    let actor = s
        .list_members()
        .unwrap()
        .into_iter()
        .find(|m| m.member.kind == "agent")
        .unwrap();
    let epic = s.list_epics().unwrap().remove(0);
    let add = || {
        s.add_reference(
            &actor.member.id,
            AddReference {
                kind: "note".into(),
                text: Some("Warm snow under amber light".into()),
                frame_epic_key: Some(epic.key.clone()),
                ..Default::default()
            },
        )
        .unwrap()
    };
    let first = add();
    let second = add();
    assert_eq!(first.frame_id, second.frame_id);
    assert_ne!(first.x, second.x);
    assert_eq!(s.list_ref_frames().unwrap().len(), 1);
    let f = s.list_ref_frames().unwrap().remove(0);
    s.update_ref_frame(
        &h,
        &f.id,
        FramePatch {
            epic_id: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        s.list_references(Some(&epic.key), None, None)
            .unwrap()
            .is_empty()
    );
    s.update_ref_frame(
        &h,
        &f.id,
        FramePatch {
            epic_id: Some(Some(epic.audit.id.clone())),
            ..Default::default()
        },
    )
    .unwrap();
    let human = s
        .add_reference(
            &h,
            AddReference {
                kind: "note".into(),
                text: Some("Human caption".into()),
                frame_id: Some(f.id.clone()),
                x: Some(40.),
                y: Some(60.),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(human.frame_id, Some(f.id));
    let t = s
        .get_epic(&epic.key)
        .unwrap()
        .stories
        .remove(0)
        .tasks
        .remove(0)
        .task;
    assert!(
        s.get_task(&t.key)
            .unwrap()
            .references
            .iter()
            .any(|r| r.audit.id == first.audit.id)
    );
    let before = s.activity_count().unwrap();
    let moved = s
        .canvas_geometry(
            &h,
            CanvasGeometry {
                id: first.audit.id.clone(),
                x: 480.,
                y: 360.,
                w: 260.,
                h: 220.,
                z: 3.,
                frame_id: None,
            },
        )
        .unwrap();
    assert!(moved.frame_id.is_none());
    assert_eq!(s.activity_count().unwrap(), before + 1);
    s.canvas_archive(
        &h,
        CanvasArchive {
            kind: "item".into(),
            id: first.audit.id.clone(),
            archived: true,
        },
    )
    .unwrap();
    assert!(
        !s.reference_canvas()
            .unwrap()
            .items
            .iter()
            .any(|i| i.audit.id == first.audit.id)
    );
    s.canvas_archive(
        &h,
        CanvasArchive {
            kind: "item".into(),
            id: first.audit.id.clone(),
            archived: false,
        },
    )
    .unwrap();
    assert!(
        s.reference_canvas()
            .unwrap()
            .items
            .iter()
            .any(|i| i.audit.id == first.audit.id)
    );
    s.set_canvas_viewport(&h, r#"{"x":24,"y":48,"zoom":0.5}"#)
        .unwrap();
    assert!(s.canvas_viewport(&h).unwrap().is_some());
    assert!(
        s.set_canvas_viewport(&h, r#"{"x":0,"y":0,"zoom":0}"#)
            .is_err()
    );
}
#[test]
fn link_add_is_offline_and_explicit_preview_stores_only_two_fields() {
    let (_d, s, h) = setup();
    let epic = s.list_epics().unwrap().remove(0);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let item = s
        .add_reference(
            &h,
            AddReference {
                kind: "link".into(),
                url: Some(format!("http://{}/palette", listener.local_addr().unwrap())),
                frame_epic_key: Some(epic.key.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    listener.set_nonblocking(false).unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut buf = [0; 4096];
        let _ = socket.read(&mut buf);
        let body = "<html><title>Amber &amp; snow</title><meta content='https://example.test/amber.png' property='og:image'><meta name='secret' content='do not store'><script>never store me</script></html>";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let item = s.fetch_reference_preview(&h, &item.audit.id).unwrap();
    server.join().unwrap();
    let preview: serde_json::Value =
        serde_json::from_str(item.link_preview.as_ref().unwrap()).unwrap();
    assert_eq!(preview.as_object().unwrap().len(), 2);
    assert_eq!(preview["title"], "Amber & snow");
    assert_eq!(preview["image"], "https://example.test/amber.png");
    assert!(!item.link_preview.unwrap().contains("secret"));
    let journal = s.epic_journal(&epic.key, 0).unwrap();
    let event = journal.last().unwrap();
    assert_eq!(event.action, "reference.updated");
    assert_eq!(event.payload["fields"], serde_json::json!(["linkPreview"]));
    assert!(
        s.store_link_preview(&h, &item.audit.id, None)
            .unwrap()
            .link_preview
            .is_none()
    );
}
#[test]
fn preview_cancels_a_stalled_transfer_after_five_seconds() {
    let (_d, s, h) = setup();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let item = s
        .add_reference(
            &h,
            AddReference {
                kind: "link".into(),
                url: Some(format!("http://{}/slow", listener.local_addr().unwrap())),
                ..Default::default()
            },
        )
        .unwrap();
    let before = serde_json::to_value(s.reference_canvas().unwrap()).unwrap();
    let (stop, stopped) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut socket, accepted) = loop {
            match listener.accept() {
                Ok((socket, _)) => break (socket, std::time::Instant::now()),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    // A failed client startup must not leave accept/join hanging.
                    match stopped.recv_timeout(std::time::Duration::from_millis(10)) {
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                        _ => return Ok(None),
                    }
                }
                Err(error) => return Err(error),
            }
        };
        socket.set_nonblocking(false)?;
        socket.set_read_timeout(Some(std::time::Duration::from_millis(5400)))?;
        let mut request = Vec::new();
        // Never send a response or close at a prearranged deadline. Only client
        // EOF is success; the 5.4s watchdog is bounded failure cleanup.
        let end = socket.read_to_end(&mut request);
        Ok(Some((accepted.elapsed(), request, end)))
    });
    let start = std::time::Instant::now();
    let result = s.fetch_reference_preview(&h, &item.audit.id);
    let call_elapsed = start.elapsed();
    let _ = stop.send(());
    let peer = server.join().unwrap();
    let error = result.as_ref().err().map(ToString::to_string);
    assert!(
        peer.is_ok(),
        "call={call_elapsed:?}, peer={peer:?}, error={error:?}"
    );
    let Some((transfer_elapsed, request, end)) = peer.unwrap() else {
        panic!("No loopback connection: call={call_elapsed:?}, error={error:?}");
    };
    let diagnostic = format!(
        "call={call_elapsed:?}, transfer={transfer_elapsed:?}, peer_end={end:?}, error={error:?}"
    );
    assert!(
        end.is_ok(),
        "Watchdog/read failure, not client EOF: {diagnostic}"
    );
    assert!(
        request.starts_with(b"GET /slow HTTP/1.1\r\n"),
        "No expected HTTP request: {diagnostic}"
    );
    assert!(
        error
            .as_deref()
            .is_some_and(|message| message.contains("5 second")),
        "{diagnostic}"
    );
    // Curl's transfer clock does not include process startup/reaping. Keep the
    // existing acceptance bounds, and sample each interval once for diagnosis.
    assert!(
        (4.8..5.4).contains(&transfer_elapsed.as_secs_f64()),
        "{diagnostic}"
    );
    assert!(
        s.reference_canvas().unwrap().items[0]
            .link_preview
            .is_none()
    );
    assert_eq!(
        serde_json::to_value(s.reference_canvas().unwrap()).unwrap(),
        before
    );
}
