import { useShallow } from "zustand/react/shallow";
import type { Member, TaskSummary } from "./types";
import { useUiStore } from "./ui-store";

export type WorkingState = {
  mode: "active" | "quiet";
  color: string;
  text: string;
  tooltip: string;
  name: string;
  status: string;
} | null;

export function agentWorking(
  task: Pick<TaskSummary, "id" | "key" | "status">,
  member: Member | undefined,
  now: number,
): WorkingState {
  if (task.status !== "in_progress" || member?.kind !== "agent") return null;
  const seen = Date.parse(member.lastSeenAt ?? ""),
    at = Date.parse(member.statusAt ?? ""),
    status = member.statusText?.trim();
  // Clearing a status explicitly ends working presence. Unknown timestamps do
  // not establish a live signal, even if a cached `online` field says otherwise.
  if (
    !status ||
    !Number.isFinite(seen) ||
    !Number.isFinite(at) ||
    now - seen > 120000
  )
    return null;
  const age = Math.max(0, now - at);
  if (age > 1800000) {
    const text = `${member.name} · last update ${Math.floor(age / 60000)} min ago`;
    return {
      mode: "quiet",
      color: "var(--ink-3)",
      text,
      tooltip: `${text} · ${status}`,
      name: member.name,
      status,
    };
  }
  const scoped =
    member.statusScope?.type === "task" &&
    [task.id, task.key].includes(member.statusScope.id);
  if (!scoped && age > 600000) return null;
  const text = scoped
    ? `${member.name} · ${status}`
    : `${member.name} is working…`;
  return {
    mode: "active",
    color: member.color,
    text,
    tooltip: `${member.name} · ${status}`,
    name: member.name,
    status,
  };
}

export function useAgentWorking(task: TaskSummary, member?: Member) {
  // The application's existing shared tick owns expiry. Equal states keep
  // cards still; there are no per-card timers or animation callbacks.
  return useUiStore(useShallow((s) => agentWorking(task, member, s.now)));
}

export const useWorkingClock = () =>
  useUiStore((s) => Math.floor(s.now / 1000) * 1000);
