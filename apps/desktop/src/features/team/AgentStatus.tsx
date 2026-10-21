import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { memo, useState } from "react";
import { Avatar, Button } from "../../components/ui";
import { epicsQuery, storiesQuery } from "../../lib/planning-queries";
import { tasksQuery } from "../../lib/queries";
import { relativeTime } from "../../lib/time";
import type { Member } from "../../lib/types";
import { useTableClock } from "../table/table-time";
export function statusStale(
  member: Pick<Member, "statusText" | "statusAt">,
  now = Date.now(),
) {
  return (
    !!member.statusText && now - Date.parse(member.statusAt ?? "") > 1800000
  );
}
export function AgentStatusLine({ member }: { member: Member }) {
  const now = useTableClock();
  return member.statusText ? (
    <p
      className={`agent-status-line ${statusStale(member, now) ? "stale" : ""}`}
    >
      {member.statusText}
      {statusStale(member, now) ? " (stale)" : ""}
    </p>
  ) : null;
}
export const AgentStatus = memo(function AgentStatus({
  member,
  pulse,
}: {
  member: Member;
  pulse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useTableClock();
  const epics = useQuery(epicsQuery),
    stories = useQuery(storiesQuery),
    tasks = useQuery(tasksQuery),
    navigate = useNavigate();
  const scope = member.statusScope;
  const task = Object.values(tasks.data ?? {})
      .flat()
      .find((t) => t.id === scope?.id || t.key === scope?.id),
    story = stories.data?.find(
      (s) => s.id === scope?.id || s.key === scope?.id,
    ),
    epic = epics.data?.find(
      (e) => e.id === (story?.epicId ?? scope?.id) || e.key === scope?.id,
    );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Observes pointer and descendant focus; the trigger and scope button handle activation.
    <div
      className="agent-status-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        className="agent-status-trigger"
        type="button"
        aria-label={`${member.name} status`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar member={member} size={30} />
        {pulse && <i className="agent-pulse" />}
      </button>
      {open && (
        <section
          className="agent-status-popover"
          aria-label={`${member.name} activity`}
        >
          <b>{member.name}</b>
          <AgentStatusLine member={member} />
          {!member.statusText && (
            <p className="muted">Online and ready to help</p>
          )}
          {scope && (
            <Button
              variant="ghost"
              onClick={() => {
                if (task)
                  void navigate({ to: "/board", search: { task: task.key } });
                else if (epic)
                  void navigate({
                    to: "/plan/$epicKey",
                    params: { epicKey: epic.key },
                    search: { story: story?.key },
                  });
              }}
            >
              {task?.key ?? story?.key ?? epic?.key ?? scope.type}
            </Button>
          )}
          {member.statusAt && (
            <small className="muted">
              updated {relativeTime(member.statusAt)}
            </small>
          )}
        </section>
      )}
    </div>
  );
});
export function InboxBadge({ count }: { count: number }) {
  return count > 0 ? (
    <span
      className="inbox-badge"
      role="img"
      aria-label={`${count} open questions`}
    >
      <i />
      {count > 9 ? "9+" : count}
    </span>
  ) : null;
}
