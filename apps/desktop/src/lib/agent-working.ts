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
  const scoped =
    member.statusScope?.type === "task" &&
    [task.id, task.key].includes(member.statusScope.id);
  if (!scoped) {
    if (age > 600000) return null;
    const elsewhere = member.statusScope?.type === "task";
    const text = `${member.name} · ${elsewhere ? "active elsewhere" : "task activity unconfirmed"}`;
    return {
      mode: "quiet",
      color: "var(--ink-3)",
      text,
      tooltip: `${member.name} is online. ${elsewhere ? "The latest status belongs to another task." : "No task-specific activity was reported."} Latest agent status: ${status}`,
      name: member.name,
      status,
    };
  }
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
  const text = `${member.name} · ${status}`;
  return {
    mode: "active",
    color: member.color,
    text,
    tooltip: `${member.name} · ${status}`,
    name: member.name,
    status,
  };
}

/** Card feedback distinguishes lifecycle/ownership from self-reported activity.
 * A scoped report is not a claim, a reviewer appointment, or execution permission.
 */
export function cardPresence(
  task: TaskSummary,
  members: Member[],
  now: number,
): WorkingState {
  if (!["in_progress", "review"].includes(task.status)) return null;
  const holder = members.find((member) => member.id === task.assigneeId);
  if (task.status === "in_progress") {
    const working = agentWorking(task, holder, now);
    if (working) return working;
  }
  const report = members
    .filter((member) => {
      const seen = Date.parse(member.lastSeenAt ?? "");
      const at = Date.parse(member.statusAt ?? "");
      return (
        member.kind === "agent" &&
        // The retained worker cannot review its own report. Never reuse that
        // worker's implementation status as Review presence.
        (task.status !== "review" || member.id !== task.assigneeId) &&
        member.statusText?.trim() &&
        member.statusScope?.type === "task" &&
        [task.id, task.key].includes(member.statusScope.id) &&
        Number.isFinite(seen) &&
        Number.isFinite(at) &&
        seen <= now &&
        at <= now &&
        now - seen <= 120000 &&
        now - at <= 1800000
      );
    })
    .sort(
      (a, b) => Date.parse(b.statusAt ?? "") - Date.parse(a.statusAt ?? ""),
    )[0];
  const base =
    task.status === "review"
      ? "Awaiting review"
      : holder?.kind === "human"
        ? `Assigned to ${holder.name}`
        : holder
          ? `${holder.name} · task activity unconfirmed`
          : task.assigneeId
            ? "Assigned member unavailable · execution unconfirmed"
            : "Execution unconfirmed";
  const text = report
    ? `${base} · ${report.name} last reported ${Math.floor((now - Date.parse(report.statusAt ?? "")) / 60000)} min ago: ${report.statusText?.trim()}`
    : base;
  return {
    mode: "quiet",
    color: "var(--ink-3)",
    text,
    tooltip: `${text}. ${
      task.status === "review"
        ? "Review status does not confirm that a reviewer is currently working."
        : "Assignment and task status do not confirm current execution."
    }${report ? ` Last reported at ${report?.statusAt}. A scoped agent report does not establish ownership or review activity.` : ""}`,
    name: report?.name ?? holder?.name ?? "",
    status: report?.statusText?.trim() ?? "",
  };
}

export function useCardPresence(task: TaskSummary, members: Member[]) {
  return useUiStore(useShallow((s) => cardPresence(task, members, s.now)));
}

export function useAgentWorking(task: TaskSummary, member?: Member) {
  // The application's existing shared tick owns expiry. Equal states keep
  // cards still; there are no per-card timers or animation callbacks.
  return useUiStore(useShallow((s) => agentWorking(task, member, s.now)));
}

export const useWorkingClock = () =>
  useUiStore((s) => Math.floor(s.now / 1000) * 1000);
