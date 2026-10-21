fn main() {
    jam_board_lib::export_event_bindings(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts"),
    )
    .expect("export commands and events");
}
