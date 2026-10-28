import type {
  AgentDockEvent,
  AgentProfileView,
  AgentSessionView,
  HistoryEntry,
} from "./agent-dock-api";
import { mockDockApi, restoreMockTranscript } from "./agent-dock-mock";
import type { Phase4Api, WebSettings } from "./agent-dock-phase4";
import { api } from "./api";

let entries: HistoryEntry[] | null = null;
let keepHistory = true;
let web: WebSettings = { provider: null, keySet: false };
const keys = new Set<string>();
let webFailure = false;
const eventFiles = new Map<string, AgentDockEvent[]>();
const sessionEntries = new Map<string, string>();
export function resetMockPhase4() {
  entries = null;
  keepHistory = true;
  web = { provider: null, keySet: false };
  keys.clear();
  eventFiles.clear();
  sessionEntries.clear();
  webFailure = false;
}
export function setMockWebFailure(failed: boolean) {
  webFailure = failed;
}
export function seedMockHistory(
  next: HistoryEntry[],
  events: Record<string, AgentDockEvent[]> = {},
) {
  entries = structuredClone(next);
  for (const [id, value] of Object.entries(events)) eventFiles.set(id, value);
}
function ensureFixtures(projectId: string) {
  if (!entries) {
    entries = (["native", "transcript", "none"] as const).map(
      (resumable, index) => {
        const at = new Date(
          Date.now() - ([120000, 2 * 86400000, 15 * 86400000][index] ?? 0),
        ).toISOString();
        const entry: HistoryEntry = {
          id: `history-${resumable}`,
          projectId,
          profileId: index === 1 ? "api-openrouter" : "claude-code",
          profileLabel: index === 1 ? "API chat" : "Claude Code",
          kind: "chat",
          provider: {
            label: index === 1 ? "API chat" : "Claude Code",
            agentKind: index === 1 ? "api" : "claude",
          },
          empty: false,
          title:
            [
              "Plan the next release",
              "Review the board layout",
              "Explore an older idea",
            ][index] ?? "Conversation",
          createdAt: at,
          updatedAt: at,
          model: "claude-sonnet-4-6",
          effort: null,
          agentSessionId: null,
          resumable,
          messageCount: 2,
        };
        eventFiles.set(entry.id, [
          {
            sessionId: entry.id,
            seq: 1,
            at,
            kind: "user_message",
            messageId: "u",
            content: [
              { type: "text", text: `Help me ${entry.title.toLowerCase()}.` },
            ],
          },
          {
            sessionId: entry.id,
            seq: 2,
            at,
            kind: "agent_message_delta",
            messageId: "a",
            text: "Start by reviewing the current board and agree on the next step.",
          },
        ]);
        return entry;
      },
    );
  }
  return entries;
}
async function scoped() {
  const projectId = (await api.appState()).jam?.id;
  if (!projectId) throw Error("Open a project first.");
  return ensureFixtures(projectId).filter(
    (entry) => entry.projectId === projectId,
  );
}
export function recordMockHistoryEvent(
  session: AgentSessionView,
  profile: AgentProfileView,
  event: AgentDockEvent,
) {
  if (!keepHistory || session.kind === "terminal") return;
  const all = ensureFixtures(session.projectId);
  const savedId = sessionEntries.get(session.id);
  let entry = all.find((e) => e.id === savedId);
  if (savedId && !entry) return; // Deleting/clearing an active entry closes its history writer.
  if (!entry) {
    entry = {
      id: session.id,
      projectId: session.projectId,
      profileId: profile.id,
      profileLabel: profile.label,
      kind: "chat",
      provider: {
        label: profile.label,
        agentKind:
          session.kind === "api"
            ? "api"
            : profile.id.includes("codex")
              ? "codex"
              : "claude",
      },
      empty: false,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: event.at,
      model: profile.model,
      effort: profile.effort ?? null,
      agentSessionId: session.id,
      resumable: session.kind === "api" ? "transcript" : "native",
      messageCount: 0,
    };
    all.push(entry);
    sessionEntries.set(session.id, entry.id);
  }
  const events = eventFiles.get(entry.id) ?? [];
  if (event.kind === "user_message") {
    if (!entry.messageCount)
      entry.title =
        event.content
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("\n")
          .split("\n")[0]
          ?.slice(0, 60) || entry.title;
    entry.messageCount++;
  }
  if (
    event.kind === "agent_message_delta" &&
    !events.some(
      (e) => e.kind === event.kind && e.messageId === event.messageId,
    )
  )
    entry.messageCount++;
  entry.updatedAt = event.at;
  eventFiles.set(entry.id, [...events, structuredClone(event)]);
}
export const mockPhase4Api: Phase4Api = {
  history: async (input = {}) =>
    structuredClone(
      (await scoped())
        .filter((entry) =>
          `${entry.title} ${entry.profileLabel} ${entry.model}`
            .toLowerCase()
            .includes((input.query ?? "").toLowerCase()),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, input.limit ?? 100),
    ),
  events: async (id) => {
    if (!(await scoped()).some((e) => e.id === id))
      throw Error("History entry not found.");
    return structuredClone(eventFiles.get(id) ?? []);
  },
  resume: async (id, userConfig) => {
    const entry = (await scoped()).find((e) => e.id === id);
    if (!entry || entry.resumable === "none")
      throw Error("Open this transcript and continue in a new session.");
    if (entry.provider.agentKind.startsWith("api")) {
      await mockDockApi.saveProfile({
        id: entry.profileId,
        label: entry.profileLabel,
        kind: "api",
        model: entry.model ?? "fixture-model",
      });
      await mockDockApi.setSecret(
        entry.profileId,
        "API_KEY",
        "fictional-history-key",
      );
    }
    const session = await mockDockApi.startSession({
      profileId: entry.profileId,
      userConfig,
    });
    const temporary = sessionEntries.get(session.id);
    entries = entries?.filter((e) => e.id !== temporary || e.id === id) ?? [];
    if (temporary !== id && temporary) eventFiles.delete(temporary);
    sessionEntries.set(session.id, id);
    if (entry.kind !== "terminal")
      restoreMockTranscript(session.id, eventFiles.get(id) ?? [], entry.title);
    return { ...session, title: entry.title };
  },
  rename: async (id, title) => {
    const entry = (await scoped()).find((e) => e.id === id);
    if (entry) entry.title = title.trim().slice(0, 60);
  },
  delete: async (id) => {
    if (!(await scoped()).some((e) => e.id === id))
      throw Error("History entry not found.");
    entries = entries?.filter((e) => e.id !== id) ?? [];
    eventFiles.delete(id);
  },
  historySettings: async () => ({ keepHistory }),
  saveHistorySettings: async (value) => {
    keepHistory = value;
  },
  clearHistory: async () => {
    const ids = new Set((await scoped()).map((e) => e.id));
    entries = entries?.filter((e) => !ids.has(e.id)) ?? [];
    for (const id of ids) eventFiles.delete(id);
  },
  webSettings: async () => ({
    ...web,
    keySet: !!web.provider && keys.has(web.provider),
  }),
  saveWebSettings: async (provider) => {
    web = { provider, keySet: !!provider && keys.has(provider) };
    return { ...web };
  },
  setWebKey: async (provider, _key) => {
    keys.add(provider);
  },
  clearWebKey: async (provider) => {
    keys.delete(provider);
  },
  testWeb: async () => {
    if (webFailure) throw Error("Can't reach the search provider. Try again.");
    if (!web.provider || !keys.has(web.provider))
      throw Error("Choose a provider and add its API key.");
    return { ok: true };
  },
};
