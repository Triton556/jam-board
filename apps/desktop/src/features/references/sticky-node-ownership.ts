import type { FrameNode, ItemNode } from "./Nodes";
export type CanvasNode = FrameNode | ItemNode;
/** Only in-memory active editors survive an omitted/collapsed server row. No
 * record is restored and no guessed text is merged with another ID. */
export function retainNoteEditors(
  next: CanvasNode[],
  previous: CanvasNode[],
  active: ReadonlySet<string>,
  projectId: string | undefined,
): CanvasNode[] {
  const result = next.map((node) =>
    node.type === "reference" &&
    node.data.item.jamId === projectId &&
    active.has(node.id)
      ? { ...node, hidden: false }
      : node,
  );
  const present = new Set(result.map((node) => node.id));
  for (const node of previous) {
    if (
      node.type !== "reference" ||
      node.data.item.kind !== "note" ||
      node.data.item.jamId !== projectId ||
      !active.has(node.id) ||
      present.has(node.id)
    )
      continue;
    const parent = previous.find((candidate) => candidate.id === node.parentId);
    const detached = !!node.parentId && !present.has(node.parentId);
    result.push({
      ...node,
      hidden: false,
      parentId: detached ? undefined : node.parentId,
      position: detached
        ? {
            x: node.position.x + (parent?.position.x ?? 0),
            y: node.position.y + (parent?.position.y ?? 0),
          }
        : node.position,
      data: { ...node.data, missing: true },
    });
  }
  return result;
}
export function editedNoteTarget(
  kind: "item" | "frame" | "edge",
  id: string,
  nodes: CanvasNode[],
  active: ReadonlySet<string>,
): boolean {
  return kind === "item"
    ? active.has(id)
    : kind === "frame" &&
        nodes.some(
          (node) =>
            node.type === "reference" &&
            node.parentId === id &&
            active.has(node.id),
        );
}
