import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  capturePlanContext,
  importPlan,
  listImportBatches,
  planMoves,
  undoImport,
  validateImportPlan,
} from "../../lib/import-plan-api";
import { mockApi } from "../../lib/mock-bridge";
import { tauriApi } from "../../lib/tauri-bridge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(async () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "0");
  for (const key of [
    "importPlan",
    "undoImport",
    "listImportBatches",
    "moveStory",
    "moveTaskToStory",
  ] as const)
    vi.spyOn(mockApi, key).mockImplementation(tauriApi[key] as never);
  vi.mocked(invoke).mockReset();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("uses the three exact import/history command names and UI history limit", async () => {
  const context = await capturePlanContext(),
    input = {
      requestId: "file",
      epics: [{ externalRef: "e", title: "E" }],
      dryRun: true,
      overwrite: ["e"],
    };
  vi.mocked(invoke).mockResolvedValue({});
  await importPlan(input, context);
  expect(invoke).toHaveBeenLastCalledWith("import_plan", {
    context: context.folder,
    input,
  });
  await undoImport("batch", context);
  expect(invoke).toHaveBeenLastCalledWith("undo_import", {
    context: context.folder,
    input: { batchId: "batch", requestId: expect.any(String) },
  });
  await listImportBatches(context);
  expect(invoke).toHaveBeenLastCalledWith("list_import_batches", {
    context: context.folder,
    limit: 5,
  });
});
it("fences captured project selection before an import dispatch", async () => {
  const context = await capturePlanContext();
  context.projectId = "another-project";
  await expect(
    importPlan({ epics: [{ externalRef: "e", title: "E" }] }, context),
  ).rejects.toThrow("project changed");
  expect(invoke).not.toHaveBeenCalled();
});
it("uses the generated move commands and unwraps backend errors", async () => {
  const context = await capturePlanContext();
  if (!context.folder) throw new Error("Missing fictional folder context");
  vi.mocked(invoke).mockResolvedValue({ key: "JB-S1" });
  await planMoves.story(context, {
    key: "JB-S1",
    toEpicKey: "JB-E2",
    beforeKey: null,
    afterKey: null,
    expectedUpdatedAt: "story-version",
    requestId: "story",
  });
  expect(invoke).toHaveBeenLastCalledWith(
    "move_story",
    expect.objectContaining({
      context: context.folder,
      input: expect.objectContaining({ expectedUpdatedAt: "story-version" }),
    }),
  );
  vi.mocked(invoke).mockRejectedValue({
    message: "stale version",
    code: "conflict",
  });
  await expect(
    planMoves.task(context, {
      key: "JB-2",
      toStoryKey: "JB-S2",
      expectedUpdatedAt: "old",
      expectedClaimGeneration: "generation",
      requestId: "task",
    }),
  ).rejects.toThrow("stale version");
});
it("keeps the native story conflict code for Undo feedback", async () => {
  const context = await capturePlanContext();
  vi.mocked(invoke).mockRejectedValue({
    code: "conflict",
    message: "Concurrent modification",
  });
  await expect(
    planMoves.story(context, {
      key: "JB-S1",
      toEpicKey: "JB-E1",
      expectedUpdatedAt: "captured-version",
      requestId: "undo",
      beforeKey: null,
      afterKey: null,
    }),
  ).rejects.toMatchObject({
    code: "conflict",
    message: "Concurrent modification",
  });
  expect(invoke).toHaveBeenLastCalledWith(
    "move_story",
    expect.objectContaining({
      input: expect.objectContaining({
        expectedUpdatedAt: "captured-version",
        requestId: "undo",
      }),
    }),
  );
});
it("validates file shape, record count and kind-scoped external references", () => {
  expect(() => validateImportPlan({})).toThrow("epics array");
  expect(() => validateImportPlan({ epics: [] })).toThrow("no records");
  expect(() =>
    validateImportPlan({
      epics: Array.from({ length: 1001 }, (_, i) => ({
        title: "E",
        externalRef: `e${i}`,
      })),
    }),
  ).toThrow("1000 records");
  expect(() =>
    validateImportPlan({
      epics: [
        {
          title: "E",
          externalRef: "same",
          stories: [{ title: "S", externalRef: "same" }],
        },
      ],
    }),
  ).not.toThrow();
  expect(() =>
    validateImportPlan({
      epics: [
        { title: "A", externalRef: "same" },
        { title: "B", externalRef: "same" },
      ],
    }),
  ).toThrow("Duplicate reference");
});
