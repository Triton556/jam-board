import { useQuery } from "@tanstack/react-query";
import type { TaskReady } from "../../bindings";
import { Avatar, Stamp } from "../../components/ui";
import { membersQuery } from "../../lib/queries";
import { labels, type Status } from "../../lib/types";
export function TaskRows({
  rows,
  openTask,
}: {
  rows: TaskReady[];
  openTask(key: string): void;
}) {
  const members = useQuery(membersQuery);
  return (
    <div className="plan-task-rows">
      {!rows.length && (
        <p className="hand-note muted">Small, clear tasks go here.</p>
      )}
      {rows.map(({ task: t, readiness }) => {
        const assignee = members.data?.find((m) => m.id === t.assigneeId);
        return (
          <button
            className="plan-task-row"
            type="button"
            key={t.key}
            onClick={() => openTask(t.key)}
          >
            <span
              className={`readiness-dot ${readiness.ready ? "ready" : ""}`}
              title={
                readiness.ready
                  ? "Brief complete"
                  : readiness.missing.map((i) => i.message).join("; ")
              }
            />
            <span className="mono small">{t.key}</span>
            <span className="plan-task-title">{t.title}</span>
            <Stamp style={{ background: `var(--st-${t.status})` }}>
              {labels[t.status as Status]}
            </Stamp>
            {t.changesRequested && (
              <Stamp className="changes-requested">Changes requested</Stamp>
            )}
            {t.needsInfo && <Stamp className="needs-info">Needs info</Stamp>}
            {assignee && <Avatar member={assignee} size={24} />}
          </button>
        );
      })}
    </div>
  );
}
