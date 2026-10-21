import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  WorkingLine,
  WorkingRing,
  workingUnderline,
} from "../components/ui/AgentWorking";
import { agentWorking } from "../lib/agent-working";
import { mockApi } from "../lib/mock-bridge";
import type { Member, TaskSummary } from "../lib/types";
import { useUiStore } from "../lib/ui-store";
import { TaskCard } from "./board/TaskCard";
import { TableRow } from "./table/TableRow";
import { WorkingLayer } from "./table/WorkingLayer";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (original) => ({
  ...(await original<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduced,
}));
const now = Date.parse("2026-10-20T12:00:00Z");
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
let member: Member, task: TaskSummary;
beforeEach(async () => {
  motion.reduced = false;
  await mockApi.loadDemoJam();
  member = (await mockApi.listMembers()).find(
    (m) => m.kind === "agent",
  ) as Member;
  task = Object.values(await mockApi.listBoardTasks()).flat()[0] as TaskSummary;
  task = { ...task, status: "in_progress", assigneeId: member.id };
  member = {
    ...member,
    name: "Worker",
    lastSeenAt: ago(0),
    statusAt: ago(0),
    statusText: "implementing snow tiles",
    statusScope: { type: "task", id: task.id },
  };
  useUiStore.setState({ now, highlights: {} });
});
it("uses scoped status text and fresh unscoped fallback", () => {
  expect(agentWorking(task, member, now)?.text).toBe(
    "Worker · implementing snow tiles",
  );
  expect(agentWorking(task, { ...member, statusScope: null }, now)?.text).toBe(
    "Worker is working…",
  );
  expect(
    agentWorking(task, { ...member, statusAt: ago(1200) }, now)?.mode,
  ).toBe("active");
});
it.each([
  ["backlog", 0, 0, "implementing snow tiles", "agent"],
  ["ready", 0, 0, "implementing snow tiles", "agent"],
  ["review", 0, 0, "implementing snow tiles", "agent"],
  ["done", 0, 0, "implementing snow tiles", "agent"],
  ["in_progress", 121, 0, "implementing snow tiles", "agent"],
  ["in_progress", 0, 0, "", "agent"],
  ["in_progress", 0, 0, "implementing snow tiles", "human"],
])(
  "hides presence for %s, seen %is, status %is, '%s', %s",
  (status, seen, at, text, kind) => {
    expect(
      agentWorking(
        { ...task, status },
        {
          ...member,
          kind,
          lastSeenAt: ago(seen),
          statusAt: ago(at),
          statusText: text,
        },
        now,
      ),
    ).toBeNull();
  },
);
it("checks exact online/fresh/stale boundaries and ignores a stale cached online flag", () => {
  expect(
    agentWorking(task, { ...member, lastSeenAt: ago(120) }, now)?.mode,
  ).toBe("active");
  expect(agentWorking(task, { ...member, lastSeenAt: null }, now)).toBeNull();
  expect(agentWorking(task, { ...member, statusAt: null }, now)).toBeNull();
  expect(
    agentWorking(
      task,
      { ...member, statusScope: null, statusAt: ago(600) },
      now,
    )?.mode,
  ).toBe("active");
  expect(
    agentWorking(
      task,
      { ...member, statusScope: null, statusAt: ago(601) },
      now,
    ),
  ).toBeNull();
  expect(
    agentWorking(task, { ...member, statusAt: ago(1800) }, now)?.mode,
  ).toBe("active");
  expect(
    agentWorking(task, { ...member, statusAt: ago(1801) }, now)?.mode,
  ).toBe("quiet");
});
it("stale matching scope is quiet and reports minutes rather than working", () => {
  const state = agentWorking(task, { ...member, statusAt: ago(2520) }, now);
  expect(state?.mode).toBe("quiet");
  expect(state?.text).toBe("Worker · last update 42 min ago");
  expect(state?.color).toBe("var(--ink-3)");
});
it("reduced motion leaves readable working text, a static ring/pencil and drawn underline", () => {
  motion.reduced = true;
  const state = agentWorking(task, member, now);
  const { container } = render(
    <>
      <WorkingRing state={state}>
        <span>W</span>
      </WorkingRing>
      <WorkingLine state={state} />
    </>,
  );
  expect(screen.getByText("Worker · implementing snow tiles")).toBeVisible();
  for (const element of container.querySelectorAll(".working-animated"))
    expect(element).toHaveStyle({ animation: "none" });
  expect(container.querySelector("path.working-animated")).toHaveStyle({
    strokeDashoffset: "0",
    opacity: "1",
  });
});
it("renders the fallback and does not change arrival highlight into a work glow", () => {
  render(<TaskCard task={task} members={[{ ...member, statusScope: null }]} />);
  expect(screen.getByText("Worker is working…")).toBeVisible();
  expect(screen.getByTestId("task-card")).toHaveAttribute(
    "data-highlighted",
    "false",
  );
  expect(document.querySelector(".typing-dots")).toBeNull();
});
it("caches the rough underline by rounded width", () => {
  expect(workingUnderline(200.1)).toBe(workingUnderline(200.2));
  expect(workingUnderline(200)).toContain("C");
  expect(workingUnderline(200)).not.toEqual(workingUnderline(260));
});
it("expires through the application clock without a new event or card timer", () => {
  render(<TaskCard task={task} members={[member]} />);
  expect(screen.getByTestId("working-line")).toBeVisible();
  act(() => useUiStore.getState().tick(now + 120001));
  expect(screen.queryByTestId("working-line")).toBeNull();
});
it("a memoized table row updates active, quiet and cleared states without a task edit", () => {
  const active = agentWorking(task, member, now);
  const quiet = agentWorking(task, { ...member, statusAt: ago(2520) }, now);
  const props = {
    task,
    assignee: member,
    initials: "W",
    highlightUntil: 0,
    selected: false,
    tabStop: true,
    timeLabel: "just now",
    exactTime: task.updatedAt,
  };
  const row = (working: typeof active) => (
    <table>
      <tbody>
        <TableRow {...props} working={working} />
      </tbody>
    </table>
  );
  const { container, rerender } = render(row(active));
  expect(container.querySelector("tr")).toHaveAttribute(
    "data-working",
    "active",
  );
  expect(container.querySelector(".working-pencil")).toHaveStyle({
    animation: "none",
    willChange: "auto",
  });
  rerender(row(quiet));
  expect(container.querySelector("tr")).toHaveAttribute(
    "data-working",
    "quiet",
  );
  expect(container.querySelector(".table-avatar")).toHaveAttribute(
    "title",
    expect.stringContaining("last update 42 min ago"),
  );
  rerender(row(null));
  expect(container.querySelector(".working-ring")).toBeNull();
});

it("paints fifty table rings from one CSS rotor without per-row animations", () => {
  const active = agentWorking(task, member, now);
  const quiet = agentWorking(task, { ...member, statusAt: ago(2520) }, now);
  const rows = Array.from({ length: 50 }, (_, index) => ({
    key: `JB-${index + 1}`,
    state: index === 49 ? quiet : active,
  }));
  const layer = () => (
    <table>
      <tbody>
        <WorkingLayer rows={rows} />
      </tbody>
    </table>
  );
  const { container, rerender } = render(layer());
  expect(container.querySelectorAll("svg")).toHaveLength(1);
  expect(container.querySelectorAll(".working-animated")).toHaveLength(1);
  expect(container.querySelectorAll("path")).toHaveLength(2);
  expect(
    [...container.querySelectorAll("path")].reduce(
      (count, path) =>
        count + (path.getAttribute("d")?.match(/M/g)?.length ?? 0),
      0,
    ),
  ).toBe(50);
  const firstSlot = container.querySelector('path[data-mode="active"]');
  rows.reverse();
  rerender(layer());
  expect(container.querySelector('path[data-mode="active"]')).toBe(firstSlot);
  expect(firstSlot).toHaveAttribute("data-working-count", "49");
  expect(container.querySelector("tr")).toHaveAttribute("inert");
  expect(
    container.querySelector('[data-working-keys~="JB-1"]'),
  ).toHaveAttribute("data-mode", "active");
  expect(
    container.querySelector('[data-working-keys~="JB-50"]'),
  ).toHaveAttribute("data-mode", "quiet");
  motion.reduced = true;
  rerender(layer());
  for (const ring of container.querySelectorAll("path"))
    expect(ring).toHaveStyle({ strokeDashoffset: "0" });
  expect(container.querySelector(".working-animated")).toHaveStyle({
    animation: "none",
  });
});
