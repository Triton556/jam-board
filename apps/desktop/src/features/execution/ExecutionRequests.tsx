import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Button, Dialog, Stamp } from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { api } from "../../lib/api";
import type { ExecutionRequest, ExecutionState } from "../../lib/execution-api";
import {
  executionQuery,
  executionRequestsQuery,
  invalidateExecution,
} from "../../lib/execution-queries";
import { epicsQuery, storiesQuery } from "../../lib/planning-queries";
import { appQuery, membersQuery } from "../../lib/queries";
import { ExecutionConsequences } from "./ExecutionControls";

function StartRequest({
  request,
  onDecision,
}: {
  request: ExecutionRequest;
  onDecision(request: ExecutionRequest): void;
}) {
  const app = useQuery(appQuery);
  const members = useQuery(membersQuery);
  const state = useQuery({
    ...executionQuery(request.scope),
    enabled: request.status === "pending",
  });
  const epics = useQuery(epicsQuery),
    stories = useQuery(storiesQuery);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<{
    request: ExecutionRequest;
    state: ExecutionState;
    projectName: string;
  } | null>(null);
  const resolve = useMutation({
    mutationFn: api.resolveExecutionRequest,
    onSuccess: (decision) => {
      setConfirmation(null);
      onDecision(decision);
      invalidateExecution(client);
    },
    onError: () => invalidateExecution(client),
  });
  useBlocker({
    shouldBlockFn: () => resolve.isPending,
    enableBeforeUnload: resolve.isPending,
  });
  const stale =
    state.data?.revision !== request.revision ||
    app.data?.jam?.id !== request.projectId;
  const actor = members.data?.find(
    (member) => member.id === request.requestedBy,
  );
  const openScope = () => {
    const epic =
      request.scope.type === "epic"
        ? epics.data?.find((epic) => epic.id === request.scope.id)
        : epics.data?.find(
            (epic) =>
              epic.id ===
              stories.data?.find((story) => story.id === request.scope.id)
                ?.epicId,
          );
    if (epic)
      void navigate({
        to: "/plan/$epicKey",
        params: { epicKey: epic.key },
        search:
          request.scope.type === "story" ? { story: request.scopeKey } : {},
      });
  };
  return (
    <article
      className="execution-request"
      aria-label={`Start request: ${request.scopeKey}`}
    >
      <div className="execution-heading">
        <Stamp>
          {request.status === "pending"
            ? "Permission to start"
            : request.status}
        </Stamp>
        <span className="small muted">{actor?.name ?? "Brain"} requested</span>
      </div>
      <Button
        variant="ghost"
        className="execution-scope-link"
        onClick={openScope}
      >
        {request.scopeKey} · {request.scopeTitle}
      </Button>
      <Markdown>{request.reason}</Markdown>
      {request.status === "pending" && (
        <>
          <p className="small">
            This is a start request for this {request.scope.type}, not a
            clarification question. Answering an ordinary question never starts
            work.
          </p>
          {state.isPending ? (
            <p role="status">Checking current scope…</p>
          ) : state.error ? (
            <QueryError
              error={state.error}
              retry={() => void state.refetch()}
            />
          ) : stale ? (
            <p className="field-error">
              This request is out of date. Review the scope and ask for a fresh
              request.
            </p>
          ) : state.data?.blockedReason ? (
            <p className="field-error">{state.data.blockedReason}</p>
          ) : null}
          <div className="execution-actions">
            <Button
              variant="primary"
              disabled={resolve.isPending || stale || !state.data?.canStart}
              onClick={() => {
                if (state.data) {
                  resolve.reset();
                  setConfirmation({
                    request,
                    state: state.data,
                    projectName: app.data?.jam?.name ?? "Current project",
                  });
                }
              }}
            >
              <Play size={15} /> Review start
            </Button>
            <Button
              disabled={resolve.isPending || stale}
              onClick={() =>
                resolve.mutate({
                  id: request.id,
                  decision: "decline",
                  expectedRevision: request.revision,
                })
              }
            >
              Not now
            </Button>
          </div>
        </>
      )}
      {request.status === "approved" && (
        <p className="small">
          This approval was recorded for the shown scope. Its current execution
          state may have changed since then.
        </p>
      )}
      {request.status === "superseded" && (
        <p className="small">
          A later scope change replaced this request. It cannot authorize work.
        </p>
      )}
      {resolve.error && !confirmation && (
        <p role="alert">{resolve.error.message}</p>
      )}
      {confirmation && (
        <Dialog
          busy={resolve.isPending}
          title={`Approve start of ${confirmation.request.scopeKey}?`}
          onClose={() => {
            if (!resolve.isPending) setConfirmation(null);
          }}
        >
          <div className="execution-confirmation">
            <p className="eyebrow">
              {confirmation.projectName} · {confirmation.request.scope.type}
            </p>
            <h3>
              {confirmation.request.scopeKey} ·{" "}
              {confirmation.request.scopeTitle}
            </h3>
            <ExecutionConsequences state={confirmation.state} />
            {stale && (
              <p role="alert">
                This request or its project changed. Close this confirmation and
                review the latest state.
              </p>
            )}
            {resolve.error && <p role="alert">{resolve.error.message}</p>}
            <div className="dialog-actions">
              <Button
                disabled={resolve.isPending}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={resolve.isPending || stale}
                onClick={() =>
                  resolve.mutate({
                    id: confirmation.request.id,
                    decision: "approve",
                    expectedRevision: confirmation.request.revision,
                  })
                }
              >
                {resolve.isPending
                  ? "Approving…"
                  : `Approve & start ${confirmation.request.scopeKey}`}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </article>
  );
}

export function ExecutionRequests({ status = "open" }: { status?: string }) {
  const requests = useQuery(executionRequestsQuery);
  const heading = useRef<HTMLHeadingElement>(null);
  const [decision, setDecision] = useState<ExecutionRequest | null>(null);
  useEffect(() => {
    if (decision) heading.current?.focus();
  }, [decision]);

  const visible =
    requests.data?.filter((request) =>
      status === "open"
        ? request.status === "pending"
        : status === "answered"
          ? ["approved", "declined"].includes(request.status)
          : request.status === "superseded",
    ) ?? [];
  return (
    <section className="execution-requests" aria-label="Scope start requests">
      <h2 ref={heading} tabIndex={-1}>
        {status === "open"
          ? "Start requests"
          : status === "answered"
            ? "Start decisions"
            : "Superseded start requests"}
      </h2>
      {decision && (
        <p className="execution-feedback" role="status">
          {decision.status === "approved"
            ? `${decision.scopeKey} is started. Permission was recorded; no agent session was launched.`
            : `${decision.scopeKey} was not started. The request was declined; you can decide again later.`}
        </p>
      )}
      {requests.isPending ? (
        <PaperSkeleton label="Loading start requests" />
      ) : requests.error ? (
        <QueryError
          error={requests.error}
          retry={() => void requests.refetch()}
        />
      ) : visible.length ? (
        visible.map((request) => (
          <StartRequest
            key={request.id}
            request={request}
            onDecision={setDecision}
          />
        ))
      ) : (
        <p className="small muted">
          {status === "open"
            ? "No start requests. Ask the connected brain to request a start for an agreed story or epic, or start it directly in Plan."
            : status === "answered"
              ? "No start decisions in this view."
              : "No superseded start requests in this view."}
        </p>
      )}
    </section>
  );
}
