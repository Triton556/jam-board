import type { Node } from "@xyflow/react";
import { referenceKind, referenceKindColors } from "./model";
import type { ItemData } from "./Nodes";

/** React Flow MiniMap writes this colour to its per-node CSS fill variable. */
export function referenceMiniMapColor(node: Pick<Node, "type" | "data">) {
  const data = node.data as Partial<ItemData>;
  return node.type === "frame" || !data.item
    ? "transparent"
    : referenceKindColors[referenceKind(data.item, data.path)];
}
