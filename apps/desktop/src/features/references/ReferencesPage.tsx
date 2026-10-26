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
  ViewportPortal,
} from "@xyflow/react";
import {
  ChevronDown,
  Focus,
  Frame,
  Link2,
  Map as MinimapIcon,
  Minus,
  Plus,
  Redo2,
  StickyNote,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import paint from "../../assets/chibi/wife-paint-256.webp";
import type { CanvasGeometry, RefFrame, RefItem } from "../../bindings";
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Tooltip,
} from "../../components/ui";
import {
  PaperSkeleton,
  QueryError,
  QueryRefreshNotice,
} from "../../components/ui/AsyncState";
import { ReadReceipt } from "../../components/ui/ReadReceipt";
import { api } from "../../lib/api";
import { FileDropProgress, useFileDropBatch } from "../../lib/file-drop-batch";
import { epicsQuery } from "../../lib/planning-queries";
import { appQuery, tasksQuery } from "../../lib/queries";
import type { ReferenceInput } from "../../lib/references-api";
import { useUiStore } from "../../lib/ui-store";
import { useExplicitRead } from "../../lib/use-explicit-read";
import { useProjectWrite } from "../../lib/use-project-write";
import { useBrainDock } from "../brain/brain-store";
import { referenceBrainContext, useCanvasBrainContext } from "./brain-context";
import { referenceLinkActions, verdictActions } from "./canvas-actions";
import { useClipboardImagePaste } from "./clipboard-paste";
import { referenceControlsBottom } from "./control-layout";
import { DraftNote } from "./DraftNote";
import {
  AddReferenceDialog,
  EditReferenceDialog,
  FrameDialog,
} from "./dialogs";
import { ReferenceEdge } from "./Edge";
import { EdgeLabelDialog } from "./EdgeLabelDialog";
import { referenceFitViewport } from "./frame-layout";
import { LinkTargetDialog } from "./LinkTargetDialog";
import {
  boardDropTarget,
  canvasPick,
  choiceRefs,
  dispatchBoardDrop,
  dragPoint,
  frameTargets,
  type ReferenceChoice,
} from "./linking";
import { stopReferenceAudio } from "./Media";
import { referenceMiniMapColor } from "./minimap-color";
import type { UndoAction } from "./model";
import {
  debounceSave,
  geometryAt,
  getCanvasHistory,
  linkedTargets,
  palette,
  parentAt,
  pasteContent,
  readingOrder,
  referenceKind,
  referenceLabel,
  worldPosition,
} from "./model";
import {
  type FrameNode,
  type ItemNode,
  ReferenceFrame,
  ReferenceNode,
} from "./Nodes";
import { NoteTaskDialog } from "./NoteTaskDialog";
import { placedNoteLayout } from "./note-draft-layout";
import { OverviewScene } from "./OverviewScene";
import {
  ReferenceDragPreview,
  type ReferenceDragPreviewData,
} from "./ReferenceDragPreview";
import { CanvasContext, type CanvasRuntime } from "./runtime";
import { editedNoteTarget, retainNoteEditors } from "./sticky-node-ownership";
import { useViewportGesture } from "./use-viewport-gesture";
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
export const referencesQuery = {
  queryKey: ["references"],
  queryFn: () => api.referenceCanvas(),
  staleTime: Infinity,
};
function Canvas() {
  const dock = useBrainDock();
  const brainCompose = useRef(dock.compose);
  brainCompose.current = dock.compose;
  const compose = useCallback(
    (draft: Parameters<typeof dock.compose>[0]) => brainCompose.current(draft),
    [],
  );
  const batch = useFileDropBatch("references"),
    pasteImage = useClipboardImagePaste();
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
    [add, setAdd] = useState<"link" | "frame" | null>(null),
    [noteDraft, setNoteDraft] = useState<{
      projectId: string;
      x: number;
      y: number;
      createdId?: string;
      maxHeight: number;
    } | null>(null),
    [placingNote, setPlacingNote] = useState<string | null>(null),
    [taskNote, setTaskNote] = useState<RefItem | null>(null),
    [menu, setMenu] = useState(false),
    [frameEdit, setFrameEdit] = useState<RefFrame | null>(null),
    [edit, setEdit] = useState<{
      id: string;
      mode: "caption" | "tags" | "link";
    } | null>(null),
    [lightbox, setLightbox] = useState<{
      url: string;
      title: string;
      kind?: "video";
    } | null>(null),
    [edgeEdit, setEdgeEdit] = useState<{ id: string; label: string } | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    dragging = useRef(false),
    selectNext = useRef<string | undefined>(undefined);
  const activeNotes = useRef(new Set<string>());
  const viewportGesture = useViewportGesture();
  const [linkSelection, setLinkSelection] = useState<ReferenceChoice[] | null>(
    null,
  );
  const pick = useSyncExternalStore(canvasPick.subscribe, canvasPick.get);
  const pickWrite = useProjectWrite("canvas-pick", pick?.projectId);
  const pickBusy = pickWrite.pending;
  const dragOrigin = useRef<CanvasNode[]>([]);
  const dragCancelled = useRef(false);
  const dropHighlight = useRef<HTMLElement | null>(null);
  const [dragPreview, setDragPreview] =
    useState<ReferenceDragPreviewData | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeOrigin = useRef<{
    x: number;
    y: number;
    selected: Set<string>;
    hit?: string;
  } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const origin = marqueeOrigin.current;
      if (!origin) return;
      const left = Math.min(origin.x, event.clientX),
        top = Math.min(origin.y, event.clientY);
      const rect = container.current?.getBoundingClientRect();
      setMarquee({
        x: left - (rect?.left ?? 0),
        y: top - (rect?.top ?? 0),
        left,
        top,
        width: Math.abs(event.clientX - origin.x),
        height: Math.abs(event.clientY - origin.y),
      });
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4)
        return;
      const a = flow.screenToFlowPosition({ x: left, y: top }),
        b = flow.screenToFlowPosition({
          x: Math.max(origin.x, event.clientX),
          y: Math.max(origin.y, event.clientY),
        });
      setNodes((ns) =>
        ns.map((node) => {
          const parent = ns.find((n) => n.id === node.parentId);
          const x = node.position.x + (parent?.position.x ?? 0),
            y = node.position.y + (parent?.position.y ?? 0);
          const intersects =
            x < b.x &&
            y < b.y &&
            x + (node.measured?.width ?? node.width ?? 240) > a.x &&
            y + (node.measured?.height ?? node.height ?? 180) > a.y;
          return {
            ...node,
            selected:
              origin.selected.has(node.id) || (!node.hidden && intersects),
          };
        }),
      );
    };
    const end = (event: PointerEvent) => {
      const origin = marqueeOrigin.current;
      if (
        origin &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4 &&
        origin.hit
      )
        setNodes((ns) =>
          ns.map((n) => ({
            ...n,
            selected:
              n.id === origin.hit
                ? !origin.selected.has(n.id)
                : origin.selected.has(n.id),
          })),
        );
      marqueeOrigin.current = null;
      setMarquee(null);
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (marqueeOrigin.current) {
        const selected = marqueeOrigin.current.selected;
        setNodes((ns) =>
          ns.map((n) => ({ ...n, selected: selected.has(n.id) })),
        );
        marqueeOrigin.current = null;
        setMarquee(null);
      }
      if (!dragging.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragCancelled.current = true;
      setDragPreview(null);
      setNodes(dragOrigin.current);
      dropHighlight.current?.classList.remove("board-ref-drag-over");
      dropHighlight.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("keydown", cancel, true);
      dropHighlight.current?.classList.remove("board-ref-drag-over");
    };
  }, [flow]);
  useEffect(() => {
    if (pick && app.data?.jam && pick.projectId !== app.data.jam.id)
      canvasPick.set(null);
  }, [pick, app.data?.jam]);
  const [editingNotes, setEditingNotes] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const draftRef = useRef(noteDraft);
  draftRef.current = noteDraft;
  const noteEditing = useCallback((id: string, active: boolean) => {
    if (active === activeNotes.current.has(id)) return;
    if (active) activeNotes.current.add(id);
    else activeNotes.current.delete(id);
    setEditingNotes(new Set(activeNotes.current));
  }, []);
  const noteOwnsTarget = useCallback(
    (kind: "item" | "frame" | "edge", id: string) =>
      (kind === "item" && draftRef.current?.createdId === id) ||
      editedNoteTarget(kind, id, flow.getNodes(), activeNotes.current),
    [flow],
  );
  const requireFinishedNote = useCallback(
    (kind: "item" | "frame" | "edge", id: string) => {
      if (noteOwnsTarget(kind, id))
        throw Error(
          "Finish editing or deliberately discard the retained note edits before changing this note or its frame.",
        );
    },
    [noteOwnsTarget],
  );
  const selectedReference = useRouterState({
      select: (s) => (s.location.search as { section?: string }).section,
    }),
    centered = useRef<string | undefined>(undefined);
  const read = useExplicitRead(
    JSON.stringify(["references", filter, selectedReference]),
  );
  const explicitRefresh = () =>
    void read.run(() => query.refetch({ cancelRefetch: false }));
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
  const canvasContext = useMemo(
    () =>
      nodes
        .filter(
          (node): node is ItemNode =>
            node.type === "reference" &&
            !!node.selected &&
            !node.hidden &&
            !node.data.item.archivedAt &&
            node.data.item.jamId === app.data?.jam?.id,
        )
        .map((node) =>
          referenceBrainContext(
            node.data.item,
            node.data.links.map((link) => link.key),
          ),
        ),
    [nodes, app.data?.jam?.id],
  );
  useCanvasBrainContext(canvasContext);
  const excluded = nodes
    .filter(
      (n) =>
        n.selected ||
        (n.parentId && selectedFrames.split(",").includes(n.parentId)),
    )
    .map((n) => n.id)
    .concat(noteDraft?.createdId ?? [], [...editingNotes])
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
    return getCanvasHistory(id);
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
  const pendingGroup = useRef<Promise<unknown> | null>(null);
  const runGroup = useCallback(
    async (label: string, actions: UndoAction[]) => {
      if (history.busy)
        throw Error("Wait for the current canvas change to finish.");
      const projectId = app.data?.jam?.id;
      const guard = async (perform: () => Promise<unknown>) => {
        if (!projectId || (await api.appState()).jam?.id !== projectId)
          throw Error("The project changed before the canvas change finished.");
        return perform();
      };
      const result = history.perform(
        label,
        actions.map((action) => ({
          label: action.label,
          undo: () => guard(action.undo),
          redo: () => guard(action.redo),
        })),
      );
      pendingGroup.current = result;
      try {
        await result;
      } finally {
        if (pendingGroup.current === result) pendingGroup.current = null;
        setRevision((r) => r + 1);
        void refresh().catch(error);
      }
    },
    [app.data?.jam?.id, history, refresh, error],
  );
  const linkSelectionTo = useCallback(
    async (choices: ReferenceChoice[], key: string) => {
      if (!latest.current) return;
      await runGroup(
        "Link references",
        referenceLinkActions(choices, key, latest.current, targets),
      );
    },
    [runGroup, targets],
  );
  const setVerdict = useCallback(
    async (
      item: RefItem,
      verdict: import("../../lib/api").ReferenceVerdict,
    ) => {
      const selected = flow
        .getNodes()
        .filter(
          (node): node is ItemNode =>
            node.type === "reference" && !!node.selected,
        );
      const items = selected.some((node) => node.id === item.id)
        ? selected.map((node) => node.data.item)
        : [item];
      if (items.some((row) => row.jamId !== app.data?.jam?.id))
        throw Error("The project changed.");
      await client.cancelQueries({ queryKey: ["references"] });
      const update = (restore = false) =>
        client.setQueryData<import("../../bindings").ReferenceCanvas>(
          ["references"],
          (current) =>
            current && {
              ...current,
              items: current.items.map((row) => {
                const before = items.find((item) => item.id === row.id);
                return before
                  ? { ...row, verdict: restore ? before.verdict : verdict }
                  : row;
              }),
            },
        );
      update();
      try {
        await runGroup("Reference feedback", verdictActions(items, verdict));
      } catch (reason) {
        update(true);
        throw reason;
      }
    },
    [app.data?.jam?.id, client, flow, runGroup],
  );
  const announce = useCallback((text: string) => setNotice(text), []);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fitCanvas = useCallback(
    (duration: number) => {
      const bounds = container.current?.getBoundingClientRect();
      if (!bounds) return Promise.resolve(false);
      const toolsBottom = referenceControlsBottom(container.current);
      const viewport = referenceFitViewport(
        flow
          .getNodes()
          .filter((node) => !node.hidden)
          .map((node) => ({
            ...flow.getNodesBounds([node.id]),
            frame:
              node.type === "frame"
                ? {
                    collapsed: !!node.data.frame.collapsed,
                    linked: frameTargets(node.data.frame).length > 0,
                  }
                : undefined,
          })),
        { width: bounds.width, height: bounds.height, toolsBottom },
      );
      return viewport
        ? flow.setViewport(viewport, { duration })
        : Promise.resolve(false);
    },
    [flow],
  );
  useEffect(() => {
    if (import.meta.env.VITE_MOCK_BRIDGE !== "1") return;
    window.__jamCanvas = {
      setViewport: (v) => flow.setViewport(v, { duration: 0 }),
      getViewport: () => flow.getViewport(),
      fit: () => fitCanvas(0),
    };
    return () => {
      delete window.__jamCanvas;
    };
  }, [flow, fitCanvas]);
  const center = useCallback(() => {
    const rect = container.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
    });
  }, [flow]);
  const beginNote = () => {
    if (noteDraft || !app.data?.jam) return;
    setMenu(false);
    setPlacingNote(app.data.jam.id);
    container.current?.focus({ preventScroll: true });
  };
  const placeNote = (
    clientPoint?: { x: number; y: number },
    direct = false,
  ) => {
    const projectId = direct ? app.data?.jam?.id : placingNote;
    if (!projectId || projectId !== app.data?.jam?.id || noteDraft) return;
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    const screen = clientPoint ?? {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
    const world = flow.screenToFlowPosition(screen);
    const layout = placedNoteLayout(
      world,
      { x: screen.x - bounds.left, y: screen.y - bounds.top },
      {
        width: bounds.width,
        height: bounds.height,
        toolsBottom: referenceControlsBottom(container.current),
      },
    );
    setPlacingNote(null);
    setNoteDraft({
      projectId,
      x: layout.x,
      y: layout.y,
      maxHeight: layout.maxHeight,
    });
    void flow.setViewport(layout.viewport, { duration: 0 });
  };
  useEffect(() => {
    if (placingNote && placingNote !== app.data?.jam?.id) setPlacingNote(null);
  }, [placingNote, app.data?.jam?.id]);
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
  const archiveGroup = useCallback(
    (choices: { kind: "item" | "frame" | "edge"; id: string }[]) => {
      try {
        for (const choice of choices)
          requireFinishedNote(choice.kind, choice.id);
        void runGroup(
          "Archive reference",
          choices.map(({ kind, id }) => ({
            label: "Archive reference",
            undo: () => api.canvasArchive({ kind, id, archived: false }),
            redo: () => {
              requireFinishedNote(kind, id);
              return api.canvasArchive({ kind, id, archived: true });
            },
          })),
        )
          .then(() => announce("Archived reference"))
          .catch(error);
      } catch (reason) {
        error(reason);
      }
    },
    [runGroup, requireFinishedNote, announce, error],
  );
  const archive = useCallback(
    (kind: "item" | "frame" | "edge", id: string) =>
      archiveGroup([{ kind, id }]),
    [archiveGroup],
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
      edit: (id, mode) =>
        mode === "link"
          ? setLinkSelection([{ id, kind: "item" }])
          : setEdit({ id, mode }),
      createTask: setTaskNote,
      askBrain: (item, linkedKeys) => {
        if (
          client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
            ?.jam?.id !== item.jamId
        )
          return;
        compose({
          text: "",
          context: [referenceBrainContext(item, linkedKeys)],
        });
      },
      archive,
      verdict: setVerdict,
      open,
      lightbox: (url, title, kind) => setLightbox({ url, title, kind }),
      edgeLabel: (id, label) => setEdgeEdit({ id, label }),
      noteEditing,
      noteSaved: (item, previous) => {
        if (previous)
          history.record({
            label: "Edit note",
            undo: () => {
              requireFinishedNote("item", item.id);
              return api.updateReference(
                item.id,
                { title: previous.title, caption: previous.captionMd },
                { title: item.title, caption: item.captionMd },
              );
            },
            redo: () => {
              requireFinishedNote("item", item.id);
              return api.updateReference(
                item.id,
                { title: item.title, caption: item.captionMd },
                { title: previous.title, caption: previous.captionMd },
              );
            },
          });
        setRevision((r) => r + 1);
        void refresh().catch(error);
      },
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
      linkFrame: (frame) => setLinkSelection([{ kind: "frame", id: frame.id }]),
      unlinkFrame: (frame, key) => {
        void api.unlinkRefFrame(frame.id, key).then(refresh).catch(error);
      },
      unlinkItem: (item, key) => {
        void api.unlinkReference(item.id, key).then(refresh).catch(error);
      },
      collapse: (frame) => {
        if (!frame.collapsed) {
          try {
            requireFinishedNote("frame", frame.id);
          } catch (reason) {
            error(reason);
            return;
          }
        }
        void api
          .updateRefFrame(frame.id, { collapsed: !frame.collapsed })
          .then(refresh)
          .catch(error);
      },
    }),
    [
      archive,
      setVerdict,
      open,
      queueGeometry,
      queueFrame,
      history,
      refresh,
      error,
      noteEditing,
      requireFinishedNote,
      compose,
      client,
    ],
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
            links: frameTargets(f, targets),
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
          hidden:
            item.id === noteDraft?.createdId ||
            !!(activeFrame && frame.collapsed),
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
          ariaLabel: `${kind} reference: ${referenceLabel(item)}, linked to ${links.map((l) => l.key).join(", ") || "nothing"}`,
        };
      });
    const requested = selectNext.current;
    if (requested && items.some((n) => n.id === requested))
      selectNext.current = undefined;
    setNodes((previous) => {
      const selected = requested
        ? new Set([requested])
        : new Set(previous.filter((n) => n.selected).map((n) => n.id));
      return readingOrder<CanvasNode>(
        retainNoteEditors(
          [...frames, ...items],
          previous,
          editingNotes,
          app.data?.jam?.id,
        ),
      ).map((n) => ({
        ...n,
        selected: selected.has(n.id),
      }));
    });
  }, [
    data,
    app.data?.jam?.id,
    editingNotes,
    targets,
    assets.data,
    filter,
    highlights,
    connect,
    epics.data,
    selectedFrames,
    selectedItems,
    overview,
    noteDraft?.createdId,
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
        await pendingGroup.current;
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
        void fitCanvas(reduced ? 0 : 220);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [fitCanvas, reduced, undo]);
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
      await batch.run(
        paths,
        (path, i) =>
          api.addReference({
            kind: "asset",
            filePath: path,
            frameId: frame?.id,
            x: point.x - (frame?.x ?? 0) + (i % 3) * 290,
            y: point.y - (frame?.y ?? 0) + Math.floor(i / 3) * 250,
          }),
        [["assets"], ["references"]],
      );
    },
    [center, batch.run],
  );
  useEffect(
    () =>
      api.onFileDrop((paths, point) => {
        if (document.querySelector(".drawer")) return;
        // onFileDrop already converts Tauri's physical pixels to CSS pixels.
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
  const dropNodes = (moved: CanvasNode[]) => {
    const ids = new Set(moved.map((node) => node.id));
    const roots = moved.filter(
      (node) => !node.parentId || !ids.has(node.parentId),
    );
    if (roots.length <= 1) {
      for (const node of roots) dropNode(node);
      return;
    }
    dragging.current = false;
    const actions: UndoAction[] = [];
    for (const node of roots) {
      if (node.type === "frame") {
        const before = { x: node.data.frame.x, y: node.data.frame.y };
        const after = { x: node.position.x, y: node.position.y };
        pendingFrames.current.set(node.id, after);
        actions.push({
          label: "Move frame",
          undo: () => api.updateRefFrame(node.id, before),
          redo: () => api.updateRefFrame(node.id, after),
        });
      } else {
        const item = node.data.item,
          parent = node.parentId ? flow.getNode(node.parentId) : null;
        const after = geometryAt(
          item,
          {
            x: node.position.x + (parent?.position.x ?? 0),
            y: node.position.y + (parent?.position.y ?? 0),
          },
          (latest.current?.frames ?? []).map((frame) => {
            const moving = roots.find((node) => node.id === frame.id);
            return moving
              ? { ...frame, x: moving.position.x, y: moving.position.y }
              : frame;
          }),
        );
        const before = {
          id: item.id,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          z: item.z,
          frameId: item.frameId,
        };
        pendingItems.current.set(item.id, after);
        actions.push({
          label: "Move reference",
          undo: () => api.canvasGeometry(before),
          redo: () => api.canvasGeometry(after),
        });
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === item.id
              ? {
                  ...node,
                  parentId: after.frameId ?? undefined,
                  position: { x: after.x ?? 0, y: after.y ?? 0 },
                }
              : node,
          ),
        );
      }
    }
    void runGroup("Move references", actions)
      .catch((reason) => {
        setNodes((nodes) =>
          nodes.map((node) => {
            const moved = roots.find((moved) => moved.id === node.id);
            if (!moved) return node;
            const before =
              moved.type === "frame" ? moved.data.frame : moved.data.item;
            return {
              ...node,
              parentId:
                "frameId" in before ? (before.frameId ?? undefined) : undefined,
              position: { x: before.x ?? 0, y: before.y ?? 0 },
            };
          }),
        );
        error(reason);
      })
      .finally(() => {
        for (const node of roots) {
          pendingItems.current.delete(node.id);
          pendingFrames.current.delete(node.id);
        }
      });
  };
  if (query.isPending) return <PaperSkeleton label="Loading references" />;
  if (query.error && !query.data)
    return (
      <>
        <QueryError
          error={query.error}
          retry={explicitRefresh}
          busy={read.pending || query.isFetching}
        />
        <ReadReceipt
          checkedAt={read.checkedAt}
          phase={read.phase}
          resource="references"
        />
      </>
    );
  return (
    <CanvasContext.Provider value={runtime}>
      <section
        className={`references-page ${placingNote ? "reference-placing-note" : ""} ${viewportGesture.moving ? "reference-viewport-moving" : ""}`}
        ref={container}
        tabIndex={-1}
        aria-label="References canvas"
        data-history-revision={revision}
        onMouseDownCapture={(event) => {
          if (
            event.shiftKey &&
            !(event.target as HTMLElement).closest(
              "button, input, textarea, a, summary, .nodrag",
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (
            (event.target as HTMLElement).closest(
              "button, input, textarea, a, summary, video[controls]",
            )
          )
            event.stopPropagation();
        }}
        onPointerDownCapture={(event) => {
          const element = event.target as HTMLElement;
          if (
            event.button !== 0 ||
            element.closest(
              "button, input, textarea, a, summary, .nodrag, .react-flow__resize-control",
            )
          )
            return;
          if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            marqueeOrigin.current = {
              x: event.clientX,
              y: event.clientY,
              selected: new Set(
                flow
                  .getNodes()
                  .filter((n) => n.selected)
                  .map((n) => n.id),
              ),
              hit: element.closest<HTMLElement>(".react-flow__node")?.dataset
                .id,
            };
          } else {
            dragOrigin.current = flow.getNodes();
            dragCancelled.current = false;
          }
        }}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (
            event.shiftKey &&
            target.closest(".react-flow__node") &&
            !target.closest("button, input, textarea, a, summary, .nodrag")
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onDoubleClickCapture={(event) => {
          if (dragCancelled.current) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const target = event.target as HTMLElement;
          if (
            target.closest(".react-flow__pane") &&
            !target.closest(".react-flow__node")
          ) {
            event.preventDefault();
            event.stopPropagation();
            placeNote({ x: event.clientX, y: event.clientY }, true);
          }
        }}
        onPaste={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (["INPUT", "TEXTAREA"].includes(tag)) return;
          const content = pasteContent(e.clipboardData);
          if (!content) return;
          e.preventDefault();
          void (async () => {
            if (content.kind === "image") {
              await pasteImage(
                content.file,
                center(),
                (item) => {
                  selectNext.current = item.id;
                },
                refresh,
              );
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
            (e.target as HTMLElement).closest(
              'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],dialog,.react-flow__minimap',
            )
          )
            return;
          if (
            e.key.toLowerCase() === "n" &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            e.preventDefault();
            e.stopPropagation();
            beginNote();
            return;
          }
          if (placingNote && (e.key === "Escape" || e.key === "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") setPlacingNote(null);
            else placeNote();
            return;
          }
          if ((e.target as HTMLElement).closest(".reference-note-draft"))
            return;
          if (
            ["INPUT", "TEXTAREA", "SELECT"].includes(
              (e.target as HTMLElement).tagName,
            )
          )
            return;
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && key === "a") {
            e.preventDefault();
            e.stopPropagation();
            setNodes((ns) => ns.map((n) => ({ ...n, selected: !n.hidden })));
            setSelectedEdges([]);
            return;
          }
          if ((e.ctrlKey || e.metaKey) && key === "z") {
            e.preventDefault();
            e.stopPropagation();
            void undo(e.shiftKey);
            return;
          }
          if (key === "f") {
            e.preventDefault();
            void fitCanvas(reduced ? 0 : 220);
            return;
          }
          const focused = (e.target as HTMLElement).closest<HTMLElement>(
              ".react-flow__node",
            ),
            focusNode = focused?.dataset.id
              ? flow.getNode(focused.dataset.id)
              : undefined;
          const chosen = flow.getNodes().filter((n) => n.selected),
            selected = focusNode && !focusNode.selected ? [focusNode] : chosen;
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
              e.preventDefault();
              const focusNext = () =>
                container.current
                  ?.querySelector<HTMLElement>(
                    `[data-id="${CSS.escape(next.id)}"]`,
                  )
                  ?.focus({ preventScroll: true });
              const element = container.current?.querySelector<HTMLElement>(
                `[data-id="${CSS.escape(next.id)}"]`,
              );
              if (element) {
                focusNext();
              } else {
                void flow
                  .fitView({
                    nodes: [{ id: next.id }],
                    maxZoom: 1,
                    duration: 0,
                  })
                  .then(() => requestAnimationFrame(focusNext));
              }
              return;
            }
          }
          if (!selected.length) {
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              archiveGroup(
                flow
                  .getEdges()
                  .filter((edge) => edge.selected)
                  .map((edge) => ({ kind: "edge", id: edge.id })),
              );
            }
            return;
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            archiveGroup(
              selected.map((n) => ({
                kind: n.type === "frame" ? "frame" : "item",
                id: n.id,
              })),
            );
          }
          if (e.key === "Enter") {
            const n = focusNode ?? selected[0];
            if (n?.type === "reference") {
              if (n.data.item.kind === "note") {
                const edit = () =>
                  container.current
                    ?.querySelector<HTMLButtonElement>(
                      `[data-id="${CSS.escape(n.id)}"] .sticky-edit-button`,
                    )
                    ?.click();
                if (
                  container.current?.querySelector(
                    `[data-id="${CSS.escape(n.id)}"] .sticky-edit-button`,
                  )
                )
                  edit();
                else
                  void flow
                    .fitView({ nodes: [{ id: n.id }], maxZoom: 1, duration: 0 })
                    .then(() => requestAnimationFrame(edit));
              } else {
                const item = n.data.item,
                  kind = referenceKind(item, n.data.path);
                if (kind === "link")
                  void api.openUrl(item.url ?? "").catch(error);
                else if (
                  (kind === "image" || kind === "video") &&
                  item.assetId
                ) {
                  void (
                    kind === "image"
                      ? api.assetPreview(item.assetId)
                      : api.referenceMedia(item.assetId)
                  )
                    .then((url) => {
                      if (url)
                        runtime.lightbox(
                          url,
                          item.title,
                          kind === "video" ? "video" : undefined,
                        );
                    })
                    .catch(error);
                } else if (kind !== "audio")
                  void api.openReferenceFile(n.data.path).catch(error);
              }
            } else if (n?.type === "frame") {
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
            const moved = selected.map((n) => {
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
              return { ...n, position };
            });
            dropNodes(moved);
          }
        }}
      >
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          // Keep an active note draft mounted while Flow virtualizes idle nodes.
          onlyRenderVisibleElements={editingNotes.size === 0}
          minZoom={0.1}
          maxZoom={4}
          nodeDragThreshold={4}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          snapToGrid
          snapGrid={[1, 1]}
          onNodesChange={(changes: NodeChange<CanvasNode>[]) => {
            if (dragCancelled.current && dragging.current)
              changes = changes.filter((change) => change.type !== "position");
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
            if (!dragOrigin.current.length)
              dragOrigin.current = flow.getNodes();
          }}
          onNodeDrag={(event, node, dragged) => {
            if (dragCancelled.current || !dragging.current) return;
            const point = dragPoint(event);
            const bounds = container.current?.getBoundingClientRect();
            const hit = document
              .elementsFromPoint(point.x, point.y)
              .find((element) => !element.closest(".reference-drag-preview"));
            const onCanvas =
              bounds &&
              point.x >= bounds.left &&
              point.x <= bounds.right &&
              point.y >= bounds.top &&
              point.y <= bounds.bottom &&
              (!hit || container.current?.contains(hit));
            setDragPreview(
              onCanvas ||
                point.x < 0 ||
                point.y < 0 ||
                point.x > window.innerWidth ||
                point.y > window.innerHeight
                ? null
                : {
                    ...point,
                    title:
                      node.type === "frame"
                        ? node.data.frame.title
                        : referenceLabel(node.data.item),
                    kind:
                      node.type === "frame"
                        ? "frame"
                        : referenceKind(node.data.item, node.data.path),
                    count: dragged.length || 1,
                  },
            );
            const target = boardDropTarget(point.x, point.y);
            if (target === dropHighlight.current) return;
            dropHighlight.current?.classList.remove("board-ref-drag-over");
            dropHighlight.current = target;
            target?.classList.add("board-ref-drag-over");
          }}
          onNodeDragStop={(event, node, dragged) => {
            setDragPreview(null);
            const point = dragPoint(event);
            const target = boardDropTarget(point.x, point.y);
            dropHighlight.current?.classList.remove("board-ref-drag-over");
            dropHighlight.current = null;
            if (target || dragCancelled.current) {
              setNodes(dragOrigin.current);
              dragging.current = false;
              if (target && !dragCancelled.current && latest.current)
                dispatchBoardDrop(
                  target,
                  choiceRefs(
                    (dragged.length ? dragged : [node]).map((n) => ({
                      id: n.id,
                      kind: n.type === "frame" ? "frame" : "item",
                    })),
                    latest.current,
                  ),
                );
              return;
            }
            dropNodes(dragged.length ? dragged : [node]);
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
            archiveGroup(edges.map((edge) => ({ kind: "edge", id: edge.id })));
          }}
          onMoveStart={viewportGesture.start}
          onMoveEnd={(_, v) => {
            viewportGesture.end();
            viewportSave.schedule(v);
          }}
          proOptions={{ hideAttribution: false }}
          edgesFocusable={false}
          onPaneClick={(event) => {
            if (placingNote) {
              placeNote({ x: event.clientX, y: event.clientY });
              return;
            }
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
          {noteDraft && noteDraft.projectId === app.data?.jam?.id && (
            <ViewportPortal>
              <DraftNote
                {...noteDraft}
                item={data?.items.find(
                  (item) => item.id === noteDraft.createdId,
                )}
                zoom={flow.getZoom()}
                confirmed={(item, previous) => {
                  setNoteDraft((current) =>
                    current ? { ...current, createdId: item.id } : null,
                  );
                  runtime.noteSaved?.(item, previous);
                }}
                close={(restoreFocus) => {
                  setNoteDraft(null);
                  if (restoreFocus)
                    container.current
                      ?.querySelector<HTMLButtonElement>("[data-reference-add]")
                      ?.focus();
                }}
                saved={(item, restoreFocus) => {
                  selectNext.current = item.id;
                  setNoteDraft(null);
                  announce("Note created");
                  if (restoreFocus)
                    container.current
                      ?.querySelector<HTMLButtonElement>("[data-reference-add]")
                      ?.focus();
                  // Creation is already confirmed; a failed reread must not offer create again.
                  void refresh().catch(error);
                }}
              />
            </ViewportPortal>
          )}
          <Background color="var(--ink-3)" gap={24} size={0.7} />
          {minimap && (
            <MiniMap
              pannable
              zoomable
              nodeColor={referenceMiniMapColor}
              maskColor="color-mix(in srgb, var(--paper) 65%, transparent)"
            />
          )}
        </ReactFlow>
        {marquee && (
          <div
            className="reference-marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
        {pick && pick.projectId === app.data?.jam?.id && (
          <section
            className="reference-pick-banner"
            aria-label="Pick references"
          >
            <span>Select items or a frame to link to {pick.targetKey}</span>
            <Button
              variant="primary"
              disabled={!pickWrite.ready || !(selectedItems || selectedFrames)}
              onClick={() => {
                if (!pickWrite.ready) return;
                const choices: ReferenceChoice[] = nodes
                  .filter((n) => n.selected)
                  .map((n) => ({
                    id: n.id,
                    kind: n.type === "frame" ? "frame" : "item",
                  }));
                pickWrite.run(
                  () => linkSelectionTo(choices, pick.targetKey),
                  () => {
                    canvasPick.set(null);
                    void refresh();
                    void navigate({ href: pick.returnTo });
                  },
                );
              }}
            >
              {pickBusy
                ? "Linking…"
                : `Link ${nodes.filter((n) => n.selected).length}`}
            </Button>
            <Button
              disabled={pickBusy}
              onClick={() => {
                canvasPick.set(null);
                void navigate({ href: pick.returnTo });
              }}
            >
              Cancel
            </Button>
            {pickWrite.error && <p role="alert">{String(pickWrite.error)}</p>}
          </section>
        )}
        {placingNote && (
          <div className="reference-note-placement" role="status">
            Click the canvas to place a note · Enter places it in view · Escape
            cancels
          </div>
        )}
        {dragPreview && <ReferenceDragPreview preview={dragPreview} />}
        <FileDropProgress progress={batch.progress} />
        <div className="reference-control-stack">
          <div
            className="reference-toolbar"
            role="toolbar"
            aria-label="Canvas tools"
          >
            <Tooltip text="Note · N">
              <Button
                variant="primary"
                aria-label="Note · N"
                onClick={beginNote}
                disabled={!!noteDraft || !!placingNote || !app.data?.jam}
              >
                <StickyNote size={16} /> Note
              </Button>
            </Tooltip>
            <div className="reference-add">
              <Button
                data-reference-add
                variant="ghost"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Plus size={16} />
                Add
                <ChevronDown size={14} aria-hidden="true" />
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
                    onClick={beginNote}
                    disabled={!!noteDraft || !!placingNote || !app.data?.jam}
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
            <Tooltip
              text={
                selectedItems || selectedFrames
                  ? "Link selected references"
                  : "Select items or a frame"
              }
            >
              <Button
                variant="ghost"
                disabled={!selectedItems && !selectedFrames}
                onClick={() =>
                  setLinkSelection(
                    nodes
                      .filter((n) => n.selected)
                      .map((n) => ({
                        id: n.id,
                        kind: n.type === "frame" ? "frame" : "item",
                      })),
                  )
                }
              >
                <Link2 size={16} />
                Link to…
              </Button>
            </Tooltip>
            <Button
              variant="ghost"
              aria-pressed={connect}
              onClick={() => setConnect(!connect)}
            >
              <Link2 size={16} />
              Connect
            </Button>
            {canvasContext.length >= 2 && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (
                    client.getQueryData<
                      Awaited<ReturnType<typeof api.appState>>
                    >(["app"])?.jam?.id !== app.data?.jam?.id
                  )
                    return;
                  compose({ text: "", context: canvasContext });
                }}
              >
                Ask brain ({canvasContext.length})
              </Button>
            )}
            <IconButton
              label="Fit view · F"
              onClick={() => void fitCanvas(reduced ? 0 : 220)}
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
              label="Undo · Ctrl+Z"
              aria-label="Undo"
              disabled={!history.canUndo}
              onClick={() => void undo()}
            >
              <Undo2 size={18} />
            </IconButton>
            <IconButton
              label="Redo · Ctrl+Shift+Z"
              aria-label="Redo"
              disabled={!history.canRedo}
              onClick={() => void undo(true)}
            >
              <Redo2 size={18} />
            </IconButton>
            <Button
              variant="ghost"
              disabled={read.pending || query.isFetching}
              aria-busy={read.pending || query.isFetching}
              onClick={explicitRefresh}
            >
              {read.pending ? "Checking references…" : "Refresh references"}
            </Button>
            <ReadReceipt
              checkedAt={read.checkedAt}
              phase={read.phase}
              resource="references"
            />
          </div>
          <fieldset
            className="reference-filters"
            aria-label="Filter references"
          >
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
          <div className="reference-read-notice">
            {query.error && query.data && (
              <QueryRefreshNotice
                error={query.error}
                resource="references"
                busy={query.isFetching}
                retry={explicitRefresh}
              />
            )}

            {query.isFetching &&
              query.data &&
              !query.error &&
              !read.pending && (
                <p role="status">
                  Refreshing references… showing the last loaded canvas.
                </p>
              )}
          </div>
        </div>
        {linkSelection && (
          <LinkTargetDialog
            choices={linkSelection}
            targets={targets}
            projectId={app.data?.jam?.id ?? ""}
            close={() => setLinkSelection(null)}
            saved={refresh}
            link={linkSelectionTo}
          />
        )}
        {!data?.items.some((item) => !item.archivedAt) &&
          !data?.frames.some((frame) => !frame.archivedAt) &&
          !noteDraft &&
          !placingNote && (
            <div className="reference-empty">
              <EmptyState
                image={paint}
                text="Double-click anywhere to jot an idea"
              >
                <p className="small muted">
                  or drop images, sounds, videos and links
                </p>
                <Button variant="primary" onClick={beginNote}>
                  New note
                </Button>
                <Button
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
            Drag between card handles to connect · right-click a connection to
            archive
          </div>
        )}
        {add === "link" && (
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
                  api.updateReference(
                    edit.id,
                    old.kind === "note" && edit.mode === "tags"
                      ? { tags: old.tags }
                      : {
                          title: old.title,
                          caption: old.captionMd,
                          tags: old.tags,
                        },
                  ),
                redo: () => api.updateReference(edit.id, patch),
              });
              setRevision((r) => r + 1);
              await refresh();
            }}
          />
        )}
        {taskNote && (
          <NoteTaskDialog
            item={taskNote}
            close={() => setTaskNote(null)}
            created={(key) => {
              setTaskNote(null);
              announce(`Task ${key} created and linked to note`);
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
            {lightbox.kind === "video" ? (
              <video
                src={lightbox.url}
                controls
                autoPlay
                aria-label={lightbox.title}
              >
                <track kind="captions" />
              </video>
            ) : (
              <img src={lightbox.url} alt={lightbox.title} />
            )}
          </Dialog>
        )}
        {edgeEdit && (
          <EdgeLabelDialog
            key={edgeEdit.id}
            edge={edgeEdit}
            close={() => setEdgeEdit(null)}
            refresh={() =>
              client.invalidateQueries(
                { queryKey: ["references"] },
                { throwOnError: true },
              )
            }
            archived={() => {
              const id = edgeEdit.id;
              history.record({
                label: "Archive reference",
                undo: () =>
                  api.canvasArchive({ kind: "edge", id, archived: false }),
                redo: () =>
                  api.canvasArchive({ kind: "edge", id, archived: true }),
              });
              setRevision((r) => r + 1);
              announce("Archived reference");
            }}
          />
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
