import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import type { AgentDockApi } from "./agent-dock-api";
import { JamError } from "./types";

async function call<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    const value = error as { code?: string; message?: string; field?: string };
    throw new JamError(
      value?.code ?? "agent_error",
      value?.message ?? String(error),
      value?.field,
    );
  }
}
function subscribe<T>(name: string, cb: (payload: T) => void) {
  let disposed = false;
  let off: (() => void) | undefined;
  void listen<T>(name, (event) => {
    if (!disposed) cb(event.payload);
  })
    .then((stop) => {
      if (disposed) stop();
      else off = stop;
    })
    .catch(() => {
      /* A later command reports an unavailable native bridge. */
    });
  return () => {
    disposed = true;
    off?.();
  };
}
export const tauriDockApi: AgentDockApi = {
  profiles: () => call("agent_profiles"),
  saveProfile: (input) => call("save_agent_profile", { input }),
  deleteProfile: (profileId) => call("delete_agent_profile", { profileId }),
  setSecret: (profileId, key, value) =>
    call("set_agent_secret", { profileId, key, value }),
  clearSecret: (profileId, key) =>
    call("clear_agent_secret", { profileId, key }),
  sessions: () => call("agent_sessions"),
  startSession: (input) => call("start_agent_session", { input }),
  sendPrompt: (input) => call("send_agent_prompt", { input }),
  cancelTurn: (sessionId) => call("cancel_agent_turn", { sessionId }),
  resolvePermission: (input) => call("resolve_agent_permission", { input }),
  setConfigOption: (input) => call("set_agent_config_option", { input }),
  stopSession: (sessionId) => call("stop_agent_session", { sessionId }),
  history: (sessionId) => call("agent_session_history", { sessionId }),
  terminalWrite: (input) => call("terminal_write", { input }),
  terminalResize: (input) => call("terminal_resize", { input }),
  terminalSnapshot: (sessionId) => call("terminal_snapshot", { sessionId }),
  modelCatalog: async (input) => {
    const result = await commands.agentModelCatalog(input);
    if (result.status === "error")
      throw new JamError(result.error.code, result.error.message);
    return result.data;
  },
  addAttachment: async (input) => {
    const result = await commands.addAgentAttachment(input);
    if (result.status === "error")
      throw new JamError(result.error.code, result.error.message);
    return result.data;
  },
  onEvent: (cb) => subscribe("agent-dock-event", cb),
  onTerminalOutput: (cb) => subscribe("agent-terminal-output", cb),
};
