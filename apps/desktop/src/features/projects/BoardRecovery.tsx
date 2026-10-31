import { useState } from "react";
import type { ProjectFolderInfo, SnapshotComparison } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import {
  folderContext,
  folderError,
  folderPolicy,
  projectFolders,
  useFolderGuard,
} from "../../lib/project-folder-api";
import { FolderPolicy } from "./ProjectFolderDialog";

export function BoardRecovery({
  folder,
  info,
  missingState = false,
  cloudAcknowledged = false,
  onRecovered,
}: {
  folder: string;
  info?: ProjectFolderInfo;
  missingState?: boolean;
  cloudAcknowledged?: boolean;
  onRecovered?(info: ProjectFolderInfo): void | Promise<void>;
}) {
  const [open, setOpen] = useState(missingState);
  const [comparison, setComparison] = useState<SnapshotComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [ack, setAck] = useState(cloudAcknowledged);
  const policy = folderPolicy(folder);
  const capture = useFolderGuard();
  const run = async (action: "compare" | "keep" | "restore") => {
    const context = info && folderContext(info);
    setBusy(true);
    setError("");
    try {
      const check = await capture();
      await check();
      if (action === "compare" && context) {
        const result = await projectFolders.compare(context);
        await check();
        setComparison(result);
      }
      if (action === "keep" && context && comparison) {
        await projectFolders.keep(context, comparison.externalHash);
        await check();
        setDone(true);
      }
      if (action === "restore") {
        if (context) {
          const selected = await projectFolders.info();
          await check();
          if (
            selected.instanceId !== context.instanceId ||
            selected.selectionEpoch !== context.selectionEpoch
          )
            throw new Error("Stale selection epoch");
        }
        const result = await projectFolders.recover(folder, ack);
        await check(result.context);
        setDone(true);
        await onRecovered?.(result);
      }
    } catch (error) {
      setError(folderError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="folder-recovery-banner">
        <p>
          {missingState
            ? "The local board is missing. You can restore it from board.json."
            : "Compare board.json with your current board."}
        </p>
        <Button onClick={() => setOpen(true)}>Compare</Button>
      </div>
      {open && (
        <Dialog
          title="Review board.json"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <div className="project-folder-form">
            <p className="folder-path">{folder}</p>
            <FolderPolicy
              path={folder}
              acknowledged={ack}
              onAcknowledge={setAck}
            />
            <p>
              Restoring replaces your current board. A safety backup is kept
              before restoring.
            </p>
            {!missingState && (
              <Button disabled={busy} onClick={() => void run("compare")}>
                Compare
              </Button>
            )}
            {missingState && (
              <p>
                There is no current board to compare. Jam Board will check
                board.json before restoring it.
              </p>
            )}
            {comparison && (
              <div role="status">
                <p>
                  {comparison.liveHash === comparison.externalHash
                    ? "Your current board matches board.json."
                    : "board.json was changed outside Jam Board."}
                </p>
                {comparison.changedTables.length > 0 && (
                  <p>Changes: {comparison.changedTables.join(", ")}</p>
                )}
                <details className="folder-details">
                  <summary>Details</summary>
                  <p>
                    Current revision: {comparison.liveRevision} · File revision:{" "}
                    {comparison.externalRevision ?? "unknown"}
                  </p>
                </details>
                {comparison.error && <p role="alert">{comparison.error}</p>}
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            {done && <p role="status">Board recovery decision saved.</p>}
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => setOpen(false)}>
                Close
              </Button>
              {!done && (
                <>
                  {!missingState && (
                    <Button
                      disabled={busy || !comparison}
                      onClick={() => void run("keep")}
                    >
                      Keep current board
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    disabled={
                      busy ||
                      policy.remote ||
                      (policy.cloud && !ack) ||
                      (!missingState && !comparison?.externalValid)
                    }
                    onClick={() => void run("restore")}
                  >
                    Restore from board.json
                  </Button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
