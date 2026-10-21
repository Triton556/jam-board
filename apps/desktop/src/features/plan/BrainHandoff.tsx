import { useQuery } from "@tanstack/react-query";
import { Copy, MessageSquareText } from "lucide-react";
import { useState } from "react";
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
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const prompt = brainHandoff(scope, app.data?.jam?.keyPrefix);
  const title = scope.key
    ? `Plan ${scope.key} with your brain`
    : "Plan with your brain";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("Copied. Paste it into your connected brain's chat.");
    } catch {
      setNotice("Clipboard unavailable. Select and copy the prompt below.");
    }
  };
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          setNotice("");
          setOpen(true);
        }}
      >
        <MessageSquareText size={16} />
        {label}
      </Button>
      {open && (
        <Dialog
          title={title}
          onClose={() => setOpen(false)}
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
          <label className="field">
            Planning prompt
            <textarea aria-label="Planning prompt" value={prompt} readOnly />
          </label>
          {notice && <p role="status">{notice}</p>}
          <div className="dialog-actions">
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" onClick={() => void copy()}>
              <Copy size={16} /> Copy planning prompt
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
