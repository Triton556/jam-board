import { beforeEach, expect, it, vi } from "vitest";
import type { AgentDockEvent } from "./agent-dock-api";
import { tauriDockApi } from "./agent-dock-tauri";
import { JamError } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.listen.mockReset();
});
it("uses all sixteen exact native command names and camelCase argument envelopes", async () => {
  const profile = { label: "Custom", kind: "acp" as const };
  const prompt = {
    sessionId: "s",
    content: [{ type: "text" as const, text: "Hello" }],
  };
  const permission = { sessionId: "s", requestId: "r", optionId: "once" };
  const config = { sessionId: "s", optionId: "mode", value: "plan" };
  await tauriDockApi.profiles();
  await tauriDockApi.saveProfile(profile);
  await tauriDockApi.deleteProfile("p");
  await tauriDockApi.setSecret("p", "TOKEN", "fictional");
  await tauriDockApi.clearSecret("p", "TOKEN");
  await tauriDockApi.sessions();
  await tauriDockApi.startSession({ profileId: "p" });
  await tauriDockApi.sendPrompt(prompt);
  await tauriDockApi.cancelTurn("s");
  await tauriDockApi.resolvePermission(permission);
  await tauriDockApi.setConfigOption(config);
  await tauriDockApi.stopSession("s");
  await tauriDockApi.history("s");
  await tauriDockApi.terminalWrite({ sessionId: "s", data: "hi" });
  await tauriDockApi.terminalResize({ sessionId: "s", cols: 80, rows: 24 });
  await tauriDockApi.terminalSnapshot("s");
  expect(native.invoke.mock.calls).toEqual([
    ["agent_profiles", undefined],
    ["save_agent_profile", { input: profile }],
    ["delete_agent_profile", { profileId: "p" }],
    ["set_agent_secret", { profileId: "p", key: "TOKEN", value: "fictional" }],
    ["clear_agent_secret", { profileId: "p", key: "TOKEN" }],
    ["agent_sessions", undefined],
    ["start_agent_session", { input: { profileId: "p" } }],
    ["send_agent_prompt", { input: prompt }],
    ["cancel_agent_turn", { sessionId: "s" }],
    ["resolve_agent_permission", { input: permission }],
    ["set_agent_config_option", { input: config }],
    ["stop_agent_session", { sessionId: "s" }],
    ["agent_session_history", { sessionId: "s" }],
    ["terminal_write", { input: { sessionId: "s", data: "hi" } }],
    ["terminal_resize", { input: { sessionId: "s", cols: 80, rows: 24 } }],
    ["terminal_snapshot", { sessionId: "s" }],
  ]);
});
it("converts rejected ApiError into JamError", async () => {
  native.invoke.mockRejectedValue({
    code: "busy",
    message: "Turn running",
    field: "sessionId",
  });
  const error = await tauriDockApi.cancelTurn("s").catch((e) => e);
  expect(error).toBeInstanceOf(JamError);
  expect(error).toMatchObject({
    code: "busy",
    message: "Turn running",
    field: "sessionId",
  });
});
it("BC14 uses generated catalog and attachment bindings with input envelopes", async () => {
  native.invoke.mockResolvedValue({
    source: "provider",
    models: [],
    fetchedAt: null,
    error: null,
  });
  await tauriDockApi.modelCatalog({ profileId: "p", refresh: true });
  native.invoke.mockResolvedValue({ id: "a" });
  await tauriDockApi.addAttachment({
    sessionId: "s",
    source: { kind: "path", path: "C:/image.png" },
  });
  expect(native.invoke.mock.calls).toEqual([
    ["agent_model_catalog", { input: { profileId: "p", refresh: true } }],
    [
      "add_agent_attachment",
      {
        input: {
          sessionId: "s",
          source: { kind: "path", path: "C:/image.png" },
        },
      },
    ],
  ]);
});
it("subscribes to exact event names and disposes late native listeners", async () => {
  const off = vi.fn();
  native.listen.mockResolvedValue(off);
  const cb = vi.fn();
  const stop = tauriDockApi.onEvent(cb);
  const payload = {
    sessionId: "s",
    seq: 1,
    at: "now",
    kind: "status",
    status: "ready",
  } as AgentDockEvent;
  native.listen.mock.calls[0]?.[1]({ payload });
  expect(cb).toHaveBeenCalledWith(payload);
  stop();
  await Promise.resolve();
  expect(off).toHaveBeenCalledOnce();
  const terminalStop = tauriDockApi.onTerminalOutput(vi.fn());
  await Promise.resolve();
  terminalStop();
  expect(native.listen.mock.calls.map((call) => call[0])).toEqual([
    "agent-dock-event",
    "agent-terminal-output",
  ]);
});
