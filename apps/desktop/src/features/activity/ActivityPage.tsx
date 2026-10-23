import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  EmptyState,
  SegmentedControl,
} from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { PageHeading } from "../../components/ui/m5";
import { api } from "../../lib/api";
import { epicsQuery } from "../../lib/planning-queries";
import { membersQuery } from "../../lib/queries";
import type { ActivityEvent } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { ActionIcon, Journal } from "../plan/Journal";
import { journalSessions, milestoneClass } from "../plan/journal-model";
import { tableTime, useTableClock } from "../table/table-time";
import { EventWords } from "./EventWords";
import { mergeEvents, pendingEvents } from "./model";
export function ActivityPage({ openTask }: { openTask(key: string): void }) {
  const [kind, setKind] = useState("");
  const [epicKey, setEpicKey] = useState(""),
    [member, setMember] = useState("");
  const epics = useQuery(epicsQuery),
    members = useQuery(membersQuery);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState<ActivityEvent[]>([]);
  const [pending, setPending] = useState<ActivityEvent[]>([]);
  const [fresh, setFresh] = useState(new Set<number>());
  useEffect(() => {
    if (!fresh.size) return;
    const timer = setTimeout(() => setFresh(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [fresh]);
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
    const incoming = pendingEvents(batch, 0, kind).filter(
      (e) => !member || e.actor.id === member,
    );
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
    } else {
      setExtra((v) => mergeEvents(v, incoming));
      setFresh(new Set(incoming.map((e) => e.seq)));
    }
  }, [batch, kind, member, loaded, extra]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          query.hasNextPage &&
          !query.isFetching &&
          !query.error
        )
          void query.fetchNextPage({ cancelRefetch: false });
      },
      { root: scroller.current, rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetching, query.error, query.fetchNextPage]);
  const visible = mergeEvents(
    frozen
      ? mergeEvents(
          frozen,
          loaded.filter((e) => e.seq <= (frozen[0]?.seq ?? 0)),
        )
      : loaded,
    extra,
  );
  const groups = journalSessions(
    visible.filter((e) => !member || e.actor.id === member),
  );
  return (
    <main className="feature-page activity-page">
      <PageHeading
        title="Activity"
        note="Project updates, reports and decisions"
      >
        <div className="journal-filters">
          <CustomSelect
            label="Activity epic"
            value={epicKey}
            onChange={setEpicKey}
            options={[
              { value: "", label: "All epics" },
              ...(epics.data ?? []).map((e) => ({
                value: e.key,
                label: `${e.key} · ${e.title}`,
              })),
            ]}
          />
          {!epicKey && (
            <>
              <CustomSelect
                label="Activity member"
                value={member}
                onChange={setMember}
                options={[
                  { value: "", label: "Everyone" },
                  ...(members.data ?? []).map((m) => ({
                    value: m.id,
                    label: m.name,
                  })),
                ]}
              />
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
            </>
          )}
        </div>
      </PageHeading>
      {epicKey ? (
        <Journal key={epicKey} epicKey={epicKey} openTask={openTask} />
      ) : (
        <>
          {pending.length > 0 && (
            <Button
              className="new-events"
              onClick={() => {
                setExtra((v) => mergeEvents(v, pending));
                setPending([]);
                setFrozen(null);
                scroller.current?.scrollTo({
                  top: 0,
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              {pending.length} new {pending.length === 1 ? "update" : "updates"}{" "}
              ↑
            </Button>
          )}
          <div
            className="activity-scroll"
            ref={scroller}
            data-testid="activity-scroll"
          >
            {groups.map((group, index) => (
              <section key={group.events[0]?.seq} className="activity-group">
                {(index === 0 || groups[index - 1]?.day !== group.day) && (
                  <h2 className="activity-hour">{group.day}</h2>
                )}
                <details className="journal-session" open>
                  <summary>
                    <Avatar member={group.actor} size={28} />
                    <b>{group.actor.name}</b>
                    <span>
                      {new Date(group.start).toLocaleTimeString("en", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      –
                      {new Date(group.end).toLocaleTimeString("en", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>
                      {group.events.length}{" "}
                      {group.events.length === 1 ? "update" : "updates"}
                    </span>
                  </summary>
                  {group.events.map((e) => {
                    return (
                      <div key={e.seq}>
                        <button
                          type="button"
                          className={`activity-entry ${milestoneClass(e)} ${fresh.has(e.seq) ? "fresh-event" : ""}`}
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
                          <ActionIcon action={e.action} />
                        </button>
                      </div>
                    );
                  })}
                </details>
              </section>
            ))}
            {!groups.length && !query.isPending && !query.error && (
              <EmptyState
                text={
                  member || kind
                    ? "No matching activity in loaded updates"
                    : "No activity yet"
                }
              />
            )}
            {query.isPending && <PaperSkeleton label="Loading activity" />}
            {query.error && (
              <QueryError
                error={query.error}
                busy={query.isFetching}
                retry={() => {
                  // A failed older page owns its retry; refetching page one
                  // would silently discard the requested cursor.
                  if (query.isFetching) return;
                  if (query.isFetchNextPageError)
                    void query.fetchNextPage({ cancelRefetch: false });
                  else void query.refetch({ cancelRefetch: false });
                }}
              />
            )}
            <div ref={sentinel} className="activity-sentinel">
              {query.isFetchingNextPage ? (
                <span role="status">Loading earlier events…</span>
              ) : query.isFetching && !query.isPending ? (
                <span role="status">Checking activity…</span>
              ) : !query.isPending && !query.error ? (
                query.hasNextPage ? (
                  <Button
                    onClick={() =>
                      void query.fetchNextPage({ cancelRefetch: false })
                    }
                  >
                    Load earlier events
                  </Button>
                ) : (
                  "End of loaded activity"
                )
              ) : null}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
