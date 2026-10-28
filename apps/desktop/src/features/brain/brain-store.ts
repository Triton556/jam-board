import { create } from "zustand";
import type {
  AgentDockEvent,
  AgentSessionView,
  AttachmentView,
  PromptPart,
} from "../../lib/agent-dock-api";
import { useUiStore } from "../../lib/ui-store";

export type BrainContextItem = Extract<PromptPart, { type: "board_ref" }>;
type ContextState = {
  sources: Record<string, BrainContextItem[]>;
  publish(source: string, items: BrainContextItem[]): void;
};
export const useBrainContext = create<ContextState>((set) => ({
  sources: {},
  publish: (source, items) =>
    set((s) => ({ sources: { ...s.sources, [source]: items } })),
}));
export type DraftAttachment = {
  id: string;
  name: string;
  size: number;
  status: "copying" | "ready" | "refused";
  error?: string;
  view?: AttachmentView;
};
type Draft = {
  text: string;
  context: BrainContextItem[];
  attachments?: DraftAttachment[];
};
type BrainState = {
  projectId: string | null;
  sessions: AgentSessionView[];
  events: Record<string, AgentDockEvent[]>;
  selected: { chat: string | null; terminal: string | null };
  tab: "chat" | "terminal" | "history";
  userConfigChoices?: Record<
    string,
    import("../../lib/agent-dock-api").UserConfigChoice
  >;
  launchWarnings?: Record<
    string,
    import("../../lib/agent-dock-api").LaunchWarning[]
  >;
  terminalTitles?: Record<string, string>;
  hiddenSessions?: Record<string, boolean>;
  drafts: Record<string, Draft>;
  attachments: Record<string, AttachmentView>;
  configuring?: Record<string, boolean>;
  activity?: {
    status: "needs-you" | "error" | "working";
    label: string;
    tooltip: string;
  } | null;
  ingest(event: AgentDockEvent): void;
};
export const useBrainState = create<BrainState>((set) => ({
  projectId: null,
  sessions: [],
  events: {},
  selected: { chat: null, terminal: null },
  tab: "chat",
  drafts: {},
  attachments: {},
  ingest: (event) =>
    set((s) => {
      const existing = s.events[event.sessionId] ?? [];
      if (existing.some((e) => e.seq === event.seq)) return s;
      return {
        events: {
          ...s.events,
          [event.sessionId]: [...existing, event]
            .sort((a, b) => a.seq - b.seq)
            .slice(-4000),
        },
        sessions:
          event.kind === "user_message" &&
          !existing.some((item) => item.kind === "user_message")
            ? s.sessions.map((session) =>
                session.id === event.sessionId &&
                /^(Claude Code|Codex|Claude via z\.ai|Claude via OpenRouter|OpenRouter|z\.ai|Custom API)$/.test(
                  session.title,
                )
                  ? {
                      ...session,
                      title:
                        event.content
                          .flatMap((part) =>
                            part.type === "text" ? [part.text] : [],
                          )
                          .join(" ")
                          .trim()
                          .slice(0, 60) || session.title,
                    }
                  : session,
              )
            : event.kind === "status" || event.kind === "retrying"
              ? s.sessions.map((session) =>
                  session.id === event.sessionId
                    ? {
                        ...session,
                        status:
                          event.kind === "retrying" ? "running" : event.status,
                      }
                    : session,
                )
              : s.sessions,
      };
    }),
}));
export function draftKey() {
  const s = useBrainState.getState();
  return `${s.projectId}:${s.selected.chat ?? "new"}`;
}
/** A3: call from xterm onTitleChange, including snapshot replay. */
export function setTerminalTitle(sessionId: string, title: string) {
  const clean = title
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 240);
  if (!clean) return;
  useBrainState.setState((state) => ({
    terminalTitles: { ...state.terminalTitles, [sessionId]: clean },
  }));
}
export function clearStoppedSessions(ids: string[]) {
  useBrainState.setState((state) => ({
    hiddenSessions: {
      ...state.hiddenSessions,
      ...Object.fromEntries(ids.map((id) => [id, true])),
    },
  }));
}
export function updateDraft(draft: Partial<Draft>) {
  const key = draftKey();
  useBrainState.setState((s) => ({
    drafts: {
      ...s.drafts,
      [key]: { text: "", context: [], ...s.drafts[key], ...draft },
    },
  }));
}
export function useBrainDock() {
  const hasActiveChat = useBrainState((s) =>
    s.sessions.some(
      (session) =>
        session.kind !== "terminal" &&
        !["stopped", "failed"].includes(session.status),
    ),
  );
  return {
    open: () => useUiStore.getState().setBrainDockOpen(true),
    compose: ({
      text,
      context = [],
    }: {
      text: string;
      context?: BrainContextItem[];
    }) => {
      const state = useBrainState.getState();
      useBrainState.setState({
        tab: "chat",
        selected: {
          ...state.selected,
          chat:
            state.selected.chat ??
            state.sessions.find(
              (s) =>
                s.kind !== "terminal" &&
                !["stopped", "failed"].includes(s.status),
            )?.id ??
            null,
        },
      });
      updateDraft({ text, context });
      useUiStore.getState().setBrainDockOpen(true);
    },
    hasActiveChat,
  };
}
