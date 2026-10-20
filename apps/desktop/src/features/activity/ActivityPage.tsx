import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  UserPlus,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  EmptyState,
  SegmentedControl,
} from "../../components/ui";
import { PageHeading } from "../../components/ui/m5";
import { api } from "../../lib/api";
import type { ActivityEvent } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { tableTime, useTableClock } from "../table/table-time";
import { EventWords } from "./EventWords";
import { activityHour, mergeEvents, pendingEvents } from "./model";
export function ActivityPage({ openTask }: { openTask(key: string): void }) {
  const [kind, setKind] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState<ActivityEvent[]>([]);
  const [pending, setPending] = useState<ActivityEvent[]>([]);
  const now = useTableClock();
  const [frozen, setFrozen] = useState<ActivityEvent[] | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["activity", kind],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api.listActivity({
        beforeSeq: pageParam,
        limit: 30,
        actorKind: kind || undefined,
      }),
    getNextPageParam: (last) =>
      last.length === 30 ? last.at(-1)?.seq : undefined,
  });
  const loaded = query.data?.pages.flat() ?? [];
  const batch = useUiStore((s) => s.boardEvents);
  const processed = useRef(batch);
  useLayoutEffect(() => {
    if (processed.current === batch) return;
    processed.current = batch;
    const incoming = pendingEvents(batch, 0, kind);
    if (!incoming.length) return;
    if ((scroller.current?.scrollTop ?? 0) > 80) {
      const ids = new Set(incoming.map((e) => e.seq));
      setFrozen(
        (v) =>
          v ??
          mergeEvents(
            loaded.filter((e) => !ids.has(e.seq)),
            extra,
          ),
      );
      setPending((v) => mergeEvents(v, incoming));
    } else setExtra((v) => mergeEvents(v, incoming));
  }, [batch, kind, loaded, extra]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        )
          void query.fetchNextPage();
      },
      { root: scroller.current, rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);
  const visible = mergeEvents(
    frozen
      ? mergeEvents(
          frozen,
          loaded.filter((e) => e.seq <= (frozen[0]?.seq ?? 0)),
        )
      : loaded,
    extra,
  );
  const groups: { label: string; events: ActivityEvent[] }[] = [];
  for (const event of visible) {
    const label = activityHour(event.createdAt);
    const previous = groups.at(-1);
    if (previous?.label === label) previous.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return (
    <main className="feature-page activity-page">
      <PageHeading title="Activity" note="a little progress, together">
        <SegmentedControl
          label="Activity filter"
          value={kind}
          onChange={(value) => {
            setKind(value);
            setExtra([]);
            setPending([]);
            setFrozen(null);
          }}
          options={[
            { value: "", label: "All" },
            { value: "human", label: "Humans" },
            { value: "agent", label: "Agents" },
          ]}
        />
      </PageHeading>
      {pending.length > 0 && (
        <Button
          className="new-events"
          onClick={() => {
            setExtra((v) => mergeEvents(v, pending));
            setPending([]);
            setFrozen(null);
            scroller.current?.scrollTo({
              top: 0,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            });
          }}
        >
          {pending.length} new events ↑
        </Button>
      )}
      <div
        className="activity-scroll"
        ref={scroller}
        data-testid="activity-scroll"
      >
        {groups.map((group) => (
          <section key={group.events[0]?.seq} className="activity-group">
            <h2 className="activity-hour">{group.label}</h2>
            {group.events.map((e) => {
              const Icon =
                e.action === "comment.added"
                  ? MessageSquare
                  : e.action.includes("linked")
                    ? LinkIcon
                    : e.action === "member.joined"
                      ? UserPlus
                      : e.action.includes("archived")
                        ? Archive
                        : e.action === "task.created"
                          ? Plus
                          : ArrowRight;
              return (
                <div key={e.seq}>
                  <button
                    type="button"
                    className={`activity-entry ${extra.some((x) => x.seq === e.seq) ? "fresh-event" : ""}`}
                    style={
                      {
                        "--actor-color": e.actor.color,
                        "--agent-edge":
                          e.actor.kind === "agent"
                            ? e.actor.color
                            : "transparent",
                      } as React.CSSProperties
                    }
                    onClick={() => e.taskKey && openTask(e.taskKey)}
                    disabled={!e.taskKey}
                  >
                    <Avatar member={e.actor} size={28} />
                    <span className="activity-words">
                      <EventWords event={e} />
                      <small className="muted" title={e.createdAt}>
                        {tableTime(e.createdAt, now).label}
                      </small>
                    </span>
                    <Icon size={18} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
        {!visible.length && !query.isPending && (
          <EmptyState text="The story of your jam starts here" />
        )}
        {query.error && <p role="alert">{query.error.message}</p>}
        <div ref={sentinel} className="activity-sentinel">
          {query.isFetchingNextPage ? (
            "Loading earlier events…"
          ) : query.hasNextPage ? (
            <Button onClick={() => void query.fetchNextPage()}>
              Load earlier events
            </Button>
          ) : (
            "You’re all caught up"
          )}
        </div>
      </div>
    </main>
  );
}
