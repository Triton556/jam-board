import { queryOptions } from "@tanstack/react-query";
import type { FolderCommandContext } from "../bindings";
import {
  commands,
  type MoveStoryInput,
  type MoveTaskToStoryInput,
  type Story_Serialize,
  type TaskDetail_Serialize,
} from "../bindings";
import { api } from "./api";

// Draft files omit requestId; the adapter assigns one before the typed command.
export type ImportTask = import("../bindings").ImportTask_Deserialize;
export type ImportStory = import("../bindings").ImportStory_Deserialize;
export type ImportEpic = import("../bindings").ImportEpic_Deserialize;
export type ImportPlanInput = Omit<
  import("../bindings").ImportPlanInput_Deserialize,
  "requestId"
> & { requestId?: string };
export type ImportKind = import("../bindings").RecordKind;
export type ImportRow = import("../bindings").ImportRecord;
export type ImportCounts = import("../bindings").ImportCounts;
export type ImportConflict = import("../bindings").ImportConflict;
export type ImportReport = import("../bindings").ImportPlanReport_Serialize;
export type ImportBatch = import("../bindings").ImportBatchSummary;
export type UndoImportResult = import("../bindings").UndoImportReport;
export type PlanContext = {
  projectId: string;
  folder: FolderCommandContext | null;
};
export async function capturePlanContext(): Promise<PlanContext> {
  const [app, folder] = await Promise.all([
    api.appState(),
    api.projectSelectionContext(),
  ]);
  if (!app.jam) throw new Error("Select a project first.");
  return { projectId: app.jam.id, folder };
}
export async function assertPlanContext(context: PlanContext) {
  const current = await capturePlanContext();
  if (
    current.projectId !== context.projectId ||
    JSON.stringify(current.folder) !== JSON.stringify(context.folder)
  )
    throw new Error("The project changed. Close and reopen this dialog.");
}
export function validateImportPlan(value: unknown): ImportPlanInput {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as ImportPlanInput).epics)
  )
    throw new Error("The file must contain an epics array.");
  const plan = value as ImportPlanInput;
  const refs = new Set<string>();
  let count = 0;
  const check = (
    row: { title: string; externalRef: string },
    kind: ImportKind,
  ) => {
    if (
      !row ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      row.title.length > 140 ||
      typeof row.externalRef !== "string" ||
      !row.externalRef.trim() ||
      row.externalRef.length > 120
    )
      throw new Error(
        "Each record needs a title (1–140 characters) and externalRef (1–120 characters).",
      );
    const refIdentity = `${kind}:${row.externalRef}`;
    if (refs.has(refIdentity))
      throw new Error(`Duplicate reference ${row.externalRef}.`);
    refs.add(refIdentity);
    count++;
  };
  for (const e of plan.epics) {
    check(e, "epic");
    for (const s of e.stories ?? []) {
      check(s, "story");
      for (const t of s.tasks ?? []) check(t, "task");
    }
  }
  if (count > 1000) throw new Error("Import at most 1000 records at a time.");
  if (!count) throw new Error("The plan contains no records.");
  return plan;
}
export async function importPlan(
  input: ImportPlanInput,
  context?: PlanContext,
): Promise<ImportReport> {
  const captured = context ?? (await capturePlanContext());
  await assertPlanContext(captured);
  validateImportPlan(input);
  const request = {
    ...input,
    requestId: input.requestId ?? crypto.randomUUID(),
  };
  return api.importPlan(captured, request);
}
export async function undoImport(
  batchId: string,
  context?: PlanContext,
): Promise<UndoImportResult> {
  const captured = context ?? (await capturePlanContext());
  await assertPlanContext(captured);
  return api.undoImport(captured, batchId, crypto.randomUUID());
}
export async function listImportBatches(
  context?: PlanContext,
): Promise<ImportBatch[]> {
  const captured = context ?? (await capturePlanContext());
  await assertPlanContext(captured);
  return api.listImportBatches(captured);
}
export const importBatchesQuery = (context: PlanContext) =>
  queryOptions({
    queryKey: ["importBatches", context.projectId, context.folder],
    queryFn: () => listImportBatches(context),
  });
export const planMoves = {
  async story(
    context: PlanContext,
    input: MoveStoryInput,
  ): Promise<Story_Serialize> {
    await assertPlanContext(context);
    return api.moveStory(context, input);
  },
  async task(
    context: PlanContext,
    input: MoveTaskToStoryInput,
  ): Promise<TaskDetail_Serialize> {
    await assertPlanContext(context);
    return api.moveTaskToStory(context, input);
  },
};
