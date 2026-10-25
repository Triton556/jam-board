import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mockVoiceApi,
  mockVoicePermissionDenied,
  setMockVoice,
} from "./agent-dock-voice-mock";

beforeEach(() => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  vi.useFakeTimers();
  setMockVoice();
});
afterEach(() => vi.unstubAllEnvs());
it("H-BD19 mock uses recommendation on first enable and keeps an explicitly selected model", async () => {
  setMockVoice({ gpuAvailable: true, recommendedModel: "balanced" });
  const base = {
    enabled: true,
    device: "auto" as const,
    language: "auto" as const,
    idleUnloadMinutes: 10,
  };
  expect((await mockVoiceApi.save(base)).model).toBe("balanced");
  await mockVoiceApi.save({ ...base, model: "best" });
  expect((await mockVoiceApi.save({ ...base, device: "cpu" })).model).toBe(
    "best",
  );
});
it("H-BD17 mock install emits both progress phases, cancels, and completes a later download", async () => {
  await mockVoiceApi.save({
    enabled: true,
    device: "cpu",
    language: "auto",
    idleUnloadMinutes: 10,
  });
  const progress = vi.fn();
  const off = mockVoiceApi.onProgress(progress);
  const first = mockVoiceApi.install("fast", "cpu");
  await vi.advanceTimersByTimeAsync(400);
  expect((await mockVoiceApi.status()).state).toBe("installing");
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({ phase: "runtime" }),
  );
  await mockVoiceApi.cancelInstall();
  await vi.runAllTimersAsync();
  await first;
  expect((await mockVoiceApi.status()).installedModels).toEqual([]);
  const second = mockVoiceApi.install("fast", "cpu");
  await vi.runAllTimersAsync();
  await second;
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: "model",
      received: 190085487,
      total: 190085487,
    }),
  );
  expect(await mockVoiceApi.status()).toMatchObject({
    state: "idle",
    runtimeInstalled: true,
    installedModels: ["fast"],
  });
  await mockVoiceApi.remove("fast");
  expect(await mockVoiceApi.status()).toMatchObject({
    installedModels: [],
    diskBytes: 24000000,
  });
  off();
});
it("H-BD17 mock warm-up, permission denial and server error are reachable", async () => {
  setMockVoice(
    {
      enabled: true,
      runtimeInstalled: true,
      installedModels: ["fast"],
      state: "idle",
    },
    "permission-denied",
  );
  expect(mockVoicePermissionDenied()).toBe(true);
  await mockVoiceApi.prepare();
  expect((await mockVoiceApi.status()).state).toBe("loading");
  await vi.advanceTimersByTimeAsync(1800);
  expect((await mockVoiceApi.status()).state).toBe("ready");
  setMockVoice(
    {
      enabled: true,
      runtimeInstalled: true,
      installedModels: ["fast"],
      state: "ready",
    },
    "server-error",
  );
  const result = expect(
    mockVoiceApi.transcribe("", "auto", ""),
  ).rejects.toThrow("Local Whisper stopped responding");
  await vi.advanceTimersByTimeAsync(1600);
  await result;
});
