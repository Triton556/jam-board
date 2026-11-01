import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, IconButton } from "../../components/ui";
import {
  fileCatalogQuery,
  fileViewerApi,
  useFileContext,
} from "../../lib/file-viewer-api";
import { taskFilesApi } from "../../lib/task-files-api";
import { DeleteAssetDialog } from "../files/DeleteAssetDialog";
import {
  useFileAction,
  useFileMenu,
  useOpenFileViewer,
} from "../files/file-hooks";
import { ReplaceAssetDialog } from "../files/ReplaceAssetDialog";

export function AssetActions({
  assetId,
  name,
  link,
}: {
  assetId: string;
  name: string;
  link?(): void;
}) {
  const context = useFileContext(),
    c = context.data,
    catalog = useQuery(fileCatalogQuery(c, { includeArchived: true })),
    asset = catalog.data?.find((a) => a.id === assetId);
  const write = useFileAction(c, `asset-actions:${assetId}`),
    openFile = useOpenFileViewer();
  const [menu, setMenu] = useState(false),
    [child, setChild] = useState<"rename" | "replace" | "delete">(),
    [newName, setName] = useState(name),
    [error, setError] = useState("");
  const menuDismiss = useFileMenu(menu, () => setMenu(false));
  return (
    // biome-ignore lint/a11y/useSemanticElements: This group owns a popup, not form fields.
    <div
      className="asset-menu"
      ref={menuDismiss.root}
      onKeyDown={menuDismiss.onKeyDown}
      role="group"
    >
      <IconButton
        label={`Menu for ${name}`}
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
            onClick={() => {
              setMenu(false);
              openFile(assetId);
            }}
          >
            Open in app
          </Button>
          {asset?.storageType !== "url" && (
            <Button
              disabled={!c || !asset}
              onClick={() => {
                setMenu(false);
                if (c)
                  void taskFilesApi
                    .open(c, assetId, true)
                    .catch((e) => setError(String(e.message ?? e)));
              }}
            >
              Show in folder
            </Button>
          )}
          <Button
            disabled={!write.ready || !asset}
            onClick={() => {
              setMenu(false);
              setName(asset?.name ?? name);
              setChild("rename");
            }}
          >
            Rename
          </Button>
          <Button
            disabled={!write.ready || !asset}
            onClick={() => {
              setMenu(false);
              setChild("replace");
            }}
          >
            Replace…
          </Button>
          <Button
            disabled={!write.ready || !asset}
            onClick={() => {
              setMenu(false);
              write.run((ctx) =>
                fileViewerApi.archive(
                  ctx,
                  {
                    assetId,
                    requestId: write.requestId(["archive", !asset?.archivedAt]),
                  },
                  !asset?.archivedAt,
                ),
              );
            }}
          >
            {asset?.archivedAt ? "Unarchive" : "Archive"}
          </Button>
          <Button
            disabled={!write.ready || !asset}
            onClick={() => {
              setMenu(false);
              setChild("delete");
            }}
          >
            Delete…
          </Button>
          {link && (
            <Button
              onClick={() => {
                setMenu(false);
                link();
              }}
            >
              Link to task…
            </Button>
          )}
        </div>
      )}
      {(error || write.error) && (
        <p role="alert">{error || write.error?.message}</p>
      )}
      {child === "rename" && (
        <Dialog
          title={`Rename ${name}`}
          busy={write.pending}
          onClose={() => setChild(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              write.run(
                (ctx) =>
                  fileViewerApi.rename(ctx, {
                    assetId,
                    name: newName,
                    requestId: write.requestId(["rename", newName]),
                  }),
                () => setChild(undefined),
              );
            }}
          >
            <label>
              Name
              <input
                aria-label="File name"
                value={newName}
                maxLength={140}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p>Display name only. The file on disk keeps its name.</p>
            {write.error && <p role="alert">{write.error.message}</p>}
            <Button type="submit" disabled={!write.ready || !newName.trim()}>
              Save name
            </Button>
          </form>
        </Dialog>
      )}
      {c && asset && child === "replace" && (
        <ReplaceAssetDialog
          asset={asset}
          context={c}
          onClose={() => setChild(undefined)}
        />
      )}
      {c && asset && child === "delete" && (
        <DeleteAssetDialog
          asset={asset}
          context={c}
          onClose={() => setChild(undefined)}
        />
      )}
    </div>
  );
}
