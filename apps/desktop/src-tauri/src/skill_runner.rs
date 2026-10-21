use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillInput {
    pub playbook: String,
    pub target: String,
    pub client: String,
    pub profile: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillCheck {
    pub version: Option<String>,
    pub python: Option<String>,
    pub python_version: Option<String>,
    pub errors: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillResult {
    pub exit_code: Option<i32>,
    pub cancelled: bool,
    pub timed_out: bool,
}
#[derive(Debug, Clone)]
struct Python {
    program: String,
    prefix: Vec<String>,
    version: String,
}

fn validate(input: &SkillInput) -> Result<PathBuf, String> {
    if !["codex", "claude"].contains(&input.client.as_str())
        || !["jam-board", "full"].contains(&input.profile.as_str())
    {
        return Err("Choose Codex or Claude Code and a supported profile".into());
    }
    let root = std::fs::canonicalize(&input.playbook)
        .map_err(|_| "Choose a local agent-playbook folder")?;
    if !root.join("harness.py").is_file() || !root.join("manifest.json").is_file() {
        return Err("The playbook folder must contain harness.py and manifest.json".into());
    }
    let m: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("manifest.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|_| "Invalid manifest.json")?;
    if m["name"] != "agent-playbook" || m["version"].as_str().is_none() {
        return Err("Choose an agent-playbook checkout with a valid version".into());
    }
    if !Path::new(&input.target).is_absolute() {
        return Err("Choose an absolute project folder path".into());
    }
    let target =
        std::fs::canonicalize(&input.target).map_err(|_| "Choose an existing project folder")?;
    if !target.is_dir() || target.starts_with(&root) || root.starts_with(&target) {
        return Err("Choose a separate project folder outside the playbook checkout".into());
    }
    Ok(root)
}
fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    c.kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c
}
fn supported_python(version: &str) -> bool {
    let mut parts = version
        .trim()
        .strip_prefix("Python ")
        .unwrap_or("")
        .split('.');
    match (
        parts.next().and_then(|s| s.parse::<u32>().ok()),
        parts.next().and_then(|s| s.parse::<u32>().ok()),
    ) {
        (Some(major), Some(minor)) => (major, minor) >= (3, 12),
        _ => false,
    }
}
async fn python() -> Option<Python> {
    for (program, prefix) in [("py", vec!["-3"]), ("python", vec![]), ("python3", vec![])] {
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            command(program).args(&prefix).arg("--version").output(),
        )
        .await;
        if let Ok(Ok(out)) = output {
            if !out.status.success() {
                continue;
            }
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if supported_python(&version) {
                return Some(Python {
                    program: program.into(),
                    prefix: prefix.into_iter().map(str::to_owned).collect(),
                    version,
                });
            }
        }
    }
    None
}
pub async fn check(input: &SkillInput) -> SkillCheck {
    let mut errors = Vec::new();
    let version = match validate(input) {
        Ok(root) => std::fs::read(root.join("manifest.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["version"].as_str().map(str::to_owned)),
        Err(e) => {
            errors.push(e);
            None
        }
    };
    let p = python().await;
    if p.is_none() {
        errors.push(
            "Python 3.12 or newer is required. Install it separately, then check again.".into(),
        )
    }
    SkillCheck {
        version,
        python: p.as_ref().map(|p| {
            if p.prefix.is_empty() {
                p.program.clone()
            } else {
                format!("{} {}", p.program, p.prefix.join(" "))
            }
        }),
        python_version: p.map(|p| p.version),
        errors,
    }
}
fn argv(root: &Path, input: &SkillInput, step: &str) -> Result<Vec<String>, String> {
    if !["plan", "install", "verify"].contains(&step) {
        return Err("Only plan, install and verify are permitted".into());
    }
    let mut args = vec![
        "-B".into(),
        root.join("harness.py").to_string_lossy().into_owned(),
        step.into(),
        "--client".into(),
        input.client.clone(),
        "--target".into(),
        input.target.clone(),
    ];
    if step != "verify" {
        args.extend(["--profile".into(), input.profile.clone()])
    }
    Ok(args)
}
pub async fn run(
    input: SkillInput,
    step: &str,
    cancel: Arc<AtomicBool>,
    timeout: Duration,
    emit: impl Fn(String) + Send + Sync + 'static,
) -> Result<SkillResult, String> {
    let root = validate(&input)?;
    let p = python().await.ok_or("Python 3.12 or newer is required")?;
    if cancel.load(Ordering::SeqCst) {
        return Ok(SkillResult {
            exit_code: None,
            cancelled: true,
            timed_out: false,
        });
    }
    run_process(
        &p.program,
        [p.prefix, argv(&root, &input, step)?].concat(),
        &root,
        cancel,
        timeout,
        emit,
    )
    .await
}
async fn run_process(
    program: &str,
    args: Vec<String>,
    cwd: &Path,
    cancel: Arc<AtomicBool>,
    timeout: Duration,
    emit: impl Fn(String) + Send + Sync + 'static,
) -> Result<SkillResult, String> {
    let mut child = command(program)
        .args(args)
        .current_dir(cwd)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| format!("Cannot start Python: {e}"))?;
    let out = child.stdout.take().ok_or("Missing stdout")?;
    let err = child.stderr.take().ok_or("Missing stderr")?;
    let emit: Arc<dyn Fn(String) + Send + Sync> = Arc::new(emit);
    let stream = |reader: Box<dyn tokio::io::AsyncRead + Unpin + Send>,
                  emit: Arc<dyn Fn(String) + Send + Sync>| {
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit(line)
            }
        })
    };
    let stdout = stream(Box::new(out), emit.clone());
    let stderr = stream(Box::new(err), emit);
    let start = std::time::Instant::now();
    let mut result = SkillResult {
        exit_code: None,
        cancelled: false,
        timed_out: false,
    };
    loop {
        if cancel.load(Ordering::SeqCst) || start.elapsed() >= timeout {
            result.cancelled = cancel.load(Ordering::SeqCst);
            result.timed_out = !result.cancelled;
            child.kill().await.map_err(|e| e.to_string())?;
            let status = child.wait().await.map_err(|e| e.to_string())?;
            result.exit_code = status.code();
            break;
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            result.exit_code = status.code();
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let _ = stdout.await;
    let _ = stderr.await;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    fn root() -> PathBuf {
        let base =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.dev-data/skill-runner-tests");
        let path = base.join(format!(
            "{}-{}",
            std::process::id(),
            COUNT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn setup() -> (PathBuf, SkillInput) {
        let root = root();
        let source = root.join("playbook space ' quotes");
        let target = root.join("project space & no shell");
        std::fs::create_dir(&source).unwrap();
        std::fs::create_dir(&target).unwrap();
        std::fs::write(source.join("harness.py"), "print('stub')").unwrap();
        std::fs::write(
            source.join("manifest.json"),
            r#"{"name":"agent-playbook","version":"1.3.0"}"#,
        )
        .unwrap();
        let input = SkillInput {
            playbook: source.to_string_lossy().into_owned(),
            target: target.to_string_lossy().into_owned(),
            client: "claude".into(),
            profile: "jam-board".into(),
        };
        (root, input)
    }
    #[test]
    fn enforces_python_minimum_version() {
        assert!(!supported_python("Python 3.11.9"));
        assert!(!supported_python("Python 2.7.18"));
        assert!(!supported_python("not Python"));
        assert!(supported_python("Python 3.12.0"));
        assert!(supported_python("Python 3.14.5"));
    }
    #[test]
    fn argv_is_allowlisted_and_paths_are_separate_arguments() {
        let (root, input) = setup();
        let source = validate(&input).unwrap();
        for step in ["plan", "install", "verify"] {
            let args = argv(&source, &input, step).unwrap();
            assert_eq!(args[0], "-B");
            assert!(args[1].ends_with("harness.py"));
            assert_eq!(args[2], step);
            assert_eq!(args[6], input.target);
            assert_eq!(args.contains(&"--profile".into()), step != "verify");
            assert!(!args.contains(&"-c".into()));
        }
        let mut relative = input.clone();
        relative.target = "relative-project".into();
        assert!(validate(&relative).unwrap_err().contains("absolute"));
        assert!(argv(&source, &input, "doctor").is_err());
        assert!(argv(&source, &input, "install && calc").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn validates_source_and_python_without_executing_the_harness() {
        let (root, input) = setup();
        let result = check(&input).await;
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert_eq!(result.version.as_deref(), Some("1.3.0"));
        assert!(result.python_version.unwrap().starts_with("Python 3."));
        std::fs::remove_file(Path::new(&input.playbook).join("harness.py")).unwrap();
        assert!(validate(&input).unwrap_err().contains("harness.py"));
        std::fs::write(Path::new(&input.playbook).join("harness.py"), "").unwrap();
        std::fs::remove_file(Path::new(&input.playbook).join("manifest.json")).unwrap();
        assert!(validate(&input).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn timeout_and_cancel_kill_and_wait_for_the_child() {
        let (root, input) = setup();
        let source = Path::new(&input.playbook);
        std::fs::write(source.join("harness.py"),"import time, pathlib\nprint('started',flush=True)\ntime.sleep(1)\npathlib.Path('child-survived').write_text('bad')\n").unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let r = run(
            input.clone(),
            "plan",
            cancelled,
            Duration::from_millis(100),
            |_| {},
        )
        .await
        .unwrap();
        assert!(r.timed_out);
        let flag = Arc::new(AtomicBool::new(false));
        let on_output = flag.clone();
        let r = run(
            input.clone(),
            "install",
            flag,
            Duration::from_secs(10),
            move |line| {
                if line == "started" {
                    on_output.store(true, Ordering::SeqCst)
                }
            },
        )
        .await
        .unwrap();
        assert!(r.cancelled);
        assert!(!r.timed_out);
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(!source.join("child-survived").exists());
        let mut bad = input;
        bad.client = "claude && calc".into();
        assert!(
            run(
                bad,
                "plan",
                Arc::new(AtomicBool::new(false)),
                Duration::from_secs(1),
                |_| {}
            )
            .await
            .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
