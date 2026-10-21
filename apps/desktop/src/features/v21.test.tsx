import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { MockBridge, mockApi } from "../lib/mock-bridge";
import { TaskCard } from "./board/TaskCard";
import { ReadOnlyBrief } from "./task/ReadOnlyBrief";

beforeEach(async () => {
  await mockApi.resetDemo();
});
it("new jams use epic colors and cards expose both workflow flags", async () => {
  expect((await mockApi.getSettings()).colorBy).toBe("epic");
  await mockApi.askUser({
    scope: { type: "task", id: "JB-7" },
    title: "Which cue?",
    bodyMd: null,
    options: null,
    recommendedIndex: null,
    allowFreeText: true,
    roundLabel: null,
  });
  const task = await mockApi.getTask("JB-7");
  render(
    <TaskCard
      task={task}
      members={await mockApi.listMembers()}
      colorBy="epic"
    />,
  );
  expect(screen.getByTestId("task-card")).toHaveAttribute(
    "data-color-by",
    "epic",
  );
  expect(screen.getByText("Changes requested")).toBeVisible();
  expect(screen.getByText("Needs info")).toBeVisible();
  expect(screen.getByTestId("task-card").getAttribute("style")).toContain(
    "--m1",
  );
});
it("incomplete human tasks stay in Backlog and Ready reports every missing item", async () => {
  const task = await mockApi.createTask({
    title: "Clarify the next lantern",
    status: "backlog",
  });
  await expect(
    mockApi.moveTask({ key: task.key, status: "ready" }),
  ).rejects.toMatchObject({
    code: "not_ready",
    message: expect.stringContaining("goal: Goal is empty"),
  });
  await expect(
    mockApi.moveTask({ key: task.key, status: "ready" }),
  ).rejects.toMatchObject({
    message: expect.stringContaining("story_active: The story is still draft"),
  });
  expect((await mockApi.getTask(task.key)).status).toBe("backlog");
  await mockApi.moveTask({
    key: task.key,
    status: "ready",
    overrideReason: "Explore the existing scene before writing the brief",
  });
  expect((await mockApi.getTask(task.key)).status).toBe("ready");
});
it("workers cannot claim Backlog or another worker's task", async () => {
  await expect(
    mockApi.simulateAgent({ action: "task.claimed", key: "JB-1" }),
  ).rejects.toMatchObject({ code: "not_ready" });
  await expect(
    mockApi.simulateAgent({
      action: "task.claimed",
      key: "JB-12",
      agent: "claude",
    }),
  ).rejects.toMatchObject({ code: "claim_conflict" });
});
it("the drawer exposes playbook headings, report evidence and reviewer feedback read-only", async () => {
  const task = await mockApi.getTask("JB-7");
  render(<ReadOnlyBrief task={task} members={await mockApi.listMembers()} />);
  for (const name of [
    "Goal",
    "Context",
    "Where",
    "Changes",
    "Tests",
    "Boundaries",
    "Result",
  ])
    expect(
      screen.getAllByRole("heading", { name: new RegExp(`^${name}$`) }).length,
    ).toBeGreaterThan(0);
  expect(
    screen.getByRole("region", { name: "Latest report" }),
  ).toHaveTextContent("FAIL");
  expect(
    screen.getByRole("region", { name: "Latest review" }),
  ).toHaveTextContent("Changes requested");
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("2000 complete mock briefs survive a reload within the browser storage quota", async () => {
  sessionStorage.removeItem("jam.mock");
  const api = new MockBridge(true);
  const now = new Date().toISOString();
  await api.createJam({
    name: "Large mock project",
    yourName: "Danil",
    startsAt: now,
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    timezone: "UTC",
    theme: null,
  });
  await api.seedBulk(2000);
  expect(sessionStorage.getItem("jam.mock")?.length).toBeLessThan(4_000_000);
  const reloaded = new MockBridge(true);
  expect(Object.values(await reloaded.listBoardTasks()).flat()).toHaveLength(
    2000,
  );
  expect((await reloaded.getTask("JB-2")).brief.goalMd).not.toBe("");
  sessionStorage.removeItem("jam.mock");
});
