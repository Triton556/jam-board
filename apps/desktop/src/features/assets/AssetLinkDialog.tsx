import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, Select } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
import {
  type FileRole,
  fileRoleLabels,
  registration,
  taskFilesApi,
} from "../../lib/task-files-api";
import { useProjectWrite } from "../../lib/use-project-write";
export function AssetLinkDialog({
  assetId,
  taskKey,
  close,
}: {
  assetId?: string;
  taskKey?: string;
  close(): void;
}) {
  const client = useQueryClient(),
    write = useProjectWrite(`asset-link:${assetId ?? ""}:${taskKey ?? ""}`),
    form = useRef<HTMLFormElement>(null);
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.listAssets(),
    enabled: !assetId,
  });
  const tasks = useQuery({
    queryKey: ["boardTasks"],
    queryFn: () => api.listBoardTasks(),
    enabled: !!assetId,
  });
  const source = assetId ? tasks : assets;
  const listId = useId();
  const roleId = useId(),
    sourceId = useId();
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(""),
    [selected, setSelected] = useState("");
  const [role, setRole] = useState<FileRole>("reference");
  const [sourceMode, setSourceMode] = useState("existing");
  const [sourcePath, setSourcePath] = useState("");
  const [pickerError, setPickerError] = useState("");
  const alive = useRef(true),
    pickerEpoch = useRef(0);
  const latestWrite = useRef(write);
  latestWrite.current = write;
  useEffect(() => {
    alive.current = true;
    let previous = client.getQueryData<
      Awaited<ReturnType<typeof api.appState>>
    >(["app"])?.jam?.id;
    const stop = client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryKey[0] !== "app") return;
      const next = client.getQueryData<
        Awaited<ReturnType<typeof api.appState>>
      >(["app"])?.jam?.id;
      if (next !== previous) {
        pickerEpoch.current++;
        previous = next;
      }
    });
    return () => {
      alive.current = false;
      pickerEpoch.current++;
      stop();
    };
  }, [client]);
  const pendingRequest = useRef<
    | {
        signature: string;
        registerId: string;
        linkId: string;
        assetId?: string;
        input?: import("../../bindings").TaskFileInput;
        version?: import("../../bindings").FileTaskVersion;
      }
    | undefined
  >(undefined);
  const options = assetId
    ? Object.values(tasks.data ?? {})
        .flat()
        .map((t) => ({ id: t.key, label: `${t.key} · ${t.title}` }))
    : (assets.data ?? []).map((a) => ({ id: a.id, label: a.name }));
  const visible = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  const canChoose = write.ready && !source.isPending && !source.error;
  const activeIndex = canChoose
    ? visible.findIndex((o) => o.id === active)
    : -1;
  const activeOptionId =
    activeIndex < 0 ? undefined : `${listId}-${activeIndex}`;
  useEffect(() => {
    if (activeOptionId)
      document
        .getElementById(activeOptionId)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);
  const canSave =
    write.ready &&
    !source.isPending &&
    !source.error &&
    (sourceMode === "existing"
      ? options.some((o) => o.id === selected)
      : sourceMode === "url"
        ? /^https?:\/\/[^\s]+$/i.test(sourcePath)
        : !!sourcePath);
  return (
    <Dialog
      title={assetId ? "Link to task" : "Link asset"}
      busy={write.pending}
      onClose={() => write.dismiss(close)}
    >
      <form
        ref={form}
        className="m5-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          const projectId = client.getQueryData<
            Awaited<ReturnType<typeof api.appState>>
          >(["app"])?.jam?.id;
          const epoch = pickerEpoch.current;
          const assertTarget = () => {
            if (
              !projectId ||
              !alive.current ||
              pickerEpoch.current !== epoch ||
              latestWrite.current.changed ||
              client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
                "app",
              ])?.jam?.id !== projectId
            )
              throw new Error("The Files target changed. Reopen this dialog.");
          };
          write.run(
            async () => {
              assertTarget();
              const context = await taskFilesApi.capture(projectId ?? "");
              assertTarget();
              const key = taskKey ?? selected;
              const signature = JSON.stringify([
                key,
                assetId,
                selected,
                role,
                sourceMode,
                sourcePath,
              ]);
              if (pendingRequest.current?.signature !== signature)
                pendingRequest.current = {
                  signature,
                  registerId: crypto.randomUUID(),
                  linkId: crypto.randomUUID(),
                };
              const request = pendingRequest.current;
              request.version ??= await taskFilesApi.version(context, key);
              assertTarget();
              let id = assetId ?? selected;
              if (sourceMode !== "existing") {
                if (!request.assetId) {
                  const result = await taskFilesApi.register(
                    context,
                    registration(
                      sourceMode as "board_file" | "linked_file" | "url",
                      sourcePath,
                      request.registerId,
                    ),
                  );
                  request.assetId = result.asset?.id;
                }
                id = request.assetId ?? "";
              }
              assertTarget();
              const version = request.version;
              request.input ??= {
                taskKey: key,
                assetId: id,
                role,
                position: null,
                expectedClaimGeneration: version.claimGeneration,
                expectedUpdatedAt: version.updatedAt,
                requestId: request.linkId,
              };
              await taskFilesApi.link(context, request.input);
            },
            () => {
              void client.invalidateQueries({ queryKey: ["assets"] });
              void client.invalidateQueries({ queryKey: ["file-assets"] });
              if (taskKey)
                void client.invalidateQueries({ queryKey: ["task", taskKey] });
              close();
            },
          );
        }}
      >
        <div>
          <label htmlFor={roleId}>File role</label>
          <Select
            id={roleId}
            aria-label="File role"
            value={role}
            disabled={!write.ready}
            onChange={(e) => setRole(e.target.value as FileRole)}
          >
            {Object.entries(fileRoleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {!assetId && (
          <>
            <div>
              <label htmlFor={sourceId}>File source</label>
              <Select
                id={sourceId}
                aria-label="File source"
                value={sourceMode}
                disabled={!write.ready}
                onChange={(e) => setSourceMode(e.target.value)}
              >
                <option value="existing">Pick registered file</option>
                <option value="board_file">Copy into board</option>
                <option value="linked_file">Link in place</option>
                <option value="url">URL</option>
              </Select>
            </div>
            {sourceMode !== "existing" && (
              <>
                <p className="small muted">
                  {sourceMode === "board_file"
                    ? "Copy bytes into files/ in the board folder; the source stays unchanged."
                    : sourceMode === "linked_file"
                      ? "Keep the file in place. Repository paths are relative; outside files use absolute local paths."
                      : "A URL remains a link; nothing is downloaded."}
                </p>
                {sourceMode !== "url" && (
                  <Button
                    disabled={!write.ready}
                    onClick={() => {
                      const epoch = pickerEpoch.current;
                      const projectId = client.getQueryData<
                        Awaited<ReturnType<typeof api.appState>>
                      >(["app"])?.jam?.id;
                      void api
                        .pickFiles()
                        .then((paths) => {
                          if (
                            projectId &&
                            alive.current &&
                            pickerEpoch.current === epoch &&
                            !latestWrite.current.changed &&
                            client.getQueryData<
                              Awaited<ReturnType<typeof api.appState>>
                            >(["app"])?.jam?.id === projectId
                          )
                            setSourcePath(paths[0] ?? "");
                        })
                        .catch((e) => {
                          if (alive.current) setPickerError(String(e));
                        });
                    }}
                  >
                    Choose file…
                  </Button>
                )}
                <label>
                  {sourceMode === "url" ? "URL" : "File path"}
                  <input
                    aria-label="Source path or URL"
                    value={sourcePath}
                    disabled={!write.ready}
                    onChange={(e) => setSourcePath(e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}
        {sourceMode === "existing" && (
          <>
            <label>
              Search
              <input
                data-write-focus
                data-autofocus
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={activeOptionId}
                value={query}
                disabled={write.pending}
                readOnly={!write.ready}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive("");
                  setSelected("");
                }}
                onKeyDown={(e) => {
                  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                    e.preventDefault();
                    if (!canChoose || !visible.length) return;
                    const next =
                      activeIndex < 0
                        ? e.key === "ArrowDown"
                          ? 0
                          : visible.length - 1
                        : (activeIndex +
                            (e.key === "ArrowDown" ? 1 : -1) +
                            visible.length) %
                          visible.length;
                    setActive(visible[next]?.id ?? "");
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (canChoose && activeIndex >= 0)
                      setSelected(visible[activeIndex]?.id ?? "");
                  }
                }}
              />
            </label>
            {source.isPending && (
              <p role="status">Loading {assetId ? "tasks" : "assets"}…</p>
            )}
            {source.error && (
              <div>
                <p role="alert">
                  Could not load {assetId ? "tasks" : "assets"}:{" "}
                  {source.error.message}
                </p>
                <Button
                  disabled={source.isFetching || write.pending}
                  onClick={() => void source.refetch()}
                >
                  Retry list
                </Button>
              </div>
            )}
            {!source.isPending && !source.error && !visible.length && (
              <p className="muted">
                {options.length
                  ? "No matches. Try another search."
                  : assetId
                    ? "No tasks yet. Create a task before linking this asset."
                    : "No assets yet. Add an asset before linking it."}
              </p>
            )}
            <div
              id={listId}
              className="link-options"
              role="listbox"
              aria-label={assetId ? "Tasks" : "Assets"}
            >
              {visible.map((o, index) => (
                <button
                  key={o.id}
                  id={`${listId}-${index}`}
                  data-active={activeIndex === index || undefined}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected === o.id}
                  disabled={!write.ready || !!source.error}
                  onClick={() => {
                    setActive(o.id);
                    setSelected(o.id);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
        <ProjectWriteFeedback
          write={write}
          action="Linking asset"
          form={form}
        />
        {pickerError && <p role="alert">{pickerError}</p>}
        <Button type="submit" variant="primary" disabled={!canSave}>
          Link
        </Button>
      </form>
    </Dialog>
  );
}
