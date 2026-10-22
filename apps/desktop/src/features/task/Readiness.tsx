import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Readiness } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import {
  JamError,
  labels,
  type MoveInput,
  type Status,
  type TaskDetail,
} from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";

const ReadOnlyBrief = lazy(() =>
  import("./ReadOnlyBrief").then((module) => ({
    default: module.ReadOnlyBrief,
  })),
);
export const readyLabels = {
  goal: "Goal",
  where: "Where",
  change: "Change",
  test: "Test",
  result: "Result",
  story_active: "Story planned",
};
export function ReadinessStrip({
  readiness,
  status,
  onMark,
  pending = false,
}: {
  readiness: Readiness;
  status: string;
  pending?: boolean;
  onMark(): void;
}) {
  return (
    <section className="readiness-strip" aria-label="Brief readiness">
      <div>
        {Object.entries(readyLabels).map(([code, label]) => {
          const missing = readiness.missing.some((i) => i.code === code);
          return (
            <span
              key={code}
              data-readiness={code}
              data-missing={missing}
              title={
                code === "story_active"
                  ? "The story's plan status must be Active. This is not execution permission."
                  : (readiness.missing.find((i) => i.code === code)?.message ??
                    "Complete")
              }
              className={missing ? "muted" : "ok"}
            >
              {missing ? <Minus size={12} /> : <Check size={12} />} {label}
            </span>
          );
        })}
      </div>
      {status === "backlog" && (
        <Button disabled={pending} onClick={onMark}>
          {pending ? "Checking brief…" : "Mark ready"}
        </Button>
      )}
    </section>
  );
}
export function validOverride(reason: string) {
  return reason.trim().length >= 10;
}
export function announceReady(key: string) {
  // The Mark ready trigger can disappear after success. Prefer its stable task
  // drawer, or the Ready destination when the request came from a board move.
  const drawer = Array.from(
    document.querySelectorAll<HTMLElement>(".drawer"),
  ).find(
    (node) =>
      document.getElementById(node.getAttribute("aria-labelledby") ?? "")
        ?.textContent === key,
  );
  (
    drawer ?? document.querySelector<HTMLElement>('[data-column="ready"]')
  )?.focus();
  useUiStore
    .getState()
    .notify(
      `${key} moved to Ready. Scope permission is unchanged; no agent session was launched.`,
    );
}
export function ReadinessDialog() {
  const request = useUiStore((s) => s.readyRequest);
  const [completed, setCompleted] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (!completed) return;
    announceReady(completed.key);
  }, [completed]);
  return request ? (
    <ReadyDialog
      key={`${request.key}:${request.expectedUpdatedAt}`}
      complete={(key) => {
        setCompleted({ key });
        useUiStore.setState({ readyRequest: null });
      }}
    />
  ) : null;
}
type ReadySnapshot = {
  task: TaskDetail;
  readiness: Readiness;
  expectedUpdatedAt: string;
};
async function readReadySnapshot(key: string): Promise<ReadySnapshot> {
  const before = await api.getTask(key);
  const readiness = await api.checkReady(key);
  const after = await api.getTask(key);
  if (
    before.id !== after.id ||
    before.jamId !== after.jamId ||
    before.updatedAt !== after.updatedAt ||
    before.story.updatedAt !== after.story.updatedAt
  )
    throw new JamError(
      "conflict",
      "The task changed while its brief was being read. Check again before deciding.",
    );
  return { task: after, readiness, expectedUpdatedAt: after.updatedAt };
}
function ReadyDialog({ complete }: { complete(key: string): void }) {
  const [requested] = useState(
    () => useUiStore.getState().readyRequest as MoveInput,
  );
  const key = requested.key;
  const liveTask = useQuery({
    queryKey: ["task", key],
    queryFn: () => api.getTask(key),
  });
  const initial = useQuery({
    queryKey: ["readySnapshot", key, requested.expectedUpdatedAt],
    queryFn: () => readReadySnapshot(key),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [snapshot, setSnapshot] = useState<ReadySnapshot | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [reread, setReread] = useState(false);
  const [override, setOverride] = useState(false),
    [reason, setReason] = useState("");
  const reasonInput = useRef<HTMLTextAreaElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (override) reasonInput.current?.focus();
  }, [override]);
  useEffect(() => {
    if (!snapshot && initial.data)
      setSnapshot({
        ...initial.data,
        expectedUpdatedAt: requested.expectedUpdatedAt,
      });
  }, [initial.data, snapshot, requested.expectedUpdatedAt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every intentional reread moves focus to its captured evidence, not only the first one.
  useEffect(() => {
    if (reread) heading.current?.focus();
  }, [reread, snapshot?.expectedUpdatedAt]);
  const client = useQueryClient(),
    navigate = useNavigate();
  const changed =
    conflicted ||
    (!!snapshot &&
      (snapshot.task.updatedAt !== snapshot.expectedUpdatedAt ||
        (!!liveTask.data &&
          liveTask.data.updatedAt !== snapshot.expectedUpdatedAt)));
  const save = useMutation({
    mutationFn: (input: MoveInput) => api.moveTask(input),
    onSuccess: () => {
      invalidatePlanning(client);
      complete(key);
    },
    onError: (error) => {
      if (error instanceof JamError && error.code === "conflict")
        setConflicted(true);
      invalidatePlanning(client);
    },
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const next = await readReadySnapshot(key);
      if (
        snapshot &&
        (next.task.id !== snapshot.task.id ||
          next.task.jamId !== snapshot.task.jamId)
      )
        throw new Error(
          "The project or task changed. This decision was not retargeted.",
        );
      return next;
    },
    onSuccess: (next) => {
      setSnapshot(next);
      setConflicted(false);
      setReread(true);
      save.reset();
      client.setQueryData(["task", key], next.task);
    },
  });
  const close = () => {
    if (!save.isPending) useUiStore.setState({ readyRequest: null });
  };
  const fix = (code: string) => {
    if (save.isPending) return;
    close();
    if (code === "story_active" && snapshot) {
      void navigate({
        to: "/plan/$epicKey",
        params: { epicKey: snapshot.task.epic.key },
        search: { story: snapshot.task.story.key },
      });
      return;
    }
    void navigate({ to: "/board", search: { task: key } });
    setTimeout(
      () =>
        document.querySelector(`[data-brief-field="${code}"]`)?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        }),
      200,
    );
  };
  const cannotSave =
    save.isPending ||
    refresh.isPending ||
    !snapshot ||
    changed ||
    !!snapshot.task.archivedAt ||
    snapshot.task.status === "ready";
  return (
    <Dialog
      title={`${changed ? "Task changed" : snapshot?.readiness.ready ? "Review readiness" : "Not ready"} · ${key}`}
      onClose={close}
      busy={save.isPending}
      className="readiness-dialog"
    >
      <p>Complete the brief so a worker knows what success looks like.</p>
      <p className="small">
        Ready describes the brief. It does not grant execution permission or
        launch an agent session.
      </p>
      {!snapshot && initial.isPending && (
        <p role="status">Checking the saved brief…</p>
      )}
      {!snapshot && initial.error && (
        <div>
          <p role="alert">{initial.error.message}</p>
          <Button
            disabled={initial.isFetching}
            onClick={() => void initial.refetch()}
          >
            Check again
          </Button>
        </div>
      )}
      {changed && (
        <div className="review-context-changed">
          <p role="alert">
            This task changed after the action began. Your reason is kept. Read
            the latest saved brief and status before deciding again; no move was
            applied.
          </p>
          <Button
            disabled={save.isPending || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Reading latest…" : "Read latest task"}
          </Button>
        </div>
      )}
      {snapshot && (
        <>
          <h3 ref={heading} tabIndex={-1}>
            {snapshot.task.key} · {snapshot.task.title}
          </h3>
          <p className="small">
            Captured status:{" "}
            <strong>{labels[snapshot.task.status as Status]}</strong> ·{" "}
            {snapshot.task.assigneeId ? "Assigned" : "Unassigned"}
          </p>
          {reread && !changed && (
            <p role="status">
              Latest task loaded. Your reason is kept; inspect the saved brief
              and status before confirming.
            </p>
          )}
          {snapshot.task.status === "in_progress" && (
            <p className="notice">
              Existing work may still be running. Moving this card does not stop
              a worker or clear its assignment. Use Release claim for a handoff.
            </p>
          )}
          {snapshot.task.status === "ready" && (
            <p className="notice">
              This task is already Ready. No further move is needed.
            </p>
          )}
          {snapshot.task.archivedAt && (
            <p className="notice">
              This task is archived. Restore it before changing its status.
            </p>
          )}
          <details className="ready-snapshot" open={reread}>
            <summary>Saved brief and task notes · captured snapshot</summary>
            <Markdown>{snapshot.task.descriptionMd}</Markdown>
            <Suspense
              fallback={<p role="status">Loading the captured brief…</p>}
            >
              <ReadOnlyBrief
                task={snapshot.task}
                members={[]}
                includeHistory={false}
              />
            </Suspense>
          </details>
          <ul className="readiness-issues">
            {snapshot.readiness.missing.map((issue) => (
              <li key={issue.code}>
                <span>{issue.message}</span>
                <Button
                  disabled={save.isPending}
                  aria-label={`Fix ${readyLabels[issue.code as keyof typeof readyLabels] ?? issue.code}`}
                  onClick={() => fix(issue.code)}
                >
                  Fix
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {override && (
        <label className="field">
          Reason
          <textarea
            aria-label="Override reason"
            ref={reasonInput}
            disabled={save.isPending}
            maxLength={4000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this brief ready despite the missing details?"
          />
          <small>
            Use at least 10 characters. This reason stays in the journal.
          </small>
        </label>
      )}
      {refresh.error && (
        <p role="alert">{refresh.error.message} Your reason is kept.</p>
      )}
      {save.error && (
        <p role="alert">
          {save.error.message} Your reason is kept;{" "}
          {changed
            ? "read the latest task before deciding again."
            : "retry or return to the task."}
        </p>
      )}
      <div className="dialog-actions">
        <Button disabled={save.isPending} onClick={close}>
          Keep in{" "}
          {snapshot ? labels[snapshot.task.status as Status] : "current status"}
        </Button>
        {override || snapshot?.readiness.ready ? (
          <Button
            variant="primary"
            disabled={
              cannotSave ||
              (!snapshot?.readiness.ready && !validOverride(reason))
            }
            onClick={() => {
              if (!snapshot || cannotSave) return;
              save.mutate({
                ...requested,
                expectedUpdatedAt: snapshot.expectedUpdatedAt,
                status: "ready",
                overrideReason: snapshot.readiness.ready
                  ? undefined
                  : reason.trim(),
              });
            }}
          >
            {save.isPending
              ? "Moving to Ready…"
              : snapshot?.readiness.ready
                ? "Mark ready"
                : "Mark ready anyway"}
          </Button>
        ) : (
          <Button disabled={cannotSave} onClick={() => setOverride(true)}>
            Mark ready anyway…
          </Button>
        )}
      </div>
    </Dialog>
  );
}
