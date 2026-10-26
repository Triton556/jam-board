//! OpenAI-compatible cloud transport. Secrets are supplied by the desktop credential adapter.
use crate::*;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CloudProvider {
    #[default]
    Groq,
    Openai,
    Custom,
}
impl CloudProvider {
    pub fn key(self) -> &'static str {
        match self {
            Self::Groq => "groq",
            Self::Openai => "openai",
            Self::Custom => "custom",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Groq => "Groq",
            Self::Openai => "OpenAI",
            Self::Custom => "Custom",
        }
    }
    pub fn preset(self) -> CloudSettings {
        let (base_url, model) = match self {
            Self::Groq => ("https://api.groq.com/openai/v1", "whisper-large-v3-turbo"),
            Self::Openai => ("https://api.openai.com/v1", "gpt-4o-mini-transcribe"),
            Self::Custom => ("", ""),
        };
        CloudSettings {
            provider: self,
            base_url: base_url.into(),
            model: model.into(),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudSettings {
    pub provider: CloudProvider,
    pub base_url: String,
    pub model: String,
}
impl CloudSettings {
    pub(crate) fn validate(&self) -> Result<()> {
        let url =
            reqwest::Url::parse(&self.base_url).map_err(|_| err("Enter a valid cloud base URL"))?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(err(
                "Enter a valid cloud base URL without credentials, query or fragment",
            ));
        }
        if self.model.trim().is_empty() || self.model.len() > 1024 {
            return Err(err("Enter a cloud transcription model"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    #[serde(flatten)]
    pub settings: CloudSettings,
    pub key_set: bool,
}
/// Implementations must not log or include credential values in errors.
pub trait VoiceCredentials: Send + Sync {
    fn get(&self, provider: CloudProvider) -> Result<Option<String>>;
    fn set(&self, provider: CloudProvider, key: &str) -> Result<()>;
    fn clear(&self, provider: CloudProvider) -> Result<()>;
}
struct UnavailableCredentials;
impl VoiceCredentials for UnavailableCredentials {
    fn get(&self, _: CloudProvider) -> Result<Option<String>> {
        Ok(None)
    }
    fn set(&self, _: CloudProvider, _: &str) -> Result<()> {
        Err(err("OS credential store is unavailable"))
    }
    fn clear(&self, _: CloudProvider) -> Result<()> {
        Err(err("OS credential store is unavailable"))
    }
}
impl LocalWhisper {
    pub fn with_credentials(mut self, credentials: Arc<dyn VoiceCredentials>) -> Self {
        Arc::get_mut(&mut self.inner)
            .expect("configure credentials before sharing voice runtime")
            .credentials = credentials;
        self
    }
    pub fn set_cloud_key(&self, provider: CloudProvider, key: &str) -> Result<()> {
        if key.trim().is_empty() || key.contains(['\r', '\n']) {
            return Err(err("Enter an API key"));
        }
        self.inner.credentials.set(provider, key)
    }
    pub fn clear_cloud_key(&self, provider: CloudProvider) -> Result<()> {
        self.inner.credentials.clear(provider)
    }
    pub(crate) async fn infer_cloud(
        &self,
        input: TranscribeInput,
        generation: u64,
    ) -> Result<Transcription> {
        self.ensure_open()?;
        if input.wav_base64.len() > wav::MAX_WAV_BYTES.div_ceil(3) * 4 {
            return Err(err("Audio take exceeds 120 seconds"));
        }
        let (settings, language) = {
            let state = self.lock();
            if !state.settings.enabled {
                return Err(err("Voice input is disabled"));
            }
            (
                state
                    .cloud
                    .clone()
                    .ok_or_else(|| err("Configure a cloud transcription provider"))?,
                input.language.unwrap_or(state.settings.language),
            )
        };
        settings.validate()?;
        let key = self
            .inner
            .credentials
            .get(settings.provider)?
            .filter(|k| !k.is_empty())
            .ok_or_else(|| err("Check the API key"))?;
        let audio = base64::engine::general_purpose::STANDARD
            .decode(&input.wav_base64)
            .map_err(|_| err("Invalid audio recording"))?;
        let duration_ms = validate_wav(&audio)?;
        let prompt = input.initial_prompt.unwrap_or_default();
        if prompt.len() > 16_384 {
            return Err(err("Voice vocabulary hint is too long"));
        }
        // Pick a boundary absent from every payload; no multipart feature/dependency needed.
        let mut boundary = "jam-voice-cloud".to_owned();
        while audio
            .windows(boundary.len())
            .any(|b| b == boundary.as_bytes())
            || prompt.contains(&boundary)
            || settings.model.contains(&boundary)
        {
            boundary.push('x');
        }
        let mut body = Vec::new();
        let mut fields = vec![
            ("model", settings.model.as_str()),
            ("prompt", prompt.as_str()),
            ("response_format", "json"),
        ];
        if language != VoiceLanguage::Auto {
            fields.push(("language", language.key()));
        }
        for (name, value) in fields {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"take.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
        body.extend_from_slice(&audio);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let network_error = || err(format!("Can't reach {}", settings.provider.label()));
        let response = self
            .inner
            .cloud_client
            .post(format!(
                "{}/audio/transcriptions",
                settings.base_url.trim_end_matches('/')
            ))
            .bearer_auth(key)
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
            .map_err(|_| network_error())?;
        match response.status().as_u16() {
            401 => return Err(err("Check the API key")),
            413 => return Err(err("Recording too long for this provider")),
            _ if !response.status().is_success() => return Err(err("Cloud transcription failed")),
            _ => {}
        }
        #[derive(Deserialize)]
        struct Response {
            text: String,
        }
        // Never expose an upstream response body or reqwest URL/header errors.
        let bytes = response.bytes().await.map_err(|_| network_error())?;
        let response: Response = serde_json::from_slice(&bytes)
            .map_err(|_| err("Invalid cloud transcription response"))?;
        self.ensure_open()?;
        self.check_use(generation)?;
        Ok(Transcription {
            text: response.text.trim().into(),
            duration_ms,
        })
    }
}
pub(crate) fn unavailable_credentials() -> Arc<dyn VoiceCredentials> {
    Arc::new(UnavailableCredentials)
}
