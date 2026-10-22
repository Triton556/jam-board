import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { labels, type Member, type TaskDetail } from "../../lib/types";
import {
  equalValue,
  fieldNames,
  type TaskFields,
  taskSchema,
  taskValues,
} from "./task-form";

export type ComparedTask = {
  base: TaskDetail;
  remote: TaskDetail;
  yours: TaskFields;
};
const briefLabels = {
  goalMd: "Goal",
  contextMd: "Context",
  whereMd: "Where",
  changes: "Changes",
  tests: "Acceptance tests",
  boundariesMd: "Boundaries",
  resultMd: "Expected result",
  userQuotesMd: "Original notes",
};
const fieldLabels = {
  title: "Task title",
  descriptionMd: "Notes",
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignee",
  tags: "Tags",
  estimate: "Estimate",
  dueAt: "Due",
};
const changeLabels = {
  title: "Change",
  now: "Current behavior",
  cause: "Cause",
  required: "Required",
  where: "Location",
  follow: "Follow",
  keep: "Keep",
};
function valueText(field: string, value: unknown, members: Member[]): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (field === "assigneeId")
    return (
      members.find((member) => member.id === value)?.name ??
      "Member no longer available"
    );
  if (field === "status")
    return labels[value as keyof typeof labels] ?? String(value);
  if (field === "priority")
    return String(value).replace(/^./, (letter) => letter.toUpperCase());
  if (field === "dueAt") return new Date(String(value)).toLocaleString();
  if (field === "estimate") return `${value} points`;
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value);
}
function ComparedValue({
  field,
  value,
  members,
}: {
  field: string;
  value: unknown;
  members: Member[];
}) {
  if ((field === "changes" || field === "tests") && Array.isArray(value)) {
    if (!value.length) return <p className="muted">No entries</p>;
    return (
      <ol className="comparison-entries">
        {value.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: captured immutable list entries have no IDs; duplicates must remain visible.
          <li key={index}>
            <dl>
              {Object.entries(
                field === "changes"
                  ? changeLabels
                  : { setup: "Setup", expected: "Expected" },
              ).map(([key, label]) =>
                entry[key] ? (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{String(entry[key])}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </li>
        ))}
      </ol>
    );
  }
  return <p className="comparison-text">{valueText(field, value, members)}</p>;
}

/** Reconcile against exactly the server version inspected, never a live refetch. */
export function TaskConflictDialog({
  base,
  latest,
  yours,
  live,
  members,
  actor,
  pending,
  error,
  close,
  read,
  save,
  discard,
}: {
  base: TaskDetail;
  latest: TaskDetail;
  yours: TaskFields;
  live: TaskDetail;
  members: Member[];
  actor: string;
  pending: boolean;
  error: Error | null;
  close(): void;
  read(task: TaskDetail): void;
  save(snapshot: ComparedTask): void;
  discard(task: TaskDetail): void;
}) {
  const [snapshot, setSnapshot] = useState(() => ({
    base: structuredClone(base),
    remote: structuredClone(latest),
    yours: structuredClone(yours),
    actor,
  }));
  const [reread, setReread] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (reread) heading.current?.focus();
  }, [reread]);
  const changed =
    (error && "code" in error && error.code === "conflict") ||
    live.updatedAt !== snapshot.remote.updatedAt ||
    latest.updatedAt !== snapshot.remote.updatedAt;
  const refresh = useMutation({
    mutationFn: async () => {
      const next = await api.getTask(snapshot.remote.key);
      if (
        next.id !== snapshot.remote.id ||
        next.jamId !== snapshot.remote.jamId
      )
        throw new Error(
          "The project or task changed. This comparison was not retargeted.",
        );
      return next;
    },
    onSuccess: (next) => {
      setSnapshot((previous) => ({
        ...previous,
        remote: next,
        actor:
          members.find((member) => member.id === next.updatedBy)?.name ??
          "A teammate",
      }));
      setReread((value) => value + 1);
      read(next);
    },
  });
  const was = taskValues(snapshot.base),
    remote = taskValues(snapshot.remote);
  const ordinary = fieldNames
    .filter((field) => field !== "brief")
    .flatMap((field) =>
      !equalValue(was[field], remote[field]) ||
      !equalValue(was[field], snapshot.yours[field])
        ? [
            {
              key: field,
              label: fieldLabels[field],
              values: [was[field], remote[field], snapshot.yours[field]],
            },
          ]
        : [],
    );
  const brief = (
    Object.keys(briefLabels) as (keyof typeof briefLabels)[]
  ).flatMap((field) =>
    !equalValue(was.brief[field], remote.brief[field]) ||
    !equalValue(was.brief[field], snapshot.yours.brief[field])
      ? [
          {
            key: field,
            label: briefLabels[field],
            values: [
              was.brief[field],
              remote.brief[field],
              snapshot.yours.brief[field],
            ],
          },
        ]
      : [],
  );
  const replacedLists = (["changes", "tests"] as const)
    .filter(
      (field) => !equalValue(was.brief[field], snapshot.yours.brief[field]),
    )
    .map((field) => briefLabels[field]);
  const valid = taskSchema.safeParse(snapshot.yours).success;
  const blocked = pending || refresh.isPending || !!changed;
  return (
    <Dialog
      title="Review changes"
      className="task-conflict-dialog"
      busy={pending}
      onClose={close}
    >
      <p>
        {snapshot.actor} saved a newer version. Your draft is kept. Compare the
        saved snapshot with your edits before choosing.
      </p>
      {changed && (
        <div className="review-context-changed">
          <p role="alert">
            This task changed again. The comparison has not been replaced and
            your draft is kept. Read the latest saved version before deciding.
          </p>
          <Button
            disabled={pending || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Reading latest…" : "Read latest comparison"}
          </Button>
        </div>
      )}
      {reread > 0 && !changed && (
        <p role="status">
          Latest comparison loaded. Your draft is unchanged; inspect the
          differences before saving or discarding it.
        </p>
      )}
      <h3 ref={heading} tabIndex={-1}>
        Compared task · {snapshot.remote.key}
      </h3>
      <p className="small">
        Saving applies only the fields you edited to the inspected saved
        version. Unedited fields keep that version's values.
      </p>
      {replacedLists.length > 0 && (
        <p className="notice">
          Your {replacedLists.join(" and ")}{" "}
          {replacedLists.length === 1
            ? "list replaces the whole saved list"
            : "lists replace the whole saved lists"}
          . Entries are not merged individually. Check both versions before
          saving.
        </p>
      )}
      <div className="task-comparison">
        {[...ordinary, ...brief].map((field) => (
          <section
            className="task-comparison-field"
            key={field.key}
            aria-label={field.label}
          >
            <h4>{field.label}</h4>
            <div className="task-comparison-columns">
              {field.values.map((value, index) => (
                <div key={["base", "remote", "yours"][index]}>
                  <h5>
                    {
                      [
                        "Your starting version",
                        "Saved version inspected",
                        "Your edits",
                      ][index]
                    }
                  </h5>
                  <ComparedValue
                    field={field.key}
                    value={value}
                    members={members}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!valid && (
        <p role="alert">
          Some local fields are invalid. Choose Keep editing to correct them;
          your draft will remain intact.
        </p>
      )}
      {snapshot.remote.archivedAt && (
        <p role="alert">
          This task is now archived. Keep your draft or discard it; restore the
          task before saving edits.
        </p>
      )}
      {refresh.error && (
        <p role="alert">{refresh.error.message} Your draft is kept.</p>
      )}
      {error && (
        <p role="alert">
          {error.message} Your draft is kept;{" "}
          {changed
            ? "read the latest comparison before deciding again."
            : "retry or keep editing."}
        </p>
      )}
      <div className="dialog-actions">
        <Button disabled={pending} onClick={close}>
          Keep editing
        </Button>
        <Button disabled={blocked} onClick={() => discard(snapshot.remote)}>
          Discard my edits and use latest
        </Button>
        <Button
          variant="primary"
          disabled={blocked || !valid || !!snapshot.remote.archivedAt}
          onClick={() => save(snapshot)}
        >
          {pending ? "Saving my edits…" : "Save my edits against latest"}
        </Button>
      </div>
    </Dialog>
  );
}
