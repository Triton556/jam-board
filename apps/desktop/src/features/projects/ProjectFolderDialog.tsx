import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NewJamInput, ProjectFolderInfo } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import {
  folderError,
  folderPolicy,
  projectFolders,
  rememberFolderProject,
  useFolderGuard,
} from "../../lib/project-folder-api";
import {
  selectedContext,
  selectionIdentity,
} from "../../lib/project-selection";
import { BoardRecovery } from "./BoardRecovery";
import "./project-folders.css";

const drafts = new Map<string, string>();
export function ProjectFolderDialog({
  mode,
  draftKey: baseDraftKey,
  initialName = "",
  initialFolder = "",
  expectedProjectId,
  recentInstanceId,
  initialization,
  onClose,
  onOpened,
}: {
  mode: "create" | "open";
  draftKey: string;
  initialName?: string;
  initialFolder?: string;
  expectedProjectId?: string;
  recentInstanceId?: string;
  initialization?: NewJamInput;
  onClose(): void;
  onOpened(info: ProjectFolderInfo): void | Promise<void>;
}) {
  const client = useQueryClient();
  const draftKey = `${selectionIdentity(selectedContext(client))}:${baseDraftKey}`;
  const [name, setName] = useState(drafts.get(draftKey) ?? initialName);
  const [folder, setFolder] = useState(initialFolder);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState("");
  const [duplicateChoice, setDuplicateChoice] = useState<"registered" | "copy">(
    "registered",
  );
  const [recovery, setRecovery] = useState(false);
  const [cloudRequired, setCloudRequired] = useState(false);
  const capture = useFolderGuard();
  const policy = folderPolicy(folder);
  const choose = async () => {
    setBusy(true);
    setError("");
    try {
      const check = await capture();
      const result = await api.pickFolder();
      await check();
      if (result) {
        setFolder(result);
        setAck(false);
        setRegistered("");
        setRecovery(false);
        setCloudRequired(false);
      }
    } catch (error) {
      setError(folderError(error));
    } finally {
      setBusy(false);
    }
  };
  const open = async (path = folder, separate = false) => {
    setBusy(true);
    setError("");
    try {
      const check = await capture();
      await check();
      if (expectedProjectId && !recentInstanceId)
        throw new Error(
          "Recent folder entry changed. Reopen the recent folders list.",
        );
      const info =
        mode === "create"
          ? await projectFolders.create(
              path,
              name.trim(),
              ack,
              initialization ? { ...initialization, name: name.trim() } : null,
            )
          : expectedProjectId && recentInstanceId
            ? await projectFolders.locate(
                recentInstanceId,
                expectedProjectId,
                path,
                ack,
              )
            : await projectFolders.open(path, ack, separate);
      await check(info.context);
      rememberFolderProject(info);
      await onOpened(info);
      drafts.delete(draftKey);
    } catch (error) {
      const raw = String(error);
      const message = folderError(error);
      setError(message);
      if (/cloud.*acknowledg|acknowledg.*cloud/i.test(raw))
        setCloudRequired(true);
      if (/duplicateProjectId/i.test(message)) {
        setError(
          "This board is already registered in another folder. Choose which one to open.",
        );
        try {
          const checkList = await capture();
          const entries = await projectFolders.list();
          await checkList();
          const pathInError = entries.find((entry) =>
            message.includes(entry.canonicalFolder),
          );
          setRegistered(pathInError?.canonicalFolder ?? "");
        } catch (listError) {
          setError(folderError(listError));
        }
      }
      if (/recoveryRequired|Local DB is absent/i.test(raw)) setRecovery(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        mode === "create" ? "Create project folder" : "Open project folder"
      }
      busy={busy}
      onClose={onClose}
    >
      <div className="project-folder-form">
        {mode === "create" && (
          <label>
            Project name
            <input
              maxLength={60}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                drafts.set(draftKey, event.target.value);
              }}
            />
          </label>
        )}
        <div className="folder-picker">
          <label>
            {mode === "create" ? "Project folder" : "Chosen folder"}
            <input
              readOnly
              value={folder}
              placeholder="No folder chosen"
              title={folder}
            />
          </label>
          <Button disabled={busy} onClick={() => void choose()}>
            {folder ? "Change…" : "Choose folder…"}
          </Button>
        </div>
        {mode === "create" && (
          <details className="folder-details">
            <summary>What will be created</summary>
            <pre className="folder-layout">
              {
                "jamboard.json\nfiles/\nboard.json\n.gitignore\n.state/ (local board and backups)"
              }
            </pre>
          </details>
        )}
        <FolderPolicy
          path={folder}
          cloudDetected={cloudRequired || policy.cloud}
          acknowledged={ack}
          onAcknowledge={setAck}
        />
        {error && <p role="alert">{error}</p>}
        {registered && (
          <fieldset className="folder-choice" disabled={busy}>
            <legend>Which board would you like to open?</legend>
            <label className="folder-radio">
              <input
                type="radio"
                name="duplicate-board"
                value="registered"
                checked={duplicateChoice === "registered"}
                onChange={() => setDuplicateChoice("registered")}
              />
              <span>
                Open the board already registered at{" "}
                <span className="folder-path">{registered}</span>
                <small>Continue with the existing board.</small>
              </span>
            </label>
            <label className="folder-radio">
              <input
                type="radio"
                name="duplicate-board"
                value="copy"
                checked={duplicateChoice === "copy"}
                onChange={() => setDuplicateChoice("copy")}
              />
              <span>
                Open as a separate copy (new project ID)
                <small>Keep both boards independent.</small>
              </span>
            </label>
          </fieldset>
        )}
        {recovery && (
          <BoardRecovery
            folder={folder}
            cloudAcknowledged={ack}
            missingState
            onRecovered={onOpened}
          />
        )}
        <div className="dialog-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              busy ||
              !folder ||
              policy.remote ||
              ((policy.cloud || cloudRequired) && !ack) ||
              (mode === "create" && !name.trim()) ||
              recovery
            }
            onClick={() =>
              void open(
                registered && duplicateChoice === "registered"
                  ? registered
                  : folder,
                !!registered && duplicateChoice === "copy",
              )
            }
          >
            {mode === "create"
              ? "Create project"
              : registered
                ? duplicateChoice === "copy"
                  ? "Open separate copy"
                  : "Open registered board"
                : "Open"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function FolderPolicy({
  path,
  acknowledged,
  onAcknowledge,
  cloudDetected,
}: {
  path: string;
  acknowledged: boolean;
  onAcknowledge(value: boolean): void;
  cloudDetected?: boolean;
}) {
  const policy = folderPolicy(path);
  const provider = /onedrive/i.test(path)
    ? "OneDrive"
    : /dropbox/i.test(path)
      ? "Dropbox"
      : /google[ -]?drive/i.test(path)
        ? "Google Drive"
        : /icloud/i.test(path)
          ? "iCloud"
          : "a cloud service";
  return (
    <>
      {policy.remote && (
        <p role="alert">
          Network folders are not supported. Choose a folder on this computer.
        </p>
      )}
      {(policy.cloud || cloudDetected) && (
        <div className="folder-warning">
          <p>
            This folder is synced by {provider}. Syncing while the board is open
            can damage it. A local folder outside{" "}
            {provider === "a cloud service" ? "cloud sync" : provider} is safer.
          </p>
          <label className="folder-checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => onAcknowledge(e.target.checked)}
            />
            Use this folder anyway
          </label>
        </div>
      )}
    </>
  );
}
