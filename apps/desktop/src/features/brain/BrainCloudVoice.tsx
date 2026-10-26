import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import {
  type CloudProvider,
  cloudDefaults,
  cloudProviderName,
  type VoiceStatus,
} from "../../lib/agent-dock-cloud";
import { voiceApi } from "../../lib/agent-dock-voice";
import { BrainProviderKey } from "./BrainProviderKey";
import { refreshVoice, saveVoice } from "./voice-store";

export function BrainCloudVoice({
  status,
  busy,
}: {
  status: VoiceStatus;
  busy: boolean;
}) {
  const cloud = status.cloud ?? { ...cloudDefaults.groq, keySet: false };
  const [model, setModel] = useState(cloud.model);
  const [baseUrl, setBaseUrl] = useState(cloud.baseUrl);
  const [provider, setProvider] = useState(cloud.provider);
  const [error, setError] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  useEffect(() => {
    setProvider(cloud.provider);
    setModel(cloud.model);
    setBaseUrl(cloud.baseUrl);
  }, [cloud.model, cloud.baseUrl, cloud.provider]);
  return (
    <div className="brain-cloud-fields">
      <CustomSelect
        label="Cloud voice provider"
        value={provider}
        disabled={busy || keyBusy}
        options={[
          { value: "groq", label: "Groq" },
          { value: "openai", label: "OpenAI" },
          { value: "custom", label: "Custom" },
        ]}
        onChange={(value) => {
          const next = cloudDefaults[value as CloudProvider];
          setProvider(next.provider);
          setModel(next.model);
          setBaseUrl(next.baseUrl);
          setError("");
          if (value !== "custom")
            void saveVoice({ engine: "cloud", cloud: next });
        }}
      />
      {provider === "custom" && (
        <label>
          Base URL
          <input
            type="url"
            disabled={busy}
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      )}
      <label>
        Cloud model
        <input
          disabled={busy}
          value={model}
          placeholder={cloudDefaults[provider].model || "Model name"}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      {(provider !== cloud.provider ||
        model !== cloud.model ||
        baseUrl !== cloud.baseUrl) && (
        <Button
          disabled={busy}
          onClick={() => {
            if (!model.trim() || !/^https?:\/\//i.test(baseUrl)) {
              setError("Enter a model and an HTTP or HTTPS base URL.");
              return;
            }
            setError("");
            void saveVoice({
              engine: "cloud",
              cloud: { provider, baseUrl: baseUrl.trim(), model: model.trim() },
            });
          }}
        >
          Save cloud settings
        </Button>
      )}
      {provider === cloud.provider ? (
        <BrainProviderKey
          key={provider}
          busy={busy || keyBusy}
          keySet={cloud.keySet}
          save={async (key) => {
            setKeyBusy(true);
            try {
              await voiceApi.setCloudKey(provider, key);
              await refreshVoice();
            } finally {
              setKeyBusy(false);
            }
          }}
          clear={async () => {
            setKeyBusy(true);
            try {
              await voiceApi.clearCloudKey(provider);
              await refreshVoice();
            } finally {
              setKeyBusy(false);
            }
          }}
        />
      ) : (
        <p>Save cloud settings before adding a key.</p>
      )}
      <p>Audio is sent to {cloudProviderName(provider)} for transcription.</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
