import type { ReferenceCanvas, RefItem } from "../../bindings";
import { api, type ReferenceVerdict } from "../../lib/api";
import { frameTargets, type ReferenceChoice } from "./linking";
import type { UndoAction } from "./model";

export function verdictActions(
  items: RefItem[],
  verdict: ReferenceVerdict,
): UndoAction[] {
  return items.map((item) => ({
    label: "Reference feedback",
    undo: () => api.setReferenceVerdict(item.id, item.verdict ?? null),
    redo: () => api.setReferenceVerdict(item.id, verdict),
  }));
}
export function referenceLinkActions(
  choices: ReferenceChoice[],
  key: string,
  data: ReferenceCanvas,
  targets: { id: string; key: string }[],
): UndoAction[] {
  const target = targets.find((row) => row.key === key);
  if (!target) throw Error("The linked work could not be found.");
  return choices
    .filter((choice) => {
      if (choice.kind === "frame") {
        const frame = data.frames.find((frame) => frame.id === choice.id);
        return (
          frame &&
          !frameTargets(frame, targets).some((link) => link.targetKey === key)
        );
      }
      return !data.links.some(
        (link) =>
          link.itemId === choice.id &&
          link.targetId === target.id &&
          !link.archivedAt,
      );
    })
    .map((choice) => ({
      label: "Link references",
      undo: () =>
        choice.kind === "frame"
          ? api.unlinkRefFrame(choice.id, key)
          : api.unlinkReference(choice.id, key),
      redo: () =>
        choice.kind === "frame"
          ? api.linkRefFrame(choice.id, key)
          : api.linkReference(choice.id, key),
    }));
}
