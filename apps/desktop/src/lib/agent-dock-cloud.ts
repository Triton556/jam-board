export type CloudProvider = import("../bindings").CloudProvider;
export type CloudVoice = import("../bindings").CloudStatus;
export type VoiceStatus = import("../bindings").VoiceStatus;
export type VoiceSettingsInput =
  import("../bindings").VoiceSettingsInput_Deserialize;
export const cloudDefaults: Record<
  CloudProvider,
  Omit<CloudVoice, "keySet">
> = {
  groq: {
    provider: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
  },
  openai: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini-transcribe",
  },
  custom: { provider: "custom", baseUrl: "", model: "" },
};
export const cloudProviderName = (provider?: CloudProvider) =>
  provider === "groq"
    ? "Groq"
    : provider === "openai"
      ? "OpenAI"
      : "your provider";
