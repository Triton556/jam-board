import { z } from "zod";
import type { TaskQuery } from "../../lib/types";
import { statuses } from "../../lib/types";
export const sortFields = [
  "key",
  "title",
  "status",
  "priority",
  "assignee",
  "estimate",
  "updatedAt",
] as const;
export const tableSearchSchema = z.object({
  epic: z.string().max(100).catch("").optional(),
  story: z.string().max(100).catch("").optional(),
  ready: z.enum(["1", "0"]).optional().catch(undefined),
  changes: z.literal("1").optional().catch(undefined),
  info: z.literal("1").optional().catch(undefined),
  q: z.string().max(500).catch("").optional(),
  status: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .filter((v) => statuses.includes(v as (typeof statuses)[number]))
        .join(","),
    )
    .catch("")
    .optional(),
  assignee: z.string().max(100).catch("").optional(),
  tags: z
    .string()
    .transform((s) =>
      [
        ...new Set(
          s
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0 && t.length <= 24),
        ),
      ].join(","),
    )
    .catch("")
    .optional(),
  archived: z
    .union([z.literal("1"), z.undefined()])
    .catch(undefined)
    .optional(),
  sort: z
    .string()
    .refine(
      (s) =>
        s === "none" ||
        /^(key|title|status|priority|assignee|estimate|updatedAt):(asc|desc)$/.test(
          s,
        ),
    )
    .catch("updatedAt:desc")
    .optional(),
  task: z
    .string()
    .regex(/^[A-Za-z0-9]+-\d+$/)
    .catch("")
    .optional(),
});
export type TableSearch = z.infer<typeof tableSearchSchema>;
export function validateTableSearch(raw: Record<string, unknown>): TableSearch {
  const parsed = tableSearchSchema.parse(raw);
  return Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== undefined && v !== ""),
  ) as TableSearch;
}
export function tableQuery(search: TableSearch): TaskQuery {
  const [field, dir] = (search.sort ?? "updatedAt:desc").split(":");
  return {
    epic: search.epic || null,
    story: search.story || null,
    ready: search.ready === undefined ? null : search.ready === "1",
    changesRequested: search.changes ? true : null,
    needsInfo: search.info ? true : null,
    text: search.q || null,
    status: search.status?.split(",") ?? null,
    assignee: search.assignee || null,
    tags: search.tags?.split(",") ?? null,
    includeArchived: search.archived === "1",
    sort:
      field === "none"
        ? null
        : { field: field ?? "updatedAt", dir: dir ?? "desc" },
  };
}
export function nextSort(current: string | undefined, field: string) {
  return current === `${field}:asc`
    ? `${field}:desc`
    : current === `${field}:desc`
      ? "none"
      : `${field}:asc`;
}
export function serializeTableSearch(search: TableSearch) {
  return new URLSearchParams(
    Object.entries(validateTableSearch(search)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();
}
