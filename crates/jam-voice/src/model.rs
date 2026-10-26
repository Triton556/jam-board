use crate::{CloudSettings, CloudStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum VoiceModel {
    Fast,
    #[default]
    Balanced,
    Best,
}
impl VoiceModel {
    pub const ALL: [Self; 3] = [Self::Fast, Self::Balanced, Self::Best];
    pub fn key(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Balanced => "balanced",
            Self::Best => "best",
        }
    }
    pub fn file(self) -> &'static str {
        match self {
            Self::Fast => "ggml-small-q5_1.bin",
            Self::Balanced => "ggml-large-v3-turbo-q5_0.bin",
            Self::Best => "ggml-large-v3-turbo.bin",
        }
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum VoiceDevice {
    #[default]
    Auto,
    Cpu,
    Gpu,
}
impl VoiceDevice {
    pub fn effective(self, gpu_available: bool) -> Self {
        match self {
            Self::Auto if gpu_available => Self::Gpu,
            Self::Auto => Self::Cpu,
            device => device,
        }
    }
    pub fn recommended_model(self, gpu_available: bool) -> RecommendedModel {
        if self.effective(gpu_available) == Self::Gpu {
            RecommendedModel::Balanced
        } else {
            RecommendedModel::Fast
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RecommendedModel {
    Fast,
    Balanced,
}
impl From<RecommendedModel> for VoiceModel {
    fn from(model: RecommendedModel) -> Self {
        match model {
            RecommendedModel::Fast => Self::Fast,
            RecommendedModel::Balanced => Self::Balanced,
        }
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum VoiceLanguage {
    #[default]
    Auto,
    Ru,
    En,
}
impl VoiceLanguage {
    pub fn key(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Ru => "ru",
            Self::En => "en",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSettings {
    pub enabled: bool,
    pub model: VoiceModel,
    pub device: VoiceDevice,
    pub language: VoiceLanguage,
    pub idle_unload_minutes: Option<u32>,
}
impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            model: VoiceModel::Balanced,
            device: VoiceDevice::Auto,
            language: VoiceLanguage::Auto,
            idle_unload_minutes: Some(10),
        }
    }
}
/// Omitting model preserves a saved choice, or uses the recommendation on first enable.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSettingsInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<VoiceEngine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud: Option<CloudSettings>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<VoiceModel>,
    pub device: VoiceDevice,
    pub language: VoiceLanguage,
    pub idle_unload_minutes: Option<u32>,
}
impl From<VoiceSettings> for VoiceSettingsInput {
    fn from(settings: VoiceSettings) -> Self {
        Self {
            engine: None,
            cloud: None,
            enabled: settings.enabled,
            model: Some(settings.model),
            device: settings.device,
            language: settings.language,
            idle_unload_minutes: settings.idle_unload_minutes,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum VoiceState {
    Off,
    NotInstalled,
    Installing,
    Idle,
    Loading,
    Ready,
    Error,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceEngine {
    #[default]
    LocalWhisper,
    Cloud,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    #[serde(flatten)]
    pub settings: VoiceSettings,
    pub engine: VoiceEngine,
    pub cloud: Option<CloudStatus>,
    pub installed_models: Vec<String>,
    pub runtime_installed: bool,
    pub gpu_available: bool,
    pub recommended_model: RecommendedModel,
    pub state: VoiceState,
    pub error: Option<String>,
    pub disk_bytes: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum InstallPhase {
    Runtime,
    Model,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VoiceInstallProgress {
    pub phase: InstallPhase,
    pub received: u64,
    pub total: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeInput {
    pub wav_base64: String,
    pub language: Option<VoiceLanguage>,
    pub initial_prompt: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Transcription {
    pub text: String,
    pub duration_ms: u64,
}
