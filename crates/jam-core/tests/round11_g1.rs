use jam_core::*;
use std::path::Path;

#[test]
fn registry_retains_display_name_after_rename_close_and_missing_folder() {
    let root = tempfile::tempdir().unwrap();
    let manager = ProjectManager::new(root.path().join("fictional-appdata")).unwrap();
    let handle = manager
        .create(&root.path().join("Board"), "Lantern workshop", false)
        .unwrap();
    assert_eq!(
        manager.registry.entries().unwrap()[0].project_name,
        "Lantern workshop"
    );
    let actor = handle.store.current_member().unwrap();
    handle
        .store
        .edit_project(
            &actor.id,
            ProjectEditInput {
                name: Some("Renamed workshop".into()),
                template: "custom".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        manager.registry.entries().unwrap()[0].project_name,
        "Renamed workshop"
    );
    handle
        .store
        .update_jam(&actor.id, "Final workshop", None, None)
        .unwrap();
    manager.close().unwrap();
    let instance = handle.instance_id.clone();
    let folder = handle.folder.clone();
    drop(handle);
    // Registry-only observation of an unavailable path: never open another board to get its name.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match std::fs::rename(&folder, root.path().join("Offline")) {
            Ok(()) => break,
            Err(_) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            Err(error) => panic!("rename disposable fixture: {error}"),
        }
    }
    let reopened = ProjectRegistry::open(root.path().join("fictional-appdata")).unwrap();
    let entry = &reopened.entries().unwrap()[0];
    assert_eq!(entry.instance_id, instance);
    assert_eq!(entry.project_name, "Final workshop");
    assert!(!Path::new(&entry.canonical_folder).exists());
}

#[test]
fn json_is_other_for_files_and_urls_while_documents_and_models_keep_their_kinds() {
    for path in [
        "config.json",
        "settings.json",
        "C:/data/CONFIG.JSON",
        "https://example.test/settings.json",
        "https://example.test/config.json?download=1",
    ] {
        assert_eq!(classify_file(Path::new(path)), "other", "{path}");
    }
    for path in [
        "brief.pdf",
        "brief.doc",
        "brief.docx",
        "brief.odt",
        "brief.rtf",
        "brief.md",
        "brief.txt",
    ] {
        assert_eq!(classify_file(Path::new(path)), "document", "{path}");
    }
    assert_eq!(classify_file(Path::new("boat.glb")), "model");
    assert_eq!(classify_file(Path::new("map.tmx")), "level");
}
