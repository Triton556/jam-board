import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent, AppState } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { ReadReceipt } from "../../components/ui/ReadReceipt";
import { api } from "../../lib/api";
import { eventText } from "../../lib/ui-store";
import { useExplicitRead } from "../../lib/use-explicit-read";
import {
  loadNotificationPage,
  notificationEvents,
  resolveNotificationDestination,
  StaleNotificationScopeError,
} from "./model";
import { markBaseline, readBaseline } from "./read-state";
import "./notifications.css";

export function NotificationBell({
  projectId,
  projectName,
  memberId,
}: {
  projectId: string;
  projectName: string;
  memberId: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const read = useExplicitRead(
    JSON.stringify(["notifications", projectId, memberId, open]),
  );
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [incoming, setIncoming] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<number>();
  const [incomingCursor, setIncomingCursor] = useState<number>();
  const [incomingGap, setIncomingGap] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [latestPending, setLatestPending] = useState(false);
  const [olderPending, setOlderPending] = useState(false);
  const pending = latestPending || olderPending;
  const [error, setError] = useState("");
  const [olderError, setOlderError] = useState("");
  const [viewError, setViewError] = useState("");
  const [viewing, setViewing] = useState<number>();
  const [baseline, setBaseline] = useState(() =>
    readBaseline(projectId, memberId),
  );
  const [storageWarning, setStorageWarning] = useState(false);
  const live = useRef(true);
  const epoch = useRef(0);
  const latestFlight = useRef<{ selection: number; again: boolean } | null>(
    null,
  );
  const olderFlight = useRef<{ selection: number; cursor: number } | null>(
    null,
  );
  const paginationEpoch = useRef(0);
  const viewRequest = useRef(0);
  const openRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  openRef.current = open;
  const refresh = useCallback(async () => {
    const selection = epoch.current;
    if (latestFlight.current?.selection === selection) {
      latestFlight.current.again = true;
      return;
    }
    const flight = { selection, again: false };
    latestFlight.current = flight;
    const current = () =>
      live.current &&
      selection === epoch.current &&
      latestFlight.current === flight;
    setLatestPending(true);
    let failed = false;
    try {
      do {
        flight.again = false;
        failed = false;
        setError("");
        try {
          const page = await loadNotificationPage(
            projectId,
            undefined,
            current,
          );
          if (!current()) return;
          if (openRef.current && rowsRef.current.length) {
            const known = new Set(rowsRef.current.map((e) => e.seq));
            setIncoming(page.events.filter((e) => !known.has(e.seq)));
            setIncomingCursor(page.beforeSeq);
            setIncomingGap(
              page.beforeSeq !== undefined &&
                page.beforeSeq > (rowsRef.current[0]?.seq ?? 0),
            );
          } else {
            setRows(page.events);
            paginationEpoch.current++;
            setCursor(page.beforeSeq);
            setIncoming([]);
            setIncomingGap(false);
          }
          setLoaded(true);
        } catch (cause) {
          failed = true;
          if (current() && !(cause instanceof StaleNotificationScopeError))
            setError("Could not load project notifications. Try again.");
        }
      } while (current() && flight.again);
    } finally {
      if (current()) {
        latestFlight.current = null;
        setLatestPending(false);
      }
    }
    return { isError: failed, error: null };
  }, [projectId]);
  const explicitRefresh = () => {
    // A same-tick background flight already owns the read. Its existing loading
    // status remains truthful; do not queue another explicit request or receipt.
    if (latestFlight.current) return;
    void read.run(
      async () => (await refresh()) ?? { isError: true, error: null },
    );
  };
  const loadOlder = useCallback(
    async (before: number) => {
      const selection = epoch.current;
      // A synchronous guard also catches repeated clicks before React renders pending.
      if (olderFlight.current?.selection === selection) return;
      const flight = { selection, cursor: before };
      olderFlight.current = flight;
      const pageEpoch = paginationEpoch.current;
      const current = () =>
        live.current &&
        selection === epoch.current &&
        olderFlight.current === flight;
      setOlderPending(true);
      setOlderError("");
      try {
        const page = await loadNotificationPage(projectId, before, current);
        if (!current()) return;
        setRows((old) => notificationEvents([...old, ...page.events]));
        // Revealing newer arrivals may rewind pagination to a gap. Do not skip it.
        if (paginationEpoch.current === pageEpoch) setCursor(page.beforeSeq);
      } catch (cause) {
        if (current() && !(cause instanceof StaleNotificationScopeError))
          setOlderError(
            "Could not load older updates. Try loading older updates again.",
          );
      } finally {
        if (current()) {
          olderFlight.current = null;
          setOlderPending(false);
        }
      }
    },
    [projectId],
  );
  useEffect(() => {
    live.current = true;
    let selected = client.getQueryData<AppState>(["app"])?.jam?.id;
    const unsubscribe = client.getQueryCache().subscribe(() => {
      const next = client.getQueryData<AppState>(["app"])?.jam?.id;
      if (next !== selected) {
        selected = next;
        epoch.current++;
        latestFlight.current = null;
        olderFlight.current = null;
        paginationEpoch.current++;
        setLatestPending(false);
        setOlderPending(false);
        setError("");
        setOlderError("");
        setViewError("");
        setViewing(undefined);
        setOpen(false);
        setRows([]);
        setIncoming([]);
        setIncomingGap(false);
        setLoaded(false);
        setCursor(undefined);
        if (next === projectId) void refresh();
      }
    });
    void refresh();
    // Events carry no project identity: invalidate only; never ingest their payloads.
    const stop = api.onBoardChanged(() => void refresh());
    return () => {
      live.current = false;
      epoch.current++;
      unsubscribe();
      stop();
    };
  }, [client, refresh, projectId]);
  const latest = Math.max(0, ...rows.map((e) => e.seq));
  const newCount =
    baseline === null
      ? 0
      : notificationEvents([...rows, ...incoming]).filter(
          (e) => e.seq > baseline,
        ).length;
  const close = () => {
    viewRequest.current++;
    setViewing(undefined);
    setOpen(false);
    setViewError("");
  };
  const view = async (event: ActivityEvent) => {
    if (viewing !== undefined) return;
    const selection = epoch.current;
    const token = ++viewRequest.current;
    const current = () =>
      live.current &&
      epoch.current === selection &&
      token === viewRequest.current;
    setViewing(event.seq);
    setViewError("");
    try {
      const target = await resolveNotificationDestination(
        projectId,
        event,
        current,
      );
      if (!current()) return;
      // Dismiss for navigation without canceling the in-flight error handler.
      setOpen(false);
      if (target.kind === "task")
        await navigate({ to: "/board", search: { task: target.key } });
      else
        await navigate({
          to: "/inbox",
          search: { question: target.id, status: target.status },
        });
    } catch (cause) {
      if (current() && !(cause instanceof StaleNotificationScopeError))
        setViewError(
          cause instanceof Error
            ? cause.message
            : "This destination is unavailable.",
        );
    } finally {
      if (current()) setViewing(undefined);
    }
  };
  return (
    <>
      <button
        type="button"
        className="icon-button notification-bell"
        aria-label={`Project notifications${newCount ? ` · ${newCount} new in recent history` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          viewRequest.current++;
          setViewing(undefined);
          setOpen(true);
          void refresh();
        }}
      >
        <Bell size={18} />
        {newCount > 0 && (
          <span className="notification-count" aria-hidden="true">
            {newCount > 99 ? "99+" : newCount}
          </span>
        )}
      </button>
      {!open && viewError && (
        <div role="alert" className="notification-navigation-error">
          <p>{viewError}</p>
          <Button onClick={() => setOpen(true)}>Reopen notifications</Button>
        </div>
      )}
      {open && (
        <Dialog
          title="Project notifications"
          className="notification-dialog"
          onClose={close}
        >
          <p>
            <strong>{projectName}</strong> · Recent agent updates, including
            while the app was closed.
          </p>
          <p className="muted">
            Only updates with a View destination. File receipts and local errors
            stay in their original notices.
          </p>
          <div className="button-row">
            <Button
              variant="ghost"
              disabled={!latest || pending}
              onClick={() => {
                if (
                  client.getQueryData<AppState>(["app"])?.jam?.id !== projectId
                )
                  return;
                const saved = markBaseline(projectId, memberId, latest);
                setBaseline(latest);
                setStorageWarning(!saved);
              }}
            >
              Mark current updates as read
            </Button>
            <Button
              variant="ghost"
              disabled={read.pending || latestPending}
              aria-busy={read.pending || latestPending}
              onClick={explicitRefresh}
            >
              {read.pending ? "Checking notifications…" : "Refresh"}
            </Button>
          </div>
          <p className="muted">
            Marks displayed updates and all older updates as read. Opening or
            View does not mark them read.{" "}
            {baseline === null
              ? "No read position saved yet."
              : "New means since last marked read."}
          </p>
          {storageWarning && (
            <p role="status">
              Read position could not be saved; it is kept only while this view
              remains open in the app.
            </p>
          )}
          {(incoming.length > 0 || incomingGap) && (
            <Button
              disabled={incoming.length === 0 && olderPending}
              onClick={() => {
                setRows((old) => notificationEvents([...incoming, ...old]));
                paginationEpoch.current++;
                setCursor(incomingCursor);
                setIncoming([]);
                setIncomingGap(false);
                if (incoming.length === 0 && incomingCursor !== undefined)
                  void loadOlder(incomingCursor);
              }}
            >
              {incoming.length
                ? `Show ${incoming.length} new notifications`
                : "Check newer updates"}
            </Button>
          )}
          <ReadReceipt
            checkedAt={read.checkedAt}
            phase={read.phase}
            resource="notifications"
          />
          {latestPending && !read.pending && (
            <p role="status">Loading notifications…</p>
          )}
          {olderPending && <p role="status">Loading older updates…</p>}
          {olderError && <p role="alert">{olderError}</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button
                disabled={read.pending || latestPending}
                onClick={explicitRefresh}
              >
                Try again
              </Button>
            </div>
          )}
          {viewError && <p role="alert">{viewError}</p>}
          {loaded && !rows.length && !pending && (
            <p>
              No matching notifications in the updates loaded so far.
              {cursor ? " Load older updates to keep looking." : ""}
            </p>
          )}
          <ol className="notification-list">
            {rows.map((event) => (
              <li key={event.seq}>
                <div>
                  <p>{eventText(event)}</p>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                  {baseline !== null && event.seq > baseline && (
                    <span className="notification-new">New</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  disabled={viewing !== undefined}
                  onClick={() => void view(event)}
                  aria-label={`View: ${eventText(event)}`}
                >
                  {viewing === event.seq ? "Opening…" : "View"}
                </Button>
              </li>
            ))}
          </ol>
          {cursor !== undefined && (
            <Button
              disabled={olderPending}
              onClick={() => void loadOlder(cursor)}
            >
              Load older updates
            </Button>
          )}
          {loaded && cursor === undefined && rows.length > 0 && (
            <p className="muted">End of available project updates.</p>
          )}
        </Dialog>
      )}
    </>
  );
}
