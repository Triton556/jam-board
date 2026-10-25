import { mockVoicePermissionDenied } from "../../lib/agent-dock-voice-mock";

export type VoiceCapture = { finish(): Promise<Uint8Array>; cancel(): void };
export function encodeVoiceWav(chunks: Int16Array[]) {
  const length = Math.min(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    16000 * 120,
  );
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  const word = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      bytes[offset + i] = text.charCodeAt(i);
  };
  word(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, length * 2, true);
  let index = 0;
  for (const chunk of chunks)
    for (const sample of chunk) {
      if (index === length) break;
      view.setInt16(44 + index++ * 2, sample, true);
    }
  return bytes;
}
export function voiceBase64(bytes: Uint8Array) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export async function startVoiceCapture(
  level: (value: number) => void,
  signal?: AbortSignal,
): Promise<VoiceCapture> {
  if (import.meta.env.VITE_MOCK_BRIDGE === "1") {
    if (mockVoicePermissionDenied())
      throw new DOMException("Microphone permission denied", "NotAllowedError");
    const timer = setInterval(() => level(0.1 + Math.random() * 0.4), 80);
    return {
      finish: async () => {
        clearInterval(timer);
        return encodeVoiceWav([new Int16Array(16000)]);
      },
      cancel: () => clearInterval(timer),
    };
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let context: AudioContext | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal?.removeEventListener("abort", release);
    for (const track of stream.getTracks()) track.stop();
    if (context) void context.close().catch(() => {});
  };
  const checkCancelled = () => {
    if (signal?.aborted)
      throw new DOMException("Dictation cancelled", "AbortError");
  };
  signal?.addEventListener("abort", release, { once: true });
  try {
    checkCancelled();
    context = new AudioContext();
    await context.audioWorklet.addModule(
      new URL("./voice-worklet.js?no-inline", import.meta.url).href,
    );
    checkCancelled();
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "brain-voice-pcm", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);
    const chunks: Int16Array[] = [];
    let resolve: (() => void) | undefined;
    let stopped = false;
    node.port.onmessage = ({
      data,
    }: MessageEvent<{ pcm?: Int16Array; level?: number; done?: boolean }>) => {
      if (data.pcm) chunks.push(data.pcm);
      if (data.level != null && !stopped) level(data.level);
      if (data.done) resolve?.();
    };
    await context.resume();
    checkCancelled();
    return {
      finish: async () => {
        stopped = true;
        // Stop the device immediately; let the worklet flush its last partial block.
        for (const track of stream.getTracks()) track.stop();
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 250);
          resolve = () => {
            clearTimeout(timer);
            done();
          };
          node.port.postMessage("finish");
        });
        node.disconnect();
        source.disconnect();
        mute.disconnect();
        release();
        return encodeVoiceWav(chunks);
      },
      cancel: () => {
        stopped = true;
        node.port.onmessage = null;
        node.disconnect();
        source.disconnect();
        mute.disconnect();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
