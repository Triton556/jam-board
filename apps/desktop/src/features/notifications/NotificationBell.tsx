import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent, AppState } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { eventText } from "../../lib/ui-store";
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
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [incoming, setIncoming] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<number>();
  const [incomingCursor, setIncomingCursor] = useState<number>();
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [viewError, setViewError] = useState("");
  const [viewing, setViewing] = useState<number>();
  const [baseline, setBaseline] = useState(() =>
    readBaseline(projectId, memberId),
  );
  const [storageWarning, setStorageWarning] = useState(false);
  const live = useRef(true);
  const epoch = useRef(0);
  const request = useRef(0);
  const viewRequest = useRef(0);
  const openRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  openRef.current = open;
  const refresh = useCallback(
    async (older?: number) => {
      const token = ++request.current;
      const selection = epoch.current;
      const current = () =>
        live.current &&
        selection === epoch.current &&
        token === request.current;
      setPending(true);
      setError("");
      try {
        const page = await loadNotificationPage(projectId, older, current);
        if (!current()) return;
        if (older !== undefined) {
          setRows((old) => notificationEvents([...old, ...page.events]));
          setCursor(page.beforeSeq);
        } else if (openRef.current && rowsRef.current.length) {
          const known = new Set(rowsRef.current.map((e) => e.seq));
          setIncoming(page.events.filter((e) => !known.has(e.seq)));
          setIncomingCursor(page.beforeSeq);
        } else {
          setRows(page.events);
          setCursor(page.beforeSeq);
          setIncoming([]);
        }
        setLoaded(true);
      } catch (cause) {
        if (current() && !(cause instanceof StaleNotificationScopeError))
          setError("Could not load project notifications. Try again.");
      } finally {
        if (current()) setPending(false);
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
        setPending(false);
        setOpen(false);
        setRows([]);
        setIncoming([]);
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
      close();
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
              disabled={pending}
              onClick={() => void refresh()}
            >
              Refresh
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
          {incoming.length > 0 && (
            <Button
              onClick={() => {
                setRows((old) => notificationEvents([...incoming, ...old]));
                setCursor(incomingCursor);
                setIncoming([]);
              }}
            >
              Show {incoming.length} new notifications
            </Button>
          )}
          {pending && <p role="status">Loading notifications…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button onClick={() => void refresh()}>Try again</Button>
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
            <Button disabled={pending} onClick={() => void refresh(cursor)}>
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
