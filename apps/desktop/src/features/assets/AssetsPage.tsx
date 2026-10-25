import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Image,
  LayoutGrid,
  List,
  Map as MapIcon,
  MoreHorizontal,
  Package,
  Type,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
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
import { useBoardSettings } from "../../lib/queries";
import type { Asset, AssetWithTasks } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { useExplicitRead } from "../../lib/use-explicit-read";
import { useProjectWrite } from "../../lib/use-project-write";
import { useTableVirtualizer } from "../table/use-table-virtualizer";
import { AssetLinkDialog } from "./AssetLinkDialog";
import { assetKind, assetKinds, assetName, assetSchema } from "./model";

const icons = {
  sprite: Image,
  audio: AudioLines,
  level: MapIcon,
  font: Type,
  other: Package,
};
export const assetColors = {
  sprite: "rose",
  audio: "sky",
  level: "mint",
  font: "lilac",
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
  openTask,
  edit,
  link,
}: {
  asset: AssetWithTasks;
  openTask(key: string): void;
  edit(): void;
  link(): void;
}) {
  const [menu, setMenu] = useState(false);
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
  const url = /^https?:\/\//i.test(asset.location);
  return (
    <article className="asset-card" ref={card}>
      <div className="asset-card-top">
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
        <div className="asset-menu">
          <IconButton
            label={`Menu for ${asset.name}`}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={18} />
          </IconButton>
          {menu && (
            <div className="popover-menu">
              <Button
                onClick={() => {
                  setMenu(false);
                  edit();
                }}
              >
                Edit
              </Button>
              <Button
                onClick={() => {
                  setMenu(false);
                  link();
                }}
              >
                Link to task…
              </Button>
              <Button
                onClick={() => {
                  setMenu(false);
                  void (
                    url
                      ? api.openUrl(asset.location)
                      : api.showInFolder(asset.location)
                  ).catch((e) => useUiStore.getState().error(String(e)));
                }}
              >
                {url ? "Open URL" : "Show in folder"}
              </Button>
            </div>
          )}
        </div>
      </div>
      <h2 title={asset.name}>{asset.name}</h2>
      <p className="asset-location mono" title={asset.location}>
        {asset.location.length > 32
          ? `…${asset.location.slice(-31)}`
          : asset.location}
      </p>
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
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.listAssets(),
  });
  const batch = useFileDropBatch("assets");
  const [kind, setKind] = useState("all");
  const [dragActive, setDragActive] = useState(false);
  const [text, setText] = useState("");
  const [linked, setLinked] = useState("all");
  const [sort, setSort] = useState("createdAt:desc");
  const [edit, setEdit] = useState<Asset | true | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const read = useExplicitRead(
    JSON.stringify(["assets", kind, text, linked, sort]),
  );
  const refresh = () =>
    void read.run(() => assets.refetch({ cancelRefetch: false }));
  useEffect(
    () =>
      api.onFileDrop((paths, point) => {
        if (document.querySelector(".drawer")) return;
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
    assets.data
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
          (kind === "all" || a.kind === kind) &&
          (linked === "all" ||
            (linked === "linked"
              ? a.tasks.length > 0
              : a.tasks.length === 0)) &&
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
            onChange={(assetsView) => update({ assetsView })}
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
      <div className="filter-bar">
        <div className="kind-filters">
          {["all", ...assetKinds].map((k) => (
            <Button
              key={k}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              <span className="capitalize">{k}</span>{" "}
              <small>
                {assets.data?.filter((a) => k === "all" || a.kind === k)
                  .length ?? "—"}
              </small>
            </Button>
          ))}
        </div>
        <Select
          aria-label="Asset links filter"
          value={linked}
          onChange={(e) => setLinked(e.target.value)}
        >
          <option value="all">All links</option>
          <option value="linked">Linked</option>
          <option value="unlinked">Unlinked</option>
        </Select>
        <input
          aria-label="Search assets"
          placeholder="Search assets…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <ReadReceipt
        checkedAt={read.checkedAt}
        phase={read.phase}
        resource="assets"
      />
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
              edit={setEdit}
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
                            settings?.collapsedAssetKinds.includes(k)
                              ? settings.collapsedAssetKinds.filter(
                                  (v) => v !== k,
                                )
                              : [...(settings?.collapsedAssetKinds ?? []), k],
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
                              level: "Levels",
                              font: "Fonts",
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
                            openTask={openTask}
                            edit={() => setEdit(a)}
                            link={() => setLink(a.id)}
                          />
                        ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )
        ) : assets.data.length ? (
          <EmptyState text="No assets match these filters">
            <Button
              onClick={() => {
                setKind("all");
                setLinked("all");
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
  edit,
}: {
  assets: AssetWithTasks[];
  sort: string;
  setSort(v: string): void;
  openTask(key: string): void;
  edit(asset: Asset): void;
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
              <tr key={a.id} data-testid="asset-list-row">
                <td>
                  <AssetThumb asset={a} />
                </td>
                <td>
                  <button type="button" title={a.name} onClick={() => edit(a)}>
                    {a.name}
                  </button>
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
