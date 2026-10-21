import { z } from "zod";
import { normalizeBrief } from "../../lib/task-brief";
import type { TaskDetail, UpdateInput } from "../../lib/types";
export const briefSchema = z.object({
  goalMd: z.string(),
  contextMd: z.string(),
  whereMd: z.string(),
  boundariesMd: z.string(),
  resultMd: z.string(),
  userQuotesMd: z.string(),
  changes: z.array(
    z.object({
      title: z.string().trim().min(1),
      now: z.string(),
      cause: z.string(),
      required: z.string().trim().min(1),
      where: z.string(),
      follow: z.string(),
      keep: z.string(),
    }),
  ),
  tests: z.array(
    z.object({
      setup: z.string().trim().min(1),
      expected: z.string().trim().min(1),
    }),
  ),
});
export const taskSchema = z.object({
  brief: briefSchema,
  title: z
    .string()
    .trim()
    .min(1, "Use 1–140 characters")
    .max(140, "Use 1–140 characters"),
  descriptionMd: z.string(),
  status: z.enum(["backlog", "ready", "in_progress", "review", "done"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  assigneeId: z.string().nullable(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(24)),
  estimate: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(5),
      z.literal(8),
    ])
    .nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
});
export type TaskFields = z.infer<typeof taskSchema>;
export function equalValue(a: unknown, b: unknown) {
  const canonical = (v: unknown) =>
    JSON.stringify(v, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
    );
  return canonical(a) === canonical(b);
}
export const fieldNames = [
  "brief",
  "title",
  "descriptionMd",
  "status",
  "priority",
  "assigneeId",
  "tags",
  "estimate",
  "dueAt",
] as const;
export function taskValues(task: TaskDetail): TaskFields {
  return {
    brief: normalizeBrief(task.brief),
    title: task.title,
    descriptionMd: task.descriptionMd,
    status: task.status as TaskFields["status"],
    priority: task.priority as TaskFields["priority"],
    assigneeId: task.assigneeId,
    tags: task.tags,
    estimate: task.estimate as TaskFields["estimate"],
    dueAt: task.dueAt,
  };
}
export function taskPatch(
  base: TaskFields,
  values: TaskFields,
  latest?: TaskFields,
): Omit<UpdateInput, "key" | "expectedUpdatedAt"> {
  const brief = latest ? { ...latest.brief } : values.brief;
  if (latest)
    for (const key of Object.keys(
      values.brief,
    ) as (keyof TaskFields["brief"])[]) {
      if (!equalValue(base.brief[key], values.brief[key]))
        Object.assign(brief, { [key]: values.brief[key] });
    }
  return Object.fromEntries(
    fieldNames
      .filter((field) => !equalValue(base[field], values[field]))
      .map((field) => [field, field === "brief" ? brief : values[field]]),
  );
}
