import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  MoveProject,
  MoveReceipt,
  ProjectMovePreview,
} from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import {
  type FolderGuard,
  folderError,
  folderPolicy,
  projectFolders,
  useFolderGuard,
} from "../../lib/project-folder-api";
import { FolderPolicy } from "./ProjectFolderDialog";
import "./project-folders.css";

const moveLabels = [
  "Preparing",
  "Copying files",
  "Checking",
  "Switching over",
  "Done",
] as const;
const key = (id: string) => `jamboard:folder-move:${id}`;
const childName = (name: string) =>
  name.replace(/[<>:"/\\|?*]/g, "_").replace(/[ .]+$/, "") || "JamBoard";
const destinationIn = (parent: string, child: string) =>
  `${parent.replace(/[\\/]+$/, "")}/${child}`;
const validFolderName = (name: string) =>
  !!name.trim() &&
  !/[<>:"/\\|?*]/.test(name) &&
  !/[ .]$/.test(name) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
export function MoveToFolder({
  projectId,
  name,
  taskCount,
  onClose,
  onMoved,
}: {
  projectId: string;
  name: string;
  taskCount?: number;
  onClose(): void;
  onMoved?(): void | Promise<void>;
}) {
  const [input, setInput] = useState<MoveProject | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key(projectId)) ?? "null");
    } catch {
      return null;
    }
  });
  const [receipt, setReceipt] = useState<MoveReceipt | null>(null);
  const [ack, setAck] = useState(input?.cloudAcknowledged ?? false);
  const [busy, setBusy] = useState(false);
  const [pollRequestId, setPollRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ProjectMovePreview | null>(null);
  const [parent, setParent] = useState(
    () => input?.destination.replace(/[\\/][^\\/]*$/, "") ?? "",
  );
  const [child, setChild] = useState(
    () => input?.destination.split(/[\\/]/).at(-1) ?? childName(name),
  );
  const [missingReceipt, setMissingReceipt] = useState(false);
  const retained = !!localStorage.getItem(key(projectId));
  const validChild = validFolderName(child);
  const capture = useFolderGuard();
  useEffect(() => {
    if (!input || !validChild) return;
    let active = true;
    void (async () => {
      const check = await capture();
      const result = await projectFolders.preview(projectId, input.destination);
      await check();
      if (active) setPreview(result);
    })().catch((error) => {
      if (active) setError(folderError(error));
    });
    return () => {
      active = false;
    };
  }, [input, projectId, capture, validChild]);
  useEffect(() => {
    if (!busy || !pollRequestId) return;
    let active = true;
    let guard: FolderGuard | null = null;
    void capture()
      .then((check) => {
        if (active) guard = check;
      })
      .catch((error) => {
        if (active) setError(folderError(error));
      });
    const timer = window.setInterval(() => {
      const check = guard;
      if (!check) return;
      void projectFolders
        .status(pollRequestId)
        .then(async (result) => {
          await check();
          if (active) setReceipt(result);
        })
        .catch((error) => {
          if (active && /stale|Project changed/i.test(String(error)))
            setError(folderError(error));
          /* A receipt may not exist until preparation finishes. */
        });
    }, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [busy, pollRequestId, capture]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(folderError(error));
    } finally {
      setBusy(false);
      setPollRequestId(null);
    }
  };
  const choose = () =>
    run(async () => {
      const check = await capture();
      const folder = await api.pickFolder();
      await check();
      if (folder) {
        setParent(folder);
        setInput({
          projectId,
          destination: destinationIn(folder, child),
          requestId: crypto.randomUUID(),
          cloudAcknowledged: false,
        });
        setReceipt(null);
        setAck(false);
        setPreview(null);
      }
    });
  const move = () =>
    run(async () => {
      if (!input) return;
      const check = await capture();
      const submitted = {
        ...input,
        cloudAcknowledged: ack,
      };
      if (
        !validChild ||
        !preview ||
        preview.hasBoundOwners ||
        (!preview.destinationPolicy.allowed && !receipt)
      )
        throw new Error("Review the move summary before continuing.");
      localStorage.setItem(key(projectId), JSON.stringify(submitted));
      setPollRequestId(submitted.requestId);
      await check();
      if (!check.context) throw new Error("Project changed — reopen");
      const result = await projectFolders.move(submitted, check.context);
      if (result.state === "committed") {
        const selected = await projectFolders.info();
        if (selected.projectId !== input.projectId)
          throw new Error("Stale selection epoch");
        await check(selected.context);
      } else await check();
      setReceipt(result);
      if (result.state === "committed") {
        localStorage.removeItem(key(projectId));
        await onMoved?.();
      }
    });
  const status = (rollback = false) =>
    run(async () => {
      if (!input) return;
      const check = await capture();
      let result: MoveReceipt;
      try {
        result = await (rollback
          ? projectFolders.rollback(input.requestId)
          : projectFolders.status(input.requestId));
      } catch (error) {
        if (
          !rollback &&
          /receipt not found|query returned no rows|not_found/i.test(
            String(error),
          )
        )
          setMissingReceipt(true);
        throw error;
      }
      await check();
      setReceipt(result);
      if (result.state === "rolled_back") {
        localStorage.removeItem(key(projectId));
        setInput(null);
      }
    });
  useEffect(() => {
    const saved = localStorage.getItem(key(projectId));
    if (!saved) return;
    let active = true;
    void (async () => {
      const check = await capture();
      const request: MoveProject = JSON.parse(saved);
      const result = await projectFolders.status(request.requestId);
      await check();
      if (active) setReceipt(result);
    })().catch((error) => {
      if (!active) return;
      if (
        /receipt not found|query returned no rows|not_found/i.test(
          String(error),
        )
      )
        setMissingReceipt(true);
      setError(folderError(error));
    });
    return () => {
      active = false;
    };
  }, [projectId, capture]);
  const policy = folderPolicy(input?.destination ?? "");
  const complete =
    receipt?.state === "committed" || receipt?.state === "rolled_back";
  const moving = busy && !!pollRequestId;
  return (
    <Dialog title="Move to folder" busy={busy} onClose={onClose}>
      <div className="project-folder-form">
        <p className="folder-project-subtitle">{name}</p>
        {!receipt && (
          <>
            <p>Choose where to create the new project folder.</p>
            <Button disabled={busy || retained} onClick={() => void choose()}>
              Choose destination…
            </Button>
            <label>
              New folder name
              <input
                value={child}
                disabled={busy || retained}
                onChange={(event) => {
                  const value = event.target.value;
                  setChild(value);
                  setPreview(null);
                  if (parent)
                    setInput({
                      projectId,
                      destination: destinationIn(parent, value),
                      requestId: crypto.randomUUID(),
                      cloudAcknowledged: false,
                    });
                }}
              />
            </label>
            {!validChild && (
              <p role="alert">
                Use a valid folder name without slashes or reserved characters.
              </p>
            )}
            {retained && (
              <p>A previous move is saved. You can resume or roll back.</p>
            )}
          </>
        )}
        {input && (
          <p className="folder-path" title={input.destination}>
            Destination: {input.destination}
          </p>
        )}
        {preview && (
          <section className="folder-move-summary" aria-label="Move summary">
            <p>
              {[
                preview.tasks.count ? `${preview.tasks.count} tasks` : "",
                preview.managedCopies.count
                  ? preview.managedCopies.count +
                    " files copied (" +
                    humanBytes(preview.managedCopies.bytes) +
                    ")"
                  : "",
                preview.linkedFiles.count
                  ? `${preview.linkedFiles.count} files stay linked`
                  : "",
                preview.missingFileCount
                  ? `${preview.missingFileCount} missing`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ") || "No files to copy."}
            </p>
            {preview.hasBoundOwners && (
              <div role="alert">
                <p>Disconnect these before moving:</p>
                <ul>
                  {preview.agentSessionBound && (
                    <li>Agent sessions — disconnect in Agents</li>
                  )}
                  {!preview.agentSessionBound && (
                    <li>
                      External MCP connections — disconnect in your client
                    </li>
                  )}
                </ul>
              </div>
            )}
            {!receipt && !preview.destinationPolicy.allowed && (
              <p role="alert">
                {preview.destinationPolicy.nonEmpty
                  ? "This folder is not empty. Choose a new folder name."
                  : "Choose a new folder name that does not exist yet."}
              </p>
            )}
          </section>
        )}
        {!receipt && (
          <FolderPolicy
            path={input?.destination ?? ""}
            cloudDetected={
              preview?.destinationPolicy.cloudAcknowledgementNeeded
            }
            acknowledged={ack}
            onAcknowledge={setAck}
          />
        )}
        {(input || receipt) && (
          <ol className="folder-progress" aria-label="Move progress">
            {moveLabels.map((label, index) => (
              <li
                key={label}
                aria-current={
                  (receipt ? moveStep(receipt.state) : 0) === index
                    ? "step"
                    : undefined
                }
              >
                <span className="folder-step-content">
                  {(receipt ? moveStep(receipt.state) : 0) > index ? (
                    <span
                      className="folder-step-marker completed"
                      role="img"
                      aria-label="Completed"
                    >
                      {"\u2713"}
                    </span>
                  ) : (
                    <span className="folder-step-marker" aria-hidden="true" />
                  )}
                  <span className="folder-step-label">{label}</span>
                </span>
                {index < 4 && (
                  <span className="folder-step-connector" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
        )}
        {(moving || receipt) && (
          <div role="status">
            <strong>
              {receipt?.state === "committed"
                ? "Move complete"
                : receipt?.state === "rolled_back"
                  ? "Move rolled back. Your board is unchanged."
                  : moving
                    ? `${stepName(receipt?.state ?? "preparing")}\u2026`
                    : `Move interrupted while ${stepName(receipt?.state ?? "preparing").toLowerCase()}`}
            </strong>
            {!moving && !complete && (
              <p>
                Your board is still safe in its old place. Resume to continue,
                or roll back to undo.
              </p>
            )}
          </div>
        )}
        {(receipt || !!preview?.missingFileCount) && (
          <details className="folder-details">
            <summary>Details</summary>
            {preview?.missingFileCount ? (
              <>
                <p>
                  Missing files: {preview.missingFileCount}
                  {preview.missingFileCount > preview.missingFiles.length
                    ? ` (showing ${preview.missingFiles.length})`
                    : ""}
                </p>
                {preview.missingFiles.map((path) => (
                  <p className="folder-path" key={path}>
                    {path}
                  </p>
                ))}
              </>
            ) : null}
            {receipt && (
              <>
                {!moving && receipt.error && (
                  <p>{folderError(receipt.error)}</p>
                )}
                <p>
                  Source backup:{" "}
                  <span className="folder-path">{receipt.sourceBackup}</span>
                </p>
                <p>
                  Receipt: {receipt.id} · {receipt.state}
                </p>
                <p>
                  {receipt.tableCounts.tasks ?? taskCount ?? 0} tasks ·{" "}
                  {Object.keys(receipt.fileHashes).length} copied files ·{" "}
                  {humanBytes(receipt.byteTotal)}
                </p>
                {receipt.unresolvedLinks.map((link) => (
                  <p className="folder-path" key={link}>
                    {link}
                  </p>
                ))}
              </>
            )}
          </details>
        )}
        {error && <p role="alert">{error}</p>}
        {!moving && (
          <div className="dialog-actions">
            <Button disabled={busy} onClick={onClose}>
              {complete ? "Done" : "Close"}
            </Button>
            {input && !complete && (
              <>
                {receipt && (
                  <Button
                    disabled={
                      busy || ["published", "committed"].includes(receipt.state)
                    }
                    onClick={() => void status(true)}
                  >
                    Roll back
                  </Button>
                )}
                {retained && !receipt && (
                  <Button
                    variant="ghost"
                    aria-label="Refresh move status"
                    disabled={busy}
                    onClick={() => void status()}
                  >
                    <RefreshCw size={16} />
                  </Button>
                )}
                <Button
                  variant="primary"
                  disabled={
                    busy ||
                    policy.remote ||
                    (policy.cloud && !ack) ||
                    !preview ||
                    !validChild ||
                    preview.hasBoundOwners ||
                    (!preview.destinationPolicy.allowed && !receipt) ||
                    (preview.destinationPolicy.cloudAcknowledgementNeeded &&
                      !ack)
                  }
                  onClick={() => void move()}
                >
                  {receipt || retained ? "Resume" : "Move to folder"}
                </Button>
              </>
            )}
            {missingReceipt && (
              <Button
                disabled={busy}
                onClick={() => {
                  localStorage.removeItem(key(projectId));
                  setInput(null);
                  setPreview(null);
                  setMissingReceipt(false);
                  setError("");
                }}
              >
                Start over
              </Button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
function moveStep(state: string): 0 | 1 | 2 | 3 | 4 {
  return state === "committed"
    ? 4
    : state === "published"
      ? 3
      : state === "verified"
        ? 2
        : state === "copied"
          ? 1
          : 0;
}
function stepName(state: string) {
  return moveLabels[moveStep(state)];
}
export function humanBytes(bytes: number) {
  const index =
    bytes < 1024
      ? 0
      : Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (
    Number((bytes / 1024 ** index).toFixed(1)) +
    " " +
    ["B", "KB", "MB", "GB"][index]
  );
}
