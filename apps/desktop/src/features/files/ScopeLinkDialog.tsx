import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { FileScope, FileStorageType } from "../../bindings";
import { Button, Dialog, Select } from "../../components/ui";
import { api } from "../../lib/api";
import {
  assertFileContext,
  fileCatalogQuery,
  fileViewerApi,
  scopeInput,
  useFileContext,
} from "../../lib/file-viewer-api";
import { registration, taskFilesApi } from "../../lib/task-files-api";
import { assetKinds } from "../assets/model";
import { useFileAction } from "./file-hooks";

export function ScopeLinkDialog({
  scope,
  close,
  register = false,
}: {
  scope: FileScope;
  close(): void;
  register?: boolean;
}) {
  const sourceId = useId(),
    kindId = useId();
  const context = useFileContext(),
    c = context.data;
  const catalog = useQuery(fileCatalogQuery(c)),
    write = useFileAction(c, `scope-link:${scope.type}:${scope.key}`);
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [selected, setSelected] = useState(""),
    [mode, setMode] = useState<FileStorageType | "existing">(
      register ? "board_file" : "existing",
    ),
    [source, setSource] = useState(""),
    [error, setError] = useState(""),
    [picking, setPicking] = useState(false);
  const registered = useRef(new Map<string, string>());
  const visible =
    catalog.data?.filter(
      (a) =>
        (!kind || a.kind === kind) &&
        `${a.name} ${a.storedPath}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <Dialog
      title={register ? "Add document" : "Link document"}
      onClose={() => write.dismiss(close)}
      busy={write.pending || picking}
    >
      <form
        className="m5-form"
        onSubmit={(e) => {
          e.preventDefault();
          write.run(async (ctx) => {
            let id = selected;
            if (mode !== "existing") {
              const signature = JSON.stringify([mode, source]);
              id = registered.current.get(signature) ?? "";
              if (!id) {
                const result = await taskFilesApi.register(
                  ctx,
                  registration(
                    mode,
                    source,
                    write.requestId(["register", signature]),
                  ),
                );
                id = result.asset?.id ?? "";
                if (!id) throw new Error("The file was not registered");
                registered.current.set(signature, id);
              }
              await assertFileContext(ctx);
            }
            const input = scopeInput(scope, id);
            input.requestId = write.requestId(["link", scope, id]);
            await fileViewerApi.link(ctx, input);
          }, close);
        }}
      >
        {register && (
          <div>
            <label htmlFor={sourceId}>File source</label>
            <Select
              id={sourceId}
              aria-label="Document source"
              value={mode}
              disabled={!write.ready}
              onChange={(e) => {
                setMode(e.target.value as FileStorageType);
                setSource("");
              }}
            >
              <option value="board_file">Copy into board</option>
              <option value="linked_file">Link in place</option>
              <option value="url">URL</option>
              <option value="existing">Pick registered file</option>
            </Select>
          </div>
        )}
        {mode === "existing" ? (
          <>
            <label>
              Search
              <input
                aria-label="Search documents"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div>
              <label htmlFor={kindId}>Kind</label>
              <Select
                id={kindId}
                aria-label="Document kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">Any</option>
                {assetKinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </div>
            {catalog.isPending && <p role="status">Reading documents…</p>}
            {catalog.error && (
              <>
                <p role="alert">{catalog.error.message}</p>
                <Button onClick={() => void catalog.refetch()}>
                  Retry documents
                </Button>
              </>
            )}
            <div className="link-options" role="listbox" aria-label="Documents">
              {visible.map((a) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === a.id}
                  key={a.id}
                  disabled={!write.ready}
                  onClick={() => setSelected(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
            {!catalog.isPending && !catalog.error && !visible.length && (
              <p>No matching documents.</p>
            )}
          </>
        ) : (
          <>
            <p className="small muted">
              {mode === "board_file"
                ? "Copy into the board; the source stays unchanged."
                : mode === "linked_file"
                  ? "Keep the file in your project."
                  : "A URL remains a link; nothing is downloaded."}
            </p>
            {mode !== "url" && (
              <Button
                disabled={!write.ready || picking}
                onClick={() => {
                  if (!c) return;
                  setPicking(true);
                  void (async () => {
                    await assertFileContext(c);
                    const paths = await api.pickFiles();
                    await assertFileContext(c);
                    setSource(paths[0] ?? "");
                  })()
                    .catch((e) => setError(String(e.message ?? e)))
                    .finally(() => setPicking(false));
                }}
              >
                Choose file…
              </Button>
            )}
            <label>
              {mode === "url" ? "URL" : "File path"}
              <input
                aria-label="Document source path"
                value={source}
                readOnly={mode !== "url"}
                disabled={!write.ready}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
          </>
        )}
        {(error || write.error || context.error) && (
          <p role="alert">
            {error || write.error?.message || context.error?.message}
          </p>
        )}
        {write.changed && (
          <p role="alert">The Files target changed. Reopen this dialog.</p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={
            !write.ready ||
            picking ||
            (mode === "existing"
              ? !selected || !catalog.data || !!catalog.error
              : !source ||
                (mode === "url" && !/^https?:\/\/[^\s]+$/i.test(source)))
          }
        >
          {register ? "Add document" : "Link document"}
        </Button>
      </form>
    </Dialog>
  );
}
