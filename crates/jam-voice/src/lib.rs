//! Local and opt-in cloud dictation. Downloading assets is separate from sending audio;
//! Local inference uses a proxy-free client restricted to our loopback sidecar.
mod cloud;
mod download;
pub use cloud::*;
mod model;
mod process;
mod wav;
mod whisper;
pub use model::*;
pub use wav::validate_wav;
pub use whisper::WHISPER_RELEASE;

use base64::Engine;
use process::{Server, hide};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;
fn err(message: impl Into<String>) -> Error {
    std::io::Error::other(message.into()).into()
}
pub type ProgressCallback = Arc<dyn Fn(VoiceInstallProgress) + Send + Sync>;

#[async_trait::async_trait]
pub trait SpeechToText: Send + Sync {
    /// Observation only: polling must never reload a model after idle unload.
    fn status(&self) -> Result<VoiceStatus>;
    async fn install(&self, model: VoiceModel, device: VoiceDevice) -> Result<()>;
    async fn transcribe(&self, input: TranscribeInput) -> Result<Transcription>;
    async fn unload(&self) -> Result<()>;
}

#[derive(Clone)]
pub struct LocalWhisper {
    inner: Arc<Inner>,
}
struct Inner {
    root: PathBuf,
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
    cancel: AtomicBool,
    cancel_notify: tokio::sync::Notify,
    closed: AtomicBool,
    idle_generation: AtomicU64,
    use_generation: AtomicU64,
    gpu: bool,
    physical_cores: usize,
    client: reqwest::Client,
    inference: reqwest::Client,
    cloud_client: reqwest::Client,
    credentials: Arc<dyn VoiceCredentials>,
    sources: download::Sources,
    progress: ProgressCallback,
    #[cfg(test)]
    idle_timeout: Option<Duration>,
    #[cfg(test)]
    fixture_process: bool,
}
struct State {
    engine: VoiceEngine,
    cloud: Option<CloudSettings>,
    settings: VoiceSettings,
    model_chosen: bool,
    state: VoiceState,
    error: Option<String>,
    server: Option<Server>,
    last_used: Instant,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    #[serde(default)]
    engine: VoiceEngine,
    #[serde(default)]
    cloud: Option<CloudSettings>,
    #[serde(flatten)]
    settings: VoiceSettings,
    #[serde(default)]
    model_chosen: Option<bool>,
}
struct OperationCleanup<'a> {
    engine: &'a LocalWhisper,
    armed: bool,
}
impl Drop for OperationCleanup<'_> {
    fn drop(&mut self) {
        if self.armed {
            let mut state = self.engine.lock();
            state.server.take();
            state.state = VoiceState::Idle;
            state.error = None;
        }
    }
}
impl Drop for Inner {
    fn drop(&mut self) {
        // Server's Drop kills and reaps; its Job closes descendants on Windows.
        self.state
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .server
            .take();
    }
}

impl LocalWhisper {
    pub fn new(data_dir: impl AsRef<Path>, progress: ProgressCallback) -> Result<Self> {
        Self::create(data_dir.as_ref(), progress, download::Sources::default())
    }
    fn create(
        data_dir: &Path,
        progress: ProgressCallback,
        sources: download::Sources,
    ) -> Result<Self> {
        Self::with_hardware(
            data_dir,
            progress,
            sources,
            process::gpu_available(),
            process::physical_cores(),
        )
    }
    fn with_hardware(
        data_dir: &Path,
        progress: ProgressCallback,
        sources: download::Sources,
        gpu: bool,
        physical_cores: usize,
    ) -> Result<Self> {
        let root = data_dir.join("voice");
        std::fs::create_dir_all(&root)?;
        let path = root.join("settings.json");
        let defaults = VoiceSettings {
            model: VoiceDevice::Auto.recommended_model(gpu).into(),
            ..Default::default()
        };
        let mut engine = VoiceEngine::LocalWhisper;
        let mut cloud = None;
        let (settings, model_chosen, settings_error) = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<StoredSettings>(&bytes) {
                Ok(stored) if stored.settings.idle_unload_minutes != Some(0) => { engine = stored.engine; cloud = stored.cloud; (stored.settings, stored.model_chosen.unwrap_or(true), None) },
                _ => (defaults, false, Some("Voice settings could not be read. Voice input is off; save settings to repair them.".to_owned())),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                persist(&root, &defaults, false, engine, &cloud)?;
                (defaults, false, None)
            },
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            inner: Arc::new(Inner {
                root,
                state: Mutex::new(State {
                    engine,
                    cloud,
                    settings,
                    model_chosen,
                    state: VoiceState::Idle,
                    error: settings_error,
                    server: None,
                    last_used: Instant::now(),
                }),
                operation: tokio::sync::Mutex::new(()),
                cancel: AtomicBool::new(false),
                cancel_notify: tokio::sync::Notify::new(),
                closed: AtomicBool::new(false),
                idle_generation: AtomicU64::new(0),
                use_generation: AtomicU64::new(0),
                gpu,
                physical_cores: physical_cores.max(1),
                client: reqwest::Client::builder()
                    .user_agent("JamBoard-Voice")
                    .connect_timeout(Duration::from_secs(20))
                    .read_timeout(Duration::from_secs(60))
                    .build()?,
                inference: reqwest::Client::builder()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(Duration::from_secs(300))
                    .build()?,
                cloud_client: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(Duration::from_secs(20))
                    .timeout(Duration::from_secs(300))
                    .build()?,
                credentials: cloud::unavailable_credentials(),
                sources,
                progress,
                #[cfg(test)]
                idle_timeout: None,
                #[cfg(test)]
                fixture_process: false,
            }),
        })
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.state.lock().unwrap_or_else(|p| p.into_inner())
    }
    fn model_path(&self, model: VoiceModel) -> PathBuf {
        self.inner.root.join("models").join(model.file())
    }
    fn runtime_dir(&self, device: VoiceDevice) -> PathBuf {
        self.inner.root.join("runtimes").join(format!(
            "{}-{}",
            WHISPER_RELEASE.0,
            if device.effective(self.inner.gpu) == VoiceDevice::Gpu {
                "gpu"
            } else {
                "cpu"
            }
        ))
    }
    fn ensure_open(&self) -> Result<()> {
        if self.inner.closed.load(Ordering::SeqCst) {
            Err(err("Voice runtime is shutting down"))
        } else {
            Ok(())
        }
    }
    pub async fn save_settings(&self, settings: VoiceSettings) -> Result<VoiceStatus> {
        self.save_settings_input(settings.into()).await
    }
    pub async fn save_settings_input(&self, input: VoiceSettingsInput) -> Result<VoiceStatus> {
        if input.idle_unload_minutes == Some(0) {
            return Err(err("Idle unload minutes must be positive or null"));
        }
        if let Some(cloud) = &input.cloud {
            cloud.validate()?;
        }
        // Disable or an engine/config switch invalidates in-flight results immediately.
        let stop = !input.enabled
            || input
                .engine
                .is_some_and(|engine| engine != self.lock().engine)
            || input
                .cloud
                .as_ref()
                .is_some_and(|cloud| self.lock().cloud.as_ref() != Some(cloud));
        if stop {
            self.cancel_install();
            self.inner.use_generation.fetch_add(1, Ordering::SeqCst);
            let mut state = self.lock();
            if !input.enabled {
                state.settings.enabled = false;
            }
            state.server.take();
        }
        let _operation = self.inner.operation.lock().await;
        self.ensure_open()?;
        let (engine, cloud) = {
            let state = self.lock();
            let engine = input.engine.unwrap_or(state.engine);
            let cloud = input
                .cloud
                .clone()
                .or_else(|| state.cloud.clone())
                .or_else(|| (engine == VoiceEngine::Cloud).then(|| CloudProvider::Groq.preset()));
            (engine, cloud)
        };
        let (model, model_chosen) = {
            let state = self.lock();
            let model = input.model.unwrap_or_else(|| {
                if input.enabled
                    && !state.model_chosen
                    && engine == VoiceEngine::LocalWhisper
                    && input.engine.is_none()
                {
                    input.device.recommended_model(self.inner.gpu).into()
                } else {
                    state.settings.model
                }
            });
            (
                model,
                state.model_chosen
                    || input.model.is_some()
                    || (input.enabled && engine == VoiceEngine::LocalWhisper),
            )
        };
        let settings = VoiceSettings {
            enabled: input.enabled,
            model,
            device: input.device,
            language: input.language,
            idle_unload_minutes: input.idle_unload_minutes,
        };
        persist(&self.inner.root, &settings, model_chosen, engine, &cloud)?;
        {
            let mut state = self.lock();
            if settings != state.settings || state.engine != engine || state.cloud != cloud {
                self.inner.use_generation.fetch_add(1, Ordering::SeqCst);
                state.server.take();
            }
            state.engine = engine;
            state.cloud = cloud;
            state.settings = settings;
            state.model_chosen = model_chosen;
            if state.server.is_none() {
                state.state = VoiceState::Idle;
            }
            state.error = None;
        }
        self.status()
    }
    pub fn cancel_install(&self) {
        self.inner.cancel.store(true, Ordering::SeqCst);
        self.inner.cancel_notify.notify_waiters();
    }
    /// Synchronous exit hook; no executor is required to kill the process tree.
    pub fn shutdown(&self) {
        self.inner.closed.store(true, Ordering::SeqCst);
        self.cancel_install();
        self.lock().server.take();
    }
    pub async fn remove(&self, model: Option<VoiceModel>) -> Result<()> {
        self.cancel_install();
        let _operation = self.inner.operation.lock().await;
        self.ensure_open()?;
        self.inner.use_generation.fetch_add(1, Ordering::SeqCst);
        self.lock().server.take();
        if let Some(model) = model {
            remove_file(&self.model_path(model))?;
            remove_file(&self.model_path(model).with_extension("part"))?;
            remove_file(&self.model_path(model).with_extension("part.json"))?;
        } else {
            // Keep settings, remove all installed assets and interrupted downloads.
            for entry in std::fs::read_dir(&self.inner.root)? {
                let entry = entry?;
                if entry.file_name() == "settings.json" {
                    continue;
                }
                if entry.file_type()?.is_dir() {
                    std::fs::remove_dir_all(entry.path())?;
                } else {
                    std::fs::remove_file(entry.path())?;
                }
            }
        }
        let mut state = self.lock();
        state.state = VoiceState::Idle;
        state.error = None;
        Ok(())
    }
    fn fail(&self, error: &Error) {
        let mut state = self.lock();
        state.server.take();
        state.state = VoiceState::Error;
        state.error = Some(error.to_string());
    }
    /// Start warming up without waiting for health; repeated calls count as use.
    pub fn prepare(&self) -> Result<()> {
        self.ensure_open()?;
        {
            let mut state = self.lock();
            if !state.settings.enabled {
                return Err(err("Voice input is disabled"));
            }
            if state.engine == VoiceEngine::Cloud {
                return Ok(());
            }
            if let Some(server) = &mut state.server
                && server.alive()?
            {
                self.record_use(state);
                return Ok(());
            }
        }
        let _operation = self
            .inner
            .operation
            .try_lock()
            .map_err(|_| err("Voice runtime is busy"))?;
        let generation = self.inner.use_generation.load(Ordering::SeqCst);
        let url = self.begin_load(generation)?;
        self.mark_used();
        let weak = Arc::downgrade(&self.inner);
        tokio::spawn(async move {
            if let Err(error) = Self::wait_loaded(weak.clone(), generation, &url).await
                && let Some(inner) = weak.upgrade()
            {
                let engine = Self { inner };
                let mut state = engine.lock();
                if engine.check_use(generation).is_ok()
                    && engine.ensure_open().is_ok()
                    && state
                        .server
                        .as_ref()
                        .is_some_and(|server| server.url() == url)
                {
                    state.server.take();
                    state.state = VoiceState::Error;
                    state.error = Some(error.to_string());
                }
            }
        });
        Ok(())
    }
    fn begin_load(&self, generation: u64) -> Result<String> {
        self.ensure_open()?;
        {
            let mut state = self.lock();
            self.check_use(generation)?;
            if !state.settings.enabled {
                return Err(err("Voice input is disabled"));
            }
            if let Some(server) = &mut state.server
                && server.alive()?
            {
                return Ok(server.url());
            }
            state.server.take();
            if state.engine == VoiceEngine::Cloud {
                return Err(err("Local voice runtime is inactive"));
            }
            let settings = &state.settings;
            if settings.device == VoiceDevice::Gpu && !self.inner.gpu {
                return Err(err("An NVIDIA driver is required for GPU voice input"));
            }
            let executable = find_server(&self.runtime_dir(settings.device))
                .ok_or_else(|| err("Voice runtime is not installed"))?;
            let model = self.model_path(settings.model);
            if !model.is_file() {
                return Err(err("Voice model is not installed"));
            }
            self.ensure_open()?;
            let server = Server::spawn(
                &executable,
                &model,
                settings.device.effective(self.inner.gpu),
                self.inner.physical_cores,
                #[cfg(test)]
                self.inner.fixture_process,
            )?;
            state.server = Some(server);
            state.state = VoiceState::Loading;
            state.error = None;
            Ok(state.server.as_ref().unwrap().url())
        }
    }
    async fn load(&self, generation: u64) -> Result<String> {
        let url = self.begin_load(generation)?;
        Self::wait_loaded(Arc::downgrade(&self.inner), generation, &url).await
    }
    // Only weak ownership crosses await points, so preparing cannot keep a
    // dropped engine/process alive until the health-check deadline.
    async fn wait_loaded(
        weak: std::sync::Weak<Inner>,
        generation: u64,
        url: &str,
    ) -> Result<String> {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            let client = {
                let engine = Self {
                    inner: weak
                        .upgrade()
                        .ok_or_else(|| err("Voice runtime was dropped"))?,
                };
                engine.ensure_open()?;
                engine.check_use(generation)?;
                let mut state = engine.lock();
                let server = state
                    .server
                    .as_mut()
                    .ok_or_else(|| err("Voice warm-up stopped"))?;
                if !server.alive()? {
                    return Err(err("Voice server exited while loading"));
                }
                if server.url() != url {
                    return Err(err("Voice warm-up stopped"));
                }
                if state.state == VoiceState::Ready {
                    return Ok(url.into());
                }
                engine.inner.inference.clone()
            };
            if let Ok(response) = client
                .get(format!("{url}{}", whisper::HEALTH_ENDPOINT))
                .timeout(Duration::from_secs(1))
                .send()
                .await
                && response.status().is_success()
            {
                let engine = Self {
                    inner: weak
                        .upgrade()
                        .ok_or_else(|| err("Voice runtime was dropped"))?,
                };
                {
                    let mut state = engine.lock();
                    engine.ensure_open()?;
                    engine.check_use(generation)?;
                    if !state
                        .server
                        .as_ref()
                        .is_some_and(|server| server.url() == url)
                    {
                        return Err(err("Voice warm-up stopped"));
                    }
                    if state.state == VoiceState::Ready {
                        return Ok(url.into());
                    }
                    state.state = VoiceState::Ready;
                }
                engine.mark_used();
                return Ok(url.into());
            }
            if Instant::now() >= deadline {
                return Err(err("Voice server warm-up timed out"));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    fn check_use(&self, generation: u64) -> Result<()> {
        if self.inner.use_generation.load(Ordering::SeqCst) != generation {
            Err(err("Voice operation stopped"))
        } else {
            Ok(())
        }
    }
    fn mark_used(&self) {
        self.record_use(self.lock());
    }
    fn record_use(&self, mut state: std::sync::MutexGuard<'_, State>) {
        if state.server.is_none() {
            return;
        }
        state.last_used = Instant::now();
        let generation = self.inner.idle_generation.fetch_add(1, Ordering::SeqCst) + 1;
        if state.state == VoiceState::Loading {
            return;
        }
        state.state = VoiceState::Ready;
        state.error = None;
        let timeout = state
            .settings
            .idle_unload_minutes
            .map(|m| Duration::from_secs(u64::from(m) * 60));
        drop(state);
        let weak = Arc::downgrade(&self.inner);
        #[cfg(test)]
        let timeout = self.inner.idle_timeout.or(timeout);
        if let Some(timeout) = timeout {
            tokio::spawn(async move {
                tokio::time::sleep(timeout).await;
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                let _operation = inner.operation.lock().await;
                if inner.idle_generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                let mut state = inner.state.lock().unwrap_or_else(|p| p.into_inner());
                if state.state == VoiceState::Ready
                    && state.server.is_some()
                    && state.last_used.elapsed() >= timeout
                {
                    state.server.take();
                    state.state = VoiceState::Idle;
                }
            });
        }
    }
    async fn infer(&self, input: TranscribeInput, generation: u64) -> Result<Transcription> {
        // Bound decoding before allocating; no audio is ever written to disk.
        if input.wav_base64.len() > wav::MAX_WAV_BYTES.div_ceil(3) * 4 {
            return Err(err("Audio take exceeds 120 seconds"));
        }
        let audio = base64::engine::general_purpose::STANDARD.decode(&input.wav_base64)?;
        let duration_ms = validate_wav(&audio)?;
        let language = input.language.unwrap_or(self.lock().settings.language);
        let prompt = input.initial_prompt.unwrap_or_default();
        if prompt.len() > 16_384 {
            return Err(err("Voice vocabulary hint is too long"));
        }
        let url = self.load(generation).await?;
        // Manual multipart avoids adding an uncached reqwest feature/dependency.
        let boundary = "jam-voice-pcm-289d5e9dd84f";
        let mut body = Vec::new();
        for (name, value) in [
            (whisper::LANGUAGE_FIELD, language.key()),
            (whisper::PROMPT_FIELD, prompt.as_str()),
            (whisper::FORMAT_FIELD, "json"),
        ] {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"; filename=\"take.wav\"\r\nContent-Type: audio/wav\r\n\r\n", whisper::AUDIO_FIELD).as_bytes());
        body.extend_from_slice(&audio);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        #[derive(Deserialize)]
        struct Inference {
            text: String,
        }
        let response: Inference = self
            .inner
            .inference
            .post(format!("{url}{}", whisper::INFERENCE_ENDPOINT))
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        self.ensure_open()?;
        self.check_use(generation)?;
        if self.lock().server.is_none() {
            return Err(err("Voice transcription stopped"));
        }
        self.mark_used();
        Ok(Transcription {
            text: response.text.trim().into(),
            duration_ms,
        })
    }
}

#[async_trait::async_trait]
impl SpeechToText for LocalWhisper {
    fn status(&self) -> Result<VoiceStatus> {
        let mut state = self.lock();
        if let Some(server) = &mut state.server
            && !server.alive()?
        {
            state.server.take();
            if state.state == VoiceState::Loading {
                state.state = VoiceState::Error;
                state.error = Some("Voice server exited while loading".into());
            } else {
                state.state = VoiceState::Idle;
            }
        }
        let installed_models = VoiceModel::ALL
            .into_iter()
            .filter(|&m| self.model_path(m).is_file())
            .map(|m| m.key().to_owned())
            .collect();
        let runtime_installed = find_server(&self.runtime_dir(state.settings.device)).is_some();
        let current = if !state.settings.enabled {
            VoiceState::Off
        } else if state.engine == VoiceEngine::Cloud {
            if state.state == VoiceState::Error {
                VoiceState::Error
            } else {
                VoiceState::Idle
            }
        } else if matches!(
            state.state,
            VoiceState::Installing | VoiceState::Loading | VoiceState::Error
        ) {
            state.state
        } else if !runtime_installed || !self.model_path(state.settings.model).is_file() {
            VoiceState::NotInstalled
        } else if state.server.is_some() {
            VoiceState::Ready
        } else {
            VoiceState::Idle
        };
        Ok(VoiceStatus {
            settings: state.settings.clone(),
            engine: state.engine,
            cloud: state
                .cloud
                .clone()
                .map(|settings| {
                    self.inner
                        .credentials
                        .get(settings.provider)
                        .map(|key| CloudStatus {
                            settings,
                            key_set: key.is_some_and(|k| !k.is_empty()),
                        })
                })
                .transpose()?,
            installed_models,
            runtime_installed,
            gpu_available: self.inner.gpu,
            recommended_model: state.settings.device.recommended_model(self.inner.gpu),
            state: current,
            error: state.error.clone(),
            disk_bytes: disk_bytes(&self.inner.root)?,
        })
    }
    async fn install(&self, model: VoiceModel, device: VoiceDevice) -> Result<()> {
        let _operation = self
            .inner
            .operation
            .try_lock()
            .map_err(|_| err("Voice runtime is busy"))?;
        self.ensure_open()?;
        if !self.lock().settings.enabled {
            return Err(err("Enable voice input before installing"));
        }
        self.inner.cancel.store(false, Ordering::SeqCst);
        self.inner.use_generation.fetch_add(1, Ordering::SeqCst);
        let mut cleanup = OperationCleanup {
            engine: self,
            armed: true,
        };
        {
            let mut state = self.lock();
            state.server.take();
            state.state = VoiceState::Installing;
            state.error = None;
        }
        let result = self.install_files(model, device).await;
        match &result {
            Ok(()) => {
                self.lock().state = VoiceState::Idle;
            }
            Err(_) if self.inner.cancel.load(Ordering::SeqCst) => {
                self.lock().state = VoiceState::Idle;
            }
            Err(error) => self.fail(error),
        }
        cleanup.armed = false;
        result
    }
    async fn transcribe(&self, input: TranscribeInput) -> Result<Transcription> {
        let _operation = self
            .inner
            .operation
            .try_lock()
            .map_err(|_| err("Voice runtime is busy"))?;
        let mut cleanup = OperationCleanup {
            engine: self,
            armed: true,
        };
        let generation = self.inner.use_generation.load(Ordering::SeqCst);
        let cloud = self.lock().engine == VoiceEngine::Cloud;
        let result = if cloud {
            self.infer_cloud(input, generation).await
        } else {
            self.infer(input, generation).await
        };
        if let Err(error) = &result {
            self.fail(error);
        } else if cloud {
            let mut state = self.lock();
            state.state = VoiceState::Idle;
            state.error = None;
        }
        cleanup.armed = false;
        result
    }
    async fn unload(&self) -> Result<()> {
        if self.lock().engine == VoiceEngine::Cloud {
            return Ok(());
        }
        self.inner.use_generation.fetch_add(1, Ordering::SeqCst);
        self.lock().server.take();
        let _operation = self.inner.operation.lock().await;
        let mut state = self.lock();
        state.state = VoiceState::Idle;
        state.error = None;
        Ok(())
    }
}

fn persist(
    root: &Path,
    settings: &VoiceSettings,
    model_chosen: bool,
    engine: VoiceEngine,
    cloud: &Option<CloudSettings>,
) -> Result<()> {
    use std::io::Write;
    let temporary = root.join("settings.json.tmp");
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(&StoredSettings {
        engine,
        cloud: cloud.clone(),
        settings: settings.clone(),
        model_chosen: Some(model_chosen),
    })?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(temporary, root.join("settings.json"))?;
    Ok(())
}
fn remove_file(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
fn find_server(root: &Path) -> Option<PathBuf> {
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let kind = entry.file_type().ok()?;
        if kind.is_file()
            && whisper::EXECUTABLES
                .iter()
                .any(|name| entry.file_name() == *name)
        {
            return Some(entry.path());
        }
        if kind.is_dir()
            && let Some(server) = find_server(&entry.path())
        {
            return Some(server);
        }
    }
    None
}
fn disk_bytes(root: &Path) -> Result<u64> {
    let mut total = 0;
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        // Status can race an install's atomic rename or an asset removal.
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if kind.is_dir() {
            total += disk_bytes(&entry.path())?;
        } else if kind.is_file() {
            match entry.metadata() {
                Ok(metadata) => total += metadata.len(),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests;
