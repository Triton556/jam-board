import { beforeEach, expect, it } from "vitest";
import {
  listMockInboxEvents,
  type MockInboxActivity,
  markMockInboxEventsSeen,
  resetMockInboxEvents,
} from "./mock-inbox-events";

const actor = {
  id: "other",
  name: "Codex",
  kind: "agent",
  handle: "codex",
  color: "#3fa37a",
};
function row(
  seq: number,
  action = "task.created",
  extra: Partial<MockInboxActivity> = {},
): MockInboxActivity {
  return {
    seq,
    action,
    actor,
    epicId: "e1",
    epicKey: "JB-E1",
    taskKey: `JB-${seq}`,
    createdAt: new Date(1800000000000 + seq * 60000).toISOString(),
    sentence: `Codex created JB-${seq}`,
    ...extra,
  };
}
beforeEach(() => resetMockInboxEvents());
it("groups 40 actual references and splits the 11-minute task gap", async () => {
  const page = await listMockInboxEvents({ limit: 200 });
  expect(
    page.events.filter((event) => event.action === "reference.added"),
  ).toMatchObject([{ count: 40, sentence: "Claude added 40 references" }]);
  expect(
    page.events
      .filter((event) => event.action === "task.created")
      .map((event) => event.count),
  ).toEqual([1, 2]);
});
it("hides own ordinary updates and noise, but includes own sent review", async () => {
  const page = await listMockInboxEvents({ limit: 200 });
  expect(
    page.events.some((event) =>
      ["task.updated", "question.asked"].includes(event.action),
    ),
  ).toBe(false);
  expect(
    page.events.filter((event) => event.actor.id === "inbox-human"),
  ).toMatchObject([
    {
      action: "reference.review_sent",
      sentence:
        "You sent the review of Moodboard — Sky: 12 keep, 8 not this, 3 reasons",
    },
  ]);
});
it("resolves reports by later review on the same task and requests by ID", async () => {
  resetMockInboxEvents([
    row(1, "report.submitted"),
    row(2, "report.submitted"),
    row(3, "review.recorded", { taskKey: "JB-1" }),
    row(4, "execution.requested", { requestId: "a" }),
    row(5, "execution.request_resolved", { requestId: "b" }),
  ]);
  let page = await listMockInboxEvents({ filter: "needs_action" });
  expect(page.openActions).toBe(2);
  expect(page.events.map((event) => [event.seq, event.resolved])).toEqual([
    [4, false],
    [2, false],
    [1, true],
  ]);
  resetMockInboxEvents([
    row(1, "execution.requested", { requestId: "a" }),
    row(2, "execution.request_resolved", { requestId: "a" }),
  ]);
  page = await listMockInboxEvents({ filter: "needs_action" });
  expect(page.openActions).toBe(0);
  expect(page.events[0]?.resolved).toBe(true);
});
it("a review before a report does not resolve it; needs-action rows never group", async () => {
  resetMockInboxEvents([
    row(1, "review.recorded", { taskKey: "JB-2" }),
    row(2, "report.submitted"),
    row(3, "report.submitted", { taskKey: "JB-2" }),
  ]);
  const page = await listMockInboxEvents({ filter: "needs_action" });
  expect(page.events).toHaveLength(2);
  expect(page.openActions).toBe(2);
});
it("splits groups by actor, action and epic, with a ten-minute inclusive boundary", async () => {
  resetMockInboxEvents([
    row(1),
    row(2, "task.created", {
      createdAt: new Date(1800000000000 + 11 * 60000).toISOString(),
    }),
    row(3, "task.created", { epicId: "e2" }),
    row(4, "task.created", { actor: { ...actor, id: "another" } }),
    row(5, "task.released"),
  ]);
  const page = await listMockInboxEvents({ limit: 200 });
  expect(page.events.map((event) => event.count)).toEqual([1, 1, 1, 2]);
});
it("caps unread at 99 and marks seen monotonically", async () => {
  resetMockInboxEvents(
    Array.from({ length: 120 }, (_, index) => row(index + 1)),
  );
  expect((await listMockInboxEvents()).unread).toBe(99);
  expect(await markMockInboxEventsSeen(115)).toBe(115);
  expect(await markMockInboxEventsSeen(3)).toBe(115);
  const page = await listMockInboxEvents();
  expect(page.unread).toBe(5);
  expect(page.events[0]?.unread).toBe(true);
  expect(page.seenSeq).toBe(115);
});
it("pages source events without skipping or duplicating even across group boundaries", async () => {
  const expected = await listMockInboxEvents({ limit: 200 });
  const sequences: number[] = [];
  let beforeSeq: number | undefined;
  do {
    const page = await listMockInboxEvents({ limit: 7, beforeSeq });
    for (const event of page.events)
      for (let seq = event.seq; seq >= event.firstSeq; seq--)
        sequences.push(seq);
    beforeSeq = page.nextBeforeSeq ?? undefined;
  } while (beforeSeq !== undefined);
  expect(new Set(sequences).size).toBe(sequences.length);
  expect(sequences.length).toBe(
    expected.events.reduce((sum, event) => sum + event.count, 0),
  );
});
it("filters rows but preserves project-wide counts and returns empty states", async () => {
  const all = await listMockInboxEvents();
  const needs = await listMockInboxEvents({ filter: "needs_action" });
  const updates = await listMockInboxEvents({ filter: "updates" });
  expect(needs.events.every((event) => event.group === "needs_action")).toBe(
    true,
  );
  expect(updates.events.every((event) => event.group === "updates")).toBe(true);
  expect(needs.unread).toBe(all.unread);
  expect(updates.openActions).toBe(all.openActions);
  resetMockInboxEvents([]);
  expect(await listMockInboxEvents()).toEqual({
    events: [],
    unread: 0,
    openActions: 0,
    seenSeq: 0,
    nextBeforeSeq: null,
  });
});
it("validates source limits and seen sequence", async () => {
  for (const limit of [0, 201, 1.5])
    await expect(listMockInboxEvents({ limit })).rejects.toThrow("limit");
  await expect(markMockInboxEventsSeen(-1)).rejects.toThrow("seq");
});
