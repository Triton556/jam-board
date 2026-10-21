import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  FileText,
  Flag,
  HelpCircle,
  ListTree,
  MessageSquare,
  Paperclip,
  Radio,
  Wrench,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  EmptyState,
  SegmentedControl,
} from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { api } from "../../lib/api";
import { epicsQuery } from "../../lib/planning-queries";
import { membersQuery } from "../../lib/queries";
import type { ActivityEvent } from "../../lib/types";
import { eventText, useUiStore } from "../../lib/ui-store";
import {
  journalSessions,
  journalWithProjectPrelude,
  milestoneClass,
} from "./journal-model";

const time = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function ActionIcon({ action }: { action: string }) {
  const Icon =
    action.startsWith("epic") || action.startsWith("story")
      ? ListTree
      : action.startsWith("question")
        ? HelpCircle
        : action.startsWith("review")
          ? ClipboardCheck
          : action.startsWith("report")
            ? FileText
            : action.startsWith("reference")
              ? Paperclip
              : action === "agent.status"
                ? Radio
                : action.includes("ready")
                  ? Flag
                  : action.startsWith("comment")
                    ? MessageSquare
                    : Wrench;
  return <Icon size={17} />;
}
export function Journal({
  epicKey,
  openTask,
}: {
  epicKey?: string;
  openTask(key: string): void;
}) {
  const [kind, setKind] = useState(""),
    [member, setMember] = useState("");
  const members = useQuery(membersQuery);
  const epics = useQuery(epicsQuery);
  const epicId = epics.data?.find((e) => e.key === epicKey)?.id;
  const query = useQuery({
    queryKey: ["journal", epicKey ?? "all"],
    queryFn: async () => {
      if (!epicKey) return api.listChangesSince(0);
      const [scoped, project] = await Promise.all([
        api.epicJournal(epicKey),
        api.listChangesSince(0),
      ]);
      return journalWithProjectPrelude(scoped, project);
    },
  });
  const scroll = useRef<HTMLDivElement>(null);
  const batch = useUiStore((s) => s.boardEvents);
  const processed = useRef(batch);
  const [frozen, setFrozen] = useState<ActivityEvent[] | null>(null),
    [pending, setPending] = useState(0),
    [fresh, setFresh] = useState(new Set<number>());
  useLayoutEffect(() => {
    if (processed.current === batch) return;
    processed.current = batch;
    const incoming = batch.filter(
      (e) =>
        (!epicKey || e.epicId === epicId) &&
        (!kind || e.actor.kind === kind) &&
        (!member || e.actor.id === member),
    );
    if (!incoming.length) return;
    if ((scroll.current?.scrollTop ?? 0) > 80) {
      const ids = new Set(incoming.map((e) => e.seq));
      setFrozen((v) => v ?? (query.data ?? []).filter((e) => !ids.has(e.seq)));
      setPending((n) => n + incoming.length);
    } else setFresh(new Set(incoming.map((e) => e.seq)));
  }, [batch, query.data, epicId, epicKey, kind, member]);
  useEffect(() => {
    if (!fresh.size) return;
    const timer = setTimeout(() => setFresh(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [fresh]);
  const rows = (frozen ?? query.data ?? []).filter(
    (e) =>
      (!kind || e.actor.kind === kind) && (!member || e.actor.id === member),
  );
  const sessions = journalSessions(rows);
  const days = [...new Set(sessions.map((s) => s.day))];
  return (
    <div className="journal">
      <div className="journal-filters">
        <SegmentedControl
          label="Journal actors"
          value={kind}
          onChange={setKind}
          options={[
            { value: "", label: "All" },
            { value: "human", label: "Humans" },
            { value: "agent", label: "Agents" },
          ]}
        />
        <CustomSelect
          label="Journal member"
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
      </div>
      {pending > 0 && (
        <Button
          className="new-events"
          onClick={() => {
            setFrozen(null);
            setPending(0);
            scroll.current?.scrollTo({ top: 0 });
          }}
        >
          {pending} new steps ↑
        </Button>
      )}
      <div className="journal-scroll" ref={scroll} data-testid="journal-scroll">
        {query.isPending ? (
          <PaperSkeleton label="Loading journal" />
        ) : query.error ? (
          <QueryError error={query.error} retry={() => void query.refetch()} />
        ) : !rows.length ? (
          <EmptyState text="Every small step will find a place here">
            <Button onClick={() => void query.refetch()}>Refresh</Button>
          </EmptyState>
        ) : (
          days.map((day) => (
            <section key={day}>
              <h3 className="journal-day">
                {day === new Date().toDateString() ? "Today" : day}
              </h3>
              {sessions
                .filter((s) => s.day === day)
                .map((s) => (
                  <details
                    className="journal-session"
                    key={s.events[0]?.seq}
                    open={s.events.some((e) => milestoneClass(e))}
                  >
                    <summary>
                      <Avatar member={s.actor} size={28} />
                      <strong>{s.actor.name}</strong>
                      <span>
                        {time.format(new Date(s.start))}–
                        {time.format(new Date(s.end))}
                      </span>
                      <span>
                        {s.events.length}{" "}
                        {s.events.length === 1 ? "step" : "steps"}
                      </span>
                    </summary>
                    {s.events.map((e) => (
                      <button
                        type="button"
                        key={e.seq}
                        className={`journal-entry ${milestoneClass(e)} ${fresh.has(e.seq) ? "fresh-event" : ""}`}
                        data-seq={e.seq}
                        onClick={() => e.taskKey && openTask(e.taskKey)}
                      >
                        <ActionIcon action={e.action} />
                        <span>
                          {epicKey && e.epicId == null && (
                            <small>Project prelude · </small>
                          )}
                          {eventText(e)}
                        </span>
                        <small>{time.format(new Date(e.createdAt))}</small>
                      </button>
                    ))}
                  </details>
                ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
