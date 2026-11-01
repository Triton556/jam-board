import { expect, it } from "vitest";
import { parsePlanMarkdown, planHasGeneratedRefs } from "./plan-markdown";

it("parses explicit refs, goal, outcome and indented task description", () => {
  const plan = parsePlanMarkdown(
    "# Game {#e}\nA goal\n## Route {#s}\nAn outcome\n- Build {#t}\n  A description",
  );
  expect(plan.epics[0]).toMatchObject({
    externalRef: "e",
    goalMd: "A goal",
    stories: [
      {
        externalRef: "s",
        outcomeMd: "An outcome",
        tasks: [{ externalRef: "t", description: "A description" }],
      },
    ],
  });
  expect(planHasGeneratedRefs(plan)).toBe(false);
});
it("preserves Cyrillic titles and generates title-path refs", () => {
  const p = parsePlanMarkdown(
    "# Маленькие камни\n## Первая сцена\n- Найти камень",
  );
  expect(p.epics[0]?.stories?.[0]?.tasks?.[0]?.externalRef).toBe(
    "маленькие-камни/первая-сцена/найти-камень",
  );
  expect(planHasGeneratedRefs(p)).toBe(true);
});
it("normalizes en dash punctuation only in slug refs", () => {
  const p = parsePlanMarkdown("# Night – Day\n## Sky\n- Look – up");
  expect(p.epics[0]?.title).toBe("Night – Day");
  expect(p.epics[0]?.stories?.[0]?.tasks?.[0]?.externalRef).toBe(
    "night-day/sky/look-up",
  );
});
it("keeps nested list items in the task description instead of creating tasks", () => {
  const tasks = parsePlanMarkdown(
    "# E\n## S\n- T\n  - Nested\n    - Deeper\n- U",
  ).epics[0]?.stories?.[0]?.tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks?.[0]?.description).toBe("- Nested\n  - Deeper");
});
it("reports duplicate explicit refs with both line numbers", () => {
  expect(() => parsePlanMarkdown("# E {#same}\n## S {#same}")).toThrow(
    "Line 2: Duplicate reference same (first used on line 1).",
  );
});
it("reports duplicate generated refs with both line numbers", () => {
  expect(() => parsePlanMarkdown("# E\n## S\n- T\n- T")).toThrow(
    "Line 4: Duplicate reference e/s/t (first used on line 3).",
  );
});
it("handles CRLF and a BOM", () => {
  expect(
    parsePlanMarkdown(
      "\uFEFF# E {#e}\r\nGoal\r\n## S {#s}\r\n- T {#t}\r\n  Body\r\n",
    ).epics[0]?.stories?.[0]?.tasks?.[0]?.description,
  ).toBe("Body");
});
it("allows empty sections and empty input", () => {
  expect(
    parsePlanMarkdown("# E {#e}\n## S {#s}").epics[0]?.stories?.[0]?.tasks,
  ).toEqual([]);
  expect(parsePlanMarkdown("  \n")).toEqual({ epics: [] });
});
it("rejects text before the first heading with a line number", () => {
  expect(() => parsePlanMarkdown("\nPreface\n# E")).toThrow(
    "Line 2: Text must follow the first epic heading.",
  );
});
it("rejects orphan stories and tasks", () => {
  expect(() => parsePlanMarkdown("## S")).toThrow("Line 1:");
  expect(() => parsePlanMarkdown("# E\n- T")).toThrow("Line 2:");
});
it("resets a task description when a new section starts", () => {
  const plan = parsePlanMarkdown("# A\n## B\n- C\n  Description\n# D\nGoal");
  expect(plan.epics[1]?.goalMd).toBe("Goal");
  expect(plan.epics[0]?.stories?.[0]?.tasks?.[0]?.description).toBe(
    "Description",
  );
});
