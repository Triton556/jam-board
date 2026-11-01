import { useCallback, useEffect, useRef, useState } from "react";
import type { FileAsset } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import {
  assertFileContext,
  type FileContext,
  fileViewerApi,
  pickReplacement,
} from "../../lib/file-viewer-api";
import { useFileAction } from "./file-hooks";

export function ReplaceAssetDialog({
  asset,
  context,
  onClose,
}: {
  asset: FileAsset;
  context: FileContext;
  onClose(): void;
}) {
  const [source, setSource] = useState(""),
    [error, setError] = useState(""),
    [picking, setPicking] = useState(false);
  const write = useFileAction(context, `replace:${asset.id}`),
    url = asset.storageType === "url";
  const started = useRef(false);
  const choose = useCallback(() => {
    setPicking(true);
    void (async () => {
      await assertFileContext(context);
      const path = await pickReplacement();
      await assertFileContext(context);
      if (path) setSource(path);
    })()
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setPicking(false));
  }, [context]);
  useEffect(() => {
    if (!url && write.ready && !started.current) {
      started.current = true;
      choose();
    }
  }, [url, write.ready, choose]);
  return (
    <Dialog
      title={`Replace ${asset.name}`}
      busy={write.pending || picking}
      onClose={() => write.dismiss(onClose)}
    >
      {url ? (
        <label>
          URL
          <input
            aria-label="Replacement URL"
            type="url"
            value={source}
            disabled={!write.ready}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
      ) : (
        <Button disabled={!write.ready || picking} onClick={choose}>
          Choose replacement…
        </Button>
      )}
      {source && (
        <p>
          {asset.storageType === "board_file"
            ? `Replace with ${source.split(/[\\/]/).at(-1)}? The current version is kept in History.`
            : `Replace with ${source}?`}
        </p>
      )}
      {(error || write.error) && (
        <p role="alert">{error || write.error?.message}</p>
      )}
      {write.changed && (
        <p role="alert">The Files target changed. Reopen this dialog.</p>
      )}
      <div className="dialog-actions">
        <Button disabled={write.pending || picking} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={
            !write.ready ||
            picking ||
            !source ||
            (url && !/^https?:\/\/[^\s]+$/i.test(source))
          }
          onClick={() =>
            write.run(
              (c) =>
                fileViewerApi.replace(c, {
                  assetId: asset.id,
                  sourcePath: url ? null : source,
                  url: url ? source : null,
                  requestId: write.requestId(source),
                }),
              onClose,
            )
          }
        >
          Replace
        </Button>
      </div>
    </Dialog>
  );
}
