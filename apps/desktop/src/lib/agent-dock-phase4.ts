import { commands } from "../bindings";
import type {
  AgentDockEvent,
  AgentSessionView,
  HistoryEntry,
} from "./agent-dock-api";
import { mockPhase4Api } from "./agent-dock-phase4-mock";
import { JamError } from "./types";

export type WebProvider = import("../bindings").Provider;
export type WebSettings = import("../bindings").WebSearchSettings;
export type Phase4Api = {
  history(input?: { limit?: number; query?: string }): Promise<HistoryEntry[]>;
  events(entryId: string): Promise<AgentDockEvent[]>;
  resume(entryId: string): Promise<AgentSessionView>;
  rename(entryId: string, title: string): Promise<unknown>;
  delete(entryId: string): Promise<unknown>;
  historySettings(): Promise<{ keepHistory: boolean }>;
  saveHistorySettings(keepHistory: boolean): Promise<unknown>;
  clearHistory(): Promise<unknown>;
  webSettings(): Promise<WebSettings>;
  saveWebSettings(provider: WebProvider | null): Promise<WebSettings>;
  setWebKey(provider: WebProvider, key: string): Promise<unknown>;
  clearWebKey(provider: WebProvider): Promise<unknown>;
  testWeb(): Promise<unknown>;
};
async function unwrap<T>(
  result: Promise<
    | { status: "ok"; data: T }
    | {
        status: "error";
        error: { code: string; message: string; field?: string | null };
      }
  >,
): Promise<T> {
  const value = await result;
  if (value.status === "error")
    throw new JamError(
      value.error.code,
      value.error.message,
      value.error.field ?? undefined,
    );
  return value.data;
}
export const nativePhase4Api: Phase4Api = {
  history: (input = {}) =>
    unwrap(commands.agentHistory(input.limit ?? null, input.query ?? null)),
  events: (entryId) => unwrap(commands.agentHistoryEvents(entryId)),
  resume: (entryId) => unwrap(commands.resumeAgentSession(entryId)),
  rename: (entryId, title) =>
    unwrap(commands.renameAgentHistory(entryId, title)),
  delete: (entryId) => unwrap(commands.deleteAgentHistory(entryId)),
  historySettings: () => unwrap(commands.agentHistorySettings()),
  saveHistorySettings: (keepHistory) =>
    unwrap(commands.saveAgentHistorySettings(keepHistory)),
  clearHistory: () => unwrap(commands.clearAgentHistory()),
  webSettings: () => unwrap(commands.webSearchSettings()),
  saveWebSettings: (provider) =>
    unwrap(commands.saveWebSearchSettings({ provider })),
  setWebKey: (provider, key) => unwrap(commands.setWebSearchKey(provider, key)),
  clearWebKey: (provider) => unwrap(commands.clearWebSearchKey(provider)),
  testWeb: () => unwrap(commands.testWebSearch()),
};
export const phase4Api =
  import.meta.env.VITE_MOCK_BRIDGE === "1" ? mockPhase4Api : nativePhase4Api;
