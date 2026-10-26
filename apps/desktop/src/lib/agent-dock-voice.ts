import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type VoiceDevice,
  type VoiceInstallProgress,
  type VoiceLanguage,
  type VoiceModel,
} from "../bindings";
import type { VoiceSettingsInput, VoiceStatus } from "./agent-dock-cloud";
import { mockVoiceApi } from "./agent-dock-voice-mock";
import { JamError } from "./types";

export type VoiceApi = {
  status(): Promise<VoiceStatus>;
  save(input: VoiceSettingsInput): Promise<VoiceStatus>;
  setCloudKey(
    provider: import("./agent-dock-cloud").CloudProvider,
    key: string,
  ): Promise<unknown>;
  clearCloudKey(
    provider: import("./agent-dock-cloud").CloudProvider,
  ): Promise<unknown>;
  install(model: VoiceModel, device: VoiceDevice): Promise<unknown>;
  cancelInstall(): Promise<unknown>;
  remove(model: VoiceModel): Promise<unknown>;
  prepare(): Promise<unknown>;
  transcribe(
    wav: string,
    language: VoiceLanguage,
    prompt: string,
  ): Promise<{ text: string; durationMs: number }>;
  onProgress(cb: (progress: VoiceInstallProgress) => void): () => void;
};
async function unwrap<T>(
  result: Promise<
    | { status: "ok"; data: T }
    | {
        status: "error";
        error: { code: string; message: string; field?: string | null };
      }
  >,
) {
  const value = await result;
  if (value.status === "error")
    throw new JamError(
      value.error.code,
      value.error.message,
      value.error.field ?? undefined,
    );
  return value.data;
}
export const voiceApi: VoiceApi =
  import.meta.env.VITE_MOCK_BRIDGE === "1"
    ? mockVoiceApi
    : {
        status: () => unwrap(commands.voiceStatus()),
        save: (input) => unwrap(commands.voiceSettingsSave(input)),
        setCloudKey: (provider, key) =>
          unwrap(commands.voiceSetCloudKey(provider, key)),
        clearCloudKey: (provider) =>
          unwrap(commands.voiceClearCloudKey(provider)),
        install: (model, device) =>
          unwrap(commands.voiceInstall(model, device)),
        cancelInstall: () => unwrap(commands.voiceCancelInstall()),
        remove: (model) => unwrap(commands.voiceRemove(model)),
        prepare: () => unwrap(commands.voicePrepare()),
        transcribe: (wav, language, prompt) =>
          unwrap(commands.voiceTranscribe(wav, language, prompt)),
        onProgress: (cb) => {
          let disposed = false;
          let off: (() => void) | undefined;
          void listen<VoiceInstallProgress>(
            "voice-install-progress",
            (event) => {
              if (!disposed) cb(event.payload);
            },
          )
            .then((stop) => {
              if (disposed) stop();
              else off = stop;
            })
            .catch(() => {
              /* Commands expose bridge errors in the UI. */
            });
          return () => {
            disposed = true;
            off?.();
          };
        },
      };
