import type { ActivityEvent, Status } from "../../lib/types";
import { labels } from "../../lib/types";
export function historyText(event: ActivityEvent) {
  const payload =
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? event.payload
      : {};
  const status = Array.isArray(payload.status)
    ? payload.status[1]
    : payload.status;
  if (event.action === "task.updated")
    return `updated ${Object.keys(payload).join(", ") || "task"}`;
  if (event.action === "task.moved")
    return `moved${typeof status === "string" ? ` to ${labels[status as Status] ?? status}` : " task"}`;
  return (
    (
      {
        "task.created": "created task",
        "task.claimed": "claimed task",
        "task.released": "released task",
        "task.archived": "archived task",
        "comment.added": "commented",
        "asset.linked": "linked an asset",
      } as Record<string, string>
    )[event.action] ?? event.action.replaceAll(".", " ")
  );
}
