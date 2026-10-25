import type { VoiceLanguage } from "../../bindings";
import { type VoiceApi, voiceApi } from "../../lib/agent-dock-voice";
import {
  startVoiceCapture,
  type VoiceCapture,
  voiceBase64,
} from "./voice-capture";

export type TakeState = {
  phase: "idle" | "starting" | "recording" | "transcribing" | "error";
  seconds: number;
  level: number;
  error: string;
  permissionDenied: boolean;
};
const idle: TakeState = {
  phase: "idle",
  seconds: 0,
  level: 0,
  error: "",
  permissionDenied: false,
};
export class VoiceTake {
  state = { ...idle };
  private generation = 0;
  private capture?: VoiceCapture;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private changed: (state: TakeState) => void,
    private api: Pick<VoiceApi, "prepare" | "transcribe"> = voiceApi,
    private captureAudio = startVoiceCapture,
  ) {}
  private set(change: Partial<TakeState>) {
    this.state = { ...this.state, ...change };
    this.changed(this.state);
  }
  cancel() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    clearInterval(this.timer);
    this.capture?.cancel();
    this.capture = undefined;
    this.set({ ...idle });
  }
  async start(
    language: VoiceLanguage,
    prompt: string,
    insert: (text: string) => void,
  ) {
    if (["starting", "recording", "transcribing"].includes(this.state.phase))
      return;
    const token = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ ...idle, phase: "starting" });
    try {
      await this.api.prepare();
      if (token !== this.generation) return;
      const capture = await this.captureAudio((level) => {
        if (token === this.generation) this.set({ level });
      }, abort.signal);
      if (token !== this.generation) {
        capture.cancel();
        return;
      }
      this.capture = capture;
      this.set({ phase: "recording" });
      const started = Date.now();
      this.timer = setInterval(() => {
        this.set({
          seconds: Math.min(120, Math.floor((Date.now() - started) / 1000)),
        });
        if (this.state.seconds >= 120) void this.stop(language, prompt, insert);
      }, 250);
      this.finish = () => this.stop(language, prompt, insert);
    } catch (error) {
      if (token === this.generation) this.fail(error);
    }
  }
  finish: () => Promise<void> = async () => {};
  private fail(error: unknown) {
    this.abort?.abort();
    this.abort = undefined;
    this.capture?.cancel();
    this.capture = undefined;
    clearInterval(this.timer);
    this.set({
      phase: "error",
      level: 0,
      error: error instanceof Error ? error.message : String(error),
      permissionDenied:
        error instanceof DOMException &&
        ["NotAllowedError", "PermissionDeniedError"].includes(error.name),
    });
  }
  private async stop(
    language: VoiceLanguage,
    prompt: string,
    insert: (text: string) => void,
  ) {
    if (this.state.phase !== "recording" || !this.capture) return;
    const token = this.generation;
    const capture = this.capture;
    this.capture = undefined;
    clearInterval(this.timer);
    this.set({ phase: "transcribing", level: 0 });
    try {
      const bytes = await capture.finish();
      if (token !== this.generation) return;
      const result = await this.api.transcribe(
        voiceBase64(bytes),
        language,
        prompt,
      );
      if (token !== this.generation) return;
      if (result.text.trim()) insert(result.text.trim());
      this.set({ ...idle });
    } catch (error) {
      if (token === this.generation) this.fail(error);
    }
  }
}
export function insertDictation(
  value: string,
  start: number,
  end: number,
  text: string,
) {
  const left = value.slice(0, start),
    right = value.slice(end);
  const inserted = `${left && !/\s$/.test(left) && !/^[,.;:!?)]/.test(text) ? " " : ""}${text}${right && !/^\s|^[,.;:!?)]/.test(right) ? " " : ""}`;
  return {
    text: left + inserted + right,
    caret: left.length + inserted.length,
  };
}
export function voicePrompt(project: string, items: { label: string }[]) {
  return [project, ...items.slice(0, 30).map((item) => item.label)]
    .map((value) => value.replace(/[\r\n]/g, " ").slice(0, 160))
    .join(". ");
}
