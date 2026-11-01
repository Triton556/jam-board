import { useQuery } from "@tanstack/react-query";
import type { FileAsset } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import {
  type FileContext,
  fileViewerApi,
  usageCount,
} from "../../lib/file-viewer-api";
import { AssetUsageList } from "./AssetUsageList";
import { useFileAction } from "./file-hooks";
import "./files.css";

export function DeleteAssetDialog({
  asset,
  context,
  onClose,
  onDeleted = onClose,
}: {
  asset: FileAsset;
  context: FileContext;
  onClose(): void;
  onDeleted?(): void;
}) {
  const usage = useQuery({
    queryKey: ["file-assets", "usage", context, asset.id],
    queryFn: () => fileViewerApi.usage(context, asset.id),
  });
  const write = useFileAction(context, `delete:${asset.id}`),
    count = usage.data ? usageCount(usage.data) : 0;
  return (
    <Dialog
      title={`Delete ${asset.name}?`}
      onClose={() => write.dismiss(onClose)}
      busy={write.pending}
    >
      {usage.isPending ? (
        <p role="status">Checking usage…</p>
      ) : usage.error ? (
        <>
          <p role="alert">{usage.error.message}</p>
          <Button onClick={() => void usage.refetch()}>Retry usage</Button>
        </>
      ) : count ? (
        <>
          <p>
            Used in {count} {count === 1 ? "place" : "places"}
          </p>
          {usage.data && <AssetUsageList usage={usage.data} />}
        </>
      ) : (
        <p>This removes it from the board.</p>
      )}
      <p>
        {asset.storageType === "board_file"
          ? "The file moves to the board's trash folder."
          : asset.storageType === "linked_file"
            ? "The file in your project stays where it is."
            : ""}
      </p>
      {write.error && <p role="alert">{write.error.message}</p>}
      {write.changed && (
        <p role="alert">The Files target changed. Reopen this dialog.</p>
      )}
      <div className="dialog-actions">
        <Button disabled={write.pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="file-danger"
          disabled={
            !write.ready || !usage.data || usage.isFetching || !!usage.error
          }
          onClick={() =>
            write.run(
              (c) =>
                fileViewerApi.delete(c, {
                  assetId: asset.id,
                  requestId: write.requestId([asset.id, count]),
                  force: count > 0,
                }),
              onDeleted,
            )
          }
        >
          {count ? "Remove links and delete" : "Delete"}
        </Button>
      </div>
    </Dialog>
  );
}
