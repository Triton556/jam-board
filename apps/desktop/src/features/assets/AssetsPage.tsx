import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Box,
  ChevronDown,
  ChevronRight,
  FileText,
  Image,
  LayoutGrid,
  List,
  Map as MapIcon,
  Package,
  Type,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import type { AssetUsage, FileAsset } from "../../bindings";
import {
  Button,
  Dialog,
  EmptyState,
  SegmentedControl,
  Select,
  Stamp,
  TabPanels,
  Tabs,
} from "../../components/ui";
import { QueryError } from "../../components/ui/AsyncState";
import { FileDropZone, PageHeading } from "../../components/ui/m5";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { ReadReceipt } from "../../components/ui/ReadReceipt";
import { api } from "../../lib/api";
import { FileDropProgress, useFileDropBatch } from "../../lib/file-drop-batch";
import { fileViewerApi } from "../../lib/file-viewer-api";
import { appQuery, useBoardSettings } from "../../lib/queries";
import {
  type FileRole,
  fileRoleLabels,
  storageLabel,
  taskFilesApi,
} from "../../lib/task-files-api";
import type { Asset, AssetWithTasks } from "../../lib/types";
import { useExplicitRead } from "../../lib/use-explicit-read";
import { useProjectWrite } from "../../lib/use-project-write";
import { useOpenFileViewer } from "../files/file-hooks";
import { useTableVirtualizer } from "../table/use-table-virtualizer";
import { FileAvailability } from "../task/TaskFiles";
import { AssetActions } from "./AssetActions";
import { AssetLinkDialog } from "./AssetLinkDialog";
import { assetKind, assetKinds, assetName, assetSchema } from "./model";
import "../files/files.css";

const icons = {
  sprite: Image,
  audio: AudioLines,
  video: Video,
  level: MapIcon,
  font: Type,
  model: Box,
  document: FileText,
  other: Package,
};
export const assetColors = {
  sprite: "rose",
  audio: "sky",
  video: "lilac",
  level: "mint",
  font: "lilac",
  model: "mint",
  document: "butter",
  other: "butter",
};
export function AssetDialog({
  asset,
  close,
}: {
  asset?: Asset;
  close(): void;
}) {
  const locationTabs = useId();
  const client = useQueryClient();
  const form = useForm<z.infer<typeof assetSchema>>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      mode: asset?.location.toLowerCase().startsWith("http") ? "URL" : "File",
      name: asset?.name ?? "",
      location: asset?.location ?? "",
      notes: asset?.notes ?? "",
      kind: (asset?.kind as (typeof assetKinds)[number]) ?? "other",
    },
  });
  const mode = form.watch("mode");
  const write = useProjectWrite(`asset:${asset?.id ?? "new"}`);
  const formElement = useRef<HTMLFormElement>(null),
    manuallyChosenKind = useRef(false);
  const submit = () => {
    if (write.isLocked()) return;
    form.clearErrors();
    const parsed = assetSchema.safeParse(form.getValues());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof z.infer<typeof assetSchema>;
        form.setError(field, { message: issue.message });
      }
      const field = parsed.error.issues[0]?.path[0] as keyof z.infer<
        typeof assetSchema
      >;
      if (field) form.setFocus(field);
      return;
    }
    const v = parsed.data;
    write.run(
      async () => {
        if (asset)
          await api.updateAsset({
            id: asset.id,
            name: v.name,
            notes: v.notes,
            kind: v.kind,
          });
        else
          await api.createAsset({
            name: v.name,
            location: v.location,
            kind: v.kind,
            notes: v.notes || null,
          });
      },
      () => {
        void client.invalidateQueries({ queryKey: ["assets"] });
        close();
      },
    );
  };
  const choose = async () => {
    const path = await api.pickFile(false);
    if (path) {
      form.setValue("location", path, { shouldValidate: true });
      form.setValue("name", assetName(path));
      if (!manuallyChosenKind.current) form.setValue("kind", assetKind(path));
    }
  };
  return (
    <Dialog
      title={asset ? "Edit asset" : "Add asset"}
      busy={write.pending}
      onClose={() => write.dismiss(close)}
    >
      <form
        className="m5-form"
        ref={formElement}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {!asset && (
          <Tabs
            id={locationTabs}
            label="Asset source"
            disabled={!write.ready}
            value={mode}
            onChange={(v) => form.setValue("mode", v as "File" | "URL")}
            items={["File", "URL"]}
          />
        )}
        <TabPanels
          id={locationTabs}
          value={mode}
          items={asset ? [] : ["File", "URL"]}
        >
          <label>
            {mode === "URL" ? "URL" : "File path"}
            <input
              aria-label="Asset location"
              {...form.register("location")}
              disabled={!write.ready || !!asset || mode === "File"}
            />
          </label>
          {!asset && mode === "File" && (
            <Button disabled={!write.ready} onClick={() => void choose()}>
              Choose file
            </Button>
          )}
        </TabPanels>
        <label>
          Name
          <input
            data-write-focus
            data-autofocus
            disabled={write.pending}
            readOnly={!write.ready}
            {...form.register("name")}
          />
        </label>
        <div className="asset-kind-field">
          <label htmlFor="asset-kind">Kind</label>
          <Select
            id="asset-kind"
            disabled={!write.ready}
            aria-label="Kind"
            value={form.watch("kind")}
            onChange={(e) => {
              manuallyChosenKind.current = true;
              form.setValue(
                "kind",
                e.target.value as (typeof assetKinds)[number],
                { shouldDirty: true, shouldValidate: true },
              );
            }}
          >
            {assetKinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </div>
        <label>
          Notes
          <textarea disabled={!write.ready} {...form.register("notes")} />
        </label>
        {Object.entries(form.formState.errors).map(([key, e]) => (
          <p role="alert" className="field-error" key={key}>
            {e.message}
          </p>
        ))}
        <ProjectWriteFeedback
          write={write}
          action="Saving asset"
          form={formElement}
        />
        <div className="dialog-actions">
          <Button disabled={write.pending} onClick={() => write.dismiss(close)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!write.ready}>
            Save asset
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function AssetCard({
  asset,
  file,
  openTask,
  link,
}: {
  asset: AssetWithTasks;
  file?: FileAsset;
  openTask(key: string): void;
  link(): void;
}) {
  const openFile = useOpenFileViewer();
  const card = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const preview = useQuery({
    queryKey: ["assetPreview", asset.id, asset.location],
    queryFn: () => api.assetPreview(asset.id),
    enabled: visible,
  });
  const Icon = icons[asset.kind as keyof typeof icons] ?? Package;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: The card's name and preview are native keyboard buttons for the same action.
    <article
      className={`asset-card${asset.archivedAt ? " is-archived" : ""}`}
      ref={card}
      onClick={(event) => {
        if (
          !(event.target as Element).closest(
            'button, a, input, [role="menu"], [role="combobox"]',
          )
        )
          openFile(asset.id);
      }}
    >
      <div className="asset-card-top">
        <button
          type="button"
          className="asset-card-preview-open"
          aria-label={`View ${asset.name}`}
          onClick={() => openFile(asset.id)}
        >
          {preview.data ? (
            <img
              className="asset-preview"
              src={preview.data}
              alt={asset.name}
              onLoad={(e) => {
                const image = e.currentTarget;
                image.style.imageRendering =
                  Math.max(image.naturalWidth, image.naturalHeight) <= 128
                    ? "pixelated"
                    : "auto";
              }}
            />
          ) : null}
          <span
            className={preview.data ? "asset-icon preview-badge" : "asset-icon"}
            style={{
              background: `var(--${assetColors[asset.kind as keyof typeof assetColors]})`,
            }}
          >
            <Icon size={40} />
          </span>
        </button>
        <AssetActions assetId={asset.id} name={asset.name} link={link} />
      </div>
      <h2 title={asset.name}>
        <button
          type="button"
          className="asset-viewer-name"
          onClick={() => openFile(asset.id)}
        >
          {asset.name}
        </button>
      </h2>
      {asset.archivedAt && <Stamp>Archived</Stamp>}
      <p className="small muted">
        {file?.usageCount ? `Used in ${file.usageCount}` : "Not used"}
      </p>
      <p className="asset-location mono" title={asset.location}>
        {asset.location.length > 32
          ? `…${asset.location.slice(-31)}`
          : asset.location}
      </p>
      <FileAvailability asset={file} />
      <p className="asset-notes">{asset.notes || " "}</p>
      <div className="asset-tasks">
        {asset.tasks.slice(0, 3).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => openTask(t.key)}
            title={t.title}
          >
            <Stamp style={{ background: `var(--st-${t.status})` }}>
              {t.key}
            </Stamp>
          </button>
        ))}
        {asset.tasks.length > 3 && <small>+{asset.tasks.length - 3}</small>}
      </div>
    </article>
  );
}
export function AssetsPage({ openTask }: { openTask(key: string): void }) {
  const { settings, update } = useBoardSettings();
  const app = useQuery(appQuery);
  const linkedToId = useId();
  const [showArchived, setShowArchived] = useState(false);
  const [linkedTo, setLinkedTo] = useState(
    new URLSearchParams(window.location.search).get("linkedTo") ?? "any",
  );
  const openFile = useOpenFileViewer();
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.listAssets(),
  });
  const files = useQuery({
    queryKey: [
      "file-assets",
      "assets-page-v2",
      app.data?.jam?.id,
      showArchived,
    ],
    enabled: !!app.data?.jam,
    queryFn: async () => {
      const context = await taskFilesApi.capture(app.data?.jam?.id ?? "");
      const [catalog, usages] = await Promise.all([
        fileViewerApi.list(context, { includeArchived: showArchived }),
        taskFilesApi.usages(context),
      ]);
      const scopeUsages: Record<string, AssetUsage> = {};
      await Promise.all(
        catalog.map(async (a) => {
          scopeUsages[a.id] = await fileViewerApi.usage(context, a.id);
        }),
      );
      return { catalog, usages, scopeUsages };
    },
  });
  const combined: AssetWithTasks[] = [...(assets.data ?? [])];
  for (const file of files.data?.catalog ?? []) {
    const index = combined.findIndex((a) => a.id === file.id);
    const old = combined[index];
    const tasks =
      files.data?.usages[file.id]?.map((usage) => ({
        key: usage.key,
        title: `${usage.title} · ${fileRoleLabels[usage.role as FileRole] ?? usage.role}`,
        status: usage.status,
        fileRole: usage.role,
      })) ??
      old?.tasks ??
      [];
    const entry = { ...file, tasks };
    if (index >= 0) combined[index] = entry;
    else combined.push(entry);
  }
  const batch = useFileDropBatch("assets");
  const [kind, setKind] = useState("all");
  const [dragActive, setDragActive] = useState(false);
  const [text, setText] = useState("");
  const [linked, setLinked] = useState("all");
  const [storage, setStorage] = useState("all");
  const storageId = useId(),
    usedById = useId();
  const [sort, setSort] = useState("createdAt:desc");
  const [edit, setEdit] = useState<Asset | true | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const read = useExplicitRead(
    JSON.stringify(["assets", kind, text, linked, storage, sort]),
  );
  const refresh = () =>
    void read.run(async () => {
      const result = await assets.refetch({ cancelRefetch: false });
      if (result.isError) return result;
      return files.refetch({ cancelRefetch: false });
    });
  useEffect(
    () =>
      api.onFileDrop((paths, point) => {
        if (document.querySelector(".drawer, [data-task-files]")) return;
        // onFileDrop has already converted physical pixels to CSS pixels.
        if (
          point &&
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-brain-dock], #brain-dock, [data-board-ref-drop="brain-composer"]',
            ),
          ).some((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              point.x >= rect.left &&
              point.x <= rect.right &&
              point.y >= rect.top &&
              point.y <= rect.bottom
            );
          })
        )
          return;
        void batch.run(
          paths,
          (location) =>
            api.createAsset({
              name: assetName(location),
              kind: assetKind(location),
              location,
              notes: null,
            }),
          [["assets"]],
        );
      }, setDragActive),
    [batch.run],
  );
  const filtered =
    combined
      ?.slice()
      .sort((a, b) => {
        const [field, dir] = sort.split(":");
        return (
          (field === "name"
            ? a.name.localeCompare(b.name)
            : Date.parse(a.createdAt) - Date.parse(b.createdAt)) *
          (dir === "asc" ? 1 : -1)
        );
      })
      .filter(
        (a) =>
          (!a.archivedAt || showArchived) &&
          (linkedTo === "any" ||
            (linkedTo === "nothing"
              ? !(
                  files.data?.catalog.find((f) => f.id === a.id)?.usageCount ??
                  a.tasks.length
                )
              : linkedTo === "task"
                ? !!files.data?.scopeUsages[a.id]?.tasks.length
                : files.data?.scopeUsages[a.id]?.scopes.some(
                    (s) => s.type === linkedTo,
                  ))) &&
          (kind === "all" || a.kind === kind) &&
          (storage === "all" ||
            ("storageType" in a
              ? a.storageType
              : /^https?:\/\//i.test(a.location)
                ? "url"
                : "linked_file") === storage) &&
          (linked === "all" ||
            files.data?.usages[a.id]?.some((usage) => usage.role === linked)) &&
          (!text ||
            `${a.name} ${a.location} ${a.notes}`
              .toLowerCase()
              .includes(text.toLowerCase())),
      ) ?? [];
  return (
    <main className="feature-page">
      <PageHeading title="Assets" note="files and references your project uses">
        <div className="button-row">
          <SegmentedControl
            label="Assets view"
            value={settings?.assetsView ?? "grid"}
            onChange={(assetsView) =>
              update({ assetsView: assetsView as "grid" | "list" })
            }
            options={[
              {
                value: "grid",
                label: <LayoutGrid size={18} />,
                title: "Grid view",
              },
              { value: "list", label: <List size={18} />, title: "List view" },
            ]}
          />
          <Button
            disabled={read.pending || assets.isFetching}
            aria-busy={read.pending || assets.isFetching}
            onClick={refresh}
          >
            {read.pending ? "Checking assets…" : "Refresh assets"}
          </Button>
          <Button variant="primary" onClick={() => setEdit(true)}>
            Add asset
          </Button>
        </div>
      </PageHeading>
      <div className="filter-bar assets-file-filters">
        <div className="kind-filters">
          {["all", ...assetKinds].map((k) => (
            <Button
              key={k}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              <span className="capitalize">{k}</span>{" "}
              <small>
                {combined.filter((a) => k === "all" || a.kind === k).length}
              </small>
            </Button>
          ))}
        </div>
        <div className="asset-file-filter">
          <label htmlFor={storageId}>Storage:</label>
          <Select
            id={storageId}
            aria-label="Storage"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
          >
            <option value="all">Any</option>
            <option value="board_file">Board file</option>
            <option value="linked_file">Linked</option>
            <option value="url">URL</option>
          </Select>
        </div>
        <div className="asset-file-filter">
          <label htmlFor={usedById}>Used by tasks:</label>
          <Select
            id={usedById}
            aria-label="Used by tasks"
            value={linked}
            onChange={(e) => setLinked(e.target.value)}
          >
            <option value="all">Any</option>
            {Object.entries(fileRoleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <input
          aria-label="Search assets"
          placeholder="Search assets…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="assets-v2-filter">
        <div className="asset-file-filter">
          <label htmlFor={linkedToId}>Linked to</label>
          <Select
            id={linkedToId}
            aria-label="Linked to"
            value={linkedTo}
            onChange={(e) => setLinkedTo(e.target.value)}
          >
            <option value="any">Any</option>
            <option value="project">Project</option>
            <option value="epic">Epics</option>
            <option value="story">Stories</option>
            <option value="task">Tasks</option>
            <option value="nothing">Nothing</option>
          </Select>
        </div>
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{" "}
          Show archived
        </label>
      </div>
      <ReadReceipt
        checkedAt={read.checkedAt}
        phase={read.phase}
        resource="assets"
      />
      {files.error && !assets.error && (
        <p role="alert">
          Could not read file storage and task roles: {files.error.message}.{" "}
          <Button onClick={() => void files.refetch()}>Retry files</Button>
        </p>
      )}
      {!!files.data?.catalog.length && (
        <details className="task-section asset-file-usage">
          <summary>
            <ChevronRight size={16} aria-hidden="true" />
            File usage and roles
          </summary>
          {files.data.catalog
            .filter((file) => filtered.some((a) => a.id === file.id))
            .map((file) => (
              <div key={file.id} className="asset-file-usage-row">
                <div className="asset-file-usage-name">
                  <strong title={file.storedPath}>{file.name}</strong>
                  <small>{storageLabel(file.storageType)}</small>
                </div>
                {files.data.usages[file.id]?.length ? (
                  files.data.usages[file.id]?.map((usage) => (
                    <Button key={usage.key} onClick={() => openTask(usage.key)}>
                      {usage.key} ·{" "}
                      {fileRoleLabels[usage.role as FileRole] ?? usage.role}
                    </Button>
                  ))
                ) : (
                  <span className="muted">No task links</span>
                )}
              </div>
            ))}
        </details>
      )}
      {assets.error && (
        <QueryError
          error={assets.error}
          retry={refresh}
          busy={read.pending || assets.isFetching}
        />
      )}
      {assets.error && assets.data && (
        <p className="small muted">
          Showing the last loaded asset list; retry to check for changes.
        </p>
      )}
      {assets.isFetching && assets.data && !read.pending && (
        <p className="small muted" role="status">
          Refreshing assets… showing the last loaded list.
        </p>
      )}
      <FileDropProgress progress={batch.progress} />
      <FileDropZone active={dragActive}>
        {assets.isPending ? (
          <p className="loading" role="status">
            Reading assets…
          </p>
        ) : !assets.data ? null : filtered.length ? (
          settings?.assetsView === "list" ? (
            <AssetList
              assets={filtered}
              sort={sort}
              setSort={setSort}
              openTask={openTask}
              openFile={openFile}
            />
          ) : (
            <div className="asset-groups">
              {(kind === "all"
                ? assetKinds.filter((k) =>
                    filtered.some((asset) => asset.kind === k),
                  )
                : [kind]
              ).map((k) => (
                <section key={k} className="asset-group">
                  {kind === "all" && (
                    <button
                      type="button"
                      className="asset-group-heading"
                      aria-expanded={!settings?.collapsedAssetKinds.includes(k)}
                      onClick={() =>
                        update({
                          collapsedAssetKinds:
                            (settings?.collapsedAssetKinds.includes(k)
                              ? settings.collapsedAssetKinds.filter(
                                  (v) => v !== k,
                                )
                              : [
                                  ...(settings?.collapsedAssetKinds ?? []),
                                  k,
                                ]) as (typeof assetKinds)[number][],
                        })
                      }
                    >
                      {settings?.collapsedAssetKinds.includes(k) ? (
                        <ChevronRight size={18} />
                      ) : (
                        <ChevronDown size={18} />
                      )}
                      <h2>
                        {
                          (
                            {
                              sprite: "Sprites",
                              audio: "Audio",
                              video: "Videos",
                              level: "Levels",
                              font: "Fonts",
                              model: "Models",
                              document: "Documents",
                              other: "Other",
                            } as Record<string, string>
                          )[k]
                        }
                      </h2>
                      <span className="muted">
                        {filtered.filter((a) => a.kind === k).length}
                      </span>
                    </button>
                  )}
                  {(kind !== "all" ||
                    !settings?.collapsedAssetKinds.includes(k)) && (
                    <div className="asset-grid">
                      {filtered
                        .filter((a) => a.kind === k)
                        .map((a) => (
                          <AssetCard
                            key={a.id}
                            asset={a}
                            file={files.data?.catalog.find(
                              (file) => file.id === a.id,
                            )}
                            openTask={openTask}
                            link={() => setLink(a.id)}
                          />
                        ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )
        ) : combined?.length ? (
          <EmptyState text="No assets match these filters">
            <Button
              onClick={() => {
                setLinkedTo("any");
                setKind("all");
                setLinked("all");
                setStorage("all");
                setText("");
              }}
            >
              Clear asset filters
            </Button>
          </EmptyState>
        ) : assets.error ? (
          <p className="muted">
            The last loaded list was empty. Retry to check the current project.
          </p>
        ) : (
          <EmptyState text="No assets yet — add a file or URL for your project" />
        )}
      </FileDropZone>
      {edit && (
        <AssetDialog
          asset={edit === true ? undefined : edit}
          close={() => setEdit(null)}
        />
      )}{" "}
      {link && <AssetLinkDialog assetId={link} close={() => setLink(null)} />}
    </main>
  );
}

function AssetList({
  assets,
  sort,
  setSort,
  openTask,
  openFile,
}: {
  assets: AssetWithTasks[];
  sort: string;
  setSort(v: string): void;
  openTask(key: string): void;
  openFile(assetId: string): void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const itemKey = useCallback((i: number) => assets[i]?.id ?? i, [assets]);
  const virtual = useTableVirtualizer(scroll, assets.length, itemKey),
    items = virtual.getVirtualItems();
  const toggle = (field: string) =>
    setSort(`${field}:${sort === `${field}:asc` ? "desc" : "asc"}`);
  return (
    <div className="asset-list-scroll" ref={scroll} data-testid="asset-list">
      <table
        className="asset-list"
        style={{ height: virtual.getTotalSize() + 44 }}
      >
        <thead>
          <tr>
            <th aria-label="Preview">
              <Image size={16} aria-hidden="true" />
            </th>
            <th>
              <button type="button" onClick={() => toggle("name")}>
                Name{" "}
                {sort.startsWith("name")
                  ? sort.endsWith("asc")
                    ? "↑"
                    : "↓"
                  : ""}
              </button>
            </th>
            <th>Kind</th>
            <th>Path</th>
            <th>Tasks</th>
            <th>
              <button type="button" onClick={() => toggle("createdAt")}>
                Added{" "}
                {sort.startsWith("createdAt")
                  ? sort.endsWith("asc")
                    ? "↑"
                    : "↓"
                  : ""}
              </button>
            </th>
          </tr>
        </thead>
        <tbody style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}>
          {items.map((item) => {
            const a = assets[item.index];
            if (!a) return null;
            return (
              <tr
                key={a.id}
                className={a.archivedAt ? "asset-list-row-archived" : ""}
                data-testid="asset-list-row"
                onClick={(event) => {
                  if (
                    !(event.target as Element).closest(
                      'button, a, input, [role="menu"], [role="combobox"]',
                    )
                  )
                    openFile(a.id);
                }}
              >
                <td>
                  <AssetThumb asset={a} />
                </td>
                <td>
                  <button
                    type="button"
                    title={a.name}
                    onClick={() => openFile(a.id)}
                  >
                    {a.name}
                  </button>
                  {a.archivedAt && <Stamp>Archived</Stamp>}
                  <small>
                    {(a as AssetWithTasks & { usageCount?: number }).usageCount
                      ? `Used in ${(a as AssetWithTasks & { usageCount?: number }).usageCount}`
                      : "Not used"}
                  </small>
                  <AssetActions assetId={a.id} name={a.name} />
                </td>
                <td>
                  <span className="capitalize">{a.kind}</span>
                </td>
                <td className="mono" title={a.location}>
                  {a.location}
                </td>
                <td>
                  {a.tasks.slice(0, 2).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => openTask(t.key)}
                    >
                      {t.key}
                    </button>
                  ))}
                  {a.tasks.length > 2 && `+${a.tasks.length - 2}`}
                </td>
                <td>
                  {new Date(a.createdAt).toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function AssetThumb({ asset }: { asset: Asset }) {
  const preview = useQuery({
    queryKey: ["assetPreview", asset.id, asset.location],
    queryFn: () => api.assetPreview(asset.id),
  });
  const Icon = icons[asset.kind as keyof typeof icons] ?? Package;
  return preview.data ? (
    <img width={32} height={32} src={preview.data} alt="" />
  ) : (
    <Icon size={24} />
  );
}
