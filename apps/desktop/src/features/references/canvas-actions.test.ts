import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { referenceLinkActions, verdictActions } from "./canvas-actions";
import { CanvasHistory } from "./model";

beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
it("a failed group write compensates completed members and adds no undo entry", async () => {
  const state = [0, 0],
    history = new CanvasHistory();
  await expect(
    history.perform(
      "Move group",
      state.map((_, index) => ({
        label: "Move",
        redo: async () => {
          if (index === 1) throw Error("second write failed");
          state[index] = 1;
        },
        undo: async () => {
          state[index] = 0;
        },
      })),
    ),
  ).rejects.toThrow("second write failed");
  expect(state).toEqual([0, 0]);
  expect(history.canUndo).toBe(false);
  expect(history.busy).toBe(false);
});
it("failed group undo restores completed members and keeps the whole entry available", async () => {
  const state = [0, 0],
    history = new CanvasHistory();
  let fail = false;
  await history.perform(
    "Group",
    state.map((_, index) => ({
      label: "Change",
      redo: async () => {
        state[index] = 1;
      },
      undo: async () => {
        if (index === 0 && fail) throw Error("undo failed");
        state[index] = 0;
      },
    })),
  );
  fail = true;
  await expect(history.undo()).rejects.toThrow("undo failed");
  expect(state).toEqual([1, 1]);
  expect(history.canUndo).toBe(true);
  expect(history.canRedo).toBe(false);
  fail = false;
  await history.undo();
  expect(state).toEqual([0, 0]);
});
it("mixed frame/item group link undo retains pre-existing associations", async () => {
  const frame = await mockApi.createRefFrame({ title: "Group", x: 0, y: 0 });
  const item = await mockApi.addReference({
    kind: "note",
    title: "New link",
    text: "new",
  });
  const existing = await mockApi.addReference({
    kind: "note",
    title: "Old link",
    text: "old",
    linkTo: "JB-1",
  });
  const target = Object.values(await mockApi.listBoardTasks())
    .flat()
    .find((row) => row.key === "JB-1");
  if (!target) throw Error("Missing target");
  const history = new CanvasHistory();
  const actions = referenceLinkActions(
    [
      { kind: "frame", id: frame.id },
      { kind: "item", id: item.id },
      { kind: "item", id: existing.id },
    ],
    target.key,
    await mockApi.referenceCanvas(),
    [target],
  );
  expect(actions).toHaveLength(2);
  await history.perform("Link group", actions);
  await history.undo();
  let data = await mockApi.referenceCanvas();
  expect(data.frames.find((row) => row.id === frame.id)?.links).toHaveLength(0);
  expect(
    data.links.filter((row) => !row.archivedAt).map((row) => row.itemId),
  ).toEqual([existing.id]);
  await history.redo();
  data = await mockApi.referenceCanvas();
  expect(data.links.filter((row) => !row.archivedAt)).toHaveLength(2);
});
it("group feedback undo restores each item's own previous verdict", async () => {
  const a = await mockApi.addReference({ kind: "note", text: "A" });
  const b = await mockApi.addReference({ kind: "note", text: "B" });
  const rejected = await mockApi.setReferenceVerdict(b.id, "reject");
  const history = new CanvasHistory();
  await history.perform("Feedback", verdictActions([a, rejected], "keep"));
  await history.undo();
  const data = await mockApi.referenceCanvas();
  expect(
    [a.id, b.id].map(
      (id) => data.items.find((row) => row.id === id)?.verdict ?? null,
    ),
  ).toEqual([null, "reject"]);
});
