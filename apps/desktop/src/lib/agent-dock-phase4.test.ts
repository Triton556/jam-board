import { beforeEach, expect, it, vi } from "vitest";
import { nativePhase4Api } from "./agent-dock-phase4";
import { voiceApi } from "./agent-dock-voice";
import { JamError } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(null);
});
it("R6-N01 generated history commands preserve exact names, nullable filters and argument envelopes", async () => {
  await nativePhase4Api.history();
  await nativePhase4Api.history({ limit: 20, query: "release" });
  await nativePhase4Api.events("entry");
  await nativePhase4Api.resume("entry");
  await nativePhase4Api.resume("entry", "include");
  await nativePhase4Api.resume("entry", "exclude");
  await nativePhase4Api.rename("entry", "Renamed");
  await nativePhase4Api.delete("entry");
  await nativePhase4Api.historySettings();
  await nativePhase4Api.saveHistorySettings(false);
  await nativePhase4Api.clearHistory();
  expect(native.invoke.mock.calls).toEqual([
    ["agent_history", { limit: null, query: null }],
    ["agent_history", { limit: 20, query: "release" }],
    ["agent_history_events", { entryId: "entry" }],
    ["resume_agent_session", { entryId: "entry", userConfig: null }],
    ["resume_agent_session", { entryId: "entry", userConfig: "include" }],
    ["resume_agent_session", { entryId: "entry", userConfig: "exclude" }],
    ["rename_agent_history", { entryId: "entry", title: "Renamed" }],
    ["delete_agent_history", { entryId: "entry" }],
    ["agent_history_settings"],
    ["save_agent_history_settings", { keepHistory: false }],
    ["clear_agent_history"],
  ]);
});
it("R6-N02 generated web and cloud commands keep secrets out of settings", async () => {
  await nativePhase4Api.webSettings();
  await nativePhase4Api.saveWebSettings("brave");
  await nativePhase4Api.setWebKey("brave", "fictional-key");
  await nativePhase4Api.clearWebKey("brave");
  await nativePhase4Api.testWeb();
  await voiceApi.setCloudKey("groq", "fictional-key");
  await voiceApi.clearCloudKey("groq");
  const input = {
    enabled: true,
    device: "auto" as const,
    language: "en" as const,
    idleUnloadMinutes: 10,
    engine: "cloud" as const,
    cloud: {
      provider: "groq" as const,
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
    },
  };
  await voiceApi.save(input);
  expect(native.invoke.mock.calls).toEqual([
    ["web_search_settings"],
    ["save_web_search_settings", { input: { provider: "brave" } }],
    ["set_web_search_key", { provider: "brave", key: "fictional-key" }],
    ["clear_web_search_key", { provider: "brave" }],
    ["test_web_search"],
    ["voice_set_cloud_key", { provider: "groq", key: "fictional-key" }],
    ["voice_clear_cloud_key", { provider: "groq" }],
    ["voice_settings_save", { input }],
  ]);
});
it("R6-N03 generated ApiError results become plain, recoverable messages", async () => {
  native.invoke.mockRejectedValue({
    code: "provider",
    message: "Check the API key",
  });
  const web = await nativePhase4Api.testWeb().catch((error: unknown) => error);
  const voice = await voiceApi
    .setCloudKey("groq", "fixture")
    .catch((error: unknown) => error);
  expect(web).toBeInstanceOf(JamError);
  expect(voice).toBeInstanceOf(JamError);
  expect(web).toMatchObject({ message: "Check the API key" });
  expect(voice).toMatchObject({ message: "Check the API key" });
});
