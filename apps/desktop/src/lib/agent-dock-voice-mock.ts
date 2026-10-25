import type { VoiceInstallProgress, VoiceStatus } from "../bindings";
import type { VoiceApi } from "./agent-dock-voice";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaults = (): VoiceStatus => ({
  enabled: false,
  engine: "local-whisper",
  model: "fast",
  installedModels: [],
  runtimeInstalled: false,
  device: "auto",
  gpuAvailable: false,
  recommendedModel: "fast",
  language: "auto",
  idleUnloadMinutes: 10,
  state: "off",
  error: null,
  diskBytes: 0,
});
let status = defaults();
let chosen = false;
let generation = 0;
let scenario: "normal" | "permission-denied" | "server-error" = "normal";
const listeners = new Set<(progress: VoiceInstallProgress) => void>();
const modelBytes = (model: string) =>
  model === "fast"
    ? 190_085_487
    : model === "balanced"
      ? 574_041_195
      : 1_600_000_000;
const diskBytes = () =>
  (status.runtimeInstalled ? 24_000_000 : 0) +
  status.installedModels.reduce((sum, model) => sum + modelBytes(model), 0);
export function setMockVoice(
  next: Partial<VoiceStatus> = {},
  failure: typeof scenario = "normal",
) {
  if (import.meta.env.VITE_MOCK_BRIDGE !== "1") return;
  generation++;
  chosen = false;
  scenario = failure;
  status = { ...defaults(), ...next };
}
export function mockVoicePermissionDenied() {
  return scenario === "permission-denied";
}
export const mockVoiceApi: VoiceApi = {
  status: async () => structuredClone(status),
  save: async (input) => {
    generation++;
    const recommendedModel =
      input.device === "gpu" || (input.device === "auto" && status.gpuAvailable)
        ? "balanced"
        : "fast";
    if (input.model != null) chosen = true;
    const model =
      input.model ??
      (input.enabled && !chosen ? recommendedModel : status.model);
    status = { ...status, ...input, model, recommendedModel, error: null };
    status.state = !status.enabled
      ? "off"
      : status.installedModels.includes(model) && status.runtimeInstalled
        ? "idle"
        : "not_installed";
    return structuredClone(status);
  },
  install: async (model) => {
    const token = ++generation;
    status.state = "installing";
    for (const phase of ["runtime", "model"] as const) {
      const total = phase === "runtime" ? 24_000_000 : modelBytes(model);
      for (let i = 0; i <= 10; i++) {
        await delay(160);
        if (token !== generation) return;
        for (const cb of listeners)
          cb({ phase, received: (total * i) / 10, total });
      }
    }
    status.runtimeInstalled = true;
    status.installedModels = [...new Set([...status.installedModels, model])];
    status.diskBytes = diskBytes();
    status.state = "idle";
  },
  cancelInstall: async () => {
    generation++;
    status.state = status.enabled ? "not_installed" : "off";
  },
  remove: async (model) => {
    generation++;
    status.installedModels = status.installedModels.filter((m) => m !== model);
    status.diskBytes = diskBytes();
    status.state = !status.enabled
      ? "off"
      : status.installedModels.includes(status.model)
        ? "idle"
        : "not_installed";
  },
  prepare: async () => {
    const token = generation;
    status.state = "loading";
    void delay(1800).then(() => {
      if (token === generation) status.state = "ready";
    });
  },
  transcribe: async () => {
    await delay(1600);
    if (scenario === "server-error")
      throw Error("Local Whisper stopped responding. Try dictation again.");
    status.state = "ready";
    return {
      text: "Create a task to review the board layout.",
      durationMs: 1600,
    };
  },
  onProgress: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
