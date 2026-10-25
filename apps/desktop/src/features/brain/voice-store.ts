import { useEffect } from "react";
import { create } from "zustand";
import type {
  VoiceDevice,
  VoiceInstallProgress,
  VoiceModel,
  VoiceSettingsInput_Deserialize,
  VoiceStatus,
} from "../../bindings";
import { voiceApi } from "../../lib/agent-dock-voice";

export const voiceModels = {
  fast: { name: "Fast", size: "190 MB" },
  balanced: { name: "Balanced", size: "574 MB" },
  best: { name: "Best", size: "1.6 GB" },
};
export const useVoiceState = create<{
  status: VoiceStatus | null;
  progress: VoiceInstallProgress | null;
  error: string;
  busy: boolean;
}>(() => ({ status: null, progress: null, error: "", busy: false }));
let revision = 0;
let reading = false;
let readError: string | null = null;
export async function refreshVoice() {
  if (reading) return;
  reading = true;
  const token = revision;
  try {
    const status = await voiceApi.status();
    if (token === revision) {
      useVoiceState.setState({
        status,
        ...(useVoiceState.getState().error === readError ? { error: "" } : {}),
      });
      readError = null;
    }
  } catch (error) {
    if (token === revision) {
      readError = String(error);
      useVoiceState.setState({ error: readError });
    }
  } finally {
    reading = false;
  }
}
let watchers = 0;
let off: (() => void) | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
export function useVoiceStatus() {
  useEffect(() => {
    if (!watchers++) {
      off = voiceApi.onProgress((progress) =>
        useVoiceState.setState({ progress }),
      );
      void refreshVoice();
      poll = setInterval(() => void refreshVoice(), 1000);
    }
    return () => {
      if (!--watchers) {
        off?.();
        clearInterval(poll);
      }
    };
  }, []);
  return useVoiceState();
}
export async function voiceAction(action: () => Promise<unknown>) {
  if (useVoiceState.getState().busy) return;
  revision++;
  useVoiceState.setState({ busy: true, error: "", progress: null });
  try {
    await action();
    await refreshVoice();
  } catch (error) {
    useVoiceState.setState({ error: String(error) });
  } finally {
    useVoiceState.setState({ busy: false });
  }
}
export function installVoice(model: VoiceModel, device: VoiceDevice) {
  const state = useVoiceState.getState();
  if (state.busy) return Promise.resolve();
  if (state.status)
    useVoiceState.setState({
      status: { ...state.status, state: "installing" },
      progress: null,
    });
  return voiceAction(() => voiceApi.install(model, device));
}
export async function cancelVoiceInstall() {
  try {
    await voiceApi.cancelInstall();
    await refreshVoice();
  } catch (error) {
    useVoiceState.setState({ error: String(error) });
  }
}
export function saveVoice(change: Partial<VoiceSettingsInput_Deserialize>) {
  const status = useVoiceState.getState().status;
  if (!status) return Promise.resolve();
  // A model field records an explicit human choice in the backend. Never echo it from status.
  return voiceAction(async () => {
    const next = await voiceApi.save({
      enabled: status.enabled,
      device: status.device,
      language: status.language,
      idleUnloadMinutes: status.idleUnloadMinutes,
      ...change,
    });
    useVoiceState.setState({ status: next });
  });
}
export function voiceStatusLine(status: VoiceStatus) {
  if (!status.enabled) return "Voice input is off";
  if (
    !status.runtimeInstalled ||
    !status.installedModels.includes(status.model)
  )
    return `Not downloaded · ${voiceModels[status.model].size}`;
  const device =
    status.device === "gpu" || (status.device === "auto" && status.gpuAvailable)
      ? "GPU"
      : "CPU";
  return `Local Whisper · ${voiceModels[status.model].name} · ${device} · ${status.state === "idle" ? "ready to load" : status.state.replaceAll("_", " ")}`;
}
