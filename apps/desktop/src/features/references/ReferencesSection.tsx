import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { File, Link2, Plus, StickyNote } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
import { appQuery } from "../../lib/queries";
import type { ReferenceInput } from "../../lib/references-api";
import { useProjectWrite } from "../../lib/use-project-write";
import { AddReferenceDialog } from "./dialogs";
import { referenceLabel } from "./model";
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
type SectionProps = { targetKey: string; epicKey: string; disabled?: boolean };
export function ReferencesSection(props: SectionProps) {
  const app = useQuery(appQuery);
  return (
    <ReferenceTargetSection
      key={`${app.data?.jam?.id ?? "loading"}:${props.targetKey}`}
      {...props}
    />
  );
}
function ReferenceTargetSection({
  targetKey,
  epicKey,
  disabled = false,
}: SectionProps) {
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
  const write = useProjectWrite(`reference-picker:${targetKey}`);
  const pickerContent = useRef<HTMLDivElement>(null);
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
            <Thumb assetId={item.assetId} title={referenceLabel(item)} />
            <span>{referenceLabel(item)}</span>
          </button>
        ))}
      </div>
      {!items.length && <p className="muted">No linked references yet.</p>}
      {picker && (
        <Dialog
          title="Add reference"
          busy={write.pending}
          onClose={() => write.dismiss(() => setPicker(false))}
        >
          <div ref={pickerContent}>
            <div className="reference-picker-actions">
              <Button
                disabled={!write.ready}
                onClick={() =>
                  void api
                    .pickFiles()
                    .then(async (paths) => {
                      for (const filePath of paths)
                        await create({ kind: "asset", filePath });
                      if (paths.length) setPicker(false);
                    })
                    .catch((e) => setError(String(e)))
                }
              >
                <File size={16} />
                New file…
              </Button>
              <Button disabled={!write.ready} onClick={() => setAdd("link")}>
                <Link2 size={16} />
                New link…
              </Button>
              <Button disabled={!write.ready} onClick={() => setAdd("note")}>
                <StickyNote size={16} />
                New note
              </Button>
            </div>
            <label className="field">
              Search canvas
              <input
                autoFocus
                data-write-focus
                disabled={!write.ready}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <ProjectWriteFeedback
              write={write}
              action="Linking reference"
              form={pickerContent}
            />
            <div className="reference-picker-grid">
              {data.data?.items
                .filter((i) =>
                  (i.title + (i.kind === "note" ? `\n${i.captionMd}` : ""))
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((i) => (
                  <Button
                    key={i.id}
                    className="reference-picker-row"
                    disabled={!write.ready}
                    onClick={() =>
                      write.run(
                        () => api.linkReference(i.id, targetKey),
                        () => {
                          void refresh();
                          setPicker(false);
                        },
                      )
                    }
                  >
                    <Thumb assetId={i.assetId} title={referenceLabel(i)} />
                    {referenceLabel(i)}
                  </Button>
                ))}
            </div>
          </div>
        </Dialog>
      )}
      {add && (
        <AddReferenceDialog
          kind={add}
          close={() => setAdd(null)}
          save={create}
          onSaved={() => setPicker(false)}
        />
      )}
    </section>
  );
}
