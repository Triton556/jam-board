import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Stamp } from "../../components/ui";
import { api } from "../../lib/api";
import type { ExecutionScope, ExecutionState } from "../../lib/execution-api";
import {
  executionQuery,
  invalidateExecution,
} from "../../lib/execution-queries";
import { appQuery } from "../../lib/queries";

export function ExecutionConsequences({ state }: { state: ExecutionState }) {
  return (
    <>
      <p>
        The brain may take Ready tasks and organize workers inside this{" "}
        {state.scope.type}. It may not start work outside it.
      </p>
      <p>
        Drafts still need details; workers take Ready tasks in active stories.
        Starting records permission on the board—it does not launch an agent
        session or program on this computer.
      </p>
      <p className="small muted">
        {state.readyCount} Ready · {state.inProgressCount} already In progress
        (including archived tasks). Uses saved board state; save and reconcile
        any edits before starting.
      </p>
      {state.scope.type === "epic" && (
        <p className="small">
          Stories you paused separately stay paused. Pause the epic to block new
          work in all its stories.
        </p>
      )}
    </>
  );
}

export function ExecutionControls({ scope }: { scope: ExecutionScope }) {
  const query = useQuery(executionQuery(scope));
  const app = useQuery(appQuery);
  const client = useQueryClient();
  const pendingWrites = useIsMutating();
  const [confirmation, setConfirmation] = useState<{
    state: ExecutionState;
    projectName: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (notice) section.current?.focus();
  }, [notice]);
  const change = useMutation({
    mutationFn: api.setExecution,
    onSuccess: (state, input) => {
      client.setQueryData(executionQuery(state.scope).queryKey, state);
      invalidateExecution(client);
      setConfirmation(null);
      setNotice(
        input.action === "start"
          ? `${state.scopeKey} is started. A connected brain may now organize its Ready work.`
          : `${state.scopeKey} is paused for new work. Running tasks can still report.`,
      );
    },
    onError: () => invalidateExecution(client),
  });
  useBlocker({
    shouldBlockFn: () => change.isPending,
    enableBeforeUnload: change.isPending,
  });
  const state = query.data;
  const changed =
    !!confirmation &&
    (state?.revision !== confirmation.state.revision ||
      app.data?.jam?.id !== confirmation.state.projectId);
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="execution-controls"
      aria-label={`${scope.type === "epic" ? "Epic" : "Story"} execution`}
      data-state={state?.effectiveState ?? "loading"}
    >
      {query.isPending ? (
        <p role="status">Checking work permission…</p>
      ) : query.error ? (
        <p role="alert">
          Could not check work permission.{" "}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </p>
      ) : (
        state && (
          <>
            <div className="execution-heading">
              <span className="small muted">Worker permission</span>
              <Stamp
                className={
                  state.effectiveState === "running"
                    ? "execution-running"
                    : "execution-paused"
                }
              >
                {state.effectiveState === "running"
                  ? "New work allowed"
                  : "New work paused"}
              </Stamp>
              <span className="small muted">
                {state.readyCount} Ready · {state.inProgressCount} In progress
              </span>
            </div>
            {state.source === "epic" && (
              <p className="small">
                {state.effectiveState === "running"
                  ? "Started by the parent epic. You can pause this story separately."
                  : "Follows the paused parent epic. Start this story to work only on it."}
              </p>
            )}
            {state.scope.type === "story" && state.ownState === "paused" && (
              <p className="small">
                Paused separately. Starting the parent epic will not resume this
                story.
              </p>
            )}
            {state.scope.type === "epic" &&
              state.effectiveState === "paused" &&
              state.runningStoryCount > 0 && (
                <p className="execution-partial">
                  {state.runningStoryCount}{" "}
                  {state.runningStoryCount === 1 ? "story is" : "stories are"}{" "}
                  separately started. Pause all new work to stop further claims
                  there too.
                </p>
              )}
            {state.blockedReason && (
              <p className="small muted">{state.blockedReason}</p>
            )}
            <div className="execution-actions">
              {state.effectiveState === "paused" && (
                <Button
                  variant="primary"
                  disabled={!state.canStart || pendingWrites > 0}
                  onClick={() => {
                    change.reset();
                    setNotice("");
                    setConfirmation({
                      state,
                      projectName: app.data?.jam?.name ?? "Current project",
                    });
                  }}
                >
                  <Play size={15} /> Start {scope.type}
                </Button>
              )}
              {(state.effectiveState === "running" ||
                state.runningStoryCount > 0) && (
                <Button
                  disabled={pendingWrites > 0}
                  onClick={() => {
                    setNotice("");
                    change.mutate({
                      scope: state.scope,
                      action: "pause",
                      expectedRevision: state.revision,
                    });
                  }}
                >
                  <Pause size={15} />{" "}
                  {scope.type === "epic"
                    ? "Pause all new work"
                    : "Pause new work"}
                </Button>
              )}
              {state.effectiveState === "paused" && state.canStart && (
                <span className="small muted">
                  Start lets agents take Ready tasks; it does not launch them.
                </span>
              )}
              {pendingWrites > 0 && (
                <span className="small" role="status">
                  Saving changes…
                </span>
              )}
            </div>
            <details className="execution-help">
              <summary>How starting works</summary>
              <ul className="execution-help-points small">
                <li>
                  <strong>Ready</strong> describes the task plan. It is not
                  permission to begin.
                </li>
                <li>
                  <strong>Start</strong> allows connected agents to take Ready
                  tasks in this epic or story. It does not launch a program or
                  wake a chat.
                </li>
                <li>
                  <strong>Pause</strong> blocks new tasks from being taken. Work
                  already taken may continue and submit reports.
                </li>
                <li>
                  Opening another project does not pause any work. In progress
                  counts include archived tasks.
                </li>
              </ul>
            </details>
          </>
        )
      )}
      {notice && (
        <p className="execution-feedback" role="status">
          {notice}
        </p>
      )}
      {change.error && !confirmation && (
        <p role="alert">{change.error.message}</p>
      )}
      {confirmation && (
        <Dialog
          title={`Start ${confirmation.state.scopeKey}?`}
          busy={change.isPending}
          onClose={() => {
            if (!change.isPending) setConfirmation(null);
          }}
        >
          <div className="execution-confirmation">
            <p className="eyebrow">
              {confirmation.projectName} · {confirmation.state.scope.type}
            </p>
            <h3>
              {confirmation.state.scopeKey} · {confirmation.state.scopeTitle}
            </h3>
            <ExecutionConsequences state={confirmation.state} />
            {changed && (
              <p role="alert" className="field-error">
                The project or execution state changed after this confirmation
                opened. Close it and review the latest state before starting.
              </p>
            )}
            {change.error && (
              <p role="alert" className="field-error">
                {change.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                disabled={change.isPending}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={change.isPending || changed || pendingWrites > 0}
                onClick={() =>
                  change.mutate({
                    scope: confirmation.state.scope,
                    action: "start",
                    expectedRevision: confirmation.state.revision,
                  })
                }
              >
                <Play size={16} />{" "}
                {change.isPending
                  ? "Starting…"
                  : `Start ${confirmation.state.scopeKey}`}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
