import { createContext, useContext } from "react";
import type { RefFrame, RefItem } from "../../bindings";
export type CanvasRuntime = {
  edit(id: string, mode: "caption" | "tags" | "link"): void;
  archive(kind: "item" | "frame" | "edge", id: string): void;
  resize(item: RefItem, w: number, h: number): void;
  resizeFrame(frame: RefFrame, w: number, h: number): void;
  collapse(frame: RefFrame): void;
  editFrame(frame: RefFrame): void;
  open(key: string): void;
  lightbox(url: string, title: string): void;
  edgeLabel(id: string, label: string): void;
  caption(item: RefItem, value: string): Promise<void>;
};
export const CanvasContext = createContext<CanvasRuntime | null>(null);
export function useCanvas() {
  const c = useContext(CanvasContext);
  if (!c) throw Error("Canvas provider missing");
  return c;
}
