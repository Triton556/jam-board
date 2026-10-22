import { useQuery } from "@tanstack/react-query";
import { Copy, MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { brainHandoff, type HandoffScope } from "../../lib/brain-handoff";
import { appQuery } from "../../lib/queries";

export function BrainHandoff({
  scope,
  label = "Refine with brain",
  disabled = false,
}: {
  scope: HandoffScope;
  label?: string;
  disabled?: boolean;
}) {
  const app = useQuery(appQuery);
  const [snapshot, setSnapshot] = useState<{
    prompt: string;
    title: string;
    projectId: string;
    projectLabel: string;
  } | null>(null);
  const active = useRef(snapshot);
  active.current = snapshot;
  const copyLock = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(
    () => () => {
      active.current = null;
    },
    [],
  );
  const [notice, setNotice] = useState("");
  const close = () => setSnapshot(null);
  const copy = async () => {
    if (!snapshot || copyLock.current) return;
    const captured = snapshot;
    copyLock.current = true;
    setPending(true);
    try {
      await navigator.clipboard.writeText(captured.prompt);
      if (active.current === captured)
        setNotice(
          `Copied for ${captured.projectLabel}. Paste it into your connected brain's chat.`,
        );
    } catch {
      if (active.current === captured)
        setNotice("Clipboard unavailable. Select and copy the prompt below.");
    } finally {
      copyLock.current = false;
      if (active.current) setPending(false);
    }
  };
  return (
    <>
      <Button
        disabled={disabled || !app.data?.jam}
        onClick={() => {
          const project = app.data?.jam;
          if (!project) return;
          setNotice("");
          setPending(copyLock.current);
          setSnapshot({
            prompt: brainHandoff(scope, project),
            title: scope.key
              ? `Plan ${scope.key} with your brain`
              : "Plan with your brain",
            projectId: project.id,
            projectLabel: `${project.name} · ${project.keyPrefix}`,
          });
        }}
      >
        <MessageSquareText size={16} />
        {label}
      </Button>
      {snapshot && (
        <Dialog
          title={snapshot.title}
          onClose={close}
          className="brain-handoff"
        >
          <p>
            Give the brain your rough idea, references or corrections. It can
            ask questions in Inbox and update the plan for your review.
          </p>
          <p className="handoff-boundary">
            This prepares a message, not an agent launch. Planning and Ready do
            not authorize execution; start a story or epic separately.
          </p>
          <p className="small">
            Prepared for {snapshot.projectLabel}. This message stays bound to
            that project.
          </p>
          {app.data?.jam?.id !== snapshot.projectId && (
            <p role="status">
              The selected project changed. This preview still targets{" "}
              {snapshot.projectLabel}; close and reopen it to prepare a
              different target.
            </p>
          )}
          <label className="field">
            Planning prompt
            <textarea
              aria-label="Planning prompt"
              value={snapshot.prompt}
              readOnly
            />
          </label>
          {notice && <p role="status">{notice}</p>}
          <div className="dialog-actions">
            <Button onClick={close}>Close</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => void copy()}
            >
              <Copy size={16} /> {pending ? "Copying…" : "Copy planning prompt"}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function WorkflowGuide() {
  return (
    <details className="workflow-guide">
      <summary>How the board and brain work together</summary>
      <p className="workflow-hierarchy">
        <strong>Project</strong> is your separate board. <strong>Epic</strong>{" "}
        is a larger goal. <strong>Story</strong> is a feature or outcome.{" "}
        <strong>Task</strong> is one executable brief.
      </p>
      <ol>
        <li>
          <strong>Capture</strong>
          <span>
            Add a rough idea, notes and references. A draft does not need all
            the answers.
          </span>
        </li>
        <li>
          <strong>Refine</strong>
          <span>
            Ask the brain to review the scope, read its sources and ask
            questions in Inbox.
          </span>
        </li>
        <li>
          <strong>Check together</strong>
          <span>
            Edit the proposal. Ask the brain to reconcile your changes and make
            the briefs Ready.
          </span>
        </li>
        <li>
          <strong>Start a scope</strong>
          <span>
            Start a story or epic in Plan, or ask the brain in chat and approve
            its Start request in Inbox. Authorize the scope, not each worker.
            The brain organizes execution inside it.
          </span>
        </li>
        <li>
          <strong>Review</strong>
          <span>
            Follow worker status, reports and evidence. Accept the result or
            request another round.
          </span>
        </li>
      </ol>
    </details>
  );
}
