import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
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
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(""),
    [selected, setSelected] = useState("");
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
    options.some((o) => o.id === selected);
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
          const input = {
            assetId: assetId ?? selected,
            taskKey: taskKey ?? selected,
          };
          write.run(
            () => api.linkAsset(input),
            () => {
              void client.invalidateQueries({ queryKey: ["assets"] });
              if (taskKey)
                void client.invalidateQueries({ queryKey: ["task", taskKey] });
              close();
            },
          );
        }}
      >
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
        <ProjectWriteFeedback
          write={write}
          action="Linking asset"
          form={form}
        />
        <Button type="submit" variant="primary" disabled={!canSave}>
          Link
        </Button>
      </form>
    </Dialog>
  );
}
