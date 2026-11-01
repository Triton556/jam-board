import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { type FileContext, fileViewerApi } from "../../lib/file-viewer-api";

export function AssetHistory({
  assetId,
  context,
  onClose,
}: {
  assetId: string;
  context: FileContext;
  onClose(): void;
}) {
  const rows = useQuery({
      queryKey: ["file-assets", "revisions", context, assetId],
      queryFn: () => fileViewerApi.revisions(context, assetId),
    }),
    [error, setError] = useState("");
  return (
    <Dialog title="History" onClose={onClose} className="file-history">
      {rows.isPending && <p role="status">Reading history…</p>}
      {rows.error && (
        <>
          <p role="alert">{rows.error.message}</p>
          <Button onClick={() => void rows.refetch()}>Retry history</Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {rows.data?.length === 0 && <p>No previous versions.</p>}
      {rows.data?.map((row) => (
        <section key={row.revision}>
          <h3>Revision {row.revision}</h3>
          <p>
            {new Date(row.createdAt).toLocaleString("en")} ·{" "}
            {row.byteSize == null ? "Unknown size" : `${row.byteSize} bytes`} ·{" "}
            {row.createdBy}
          </p>
          <div className="button-row">
            {[false, true].map((reveal) => (
              <Button
                key={String(reveal)}
                onClick={() =>
                  void fileViewerApi
                    .revision(context, assetId, row.revision, reveal)
                    .catch((e) => setError(String(e.message ?? e)))
                }
              >
                {reveal ? "Show in folder" : "Open"}
              </Button>
            ))}
          </div>
        </section>
      ))}
    </Dialog>
  );
}
