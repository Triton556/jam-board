import type { ActivityEvent } from "../../lib/types";

// Presentation context only: retain the real null epicId of project interviews.
// Bound the prelude by the previous epic creation, rather than repeating every
// earlier interview on every later epic. Scoped journal/MCP reads stay unchanged.
export function journalWithProjectPrelude(
  epic: ActivityEvent[],
  project: ActivityEvent[],
) {
  const created = epic.find((e) => e.action === "epic.created")?.seq;
  if (created === undefined) return epic;
  const previous = Math.max(
    0,
    ...project
      .filter((e) => e.action === "epic.created" && e.seq < created)
      .map((e) => e.seq),
  );
  const prelude = project.filter(
    (e) =>
      e.epicId == null &&
      e.seq > previous &&
      e.seq < created &&
      (e.action === "agent.status" || e.action.startsWith("question.")),
  );
  return [...prelude, ...epic];
}

export function journalSessions(events: ActivityEvent[]) {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const groups: {
    day: string;
    actor: ActivityEvent["actor"];
    start: string;
    end: string;
    events: ActivityEvent[];
  }[] = [];
  for (const e of sorted) {
    const day = new Date(e.createdAt).toDateString(),
      previous = groups.at(-1);
    if (
      previous &&
      previous.day === day &&
      previous.actor.id === e.actor.id &&
      Date.parse(e.createdAt) - Date.parse(previous.end) < 600000 &&
      Date.parse(e.createdAt) >= Date.parse(previous.end)
    ) {
      previous.end = e.createdAt;
      previous.events.push(e);
    } else
      groups.push({
        day,
        actor: e.actor,
        start: e.createdAt,
        end: e.createdAt,
        events: [e],
      });
  }
  return groups.reverse();
}
export function milestoneClass(event: ActivityEvent) {
  if (event.action === "review.recorded") {
    const p = event.payload as { verdict?: string };
    return `milestone ${p?.verdict === "accept" ? "accepted" : "returned"}`;
  }
  return ["epic.created", "epic.status", "question.answered"].includes(
    event.action,
  )
    ? "milestone"
    : "";
}
export const epicProgress = (tasks: { status: string }[]) => ({
  done: tasks.filter((t) => t.status === "done").length,
  total: tasks.length,
});
