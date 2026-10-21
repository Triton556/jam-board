use jam_core::Store;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = root.join(".dev-data/fixture-export");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.db", ulid::Ulid::generate()));
    let store = Store::open(&path)?;
    store.seed_demo()?;
    let tasks = store.list_board_tasks()?;
    let details = tasks
        .values()
        .flatten()
        .map(|t| store.get_task(&t.key))
        .collect::<jam_core::Result<Vec<_>>>()?;
    let fixture = serde_json::json!({"epics":store.plan_epics()?,"stories":store.plan_epics()?.iter().flat_map(|e|store.get_epic(&e.key).unwrap().stories.into_iter().map(|s|s.story)).collect::<Vec<_>>(),"questions":store.list_questions(None,None)?,"assets":store.list_assets(None,None)?,"app":store.app_state()?,"board":store.board_summary()?,"tasks":tasks,"members":store.list_members()?.into_iter().map(|m|m.member).collect::<Vec<_>>(),"details":details,"activity":store.list_activity(None,Some(2000))?});
    let out = root.join("apps/desktop/src/lib/demo-fixture.json");
    std::fs::create_dir_all(out.parent().unwrap())?;
    std::fs::write(
        &out,
        format!("{}\n", serde_json::to_string_pretty(&fixture)?),
    )?;
    println!("Exported {} demo tasks to {}", details.len(), out.display());
    Ok(())
}
