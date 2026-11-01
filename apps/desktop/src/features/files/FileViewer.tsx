import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  History,
  MoreHorizontal,
  Pencil,
  Replace,
} from "lucide-react";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Button, Dialog, IconButton, Stamp } from "../../components/ui";
import {
  fileCatalogQuery,
  fileViewerApi,
  type Preview,
  useFileContext,
} from "../../lib/file-viewer-api";
import { storageLabel, taskFilesApi } from "../../lib/task-files-api";
import { FileAvailability } from "../task/TaskFiles";
import { AssetHistory } from "./AssetHistory";
import { AssetUsageList, type FileTarget } from "./AssetUsageList";
import { DeleteAssetDialog } from "./DeleteAssetDialog";
import { useFileAction, useFileMenu } from "./file-hooks";
import { ReplaceAssetDialog } from "./ReplaceAssetDialog";
import "./files.css";

export { useFileViewerRoute } from "./file-hooks";

function fileSize(bytes: number | null) {
  if (bytes == null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? "KB" : bytes < 1024 ** 3 ? "MB" : "GB";
  const divisor = unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : 1024 ** 3;
  return `${(bytes / divisor).toLocaleString("en", { maximumFractionDigits: 1 })} ${unit}`;
}

export function FilePreviewBody({
  preview,
  name,
  openExternal,
}: {
  preview: Preview;
  name: string;
  openExternal(): void;
}) {
  const [source, setSource] = useState(false),
    [zoom, setZoom] = useState(false);
  if (preview.type === "text") {
    const markdown =
      preview.mime.includes("markdown") || /\.(md|markdown)$/i.test(name);
    return (
      <div className="file-text">
        {markdown && (
          <Button aria-pressed={source} onClick={() => setSource(!source)}>
            Source
          </Button>
        )}
        {markdown && !source ? (
          <Markdown>{preview.text}</Markdown>
        ) : (
          <pre>{preview.text}</pre>
        )}
        {preview.truncated && (
          <p role="status">
            Showing the first 2 MiB. Open in default app to read the rest.
          </p>
        )}
      </div>
    );
  }
  if (preview.type === "media")
    return preview.mediaKind === "image" ? (
      <button
        type="button"
        className={`file-image ${zoom ? "at-size" : ""}`}
        aria-label={zoom ? "Fit image" : "View image at 100%"}
        aria-pressed={zoom}
        onClick={() => setZoom(!zoom)}
      >
        <img src={preview.url} alt={name} />
      </button>
    ) : (
      <div className="file-media">
        {preview.mediaKind === "audio" ? (
          <audio aria-label={name} controls src={preview.url}>
            <track kind="captions" />
          </audio>
        ) : (
          <video aria-label={name} controls src={preview.url}>
            <track kind="captions" />
          </video>
        )}
      </div>
    );
  if (preview.type === "url")
    return (
      <div className="file-metadata">
        <p className="mono">{preview.url}</p>
        <Button onClick={openExternal}>Open in browser</Button>
      </div>
    );
  return (
    <div className="file-metadata">
      <h3>{preview.name}</h3>
      <dl>
        <dt>Kind</dt>
        <dd>{preview.kind}</dd>
        <dt>Size</dt>
        <dd>{preview.byteSize ?? "Unknown"}</dd>
        <dt>Modified</dt>
        <dd>{preview.modifiedAt ?? "Unknown"}</dd>
        <dt>Path</dt>
        <dd className="mono">{preview.path}</dd>
      </dl>
      <Button onClick={openExternal}>Open in default app</Button>
    </div>
  );
}
export function FileViewer({
  assetId,
  onClose,
  openTarget,
}: {
  assetId: string;
  onClose(): void;
  openTarget(target: FileTarget): void;
}) {
  const context = useFileContext(),
    c = context.data;
  const catalog = useQuery(fileCatalogQuery(c, { includeArchived: true })),
    asset = catalog.data?.find((a) => a.id === assetId);
  const preview = useQuery({
    queryKey: ["file-assets", "preview", c, assetId, asset?.contentRevision],
    enabled: !!c,
    queryFn: () => {
      if (!c) throw new Error("No file context");
      return fileViewerApi.preview(c, assetId);
    },
  });
  const usage = useQuery({
    queryKey: ["file-assets", "usage", c, assetId],
    enabled: !!c,
    queryFn: () => {
      if (!c) throw new Error("No file context");
      return fileViewerApi.usage(c, assetId);
    },
  });
  const revisions = useQuery({
    queryKey: ["file-assets", "revisions", c, assetId],
    enabled: !!c && asset?.storageType === "board_file",
    queryFn: () => {
      if (!c) throw new Error("No file context");
      return fileViewerApi.revisions(c, assetId);
    },
  });
  const [child, setChild] = useState<"delete" | "replace" | "history">(),
    [menu, setMenu] = useState(false),
    [rename, setRename] = useState<string>(),
    [error, setError] = useState("");
  const write = useFileAction(c, `viewer:${assetId}`);
  const menuDismiss = useFileMenu(menu, () => setMenu(false));
  const external = (reveal = false) => {
    if (c)
      void taskFilesApi
        .open(c, assetId, reveal)
        .catch((e) => setError(String(e.message ?? e)));
  };
  const reload = () => {
    void context.refetch();
    void catalog.refetch();
    void preview.refetch();
  };
  return (
    <Dialog
      title={asset?.name ?? "File viewer"}
      className="file-viewer"
      busy={write.pending}
      onClose={() => {
        if (!child) write.dismiss(onClose);
      }}
    >
      {(context.error || catalog.error) && (
        <>
          <p role="alert">{context.error?.message ?? catalog.error?.message}</p>
          <Button onClick={reload}>Retry file</Button>
        </>
      )}
      {(context.isPending || catalog.isPending) && (
        <p role="status">Reading file…</p>
      )}
      {catalog.data && !asset && (
        <p role="alert">This file is no longer on the board.</p>
      )}
      {asset && c && (
        <>
          <header className="file-viewer-header">
            {rename !== undefined ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  write.run(
                    (ctx) =>
                      fileViewerApi.rename(ctx, {
                        assetId,
                        name: rename,
                        requestId: write.requestId(["rename", rename]),
                      }),
                    () => setRename(undefined),
                  );
                }}
              >
                <label>
                  Name
                  <input
                    autoFocus
                    aria-label="File name"
                    value={rename}
                    maxLength={140}
                    disabled={write.pending}
                    onChange={(e) => setRename(e.target.value)}
                  />
                </label>
                <p className="small muted">
                  Display name only. The file on disk keeps its name.
                </p>
                <div className="button-row">
                  <Button
                    type="submit"
                    disabled={!write.ready || !rename.trim()}
                  >
                    Save name
                  </Button>
                  <Button
                    disabled={write.pending}
                    onClick={() => setRename(undefined)}
                  >
                    Cancel rename
                  </Button>
                </div>
              </form>
            ) : (
              <IconButton label="Rename" onClick={() => setRename(asset.name)}>
                <Pencil size={16} />
              </IconButton>
            )}
            <div className="file-viewer-meta">
              <Stamp>{asset.kind}</Stamp>
              <Stamp>{storageLabel(asset.storageType)}</Stamp>
              {asset.archivedAt && <Stamp>Archived</Stamp>}
              <span>
                {fileSize(asset.byteSize)}
                {" · "}
                {asset.modifiedAt
                  ? `Modified ${new Date(asset.modifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                  : "Modified date unknown"}
              </span>
              <span>Revision {asset.contentRevision}</span>
            </div>
            <div className="button-row file-viewer-actions">
              <IconButton
                label="Open in default app"
                onClick={() => external()}
              >
                <ExternalLink size={18} />
              </IconButton>
              {asset.storageType !== "url" && (
                <IconButton
                  label="Show in folder"
                  onClick={() => external(true)}
                >
                  <FolderOpen size={18} />
                </IconButton>
              )}
              <IconButton
                label="Replace…"
                disabled={!write.ready}
                onClick={() => setChild("replace")}
              >
                <Replace size={18} />
              </IconButton>
              {asset.storageType === "board_file" &&
                !!revisions.data?.length && (
                  <IconButton
                    label="History"
                    onClick={() => setChild("history")}
                  >
                    <History size={18} />
                  </IconButton>
                )}
              {/* biome-ignore lint/a11y/useSemanticElements: This group owns a popup, not form fields. */}
              <div
                className="file-more"
                ref={menuDismiss.root}
                onKeyDown={menuDismiss.onKeyDown}
                role="group"
              >
                <IconButton
                  label="More file actions"
                  aria-expanded={menu}
                  onClick={(event) => {
                    menuDismiss.trigger.current = event.currentTarget;
                    setMenu(!menu);
                  }}
                >
                  <MoreHorizontal size={18} />
                </IconButton>
                {menu && (
                  <div
                    className="popover-menu"
                    role="menu"
                    tabIndex={-1}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setMenu(false);
                      }
                    }}
                  >
                    <Button
                      disabled={!write.ready}
                      onClick={() => {
                        setMenu(false);
                        write.run((ctx) =>
                          fileViewerApi.archive(
                            ctx,
                            {
                              assetId,
                              requestId: write.requestId([
                                "archive",
                                !asset.archivedAt,
                              ]),
                            },
                            !asset.archivedAt,
                          ),
                        );
                      }}
                    >
                      {asset.archivedAt ? "Unarchive" : "Archive"}
                    </Button>
                    <Button
                      disabled={!write.ready}
                      onClick={() => {
                        setMenu(false);
                        setChild("delete");
                      }}
                    >
                      Delete…
                    </Button>
                    <Button
                      onClick={() => {
                        setMenu(false);
                        void navigator.clipboard
                          .writeText(
                            asset.resolution.resolvedPath ?? asset.storedPath,
                          )
                          .catch((e) => setError(String(e)));
                      }}
                    >
                      <Copy size={16} />
                      Copy path
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </header>
          {(error || write.error) && (
            <p role="alert">{error || write.error?.message}</p>
          )}
          {write.changed && (
            <p role="alert">The Files target changed. Reopen this viewer.</p>
          )}
          <div className="file-viewer-content">
            <div className="file-viewer-body">
              {preview.isPending ? (
                <p role="status">Reading preview…</p>
              ) : preview.error ? (
                <div className="file-warning">
                  <FileAvailability asset={asset} />
                  <p role="alert">{preview.error.message}</p>
                  <div className="button-row">
                    <Button onClick={() => setChild("replace")}>Locate…</Button>
                    <Button onClick={() => setChild("delete")}>
                      Remove link
                    </Button>
                    <Button onClick={() => void preview.refetch()}>
                      Retry preview
                    </Button>
                  </div>
                </div>
              ) : (
                preview.data && (
                  <FilePreviewBody
                    key={`${assetId}:${asset.contentRevision}`}
                    preview={preview.data}
                    name={asset.originalName || asset.name}
                    openExternal={() => external()}
                  />
                )
              )}
            </div>
            <aside className="file-usage-rail">
              <h3>Used in</h3>
              {usage.isPending && <p role="status">Checking usage…</p>}
              {usage.error && (
                <>
                  <p role="alert">{usage.error.message}</p>
                  <Button onClick={() => void usage.refetch()}>
                    Retry usage
                  </Button>
                </>
              )}
              {usage.data && (
                <>
                  <AssetUsageList
                    usage={usage.data}
                    openTarget={(target) => {
                      onClose();
                      openTarget(target);
                    }}
                  />
                  {!Object.values(usage.data).some((rows) => rows.length) && (
                    <p className="muted">Not used</p>
                  )}
                </>
              )}
            </aside>
          </div>
          {child === "delete" && (
            <DeleteAssetDialog
              asset={asset}
              context={c}
              onClose={() => setChild(undefined)}
              onDeleted={onClose}
            />
          )}
          {child === "replace" && (
            <ReplaceAssetDialog
              asset={asset}
              context={c}
              onClose={() => setChild(undefined)}
            />
          )}
          {child === "history" && (
            <AssetHistory
              assetId={assetId}
              context={c}
              onClose={() => setChild(undefined)}
            />
          )}
        </>
      )}
    </Dialog>
  );
}
