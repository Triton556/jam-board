import type {
  CanvasGeometry,
  ReferenceCanvas,
  RefFrame,
  RefItem,
} from "../../bindings";
import type { LinkedFrame } from "../../lib/api";
import { applyCanvasGroup } from "./history-group";
export type ReferenceKind =
  | "image"
  | "audio"
  | "video"
  | "font"
  | "file"
  | "link"
  | "note";
export const referenceKindColors: Record<ReferenceKind, string> = {
  image: "var(--rose)",
  audio: "var(--sky)",
  video: "var(--mint)",
  font: "var(--lilac)",
  file: "var(--paper-2)",
  link: "var(--lilac)",
  note: "var(--butter)",
};
export function referenceKind(
  item: Pick<RefItem, "kind">,
  path = "",
): ReferenceKind {
  if (item.kind === "link" || item.kind === "note") return item.kind;
  const local = path.startsWith("\\\\?\\") ? path.slice(4) : path;
  const source = /^https?:\/\//i.test(local) ? local.split(/[?#]/)[0] : local;
  const ext = source?.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext ?? "")) return "image";
  if (["wav", "ogg", "mp3", "flac", "m4a"].includes(ext ?? "")) return "audio";
  if (["mp4", "webm", "mov", "m4v"].includes(ext ?? "")) return "video";
  if (["ttf", "otf", "woff", "woff2"].includes(ext ?? "")) return "font";
  return "file";
}
export function worldPosition(
  item: Pick<RefItem, "x" | "y" | "frameId">,
  frames: RefFrame[],
) {
  const f = frames.find((f) => f.id === item.frameId);
  return { x: (item.x ?? 0) + (f?.x ?? 0), y: (item.y ?? 0) + (f?.y ?? 0) };
}
export function parentAt(point: { x: number; y: number }, frames: RefFrame[]) {
  return frames
    .filter(
      (f) =>
        !f.archivedAt &&
        !f.collapsed &&
        point.x >= (f.x ?? 0) &&
        point.y >= (f.y ?? 0) &&
        point.x < (f.x ?? 0) + (f.w ?? 0) &&
        point.y < (f.y ?? 0) + (f.h ?? 0),
    )
    .sort((a, b) => (a.w ?? 0) * (a.h ?? 0) - (b.w ?? 0) * (b.h ?? 0))[0];
}
export function geometryAt(
  item: RefItem,
  point: { x: number; y: number },
  frames: RefFrame[],
): CanvasGeometry {
  const frame = parentAt(
    { x: point.x + (item.w ?? 240) / 2, y: point.y + 20 },
    frames,
  );
  return {
    id: item.id,
    x: point.x - (frame?.x ?? 0),
    y: point.y - (frame?.y ?? 0),
    w: item.w,
    h: item.h,
    z: item.z,
    frameId: frame?.id ?? null,
  };
}
export function linkedTargets(
  item: RefItem,
  data: ReferenceCanvas,
  targets: {
    id: string;
    key: string;
    epicId?: string;
    kind: string;
    color?: string;
  }[],
) {
  const links = data.links
    .filter((l) => l.itemId === item.id && !l.archivedAt)
    .map((l) => ({
      ...targets.find((t) => t.id === l.targetId),
      viaFrame: false,
    }))
    .filter(
      (t): t is typeof t & { id: string; key: string; kind: string } => !!t.key,
    );
  const frame = data.frames.find((f) => f.id === item.frameId && !f.archivedAt),
    epic = targets.find((t) => t.id === frame?.epicId);
  if (epic && !links.some((l) => l.id === epic.id))
    links.push({ ...epic, viaFrame: true });
  for (const link of (frame as LinkedFrame | undefined)?.links ?? []) {
    const target = targets.find((t) => t.key === link.targetKey);
    if (target && !links.some((l) => l.id === target.id))
      links.push({ ...target, viaFrame: true });
  }
  return links;
}
export type PasteContent =
  | { kind: "image"; file: File }
  | { kind: "link"; text: string }
  | { kind: "note"; text: string };
export function pasteContent(
  data: Pick<DataTransfer, "files" | "getData">,
): PasteContent | null {
  const image = Array.from(data.files).find((f) => f.type.startsWith("image/"));
  if (image) return { kind: "image", file: image };
  const text = data.getData("text/plain").trim();
  return text
    ? { kind: /^https?:\/\/\S+$/.test(text) ? "link" : "note", text }
    : null;
}
export function debounceSave<T>(save: (value: T) => void, delay = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending !== undefined) {
      const value = pending;
      pending = undefined;
      save(value);
    }
  };
  return {
    schedule(value: T) {
      pending = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        flush();
      }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
    flush,
  };
}
export type UndoAction = {
  label: string;
  undo(): Promise<unknown>;
  redo(): Promise<unknown>;
};
export class CanvasHistory {
  private past: UndoAction[] = [];
  private future: UndoAction[] = [];
  busy = false;
  get canUndo() {
    return this.past.length > 0;
  }
  get lastLabel() {
    return this.past.at(-1)?.label;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  record(action: UndoAction) {
    this.past.push(action);
    this.future = [];
  }
  async perform(label: string, actions: UndoAction[]) {
    if (!actions.length) return;
    if (this.busy) throw Error("Wait for the current canvas change to finish.");
    this.busy = true;
    try {
      await applyCanvasGroup(actions, "redo");
      this.record({
        label,
        undo: () => applyCanvasGroup(actions, "undo"),
        redo: () => applyCanvasGroup(actions, "redo"),
      });
    } finally {
      this.busy = false;
    }
  }
  async undo() {
    const action = this.past.at(-1);
    if (!action || this.busy) return;
    this.busy = true;
    try {
      await action.undo();
      this.past.pop();
      this.future.push(action);
    } finally {
      this.busy = false;
    }
  }
  async redo() {
    const action = this.future.at(-1);
    if (!action || this.busy) return;
    this.busy = true;
    try {
      await action.redo();
      this.future.pop();
      this.past.push(action);
    } finally {
      this.busy = false;
    }
  }
}
const histories = new Map<string, CanvasHistory>();
export function getCanvasHistory(projectId: string) {
  let history = histories.get(projectId);
  if (!history) {
    history = new CanvasHistory();
    histories.set(projectId, history);
  }
  return history;
}
export const palette = (color: string) =>
  /^m[1-6]$/.test(color) ? `var(--${color})` : color;
export function readingOrder<
  T extends {
    id: string;
    parentId?: string;
    position: { x: number; y: number };
  },
>(nodes: T[]): T[] {
  const lookup = new Map(nodes.map((n) => [n.id, n])),
    seen = new Set<string>(),
    ordered: T[] = [];
  const point = (n: T) => {
    const parent = n.parentId ? lookup.get(n.parentId) : null;
    return {
      x: n.position.x + (parent?.position.x ?? 0),
      y: n.position.y + (parent?.position.y ?? 0),
    };
  };
  const visit = (n: T) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    if (n.parentId) {
      const parent = lookup.get(n.parentId);
      if (parent) visit(parent);
    }
    ordered.push(n);
  };
  for (const n of [...nodes].sort((a, b) => {
    const p = point(a),
      q = point(b);
    return p.y - q.y || p.x - q.x;
  }))
    visit(n);
  return ordered;
}

/** Display/search aid only; never persisted as a substitute for an empty title. */
export function referenceLabel(
  item: Pick<RefItem, "kind" | "title" | "captionMd">,
) {
  if (item.title || item.kind !== "note") return item.title;
  return (
    item.captionMd
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 72) || "Empty note"
  );
}
