import { beforeEach, expect, it, vi } from "vitest";
import { encodeVoiceWav } from "./voice-capture";
import { insertDictation, VoiceTake, voicePrompt } from "./voice-take";

beforeEach(() => vi.useFakeTimers());
function fixture() {
  const capture = {
    finish: vi.fn(async () => encodeVoiceWav([new Int16Array(16000)])),
    cancel: vi.fn(),
  };
  const api = {
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ({
      text: " Dictated text. ",
      durationMs: 100,
    })),
  };
  const audio = vi.fn(async (_level: (level: number) => void) => capture);
  const changed = vi.fn();
  const machine = new VoiceTake(changed, api, audio);
  const insert = vi.fn();
  return { capture, api, audio, machine, insert, changed };
}
it("H-BD17 voice prepare → mono capture → stop → transcription inserts once, with language and vocabulary", async () => {
  const f = fixture();
  await f.machine.start("ru", "Demo. JB-1 Layout", f.insert);
  expect(f.api.prepare).toHaveBeenCalledTimes(1);
  expect(f.machine.state.phase).toBe("recording");
  f.audio.mock.calls[0]?.[0](0.3);
  expect(f.machine.state.level).toBe(0.3);
  await Promise.all([f.machine.finish(), f.machine.finish()]);
  expect(f.capture.finish).toHaveBeenCalledTimes(1);
  expect(f.api.transcribe).toHaveBeenCalledWith(
    expect.any(String),
    "ru",
    "Demo. JB-1 Layout",
  );
  expect(f.insert).toHaveBeenCalledExactlyOnceWith("Dictated text.");
  expect(f.machine.state.phase).toBe("idle");
});
it("H-BD17 recording counts down at 110 seconds and auto-stops once at 120", async () => {
  const f = fixture();
  await f.machine.start("auto", "", f.insert);
  await vi.advanceTimersByTimeAsync(110000);
  expect(f.machine.state).toMatchObject({ phase: "recording", seconds: 110 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.capture.finish).toHaveBeenCalledTimes(1);
  expect(f.insert).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.api.transcribe).toHaveBeenCalledTimes(1);
});
it("H-BD17 Esc/cancel releases capture and never transcribes", async () => {
  const f = fixture();
  await f.machine.start("auto", "", f.insert);
  f.machine.cancel();
  expect(f.capture.cancel).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.api.transcribe).not.toHaveBeenCalled();
  expect(f.machine.state.phase).toBe("idle");
});
it("H-BD17 cancellation during permission prompt releases a late stream", async () => {
  const f = fixture();
  let allow!: (capture: typeof f.capture) => void;
  f.audio.mockImplementation(
    () =>
      new Promise((resolve) => {
        allow = resolve;
      }),
  );
  const starting = f.machine.start("en", "", f.insert);
  await Promise.resolve();
  f.machine.cancel();
  allow(f.capture);
  await starting;
  expect(f.capture.cancel).toHaveBeenCalledTimes(1);
  expect(f.machine.state.phase).toBe("idle");
});
it("H-BD17 microphone permission denial exposes recovery and permits another take", async () => {
  const f = fixture();
  f.audio.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
  await f.machine.start("auto", "", f.insert);
  expect(f.machine.state).toMatchObject({
    phase: "error",
    permissionDenied: true,
  });
  expect(f.api.transcribe).not.toHaveBeenCalled();
  await f.machine.start("auto", "", f.insert);
  expect(f.machine.state).toMatchObject({
    phase: "recording",
    permissionDenied: false,
  });
  f.machine.cancel();
});
it("H-BD17 prepare failure never asks for a microphone; server failure never inserts", async () => {
  const f = fixture();
  f.api.prepare.mockRejectedValueOnce(Error("Model missing"));
  await f.machine.start("auto", "", f.insert);
  expect(f.audio).not.toHaveBeenCalled();
  expect(f.machine.state.error).toBe("Model missing");
  await f.machine.start("auto", "", f.insert);
  f.api.transcribe.mockRejectedValueOnce(Error("Server unavailable"));
  await f.machine.finish();
  expect(f.machine.state).toMatchObject({
    phase: "error",
    error: "Server unavailable",
  });
  expect(f.insert).not.toHaveBeenCalled();
});
it("H-BD17 cancellation during transcription discards the late result; next take works", async () => {
  const f = fixture();
  let answer!: (result: { text: string; durationMs: number }) => void;
  f.api.transcribe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await f.machine.start("auto", "", f.insert);
  const stopping = f.machine.finish();
  await Promise.resolve();
  expect(f.machine.state.phase).toBe("transcribing");
  f.machine.cancel();
  answer({ text: "Old result", durationMs: 1 });
  await stopping;
  expect(f.insert).not.toHaveBeenCalled();
  await f.machine.start("auto", "", f.insert);
  await f.machine.finish();
  expect(f.insert).toHaveBeenCalledExactlyOnceWith("Dictated text.");
});
it("H-BD17 caret insertion keeps punctuation/spacing and vocabulary is bounded to 30 items", () => {
  expect(insertDictation("Hello world", 5, 5, "new")).toEqual({
    text: "Hello new world",
    caret: 9,
  });
  expect(insertDictation("Hello, world", 7, 12, "board.").text).toBe(
    "Hello, board.",
  );
  expect(insertDictation("Hello!", 5, 5, "there").text).toBe("Hello there!");
  const prompt = voicePrompt(
    "Project",
    Array.from({ length: 40 }, (_, i) => ({ label: `JB-${i} Title` })),
  );
  expect(prompt).toContain("JB-29 Title");
  expect(prompt).not.toContain("JB-30 Title");
});
it("H-BD17 WAV header is PCM16 mono 16 kHz with a hard 120-second ceiling", () => {
  const wav = encodeVoiceWav([new Int16Array([-32768, 0, 32767])]);
  const view = new DataView(wav.buffer);
  expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(6);
  expect(view.getInt16(44, true)).toBe(-32768);
  expect(encodeVoiceWav([new Int16Array(16000 * 121)]).length).toBe(
    44 + 16000 * 120 * 2,
  );
});
