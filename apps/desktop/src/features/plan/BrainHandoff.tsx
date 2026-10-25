import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, SegmentedControl } from "../../components/ui";
import { api } from "../../lib/api";
import {
  brainHandoff,
  type HandoffMode,
  type HandoffProject,
  type HandoffScope,
} from "../../lib/brain-handoff";
import { appQuery } from "../../lib/queries";
import { useBrainDock } from "../brain/brain-store";
import { usePlanningDraft } from "./planning-draft";

type Snapshot = {
  scope: HandoffScope;
  project: HandoffProject;
  title: string;
  projectLabel: string;
};
const emptyRequest: { request: string; mode: HandoffMode } = {
  request: "",
  mode: "setup",
};

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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
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
  const close = () => {
    active.current = null;
    setSnapshot(null);
  };
  const copy = async (prompt: string) => {
    if (!snapshot || active.current !== snapshot || copyLock.current) return;
    const captured = snapshot;
    copyLock.current = true;
    setPending(true);
    try {
      // Clipboard invocation is immediate. A later close cannot cancel it,
      // but its completion must not announce into a different preview.
      await navigator.clipboard.writeText(prompt);
      if (active.current === captured)
        setNotice(
          `Copied for ${captured.projectLabel}. Paste it into your connected brain's chat. Nothing was sent or saved to the board.`,
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
            scope: { ...scope },
            project: {
              id: project.id,
              name: project.name,
              keyPrefix: project.keyPrefix,
            },
            title: scope.key
              ? `Plan ${scope.key} with your brain`
              : "Plan with your brain",
            projectLabel: `${project.name} · ${project.keyPrefix}`,
          });
        }}
      >
        <MessageSquareText size={16} />
        {label}
      </Button>
      {snapshot && (
        <HandoffDialog
          snapshot={snapshot}
          selectedProjectId={app.data?.jam?.id}
          pending={pending}
          notice={notice}
          clearNotice={() => setNotice("")}
          close={close}
          copy={copy}
        />
      )}
    </>
  );
}

function HandoffDialog({
  snapshot,
  selectedProjectId,
  pending,
  notice,
  clearNotice,
  close,
  copy,
}: {
  snapshot: Snapshot;
  selectedProjectId?: string;
  pending: boolean;
  notice: string;
  clearNotice(): void;
  close(): void;
  copy(prompt: string): Promise<void>;
}) {
  const { scope, project } = snapshot;
  const client = useQueryClient();
  const dock = useBrainDock();
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState("");
  const composeLock = useRef(false),
    mounted = useRef(true),
    epoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    let selected = selectedProjectId;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "app") return;
      const next = client.getQueryData<
        Awaited<ReturnType<typeof api.appState>>
      >(["app"])?.jam?.id;
      if (next !== selected) {
        selected = next;
        epoch.current++;
      }
    });
    return () => {
      mounted.current = false;
      epoch.current++;
      unsubscribe();
    };
  }, [client, selectedProjectId]);
  const draft = usePlanningDraft(
    emptyRequest,
    `handoff:${project.id}:${scope.type}:${scope.id ?? project.id}`,
  );
  const prompt = brainHandoff(scope, project, draft.value);
  const openChat = async () => {
    if (composeLock.current || pending || selectedProjectId !== project.id)
      return;
    composeLock.current = true;
    setComposing(true);
    setComposeError("");
    const capturedEpoch = epoch.current;
    const current = () =>
      mounted.current &&
      epoch.current === capturedEpoch &&
      client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
        ?.jam?.id === project.id;
    try {
      if (!current()) return;
      const entity =
        scope.type === "project"
          ? project
          : scope.type === "epic"
            ? (await api.getEpic(scope.key)).epic
            : scope.type === "story"
              ? (await api.getStory(scope.key)).story
              : await api.getTask(scope.key);
      if (!current()) return;
      if (
        scope.type !== "project" &&
        (entity.id !== scope.id ||
          !("jamId" in entity) ||
          entity.jamId !== project.id)
      )
        throw new Error(
          "The scope changed. Close and reopen this preview for the intended scope.",
        );
      const title = "title" in entity ? entity.title : project.name;
      const key = scope.key ?? project.keyPrefix;
      dock.compose({
        text: prompt,
        context: [
          {
            type: "board_ref",
            uri: `jam://${scope.type}/${scope.key ?? project.id}`,
            label: `${key} · ${title}`,
            text: `${scope.type}: ${title}`,
          },
        ],
      });
      close();
    } catch (error) {
      if (current())
        setComposeError(error instanceof Error ? error.message : String(error));
    } finally {
      composeLock.current = false;
      if (mounted.current) setComposing(false);
    }
  };
  const busy = pending || composing;
  const words = prompt.trim().split(/\s+/u).length;
  const bytes = new TextEncoder().encode(prompt).length;
  const edit = (value: typeof emptyRequest) => {
    if (busy) return;
    draft.change(value, false);
    clearNotice();
  };
  return (
    <Dialog title={snapshot.title} onClose={close} className="brain-handoff">
      <div className="handoff-content">
        <p className="handoff-boundary">
          Prepares a message, not an agent launch. Ready means the brief is
          prepared; Start grants scope permission, but does not wake a chat. A
          worker claim records pickup.
        </p>
        <div>
          <p>
            Prepared for <strong>{snapshot.projectLabel}</strong>
            {scope.key ? ` · ${scope.key}` : ""}.
          </p>
          <details className="handoff-identity">
            <summary>Exact target IDs</summary>
            <p>
              Project: <code>{project.id}</code>
            </p>
            {scope.id && (
              <p>
                {scope.type}: <code>{scope.id}</code>
              </p>
            )}
          </details>
        </div>
        {selectedProjectId !== project.id && (
          <p role="status">
            The selected project changed. This preview still targets{" "}
            {snapshot.projectLabel}; close and reopen it to prepare a different
            target.
          </p>
        )}
        <div>
          <SegmentedControl<HandoffMode>
            label="Conversation context"
            value={draft.value.mode}
            onChange={(mode) => edit({ ...draft.value, mode })}
            disabled={busy}
            options={[
              { value: "setup", label: "First / new chat" },
              { value: "continue", label: "Continue in this chat" },
            ]}
          />
          <p className="small muted">
            {draft.value.mode === "setup"
              ? "Includes setup and recovery rules. Use after reconnecting or losing context."
              : "Short reminder for a conversation that already knows the workflow; it still must read the latest board."}{" "}
            Your choice is remembered for this scope, not detected from a
            connection.
          </p>
        </div>
        <label className="field">
          What should change? (optional)
          <textarea
            aria-label="What should change?"
            value={draft.value.request}
            disabled={busy}
            rows={3}
            onChange={(event) =>
              edit({ ...draft.value, request: event.target.value })
            }
          />
          <span className="small muted">
            Local draft, not saved to the board. Kept when you close or switch
            projects in this app session; not after restart.
          </span>
        </label>
        <p className="small">
          Use Inbox for project decisions you want tracked here. Conversation or
          client permission questions may remain in chat.
        </p>
        <label className="field">
          Planning prompt
          <textarea aria-label="Planning prompt" value={prompt} readOnly />
          <span className="small muted">
            {words} words · {bytes} UTF-8 bytes. Text size, not a token or cost
            estimate.
          </span>
        </label>
        {notice && <p role="status">{notice}</p>}
        {composeError && <p role="alert">{composeError}</p>}
        <div className="dialog-actions">
          <Button onClick={close}>Close</Button>
          <Button disabled={busy} onClick={() => void copy(prompt)}>
            <Copy size={16} /> {pending ? "Copying…" : "Copy planning prompt"}
          </Button>
          <Button
            variant="primary"
            disabled={busy || selectedProjectId !== project.id}
            onClick={() => void openChat()}
          >
            <MessageSquareText size={16} />{" "}
            {composing ? "Preparing chat…" : "Open in brain chat"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function WorkflowGuide() {
  return (
    <details className="workflow-guide">
      <summary>How the board and brain work together</summary>
      <p className="workflow-hierarchy">
        <strong>Project</strong> is your separate board. <strong>Epic</strong>{" "}
        is a larger goal. <strong>Story</strong> is a feature or outcome.{" "}
        <strong>Task</strong> is one piece of work with a plan.
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
            Ask the brain to read this epic or story and its references. It can
            record project decisions as questions in Inbox; discussion may stay
            in chat.
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
          <strong>Allow work to begin</strong>
          <span>
            Start a story or epic in Plan, or approve its Start request in
            Inbox. You approve the area of work, not each worker. The brain
            organizes work within it; Start does not launch or wake the agent.
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
