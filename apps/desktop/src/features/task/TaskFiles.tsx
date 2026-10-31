import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  FolderOpen,
  Image,
  Link,
  MoreHorizontal,
  Music,
  Package,
  Unlink,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  FileAsset,
  FileOperationStatus,
  FileTaskVersion,
  TaskFile,
  TaskFileInput,
} from "../../bindings";
import {
  Button,
  Dialog,
  IconButton,
  Select,
  Tooltip,
} from "../../components/ui";
import { api } from "../../lib/api";
import {
  type FileContext,
  type FileRole,
  fileRoleLabels,
  fileRoles,
  fileStatus,
  fileUnavailable,
  registration,
  storageLabel,
  taskFilesApi,
} from "../../lib/task-files-api";
import type { TaskFilesSlotProps } from "./TaskView";
import "./task-files.css";

const kindLabels: Record<string, string> = {
  sprite: "Image",
  audio: "Audio",
  model: "Model",
  document: "Document",
  font: "Other",
  level: "Other",
  other: "Other",
};
const icons = {
  sprite: Image,
  audio: Music,
  model: Box,
  document: FileText,
  other: Package,
};
type AddMode = "board_file" | "linked_file" | "url" | "pick" | "batch";
type Attempt = { id: string; run(): Promise<void> };
export function TaskFiles({
  task,
  writeContext,
  disabled,
  onChanged,
}: TaskFilesSlotProps) {
  const client = useQueryClient();
  const roleId = useId(),
    boardFileId = useId();
  const [rows, setRows] = useState<TaskFile[]>(task.files ?? []);
  const [context, setContext] = useState<FileContext>();
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<AddMode>();
  const [role, setRole] = useState<FileRole>("reference");
  const [paths, setPaths] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [catalog, setCatalog] = useState<FileAsset[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<FileOperationStatus>();
  const [confirm, setConfirm] = useState<TaskFile>();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [dropOver, setDropOver] = useState(false);
  const alive = useRef(true),
    invalid = useRef(false),
    locked = useRef(false);
  const origin = useRef(`${writeContext.projectId}:${writeContext.taskId}`);
  const latestDisabled = useRef(disabled);
  latestDisabled.current = disabled;
  const version = useRef<FileTaskVersion>({
    updatedAt: task.updatedAt,
    claimGeneration: task.claimGeneration ?? "0",
  });
  const attempt = useRef<Attempt | undefined>(undefined);
  const activeCopy = useRef<string | undefined>(undefined);
  const loadedSignal = useRef("");
  const versionSignal = `${task.updatedAt}:${task.claimGeneration ?? "0"}`;
  const target = `${writeContext.projectId}:${writeContext.taskId}`;
  if (origin.current !== target) invalid.current = true;
  useEffect(() => {
    alive.current = true;
    const stop = client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryKey[0] !== "app") return;
      const app = client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(
        ["app"],
      );
      if (app?.jam?.id !== writeContext.projectId) {
        invalid.current = true;
        setError("The Files target changed. Reopen this task.");
      }
    });
    return () => {
      alive.current = false;
      stop();
    };
  }, [client, writeContext.projectId]);
  const assertCurrent = useCallback(() => {
    const app = client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
      "app",
    ]);
    if (
      !alive.current ||
      invalid.current ||
      latestDisabled.current ||
      (app && app.jam?.id !== writeContext.projectId)
    )
      throw new Error("The Files target changed. Reopen this task.");
  }, [client, writeContext.projectId]);
  const load = useCallback(async () => {
    const captured = await taskFilesApi.capture(writeContext.projectId);
    const { files, version: fresh } = await taskFilesApi.read(
      captured,
      writeContext.taskKey,
    );
    if (!alive.current || invalid.current) return;
    version.current = fresh;
    setContext(captured);
    setRows(files);
    setStale(false);
    setError("");
    attempt.current = undefined;
  }, [writeContext.projectId, writeContext.taskKey]);
  useEffect(() => {
    if (loadedSignal.current === versionSignal) return;
    loadedSignal.current = versionSignal;
    if (locked.current || attempt.current) return;
    void load().catch((e) => {
      if (alive.current) setError(String(e.message ?? e));
    });
  }, [load, versionSignal]);
  const changed = async () => {
    assertCurrent();
    if (context) {
      const freshRows = await taskFilesApi.taskFiles(
        context,
        writeContext.taskKey,
      );
      assertCurrent();
      setRows(freshRows);
    }
    onChanged();
    await Promise.all([
      client.invalidateQueries({ queryKey: ["assets"] }),
      client.invalidateQueries({ queryKey: ["file-assets"] }),
      client.invalidateQueries({ queryKey: ["task", writeContext.taskKey] }),
      client.invalidateQueries({ queryKey: ["project-folder"] }),
      client.invalidateQueries({ queryKey: ["folder-info"] }),
      client.invalidateQueries({ queryKey: ["project-folders"] }),
      client.invalidateQueries({ queryKey: ["settings"] }),
    ]);
  };
  const openFile = async (assetId: string, reveal: boolean) => {
    if (!context || !alive.current || invalid.current) return;
    try {
      await taskFilesApi.open(context, assetId, reveal);
    } catch (e) {
      if (!alive.current || invalid.current) return;
      setError(e instanceof Error ? e.message : String(e));
      if (
        typeof e !== "object" ||
        e === null ||
        !("code" in e) ||
        e.code !== "validation" ||
        !("field" in e) ||
        e.field !== "assetId"
      )
        return;
      setRows((current) =>
        current.map((row) =>
          row.asset.id === assetId
            ? {
                ...row,
                asset: {
                  ...row.asset,
                  resolution: { ...row.asset.resolution, status: "unknown" },
                },
              }
            : row,
        ),
      );
      try {
        // A failed backend launch must replace a previously cached OK status.
        // Resolution here refreshes the row only; it never launches or retries.
        const resolution = await taskFilesApi.resolve(context, assetId);
        if (!alive.current || invalid.current) return;
        setRows((current) =>
          current.map((row) =>
            row.asset.id === assetId
              ? { ...row, asset: { ...row.asset, resolution } }
              : row,
          ),
        );
      } catch {
        // Keep the launch error visible if its follow-up status read fails.
      }
    }
  };
  const submit = async (work: Attempt) => {
    if (locked.current) return;
    try {
      assertCurrent();
    } catch (e) {
      setError(String(e));
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    attempt.current = work;
    try {
      await work.run();
      assertCurrent();
      attempt.current = undefined;
      setMode(undefined);
      setConfirm(undefined);
      setChoices({});
      await changed();
    } catch (e) {
      if (alive.current && !invalid.current) {
        const message = String(e instanceof Error ? e.message : e);
        const conflict =
          /conflict|task changed/i.test(message) ||
          (typeof e === "object" &&
            e !== null &&
            "code" in e &&
            e.code === "CONFLICT");
        setStale(conflict);
        setError(conflict ? "Task changed — reload" : message);
      }
    } finally {
      locked.current = false;
      activeCopy.current = undefined;
      if (alive.current) {
        setBusy(false);
        setOperation(undefined);
      }
    }
  };
  const input = (
    assetId: string,
    nextRole: string | null,
    position: number | null,
    requestId: string,
  ): TaskFileInput => ({
    taskKey: writeContext.taskKey,
    assetId,
    role: nextRole,
    position,
    expectedClaimGeneration: version.current.claimGeneration,
    expectedUpdatedAt: version.current.updatedAt,
    requestId,
  });
  const mutateRow = (
    row: TaskFile,
    action: "role" | "unlink",
    nextRole = row.role,
    position = row.position,
  ) => {
    if (!context) return;
    const payload = input(
      row.asset.id,
      nextRole,
      position,
      crypto.randomUUID(),
    );
    void submit({
      id: payload.requestId,
      run: async () => {
        assertCurrent();
        const result = await (action === "unlink"
          ? taskFilesApi.unlink(context, payload)
          : taskFilesApi.setRole(context, payload));
        if (result.taskVersion) version.current = result.taskVersion;
      },
    });
  };
  const reorder = (group: TaskFile[], index: number, direction: number) => {
    if (!context) return;
    const desired = group.slice(),
      destination = index + direction;
    const moved = desired.splice(index, 1)[0];
    if (!moved || destination < 0 || destination >= group.length) return;
    desired.splice(destination, 0, moved);
    const steps = desired.map((row, position) => ({
      row,
      position,
      requestId: crypto.randomUUID(),
      payload: undefined as TaskFileInput | undefined,
    }));
    void submit({
      id: crypto.randomUUID(),
      run: async () => {
        // Normalize ties/null positions too. Each explicit write uses the preceding receipt's CAS.
        for (const step of steps) {
          assertCurrent();
          step.payload ??= input(
            step.row.asset.id,
            step.row.role,
            step.position * 1024,
            step.requestId,
          );
          const result = await taskFilesApi.setRole(context, step.payload);
          if (result.taskVersion) version.current = result.taskVersion;
        }
      },
    });
  };
  const begin = async (next: AddMode) => {
    setMenu(false);
    setError("");
    setPaths([]);
    setSelected("");
    setMode(next);
    if (next === "pick" && context) {
      try {
        const files = await taskFilesApi.list(context);
        assertCurrent();
        setCatalog(files);
      } catch (e) {
        setError(String(e));
      }
    }
  };
  const pickPaths = async () => {
    try {
      assertCurrent();
      const picked = await api.pickFiles();
      assertCurrent();
      setPaths(picked);
    } catch (e) {
      if (alive.current) setError(String(e));
    }
  };
  const add = (storage: "board_file" | "linked_file" | "url" | "pick") => {
    if (!context) return;
    const sources =
      storage === "pick" ? [selected] : storage === "url" ? [url] : paths;
    // Allocate once. An uncertain retry reuses exact register/link payloads and IDs.
    const steps = sources.map((source) => ({
      source,
      registerId: crypto.randomUUID(),
      linkId: crypto.randomUUID(),
      assetId: storage === "pick" ? source : "",
      registerInput: registration(
        storage === "pick" ? "linked_file" : storage,
        source,
        crypto.randomUUID(),
      ),
      linkInput: undefined as TaskFileInput | undefined,
    }));
    const chosenRole = role;
    void submit({
      id: crypto.randomUUID(),
      run: async () => {
        for (const step of steps) {
          assertCurrent();
          if (!step.assetId) {
            step.registerInput.requestId = step.registerId;
            let poll: ReturnType<typeof setInterval> | undefined;
            if (storage === "board_file") {
              activeCopy.current = step.registerId;
              setOperation({
                requestId: step.registerId,
                state: "starting",
                canCancel: false,
              });
              poll = setInterval(() => {
                void taskFilesApi
                  .status(context, step.registerId)
                  .then((status) => {
                    if (
                      alive.current &&
                      !invalid.current &&
                      activeCopy.current === step.registerId
                    )
                      setOperation(status);
                  })
                  .catch(() => {});
              }, 150);
            }
            try {
              const result = await taskFilesApi.register(
                context,
                step.registerInput,
              );
              step.assetId = result.asset?.id ?? "";
              if (!step.assetId)
                throw new Error("File registration returned no asset");
            } finally {
              if (poll) clearInterval(poll);
              activeCopy.current = undefined;
              if (alive.current) setOperation(undefined);
            }
          }
          assertCurrent();
          step.linkInput ??= input(
            step.assetId,
            chosenRole,
            rows.length + steps.indexOf(step),
            step.linkId,
          );
          const result = await taskFilesApi.link(context, step.linkInput);
          if (result.taskVersion) version.current = result.taskVersion;
        }
      },
    });
  };
  useEffect(
    () =>
      api.onFileDrop((dropped, point) => {
        const section = document.querySelector("[data-task-files]");
        const rect = section?.getBoundingClientRect();
        if (
          !point ||
          !rect ||
          point.x < rect.left ||
          point.x > rect.right ||
          point.y < rect.top ||
          point.y > rect.bottom
        )
          return;
        try {
          assertCurrent();
          if (locked.current) return;
          setPaths(dropped);
          setMode("batch");
          setMenu(false);
        } catch {
          /* late delivery is discarded */
        }
      }, setDropOver),
    [assertCurrent],
  );
  const writable =
    !disabled && !busy && !!context && !invalid.current && !stale;
  const rolePicker = (
    <div>
      <label htmlFor={roleId}>File role</label>
      <Select
        id={roleId}
        aria-label="File role"
        value={role}
        disabled={!writable}
        onChange={(e) => setRole(e.target.value as FileRole)}
      >
        {Object.entries(fileRoleLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );
  return (
    <section
      className={`task-section task-files ${dropOver ? "file-drop-active" : ""}`}
      data-task-files
      aria-label="Task files"
    >
      <div className="task-files-heading">
        <h2>
          Files <span className="muted">{rows.length}</span>
        </h2>
        <Button
          disabled={!writable}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          Add file
        </Button>
      </div>
      {menu && (
        <fieldset
          className="task-files-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setMenu(false);
            }
          }}
        >
          <Button onClick={() => void begin("board_file")}>
            Copy into board…
          </Button>
          <Button onClick={() => void begin("linked_file")}>
            Link existing file…
          </Button>
          <Button onClick={() => void begin("url")}>Add URL…</Button>
          <Button onClick={() => void begin("pick")}>
            Pick from board files
          </Button>
        </fieldset>
      )}
      {error && (
        <div className="task-files-error" role="alert">
          <p>{error}</p>
          {!busy && (
            <Button
              onClick={() => void load().catch((e) => setError(String(e)))}
            >
              {stale ? "Reload Files" : "Reload"}
            </Button>
          )}
          {!busy && !stale && attempt.current && (
            <Button
              disabled={disabled}
              onClick={() => attempt.current && void submit(attempt.current)}
            >
              Retry same request
            </Button>
          )}
        </div>
      )}
      {!rows.length && (
        <p className="muted">
          Add files to edit, references, or results. Drop a batch here to choose
          copy or link.
        </p>
      )}
      {Object.entries(fileRoles).map(([group, title]) => {
        const grouped = rows
          .filter((row) => row.role === group)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        if (!grouped.length) return null;
        return (
          <div className="task-file-group" key={group}>
            <h3>{title}</h3>
            {grouped.map((row, index) => {
              const asset = row.asset;
              const Icon =
                asset.storageType === "url"
                  ? Link
                  : (icons[asset.kind as keyof typeof icons] ?? Package);
              const roleChoice = choices[asset.id] ?? row.role;
              return (
                <article
                  className="task-file-row"
                  key={asset.id}
                  aria-label={asset.name}
                >
                  <div
                    role="img"
                    className="task-file-thumbnail"
                    title="Preview reserved for phase 2"
                    aria-label="Preview placeholder"
                  >
                    <Icon size={22} />
                  </div>
                  <div className="task-file-main">
                    <strong title={asset.name}>{asset.name}</strong>
                    <small className="task-file-path" title={asset.storedPath}>
                      {asset.storedPath}
                    </small>
                    <div className="task-file-meta">
                      {asset.storageType !== "url" && (
                        <span>{kindLabels[asset.kind] ?? "Other"}</span>
                      )}
                      <span className="task-file-badge">
                        {storageLabel(asset.storageType)}
                      </span>
                      {asset.pathBase === "absolute" && (
                        <span>Outside the working directory</span>
                      )}
                    </div>
                    <FileAvailability asset={asset} />
                    <div className="task-file-actions">
                      <div className="task-file-role">
                        <Select
                          aria-label={`Role for ${asset.name}`}
                          value={roleChoice}
                          disabled={!writable}
                          onChange={(e) =>
                            setChoices({
                              ...choices,
                              [asset.id]: e.target.value,
                            })
                          }
                        >
                          {Object.entries(fileRoleLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </Select>
                      </div>
                      {roleChoice !== row.role && (
                        <IconButton
                          label="Apply role"
                          disabled={!writable}
                          onClick={() => mutateRow(row, "role", roleChoice)}
                        >
                          <Check size={16} />
                        </IconButton>
                      )}
                      <IconButton
                        aria-label="Open"
                        label={
                          fileUnavailable(asset)
                            ? `Open unavailable: ${fileStatus(asset)}`
                            : asset.storageType === "url"
                              ? `Open ${urlHost(asset.storedPath)}`
                              : "Open"
                        }
                        disabled={
                          busy || invalid.current || fileUnavailable(asset)
                        }
                        onClick={() => void openFile(asset.id, false)}
                      >
                        <ExternalLink size={16} />
                      </IconButton>
                      <FileActionsMenu
                        name={asset.name}
                        url={asset.storageType === "url"}
                        unavailableReason={
                          fileUnavailable(asset) ? fileStatus(asset) : undefined
                        }
                        disabled={busy || invalid.current}
                        writable={writable}
                        canUp={index > 0}
                        canDown={index < grouped.length - 1}
                        onReveal={() => void openFile(asset.id, true)}
                        onUp={() => reorder(grouped, index, -1)}
                        onDown={() => reorder(grouped, index, 1)}
                        onUnlink={() => setConfirm(row)}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        );
      })}
      {mode && (
        <Dialog
          title={
            mode === "batch"
              ? "Add dropped files"
              : mode === "board_file"
                ? "Copy into board"
                : mode === "linked_file"
                  ? "Link existing file"
                  : mode === "url"
                    ? "Add URL"
                    : "Pick from board files"
          }
          busy={busy}
          onClose={() => {
            if (!busy) setMode(undefined);
          }}
        >
          <div className="m5-form task-file-add">
            {rolePicker}
            {mode === "url" ? (
              <label>
                URL
                <input
                  data-autofocus
                  aria-label="File URL"
                  type="url"
                  value={url}
                  disabled={busy}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
            ) : mode === "pick" ? (
              <div>
                <label htmlFor={boardFileId}>Board file</label>
                <Select
                  id={boardFileId}
                  aria-label="Board file"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose a registered file</option>
                  {catalog
                    .filter((a) => !rows.some((r) => r.asset.id === a.id))
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {`${a.name} · ${storageLabel(a.storageType)}`}
                      </option>
                    ))}
                </Select>
              </div>
            ) : (
              <>
                <p>
                  {mode === "board_file"
                    ? "Copies bytes into files/ in the board folder. The source stays unchanged."
                    : mode === "linked_file"
                      ? "The file stays in place. Inside the working repository it is stored repo-relative; outside it, an absolute local path is stored."
                      : "Choose copy or link once for this entire batch."}
                </p>
                {mode !== "batch" && (
                  <Button disabled={busy} onClick={() => void pickPaths()}>
                    Choose files…
                  </Button>
                )}
                <ul className="task-file-selected">
                  {paths.map((path) => (
                    <li key={path} title={path}>
                      {path}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && <p role="alert">{error}</p>}
            {operation && (
              <div className="task-file-progress" role="status">
                <span>Copy progress · {operation.state}</span>
                <progress aria-label="Copy progress" />
                <Button
                  disabled={!operation.canCancel}
                  onClick={() =>
                    context &&
                    void taskFilesApi
                      .cancel(context, operation.requestId)
                      .then(setOperation)
                      .catch((e) => setError(String(e)))
                  }
                >
                  Cancel copy
                </Button>
              </div>
            )}
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => setMode(undefined)}>
                Cancel
              </Button>
              {attempt.current && error && !stale ? (
                <Button
                  disabled={busy || disabled}
                  onClick={() =>
                    attempt.current && void submit(attempt.current)
                  }
                >
                  Retry same request
                </Button>
              ) : mode === "batch" ? (
                <>
                  <Button
                    disabled={!writable || !paths.length}
                    onClick={() => add("board_file")}
                  >
                    Copy batch into board
                  </Button>
                  <Button
                    disabled={!writable || !paths.length}
                    onClick={() => add("linked_file")}
                  >
                    Link batch in place
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  disabled={
                    !writable ||
                    (mode === "url"
                      ? !/^https?:\/\/[^\s]+$/i.test(url)
                      : mode === "pick"
                        ? !selected
                        : !paths.length)
                  }
                  onClick={() => add(mode)}
                >
                  Add files
                </Button>
              )}
            </div>
            {stale && (
              <Button
                disabled={busy}
                onClick={() => void load().catch((e) => setError(String(e)))}
              >
                Reload Files
              </Button>
            )}
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title="Unlink file?"
          busy={busy}
          onClose={() => {
            if (!busy) setConfirm(undefined);
          }}
        >
          <p>
            Remove {confirm.asset.name} from this task? Unlinking never deletes
            file bytes. The file remains in the board or at its linked location.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setConfirm(undefined)}>
              Keep file
            </Button>
            <Button
              disabled={!writable}
              onClick={() => mutateRow(confirm, "unlink")}
            >
              Unlink file
            </Button>
            {stale && (
              <Button
                onClick={() => void load().catch((e) => setError(String(e)))}
              >
                Reload Files
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function urlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export function FileAvailability({ asset }: { asset?: FileAsset }) {
  if (!asset) return null;
  const label = fileStatus(asset);
  if (!label) return null;
  const Icon =
    asset.resolution.status === "missing" ? AlertTriangle : CircleAlert;
  return (
    <span className="file-availability" data-status={asset.resolution.status}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

function FileActionsMenu({
  name,
  url,
  unavailableReason,
  disabled,
  writable,
  canUp,
  canDown,
  onReveal,
  onUp,
  onDown,
  onUnlink,
}: {
  name: string;
  url: boolean;
  unavailableReason?: string;
  disabled: boolean;
  writable: boolean;
  canUp: boolean;
  canDown: boolean;
  onReveal(): void;
  onUp(): void;
  onDown(): void;
  onUnlink(): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const restore = () =>
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
      ?.focus();
  useLayoutEffect(() => {
    const panel = menu.current,
      trigger = root.current?.querySelector('[aria-haspopup="menu"]');
    if (!open || !panel || !trigger) return;
    if (typeof panel.showPopover === "function") {
      try {
        panel.setAttribute("popover", "manual");
        panel.showPopover();
        const rect = trigger.getBoundingClientRect(),
          height = panel.offsetHeight;
        panel.dataset.floating = "true";
        panel.style.left = `${Math.max(8, Math.min(innerWidth - 208, rect.right - 200))}px`;
        panel.style.top = `${rect.bottom + height + 8 <= innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)}px`;
      } catch {
        panel.removeAttribute("popover");
      }
    }
    (
      panel.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? panel
    ).focus({ preventScroll: true });
    const closeOutside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      window.removeEventListener("resize", closeOnResize);
      try {
        if (panel.hasAttribute("popover")) panel.hidePopover();
      } catch {
        /* closing owner may already have removed it */
      }
    };
  }, [open]);
  const act = (action: () => void) => {
    setOpen(false);
    restore();
    action();
  };
  return (
    <div className="task-file-overflow" ref={root}>
      <IconButton
        label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={18} />
      </IconButton>
      {open && (
        <div
          className="task-file-overflow-menu"
          id={id}
          ref={menu}
          role="menu"
          aria-label={`Actions for ${name}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              restore();
            } else if (event.key === "Tab") setOpen(false);
            else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              event.stopPropagation();
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]:not(:disabled)',
                ) ?? [],
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          {!url && (
            <Tooltip
              text={
                unavailableReason
                  ? `Reveal unavailable: ${unavailableReason}`
                  : "Reveal in folder"
              }
            >
              <Button
                role="menuitem"
                tabIndex={-1}
                disabled={!!unavailableReason}
                onClick={() => act(onReveal)}
              >
                <FolderOpen size={16} />
                Reveal in folder
              </Button>
            </Tooltip>
          )}
          <Button
            role="menuitem"
            tabIndex={-1}
            disabled={!writable || !canUp}
            onClick={() => act(onUp)}
          >
            <ArrowUp size={16} />
            Move up
          </Button>
          <Button
            role="menuitem"
            tabIndex={-1}
            disabled={!writable || !canDown}
            onClick={() => act(onDown)}
          >
            <ArrowDown size={16} />
            Move down
          </Button>
          <Button
            role="menuitem"
            tabIndex={-1}
            disabled={!writable}
            onClick={() => act(onUnlink)}
          >
            <Unlink size={16} />
            Unlink…
          </Button>
        </div>
      )}
    </div>
  );
}
