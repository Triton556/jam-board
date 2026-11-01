import { expect, it } from "vitest";
import type { ImportPlanInput } from "../../lib/import-plan-api";
import { MockImport } from "../../lib/mock-import";

const previewPlan: ImportPlanInput = {
  epics: [
    {
      externalRef: "demo",
      title: "Demo plan",
      stories: [
        {
          externalRef: "demo/story",
          title: "Demo story",
          tasks: [
            { externalRef: "demo/conflict", title: "File wording" },
            { externalRef: "demo/update", title: "New wording" },
            { externalRef: "demo/link", title: "Link me" },
            { externalRef: "demo/newer", title: "Original wording" },
            { externalRef: "demo/working", title: "File edit in work" },
            { externalRef: "demo/move", title: "Move me" },
            { externalRef: "demo/create", title: "Create me" },
          ],
        },
      ],
    },
  ],
};
it("previews every decision kind without writing state or history", async () => {
  const mock = new MockImport(),
    before = structuredClone(mock.records);
  const report = await mock.importPlan({ ...previewPlan, dryRun: true });
  expect(report.counts).toMatchObject({
    created: 1,
    moved: 1,
    conflicts: 1,
    skipped: 2,
    notInFile: 1,
  });
  expect(report.counts.updated).toBeGreaterThan(0);
  expect(report.counts.unchanged).toBeGreaterThan(0);
  expect(mock.records).toEqual(before);
  expect(await mock.listImportBatches()).toEqual([]);
});
it("requires explicit overwrite and never updates work in progress", async () => {
  const mock = new MockImport();
  const result = await mock.importPlan({
    ...previewPlan,
    overwrite: ["demo/conflict", "demo/working"],
    requestId: "apply",
  });
  expect(result.conflicts).toHaveLength(0);
  expect(
    mock.records.find((r) => r.externalRef === "demo/conflict")?.fields.title,
  ).toBe("File wording");
  expect(result.skipped).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "task_in_work" }),
      expect.objectContaining({ reason: "board_newer" }),
    ]),
  );
  expect((await mock.listImportBatches())[0]?.batchId).toBe(result.batchId);
});
it("identical reimport is a no-op and does not append a batch", async () => {
  const mock = new MockImport([]),
    input = {
      epics: [
        {
          externalRef: "e",
          title: "E",
          stories: [{ externalRef: "s", title: "S" }],
        },
      ],
    };
  await mock.importPlan(input);
  const before = structuredClone(mock.records);
  const result = await mock.importPlan(input);
  expect(result.noChanges).toBe(true);
  expect(result.batchId).toBeNull();
  expect(mock.records).toEqual(before);
  expect(await mock.listImportBatches()).toHaveLength(1);
});
it("links equal untracked records without a batch", async () => {
  const mock = new MockImport();
  mock.records = mock.records.filter((r) => r.externalRef === "demo/link");
  const record = mock.records[0];
  if (!record) throw new Error("Need link fixture");
  record.parent = null;
  record.kind = "epic";
  const result = await mock.importPlan({
    epics: [{ externalRef: "demo/link", title: "Link me" }],
  });
  expect(result.batchId).toBeNull();
  expect(result.noChanges).toBe(false);
  expect(result.counts.unchanged).toBe(1);
  expect(await mock.listImportBatches()).toHaveLength(0);
});
it("undo restores updates and moves, archives creates, and keeps later edits", async () => {
  const mock = new MockImport();
  const result = await mock.importPlan({
    ...previewPlan,
    overwrite: ["demo/conflict"],
  });
  const changed = mock.records.find((r) => r.externalRef === "demo/update");
  if (!changed) throw new Error("Missing record");
  changed.updatedAt = "later";
  changed.fields.title = "Later edit";
  const undo = await mock.undoImport(result.batchId as string);
  expect(undo.kept).toEqual([
    expect.objectContaining({
      key: changed.key,
      reason: "changed_after_import",
    }),
  ]);
  expect(
    mock.records.find((r) => r.externalRef === "demo/create")?.archived,
  ).toBe(true);
  expect(mock.records.find((r) => r.externalRef === "demo/move")?.parent).toBe(
    "JB-S99",
  );
  expect(
    mock.records.find((r) => r.externalRef === "demo/conflict")?.fields.title,
  ).toBe("Board wording");
  await expect(mock.undoImport(result.batchId as string)).rejects.toThrow(
    "already_undone",
  );
});
it("replays writes and rejects reused request IDs with a different payload", async () => {
  const mock = new MockImport([]),
    input = { requestId: "same", epics: [{ externalRef: "e", title: "E" }] };
  expect(await mock.importPlan(input)).toEqual(await mock.importPlan(input));
  await expect(
    mock.importPlan({
      ...input,
      epics: [{ externalRef: "e", title: "Changed" }],
    }),
  ).rejects.toThrow("idempotency_conflict");
});
