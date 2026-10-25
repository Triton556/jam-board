//! Desktop-only adapter; model downloads and audio never enter board storage.
use crate::commands::{ApiError, internal};
use jam_voice::*;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};
use tauri::State;
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "voice-install-progress")]
#[serde(transparent)]
pub struct VoiceProgress(pub VoiceInstallProgress);

pub fn manager(data_dir: &Path, handle: tauri::AppHandle) -> std::io::Result<LocalWhisper> {
    LocalWhisper::new(
        data_dir,
        Arc::new(move |progress| {
            if let Err(error) = VoiceProgress(progress).emit(&handle) {
                tracing::warn!(%error, "Cannot emit voice-install-progress");
            }
        }),
    )
    .map_err(|error| std::io::Error::other(error.to_string()))
}

type Result<T> = std::result::Result<T, ApiError>;

#[tauri::command]
#[specta::specta]
pub async fn voice_status(runtime: State<'_, LocalWhisper>) -> Result<VoiceStatus> {
    runtime.status().map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_prepare(runtime: State<'_, LocalWhisper>) -> Result<()> {
    runtime.prepare().map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_settings_save(
    input: VoiceSettingsInput,
    runtime: State<'_, LocalWhisper>,
) -> Result<VoiceStatus> {
    runtime.save_settings_input(input).await.map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_install(
    model: VoiceModel,
    device: VoiceDevice,
    runtime: State<'_, LocalWhisper>,
) -> Result<()> {
    runtime.install(model, device).await.map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_cancel_install(runtime: State<'_, LocalWhisper>) -> Result<()> {
    runtime.cancel_install();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_remove(
    model: Option<VoiceModel>,
    runtime: State<'_, LocalWhisper>,
) -> Result<()> {
    runtime.remove(model).await.map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_transcribe(
    wav_base64: String,
    language: Option<VoiceLanguage>,
    initial_prompt: Option<String>,
    runtime: State<'_, LocalWhisper>,
) -> Result<Transcription> {
    runtime
        .transcribe(TranscribeInput {
            wav_base64,
            language,
            initial_prompt,
        })
        .await
        .map_err(internal)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_unload(runtime: State<'_, LocalWhisper>) -> Result<()> {
    runtime.unload().await.map_err(internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_wire_contract_has_eight_commands_and_exact_progress_payload() {
        assert_eq!(VoiceProgress::NAME, "voice-install-progress");
        let event = VoiceProgress(VoiceInstallProgress {
            phase: InstallPhase::Model,
            received: 4096,
            total: Some(8192),
        });
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "phase":"model", "received":4096, "total":8192,
            })
        );
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../test-visuals/round5/w5");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(format!("voice-bindings-{}.ts", std::process::id()));
        crate::export_event_bindings(&path).unwrap();
        let generated = std::fs::read_to_string(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        for command in [
            "voice_status",
            "voice_prepare",
            "voice_settings_save",
            "voice_install",
            "voice_cancel_install",
            "voice_remove",
            "voice_transcribe",
            "voice_unload",
        ] {
            assert!(
                generated.contains(&format!("__TAURI_INVOKE(\"{command}\"")),
                "{command}"
            );
        }
        assert_eq!(generated.matches("__TAURI_INVOKE(\"voice_").count(), 8);
        assert!(generated.contains("voice-install-progress"));
        assert!(generated.contains("enabled: boolean"));
        assert!(generated.contains("idleUnloadMinutes: number | null"));
        assert!(generated.contains("recommendedModel: RecommendedModel"));
        assert!(generated.contains("export type RecommendedModel = \"fast\" | \"balanced\""));
        assert!(generated.contains("voiceSettingsSave: (input: VoiceSettingsInput_Deserialize)"));
        assert!(generated.contains("model?: VoiceModel | null"));
    }
}
