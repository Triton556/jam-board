import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  File,
  Frame,
  Image,
  Link,
  StickyNote,
  Type,
  Unlink,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefFrame, RefItem } from "../../bindings";
import { Button, Dialog, Tooltip } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
import { appQuery } from "../../lib/queries";
import type { ReferenceInput } from "../../lib/references-api";
import { useProjectWrite } from "../../lib/use-project-write";
import { referenceLinkActions } from "./canvas-actions";
import { AddReferenceDialog } from "./dialogs";
import {
  type BoardRefDrop,
  canvasPick,
  dropChoices,
  frameTargets,
  type ReferenceChoice,
} from "./linking";
import { getCanvasHistory, referenceKind, referenceLabel } from "./model";
import { ReferencePopover } from "./ReferencePopover";
import "./section.css";

const typeIcons = {
  note: StickyNote,
  link: Link,
  file: File,
  image: Image,
  audio: AudioLines,
  video: Video,
  font: Type,
};
export function ReferenceThumb({
  item,
  path = "",
}: {
  item: RefItem;
  path?: string;
}) {
  const kind = referenceKind(item, path);
  const image = useQuery({
    queryKey: ["assetPreview", item.assetId],
    queryFn: () =>
      item.assetId ? api.assetPreview(item.assetId) : Promise.resolve(null),
    enabled: kind === "image" && !!item.assetId,
  });
  const Icon = typeIcons[kind];
  return kind === "image" && image.data ? (
    <img
      className="linked-reference-thumb"
      src={image.data}
      alt={referenceLabel(item)}
      draggable={false}
    />
  ) : (
    <span
      className="linked-reference-type"
      role="img"
      aria-label={`${kind} reference`}
      data-reference-kind={kind}
    >
      <Icon size={24} aria-hidden="true" />
    </span>
  );
}
export function FrameMosaic({
  frame,
  items,
  paths,
  imagesFirst = false,
}: {
  frame: RefFrame;
  items: RefItem[];
  paths: Map<string, string>;
  imagesFirst?: boolean;
}) {
  const children = items
    .filter((item) => item.frameId === frame.id && !item.archivedAt)
    .sort(
      (a, b) =>
        (a.y ?? 0) - (b.y ?? 0) ||
        (a.x ?? 0) - (b.x ?? 0) ||
        (a.position ?? 0) - (b.position ?? 0),
    );
  const images = children.filter(
    (item) => referenceKind(item, paths.get(item.assetId ?? "")) === "image",
  );
  const tiles = (imagesFirst && images.length ? images : children).slice(0, 4);
  return (
    <span
      className={`reference-frame-mosaic ${tiles.length <= 1 ? "is-single" : ""}`}
      role="img"
      aria-label={`${frame.title} preview`}
    >
      {tiles.map((item) => (
        <span key={item.id}>
          <ReferenceThumb item={item} path={paths.get(item.assetId ?? "")} />
        </span>
      ))}
      {!tiles.length && (
        <span>
          <Frame size={24} aria-label="Empty frame" />
        </span>
      )}
    </span>
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
  });
  const app = useQuery(appQuery);
  const epics = useQuery({
    queryKey: ["epics"],
    queryFn: () => api.listEpics(),
  });
  const stories = useQuery({
    queryKey: ["stories"],
    queryFn: () => api.listStories(),
  });
  const tasks = useQuery({
    queryKey: ["boardTasks"],
    queryFn: () => api.listBoardTasks(),
  });
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.listAssets(),
  });
  const paths = new Map(
    assets.data?.map((asset) => [asset.id, asset.location]),
  );
  const client = useQueryClient(),
    navigate = useNavigate();
  const returnTo = useRouterState({ select: (state) => state.location.href });
  const write = useProjectWrite(`reference-picker:${targetKey}`);
  const form = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState(false),
    [tab, setTab] = useState<"frame" | "item">("frame"),
    [search, setSearch] = useState("");
  const [selection, setSelection] = useState<ReferenceChoice[]>([]),
    [add, setAdd] = useState<"link" | "note" | null>(null);
  const targets = useMemo(
    () => [
      ...(epics.data ?? []),
      ...(stories.data ?? []),
      ...Object.values(tasks.data ?? {}).flat(),
    ],
    [epics.data, stories.data, tasks.data],
  );
  const target = targets.find((row) => row.key === targetKey),
    epic = epics.data?.find((row) => row.key === epicKey);
  const ancestorIds = new Set(
    [
      target?.id,
      epic?.id,
      target && "storyId" in target ? target.storyId : undefined,
    ].filter((id): id is string => !!id),
  );
  const ancestorKeys = new Set(
    targets.filter((row) => ancestorIds.has(row.id)).map((row) => row.key),
  );
  const frames =
    data.data?.frames.filter(
      (frame) =>
        !frame.archivedAt &&
        (ancestorIds.has(frame.epicId ?? "") ||
          frameTargets(frame).some((link) => ancestorKeys.has(link.targetKey))),
    ) ?? [];
  const directIds = new Set(
    data.data?.links
      .filter((link) => !link.archivedAt && link.targetId === target?.id)
      .map((link) => link.itemId),
  );
  const items =
    data.data?.items.filter(
      (item) =>
        !item.archivedAt &&
        directIds.has(item.id) &&
        !frames.some((frame) => frame.id === item.frameId),
    ) ?? [];
  const removeItemLink = (item: RefItem) =>
    write.run(
      () => api.unlinkReference(item.id, targetKey),
      () => {
        void refresh();
      },
    );
  const openItem = (item: RefItem) =>
    void navigate({ to: "/references", search: { section: item.id } });
  const itemRow = (item: RefItem, nested = false) => (
    <div
      className={nested ? "linked-frame-child" : "linked-reference"}
      key={item.id}
    >
      <ReferenceThumb item={item} path={paths.get(item.assetId ?? "")} />
      <div className="linked-reference-content">
        <button
          type="button"
          className="linked-reference-open"
          onClick={() => openItem(item)}
          title="Open on canvas"
        >
          {referenceLabel(item)}
        </button>
        <small>{directIds.has(item.id) ? "Direct" : "via frame"}</small>
      </div>
      {!disabled && directIds.has(item.id) && (
        <Tooltip text="Remove this direct link; keep the reference">
          <Button
            variant="ghost"
            className="reference-section-action"
            disabled={!write.ready}
            onClick={() => removeItemLink(item)}
          >
            <Unlink size={14} aria-hidden="true" /> Remove link
          </Button>
        </Tooltip>
      )}
    </div>
  );
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["references"] });
    await client.invalidateQueries({ queryKey: ["task", targetKey] });
  };
  const create = async (input: ReferenceInput) => {
    await api.addReference({ ...input, linkTo: targetKey });
    await refresh();
  };
  const linkSelected = async (choices: ReferenceChoice[], key: string) => {
    const projectId = app.data?.jam?.id;
    if (
      !projectId ||
      !data.data ||
      (await api.appState()).jam?.id !== projectId
    )
      throw Error("The project changed before linking.");
    const resolved = targets.some((target) => target.key === key)
      ? targets
      : [
          ...(await api.listEpics()),
          ...(await api.listStories()),
          ...Object.values(await api.listBoardTasks()).flat(),
        ];
    const actions = referenceLinkActions(choices, key, data.data, resolved);
    await getCanvasHistory(projectId).perform(
      "Link references",
      actions.map((action) => ({
        ...action,
        redo: async () => {
          if ((await api.appState()).jam?.id !== projectId)
            throw Error("The project changed before linking finished.");
          return action.redo();
        },
      })),
    );
  };
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<BoardRefDrop>).detail;
      if (detail?.target !== "drawer-references" || disabled || !write.ready)
        return;
      const choices = dropChoices(detail.refs);
      if (choices.length)
        write.run(
          () => linkSelected(choices, targetKey),
          () => {
            void refresh();
          },
        );
    };
    window.addEventListener("jam:board-ref-drop", receive);
    return () => window.removeEventListener("jam:board-ref-drop", receive);
  });
  useEffect(() => {
    if (picker) form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [picker]);
  const toggle = (choice: ReferenceChoice) =>
    setSelection((current) =>
      current.some((row) => row.id === choice.id && row.kind === choice.kind)
        ? current.filter(
            (row) => row.id !== choice.id || row.kind !== choice.kind,
          )
        : [...current, choice],
    );
  const rows =
    (tab === "frame" ? data.data?.frames : data.data?.items)?.filter(
      (row) =>
        !row.archivedAt &&
        `${row.title} ${"kind" in row && row.kind === "note" && "captionMd" in row ? row.captionMd : ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <section
      className="task-section references-section"
      data-board-ref-drop={disabled ? undefined : "drawer-references"}
    >
      <div className="reference-section-heading">
        <h2>References</h2>
        {!disabled && (
          <ReferencePopover
            label="Add"
            trigger={
              <>
                Add <ChevronDown size={14} />
              </>
            }
            className="reference-section-add"
            tooltip="Add references"
          >
            {(close) => (
              <>
                <button
                  role="menuitem"
                  type="button"
                  disabled={!write.ready}
                  onClick={() => {
                    close();
                    setPicker(true);
                    void data.refetch({ cancelRefetch: false });
                    void assets.refetch({ cancelRefetch: false });
                    setSelection([]);
                    setSearch("");
                    setTab("frame");
                  }}
                >
                  From canvas…
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={!write.ready}
                  onClick={() => {
                    close();
                    if (!app.data?.jam) return;
                    canvasPick.set({
                      projectId: app.data.jam.id,
                      targetKey,
                      returnTo,
                    });
                    void navigate({ to: "/references" });
                  }}
                >
                  Pick on canvas
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={!write.ready}
                  onClick={() => {
                    close();
                    write.run(async () => {
                      const paths = await api.pickFiles();
                      for (const filePath of paths)
                        await create({ kind: "asset", filePath });
                    });
                  }}
                >
                  Upload file
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={!write.ready}
                  onClick={() => {
                    close();
                    setAdd("link");
                  }}
                >
                  Add link
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={!write.ready}
                  onClick={() => {
                    close();
                    setAdd("note");
                  }}
                >
                  New note
                </button>
              </>
            )}
          </ReferencePopover>
        )}
      </div>
      <div className="reference-drop-zone">
        <p className="reference-drop-hint">Drop to link to {targetKey}</p>
        <div className="linked-references">
          {frames.map((frame) => {
            const children =
              data.data?.items.filter(
                (item) => item.frameId === frame.id && !item.archivedAt,
              ) ?? [];
            return (
              <article className="linked-reference linked-frame" key={frame.id}>
                <FrameMosaic frame={frame} items={children} paths={paths} />
                <div className="linked-frame-content">
                  <strong>{frame.title}</strong>
                  <details className="linked-frame-items">
                    <summary title="Show or hide frame contents">
                      {children.length}{" "}
                      {children.length === 1 ? "item" : "items"}{" "}
                      <ChevronDown size={14} aria-hidden="true" />
                    </summary>
                    <div className="linked-frame-children">
                      {children.map((item) => itemRow(item, true))}
                    </div>
                  </details>
                  <div className="linked-frame-card-actions">
                    <Tooltip text="Open this frame on canvas">
                      <Button
                        variant="ghost"
                        className="reference-section-action"
                        onClick={() =>
                          void navigate({
                            to: "/references",
                            search: { section: frame.id },
                          })
                        }
                      >
                        <ArrowUpRight size={14} aria-hidden="true" /> Open on
                        canvas
                      </Button>
                    </Tooltip>
                    {!disabled &&
                      (frameTargets(frame).some(
                        (link) => link.targetKey === targetKey,
                      ) ||
                        frame.epicId === target?.id) && (
                        <Tooltip text="Remove this frame link; keep the frame and its items">
                          <Button
                            variant="ghost"
                            className="reference-section-action"
                            disabled={!write.ready}
                            onClick={() =>
                              write.run(
                                () => api.unlinkRefFrame(frame.id, targetKey),
                                () => {
                                  void refresh();
                                },
                              )
                            }
                          >
                            <Unlink size={14} aria-hidden="true" /> Remove link
                          </Button>
                        </Tooltip>
                      )}
                  </div>
                </div>
              </article>
            );
          })}
          {items.map((item) => itemRow(item))}
        </div>
        {data.isPending ? (
          <p role="status">Loading references…</p>
        ) : data.error ? (
          <p role="alert">
            Could not load references.{" "}
            <Button onClick={() => void data.refetch()}>Retry</Button>
          </p>
        ) : (
          !items.length &&
          !frames.length && <p className="muted">No linked references yet.</p>
        )}
      </div>
      {!picker && (
        <ProjectWriteFeedback
          write={write}
          action="Updating references"
          form={form}
        />
      )}
      {picker && (
        <Dialog
          title="From canvas"
          busy={write.pending}
          onClose={() => write.dismiss(() => setPicker(false))}
        >
          {/* Keyboard Enter submits the selected references from the search field. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: This handler supplies the dialog's Enter action; actual controls retain their native semantics. */}
          <div
            ref={form}
            className="reference-canvas-picker"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target instanceof HTMLInputElement &&
                event.target.type !== "checkbox" &&
                selection.length
              ) {
                event.preventDefault();
                write.run(
                  () => linkSelected(selection, targetKey),
                  () => {
                    void refresh();
                    setPicker(false);
                  },
                );
              }
            }}
          >
            <label className="field">
              Search canvas
              <input
                data-autofocus
                data-write-focus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div role="tablist" aria-label="Canvas references">
              {(["frame", "item"] as const).map((value) => (
                <button
                  type="button"
                  role="tab"
                  id={`reference-${value}-tab`}
                  aria-selected={tab === value}
                  aria-controls="reference-picker-panel"
                  tabIndex={tab === value ? 0 : -1}
                  key={value}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => {
                    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                      event.preventDefault();
                      const next = value === "frame" ? "item" : "frame";
                      setTab(next);
                      document.getElementById(`reference-${next}-tab`)?.focus();
                    }
                  }}
                >
                  {value === "frame" ? "Frames" : "Items"}
                </button>
              ))}
            </div>
            <div
              id="reference-picker-panel"
              role="tabpanel"
              aria-labelledby={`reference-${tab}-tab`}
              className="reference-picker-grid"
            >
              {rows.map((row) => (
                <label className="reference-picker-row" key={row.id}>
                  <input
                    type="checkbox"
                    aria-label={
                      tab === "frame"
                        ? row.title
                        : referenceLabel(row as RefItem)
                    }
                    checked={selection.some(
                      (choice) => choice.id === row.id && choice.kind === tab,
                    )}
                    onChange={() => toggle({ id: row.id, kind: tab })}
                    disabled={!write.ready}
                  />
                  {tab === "frame" ? (
                    <FrameMosaic
                      imagesFirst
                      frame={row as RefFrame}
                      items={data.data?.items ?? []}
                      paths={paths}
                    />
                  ) : (
                    <ReferenceThumb
                      item={row as RefItem}
                      path={paths.get((row as RefItem).assetId ?? "")}
                    />
                  )}
                  <span>
                    {tab === "frame"
                      ? row.title
                      : referenceLabel(row as RefItem)}
                    {tab === "frame" && (
                      <small className="reference-picker-count">
                        {data.data?.items.filter(
                          (item) => item.frameId === row.id && !item.archivedAt,
                        ).length ?? 0}{" "}
                        {(data.data?.items.filter(
                          (item) => item.frameId === row.id && !item.archivedAt,
                        ).length ?? 0) === 1
                          ? "item"
                          : "items"}
                      </small>
                    )}
                  </span>
                </label>
              ))}
              {!rows.length && (
                <p className="muted">
                  No {tab === "frame" ? "frames" : "items"} match your search.
                </p>
              )}
            </div>
            <ProjectWriteFeedback
              write={write}
              action="Linking references"
              form={form}
            />
            <div className="reference-picker-footer">
              <Button onClick={() => write.dismiss(() => setPicker(false))}>
                Cancel
              </Button>
              <Tooltip
                text={
                  selection.length
                    ? "Link selected references"
                    : "Select items or frames first"
                }
              >
                <Button
                  variant="primary"
                  disabled={!selection.length || !write.ready}
                  onClick={() =>
                    write.run(
                      () => linkSelected(selection, targetKey),
                      () => {
                        void refresh();
                        setPicker(false);
                      },
                    )
                  }
                >
                  Link {selection.length}
                </Button>
              </Tooltip>
            </div>
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
