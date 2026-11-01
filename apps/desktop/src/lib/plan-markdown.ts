import type {
  ImportEpic,
  ImportPlanInput,
  ImportStory,
  ImportTask,
} from "./import-plan-api";

export const missingPlanRefsWarning =
  "Add {#ref} ids to keep updates stable if titles change.";
export class PlanMarkdownError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(`Line ${line}: ${message}`);
  }
}
const generatedRefs = new WeakSet<ImportPlanInput>();
export const planHasGeneratedRefs = (plan: ImportPlanInput) =>
  generatedRefs.has(plan);
const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "untitled";

/** Parse the round-12 heading/list grammar without doing IO or mutating board state. */
export function parsePlanMarkdown(text: string): ImportPlanInput {
  const result: ImportPlanInput = { epics: [] };
  const refs = new Map<string, number>();
  let epic: ImportEpic | undefined;
  let story: ImportStory | undefined;
  let task: ImportTask | undefined;
  let epicSlug = "",
    storySlug = "";
  const name = (raw: string, path: string[], line: number) => {
    const match = raw.match(/\s*\{#([^{}\s]+)\}\s*$/u);
    const title = (match ? raw.slice(0, match.index) : raw).trim();
    if (!title) throw new PlanMarkdownError("A title is required.", line);
    const ref = match?.[1] ?? [...path, slug(title)].join("/");
    if (!match) generatedRefs.add(result);
    if (ref.length > 120)
      throw new PlanMarkdownError("Reference exceeds 120 characters.", line);
    const previous = refs.get(ref);
    if (previous)
      throw new PlanMarkdownError(
        `Duplicate reference ${ref} (first used on line ${previous}).`,
        line,
      );
    refs.set(ref, line);
    return { title, externalRef: ref };
  };
  const append = (old: string | null | undefined, line: string) =>
    old == null ? line : `${old}\n${line}`;
  for (const [index, line] of text
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .entries()) {
    const n = index + 1;
    if (line.startsWith("# ")) {
      epic = { ...name(line.slice(2), [], n), stories: [] };
      epicSlug = slug(epic.title);
      result.epics.push(epic);
      story = undefined;
      task = undefined;
    } else if (line.startsWith("## ")) {
      if (!epic)
        throw new PlanMarkdownError("A story must follow an epic heading.", n);
      story = { ...name(line.slice(3), [epicSlug], n), tasks: [] };
      storySlug = slug(story.title);
      epic.stories?.push(story);
      task = undefined;
    } else if (line.startsWith("- ")) {
      if (!story)
        throw new PlanMarkdownError("A task must follow a story heading.", n);
      task = name(line.slice(2), [epicSlug, storySlug], n);
      story.tasks?.push(task);
    } else if (/^\s+/u.test(line) && task) {
      task.description = append(
        task.description,
        line.replaceAll("\t", "    "),
      );
    } else if (!epic) {
      if (line.trim())
        throw new PlanMarkdownError(
          "Text must follow the first epic heading.",
          n,
        );
    } else {
      task = undefined;
      if (story) story.outcomeMd = append(story.outcomeMd, line);
      else epic.goalMd = append(epic.goalMd, line);
    }
  }
  for (const e of result.epics) {
    if (e.goalMd != null) e.goalMd = e.goalMd.trim();
    for (const s of e.stories ?? []) {
      if (s.outcomeMd != null) s.outcomeMd = s.outcomeMd.trim();
      for (const t of s.tasks ?? []) {
        if (t.description == null) continue;
        const lines = t.description.split("\n");
        const indentation = Math.min(
          ...lines
            .filter((line) => line.trim())
            .map((line) => line.match(/^ */u)?.[0].length ?? 0),
        );
        t.description = lines
          .map((line) => line.slice(indentation))
          .join("\n")
          .trim();
      }
    }
  }
  return result;
}
