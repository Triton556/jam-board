//! Project-local installation of the skill shipped with this exact application.
//! No downloads, Python, global client configuration or agent launches.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

const ENTRY: &str = include_str!("../../../../integrations/agent-skill/jam-board/SKILL.md");
const OPERATIONS: &str =
    include_str!("../../../../integrations/agent-skill/jam-board/references/operations.md");
const RECEIPT: &str = ".jam-board-skill.json";
static SERIAL: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillInput {
    pub target: String,
    pub client: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillCheck {
    pub version: String,
    pub destination: Option<String>,
    pub status: String,
    pub errors: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillResult {
    pub exit_code: Option<i32>,
    pub cancelled: bool,
    pub timed_out: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    format: u32,
    owner: String,
    version: String,
    files: BTreeMap<String, String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrustedRecord {
    target: String,
    client: String,
    receipt: Receipt,
}
fn target_identity(input: &SkillInput) -> String {
    fs::canonicalize(&input.target)
        .unwrap_or_else(|_| PathBuf::from(&input.target))
        .to_string_lossy()
        .into_owned()
}
fn trusted_path(input: &SkillInput, root: &Path) -> PathBuf {
    // Stable lookup key only, not a security hash. The record's full identity is
    // checked before use, including on first installation, to reject collisions.
    let key = format!("{}\0{}", target_identity(input), input.client);
    let mut hash = 0xcbf29ce484222325u64;
    for byte in key.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    root.join(format!("{hash:016x}.json"))
}
#[derive(Debug)]
struct Plan {
    destination: PathBuf,
    status: &'static str,
}
fn bundle() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("SKILL.md".into(), ENTRY.into()),
        ("references/operations.md".into(), OPERATIONS.into()),
    ])
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn no_links(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for part in path.components() {
        if matches!(part, Component::ParentDir) {
            return Err("Use an absolute project path without '..'".into());
        }
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "Symbolic links are not installation targets: {}",
                    current.display()
                ));
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(error(e)),
        }
    }
    Ok(())
}
fn validate_tree(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(error)?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "Preserve linked file and resolve it manually: {}",
            path.display()
        ));
    }
    if meta.is_dir() {
        for item in fs::read_dir(path).map_err(error)? {
            validate_tree(&item.map_err(error)?.path())?;
        }
    } else if !meta.is_file() {
        return Err(format!("Unsupported special file: {}", path.display()));
    }
    Ok(())
}
fn inspect(
    input: &SkillInput,
    files: &BTreeMap<String, String>,
    version: &str,
    trust: &Path,
) -> Result<Plan, String> {
    no_links(trust)?;
    no_links(&trusted_path(input, trust))?;
    let client = match input.client.as_str() {
        "codex" => ".agents",
        "claude" => ".claude",
        _ => return Err("Choose Codex or Claude Code".into()),
    };
    let target = Path::new(&input.target);
    if !target.is_absolute() || !target.is_dir() {
        return Err("Choose an existing absolute project folder".into());
    }
    no_links(target)?;
    let destination = target.join(client).join("skills/jam-board");
    no_links(&destination)?;
    if !destination.exists() {
        let prior = trusted_path(input, trust);
        if prior.exists() {
            let record: TrustedRecord = serde_json::from_slice(&fs::read(prior).map_err(error)?)
                .map_err(|_| "Invalid app ownership record".to_string())?;
            if record.target != target_identity(input) || record.client != input.client {
                return Err("App ownership record identity conflict; no files changed".into());
            }
        }
        return Ok(Plan {
            destination,
            status: "new",
        });
    }
    if !destination.is_dir() {
        return Err("The skill destination is not a directory; nothing was changed".into());
    }
    validate_tree(&destination)?;
    let receipt:Receipt=serde_json::from_slice(&fs::read(destination.join(RECEIPT)).map_err(|_| "An existing Jam Board skill has no app ownership receipt; nothing was overwritten. If agent-playbook 2.0 or older installed it, remove it with that playbook version, or save your edits and move the folder aside, then install again".to_string())?).map_err(|_|"Invalid skill ownership receipt; nothing was changed".to_string())?;
    if receipt.format != 1 || receipt.owner != "jam-board" || receipt.files.keys().ne(files.keys())
    {
        return Err("Unsupported skill ownership receipt; preserve this installation for explicit migration".into());
    }
    let trusted:TrustedRecord=serde_json::from_slice(&fs::read(trusted_path(input,trust)).map_err(|_| "Original app ownership record is missing. Preserve this installation for explicit migration".to_string())?).map_err(|_| "Invalid app ownership record".to_string())?;
    if trusted.target != target_identity(input)
        || trusted.client != input.client
        || trusted.receipt != receipt
    {
        return Err(
            "Skill receipt differs from the app ownership record; preserve files for inspection"
                .into(),
        );
    }
    for (path, expected) in &receipt.files {
        let actual = fs::read(destination.join(path)).map_err(|_| {
            format!(
                "Managed file is missing: {path}. Preserve and reconcile it before reinstalling"
            )
        })?;
        if actual != expected.as_bytes() {
            return Err(format!(
                "Managed file was edited: {path}. Your version is preserved; reconcile it before reinstalling"
            ));
        }
    }
    let status = if receipt.version == version && receipt.files == *files {
        "current"
    } else {
        "upgrade"
    };
    Ok(Plan {
        destination,
        status,
    })
}
pub async fn check(input: &SkillInput, trust: &Path) -> SkillCheck {
    let version = env!("CARGO_PKG_VERSION").to_string();
    match inspect(input, &bundle(), &version, trust) {
        Ok(plan) => SkillCheck {
            version,
            destination: Some(plan.destination.to_string_lossy().into()),
            status: plan.status.into(),
            errors: vec![],
        },
        Err(e) => SkillCheck {
            version,
            destination: None,
            status: "blocked".into(),
            errors: vec![e],
        },
    }
}
fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(error)?;
    for item in fs::read_dir(source).map_err(error)? {
        let item = item.map_err(error)?;
        let from = item.path();
        let to = destination.join(item.file_name());
        let meta = fs::symlink_metadata(&from).map_err(error)?;
        if meta.file_type().is_symlink() {
            return Err("A symbolic link appeared during installation; stopped".into());
        }
        if meta.is_dir() {
            copy_tree(&from, &to)?;
        } else if meta.is_file() {
            fs::copy(from, to).map_err(error)?;
        } else {
            return Err("A special file appeared during installation; stopped".into());
        }
    }
    Ok(())
}
fn tree_snapshot(root: &Path) -> Result<BTreeMap<PathBuf, Option<Vec<u8>>>, String> {
    fn visit(
        root: &Path,
        path: &Path,
        out: &mut BTreeMap<PathBuf, Option<Vec<u8>>>,
    ) -> Result<(), String> {
        let meta = fs::symlink_metadata(path).map_err(error)?;
        if meta.file_type().is_symlink() {
            return Err("A link appeared during installation".into());
        }
        let key = path.strip_prefix(root).map_err(error)?.to_path_buf();
        if meta.is_dir() {
            out.insert(key, None);
            for item in fs::read_dir(path).map_err(error)? {
                visit(root, &item.map_err(error)?.path(), out)?;
            }
        } else if meta.is_file() {
            out.insert(key, Some(fs::read(path).map_err(error)?));
        } else {
            return Err("A special file appeared during installation".into());
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    visit(root, root, &mut out)?;
    Ok(out)
}
fn unique_sibling(destination: &Path, kind: &str) -> PathBuf {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    destination.with_file_name(format!(
        ".jam-board-{kind}-{}-{time}-{}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::SeqCst)
    ))
}

fn install(
    input: &SkillInput,
    files: &BTreeMap<String, String>,
    version: &str,
    trust: &Path,
    cancel: &AtomicBool,
    emit: &impl Fn(String),
) -> Result<(), String> {
    let plan = inspect(input, files, version, trust)?;
    if plan.status == "current" {
        emit("Already current; no files changed".into());
        return Ok(());
    }
    let destination = &plan.destination;
    let parent = destination.parent().ok_or("Invalid destination")?;
    fs::create_dir_all(parent).map_err(error)?;
    no_links(parent)?;
    let staging_root = Path::new(&input.target)
        .join(".jam-board/skill-installations")
        .join(&input.client);
    no_links(&staging_root)?;
    fs::create_dir_all(&staging_root).map_err(error)?;
    let stage = unique_sibling(&staging_root.join("jam-board"), "staging");
    let original = if destination.exists() {
        Some(tree_snapshot(destination)?)
    } else {
        None
    };
    let stage_result = (|| {
        if destination.exists() {
            copy_tree(destination, &stage)?;
        } else {
            fs::create_dir(&stage).map_err(error)?;
        }
        for (path, body) in files {
            let file = stage.join(path);
            fs::create_dir_all(file.parent().ok_or("Invalid file")?).map_err(error)?;
            fs::write(file, body).map_err(error)?;
        }
        let receipt = Receipt {
            format: 1,
            owner: "jam-board".into(),
            version: version.into(),
            files: files.clone(),
        };
        fs::write(
            stage.join(RECEIPT),
            serde_json::to_vec_pretty(&receipt).map_err(error)?,
        )
        .map_err(error)?;
        Ok::<_, String>(())
    })();
    if let Err(e) = stage_result {
        let _ = fs::remove_dir_all(&stage);
        return Err(e);
    }
    if cancel.load(Ordering::SeqCst) {
        let _ = fs::remove_dir_all(&stage);
        return Err("Installation cancelled before changing skill files".into());
    }
    // Revalidate immediately before switching folders; no old intent is replayed.
    if let Err(e) = inspect(input, files, version, trust) {
        let _ = fs::remove_dir_all(&stage);
        return Err(e);
    }
    let now = if destination.exists() {
        Some(tree_snapshot(destination)?)
    } else {
        None
    };
    if original != now {
        let _ = fs::remove_dir_all(&stage);
        return Err("Files changed while preparing installation. Nothing was replaced; inspect the new state and retry".into());
    }
    let backup = if destination.exists() {
        let backup = unique_sibling(&staging_root.join("jam-board"), "backup");
        if let Err(e) = fs::rename(destination, &backup) {
            let _ = fs::remove_dir_all(&stage);
            return Err(error(e));
        }
        Some(backup)
    } else {
        None
    };
    if let Err(e) = fs::rename(&stage, destination) {
        if let Some(ref backup) = backup
            && let Err(restore) = fs::rename(backup, destination)
        {
            return Err(format!(
                "Install failed: {e}. Restore failed: {restore}. Original files remain at {}",
                backup.display()
            ));
        }
        let _ = fs::remove_dir_all(&stage);
        return Err(error(e));
    }
    let save_trust = (|| {
        no_links(trust)?;
        fs::create_dir_all(trust).map_err(error)?;
        let path = trusted_path(input, trust);
        let temp = unique_sibling(&path, "receipt");
        let record = TrustedRecord {
            target: target_identity(input),
            client: input.client.clone(),
            receipt: Receipt {
                format: 1,
                owner: "jam-board".into(),
                version: version.into(),
                files: files.clone(),
            },
        };
        fs::write(&temp, serde_json::to_vec_pretty(&record).map_err(error)?).map_err(error)?;
        let previous = if path.exists() {
            let prior = unique_sibling(&path, "prior-receipt");
            fs::rename(&path, &prior).map_err(error)?;
            Some(prior)
        } else {
            None
        };
        if let Err(e) = fs::rename(&temp, &path) {
            if let Some(previous) = previous {
                let _ = fs::rename(previous, &path);
            }
            return Err(error(e));
        }
        Ok::<_, String>(())
    })();
    if let Err(e) = save_trust {
        let failed = unique_sibling(&staging_root.join("jam-board"), "failed");
        fs::rename(destination,&failed).map_err(|move_error|format!("Ownership record failed: {e}; installed files could not be set aside: {move_error}. Original backup: {backup:?}"))?;
        if let Some(ref backup) = backup {
            fs::rename(backup,destination).map_err(|restore|format!("Ownership record failed: {e}; restore failed: {restore}. Original retained at {}",backup.display()))?;
        }
        return Err(format!(
            "Ownership record could not be saved: {e}. Installation rolled back; candidate retained at {}",
            failed.display()
        ));
    }
    if let Some(backup) = backup {
        emit(format!(
            "Previous installation retained at {}",
            backup.display()
        ));
    }
    emit(format!(
        "Installed bundled Jam Board skill {version} at {}",
        destination.display()
    ));
    Ok(())
}
pub async fn run(
    input: SkillInput,
    step: &str,
    trust: PathBuf,
    cancel: Arc<AtomicBool>,
    _timeout: Duration,
    emit: impl Fn(String) + Send + Sync + 'static,
) -> Result<SkillResult, String> {
    let step = step.to_owned();
    tokio::task::spawn_blocking(move || run_sync(input, &step, trust, cancel, _timeout, emit))
        .await
        .map_err(error)?
}
fn run_sync(
    input: SkillInput,
    step: &str,
    trust: PathBuf,
    cancel: Arc<AtomicBool>,
    _timeout: Duration,
    emit: impl Fn(String) + Send + Sync + 'static,
) -> Result<SkillResult, String> {
    if !["plan", "install", "verify"].contains(&step) {
        return Err("Only plan, install and verify are permitted".into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(SkillResult {
            exit_code: None,
            cancelled: true,
            timed_out: false,
        });
    }
    let files = bundle();
    let version = env!("CARGO_PKG_VERSION");
    let plan = inspect(&input, &files, version, &trust)?;
    emit(format!(
        "Bundled Jam Board skill {version} · {} · {}",
        plan.status,
        plan.destination.display()
    ));
    match step {
        "plan"=>emit("Plan only: no files changed. Install changes this project's skill only; existing edited/unowned files stop installation. Upgrades keep a backup.".into()),
        "install"=>install(&input,&files,version,&trust,&cancel,&emit)?,
        "verify" if plan.status!="current"=>return Err("Installed skill does not match this application version".into()),
        "verify"=>emit("Installed files match this application. This is not a live MCP or model-behavior test.".into()),
        _=>unreachable!(),
    }
    Ok(SkillResult {
        exit_code: Some(0),
        cancelled: false,
        timed_out: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn trust(i: &SkillInput) -> PathBuf {
        Path::new(&i.target).join("test-app-private-receipts")
    }
    fn inspect(i: &SkillInput, f: &BTreeMap<String, String>, v: &str) -> Result<Plan, String> {
        super::inspect(i, f, v, &trust(i))
    }
    fn install(
        i: &SkillInput,
        f: &BTreeMap<String, String>,
        v: &str,
        c: &AtomicBool,
        e: &impl Fn(String),
    ) -> Result<(), String> {
        super::install(i, f, v, &trust(i), c, e)
    }
    async fn run(
        i: SkillInput,
        s: &str,
        c: Arc<AtomicBool>,
        d: Duration,
        e: impl Fn(String) + Send + Sync + 'static,
    ) -> Result<SkillResult, String> {
        let t = trust(&i);
        super::run(i, s, t, c, d, e).await
    }

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "jam-skill-test-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
        fn input(&self, client: &str) -> SkillInput {
            SkillInput {
                target: self.0.to_string_lossy().into(),
                client: client.into(),
            }
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn put(input: &SkillInput, files: &BTreeMap<String, String>, version: &str) {
        install(input, files, version, &AtomicBool::new(false), &|_| {}).unwrap();
    }
    #[test]
    fn installs_both_clients_without_touching_project_or_global_config() {
        for client in ["codex", "claude"] {
            let t = Temp::new();
            fs::write(t.0.join("AGENTS.md"), "human rules").unwrap();
            let input = t.input(client);
            let files = bundle();
            assert_eq!(inspect(&input, &files, "1").unwrap().status, "new");
            put(&input, &files, "1");
            assert_eq!(inspect(&input, &files, "1").unwrap().status, "current");
            assert_eq!(
                fs::read_to_string(t.0.join("AGENTS.md")).unwrap(),
                "human rules"
            );
        }
    }
    #[test]
    fn upgrade_keeps_backup_and_neighbor_files() {
        let t = Temp::new();
        let i = t.input("codex");
        let old = bundle();
        put(&i, &old, "old");
        let d = inspect(&i, &old, "old").unwrap().destination;
        fs::write(d.join("user-note.md"), "retain me").unwrap();
        let mut new = old.clone();
        new.insert("SKILL.md".into(), "new instructions".into());
        put(&i, &new, "new");
        assert_eq!(
            fs::read_to_string(d.join("user-note.md")).unwrap(),
            "retain me"
        );
        let backup = fs::read_dir(t.0.join(".jam-board/skill-installations/codex"))
            .unwrap()
            .map(|x| x.unwrap().path())
            .find(|x| {
                x.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".jam-board-backup")
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(backup.join("SKILL.md")).unwrap(),
            old["SKILL.md"]
        );
        assert_eq!(inspect(&i, &new, "new").unwrap().status, "current");
    }
    #[test]
    fn modified_owned_file_is_not_overwritten() {
        let t = Temp::new();
        let i = t.input("claude");
        let files = bundle();
        put(&i, &files, "old");
        let d = inspect(&i, &files, "old").unwrap().destination;
        fs::write(d.join("SKILL.md"), "my edits").unwrap();
        assert!(
            install(&i, &files, "new", &AtomicBool::new(false), &|_| {})
                .unwrap_err()
                .contains("edited")
        );
        assert_eq!(fs::read_to_string(d.join("SKILL.md")).unwrap(), "my edits");
    }
    #[test]
    fn unowned_installation_is_preserved() {
        let t = Temp::new();
        let i = t.input("codex");
        let d = t.0.join(".agents/skills/jam-board");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("SKILL.md"), "old playbook").unwrap();
        assert!(
            inspect(&i, &bundle(), "1")
                .unwrap_err()
                .contains("no app ownership receipt")
        );
        assert_eq!(
            fs::read_to_string(d.join("SKILL.md")).unwrap(),
            "old playbook"
        );
    }
    #[tokio::test]
    async fn plan_is_read_only_and_verify_missing_fails() {
        let t = Temp::new();
        let i = t.input("codex");
        run(
            i.clone(),
            "plan",
            Arc::new(AtomicBool::new(false)),
            Duration::from_secs(1),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(fs::read_dir(&t.0).unwrap().count(), 0);
        assert!(
            run(
                i,
                "verify",
                Arc::new(AtomicBool::new(false)),
                Duration::from_secs(1),
                |_| {}
            )
            .await
            .is_err()
        );
    }
    #[test]
    fn cancellation_leaves_no_skill() {
        let t = Temp::new();
        let i = t.input("codex");
        assert!(install(&i, &bundle(), "1", &AtomicBool::new(true), &|_| {}).is_err());
        assert!(!t.0.join(".agents/skills/jam-board").exists());
    }
    #[test]
    fn repeat_install_is_idempotent() {
        let t = Temp::new();
        let i = t.input("codex");
        let f = bundle();
        put(&i, &f, "1");
        put(&i, &f, "1");
        let parent = t.0.join(".agents/skills");
        assert_eq!(fs::read_dir(parent).unwrap().count(), 1);
    }
    #[cfg(unix)]
    #[test]
    fn linked_destination_and_linked_neighbor_are_rejected() {
        use std::os::unix::fs::symlink;
        let t = Temp::new();
        let i = t.input("codex");
        let outside = Temp::new();
        symlink(&outside.0, t.0.join(".agents")).unwrap();
        assert!(inspect(&i, &bundle(), "1").is_err());
        fs::remove_file(t.0.join(".agents")).unwrap();
        put(&i, &bundle(), "1");
        let d = t.0.join(".agents/skills/jam-board");
        symlink(outside.0.join("secret"), d.join("linked")).unwrap();
        assert!(inspect(&i, &bundle(), "1").is_err());
    }
    #[test]
    fn changed_receipt_does_not_hide_edited_file() {
        let t = Temp::new();
        let i = t.input("codex");
        let f = bundle();
        put(&i, &f, "1");
        let d = inspect(&i, &f, "1").unwrap().destination;
        let p = d.join(RECEIPT);
        let mut r: Receipt = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
        r.files.insert("SKILL.md".into(), "my edits".into());
        fs::write(d.join("SKILL.md"), "my edits").unwrap();
        fs::write(p, serde_json::to_vec(&r).unwrap()).unwrap();
        assert!(inspect(&i, &f, "2").unwrap_err().contains("differs"));
    }
    #[test]
    fn missing_private_record_preserves_existing_install() {
        let t = Temp::new();
        let i = t.input("codex");
        let f = bundle();
        put(&i, &f, "1");
        let d = inspect(&i, &f, "1").unwrap().destination;
        fs::remove_file(trusted_path(&i, &trust(&i))).unwrap();
        assert!(inspect(&i, &f, "2").unwrap_err().contains("missing"));
        assert_eq!(
            fs::read_to_string(d.join("SKILL.md")).unwrap(),
            f["SKILL.md"]
        );
    }
    #[test]
    fn receipt_write_failure_rolls_back_fresh_install() {
        let t = Temp::new();
        let i = t.input("codex");
        fs::write(trust(&i), "blocks directory creation").unwrap();
        assert!(install(&i, &bundle(), "1", &AtomicBool::new(false), &|_| {}).is_err());
        assert!(!t.0.join(".agents/skills/jam-board").exists());
    }
}
