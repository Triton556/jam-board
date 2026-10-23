import { describe, expect, it } from "vitest";
import { cardPresence } from "./agent-working";
import type { Member, TaskSummary } from "./types";

const now = Date.parse("2026-10-22T08:00:00Z");
const stamp = new Date(now).toISOString();
const task = {
  id: "task-a",
  key: "JB-1",
  status: "in_progress",
  assigneeId: "worker",
} as TaskSummary;
const worker = {
  id: "worker",
  name: "Worker",
  kind: "agent",
  color: "red",
  lastSeenAt: stamp,
  statusAt: stamp,
  statusText: "Implementing",
  statusScope: { type: "task", id: task.id },
} as Member;

describe("H-B01 / AG10: truthful card presence", () => {
  it("retains scoped claimed worker activity", () => {
    expect(cardPresence(task, [worker], now)?.mode).toBe("active");
  });
  it("does not turn retained worker status into reviewer activity", () => {
    expect(
      cardPresence({ ...task, status: "review" }, [worker], now),
    ).toMatchObject({ mode: "quiet", text: "Awaiting review" });
  });
  it("labels another actor's scoped report without asserting review", () => {
    const brain = {
      ...worker,
      id: "brain",
      name: "Brain",
      statusText: "Reading tests",
    };
    expect(
      cardPresence({ ...task, status: "review" }, [worker, brain], now),
    ).toMatchObject({
      mode: "quiet",
      text: "Awaiting review · Brain last reported 0 min ago: Reading tests",
    });
  });
  it("keeps unassigned execution explicit even with a brain report", () => {
    expect(
      cardPresence({ ...task, assigneeId: null }, [worker], now),
    ).toMatchObject({
      mode: "quiet",
      text: "Execution unconfirmed · Worker last reported 0 min ago: Implementing",
    });
    expect(cardPresence({ ...task, assigneeId: null }, [], now)?.text).toBe(
      "Execution unconfirmed",
    );
  });
  it.each([
    { lastSeenAt: new Date(now - 121000).toISOString() },
    { statusText: "" },
    { lastSeenAt: null },
  ])(
    "does not leave expired or cleared worker activity silently empty: %o",
    (patch) => {
      expect(cardPresence(task, [{ ...worker, ...patch }], now)).toMatchObject({
        mode: "quiet",
        text: "Worker · task activity unconfirmed",
      });
    },
  );
  it.each(["ready", "backlog", "done"])(
    "never animates or implies execution for %s",
    (status) => {
      expect(cardPresence({ ...task, status }, [worker], now)).toBeNull();
    },
  );
  it("distinguishes human assignment and an unavailable retained holder", () => {
    expect(cardPresence(task, [{ ...worker, kind: "human" }], now)?.text).toBe(
      "Assigned to Worker",
    );
    expect(cardPresence(task, [], now)?.text).toBe(
      "Assigned member unavailable · execution unconfirmed",
    );
  });
  it("rejects unrelated, stale and future generic reports", () => {
    const review = { ...task, status: "review" };
    for (const patch of [
      { statusScope: { type: "task", id: "other" } },
      { statusAt: new Date(now - 1800001).toISOString() },
      { statusAt: new Date(now + 1).toISOString() },
      { lastSeenAt: new Date(now - 120001).toISOString() },
    ])
      expect(
        cardPresence(review, [{ ...worker, id: "brain", ...patch }], now)?.text,
      ).toBe("Awaiting review");
  });
});
