// Local transport/process fixtures only; native whisper.cpp acceptance is separate.
use super::*;
use axum::{
    Router,
    body::{Body, Bytes},
    extract::State as HttpState,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
};

fn temp() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-visuals/round5/w5");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
fn engine(dir: &Path) -> LocalWhisper {
    hardware_engine(dir, false)
}
fn hardware_engine(dir: &Path, gpu: bool) -> LocalWhisper {
    LocalWhisper::with_hardware(dir, Arc::new(|_| {}), download::Sources::default(), gpu, 6)
        .unwrap()
}
fn wav(seconds: usize) -> Vec<u8> {
    let size = seconds * 32_000;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + size as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
    wav.extend_from_slice(&16_000u32.to_le_bytes());
    wav.extend_from_slice(&32_000u32.to_le_bytes());
    wav.extend_from_slice(b"\x02\0\x10\0data");
    wav.extend_from_slice(&(size as u32).to_le_bytes());
    wav.resize(44 + size, 0);
    wav
}
fn input() -> TranscribeInput {
    TranscribeInput {
        wav_base64: base64::engine::general_purpose::STANDARD.encode(wav(1)),
        language: Some(VoiceLanguage::Ru),
        initial_prompt: Some("Board JB-12 Привет".into()),
    }
}
async fn enable(engine: &LocalWhisper) {
    engine
        .save_settings(VoiceSettings {
            enabled: true,
            device: VoiceDevice::Cpu,
            ..Default::default()
        })
        .await
        .unwrap();
}
fn install_fixture(engine: &LocalWhisper) {
    let runtime = engine.runtime_dir(VoiceDevice::Cpu);
    std::fs::create_dir_all(&runtime).unwrap();
    std::fs::write(runtime.join("whisper-server.exe"), b"test fixture").unwrap();
    std::fs::create_dir_all(engine.model_path(VoiceModel::Balanced).parent().unwrap()).unwrap();
    std::fs::write(engine.model_path(VoiceModel::Balanced), b"fake model").unwrap();
}
fn use_fixture(engine: &mut LocalWhisper, timeout: Option<Duration>) {
    let inner = Arc::get_mut(&mut engine.inner).unwrap();
    inner.fixture_process = true;
    inner.idle_timeout = timeout;
}

fn settings_input(
    enabled: bool,
    model: Option<VoiceModel>,
    device: VoiceDevice,
) -> VoiceSettingsInput {
    VoiceSettingsInput {
        enabled,
        model,
        device,
        language: VoiceLanguage::Auto,
        idle_unload_minutes: Some(10),
    }
}

#[test]
fn device_recommendation_matrix_and_release_pin() {
    assert_eq!(
        WHISPER_RELEASE,
        (
            "v1.9.2",
            "whisper-bin-x64.zip",
            "whisper-cublas-12*-bin-x64.zip"
        )
    );
    for (gpu, requested, effective, recommended) in [
        (
            false,
            VoiceDevice::Auto,
            VoiceDevice::Cpu,
            RecommendedModel::Fast,
        ),
        (
            true,
            VoiceDevice::Auto,
            VoiceDevice::Gpu,
            RecommendedModel::Balanced,
        ),
        (
            false,
            VoiceDevice::Cpu,
            VoiceDevice::Cpu,
            RecommendedModel::Fast,
        ),
        (
            true,
            VoiceDevice::Cpu,
            VoiceDevice::Cpu,
            RecommendedModel::Fast,
        ),
        (
            false,
            VoiceDevice::Gpu,
            VoiceDevice::Gpu,
            RecommendedModel::Balanced,
        ),
        (
            true,
            VoiceDevice::Gpu,
            VoiceDevice::Gpu,
            RecommendedModel::Balanced,
        ),
    ] {
        assert_eq!(requested.effective(gpu), effective);
        assert_eq!(requested.recommended_model(gpu), recommended);
        let dir = temp();
        let engine = hardware_engine(dir.path(), gpu);
        engine.lock().settings.device = requested;
        let status = engine.status().unwrap();
        assert_eq!(status.recommended_model, recommended);
        assert_eq!(status.gpu_available, gpu);
        assert_eq!(engine.runtime_dir(requested), engine.runtime_dir(effective));
    }
}

#[test]
fn server_flags_respect_physical_core_count_and_effective_device() {
    for (device, cores, threads, cpu) in [
        (VoiceDevice::Cpu, 1, "1", true),
        (VoiceDevice::Cpu, 6, "6", true),
        (VoiceDevice::Cpu, 12, "8", true),
        (VoiceDevice::Cpu, 0, "1", true),
        (VoiceDevice::Gpu, 1, "4", false),
        (VoiceDevice::Gpu, 12, "4", false),
    ] {
        let actual = whisper::server_arguments(Path::new("model.bin"), 12345, device, cores);
        let mut expected: Vec<std::ffi::OsString> = [
            "--model",
            "model.bin",
            "--host",
            "127.0.0.1",
            "--port",
            "12345",
            "-t",
            threads,
            "-fa",
        ]
        .into_iter()
        .map(Into::into)
        .collect();
        if cpu {
            expected.push("--no-gpu".into());
        }
        assert_eq!(actual, expected);
    }
    // RelationProcessorCore records can include multiple SMT processor bits;
    // one record is still one physical core, not one core per logical bit.
    let mut records = Vec::new();
    for _ in 0..6 {
        records.extend_from_slice(&0u32.to_le_bytes());
        records.extend_from_slice(&16u32.to_le_bytes());
        records.extend_from_slice(&0b11usize.to_le_bytes());
    }
    assert_eq!(process::count_physical_cores(&records), Some(6));
    assert_eq!(
        process::count_physical_cores(&records[..records.len() - 1]),
        None
    );
    assert_eq!(process::count_physical_cores(&[0; 8]), None);
    assert!(process::physical_cores() >= 1);
}

#[tokio::test]
async fn first_enable_uses_recommendation_and_preserves_explicit_and_legacy_choices() {
    for gpu in [false, true] {
        let dir = temp();
        let engine = hardware_engine(dir.path(), gpu);
        let expected: VoiceModel = if gpu {
            VoiceModel::Balanced
        } else {
            VoiceModel::Fast
        };
        assert_eq!(engine.status().unwrap().settings.model, expected);
        // Merely saving an off-state language/device preference is not a model choice.
        engine
            .save_settings_input(settings_input(false, None, VoiceDevice::Auto))
            .await
            .unwrap();
        drop(engine);
        let engine = hardware_engine(dir.path(), gpu);
        let result = engine
            .save_settings_input(settings_input(true, None, VoiceDevice::Auto))
            .await
            .unwrap();
        assert_eq!(result.settings.model, expected);
        assert!(engine.lock().model_chosen);
        drop(engine);
        let reopened = hardware_engine(dir.path(), !gpu);
        assert_eq!(
            reopened
                .save_settings_input(settings_input(true, None, VoiceDevice::Auto))
                .await
                .unwrap()
                .settings
                .model,
            expected
        );
    }
    for explicit in VoiceModel::ALL {
        let dir = temp();
        let engine = hardware_engine(dir.path(), true);
        engine
            .save_settings_input(settings_input(false, Some(explicit), VoiceDevice::Cpu))
            .await
            .unwrap();
        assert_eq!(
            engine
                .save_settings_input(settings_input(true, None, VoiceDevice::Auto))
                .await
                .unwrap()
                .settings
                .model,
            explicit
        );
        drop(engine);
        let reopened = hardware_engine(dir.path(), false);
        assert_eq!(
            reopened
                .save_settings_input(settings_input(true, None, VoiceDevice::Cpu))
                .await
                .unwrap()
                .settings
                .model,
            explicit
        );
    }
    // Existing settings have no provenance marker: preserve any saved model.
    let dir = temp();
    std::fs::create_dir_all(dir.path().join("voice")).unwrap();
    std::fs::write(
        dir.path().join("voice/settings.json"),
        serde_json::to_vec(&VoiceSettings {
            model: VoiceModel::Balanced,
            ..Default::default()
        })
        .unwrap(),
    )
    .unwrap();
    let legacy = hardware_engine(dir.path(), false);
    assert_eq!(
        legacy
            .save_settings_input(settings_input(true, None, VoiceDevice::Auto))
            .await
            .unwrap()
            .settings
            .model,
        VoiceModel::Balanced
    );
    // An omitted choice follows the effective device at first enable, including CPU overrides.
    let dir = temp();
    let gpu = hardware_engine(dir.path(), true);
    assert_eq!(
        gpu.save_settings_input(settings_input(true, None, VoiceDevice::Cpu))
            .await
            .unwrap()
            .settings
            .model,
        VoiceModel::Fast
    );
    let payload: VoiceSettingsInput = serde_json::from_value(serde_json::json!({"enabled":true,"device":"auto","language":"auto","idleUnloadMinutes":10})).unwrap();
    assert_eq!(payload.model, None);
}

async fn wait_ready(engine: &LocalWhisper) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while engine.status().unwrap().state != VoiceState::Ready {
        assert!(
            Instant::now() < deadline,
            "prepare did not become ready: {:?}",
            engine.status().unwrap()
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test]
async fn prepare_is_immediate_and_idempotent_from_idle_loading_ready_and_unloaded() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    assert!(engine.prepare().is_err());
    enable(&engine).await;
    assert!(engine.prepare().is_err());
    install_fixture(&engine);
    engine.prepare().unwrap();
    // The current-thread runtime cannot run the async health check before this assertion.
    assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
    let first_pid = engine.lock().server.as_ref().unwrap().child.id();
    engine.prepare().unwrap();
    assert_eq!(engine.lock().server.as_ref().unwrap().child.id(), first_pid);
    assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
    // A stale background load must not overwrite a replacement load after unload.
    engine.unload().await.unwrap();
    assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    engine.prepare().unwrap();
    let second_pid = engine.lock().server.as_ref().unwrap().child.id();
    assert_ne!(first_pid, second_pid);
    wait_ready(&engine).await;
    let before = engine.lock().last_used;
    engine.prepare().unwrap();
    assert_eq!(engine.status().unwrap().state, VoiceState::Ready);
    assert_eq!(
        engine.lock().server.as_ref().unwrap().child.id(),
        second_pid
    );
    assert!(engine.lock().last_used >= before);
    engine.unload().await.unwrap();
    engine.prepare().unwrap();
    assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
    wait_ready(&engine).await;
    engine.shutdown();
}

#[tokio::test]
async fn transcribe_waits_for_the_inflight_prepare_without_spawning_again() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    engine.prepare().unwrap();
    assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
    let pid = engine.lock().server.as_ref().unwrap().child.id();
    let result = engine.transcribe(input()).await.unwrap();
    assert_eq!(result.text, "Привет board");
    assert_eq!(engine.status().unwrap().state, VoiceState::Ready);
    assert_eq!(engine.lock().server.as_ref().unwrap().child.id(), pid);
    engine.shutdown();
}

#[tokio::test]
async fn prepare_counts_as_use_but_status_polling_does_not_extend_idle_timeout() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, Some(Duration::from_millis(240)));
    enable(&engine).await;
    install_fixture(&engine);
    engine.prepare().unwrap();
    wait_ready(&engine).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    engine.prepare().unwrap();
    let last_used = engine.lock().last_used;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(engine.status().unwrap().state, VoiceState::Ready);
    let deadline = Instant::now() + Duration::from_secs(2);
    while engine.status().unwrap().state != VoiceState::Idle {
        assert!(
            Instant::now() < deadline,
            "status polling kept the server loaded"
        );
        assert_eq!(engine.lock().last_used, last_used);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    for _ in 0..5 {
        assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    }
    assert!(engine.lock().server.is_none());
    assert_eq!(engine.lock().last_used, last_used);
}

#[tokio::test]
async fn dropping_during_background_prepare_does_not_retain_the_engine_or_process() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    engine.prepare().unwrap();
    let weak = Arc::downgrade(&engine.inner);
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
    let port = engine.lock().server.as_ref().unwrap().port;
    drop(engine);
    assert!(weak.upgrade().is_none());
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(weak.upgrade().is_none());
}

#[tokio::test]
async fn prepare_reports_a_loading_crash_and_can_retry() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    engine.prepare().unwrap();
    {
        let mut state = engine.lock();
        let server = state.server.as_mut().unwrap();
        server.child.kill().unwrap();
        server.child.wait().unwrap();
    }
    let status = engine.status().unwrap();
    assert_eq!(status.state, VoiceState::Error);
    assert!(status.error.unwrap().contains("exited while loading"));
    engine.prepare().unwrap();
    wait_ready(&engine).await;
    assert!(engine.status().unwrap().error.is_none());
    engine.shutdown();
}

#[tokio::test]
async fn settings_defaults_persistence_and_no_implicit_load() {
    let dir = temp();
    let engine = engine(dir.path());
    let status = engine.status().unwrap();
    assert_eq!(status.state, VoiceState::Off);
    assert_eq!(
        status.settings,
        VoiceSettings {
            model: VoiceModel::Fast,
            ..Default::default()
        }
    );
    let json = serde_json::to_value(status).unwrap();
    assert_eq!(json["enabled"], false);
    assert_eq!(json["engine"], "local-whisper");
    assert_eq!(json["idleUnloadMinutes"], 10);
    assert!(json.get("settings").is_none());
    let settings = VoiceSettings {
        enabled: true,
        model: VoiceModel::Best,
        device: VoiceDevice::Cpu,
        language: VoiceLanguage::Ru,
        idle_unload_minutes: None,
    };
    assert_eq!(
        engine.save_settings(settings.clone()).await.unwrap().state,
        VoiceState::NotInstalled
    );
    let reopened = LocalWhisper::new(dir.path(), Arc::new(|_| {})).unwrap();
    assert_eq!(reopened.status().unwrap().settings, settings);
    assert!(reopened.lock().server.is_none());
    let mut invalid = settings;
    invalid.idle_unload_minutes = Some(0);
    assert!(engine.save_settings(invalid).await.is_err());
    std::fs::write(dir.path().join("voice/settings.json"), b"broken").unwrap();
    let repaired = LocalWhisper::new(dir.path(), Arc::new(|_| {})).unwrap();
    assert_eq!(repaired.status().unwrap().state, VoiceState::Off);
    assert!(repaired.status().unwrap().error.is_some());
    assert_eq!(
        std::fs::read(dir.path().join("voice/settings.json")).unwrap(),
        b"broken"
    );
    repaired
        .save_settings(VoiceSettings::default())
        .await
        .unwrap();
    assert!(repaired.status().unwrap().error.is_none());
}

#[test]
fn wav_validation_rejects_wrong_format_truncation_and_overlong_takes() {
    assert_eq!(validate_wav(&wav(120)).unwrap(), 120_000);
    assert!(validate_wav(&wav(121)).is_err());
    assert!(validate_wav(b"not a wav").is_err());
    for offset in [0, 4, 8, 20, 22, 24, 28, 32, 34, 40] {
        let mut bytes = wav(1);
        bytes[offset] ^= 0x7f;
        assert!(
            validate_wav(&bytes).is_err(),
            "accepted invalid field at {offset}"
        );
    }
    let mut bytes = wav(1);
    bytes.pop();
    assert!(validate_wav(&bytes).is_err());
}

// The test harness doubles as a disposable real subprocess. No mock child handle.
#[test]
#[ignore = "launched by lifecycle tests as an owned subprocess"]
fn sidecar_fixture() {
    let port: u16 = std::env::var("JAM_VOICE_TEST_PORT")
        .unwrap()
        .parse()
        .unwrap();
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
    for stream in listener.incoming() {
        let mut stream = stream.unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 8192];
        let (header_end, content_length) = loop {
            let n = stream.read(&mut buffer).unwrap();
            if n == 0 {
                return;
            }
            request.extend_from_slice(&buffer[..n]);
            if let Some(end) = request.windows(4).position(|b| b == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|v| v.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                break (end + 4, length);
            }
        };
        while request.len() < header_end + content_length {
            let n = stream.read(&mut buffer).unwrap();
            if n == 0 {
                return;
            }
            request.extend_from_slice(&buffer[..n]);
        }
        let inference = request.starts_with(b"POST /inference ");
        let body = if inference {
            let text = String::from_utf8_lossy(&request[header_end..]);
            assert!(text.contains("name=\"language\"\r\n\r\nru"));
            assert!(text.contains("name=\"prompt\"\r\n\r\nBoard JB-12 Привет"));
            assert!(text.contains("filename=\"take.wav\""));
            assert!(request.windows(4).any(|s| s == b"RIFF"));
            "{\"text\":\"  Привет board  \\n\"}"
        } else {
            std::thread::sleep(Duration::from_millis(180));
            "{\"status\":\"ok\"}"
        };
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lifecycle_loading_ready_inference_unload_restart_and_disable() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    let task_engine = engine.clone();
    let task = tokio::spawn(async move { task_engine.transcribe(input()).await });
    for _ in 0..100 {
        if engine.status().unwrap().state == VoiceState::Loading {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
    assert!(
        engine
            .transcribe(input())
            .await
            .unwrap_err()
            .to_string()
            .contains("busy")
    );
    let result = task.await.unwrap().unwrap();
    assert_eq!(result.text, "Привет board");
    assert_eq!(result.duration_ms, 1000);
    assert_eq!(engine.status().unwrap().state, VoiceState::Ready);
    let port = engine.lock().server.as_ref().unwrap().port;
    engine.unload().await.unwrap();
    assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    engine.transcribe(input()).await.unwrap();
    {
        let mut state = engine.lock();
        state.server.as_mut().unwrap().child.kill().unwrap();
        state.server.as_mut().unwrap().child.wait().unwrap();
    }
    assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    engine.transcribe(input()).await.unwrap();
    let status = engine
        .save_settings(VoiceSettings::default())
        .await
        .unwrap();
    assert_eq!(status.state, VoiceState::Off);
    assert!(engine.lock().server.is_none());
    assert!(engine.transcribe(input()).await.is_err());
}

#[tokio::test]
async fn idle_unload_and_drop_leave_no_orphan_process() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, Some(Duration::from_millis(50)));
    enable(&engine).await;
    install_fixture(&engine);
    engine.transcribe(input()).await.unwrap();
    let port = engine.lock().server.as_ref().unwrap().port;
    tokio::time::sleep(Duration::from_millis(160)).await;
    assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    // Status polling itself never warms up the unloaded model.
    assert!(engine.lock().server.is_none());
    engine.transcribe(input()).await.unwrap();
    let port = engine.lock().server.as_ref().unwrap().port;
    drop(engine);
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}

#[tokio::test]
async fn shutdown_during_loading_stops_the_owned_process() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    let other = engine.clone();
    let task = tokio::spawn(async move { other.transcribe(input()).await });
    for _ in 0..100 {
        if engine.status().unwrap().state == VoiceState::Loading {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let port = engine.lock().server.as_ref().unwrap().port;
    engine.shutdown();
    assert!(task.await.unwrap().is_err());
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    assert!(
        engine
            .install(VoiceModel::Fast, VoiceDevice::Cpu)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn aborted_transcription_and_unload_during_loading_are_recoverable() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    for abort in [true, false] {
        let other = engine.clone();
        let task = tokio::spawn(async move { other.transcribe(input()).await });
        for _ in 0..100 {
            if engine.status().unwrap().state == VoiceState::Loading {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert_eq!(engine.status().unwrap().state, VoiceState::Loading);
        let port = engine.lock().server.as_ref().unwrap().port;
        if abort {
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        } else {
            engine.unload().await.unwrap();
            assert!(task.await.unwrap().is_err());
        }
        assert!(engine.lock().server.is_none());
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
        assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    }
    let mut invalid = input();
    invalid.wav_base64 = "invalid".into();
    assert!(engine.transcribe(invalid).await.is_err());
    assert!(engine.lock().server.is_none());
    engine.transcribe(input()).await.unwrap();
    engine.shutdown();
}

#[tokio::test]
async fn disabling_while_loading_preserves_off_state_and_stops_process() {
    let dir = temp();
    let mut engine = engine(dir.path());
    use_fixture(&mut engine, None);
    enable(&engine).await;
    install_fixture(&engine);
    let other = engine.clone();
    let task = tokio::spawn(async move { other.transcribe(input()).await });
    for _ in 0..100 {
        if engine.status().unwrap().state == VoiceState::Loading {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let port = engine.lock().server.as_ref().unwrap().port;
    assert_eq!(
        engine
            .save_settings(VoiceSettings::default())
            .await
            .unwrap()
            .state,
        VoiceState::Off
    );
    assert!(task.await.unwrap().is_err());
    assert!(engine.lock().server.is_none());
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    assert_eq!(engine.status().unwrap().state, VoiceState::Off);
}

#[derive(Clone)]
struct HttpFixture {
    base: String,
    archive: Arc<Vec<u8>>,
    model: Arc<Vec<u8>>,
    requests: RequestLog,
    wrong_digest: bool,
    ignore_range: bool,
    slow: bool,
}
type RequestLog = Arc<Mutex<Vec<(String, Option<String>)>>>;
struct Stub {
    fixture: HttpFixture,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Stub {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn stub(wrong_digest: bool, ignore_range: bool, slow: bool) -> Stub {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fixture = HttpFixture {
        base: format!("http://{}", listener.local_addr().unwrap()),
        archive: Arc::new(zip_fixture()),
        model: Arc::new(vec![42u8; 128 * 1024]),
        requests: Arc::new(Mutex::new(Vec::new())),
        wrong_digest,
        ignore_range,
        slow,
    };
    let app = Router::new()
        .route("/{*path}", get(http_fixture))
        .with_state(fixture.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Stub { fixture, task }
}
async fn http_fixture(
    HttpState(state): HttpState<HttpFixture>,
    request: axum::extract::Request,
) -> Response {
    let path = request.uri().path().to_owned();
    let headers = request.headers();
    let range = headers
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    state
        .requests
        .lock()
        .unwrap()
        .push((path.clone(), range.clone()));
    if path == "/release" {
        let assets = [WHISPER_RELEASE.1, "whisper-cublas-12.4.0-bin-x64.zip"].map(|name| serde_json::json!({ "name":name, "browser_download_url": format!("{}/runtime.zip", state.base), "digest": format!("sha256:{:x}", Sha256::digest(state.archive.as_slice())) }));
        return axum::Json(serde_json::json!({ "assets": assets })).into_response();
    }
    let runtime = path == "/runtime.zip";
    let data = if runtime { state.archive } else { state.model };
    let digest = if state.wrong_digest && !runtime {
        "0".repeat(64)
    } else {
        format!("{:x}", Sha256::digest(data.as_slice()))
    };
    let mut headers = HeaderMap::new();
    if path.starts_with("/models/") {
        // HF's checksum is on its redirect, absent on the final CDN response.
        headers.insert("x-linked-etag", format!("\"{digest}\"").parse().unwrap());
        headers.insert(
            "location",
            format!("{}/cdn/{}", state.base, path.rsplit('/').next().unwrap())
                .parse()
                .unwrap(),
        );
        return (StatusCode::TEMPORARY_REDIRECT, headers, Body::empty()).into_response();
    }
    headers.insert("etag", format!("\"{digest}\"").parse().unwrap());
    let start = if state.ignore_range {
        0
    } else {
        range
            .as_deref()
            .and_then(|v| v.strip_prefix("bytes="))
            .and_then(|s| s.strip_suffix('-'))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    };
    let status = if start > 0 {
        headers.insert(
            "content-range",
            format!("bytes {start}-{}/{}", data.len() - 1, data.len())
                .parse()
                .unwrap(),
        );
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    headers.insert(
        "content-length",
        (data.len() - start).to_string().parse().unwrap(),
    );
    if request.method() == axum::http::Method::HEAD {
        return (status, headers, Body::empty()).into_response();
    }
    let bytes = data[start..].to_vec();
    let slow = state.slow;
    let stream = futures_stub(bytes, slow);
    (status, headers, Body::from_stream(stream)).into_response()
}
fn futures_stub(
    bytes: Vec<u8>,
    slow: bool,
) -> impl futures::Stream<Item = std::result::Result<Bytes, std::io::Error>> {
    futures::stream::unfold((bytes, 0), move |(bytes, start)| async move {
        if start == bytes.len() {
            return None;
        }
        if slow {
            tokio::time::sleep(Duration::from_millis(8)).await;
        }
        let end = (start + 4096).min(bytes.len());
        let chunk = Bytes::copy_from_slice(&bytes[start..end]);
        Some((Ok(chunk), (bytes, end)))
    })
}
fn zip_fixture() -> Vec<u8> {
    // Minimal stored ZIP containing one fake executable, readable by Windows tar.exe.
    let name = b"whisper-server.exe";
    let data = b"fake whisper runtime";
    let mut crc = !0u32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & (0u32.wrapping_sub(crc & 1)));
        }
    }
    crc = !crc;
    let mut zip = Vec::new();
    let mut write16 = |v: u16| zip.extend_from_slice(&v.to_le_bytes());
    for n in [0x4b50, 0x0403, 20, 0, 0, 0, 0] {
        write16(n);
    }
    zip.extend_from_slice(&crc.to_le_bytes());
    zip.extend_from_slice(&(data.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(data.len() as u32).to_le_bytes());
    zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip.extend_from_slice(name);
    zip.extend_from_slice(data);
    let offset = zip.len() as u32;
    zip.extend_from_slice(&0x02014b50u32.to_le_bytes());
    for n in [20u16, 20, 0, 0, 0, 0] {
        zip.extend_from_slice(&n.to_le_bytes());
    }
    zip.extend_from_slice(&crc.to_le_bytes());
    for _ in 0..2 {
        zip.extend_from_slice(&(data.len() as u32).to_le_bytes());
    }
    for n in [name.len() as u16, 0, 0, 0, 0] {
        zip.extend_from_slice(&n.to_le_bytes());
    }
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(&0u32.to_le_bytes());
    zip.extend_from_slice(name);
    let central_size = zip.len() as u32 - offset;
    zip.extend_from_slice(&0x06054b50u32.to_le_bytes());
    for n in [0u16, 0, 1, 1] {
        zip.extend_from_slice(&n.to_le_bytes());
    }
    zip.extend_from_slice(&central_size.to_le_bytes());
    zip.extend_from_slice(&offset.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip
}
fn download_engine(dir: &Path, stub: &Stub) -> LocalWhisper {
    LocalWhisper::with_hardware(
        dir,
        Arc::new(|_| {}),
        download::Sources {
            release: format!("{}/release", stub.fixture.base),
            models: format!("{}/models", stub.fixture.base),
        },
        false,
        6,
    )
    .unwrap()
}

#[tokio::test]
async fn auto_installs_and_loads_the_same_effective_runtime_and_recommended_model() {
    for gpu in [false, true] {
        let stub = stub(false, false, false).await;
        let dir = temp();
        let mut engine = LocalWhisper::with_hardware(
            dir.path(),
            Arc::new(|_| {}),
            download::Sources {
                release: format!("{}/release", stub.fixture.base),
                models: format!("{}/models", stub.fixture.base),
            },
            gpu,
            6,
        )
        .unwrap();
        use_fixture(&mut engine, None);
        let status = engine
            .save_settings_input(settings_input(true, None, VoiceDevice::Auto))
            .await
            .unwrap();
        let model = status.settings.model;
        engine.install(model, VoiceDevice::Auto).await.unwrap();
        let effective = if gpu {
            VoiceDevice::Gpu
        } else {
            VoiceDevice::Cpu
        };
        let other = if gpu {
            VoiceDevice::Cpu
        } else {
            VoiceDevice::Gpu
        };
        assert!(find_server(&engine.runtime_dir(effective)).is_some());
        assert!(!engine.runtime_dir(other).exists());
        assert_eq!(engine.status().unwrap().installed_models, [model.key()]);
        assert!(engine.status().unwrap().runtime_installed);
        engine.prepare().unwrap();
        wait_ready(&engine).await;
        assert_eq!(
            engine.transcribe(input()).await.unwrap().text,
            "Привет board"
        );
        engine.shutdown();
    }
    let dir = temp();
    let engine = hardware_engine(dir.path(), false);
    engine
        .save_settings_input(settings_input(true, None, VoiceDevice::Gpu))
        .await
        .unwrap();
    assert!(
        engine
            .install(VoiceModel::Balanced, VoiceDevice::Gpu)
            .await
            .unwrap_err()
            .to_string()
            .contains("NVIDIA")
    );
    assert!(engine.prepare().unwrap_err().to_string().contains("NVIDIA"));
}

#[tokio::test]
async fn install_progress_cancel_resume_atomic_completion_and_remove() {
    let stub = stub(false, false, true).await;
    let dir = temp();
    let mut engine = download_engine(dir.path(), &stub);
    let events = Arc::new(Mutex::new(Vec::new()));
    let weak = Arc::new(Mutex::new(None::<std::sync::Weak<Inner>>));
    let weak_callback = weak.clone();
    let cancel_once = Arc::new(AtomicBool::new(true));
    let saved = events.clone();
    Arc::get_mut(&mut engine.inner).unwrap().progress = Arc::new(move |event| {
        if matches!(event.phase, InstallPhase::Model)
            && event.received > 0
            && cancel_once.swap(false, Ordering::SeqCst)
        {
            LocalWhisper {
                inner: weak_callback
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .upgrade()
                    .unwrap(),
            }
            .cancel_install();
        }
        saved.lock().unwrap().push(event);
    });
    *weak.lock().unwrap() = Some(Arc::downgrade(&engine.inner));
    enable(&engine).await;
    assert_eq!(engine.status().unwrap().state, VoiceState::NotInstalled);
    let other = engine.clone();
    let task =
        tokio::spawn(async move { other.install(VoiceModel::Balanced, VoiceDevice::Cpu).await });
    for _ in 0..100 {
        if engine.status().unwrap().state == VoiceState::Installing {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(engine.status().unwrap().state, VoiceState::Installing);
    assert!(
        task.await
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("cancelled")
    );
    let part = engine
        .model_path(VoiceModel::Balanced)
        .with_extension("part");
    let offset = std::fs::metadata(&part).unwrap().len();
    assert!(offset > 0);
    assert!(!engine.model_path(VoiceModel::Balanced).exists());
    assert_eq!(engine.status().unwrap().state, VoiceState::NotInstalled);
    engine
        .install(VoiceModel::Balanced, VoiceDevice::Cpu)
        .await
        .unwrap();
    assert_eq!(engine.status().unwrap().state, VoiceState::Idle);
    assert_eq!(engine.status().unwrap().installed_models, ["balanced"]);
    assert!(!part.exists());
    assert_eq!(
        std::fs::read(engine.model_path(VoiceModel::Balanced)).unwrap(),
        *stub.fixture.model
    );
    assert!(
        stub.fixture
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|(p, r)| p.contains("models/")
                && r.as_deref() == Some(format!("bytes={offset}-").as_str()))
    );
    {
        let events = events.lock().unwrap();
        assert!(
            events
                .iter()
                .any(|e| matches!(e.phase, InstallPhase::Runtime) && e.received > 0)
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e.phase, InstallPhase::Model) && Some(e.received) == e.total)
        );
    }
    engine.remove(Some(VoiceModel::Balanced)).await.unwrap();
    assert!(engine.status().unwrap().runtime_installed);
    assert!(engine.status().unwrap().installed_models.is_empty());
    engine.remove(None).await.unwrap();
    assert!(!engine.status().unwrap().runtime_installed);
    assert!(engine.inner.root.join("settings.json").exists());
}

#[tokio::test]
async fn digest_mismatch_is_not_installed_and_retry_recovers() {
    let bad_host = stub(true, false, false).await;
    let dir = temp();
    let engine = download_engine(dir.path(), &bad_host);
    enable(&engine).await;
    let error = engine
        .install(VoiceModel::Balanced, VoiceDevice::Cpu)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("SHA-256"), "{error}");
    assert_eq!(engine.status().unwrap().state, VoiceState::Error);
    assert!(!engine.model_path(VoiceModel::Balanced).exists());
    assert!(
        !engine
            .model_path(VoiceModel::Balanced)
            .with_extension("part")
            .exists()
    );
    drop(engine);
    let good_host = stub(false, false, false).await;
    let reopened = download_engine(dir.path(), &good_host);
    reopened
        .install(VoiceModel::Balanced, VoiceDevice::Cpu)
        .await
        .unwrap();
    assert_eq!(reopened.status().unwrap().state, VoiceState::Idle);
}

#[tokio::test]
async fn resume_falls_back_when_server_ignores_range() {
    let stub = stub(false, true, false).await;
    let dir = temp();
    let engine = download_engine(dir.path(), &stub);
    enable(&engine).await;
    let target = engine.model_path(VoiceModel::Fast);
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    let url = format!("{}/models/{}", stub.fixture.base, VoiceModel::Fast.file());
    let digest = format!("{:x}", Sha256::digest(stub.fixture.model.as_slice()));
    std::fs::write(target.with_extension("part"), &stub.fixture.model[..8192]).unwrap();
    std::fs::write(
        target.with_extension("part.json"),
        serde_json::to_vec(
            &serde_json::json!({ "url":url, "validator":format!("\"{digest}\""), "digest":digest }),
        )
        .unwrap(),
    )
    .unwrap();
    engine
        .install(VoiceModel::Fast, VoiceDevice::Cpu)
        .await
        .unwrap();
    assert_eq!(std::fs::read(target).unwrap(), *stub.fixture.model);
    assert!(
        stub.fixture
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|(_, r)| r.as_deref() == Some("bytes=8192-"))
    );
}
