import { z } from "zod";
import type { TaskDetail, UpdateInput } from "../../lib/types";
export const taskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Use 1–140 characters")
    .max(140, "Use 1–140 characters"),
  descriptionMd: z.string(),
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]),
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
export const fieldNames = [
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
): Omit<UpdateInput, "key" | "expectedUpdatedAt"> {
  return Object.fromEntries(
    fieldNames
      .filter(
        (field) =>
          JSON.stringify(base[field]) !== JSON.stringify(values[field]),
      )
      .map((field) => [field, values[field]]),
  );
}
