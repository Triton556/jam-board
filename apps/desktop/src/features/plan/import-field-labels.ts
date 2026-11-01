import type {
  ImportEpic_Deserialize,
  ImportStory_Deserialize,
  ImportTask_Deserialize,
} from "../../bindings";

type ImportedField = Exclude<
  | keyof ImportEpic_Deserialize
  | keyof ImportStory_Deserialize
  | keyof ImportTask_Deserialize,
  "stories" | "tasks"
>;
export const importFieldLabels: Record<
  ImportedField | "parent" | "position",
  string
> = {
  title: "Title",
  externalRef: "External reference",
  color: "Color",
  goalMd: "Goal",
  doneWhenMd: "Done when",
  notIncludedMd: "Not included",
  decidedMd: "Decisions",
  openQuestionsMd: "Open questions",
  participation: "Participation",
  reviewer: "Reviewer",
  workerModel: "Worker model",
  outcomeMd: "Outcome",
  basisMd: "Basis",
  preserveMd: "Keep",
  scaleMd: "Scale of change",
  rejectionRisksMd: "Risks",
  openDecisionsMd: "Open decisions",
  acceptance: "Acceptance criteria",
  description: "Description",
  priority: "Priority",
  tags: "Tags",
  estimate: "Estimate",
  dueAt: "Due date",
  contextMd: "Context",
  whereMd: "Where",
  changes: "Changes",
  tests: "Tests",
  boundariesMd: "Boundaries",
  resultMd: "Result",
  userQuotesMd: "User quotes",
  parent: "Parent",
  position: "Order",
};
export function importFieldLabel(field: string): string {
  return Object.hasOwn(importFieldLabels, field)
    ? importFieldLabels[field as keyof typeof importFieldLabels]
    : field
        .replace(/Md$/u, "")
        .replace(/([a-z])([A-Z])/gu, "$1 $2")
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/^./u, (letter) => letter.toUpperCase());
}
