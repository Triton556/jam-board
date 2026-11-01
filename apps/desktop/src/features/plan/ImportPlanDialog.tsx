import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, SegmentedControl, Stamp } from "../../components/ui";
import {
  assertPlanContext,
  capturePlanContext,
  type ImportBatch,
  type ImportConflict,
  type ImportPlanInput,
  type ImportReport,
  importBatchesQuery,
  importPlan,
  listImportBatches,
  type PlanContext,
  type UndoImportResult,
  undoImport,
  validateImportPlan,
} from "../../lib/import-plan-api";
import {
  missingPlanRefsWarning,
  parsePlanMarkdown,
  planHasGeneratedRefs,
} from "../../lib/plan-markdown";
import { invalidatePlanning } from "../../lib/planning-queries";
import { relativeTime } from "../../lib/time";
import { importFieldLabel } from "./import-field-labels";
import "./round12-plan.css";

const labels = {
  created: "Create",
  updated: "Update",
  moved: "Move",
  unchanged: "Unchanged",
  conflicts: "Conflicts",
  skipped: "Skipped",
  notInFile: "Not in file",
};
const text = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);
function DiffValue({ value }: { value: unknown }) {
  const [all, setAll] = useState(false),
    content = text(value) ?? "";
  return (
    <div>
      <pre>{all ? content : content.slice(0, 180)}</pre>
      {content.length > 180 && (
        <Button variant="ghost" onClick={() => setAll(!all)}>
          {all ? "Show less" : "Show all"}
        </Button>
      )}
    </div>
  );
}
function Conflict({
  row,
  title,
  useFile,
  choose,
}: {
  row: ImportConflict;
  title: string;
  useFile: boolean;
  choose(value: boolean): void;
}) {
  return (
    <article className="import-conflict">
      <h3>
        {row.key} · {title}
      </h3>
      <p className="small muted">
        changed by {row.boardUpdatedBy} ·{" "}
        <time
          dateTime={row.boardUpdatedAt}
          title={new Date(row.boardUpdatedAt).toLocaleString("en")}
        >
          {relativeTime(row.boardUpdatedAt)}
        </time>
      </p>
      {row.fields.map((field) => (
        <section key={field.field}>
          <h4>{importFieldLabel(field.field)}</h4>
          <div className="import-diff">
            <div>
              <strong>On the board</strong>
              <DiffValue value={field.board} />
            </div>
            <div>
              <strong>In the file</strong>
              <DiffValue value={field.file} />
            </div>
          </div>
        </section>
      ))}
      <SegmentedControl
        label={`Resolve ${row.externalRef}`}
        value={useFile ? "file" : "board"}
        onChange={(value) => choose(value === "file")}
        options={[
          { value: "board", label: "Keep board" },
          { value: "file", label: "Use file" },
        ]}
      />
    </article>
  );
}
export function ImportPlanDialog({
  close,
  history = false,
}: {
  close(): void;
  history?: boolean;
}) {
  const client = useQueryClient();
  const fileId = useId();
  const fileStatusId = useId();
  const [context, setContext] = useState<PlanContext>();
  const [input, setInput] = useState<ImportPlanInput>();
  const [filename, setFilename] = useState("");
  const [warning, setWarning] = useState(false);
  const [report, setReport] = useState<ImportReport>();
  const [done, setDone] = useState(false);
  const [overwrite, setOverwrite] = useState<string[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [undone, setUndone] = useState<UndoImportResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false),
    alive = useRef(true),
    fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const titleFor = (row: { kind: string; externalRef: string }) => {
    for (const epic of input?.epics ?? []) {
      if (row.kind === "epic" && epic.externalRef === row.externalRef)
        return epic.title;
      for (const story of epic.stories ?? []) {
        if (row.kind === "story" && story.externalRef === row.externalRef)
          return story.title;
        const task = story.tasks?.find(
          (task) => row.kind === "task" && task.externalRef === row.externalRef,
        );
        if (task) return task.title;
      }
    }
    return row.externalRef;
  };
  useEffect(() => {
    alive.current = true;
    void capturePlanContext()
      .then(async (captured) => {
        if (!alive.current) return;
        setContext(captured);
        if (history) {
          const rows = await client.fetchQuery(importBatchesQuery(captured));
          if (alive.current) setBatches(rows);
        }
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, [history, client]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current || !context) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await assertPlanContext(context);
      await work();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const read = (file?: File) => {
    if (!file || lock.current || !context) return;
    setInput(undefined);
    setFilename(file.name);
    setWarning(false);
    void run(async () => {
      if (!/\.(md|json)$/iu.test(file.name))
        throw new Error("Choose a .json or .md file.");
      const source = await file.text();
      const parsed = file.name.toLowerCase().endsWith(".md")
        ? parsePlanMarkdown(source)
        : validateImportPlan(JSON.parse(source));
      validateImportPlan(parsed);
      if (context) await assertPlanContext(context);
      if (!alive.current) return;
      // File content cannot smuggle a previous request, dry-run flag or overwrite approval.
      setInput({ epics: parsed.epics });
      setWarning(planHasGeneratedRefs(parsed));
      setFilename(file.name);
      setReport(undefined);
      setDone(false);
      setOverwrite([]);
      setUndone(undefined);
      requestId.current = crypto.randomUUID();
    });
  };
  const undo = (batchId: string) =>
    void run(async () => {
      const result = await undoImport(batchId, context);
      invalidatePlanning(client);
      if (context) await assertPlanContext(context);
      if (!alive.current) return;
      setUndone(result);
      setBatches(await listImportBatches(context));
    });
  return (
    <Dialog
      title={history ? "Import history" : "Import plan"}
      onClose={close}
      busy={busy}
      className="import-plan-dialog"
    >
      {error && <p role="alert">{error}</p>}
      {!context && !error && <p role="status">Checking the current project…</p>}
      {busy && (
        <p role="status">
          {done || history
            ? "Saving… Wait for the result before closing."
            : "Reading plan…"}
        </p>
      )}
      {history ? (
        <div className="import-history">
          {context && !batches.length && <p>No imports yet.</p>}
          {batches.map((batch) => (
            <article key={batch.batchId}>
              <strong>{batch.createdAt}</strong>
              <p>
                {batch.actor.name} · {batch.source} · {batch.counts.created}{" "}
                created, {batch.counts.updated} updated, {batch.counts.moved}{" "}
                moved
              </p>
              {batch.undoneAt ? (
                <span>Undone</span>
              ) : (
                <Button disabled={busy} onClick={() => undo(batch.batchId)}>
                  Undo
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : done && report ? (
        <div className="import-result" role="status">
          <h3>
            {report.noChanges
              ? "Nothing to import — the board already matches the file."
              : `Imported: ${report.counts.created} created, ${report.counts.updated} updated.`}
          </h3>
          <p>
            {report.counts.moved} moved · {report.counts.conflicts} conflicts ·{" "}
            {report.counts.skipped} skipped · {report.counts.notInFile} left as
            is
          </p>
          {report.batchId && !undone && (
            <Button
              disabled={busy}
              onClick={() => undo(report.batchId as string)}
            >
              Undo
            </Button>
          )}
          <Button disabled={busy} onClick={close}>
            Done
          </Button>
        </div>
      ) : report ? (
        <>
          <p className="small muted">Step 2 · Preview · {filename}</p>
          <div className="import-counts">
            {Object.entries(report.counts).map(([key, count]) => (
              <Stamp key={key}>
                {labels[key as keyof typeof labels]} {count}
              </Stamp>
            ))}
          </div>
          <div className="import-groups">
            <details open>
              <summary>Conflicts ({report.conflicts.length})</summary>
              {report.conflicts.map((row) => (
                <Conflict
                  key={`${row.kind}:${row.externalRef}`}
                  row={row}
                  title={titleFor(row)}
                  useFile={overwrite.includes(row.externalRef)}
                  choose={(yes) =>
                    setOverwrite((old) =>
                      yes
                        ? [...old, row.externalRef]
                        : old.filter((ref) => ref !== row.externalRef),
                    )
                  }
                />
              ))}
            </details>
            {(
              ["created", "updated", "moved", "skipped", "notInFile"] as const
            ).map((group) => (
              <details key={group}>
                <summary>
                  {labels[group]} ({report[group].length})
                </summary>
                {report[group].map((row) => (
                  <p key={`${row.kind}:${row.externalRef}`}>
                    <strong>{row.key}</strong> · {titleFor(row)}
                    {"reason" in row
                      ? ` · ${row.reason === "task_in_work" ? "In progress — imports never change tasks in work" : "Changed on the board, unchanged in the file"}`
                      : group === "notInFile"
                        ? " — Left as is"
                        : "from" in row
                          ? ` · ${row.from} → ${row.to}`
                          : ""}
                  </p>
                ))}
              </details>
            ))}
            <details>
              <summary>Unchanged ({report.counts.unchanged})</summary>
              <p>Already matches the file.</p>
            </details>
          </div>
          <div className="dialog-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setReport(undefined);
                setOverwrite([]);
              }}
            >
              Back
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!input) return;
                  const result = await importPlan(
                    {
                      ...input,
                      requestId: requestId.current,
                      dryRun: false,
                      overwrite,
                    },
                    context,
                  );
                  invalidatePlanning(client);
                  if (context) await assertPlanContext(context);
                  if (alive.current) {
                    setReport(result);
                    setDone(true);
                  }
                })
              }
            >
              Apply
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>Step 1 · Choose a plan</p>
          <section
            className="import-dropzone"
            aria-label="Drop plan file"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) read(e.dataTransfer.files[0]);
            }}
          >
            <p>Drop a .json or .md file, or pick one.</p>
            <input
              id={fileId}
              ref={fileInput}
              className="sr-only"
              type="file"
              tabIndex={-1}
              accept=".json,.md"
              aria-label="Plan file"
              aria-describedby={fileStatusId}
              disabled={busy || !context}
              onChange={(e) => read(e.target.files?.[0])}
            />
            <Button
              disabled={busy || !context}
              aria-controls={fileId}
              aria-describedby={fileStatusId}
              onClick={() => fileInput.current?.click()}
            >
              Choose file…
            </Button>
            <p id={fileStatusId} role="status">
              {filename || "No file chosen"}
            </p>
          </section>
          {warning && <p className="notice">{missingPlanRefsWarning}</p>}
          <div className="dialog-actions">
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!input || busy || !context}
              onClick={() =>
                void run(async () => {
                  if (!input) return;
                  const result = await importPlan(
                    { ...input, requestId: requestId.current, dryRun: true },
                    context,
                  );
                  if (context) await assertPlanContext(context);
                  if (alive.current) setReport(result);
                })
              }
            >
              Preview
            </Button>
          </div>
        </>
      )}
      {undone && (
        <div role="status">
          <p>
            Import undone. {undone.undone} undone, {undone.kept.length} kept.
          </p>
          {undone.kept.map((row) => (
            <p key={row.key}>{row.key} · Changed after import — kept</p>
          ))}
        </div>
      )}
    </Dialog>
  );
}
