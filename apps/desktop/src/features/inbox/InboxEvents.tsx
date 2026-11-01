import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  EmptyState,
  SegmentedControl,
  Stamp,
} from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import {
  type InboxEvent,
  type InboxEventFilter,
  inboxEventsQuery,
  inboxSummaryQuery,
  markInboxEventsSeen,
} from "../../lib/inbox-events-api";
import { relativeTime } from "../../lib/time";
import "./inbox-events.css";

export function inboxDay(iso: string, now = new Date()) {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear()
      ? ({ year: "numeric" } as const)
      : {}),
  });
}

function EventRow({ event }: { event: InboxEvent }) {
  const navigate = useNavigate();
  const open = (review = false) => {
    if (event.taskKey)
      void navigate({
        to: "/board",
        search: {
          task: event.taskKey,
          taskSection: review ? "review" : undefined,
        },
      });
    else if (event.frameId)
      void navigate({
        to: "/references",
        search: (previous) => ({
          ...previous,
          frame: event.frameId ?? undefined,
        }),
      });
    else if (event.epicKey)
      void navigate({
        to: "/plan/$epicKey",
        params: { epicKey: event.epicKey },
        search: { story: event.storyKey ?? undefined },
      });
  };
  const target =
    event.taskKey ?? event.storyKey ?? event.epicKey ?? event.frameTitle;
  const actor = {
    ...event.actor,
    color: /^m[1-6]$/.test(event.actor.color)
      ? `var(--${event.actor.color})`
      : event.actor.color,
  };
  return (
    <article
      className={`inbox-event ${event.unread ? "is-unread" : ""}`}
      aria-label={`${event.sentence}${event.unread ? ", unread" : ""}`}
    >
      <span className="inbox-unread-dot" aria-hidden="true" />
      <Avatar member={actor} size={30} />
      <div className="inbox-event-content">
        <button
          type="button"
          className="inbox-event-open"
          onClick={() => open()}
        >
          {event.sentence}
        </button>
        <div className="inbox-event-meta">
          <time
            dateTime={event.createdAt}
            title={new Date(event.createdAt).toLocaleString()}
          >
            {relativeTime(event.createdAt)}
          </time>
          {target && (
            <button
              type="button"
              className="inbox-target"
              onClick={() => open()}
            >
              {event.frameId && !event.taskKey
                ? (event.frameTitle ?? target)
                : target}
            </button>
          )}
          {event.group === "needs_action" &&
            (event.resolved ? (
              <Stamp className="muted">Done</Stamp>
            ) : (
              <Button onClick={() => open(event.action === "report.submitted")}>
                {event.action === "report.submitted"
                  ? "Review"
                  : "Open request"}
              </Button>
            ))}
        </div>
      </div>
    </article>
  );
}

export function InboxEvents() {
  const [filter, setFilter] = useState<InboxEventFilter>("all");
  const events = useInfiniteQuery(inboxEventsQuery(filter));
  const summary = useQuery(inboxSummaryQuery);
  const client = useQueryClient();
  const seen = useMutation({
    mutationFn: markInboxEventsSeen,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["activity", "inbox-events"] }),
  });
  const newest = events.data?.pages[0]?.events[0]?.seq;
  const seenSeq = events.data?.pages[0]?.seenSeq ?? 0;
  const markSeen = seen.mutate;
  // biome-ignore lint/correctness/useExhaustiveDependencies: New data restarts the required one-second visibility interval.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      clearTimeout(timer);
      if (
        document.visibilityState === "visible" &&
        newest !== undefined &&
        newest > seenSeq
      )
        timer = setTimeout(() => {
          if (document.visibilityState === "visible") markSeen(newest);
        }, 1000);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [newest, seenSeq, events.dataUpdatedAt, markSeen]);
  const rows = events.data?.pages.flatMap((page) => page.events) ?? [];
  return (
    <section className="inbox-events" aria-label="Events">
      <SegmentedControl<InboxEventFilter>
        label="Event filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          {
            value: "needs_action",
            label: `Needs action ${summary.data?.openActions ?? 0}`,
          },
          { value: "updates", label: "Updates" },
        ]}
      />
      {events.isPending ? (
        <PaperSkeleton label="Loading events" />
      ) : events.error && !events.data ? (
        <QueryError error={events.error} retry={() => void events.refetch()} />
      ) : (
        <>
          {events.error && (
            <QueryError
              error={events.error}
              retry={() => void events.refetch()}
            />
          )}
          {!rows.length && (
            <EmptyState
              text={
                filter === "needs_action"
                  ? "Nothing needs you right now"
                  : filter === "updates"
                    ? "No updates yet"
                    : "No events yet"
              }
            />
          )}
          {rows.map((event, index) => {
            const day = inboxDay(event.createdAt);
            return (
              <div key={`${event.firstSeq}-${event.seq}`}>
                {(index === 0 ||
                  inboxDay(rows[index - 1]?.createdAt ?? event.createdAt) !==
                    day) && <h2 className="inbox-event-day">{day}</h2>}
                <EventRow event={event} />
              </div>
            );
          })}
          {events.hasNextPage && (
            <Button
              disabled={events.isFetchingNextPage}
              onClick={() => void events.fetchNextPage()}
            >
              {events.isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          )}
        </>
      )}
      {seen.error && (
        <QueryError
          error={seen.error}
          retry={() => newest !== undefined && seen.mutate(newest)}
        />
      )}
    </section>
  );
}
