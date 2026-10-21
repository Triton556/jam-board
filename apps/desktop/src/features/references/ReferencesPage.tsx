import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  applyNodeChanges,
  Background,
  MiniMap,
  type NodeChange,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Viewport,
} from "@xyflow/react";
import {
  Focus,
  Frame,
  Link2,
  Map as MinimapIcon,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import paint from "../../assets/chibi/wife-paint-256.webp";
import type { CanvasGeometry, RefFrame, RefItem } from "../../bindings";
import { Button, Dialog, EmptyState, IconButton } from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { api } from "../../lib/api";
import { epicsQuery } from "../../lib/planning-queries";
import { appQuery, tasksQuery } from "../../lib/queries";
import type { ReferenceInput } from "../../lib/references-api";
import { useUiStore } from "../../lib/ui-store";
import {
  AddReferenceDialog,
  EditReferenceDialog,
  FrameDialog,
} from "./dialogs";
import { ReferenceEdge } from "./Edge";
import { stopReferenceAudio } from "./Media";
import {
  CanvasHistory,
  debounceSave,
  geometryAt,
  linkedTargets,
  palette,
  parentAt,
  pasteContent,
  readingOrder,
  referenceKind,
  referenceKindColors,
  worldPosition,
} from "./model";
import {
  type FrameNode,
  type ItemNode,
  ReferenceFrame,
  ReferenceNode,
} from "./Nodes";
import { OverviewScene } from "./OverviewScene";
import { CanvasContext, type CanvasRuntime } from "./runtime";
import "@xyflow/react/dist/style.css";
import "./references.css";

type CanvasNode = ItemNode | FrameNode;
type FrameGeometry = Partial<Pick<RefFrame, "x" | "y" | "w" | "h">>;
declare global {
  interface Window {
    __jamCanvas?: {
      setViewport(v: Viewport): Promise<boolean>;
      getViewport(): Viewport;
      fit(): Promise<boolean>;
    };
  }
}
const nodeTypes = { reference: ReferenceNode, frame: ReferenceFrame },
  edgeTypes = { reference: ReferenceEdge };
const histories = new Map<string, CanvasHistory>();
export const referencesQuery = {
  queryKey: ["references"],
  queryFn: () => api.referenceCanvas(),
  staleTime: Infinity,
};
function Canvas() {
  const query = useQuery(referencesQuery),
    epics = useQuery(epicsQuery),
    stories = useQuery({
      queryKey: ["stories"],
      queryFn: () => api.listStories(),
    }),
    tasks = useQuery(tasksQuery),
    assets = useQuery({
      queryKey: ["assets"],
      queryFn: () => api.listAssets(),
    }),
    app = useQuery(appQuery);
  const client = useQueryClient(),
    navigate = useNavigate(),
    flow = useReactFlow<CanvasNode>(),
    container = useRef<HTMLElement>(null),
    [nodes, setNodes] = useState<CanvasNode[]>([]),
    [selectedEdges, setSelectedEdges] = useState<string[]>([]),
    [filter, setFilter] = useState<string[]>([]),
    [connect, setConnect] = useState(false),
    [minimap, setMinimap] = useState(true),
    [add, setAdd] = useState<"link" | "note" | "frame" | null>(null),
    [menu, setMenu] = useState(false),
    [frameEdit, setFrameEdit] = useState<RefFrame | null>(null),
    [edit, setEdit] = useState<{
      id: string;
      mode: "caption" | "tags" | "link";
    } | null>(null),
    [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(
      null,
    ),
    [edgeEdit, setEdgeEdit] = useState<{ id: string; label: string } | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    dragging = useRef(false),
    selectNext = useRef<string | undefined>(undefined);
  const selectedReference = useRouterState({
      select: (s) => (s.location.search as { section?: string }).section,
    }),
    centered = useRef<string | undefined>(undefined);
  const highlights = useUiStore((s) => s.highlights),
    overview = useStore((s) => s.transform[2] < 0.4),
    data = query.data,
    latest = useRef(data);
  latest.current = data;
  const selectedFrames = nodes
    .filter((n) => n.type === "frame" && n.selected)
    .map((n) => n.id)
    .join(",");
  const selectedItems = nodes
    .filter((n) => n.type === "reference" && n.selected)
    .map((n) => n.id)
    .join(",");
  const excluded = nodes
    .filter(
      (n) =>
        n.selected ||
        (n.parentId && selectedFrames.split(",").includes(n.parentId)),
    )
    .map((n) => n.id)
    .join(",");
  const edges = useMemo(
    () =>
      (data?.edges ?? []).map((e) => ({
        id: e.id,
        source: e.fromItem,
        target: e.toItem,
        label: e.label,
        type: "reference",
        data: { connect },
        selected: selectedEdges.includes(e.id),
      })),
    [data?.edges, connect, selectedEdges],
  );
  const history = useMemo(() => {
    const id = app.data?.jam?.id ?? "empty";
    let h = histories.get(id);
    if (!h) {
      h = new CanvasHistory();
      histories.set(id, h);
    }
    return h;
  }, [app.data?.jam?.id]);
  const targets = useMemo<
    {
      id: string;
      key: string;
      title: string;
      kind: string;
      epicId?: string;
      color?: string;
    }[]
  >(
    () => [
      ...(epics.data ?? []).map((e) => ({
        id: e.id,
        key: e.key,
        title: e.title,
        kind: "epic",
        epicId: e.id,
        color: e.color,
      })),
      ...(stories.data ?? []).map((s) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        kind: "story",
        epicId: s.epicId,
      })),
      ...Object.values(tasks.data ?? {})
        .flat()
        .map((t) => ({
          id: t.id,
          key: t.key,
          title: t.title,
          kind: "task",
          epicId: t.epicId,
        })),
    ],
    [epics.data, stories.data, tasks.data],
  );
  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ["references"] });
  }, [client]);
  const error = useCallback(
    (e: unknown) => useUiStore.getState().error(String(e)),
    [],
  );
  const announce = useCallback((text: string) => setNotice(text), []);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (import.meta.env.VITE_MOCK_BRIDGE !== "1") return;
    window.__jamCanvas = {
      setViewport: (v) => flow.setViewport(v, { duration: 0 }),
      getViewport: () => flow.getViewport(),
      fit: () => flow.fitView({ duration: 0, padding: 0.3 }),
    };
    return () => {
      delete window.__jamCanvas;
    };
  }, [flow]);
  const center = useCallback(() => {
    const rect = container.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
    });
  }, [flow]);
  const saveGeometry = useRef(
    new Map<string, ReturnType<typeof debounceSave<CanvasGeometry>>>(),
  );
  const pendingItems = useRef(new Map<string, CanvasGeometry>());
  const geometryHistory = useRef(new Map<string, boolean>());
  const queueGeometry = useCallback(
    (before: RefItem, after: CanvasGeometry, recordHistory = true) => {
      pendingItems.current.set(before.id, after);
      geometryHistory.current.set(
        before.id,
        recordHistory || (geometryHistory.current.get(before.id) ?? false),
      );
      const previous = {
        id: before.id,
        x: before.x,
        y: before.y,
        w: before.w,
        h: before.h,
        z: before.z,
        frameId: before.frameId,
      };
      let save = saveGeometry.current.get(before.id);
      if (!save) {
        save = debounceSave((value: CanvasGeometry) => {
          void api
            .canvasGeometry(value)
            .then(async () => {
              if (geometryHistory.current.get(before.id))
                history.record({
                  label: "Move reference",
                  undo: () => api.canvasGeometry(previous),
                  redo: () => api.canvasGeometry(value),
                });
              setRevision((r) => r + 1);
              await refresh();
            })
            .catch(async (e) => {
              pendingItems.current.delete(before.id);
              error(e);
              await refresh();
            })
            .finally(() => {
              pendingItems.current.delete(before.id);
              geometryHistory.current.delete(before.id);
            });
          saveGeometry.current.delete(before.id);
        });
        saveGeometry.current.set(before.id, save);
      }
      save.schedule(after);
    },
    [history, refresh, error],
  );
  const frameSaves = useRef(
    new Map<string, ReturnType<typeof debounceSave<FrameGeometry>>>(),
  );
  const pendingFrames = useRef(new Map<string, FrameGeometry>());
  const queueFrame = useCallback(
    (frame: RefFrame, patch: FrameGeometry) => {
      pendingFrames.current.set(frame.id, {
        ...pendingFrames.current.get(frame.id),
        ...patch,
      });
      let save = frameSaves.current.get(frame.id);
      if (!save) {
        const previous = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
        save = debounceSave((value: FrameGeometry) => {
          void api
            .updateRefFrame(frame.id, value)
            .then(async () => {
              history.record({
                label: "Change frame geometry",
                undo: () => api.updateRefFrame(frame.id, previous),
                redo: () => api.updateRefFrame(frame.id, value),
              });
              setRevision((r) => r + 1);
              await refresh();
            })
            .catch(async (e) => {
              pendingFrames.current.delete(frame.id);
              error(e);
              await refresh();
            })
            .finally(() => pendingFrames.current.delete(frame.id));
          frameSaves.current.delete(frame.id);
        });
        frameSaves.current.set(frame.id, save);
      }
      save.schedule(pendingFrames.current.get(frame.id) ?? patch);
    },
    [history, refresh, error],
  );
  const archive = useCallback(
    (kind: "item" | "frame" | "edge", id: string) => {
      void api
        .canvasArchive({ kind, id, archived: true })
        .then(async () => {
          history.record({
            label: "Archive reference",
            undo: () => api.canvasArchive({ kind, id, archived: false }),
            redo: () => api.canvasArchive({ kind, id, archived: true }),
          });
          setRevision((r) => r + 1);
          announce("Archived reference");
          await refresh();
        })
        .catch(error);
    },
    [history, refresh, error, announce],
  );
  const open = useCallback(
    (key: string) => {
      if (/-E\d+$/.test(key))
        void navigate({ to: "/plan/$epicKey", params: { epicKey: key } });
      else if (/-S\d+$/.test(key)) {
        const s = targets.find((t) => t.key === key),
          e = targets.find((t) => t.id === s?.epicId);
        if (e)
          void navigate({
            to: "/plan/$epicKey",
            params: { epicKey: e.key },
            search: { tab: "Stories", story: key },
          });
      } else void navigate({ to: "/references", search: { task: key } });
    },
    [navigate, targets],
  );
  const runtime = useMemo<CanvasRuntime>(
    () => ({
      edit: (id, mode) => setEdit({ id, mode }),
      archive,
      open,
      lightbox: (url, title) => setLightbox({ url, title }),
      edgeLabel: (id, label) => setEdgeEdit({ id, label }),
      caption: async (item, value) => {
        await api.updateReference(item.id, { caption: value });
        history.record({
          label: "Edit note",
          undo: () => api.updateReference(item.id, { caption: item.captionMd }),
          redo: () => api.updateReference(item.id, { caption: value }),
        });
        setRevision((r) => r + 1);
        await refresh();
      },
      resize: (item, w, h) =>
        queueGeometry(item, {
          id: item.id,
          x: item.x,
          y: item.y,
          w,
          h,
          z: item.z,
          frameId: item.frameId,
        }),
      resizeFrame: (frame, w, h) => queueFrame(frame, { w, h }),
      editFrame: setFrameEdit,
      collapse: (frame) => {
        void api
          .updateRefFrame(frame.id, { collapsed: !frame.collapsed })
          .then(refresh)
          .catch(error);
      },
    }),
    [archive, open, queueGeometry, queueFrame, history, refresh, error],
  );
  useEffect(() => {
    if (!data || dragging.current) return;
    const matched = (id: string) => !filter.length || filter.includes(id);
    const effectiveFrames = data.frames.map((f) => ({
      ...f,
      ...pendingFrames.current.get(f.id),
    }));
    const frames: FrameNode[] = effectiveFrames
      .filter((f) => !f.archivedAt)
      .map((f) => ({
        id: f.id,
        type: "frame",
        data: {
          frame: {
            ...f,
            color: epics.data?.find((e) => e.id === f.epicId)?.color ?? f.color,
          },
          dim: !!filter.length && !matched(f.epicId ?? "unlinked"),
        },
        position: { x: f.x ?? 0, y: f.y ?? 0 },
        style: {
          width: f.w ?? 800,
          height: f.collapsed ? 40 : (f.h ?? 600),
          zIndex: -1,
        },
        width: f.w ?? 800,
        height: f.collapsed ? 40 : (f.h ?? 600),
        measured: {
          width: f.w ?? 800,
          height: f.collapsed ? 40 : (f.h ?? 600),
        },
        handles: [],
        zIndex: -1,
        dragHandle: ".reference-frame-tab",
        ariaLabel: `Reference frame: ${f.title}`,
      }));
    const items: ItemNode[] = data.items
      .map((item) => ({ ...item, ...pendingItems.current.get(item.id) }))
      .sort((a, b) => {
        const p = worldPosition(a, data.frames),
          q = worldPosition(b, data.frames);
        return p.y - q.y || p.x - q.x;
      })
      .map((item) => {
        const frame = effectiveFrames.find((f) => f.id === item.frameId),
          activeFrame = frame && !frame.archivedAt,
          links = linkedTargets(item, data, targets),
          epic = targets.find(
            (t) =>
              t.kind === "epic" &&
              (t.id === frame?.epicId ||
                links.some((l) => l.id === t.id || l.epicId === t.id)),
          ),
          asset = assets.data?.find((a) => a.id === item.assetId),
          kind = referenceKind(item, asset?.location),
          contentSized =
            kind === "link" &&
            (!overview ||
              connect ||
              selectedItems.split(",").includes(item.id) ||
              (!!item.frameId &&
                selectedFrames.split(",").includes(item.frameId))),
          highlight = highlights[item.id];
        return {
          id: item.id,
          type: "reference",
          data: {
            item,
            path: asset?.location ?? "",
            links,
            color: palette(epic?.color ?? "var(--butter)"),
            dim:
              !!filter.length &&
              !(filter.includes("unlinked") && !links.length) &&
              !links.some(
                (l) => filter.includes(l.id) || filter.includes(l.epicId ?? ""),
              ),
            highlight: highlight?.color,
            connect,
            fitContent: contentSized,
            expanded:
              !!item.frameId &&
              selectedFrames.split(",").includes(item.frameId),
          },
          position: activeFrame
            ? { x: item.x ?? 0, y: item.y ?? 0 }
            : worldPosition(item, effectiveFrames),
          parentId: activeFrame ? frame.id : undefined,
          hidden: !!(activeFrame && frame.collapsed),
          style: contentSized
            ? {
                width: Math.max(240, item.w ?? 240),
                minHeight: Math.max(160, item.h ?? 180),
              }
            : { width: item.w ?? 240, height: item.h ?? 180 },
          width: contentSized ? Math.max(240, item.w ?? 240) : (item.w ?? 240),
          height: contentSized ? undefined : (item.h ?? 180),
          measured: { width: item.w ?? 240, height: item.h ?? 180 },
          handles: [
            {
              type: "target",
              position: Position.Left,
              x: -4,
              y: (item.h ?? 180) / 2 - 4,
              width: 8,
              height: 8,
            },
            {
              type: "source",
              position: Position.Right,
              x: (item.w ?? 240) - 4,
              y: (item.h ?? 180) / 2 - 4,
              width: 8,
              height: 8,
            },
          ],
          zIndex: item.z ?? 0,
          ariaLabel: `${kind} reference: ${item.title}, linked to ${links.map((l) => l.key).join(", ") || "nothing"}`,
        };
      });
    const requested = selectNext.current;
    if (requested && items.some((n) => n.id === requested))
      selectNext.current = undefined;
    setNodes((previous) => {
      const selected = requested
        ? new Set([requested])
        : new Set(previous.filter((n) => n.selected).map((n) => n.id));
      return readingOrder<CanvasNode>([...frames, ...items]).map((n) => ({
        ...n,
        selected: selected.has(n.id),
      }));
    });
  }, [
    data,
    targets,
    assets.data,
    filter,
    highlights,
    connect,
    epics.data,
    selectedFrames,
    selectedItems,
    overview,
  ]);
  const hasRequestedNode =
    !!selectedReference && nodes.some((n) => n.id === selectedReference);
  useEffect(() => {
    if (!selectedReference) {
      centered.current = undefined;
      return;
    }
    if (centered.current === selectedReference || !data || !hasRequestedNode)
      return;
    const item = data.items.find((i) => i.id === selectedReference),
      frame = data.frames.find((f) => f.id === item?.frameId);
    if (frame?.collapsed && !frame.archivedAt) {
      void api
        .updateRefFrame(frame.id, { collapsed: false })
        .then(refresh)
        .catch(error);
      return;
    }
    setNodes((ns) =>
      ns.map((n) => ({ ...n, selected: n.id === selectedReference })),
    );
    const timer = setTimeout(() => {
      centered.current = selectedReference;
      void flow.fitView({
        nodes: [{ id: selectedReference }],
        maxZoom: 1,
        padding: 0.3,
        duration: reduced ? 0 : 220,
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [
    selectedReference,
    data,
    hasRequestedNode,
    flow,
    reduced,
    refresh,
    error,
  ]);
  const viewportSave = useMemo(
    () =>
      debounceSave((v: Viewport) => {
        void api.canvasViewport(JSON.stringify(v)).catch(error);
      }),
    [error],
  );
  useEffect(() => {
    let live = true;
    void api
      .canvasViewport()
      .then((v) => {
        if (v && live) {
          const value = JSON.parse(v) as Viewport;
          void flow.setViewport(value, { duration: 0 });
        }
      })
      .catch(error);
    return () => {
      live = false;
      viewportSave.cancel();
      for (const save of saveGeometry.current.values()) save.flush();
      for (const save of frameSaves.current.values()) save.flush();
      stopReferenceAudio();
    };
  }, [flow, error, viewportSave]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const undo = useCallback(
    async (redo = false) => {
      try {
        if (redo) await history.redo();
        else await history.undo();
        setRevision((r) => r + 1);
        await refresh();
      } catch (e) {
        error(e);
      }
    },
    [history, refresh, error],
  );
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        document.querySelector('[role="dialog"]') ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void flow.fitView({ duration: reduced ? 0 : 220, padding: 0.3 });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [flow, reduced, undo]);
  const addInput = useCallback(
    async (input: ReferenceInput) => {
      const point = center(),
        frame = parentAt(point, latest.current?.frames ?? []),
        item = await api.addReference({
          x: point.x - (frame?.x ?? 0),
          y: point.y - (frame?.y ?? 0),
          frameId: frame?.id,
          ...input,
        });
      selectNext.current = item.id;
      await refresh();
      return item;
    },
    [center, refresh],
  );
  const addFiles = useCallback(
    async (paths: string[], point = center()) => {
      if (!paths.length) return;
      const frame = parentAt(point, latest.current?.frames ?? []);
      for (const [i, path] of paths.entries())
        await api.addReference({
          kind: "asset",
          filePath: path,
          frameId: frame?.id,
          x: point.x - (frame?.x ?? 0) + (i % 3) * 290,
          y: point.y - (frame?.y ?? 0) + Math.floor(i / 3) * 250,
        });
      announce(`Added ${paths.length} references`);
      await client.invalidateQueries({ queryKey: ["assets"] });
      await refresh();
    },
    [center, announce, client, refresh],
  );
  useEffect(
    () =>
      api.onFileDrop((paths, point) => {
        if (document.querySelector(".drawer")) return;
        void addFiles(
          paths,
          point ? flow.screenToFlowPosition(point) : center(),
        ).catch(error);
      }),
    [addFiles, flow, center, error],
  );
  const dropNode = useCallback(
    (node: CanvasNode) => {
      dragging.current = false;
      if (node.type === "frame") {
        queueFrame(node.data.frame, { x: node.position.x, y: node.position.y });
        return;
      }
      const item = node.data.item,
        parent = node.parentId ? flow.getNode(node.parentId) : null,
        point = {
          x: node.position.x + (parent?.position.x ?? 0),
          y: node.position.y + (parent?.position.y ?? 0),
        },
        after = geometryAt(
          item,
          point,
          (latest.current?.frames ?? []).map((f) => ({
            ...f,
            ...pendingFrames.current.get(f.id),
          })),
        );
      queueGeometry(item, after);
      setNodes((ns) =>
        ns.map((n) =>
          n.id === item.id
            ? {
                ...n,
                parentId: after.frameId ?? undefined,
                position: { x: after.x ?? 0, y: after.y ?? 0 },
              }
            : n,
        ),
      );
    },
    [flow, queueFrame, queueGeometry],
  );
  if (query.isPending) return <PaperSkeleton label="Loading references" />;
  if (query.error)
    return (
      <QueryError error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <CanvasContext.Provider value={runtime}>
      <section
        className="references-page"
        ref={container}
        tabIndex={-1}
        aria-label="References canvas"
        data-history-revision={revision}
        onPaste={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (["INPUT", "TEXTAREA"].includes(tag)) return;
          const content = pasteContent(e.clipboardData);
          if (!content) return;
          e.preventDefault();
          void (async () => {
            if (content.kind === "image") {
              const image = await createImageBitmap(content.file),
                c = document.createElement("canvas");
              c.width = image.width;
              c.height = image.height;
              c.getContext("2d")?.drawImage(image, 0, 0);
              image.close();
              const blob = await new Promise<Blob>((resolve, reject) =>
                c.toBlob(
                  (b) =>
                    b
                      ? resolve(b)
                      : reject(Error("Clipboard image could not be encoded")),
                  "image/png",
                ),
              );
              const p = center();
              const item = await api.clipboardReference(
                Array.from(new Uint8Array(await blob.arrayBuffer())),
                p.x,
                p.y,
              );
              selectNext.current = item.id;
              await refresh();
            } else
              await addInput(
                content.kind === "link"
                  ? { kind: "link", url: content.text }
                  : { kind: "note", text: content.text },
              );
          })().catch(error);
        }}
        onKeyDownCapture={(e) => {
          if (
            ["INPUT", "TEXTAREA", "SELECT"].includes(
              (e.target as HTMLElement).tagName,
            )
          )
            return;
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && key === "z") {
            e.preventDefault();
            e.stopPropagation();
            void undo(e.shiftKey);
            return;
          }
          if (key === "f") {
            e.preventDefault();
            void flow.fitView({ duration: reduced ? 0 : 220, padding: 0.3 });
            return;
          }
          const focused = (e.target as HTMLElement).closest<HTMLElement>(
              ".react-flow__node",
            ),
            focusNode = focused?.dataset.id
              ? flow.getNode(focused.dataset.id)
              : undefined;
          const chosen = flow.getNodes().filter((n) => n.selected),
            selected = focusNode ? [focusNode] : chosen;
          if (
            (e.target as HTMLElement).closest(
              "button,a,summary,[role=combobox]",
            )
          )
            return;
          if (e.key === "Tab" && e.target === focused) {
            const ordered = flow.getNodes().filter((n) => !n.hidden),
              index = ordered.findIndex((n) => n.id === focusNode?.id),
              next = ordered[index + (e.shiftKey ? -1 : 1)];
            if (next) {
              const element = container.current?.querySelector<HTMLElement>(
                `[data-id="${CSS.escape(next.id)}"]`,
              );
              if (element) {
                e.preventDefault();
                element.focus({ preventScroll: true });
                return;
              }
            }
          }
          if (!selected.length) {
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              for (const edge of flow
                .getEdges()
                .filter((edge) => edge.selected))
                archive("edge", edge.id);
            }
            return;
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            for (const n of selected)
              archive(n.type === "frame" ? "frame" : "item", n.id);
          }
          if (e.key === "Enter") {
            const n = selected[0];
            if (n?.type === "reference") setEdit({ id: n.id, mode: "caption" });
            else if (n?.type === "frame") {
              if (n.data.frame.collapsed) runtime.collapse(n.data.frame);
              else runtime.editFrame(n.data.frame);
            }
          }
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 32 : 8;
            for (const n of selected) {
              const position = {
                x:
                  n.position.x +
                  (e.key === "ArrowLeft"
                    ? -step
                    : e.key === "ArrowRight"
                      ? step
                      : 0),
                y:
                  n.position.y +
                  (e.key === "ArrowUp"
                    ? -step
                    : e.key === "ArrowDown"
                      ? step
                      : 0),
              };
              setNodes((ns) =>
                ns.map((v) => (v.id === n.id ? { ...v, position } : v)),
              );
              dropNode({ ...n, position });
            }
          }
        }}
      >
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onlyRenderVisibleElements
          minZoom={0.1}
          maxZoom={4}
          nodeDragThreshold={4}
          deleteKeyCode={null}
          snapToGrid
          snapGrid={[1, 1]}
          onNodesChange={(changes: NodeChange<CanvasNode>[]) => {
            setNodes((ns) => applyNodeChanges(changes, ns));
            for (const change of changes) {
              if (
                change.type !== "dimensions" ||
                !change.dimensions ||
                change.resizing
              )
                continue;
              const item = latest.current?.items.find(
                (i) => i.id === change.id,
              );
              const node = flow.getNode(change.id);
              if (
                item?.kind !== "link" ||
                node?.type !== "reference" ||
                !node.data.fitContent ||
                (change.dimensions.height <= (item.h ?? 180) + 1 &&
                  change.dimensions.width <= (item.w ?? 240) + 1)
              )
                continue;
              // React Flow observes intrinsic content growth once. Persist it
              // through the gesture debounce without adding a second undo step
              // after a caption edit, or saving on camera/animation frames.
              queueGeometry(
                item,
                {
                  id: item.id,
                  x: item.x,
                  y: item.y,
                  z: item.z,
                  frameId: item.frameId,
                  ...pendingItems.current.get(item.id),
                  w: Math.max(
                    item.w ?? 240,
                    Math.ceil(change.dimensions.width),
                  ),
                  h: Math.max(
                    item.h ?? 180,
                    Math.ceil(change.dimensions.height),
                  ),
                },
                false,
              );
            }
          }}
          onNodeDragStart={() => {
            dragging.current = true;
          }}
          onNodeDragStop={(_, node, dragged) => {
            for (const moved of dragged.length ? dragged : [node])
              dropNode(moved);
          }}
          onConnect={(connection) => {
            if (connection.source && connection.target)
              void api
                .createRefEdge(connection.source, connection.target, "")
                .then(refresh)
                .catch(error);
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            archive("edge", edge.id);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdges([edge.id]);
            setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
            container.current?.focus({ preventScroll: true });
          }}
          onNodeClick={() => setSelectedEdges([])}
          onEdgesDelete={(edges) => {
            for (const edge of edges) archive("edge", edge.id);
          }}
          onMoveEnd={(_, v) => {
            viewportSave.schedule(v);
          }}
          proOptions={{ hideAttribution: false }}
          edgesFocusable={false}
          onPaneClick={() => {
            setSelectedEdges([]);
            container.current?.focus({ preventScroll: true });
          }}
        >
          <svg aria-hidden="true">
            <defs>
              <marker
                id="reference-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="var(--line)" />
              </marker>
            </defs>
          </svg>
          {data && !connect && (
            <OverviewScene
              data={data}
              assets={assets.data ?? []}
              excluded={excluded}
              filters={filter.join(",")}
              highlights={highlights}
              theme={app.data?.theme ?? "system"}
              targets={targets}
            />
          )}
          <Background color="var(--ink-3)" gap={24} size={0.7} />
          {minimap && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => {
                const data = node.data as Partial<import("./Nodes").ItemData>;
                return node.type === "frame" || !data.item
                  ? "transparent"
                  : referenceKindColors[referenceKind(data.item, data.path)];
              }}
              maskColor="color-mix(in srgb, var(--paper) 65%, transparent)"
            />
          )}
        </ReactFlow>
        <div
          className="reference-toolbar"
          role="toolbar"
          aria-label="Canvas tools"
        >
          <div className="reference-add">
            <Button variant="primary" onClick={() => setMenu(!menu)}>
              <Plus size={16} />
              Add
            </Button>
            {menu && (
              <div className="reference-add-menu">
                <Button
                  onClick={() => {
                    setMenu(false);
                    void api
                      .pickFiles()
                      .then((paths) => addFiles(paths))
                      .catch(error);
                  }}
                >
                  File…
                </Button>
                <Button
                  onClick={() => {
                    setMenu(false);
                    setAdd("link");
                  }}
                >
                  Link…
                </Button>
                <Button
                  onClick={() => {
                    setMenu(false);
                    setAdd("note");
                  }}
                >
                  Note
                </Button>
              </div>
            )}
          </div>
          <Button variant="ghost" onClick={() => setAdd("frame")}>
            <Frame size={16} />
            Frame
          </Button>
          <Button
            variant="ghost"
            aria-pressed={connect}
            onClick={() => setConnect(!connect)}
          >
            <Link2 size={16} />
            Connect
          </Button>
          <IconButton
            label="Fit view · F"
            onClick={() =>
              void flow.fitView({ duration: reduced ? 0 : 220, padding: 0.3 })
            }
          >
            <Focus size={18} />
          </IconButton>
          <IconButton
            label="Zoom out"
            onClick={() => void flow.zoomOut({ duration: 0 })}
          >
            <Minus size={18} />
          </IconButton>
          <ZoomReadout />
          <IconButton
            label="Zoom in"
            onClick={() => void flow.zoomIn({ duration: 0 })}
          >
            <Plus size={18} />
          </IconButton>
          <IconButton
            label="Toggle minimap"
            onClick={() => setMinimap(!minimap)}
          >
            <MinimapIcon size={18} />
          </IconButton>
          <IconButton
            label="Undo"
            disabled={!history.canUndo}
            onClick={() => void undo()}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={!history.canRedo}
            onClick={() => void undo(true)}
          >
            <Redo2 size={18} />
          </IconButton>
        </div>
        <fieldset className="reference-filters" aria-label="Filter references">
          <button
            type="button"
            aria-pressed={!filter.length}
            onClick={() => setFilter([])}
          >
            All
          </button>
          {(epics.data ?? []).map((e) => (
            <button
              type="button"
              key={e.id}
              aria-pressed={filter.includes(e.id)}
              style={
                { "--chip-color": palette(e.color) } as React.CSSProperties
              }
              onClick={() =>
                setFilter((f) =>
                  f.includes(e.id)
                    ? f.filter((id) => id !== e.id)
                    : [...f, e.id],
                )
              }
            >
              {e.key}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={filter.includes("unlinked")}
            onClick={() =>
              setFilter((f) =>
                f.includes("unlinked")
                  ? f.filter((id) => id !== "unlinked")
                  : [...f, "unlinked"],
              )
            }
          >
            Unlinked
          </button>
        </fieldset>
        {!data?.items.length && (
          <div className="reference-empty">
            <EmptyState
              image={paint}
              text="Drop images, sounds, videos or links here"
            >
              <Button
                variant="primary"
                onClick={() =>
                  void api
                    .pickFiles()
                    .then((paths) => addFiles(paths))
                    .catch(error)
                }
              >
                Add file…
              </Button>
            </EmptyState>
          </div>
        )}
        {notice && (
          <div className="reference-notice" role="status">
            {notice}
            {notice === "Archived reference" &&
              history.lastLabel === "Archive reference" &&
              history.canUndo && (
                <Button variant="ghost" onClick={() => void undo()}>
                  Undo
                </Button>
              )}
          </div>
        )}
        {connect && (
          <div className="reference-connect-hint">
            Drag from a node handle to connect · right-click an edge to archive
          </div>
        )}
        {(add === "link" || add === "note") && (
          <AddReferenceDialog
            kind={add}
            close={() => setAdd(null)}
            save={addInput}
          />
        )}
        {add === "frame" && (
          <FrameDialog
            epics={epics.data ?? []}
            close={() => setAdd(null)}
            save={async (title, epicId) => {
              const p = center(),
                e = epics.data?.find((e) => e.id === epicId);
              await api.createRefFrame({
                title,
                epicId,
                color: e?.color ?? "m4",
                // Leave room for the title above content already at the center.
                x: p.x - 32,
                y: p.y - 64,
              });
              await refresh();
            }}
          />
        )}
        {edit && data?.items.find((i) => i.id === edit.id) && (
          <EditReferenceDialog
            item={data.items.find((i) => i.id === edit.id) as RefItem}
            mode={edit.mode}
            targets={targets}
            close={() => setEdit(null)}
            link={async (key) => {
              await api.linkReference(edit.id, key);
              await refresh();
            }}
            save={async (patch) => {
              const old = data.items.find((i) => i.id === edit.id);
              if (!old) return;
              await api.updateReference(edit.id, patch);
              history.record({
                label: "Edit reference",
                undo: () =>
                  api.updateReference(edit.id, {
                    title: old.title,
                    caption: old.captionMd,
                    tags: old.tags,
                  }),
                redo: () => api.updateReference(edit.id, patch),
              });
              setRevision((r) => r + 1);
              await refresh();
            }}
          />
        )}
        {frameEdit && (
          <FrameDialog
            initial={frameEdit}
            epics={epics.data ?? []}
            close={() => setFrameEdit(null)}
            save={async (title, epicId) => {
              await api.updateRefFrame(frameEdit.id, { title, epicId });
              await refresh();
            }}
          />
        )}
        {lightbox && (
          <Dialog
            title={lightbox.title}
            className="reference-lightbox"
            onClose={() => setLightbox(null)}
          >
            <img src={lightbox.url} alt={lightbox.title} />
          </Dialog>
        )}
        {edgeEdit && (
          <Dialog title="Edge label" onClose={() => setEdgeEdit(null)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void api
                  .updateRefEdge(edgeEdit.id, edgeEdit.label)
                  .then(refresh)
                  .then(() => setEdgeEdit(null))
                  .catch(error);
              }}
            >
              <label className="field">
                Label
                <input
                  autoFocus
                  value={edgeEdit.label}
                  onChange={(e) =>
                    setEdgeEdit({ ...edgeEdit, label: e.target.value })
                  }
                />
              </label>
              <Button variant="primary" type="submit">
                Save label
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  archive("edge", edgeEdit.id);
                  setEdgeEdit(null);
                }}
              >
                Archive edge
              </Button>
            </form>
          </Dialog>
        )}
      </section>
    </CanvasContext.Provider>
  );
}
function ZoomReadout() {
  const zoom = useStore((s) => Math.round(s.transform[2] * 100));
  return <span className="mono">{zoom}%</span>;
}
export function ReferencesPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
