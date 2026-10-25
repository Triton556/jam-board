import { useEffect } from "react";
import type { RefItem } from "../../bindings";
import { type BrainContextItem, useBrainContext } from "../brain/brain-store";

const limit = (text: string, count: number) =>
  Array.from(text).slice(0, count).join("");
export function referenceBrainContext(
  item: RefItem,
  linkedKeys: string[] = [],
): BrainContextItem {
  const label =
    item.title ||
    (item.kind === "note" ? item.captionMd.split(/\r?\n/, 1)[0] : "") ||
    (item.kind === "note" ? "Untitled note" : "Reference");
  return {
    type: "board_ref",
    uri: `jam://reference/${item.id}`,
    label: limit(label, 60),
    text:
      limit(item.captionMd, 600) +
      (linkedKeys.length
        ? `\nLinked: ${[...new Set(linkedKeys)].join(", ")}`
        : ""),
  };
}
export function useCanvasBrainContext(items: BrainContextItem[]) {
  useEffect(() => {
    useBrainContext.getState().publish("canvas", items);
  }, [items]);
  useEffect(
    () => () => {
      useBrainContext.getState().publish("canvas", []);
    },
    [],
  );
}
