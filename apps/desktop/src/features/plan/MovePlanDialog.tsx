import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Story, TaskDetail } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import {
  capturePlanContext,
  type PlanContext,
  planMoves,
} from "../../lib/import-plan-api";
import {
  epicsQuery,
  invalidatePlanning,
  storiesQuery,
} from "../../lib/planning-queries";
import "./round12-plan.css";

export const storyMoveBlockedReason =
  "Stories with tasks in progress or review can't move.";
export const taskMoveBlockedReason = "Only tasks in Backlog or Ready can move.";
export type PlanMoveResult = {
  to: string;
  from: string;
  context: PlanContext;
  task?: TaskDetail;
  story?: Story;
};
export function MovePlanDialog({
  target: suppliedTarget,
  close,
  moved,
}: {
  target: { type: "story"; story: Story } | { type: "task"; task: TaskDetail };
  close(): void;
  moved(result: PlanMoveResult): void;
}) {
  const [target] = useState(suppliedTarget);
  const epics = useQuery(epicsQuery),
    stories = useQuery(storiesQuery),
    client = useQueryClient();
  const [context, setContext] = useState<PlanContext>(),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    alive = useRef(true),
    request = useRef<{ to: string; id: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    void capturePlanContext()
      .then((c) => {
        if (alive.current) setContext(c);
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const move = async (to: string) => {
    if (lock.current || !context) return;
    lock.current = true;
    setBusy(true);
    setError("");
    if (request.current?.to !== to)
      request.current = { to, id: crypto.randomUUID() };
    try {
      if (target.type === "story") {
        const from = epics.data?.find((e) => e.id === target.story.epicId)?.key;
        if (!from) throw new Error("Read the current epic before moving.");
        const result = await planMoves.story(context, {
          key: target.story.key,
          toEpicKey: to,
          beforeKey: null,
          afterKey: null,
          expectedUpdatedAt: target.story.updatedAt,
          requestId: request.current.id,
        });
        invalidatePlanning(client);
        if (alive.current) moved({ from, to, context, story: result });
      } else {
        const result = await planMoves.task(context, {
          key: target.task.key,
          toStoryKey: to,
          expectedUpdatedAt: target.task.updatedAt,
          expectedClaimGeneration: target.task.claimGeneration ?? "",
          requestId: request.current.id,
        });
        invalidatePlanning(client);
        if (alive.current)
          moved({ from: target.task.story.key, to, context, task: result });
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Dialog
      title={target.type === "story" ? "Move to epic" : "Move to story"}
      onClose={close}
      busy={busy}
    >
      <div className="move-picker">
        <label>
          Search
          <input
            aria-label={
              target.type === "story" ? "Search epics" : "Search stories"
            }
            value={search}
            disabled={busy}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        {(epics.error || stories.error) && (
          <p role="alert">{(epics.error ?? stories.error)?.message}</p>
        )}
        {busy && (
          <p role="status">Moving… Wait for the result before closing.</p>
        )}
        <div className="move-picker-list">
          {epics.data?.map((epic) => {
            if (target.type === "story")
              return `${epic.key} ${epic.title}`
                .toLowerCase()
                .includes(search.toLowerCase()) ? (
                <Button
                  key={epic.key}
                  disabled={
                    busy ||
                    !context ||
                    epic.id === target.story.epicId ||
                    !!epic.archivedAt
                  }
                  onClick={() => void move(epic.key)}
                >
                  {epic.key} · {epic.title}
                  {epic.id === target.story.epicId ? " · Current epic" : ""}
                </Button>
              ) : null;
            const rows = stories.data?.filter(
              (s) =>
                s.epicId === epic.id &&
                `${s.key} ${s.title} ${epic.title}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            );
            return rows?.length ? (
              <section key={epic.key}>
                <h3>
                  {epic.key} · {epic.title}
                </h3>
                {rows.map((story) => (
                  <Button
                    key={story.key}
                    disabled={
                      busy ||
                      !context ||
                      story.id === target.task.storyId ||
                      !!story.archivedAt ||
                      !!epic.archivedAt
                    }
                    onClick={() => void move(story.key)}
                  >
                    {story.key} · {story.title}
                    {story.id === target.task.storyId ? " · Current story" : ""}
                  </Button>
                ))}
              </section>
            ) : null;
          })}
        </div>
        {epics.isPending || stories.isPending ? (
          <p role="status">Loading destinations…</p>
        ) : !epics.data?.length ? (
          <p>No destinations available.</p>
        ) : null}
        <Button disabled={busy} onClick={close}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

export function StoryMoveNotice({
  notice,
}: {
  notice: PlanMoveResult & { story: Story };
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [undone, setUndone] = useState(false);
  const locked = useRef(false),
    requestId = useRef(crypto.randomUUID()),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const undo = async () => {
    if (locked.current || undone) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await planMoves.story(notice.context, {
        key: notice.story.key,
        toEpicKey: notice.from,
        beforeKey: null,
        afterKey: null,
        expectedUpdatedAt: notice.story.updatedAt,
        requestId: requestId.current,
      });
      invalidatePlanning(client);
      if (alive.current) setUndone(true);
    } catch (error) {
      if (alive.current)
        setError(
          typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "conflict"
            ? "Can't undo: the story changed after the move."
            : `Can't undo: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div>
      <div role="status" className="plan-move-toast">
        {undone ? (
          "Move undone."
        ) : (
          <>
            Moved to {notice.to}
            <Button disabled={busy} onClick={() => void undo()}>
              Undo
            </Button>
            {busy && <span>Undoing…</span>}
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function TaskMoveEntry({
  task,
  disabled = false,
  controlledOpen = false,
  close,
  hideEntry = false,
}: {
  task: TaskDetail;
  disabled?: boolean;
  controlledOpen?: boolean;
  close?(): void;
  hideEntry?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [notice, setNotice] = useState<{
      to: string;
      from: string;
      context: PlanContext;
      task?: TaskDetail;
    }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    undoRequest = useRef(crypto.randomUUID()),
    client = useQueryClient();
  const allowed =
    ["backlog", "ready"].includes(task.status) && !task.archivedAt;
  return (
    <>
      {!hideEntry && (
        <>
          <span title={!allowed ? taskMoveBlockedReason : undefined}>
            <Button
              disabled={disabled || !allowed}
              onClick={() => {
                setOpen(true);
              }}
            >
              Move to story…
            </Button>
          </span>
          {!allowed && <p className="small muted">{taskMoveBlockedReason}</p>}
        </>
      )}
      {(open || controlledOpen) && (
        <MovePlanDialog
          target={{ type: "task", task }}
          close={() => {
            setOpen(false);
            close?.();
          }}
          moved={(result) => {
            undoRequest.current = crypto.randomUUID();
            setNotice(result);
            setError("");
            setOpen(false);
            close?.();
          }}
        />
      )}
      {notice && (
        <div className="plan-move-toast" role="status">
          Moved to {notice.to}
          <Button
            disabled={busy}
            onClick={() => {
              if (lock.current || !notice.task) return;
              lock.current = true;
              setBusy(true);
              setError("");
              void planMoves
                .task(notice.context, {
                  key: notice.task.key,
                  toStoryKey: notice.from,
                  expectedUpdatedAt: notice.task.updatedAt,
                  expectedClaimGeneration: notice.task.claimGeneration ?? "",
                  requestId: undoRequest.current,
                })
                .then(() => {
                  invalidatePlanning(client);
                  setNotice(undefined);
                })
                .catch((e) => setError(String(e)))
                .finally(() => {
                  lock.current = false;
                  setBusy(false);
                });
            }}
          >
            Undo
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
