import type { VoiceDevice, VoiceLanguage, VoiceModel } from "../../bindings";
import { Button } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { Switch } from "../../components/ui/m5";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { voiceApi } from "../../lib/agent-dock-voice";
import {
  cancelVoiceInstall,
  installVoice,
  refreshVoice,
  saveVoice,
  useVoiceStatus,
  voiceAction,
  voiceModels,
  voiceStatusLine,
} from "./voice-store";
import "./brain-voice.css";
import "./brain-phase4.css";
import { cloudDefaults } from "../../lib/agent-dock-cloud";
import { BrainCloudVoice } from "./BrainCloudVoice";

export function BrainVoiceSettings() {
  const { status, progress, error, busy } = useVoiceStatus();
  if (!status)
    return (
      <section aria-label="Voice">
        <p role="status">{error || "Reading voice settings…"}</p>
        {error && <Button onClick={() => void refreshVoice()}>Retry</Button>}
      </section>
    );
  const cpu =
    status.device === "cpu" ||
    (status.device === "auto" && !status.gpuAvailable);
  const installing = status.state === "installing";
  return (
    <SettingsSection
      title="Voice"
      description="Dictate into an editable draft. Transcription never sends a chat message automatically."
    >
      <SettingsRow
        label="Enabled"
        hint={status.engine === "cloud" ? undefined : voiceStatusLine(status)}
      >
        <Switch
          label="Enable voice input"
          checked={status.enabled}
          disabled={busy}
          onChange={(enabled) => void saveVoice({ enabled })}
        />
      </SettingsRow>
      <SettingsRow label="Engine">
        <fieldset className="brain-engine" aria-label="Voice engine">
          {(["local-whisper", "cloud"] as const).map((engine) => (
            <Button
              key={engine}
              aria-pressed={status.engine === engine}
              disabled={busy || installing}
              onClick={() =>
                void saveVoice({
                  engine,
                  ...(engine === "cloud" && !status.cloud
                    ? { cloud: cloudDefaults.groq }
                    : {}),
                })
              }
            >
              {engine === "cloud" ? "Cloud" : "Local Whisper"}
            </Button>
          ))}
        </fieldset>
      </SettingsRow>
      {status.engine === "cloud" ? (
        <SettingsRow label="Cloud transcription">
          <BrainCloudVoice status={status} busy={busy} />
        </SettingsRow>
      ) : (
        <>
          <SettingsRow
            label="Model"
            hint="Models load when you start dictation, never when you open these settings."
          >
            <div className="brain-voice-models">
              {(Object.keys(voiceModels) as VoiceModel[]).map((model) => (
                <div key={model} className="brain-voice-model">
                  <button
                    type="button"
                    className="button secondary"
                    aria-pressed={status.model === model}
                    disabled={busy || installing}
                    onClick={() => void saveVoice({ model })}
                  >
                    {voiceModels[model].name} · {voiceModels[model].size}
                  </button>
                  {status.recommendedModel === model && (
                    <span className="brain-voice-recommended">
                      Recommended for this computer
                    </span>
                  )}
                  {status.installedModels.includes(model) ? (
                    <Button
                      disabled={busy || installing}
                      onClick={() =>
                        void voiceAction(() => voiceApi.remove(model))
                      }
                    >
                      Remove {voiceModels[model].name}
                    </Button>
                  ) : (
                    <Button
                      disabled={!status.enabled || busy || installing}
                      onClick={() => void installVoice(model, status.device)}
                    >
                      Install {voiceModels[model].name}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <p>Disk used: {(status.diskBytes / 1_000_000).toFixed(0)} MB</p>
            {cpu && status.model !== "fast" && (
              <p className="brain-failure">
                Slow on this computer (about 3× the recording length)
              </p>
            )}
            {installing && (
              <div role="status">
                Downloading {progress?.phase ?? "runtime"} ·{" "}
                {progress?.total
                  ? `${Math.round((progress.received / progress.total) * 100)}%`
                  : "…"}
                <Button onClick={() => void cancelVoiceInstall()}>
                  Cancel download
                </Button>
              </div>
            )}
          </SettingsRow>
          <SettingsRow label="Device">
            <CustomSelect
              label="Voice device"
              value={status.device}
              disabled={busy || installing}
              onChange={(device) =>
                void saveVoice({ device: device as VoiceDevice })
              }
              options={[
                { value: "auto", label: "Auto" },
                { value: "cpu", label: "CPU" },
                { value: "gpu", label: "GPU", disabled: !status.gpuAvailable },
              ]}
            />
            {!status.gpuAvailable && (
              <p>GPU unavailable: no supported NVIDIA driver was detected.</p>
            )}
          </SettingsRow>
          <SettingsRow label="Language">
            <CustomSelect
              label="Voice language"
              value={status.language}
              disabled={busy || installing}
              onChange={(language) =>
                void saveVoice({ language: language as VoiceLanguage })
              }
              options={[
                { value: "auto", label: "Auto" },
                { value: "ru", label: "Russian" },
                { value: "en", label: "English" },
              ]}
            />
          </SettingsRow>
          <SettingsRow label="Unload after">
            <CustomSelect
              label="Unload voice model after"
              value={String(status.idleUnloadMinutes ?? "never")}
              disabled={busy || installing}
              onChange={(value) =>
                void saveVoice({
                  idleUnloadMinutes: value === "never" ? null : Number(value),
                })
              }
              options={[5, 10, 30]
                .map((minutes) => ({
                  value: String(minutes),
                  label: `${minutes} min`,
                }))
                .concat([{ value: "never", label: "Never" }])}
            />
          </SettingsRow>
        </>
      )}
      {(error || status.error) && (
        <p role="alert" className="brain-failure">
          {error || status.error}
        </p>
      )}
    </SettingsSection>
  );
}
