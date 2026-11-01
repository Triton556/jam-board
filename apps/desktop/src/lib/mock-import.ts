import type { JsonPayload } from "../bindings";
import type {
  ImportBatch,
  ImportCounts,
  ImportKind,
  ImportPlanInput,
  ImportReport,
  ImportRow,
  UndoImportResult,
} from "./import-plan-api";

export type MockImportRecord = ImportRow & {
  parent: string | null;
  fields: Record<string, JsonPayload>;
  status: string;
  updatedAt: string;
  importedAt?: string;
  importedHash?: string;
  importedPosition?: number;
  archived?: boolean;
  position: number;
};
type BatchItem = { before?: MockImportRecord; after: MockImportRecord };
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const counts = (): ImportCounts => ({
  created: 0,
  updated: 0,
  moved: 0,
  unchanged: 0,
  conflicts: 0,
  skipped: 0,
  notInFile: 0,
});
const identity = (kind: ImportKind, ref: string) => `${kind}:${ref}`;
const row = (r: MockImportRecord): ImportRow => ({
  kind: r.kind,
  key: r.key,
  externalRef: r.externalRef,
});
const shorten = (v: JsonPayload) =>
  typeof v === "string" && v.length > 500 ? `${v.slice(0, 500)}…` : v;

/** Isolated fictional import state until G folds it into the shared mock inventory. */
export class MockImport {
  records: MockImportRecord[];
  private batches: (ImportBatch & { items: BatchItem[] })[] = [];
  private receipts = new Map<string, { hash: string; report: ImportReport }>();
  private clock = 0;
  keyFloor: Record<string, number> = {};
  constructor(
    records: MockImportRecord[] = seededImportRecords(),
    private prefix = "JB",
  ) {
    this.records = clone(records);
  }
  exportState() {
    return {
      records: this.records,
      batches: this.batches,
      receipts: [...this.receipts],
      clock: this.clock,
    };
  }
  restoreState(value: ReturnType<MockImport["exportState"]>) {
    this.records = value.records;
    this.batches = value.batches;
    this.receipts = new Map(value.receipts);
    this.clock = value.clock;
    return this;
  }
  private stamp() {
    return new Date(Date.UTC(2026, 10, 1) + ++this.clock * 1000).toISOString();
  }
  async importPlan(input: ImportPlanInput): Promise<ImportReport> {
    const hash = canonical({ ...input, requestId: undefined });
    const receipt = input.requestId && this.receipts.get(input.requestId);
    if (!input.dryRun && receipt) {
      if (receipt.hash !== hash)
        throw new Error(
          "idempotency_conflict: requestId was used for another import.",
        );
      return clone(receipt.report);
    }
    const working = clone(this.records),
      seen = new Set<string>(),
      items: BatchItem[] = [];
    const report: ImportReport = {
      batchId: null,
      dryRun: !!input.dryRun,
      noChanges: false,
      counts: counts(),
      created: [],
      updated: [],
      moved: [],
      conflicts: [],
      skipped: [],
      notInFile: [],
    };
    let links = 0;
    const apply = (
      kind: ImportKind,
      source: Record<string, unknown>,
      parent: string | null,
      position: number,
    ) => {
      const { stories: _stories, tasks: _tasks, ...imported } = source;
      const fields = JSON.parse(JSON.stringify(imported)) as Record<
        string,
        JsonPayload
      >;
      const externalRef = String(fields.externalRef);
      delete fields.externalRef;
      const id = identity(kind, externalRef);
      seen.add(id);
      let existing = working.find(
        (r) => identity(r.kind, r.externalRef) === id && !r.archived,
      );
      const importedHash = canonical({ ...fields, parent });
      const before = existing && clone(existing);
      if (!existing) {
        const next =
          1 +
          Math.max(
            this.keyFloor[kind] ?? 0,
            ...working
              .filter((r) => r.kind === kind)
              .map((r) => Number(r.key.match(/\d+$/u)?.[0] ?? 0)),
          );
        existing = {
          kind,
          externalRef,
          key: `${this.prefix}-${kind === "epic" ? "E" : kind === "story" ? "S" : ""}${next}`,
          parent,
          fields,
          status: kind === "task" ? "backlog" : "draft",
          updatedAt: input.dryRun ? "preview" : this.stamp(),
          importedHash,
          position,
        };
        existing.importedAt = existing.updatedAt;
        existing.importedPosition = position;
        working.push(existing);
        report.created.push(row(existing));
        items.push({ after: clone(existing) });
        return;
      }
      const summary = row(existing);
      if (
        kind === "task" &&
        ["in_progress", "review", "done"].includes(existing.status)
      ) {
        report.skipped.push({ ...summary, reason: "task_in_work" });
        return;
      }
      const differences = Object.entries(fields)
        .filter(
          ([key, value]) =>
            canonical(existing?.fields[key] ?? "") !== canonical(value),
        )
        .map(([field, file]) => ({
          field,
          board: existing?.fields[field] ?? "",
          file,
        }));
      if (existing.parent !== parent)
        differences.push({
          field: "parent",
          board: existing.parent ?? "",
          file: parent ?? "",
        });
      const changed = existing.importedAt !== existing.updatedAt;
      if (
        existing.importedHash &&
        changed &&
        existing.importedHash === importedHash
      ) {
        report.skipped.push({ ...summary, reason: "board_newer" });
        return;
      }
      const conflict =
        (!existing.importedHash && differences.length > 0) ||
        (changed &&
          existing.importedHash !== importedHash &&
          differences.length > 0);
      if (conflict && !input.overwrite?.includes(externalRef)) {
        report.conflicts.push({
          ...summary,
          fields: differences.map((f) => ({
            ...f,
            board: shorten(f.board),
            file: shorten(f.file),
          })),
          boardUpdatedAt: existing.updatedAt,
          boardUpdatedBy: "Board owner",
        });
        return;
      }
      if (
        !differences.length &&
        (existing.position === position ||
          !existing.importedHash ||
          existing.importedPosition === position)
      ) {
        report.counts.unchanged++;
        if (!existing.importedHash) {
          existing.importedHash = importedHash;
          existing.importedAt = existing.updatedAt;
          existing.importedPosition = position;
          links++;
        }
        return;
      }
      const from = existing.parent;
      existing.fields = { ...existing.fields, ...fields };
      existing.parent = parent;
      existing.position = position;
      existing.updatedAt = input.dryRun ? "preview" : this.stamp();
      existing.importedAt = existing.updatedAt;
      existing.importedHash = importedHash;
      existing.importedPosition = position;
      if (from !== parent)
        report.moved.push({
          ...row(existing),
          from:
            working.find(
              (r) =>
                r.externalRef === from &&
                r.kind === (kind === "task" ? "story" : "epic"),
            )?.key ??
            from ??
            "",
          to:
            working.find(
              (r) =>
                r.externalRef === parent &&
                r.kind === (kind === "task" ? "story" : "epic"),
            )?.key ??
            parent ??
            "",
        });
      else
        report.updated.push({
          ...row(existing),
          fields: [
            ...differences.map((f) => f.field),
            ...(before?.position !== position ? ["position"] : []),
          ],
        });
      items.push({ before, after: clone(existing) });
    };
    input.epics.forEach((e, i) => {
      apply("epic", e, null, i);
      e.stories?.forEach((s, j) => {
        apply("story", s, e.externalRef, j);
        s.tasks?.forEach((t, k) => {
          apply("task", t, s.externalRef, k);
        });
      });
    });
    report.notInFile = working
      .filter((r) => !r.archived && !seen.has(identity(r.kind, r.externalRef)))
      .map(row);
    for (const name of [
      "created",
      "updated",
      "moved",
      "conflicts",
      "skipped",
      "notInFile",
    ] as const)
      report.counts[name] = report[name].length;
    report.noChanges = !items.length && !links;
    if (!input.dryRun && (items.length || links)) {
      this.records = working;
      if (items.length) {
        report.batchId = crypto.randomUUID();
        this.batches.unshift({
          batchId: report.batchId,
          createdAt: this.stamp(),
          actor: { name: "Board owner", kind: "human" },
          source: "ui",
          counts: clone(report.counts),
          undoneAt: null,
          items,
        });
      }
      if (input.requestId)
        this.receipts.set(input.requestId, { hash, report: clone(report) });
    }
    return report;
  }
  async listImportBatches(): Promise<ImportBatch[]> {
    return clone(
      this.batches.slice(0, 5).map(({ items: _items, ...batch }) => batch),
    );
  }
  async undoImport(batchId: string): Promise<UndoImportResult> {
    const batch = this.batches.find((b) => b.batchId === batchId);
    if (!batch) throw new Error("Import batch not found.");
    if (batch.undoneAt)
      throw new Error("already_undone: This import was already undone.");
    const result: UndoImportResult = { batchId, undone: 0, kept: [] };
    for (const item of [...batch.items].reverse()) {
      const index = this.records.findIndex(
        (r) => r.key === item.after.key && r.kind === item.after.kind,
      );
      const current = this.records[index];
      if (!current || current.updatedAt !== item.after.updatedAt) {
        result.kept.push({
          kind: item.after.kind,
          key: item.after.key,
          reason: "changed_after_import",
        });
        continue;
      }
      this.records[index] = item.before
        ? { ...clone(item.before), updatedAt: this.stamp() }
        : { ...current, archived: true, updatedAt: this.stamp() };
      result.undone++;
    }
    batch.undoneAt = this.stamp();
    return result;
  }
}

export function seededImportRecords(): MockImportRecord[] {
  const seed = (
    externalRef: string,
    kind: ImportKind,
    title: string,
    parent: string | null,
    synced = true,
  ): MockImportRecord => {
    const fields = { title },
      updatedAt = "2026-10-31T00:00:00Z";
    return {
      externalRef,
      kind,
      key: `JB-${kind === "epic" ? "E" : kind === "story" ? "S" : ""}${externalRef.length}`,
      fields,
      parent,
      status: kind === "task" ? "backlog" : "draft",
      position: 0,
      updatedAt,
      ...(synced
        ? {
            importedAt: updatedAt,
            importedHash: canonical({ ...fields, parent }),
          }
        : {}),
    };
  };
  const records = [
    seed("demo", "epic", "Demo plan", null),
    seed("demo/story", "story", "Demo story", "demo"),
    seed("demo/conflict", "task", "Board wording", "demo/story", false),
    seed("demo/update", "task", "Old wording", "demo/story"),
    seed("demo/link", "task", "Link me", "demo/story", false),
    seed("demo/newer", "task", "Original wording", "demo/story"),
    seed("demo/working", "task", "In progress", "demo/story"),
    seed("demo/move", "task", "Move me", "JB-S99"),
    seed("demo/missing", "task", "Not in file", "demo/story"),
  ];
  const newer = records.find((r) => r.externalRef === "demo/newer");
  if (newer) {
    newer.fields.title = "Human edit";
    newer.updatedAt = "2026-11-01T00:00:00Z";
  }
  const working = records.find((r) => r.externalRef === "demo/working");
  if (working) working.status = "in_progress";
  records.forEach((r, i) => {
    r.key = `JB-${r.kind === "epic" ? "E" : r.kind === "story" ? "S" : ""}${i + 1}`;
  });
  return records;
}
const projects = new Map<string, MockImport>();
export function mockImportFor(projectId: string) {
  let state = projects.get(projectId);
  if (!state) {
    state = new MockImport();
    projects.set(projectId, state);
  }
  return state;
}
