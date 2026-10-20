import { create } from "zustand";
import type { ActivityEvent, Member } from "./types";
export type ToastMessage = {
  id: string;
  text: string;
  taskKey?: string;
  actor?: ActivityEvent["actor"];
  until: number;
  pausedAt?: number;
};
type UiState = {
  now: number;
  highlights: Record<string, { color: string; until: number; action: string }>;
  agentPulse: Record<string, number>;
  toasts: ToastMessage[];
  sidebarExpanded: boolean;
  soundEnabled: boolean;
  quickColumn: string | null;
  taskChanges: Record<string, ActivityEvent>;
  boardEvents: ActivityEvent[];
  toggleSidebar(): void;
  setQuickColumn(status: string | null): void;
  receive(events: ActivityEvent[]): void;
  error(text: string): void;
  tick(now: number): void;
  pauseToast(id: string, pause: boolean): void;
};
function savedSidebar() {
  try {
    return localStorage.getItem("jam.sidebarExpanded") === "true";
  } catch {
    return false;
  }
}
export const useUiStore = create<UiState>((set) => ({
  now: Date.now(),
  highlights: {},
  agentPulse: {},
  toasts: [],
  sidebarExpanded: savedSidebar(),
  soundEnabled: false,
  quickColumn: null,
  taskChanges: {},
  boardEvents: [],
  toggleSidebar: () =>
    set((s) => {
      const expanded = !s.sidebarExpanded;
      try {
        localStorage.setItem("jam.sidebarExpanded", String(expanded));
      } catch {
        /* Storage can be unavailable in private mode. */
      }
      return { sidebarExpanded: expanded };
    }),
  setQuickColumn: (quickColumn) => set({ quickColumn }),
  receive: (events) =>
    set((s) => {
      const highlights = { ...s.highlights };
      const agentPulse = { ...s.agentPulse };
      let toasts = [...s.toasts];
      const taskChanges = { ...s.taskChanges };
      const now = Date.now();
      for (const event of events) {
        if (event.taskKey) taskChanges[event.taskKey] = event;
        if (event.actor.kind !== "agent") continue;
        if (event.taskKey)
          highlights[event.taskKey] = {
            color: event.actor.color,
            until: now + 4000,
            action: event.action,
          };
        agentPulse[event.actor.handle] = now + 2000;
        toasts = [
          ...toasts,
          {
            id: `${event.seq}-${crypto.randomUUID()}`,
            text: eventText(event),
            taskKey: event.taskKey ?? undefined,
            actor: event.actor,
            until: now + 5000,
          },
        ].slice(-3);
      }
      return {
        highlights,
        agentPulse,
        toasts,
        now,
        taskChanges,
        boardEvents: events,
      };
    }),
  error: (text) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id: crypto.randomUUID(), text, until: Date.now() + 5000 },
      ].slice(-3),
    })),
  tick: (now) =>
    set((s) => ({
      now,
      highlights: Object.values(s.highlights).some((h) => h.until <= now)
        ? Object.fromEntries(
            Object.entries(s.highlights).filter(([, h]) => h.until > now),
          )
        : s.highlights,
      agentPulse: Object.values(s.agentPulse).some((until) => until <= now)
        ? Object.fromEntries(
            Object.entries(s.agentPulse).filter(([, until]) => until > now),
          )
        : s.agentPulse,
      toasts: s.toasts.some((t) => t.pausedAt === undefined && t.until <= now)
        ? s.toasts.filter((t) => t.pausedAt !== undefined || t.until > now)
        : s.toasts,
    })),
  pauseToast: (id, pause) =>
    set((s) => ({
      toasts: s.toasts.map((t) =>
        t.id !== id
          ? t
          : pause
            ? { ...t, pausedAt: t.pausedAt ?? Date.now() }
            : {
                ...t,
                until:
                  t.until +
                  (t.pausedAt === undefined ? 0 : Date.now() - t.pausedAt),
                pausedAt: undefined,
              },
      ),
    })),
}));
export function eventText(event: ActivityEvent) {
  const payload =
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? event.payload
      : {};
  const status = Array.isArray(payload.status)
    ? payload.status[1]
    : payload.status;
  const title = typeof payload.title === "string" ? payload.title : "";
  const verbs: Record<string, string> = {
    "task.created": `created ${event.taskKey}${title ? ` · ${title}` : ""}`,
    "task.moved": `moved ${event.taskKey}${typeof status === "string" ? ` to ${status === "in_progress" ? "In progress" : status === "todo" ? "To do" : status[0]?.toUpperCase() + status.slice(1)}` : ""}`,
    "task.claimed": `claimed ${event.taskKey}`,
    "comment.added": `commented on ${event.taskKey}`,
  };
  return `${event.actor.name} ${verbs[event.action] ?? `updated ${event.taskKey ?? "the board"}`}`;
}
export function memberInitial(member: Pick<Member, "name">) {
  return member.name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
