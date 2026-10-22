import { beforeEach, expect, it } from "vitest";
import { mockApi } from "./mock-bridge";
import { hasRustText, mockReadiness, validateBrief } from "./mock-planning";

// Same Unicode White_Space set guarded against char::is_whitespace by Rust tests.
const whitespace = [
  9,
  10,
  11,
  12,
  13,
  32,
  0x85,
  0xa0,
  0x1680,
  ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
];
beforeEach(async () => {
  await mockApi.resetDemo();
});
it("mock brief emptiness follows every authoritative Rust whitespace scalar, not JS trim", () => {
  expect(whitespace).toHaveLength(25);
  const actual: number[] = [];
  for (let scalar = 0; scalar <= 0x10ffff; scalar += 1)
    if (!hasRustText(String.fromCodePoint(scalar))) actual.push(scalar);
  expect(actual).toEqual(whitespace);
  for (const value of [
    "",
    ...whitespace.map((v) => String.fromCodePoint(v)),
    String.fromCodePoint(...whitespace),
  ])
    expect(hasRustText(value)).toBe(false);
  for (const value of [
    "\uFEFF",
    "\u200B",
    "\u180E",
    "\0",
    "ж",
    "字",
    "\u0085字\u00a0",
  ])
    expect(hasRustText(value)).toBe(true);
});
it.each([
  "goalMd",
  "whereMd",
  "resultMd",
  "changeTitle",
  "changeRequired",
  "testSetup",
  "testExpected",
] as const)(
  "%s has the same whitespace/meaningful text semantics in mock readiness and brief validation",
  async (field) => {
    const task = await mockApi.getTask("JB-7");
    for (const value of [
      "",
      ...whitespace.map((v) => String.fromCodePoint(v)),
      "\uFEFF",
      "\0",
      "\u0085字\u00a0",
    ]) {
      const brief = structuredClone(task.brief);
      const change = brief.changes?.[0],
        test = brief.tests?.[0];
      if (!change || !test) throw Error("Missing complete fixture brief");
      brief.changes = [change];
      brief.tests = [test];
      if (field === "changeTitle") change.title = value;
      else if (field === "changeRequired") change.required = value;
      else if (field === "testSetup") test.setup = value;
      else if (field === "testExpected") test.expected = value;
      else brief[field] = value;
      const ready = mockReadiness({ ...task, brief });
      expect(ready.ready, `${field} ${JSON.stringify(value)}`).toBe(
        hasRustText(value),
      );
      if (
        ["changeTitle", "changeRequired", "testSetup", "testExpected"].includes(
          field,
        )
      ) {
        if (hasRustText(value))
          expect(() => validateBrief(brief)).not.toThrow();
        else expect(() => validateBrief(brief)).toThrow();
      }
    }
  },
);
it.each([
  ["\u0085", false],
  ["\uFEFF", true],
  ["\0", true],
] as const)(
  "mock table Ready partitions and checkReady agree for %s",
  async (value, ready) => {
    const task = await mockApi.getTask("JB-7");
    await mockApi.updateTask({
      key: task.key,
      expectedUpdatedAt: task.updatedAt,
      brief: { ...task.brief, goalMd: value },
    });
    expect((await mockApi.checkReady(task.key)).ready).toBe(ready);
    const matches = await mockApi.listTasks({ ready }),
      complement = await mockApi.listTasks({ ready: !ready });
    expect(matches.tasks.some((t) => t.key === task.key)).toBe(true);
    expect(complement.tasks.some((t) => t.key === task.key)).toBe(false);
  },
);
