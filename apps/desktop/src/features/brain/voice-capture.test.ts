import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { startVoiceCapture } from "./voice-capture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each([44100, 48000])(
  "H-BD17 AudioWorklet resamples %i Hz across blocks and flushes signed PCM16",
  (rate) => {
    let Processor!: new () => {
      process(inputs: Float32Array[][]): boolean;
      port: { onmessage(event: { data: string }): void };
    };
    const messages: { pcm?: Int16Array; done?: boolean }[] = [];
    runInNewContext(
      readFileSync("src/features/brain/voice-worklet.js", "utf8"),
      {
        sampleRate: rate,
        AudioWorkletProcessor: class {
          port = {
            onmessage: null,
            postMessage: (message: (typeof messages)[number]) =>
              messages.push(message),
          };
        },
        registerProcessor: (_name: string, value: typeof Processor) => {
          Processor = value;
        },
      },
    );
    const processor = new Processor();
    for (let i = 0; i < rate; i += 128)
      processor.process([
        [new Float32Array(Math.min(128, rate - i)).fill(0.5)],
      ]);
    processor.port.onmessage({ data: "finish" });
    const samples = messages.flatMap((message) =>
      Array.from(message.pcm ?? []),
    );
    expect(samples.length).toBe(16000);
    expect(samples.every((sample) => Math.abs(sample - 16384) <= 1)).toBe(true);
    expect(messages.at(-1)).toEqual({ done: true });
  },
);
function nativeCapture() {
  vi.stubEnv("VITE_MOCK_BRIDGE", "0");
  const stop = vi.fn(),
    close = vi.fn(async () => {});
  const stream = { getTracks: () => [{ stop }] };
  const media = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
  const node = {
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    port: {
      onmessage: null as null | ((event: { data: unknown }) => void),
      postMessage: vi.fn(() => {
        node.port.onmessage?.({ data: { pcm: new Int16Array([1, -1]) } });
        node.port.onmessage?.({ data: { done: true } });
      }),
    },
  };
  const addModule = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      connect = node.connect;
      disconnect = node.disconnect;
      port = node.port;
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      audioWorklet = { addModule };
      createMediaStreamSource = () => node;
      createGain = () => ({ ...node, gain: { value: 1 } });
      destination = {};
      resume = async () => {};
      close = close;
    },
  );
  return { stop, close, media, node, addModule };
}
it("H-BD17 native capture requests mono, stops tracks before flushing, and closes audio context", async () => {
  const f = nativeCapture();
  const capture = await startVoiceCapture(vi.fn());
  const finishing = capture.finish();
  expect(f.stop).toHaveBeenCalled();
  const wav = await finishing;
  expect(f.media).toHaveBeenCalledWith(
    expect.objectContaining({
      audio: expect.objectContaining({ channelCount: 1 }),
      video: false,
    }),
  );
  expect(wav.length).toBe(48);
  expect(f.close).toHaveBeenCalledTimes(1);
});
it("H-BD17 worklet load failure and cancellation release the native microphone", async () => {
  const f = nativeCapture();
  f.addModule.mockRejectedValueOnce(Error("Cannot load worklet"));
  await expect(startVoiceCapture(vi.fn())).rejects.toThrow(
    "Cannot load worklet",
  );
  expect(f.stop).toHaveBeenCalledTimes(1);
  const capture = await startVoiceCapture(vi.fn());
  capture.cancel();
  expect(f.stop).toHaveBeenCalledTimes(2);
  expect(f.close).toHaveBeenCalledTimes(2);
});
it("H-BD17 Esc releases the microphone immediately while the worklet is still loading", async () => {
  const f = nativeCapture();
  let finishLoad!: () => void;
  f.addModule.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
  );
  const abort = new AbortController();
  const starting = startVoiceCapture(vi.fn(), abort.signal);
  await Promise.resolve();
  abort.abort();
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
  finishLoad();
  await expect(starting).rejects.toMatchObject({ name: "AbortError" });
  expect(f.stop).toHaveBeenCalledTimes(1);
});
