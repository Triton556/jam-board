import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { File, Link2, Plus, StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import type { ReferenceInput } from "../../lib/references-api";
import { useUiStore } from "../../lib/ui-store";
import { AddReferenceDialog } from "./dialogs";
import "./section.css";

function Thumb({ assetId, title }: { assetId: string | null; title: string }) {
  const image = useQuery({
    queryKey: ["assetPreview", assetId],
    queryFn: () =>
      assetId ? api.assetPreview(assetId) : Promise.resolve(null),
    enabled: !!assetId,
  });
  return image.data ? (
    <img className="linked-reference-thumb" src={image.data} alt={title} />
  ) : (
    <File size={24} />
  );
}
export function ReferencesSection({
  targetKey,
  epicKey,
  disabled = false,
}: {
  targetKey: string;
  epicKey: string;
  disabled?: boolean;
}) {
  const data = useQuery({
      queryKey: ["references"],
      queryFn: () => api.referenceCanvas(),
    }),
    epics = useQuery({ queryKey: ["epics"], queryFn: () => api.listEpics() }),
    stories = useQuery({
      queryKey: ["stories"],
      queryFn: () => api.listStories(),
    }),
    tasks = useQuery({
      queryKey: ["boardTasks"],
      queryFn: () => api.listBoardTasks(),
    }),
    client = useQueryClient(),
    navigate = useNavigate();
  const [picker, setPicker] = useState(false),
    [search, setSearch] = useState(""),
    [add, setAdd] = useState<"link" | "note" | null>(null),
    [error, setError] = useState("");
  const targets = useMemo(
    () => [
      ...(epics.data ?? []),
      ...(stories.data ?? []),
      ...Object.values(tasks.data ?? {}).flat(),
    ],
    [epics.data, stories.data, tasks.data],
  );
  const target = targets.find((t) => t.key === targetKey),
    epic = epics.data?.find((e) => e.key === epicKey),
    ancestorIds = new Set([
      target?.id,
      ...(targetKey.match(/-\d+$/)
        ? [epic?.id, target && "storyId" in target ? target.storyId : undefined]
        : []),
    ]),
    items =
      data.data?.items.filter(
        (i) =>
          data.data?.links.some(
            (l) => l.itemId === i.id && ancestorIds.has(l.targetId),
          ) ||
          data.data?.frames.some(
            (f) =>
              !f.archivedAt &&
              f.id === i.frameId &&
              ancestorIds.has(f.epicId ?? undefined),
          ),
      ) ?? [];
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["references"] });
    await client.invalidateQueries({ queryKey: ["task", targetKey] });
  };
  const create = async (input: ReferenceInput) => {
    await api.addReference({
      ...input,
      frameEpicKey: epic?.key,
      linkTo: targetKey,
    });
    await refresh();
    setPicker(false);
  };
  return (
    <section className="task-section references-section">
      <h2>
        References{" "}
        {!disabled && (
          <Button variant="ghost" onClick={() => setPicker(true)}>
            <Plus size={15} />
            Add reference
          </Button>
        )}
      </h2>
      <div className="linked-references">
        {items.map((item) => (
          <button
            type="button"
            className="linked-reference"
            key={item.id}
            onClick={() =>
              void navigate({ to: "/references", search: { section: item.id } })
            }
          >
            <Thumb assetId={item.assetId} title={item.title} />
            <span>{item.title}</span>
          </button>
        ))}
      </div>
      {!items.length && <p className="muted">No linked references yet.</p>}
      {picker && (
        <Dialog title="Add reference" onClose={() => setPicker(false)}>
          <div className="reference-picker-actions">
            <Button
              onClick={() =>
                void api
                  .pickFiles()
                  .then(async (paths) => {
                    for (const filePath of paths)
                      await create({ kind: "asset", filePath });
                  })
                  .catch((e) => setError(String(e)))
              }
            >
              <File size={16} />
              New file…
            </Button>
            <Button onClick={() => setAdd("link")}>
              <Link2 size={16} />
              New link…
            </Button>
            <Button onClick={() => setAdd("note")}>
              <StickyNote size={16} />
              New note
            </Button>
          </div>
          <label className="field">
            Search canvas
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="reference-picker-grid">
            {data.data?.items
              .filter((i) =>
                i.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((i) => (
                <Button
                  key={i.id}
                  className="reference-picker-row"
                  onClick={() =>
                    void api
                      .linkReference(i.id, targetKey)
                      .then(refresh)
                      .then(() => setPicker(false))
                      .catch((e) => useUiStore.getState().error(String(e)))
                  }
                >
                  <Thumb assetId={i.assetId} title={i.title} />
                  {i.title}
                </Button>
              ))}
          </div>
        </Dialog>
      )}
      {add && (
        <AddReferenceDialog
          kind={add}
          close={() => setAdd(null)}
          save={create}
        />
      )}
    </section>
  );
}
