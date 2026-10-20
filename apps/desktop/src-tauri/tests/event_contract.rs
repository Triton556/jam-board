use jam_board_lib::{BoardChanged, export_event_bindings};
use jam_core::{ActivityEvent, MemberRef};
use tauri_specta::Event;

#[test]
fn recursive_json_event_exports_without_changing_the_wire_shape() {
    assert_eq!(BoardChanged::NAME, "board-changed");
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.dev-data/tests");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("event-bindings.ts");
    export_event_bindings(&file).unwrap();
    let generated = std::fs::read_to_string(file).unwrap();
    assert!(generated.contains("payload: JsonPayload"));
    assert!(generated.contains("JsonPayload[]"));
    assert!(!generated.contains("\"Null\""));
    let committed = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts");
    assert_eq!(
        generated.replace("\r\n", "\n"),
        std::fs::read_to_string(committed)
            .unwrap()
            .replace("\r\n", "\n"),
        "Regenerate bindings with cargo run -p jam-board --example export-bindings"
    );
    let event = BoardChanged {
        events: vec![ActivityEvent {
            seq: 1,
            action: "jam.updated".into(),
            actor: MemberRef {
                id: "member".into(),
                kind: "human".into(),
                name: "Danil".into(),
                handle: "danil".into(),
                color: "#5B8DEF".into(),
            },
            task_key: None,
            payload: serde_json::json!({"field":[null,{"nested":[true,1,"text"]}]}),
            created_at: jam_core::now(),
        }],
    };
    let json = serde_json::to_value(&event).unwrap();
    assert!(json["events"][0].get("taskKey").is_none());
    let decoded: BoardChanged = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), json);
}
