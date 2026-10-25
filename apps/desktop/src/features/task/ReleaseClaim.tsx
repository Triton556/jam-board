import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { CornerUpLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { appQuery, membersQuery } from "../../lib/queries";
import type { TaskDetail } from "../../lib/types";

type Confirmation = { task: TaskDetail; projectName: string; holder: string };
export const claimRecoveryExplanation =
  "Need to give this work back? Returning it to Backlog does not stop a worker process.";
export function ReleaseClaim({
  task,
  hasUnsavedEdits = false,
  compact = false,
}: {
  task: TaskDetail;
  hasUnsavedEdits?: boolean;
  compact?: boolean;
}) {
  const app = useQuery(appQuery),
    members = useQuery(membersQuery);
  const client = useQueryClient(),
    navigate = useNavigate();
  const writes = useIsMutating();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [receipt, setReceipt] = useState("");
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (receipt) section.current?.focus();
  }, [receipt]);
  const release = useMutation({
    mutationFn: api.releaseTask,
    onSuccess: (result) => {
      setConfirmation(null);
      setReceipt(
        `${result.key} returned to Backlog and has no assignee. Evidence was kept. No worker process was stopped; scope permission is unchanged.`,
      );
      invalidatePlanning(client);
    },
    onError: () => invalidatePlanning(client),
  });
  useBlocker({
    shouldBlockFn: () => release.isPending,
    enableBeforeUnload: release.isPending,
  });
  const eligible = task.status === "in_progress";
  const changed =
    !!confirmation &&
    (task.updatedAt !== confirmation.task.updatedAt ||
      app.data?.jam?.id !== confirmation.task.jamId);
  const holder = members.data?.find((member) => member.id === task.assigneeId);
  const confirmationHolder = members.data?.find(
    (member) => member.id === confirmation?.task.assigneeId,
  );
  if (!eligible && !receipt && !confirmation) return null;
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="claim-recovery"
      aria-label="Claim recovery"
    >
      {eligible && (
        <div className="claim-recovery-row">
          {!compact && (
            <span className="claim-recovery-hint small muted">
              {claimRecoveryExplanation}
            </span>
          )}
          <Button
            disabled={writes > 0 || hasUnsavedEdits}
            onClick={() => {
              release.reset();
              setReceipt("");
              setConfirmation({
                task,
                projectName: app.data?.jam?.name ?? "Current project",
                holder:
                  holder?.name ??
                  (task.assigneeId ? "Assigned teammate" : "No assignee"),
              });
            }}
          >
            <CornerUpLeft size={15} />
            {task.assigneeId ? "Release claim…" : "Return to Backlog…"}
          </Button>
        </div>
      )}
      {hasUnsavedEdits && eligible && (
        <p className="small muted">
          Save or discard your edits before returning this task.
        </p>
      )}
      {receipt && (
        <p role="status" className="execution-feedback">
          {receipt}
        </p>
      )}
      {confirmation && (
        <Dialog
          title={`Return ${confirmation.task.key} to Backlog?`}
          busy={release.isPending}
          onClose={() => {
            if (!release.isPending) setConfirmation(null);
          }}
        >
          <div className="execution-confirmation">
            <p className="eyebrow">
              {confirmation.projectName} · {confirmation.holder}
            </p>
            <h3>
              {confirmation.task.key} · {confirmation.task.title}
            </h3>
            <p>
              This clears the assignment and returns the task to Backlog. Notes,
              reports, review rounds and archive flags are kept.
            </p>
            <p>
              <strong>
                This does not stop an agent session or worker process.
              </strong>{" "}
              {confirmation.task.assigneeId
                ? "Coordinate with the worker first. While unassigned, a report from the former worker is rejected. Before reporting later, the worker must re-check its current claim and brief."
                : "No assignee is recorded. This changes board tracking only; any external work must be coordinated separately."}
            </p>
            <p className="small">
              Scope permission is unchanged. Pause the story or epic separately
              if you want to prevent new claims.
            </p>
            {confirmationHolder?.statusText && (
              <div className="claim-worker-status">
                <strong className="small">
                  Latest agent update · {confirmationHolder.name}
                </strong>
                <p>{confirmationHolder.statusText}</p>
                <small>
                  This is the agent's latest status, not proof it has stopped
                  this task.
                </small>
                <Button
                  variant="ghost"
                  disabled={release.isPending}
                  onClick={() => {
                    setConfirmation(null);
                    void navigate({ to: "/team" });
                  }}
                >
                  View team status
                </Button>
              </div>
            )}
            {confirmation.task.archivedAt && (
              <p className="small">
                This task stays archived. Returning it does not restore
                visibility or restart work.
              </p>
            )}
            {changed && (
              <p role="alert">
                The task or selected project changed. Close this confirmation
                and inspect the latest state before trying again.
              </p>
            )}
            {release.error && (
              <p role="alert">
                {release.error.message} The latest task state is being
                refreshed.
              </p>
            )}
            <div className="dialog-actions">
              <Button
                disabled={release.isPending}
                onClick={() => setConfirmation(null)}
              >
                Keep current task
              </Button>
              <Button
                variant="primary"
                disabled={release.isPending || changed || writes > 0}
                onClick={() =>
                  release.mutate({
                    key: confirmation.task.key,
                    expectedUpdatedAt: confirmation.task.updatedAt,
                  })
                }
              >
                {release.isPending ? "Returning…" : "Return to Backlog"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
