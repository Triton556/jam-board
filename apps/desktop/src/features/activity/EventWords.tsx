import type { ReactNode } from "react";
import type { ActivityEvent, Status } from "../../lib/types";
import { labels } from "../../lib/types";
export function EventWords({ event: e }: { event: ActivityEvent }) {
  const payload = e.payload as Record<string, unknown>,
    key = <b className="mono">{e.taskKey}</b>;
  const status = Array.isArray(payload.status)
    ? payload.status[1]
    : payload.status;
  let words: ReactNode;
  switch (e.action) {
    case "task.created":
      words = (
        <>
          created {key}
          {typeof payload.title === "string" && ` · ${payload.title}`}
        </>
      );
      break;
    case "task.moved":
      words = (
        <>
          moved {key} to{" "}
          {labels[status as Status] ?? String(status ?? "another column")}
        </>
      );
      break;
    case "task.claimed":
      words = <>claimed {key}</>;
      break;
    case "task.released":
      words = <>released {key}</>;
      break;
    case "task.archived":
      words = <>archived {key}</>;
      break;
    case "task.unarchived":
      words = <>restored {key}</>;
      break;
    case "task.updated":
      words = (
        <>
          updated {key} · {Object.keys(payload).join(", ")}
        </>
      );
      break;
    case "comment.added":
      words = <>commented on {key}</>;
      break;
    case "asset.linked":
      words = (
        <>
          linked asset <b>{String(payload.name ?? "asset")}</b> to {key}
        </>
      );
      break;
    case "asset.unlinked":
      words = <>unlinked an asset from {key}</>;
      break;
    case "asset.created":
      words = (
        <>
          added asset <b>{String(payload.name ?? "")}</b>
        </>
      );
      break;
    case "asset.updated":
      words = (
        <>
          updated asset <b>{String(payload.name ?? "")}</b>
        </>
      );
      break;
    case "member.joined":
      words = <>welcomed {String(payload.name ?? "a teammate")}</>;
      break;
    case "member.updated":
      words = "updated a teammate";
      break;
    case "jam.archived":
      words = "archived the jam";
      break;
    case "jam.imported":
      words = "imported the jam";
      break;
    default:
      words = "updated the jam";
  }
  return (
    <>
      <b>{e.actor.name}</b> {words}
    </>
  );
}
