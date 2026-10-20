import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
export function AssetLinkDialog({
  assetId,
  taskKey,
  close,
}: {
  assetId?: string;
  taskKey?: string;
  close(): void;
}) {
  const client = useQueryClient();
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.listAssets(),
  });
  const tasks = useQuery({
    queryKey: ["boardTasks"],
    queryFn: () => api.listBoardTasks(),
  });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const options = assetId
    ? Object.values(tasks.data ?? {})
        .flat()
        .map((t) => ({ id: t.key, label: `${t.key} · ${t.title}` }))
    : (assets.data ?? []).map((a) => ({ id: a.id, label: a.name }));
  const save = useMutation({
    mutationFn: () =>
      api.linkAsset({
        assetId: assetId ?? selected,
        taskKey: taskKey ?? selected,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["assets"] });
      if (taskKey)
        await client.invalidateQueries({ queryKey: ["task", taskKey] });
      close();
    },
  });
  return (
    <Dialog title={assetId ? "Link to task" : "Link asset"} onClose={close}>
      <div className="m5-form">
        <label>
          Search
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls="asset-link-options"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div
          id="asset-link-options"
          className="link-options"
          role="listbox"
          aria-label={assetId ? "Tasks" : "Assets"}
        >
          {options
            .filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
            .map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={selected === o.id}
                onClick={() => setSelected(o.id)}
              >
                {o.label}
              </button>
            ))}
        </div>
        {save.error && <p role="alert">{save.error.message}</p>}
        <Button
          variant="primary"
          disabled={!selected || save.isPending}
          onClick={() => save.mutate()}
        >
          Link
        </Button>
      </div>
    </Dialog>
  );
}
