import type { ReferenceCanvas, RefFrame, RefItem } from "../../bindings";
import { api, type FrameTarget, type LinkedFrame } from "../../lib/api";
import { referenceLabel } from "./model";

export type ReferenceChoice = { id: string; kind: "item" | "frame" };
export type BoardRef = { uri: string; label: string; text: string };
export type BoardRefDrop = { target: string; refs: BoardRef[] };
export function frameTargets(
  frame: RefFrame,
  targets: { id: string; key: string; title?: string; kind?: string }[] = [],
): FrameTarget[] {
  const links = [...((frame as LinkedFrame).links ?? [])];
  const epic = targets.find((t) => t.id === frame.epicId);
  if (epic && !links.some((l) => l.targetKey === epic.key))
    links.unshift({
      targetKey: epic.key,
      title: epic.title ?? epic.key,
      kind: "epic",
    });
  return links;
}
export async function linkChoices(
  choices: ReferenceChoice[],
  key: string,
  projectId?: string,
) {
  for (const choice of choices) {
    if (projectId && (await api.appState()).jam?.id !== projectId)
      throw Error("The project changed before linking finished.");
    if (choice.kind === "frame") await api.linkRefFrame(choice.id, key);
    else await api.linkReference(choice.id, key);
  }
}
export function choiceRefs(
  choices: ReferenceChoice[],
  data: ReferenceCanvas,
): BoardRef[] {
  return choices.flatMap((choice) => {
    const row =
      choice.kind === "frame"
        ? data.frames.find((f) => f.id === choice.id)
        : data.items.find((i) => i.id === choice.id);
    if (!row || row.archivedAt) return [];
    return [
      {
        uri: `jam://${choice.kind === "frame" ? "frame" : "reference"}/${row.id}`,
        label:
          choice.kind === "frame" ? row.title : referenceLabel(row as RefItem),
        text: "captionMd" in row ? row.captionMd : row.title,
      },
    ];
  });
}
export function dropChoices(refs: BoardRef[]): ReferenceChoice[] {
  return refs.flatMap((ref) => {
    const match = /^jam:\/\/(reference|frame)\/([^/]+)$/.exec(ref.uri);
    return match?.[2]
      ? [
          {
            id: match[2],
            kind: match[1] === "frame" ? ("frame" as const) : ("item" as const),
          },
        ]
      : [];
  });
}
export function boardDropTarget(x: number, y: number) {
  return (
    document
      .elementsFromPoint(x, y)
      .map((element) => element.closest<HTMLElement>("[data-board-ref-drop]"))
      .find(Boolean) ?? null
  );
}
export function dragPoint(event: MouseEvent | TouchEvent) {
  const point = "clientX" in event ? event : event.changedTouches[0];
  return point ? { x: point.clientX, y: point.clientY } : { x: -1, y: -1 };
}
export function dispatchBoardDrop(target: HTMLElement, refs: BoardRef[]) {
  window.dispatchEvent(
    new CustomEvent<BoardRefDrop>("jam:board-ref-drop", {
      detail: { target: target.dataset.boardRefDrop ?? "", refs },
    }),
  );
}
type PickSession = { projectId: string; targetKey: string; returnTo: string };
let picking: PickSession | null = null;
const listeners = new Set<() => void>();
export const canvasPick = {
  get: () => picking,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set: (session: PickSession | null) => {
    picking = session;
    for (const listener of listeners) listener();
  },
};
