import { createContext, useContext } from "react";
import type { RefFrame, RefItem } from "../../bindings";
export type CanvasRuntime = {
  edit(id: string, mode: "caption" | "tags" | "link"): void;
  archive(kind: "item" | "frame" | "edge", id: string): void;
  resize(item: RefItem, w: number, h: number): void;
  resizeFrame(frame: RefFrame, w: number, h: number): void;
  collapse(frame: RefFrame): void;
  editFrame(frame: RefFrame): void;
  linkFrame?(frame: RefFrame): void;
  unlinkFrame?(frame: RefFrame, key: string): void;
  unlinkItem?(item: RefItem, key: string): void;
  verdict?(item: RefItem, verdict: "keep" | "reject" | null): Promise<void>;
  open(key: string): void;
  lightbox(url: string, title: string, kind?: "video"): void;
  edgeLabel(id: string, label: string): void;
  noteEditing?(id: string, active: boolean): void;
  noteSaved?(item: RefItem, previous?: RefItem): void;
  createTask?(item: RefItem): void;
  askBrain?(item: RefItem, linkedKeys: string[]): void;
  caption(item: RefItem, value: string): Promise<void>;
};
export const CanvasContext = createContext<CanvasRuntime | null>(null);
export function useCanvas() {
  const c = useContext(CanvasContext);
  if (!c) throw Error("Canvas provider missing");
  return c;
}
