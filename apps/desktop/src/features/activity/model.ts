import type { ActivityEvent } from "../../lib/types";

const hourFormat = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  hourCycle: "h23",
});
const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});
export function activityHour(iso: string, now = Date.now()) {
  const d = new Date(iso),
    today = new Date(now),
    yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const label =
    d.toDateString() === today.toDateString()
      ? "Today"
      : d.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : dateFormat.format(d);
  return `${label} · ${hourFormat.format(d)}:00`;
}
export function mergeEvents(
  existing: ActivityEvent[],
  incoming: ActivityEvent[],
) {
  return [
    ...new Map([...existing, ...incoming].map((e) => [e.seq, e])).values(),
  ].sort((a, b) => b.seq - a.seq);
}
export function pendingEvents(
  events: ActivityEvent[],
  latest: number,
  kind: string,
) {
  return events.filter(
    (e) => e.seq > latest && (!kind || e.actor.kind === kind),
  );
}
