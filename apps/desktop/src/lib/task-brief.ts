import type { TaskBrief } from "../bindings";
export const emptyBrief = (): Required<TaskBrief> => ({
  goalMd: "",
  contextMd: "",
  whereMd: "",
  changes: [],
  tests: [],
  boundariesMd: "",
  resultMd: "",
  userQuotesMd: "",
});
export function normalizeBrief(brief: TaskBrief) {
  return {
    ...emptyBrief(),
    ...brief,
    changes: (brief.changes ?? []).map((c) => ({
      ...c,
      now: c.now ?? "",
      cause: c.cause ?? "",
      where: c.where ?? "",
      follow: c.follow ?? "",
      keep: c.keep ?? "",
    })),
  };
}
