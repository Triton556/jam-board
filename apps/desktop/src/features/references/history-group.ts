import type { UndoAction } from "./model";
/** Undo/redo compensate completed members if a later member fails. */
export async function applyCanvasGroup(
  actions: UndoAction[],
  direction: "undo" | "redo",
) {
  const completed: UndoAction[] = [];
  try {
    for (const action of direction === "undo"
      ? [...actions].reverse()
      : actions) {
      await action[direction]();
      completed.push(action);
    }
  } catch (reason) {
    const failures: unknown[] = [reason];
    for (const action of completed.reverse()) {
      try {
        await action[direction === "undo" ? "redo" : "undo"]();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Canvas change failed; rollback could not finish. Refresh to inspect the canvas.",
      );
    throw reason;
  }
}
