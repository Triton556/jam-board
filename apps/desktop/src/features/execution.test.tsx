import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExecutionRequest, ExecutionScope } from "../lib/execution-api";
import { executionQuery } from "../lib/execution-queries";
import { MockBridge, mockApi } from "../lib/mock-bridge";
import { ExecutionControls } from "./execution/ExecutionControls";
import { ExecutionRequests } from "./execution/ExecutionRequests";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
const scopeOf = async (key = "JB-7"): Promise<ExecutionScope> => ({
  type: "story",
  id: (await mockApi.getTask(key)).story.id,
});
async function set(scope: ExecutionScope, action: "start" | "pause") {
  const state = await mockApi.getExecution(scope);
  return mockApi.setExecution({
    scope,
    action,
    expectedRevision: state.revision,
  });
}
function view(
  node: React.ReactNode,
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  }),
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
  };
}
async function request(scope: ExecutionScope): Promise<ExecutionRequest> {
  const task = await mockApi.getTask("JB-7");
  await mockApi.setBrain(task.epic.key, "codex");
  return (await mockApi.simulateAgent({
    action: "execution.requested",
    agent: "codex",
    scope,
    text: "Implement the reviewed story and publish test evidence.",
  })) as ExecutionRequest;
}

it("Ready alone cannot start work through claim, move, edit or direct working creation", async () => {
  const task = await mockApi.getTask("JB-7");
  expect(task.status).toBe("ready");
  await expect(
    mockApi.simulateAgent({ action: "task.claimed", key: task.key }),
  ).rejects.toMatchObject({ code: "execution_required" });
  await expect(
    mockApi.moveTask({
      key: task.key,
      status: "in_progress",
      expectedUpdatedAt: (await mockApi.getTask(task.key)).updatedAt,
    }),
  ).rejects.toMatchObject({ code: "execution_required" });
  await expect(
    mockApi.updateTask({
      key: task.key,
      expectedUpdatedAt: task.updatedAt,
      status: "in_progress",
    }),
  ).rejects.toMatchObject({ code: "execution_required" });
  const count = (await mockApi.listBoardTasks()).in_progress.length;
  await expect(
    mockApi.createTask({
      title: "Cannot bypass the gate",
      status: "in_progress",
      storyKey: task.story.key,
      brief: task.brief,
    }),
  ).rejects.toMatchObject({ code: "execution_required" });
  expect((await mockApi.listBoardTasks()).in_progress).toHaveLength(count);
  expect((await mockApi.getTask(task.key)).status).toBe("ready");
});

it("starting one story leaves sibling stories paused", async () => {
  const scope = await scopeOf();
  await set(scope, "start");
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("running");
  const sibling = (await mockApi.listStories()).find(
    (story) => story.id !== scope.id,
  );
  if (!sibling) throw new Error("Missing sibling");
  expect(
    (await mockApi.getExecution({ type: "story", id: sibling.id }))
      .effectiveState,
  ).toBe("paused");
  await expect(
    mockApi.simulateAgent({ action: "task.claimed", key: "JB-7" }),
  ).resolves.toMatchObject({ status: "in_progress" });
});

it("pause preserves assignments and permits in-flight evidence, but blocks restarting a reviewed round", async () => {
  const task = await mockApi.getTask("JB-12"),
    scope = await scopeOf(task.key);
  expect(task.status).toBe("in_progress");
  await set(scope, "start");
  await set(scope, "pause");
  expect(await mockApi.getTask(task.key)).toMatchObject({
    status: "in_progress",
    assigneeId: task.assigneeId,
  });
  await mockApi.simulateAgent({ action: "report.submitted", key: task.key });
  expect((await mockApi.getTask(task.key)).status).toBe("review");
  await expect(
    mockApi.moveTask({
      key: task.key,
      status: "in_progress",
      expectedUpdatedAt: (await mockApi.getTask(task.key)).updatedAt,
    }),
  ).rejects.toMatchObject({ code: "execution_required" });
  expect((await mockApi.getTask(task.key)).reports.length).toBeGreaterThan(0);
});

it("reassigning an in-progress task to a new holder requires a fresh scope grant", async () => {
  const task = await mockApi.getTask("JB-12");
  const next = (await mockApi.listMembers()).find(
    (member) => member.kind === "agent" && member.id !== task.assigneeId,
  );
  if (!next) throw new Error("Missing second worker");
  await expect(
    mockApi.updateTask({
      key: task.key,
      expectedUpdatedAt: task.updatedAt,
      assigneeId: next.id,
    }),
  ).rejects.toMatchObject({ code: "execution_required" });
  expect((await mockApi.getTask(task.key)).assigneeId).toBe(task.assigneeId);
});

it("story pause survives epic resume; epic pause clears separately started children", async () => {
  const task = await mockApi.getTask("JB-7"),
    story = await scopeOf();
  const epic: ExecutionScope = { type: "epic", id: task.epic.id };
  await set(epic, "start");
  expect((await mockApi.getExecution(story)).source).toBe("epic");
  await set(story, "pause");
  await set(epic, "pause");
  await set(epic, "start");
  expect((await mockApi.getExecution(story)).effectiveState).toBe("paused");
  await set(epic, "pause");
  await set(story, "start");
  expect(await mockApi.getExecution(epic)).toMatchObject({
    effectiveState: "paused",
    runningStoryCount: 1,
  });
  await set(epic, "pause");
  expect(await mockApi.getExecution(story)).toMatchObject({
    ownState: "inherit",
    effectiveState: "paused",
  });
});

it("closing and reopening a child under a running epic does not restore permission", async () => {
  const task = await mockApi.getTask("JB-7"),
    story = await scopeOf();
  await set({ type: "epic", id: task.epic.id }, "start");
  await mockApi.setStoryStatus(
    task.story.key,
    "done",
    "Close this fixture story",
  );
  await mockApi.setStoryStatus(task.story.key, "active");
  expect(await mockApi.getExecution(story)).toMatchObject({
    ownState: "paused",
    effectiveState: "paused",
  });
});

it("ordinary Inbox answers never grant execution even if the text asks to start", async () => {
  const scope = await scopeOf();
  const question = await mockApi.askUser({
    scope,
    title: "Start work?",
    bodyMd: "This is still just a question",
    options: [
      { label: "Start", description: "A generic answer" },
      { label: "Wait", description: "Keep planning" },
    ],
    recommendedIndex: null,
    allowFreeText: true,
    roundLabel: null,
  });
  await mockApi.answerQuestion({
    id: question.id,
    answerIndex: 0,
    answerText: "Yes, approved",
  });
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
});

it("brain requests are idempotent, require appointment and cannot approve themselves", async () => {
  const scope = await scopeOf();
  const first = await request(scope),
    second = await request(scope);
  expect(second.id).toBe(first.id);
  expect(first.status).toBe("pending");
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
  await expect(
    mockApi.simulateAgent({
      action: "execution.requested",
      agent: "unappointed-worker",
      scope,
      text: "Start",
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await mockApi.listExecutionRequests("pending")).toHaveLength(1);
});

it("later pause supersedes old approvals, including stale epic requests after a child changes", async () => {
  const task = await mockApi.getTask("JB-7"),
    scope = await scopeOf();
  const pending = await request(scope);
  await set(scope, "pause");
  await expect(
    mockApi.resolveExecutionRequest({
      id: pending.id,
      decision: "approve",
      expectedRevision: pending.revision,
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect((await mockApi.listExecutionRequests())[0]?.status).toBe("superseded");
  const epicRequest = await request({ type: "epic", id: task.epic.id });
  await set(scope, "start");
  await expect(
    mockApi.resolveExecutionRequest({
      id: epicRequest.id,
      decision: "approve",
      expectedRevision: epicRequest.revision,
    }),
  ).rejects.toMatchObject({ code: "conflict" });
});

it("start requests and grants remain pinned across project switching", async () => {
  const state = await mockApi.appState(),
    scope = await scopeOf(),
    pending = await request(scope);
  await mockApi.createJam({
    name: "Second",
    yourName: "Human",
    theme: null,
    template: "custom",
    startsAt: "",
    endsAt: "",
    timezone: "UTC",
    milestoneAt: null,
  });
  expect(await mockApi.listExecutionRequests()).toEqual([]);
  await expect(
    mockApi.resolveExecutionRequest({
      id: pending.id,
      decision: "approve",
      expectedRevision: pending.revision,
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    mockApi.setExecution({
      scope,
      action: "start",
      expectedRevision: pending.revision,
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  await mockApi.selectProject(state.jam?.id ?? "");
  expect((await mockApi.listExecutionRequests())[0]?.id).toBe(pending.id);
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
});

it("imported projects never inherit execution grants", async () => {
  const scope = await scopeOf();
  await set(scope, "start");
  const saved = await mockApi.exportJamJson();
  await mockApi.importJamJson(saved.path);
  expect(
    (await mockApi.listExecution()).every(
      (state) => state.effectiveState === "paused",
    ),
  ).toBe(true);
  expect(await mockApi.listExecutionRequests()).toEqual([]);
});

it("Start confirmation names exact saved scope and Cancel/Escape leave it paused", async () => {
  const scope = await scopeOf(),
    state = await mockApi.getExecution(scope),
    user = userEvent.setup();
  view(<ExecutionControls scope={scope} />);
  await user.click(await screen.findByRole("button", { name: "Start story" }));
  const dialog = screen.getByRole("dialog", {
    name: `Start ${state.scopeKey}?`,
  });
  expect(dialog).toHaveTextContent(state.scopeTitle);
  expect(dialog).toHaveTextContent("does not launch an agent session");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
  expect(
    mockApi.calls.filter((call) => call.command === "set_execution"),
  ).toHaveLength(0);
});

it("human confirmation starts only the named story and Pause remains non-destructive", async () => {
  const scope = await scopeOf(),
    state = await mockApi.getExecution(scope),
    user = userEvent.setup();
  view(<ExecutionControls scope={scope} />);
  await user.click(await screen.findByRole("button", { name: "Start story" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: `Start ${state.scopeKey}`,
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Pause new work" }),
  ).toBeEnabled();
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("running");
  await user.click(screen.getByRole("button", { name: "Pause new work" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start story" })).toBeEnabled(),
  );
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
});

it("a changed scope or switched project disables a stale Start confirmation", async () => {
  const scope = await scopeOf(),
    state = await mockApi.getExecution(scope),
    user = userEvent.setup();
  const { client } = view(<ExecutionControls scope={scope} />);
  await user.click(await screen.findByRole("button", { name: "Start story" }));
  await act(async () => {
    const updated = await set(scope, "pause");
    client.setQueryData(executionQuery(scope).queryKey, updated);
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: `Start ${state.scopeKey}`,
      }),
    ).toBeDisabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("state changed");
});

it("start failure retains confirmation and a usable retry without claiming success", async () => {
  const scope = await scopeOf(),
    state = await mockApi.getExecution(scope),
    user = userEvent.setup();
  view(<ExecutionControls scope={scope} />);
  await user.click(await screen.findByRole("button", { name: "Start story" }));
  mockApi.failNext("set_execution");
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: `Start ${state.scopeKey}`,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("Inbox requires a second exact-scope confirmation before granting a brain request", async () => {
  const scope = await scopeOf(),
    pending = await request(scope),
    user = userEvent.setup();
  view(<ExecutionRequests />);
  await user.click(await screen.findByRole("button", { name: "Review start" }));
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
  const dialog = screen.getByRole("dialog", {
    name: `Approve start of ${pending.scopeKey}?`,
  });
  await user.click(
    within(dialog).getByRole("button", {
      name: `Approve & start ${pending.scopeKey}`,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("running");
  expect((await mockApi.listExecutionRequests())[0]?.status).toBe("approved");
});

it("declining a start request leaves the scope paused and records the decision", async () => {
  const scope = await scopeOf();
  await request(scope);
  view(<ExecutionRequests />);
  const button = await screen.findByRole("button", { name: "Not now" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.setup().click(button);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull(),
  );
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
  expect((await mockApi.listExecutionRequests())[0]?.status).toBe("declined");
});

it("the partial epic state honestly shows separately running stories", async () => {
  const task = await mockApi.getTask("JB-7"),
    scope = await scopeOf();
  await set(scope, "start");
  view(<ExecutionControls scope={{ type: "epic", id: task.epic.id }} />);
  expect(
    await screen.findByText(/1 story is separately started/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Pause all new work" }),
  ).toBeEnabled();
});

it("historical in-flight demo work can report with no new grant", async () => {
  const bridge = new MockBridge();
  await bridge.loadDemoJam();
  expect(
    (await bridge.listExecution()).every(
      (state) => state.effectiveState === "paused",
    ),
  ).toBe(true);
  await expect(
    bridge.simulateAgent({ action: "report.submitted", key: "JB-12" }),
  ).resolves.toHaveProperty("summaryMd");
});

it("restoring an archived in-flight task only restores visibility, never permission", async () => {
  const task = await mockApi.getTask("JB-12"),
    scope = await scopeOf(task.key);
  await mockApi.archiveTask(task.key);
  expect((await mockApi.listProjects())[0]?.inProgressCount).toBeGreaterThan(0);
  const before = await mockApi.getTask(task.key);
  await mockApi.unarchiveTask(task.key);
  const after = await mockApi.getTask(task.key);
  expect(after).toMatchObject({
    status: before.status,
    assigneeId: before.assigneeId,
    reviewRound: before.reviewRound,
    archivedAt: null,
  });
  expect((await mockApi.getExecution(scope)).effectiveState).toBe("paused");
  const other = (await mockApi.listMembers()).find(
    (member) => member.kind === "agent" && member.id !== after.assigneeId,
  );
  if (!other) throw new Error("Missing other member");
  await expect(
    mockApi.updateTask({
      key: after.key,
      expectedUpdatedAt: after.updatedAt,
      assigneeId: other.id,
    }),
  ).rejects.toMatchObject({ code: "execution_required" });
});

it("archived active work still blocks project archive and appears in safety counts", async () => {
  const state = await mockApi.appState(),
    board = await mockApi.listBoardTasks();
  for (const task of board.in_progress) await mockApi.archiveTask(task.key);
  expect((await mockApi.listBoardTasks()).in_progress).toHaveLength(0);
  expect((await mockApi.listProjects())[0]?.inProgressCount).toBe(
    board.in_progress.length,
  );
  await expect(
    mockApi.resetJam({ confirmName: state.jam?.name ?? "" }),
  ).rejects.toThrow("still in progress");
  const task = await mockApi.getTask("JB-12");
  expect(
    (await mockApi.getExecution({ type: "story", id: task.story.id }))
      .inProgressCount,
  ).toBeGreaterThan(0);
  await expect(
    mockApi.simulateAgent({ action: "report.submitted", key: task.key }),
  ).resolves.toHaveProperty("summaryMd");
});

it("a changed project disables an already-open exact-scope confirmation", async () => {
  const scope = await scopeOf(),
    state = await mockApi.getExecution(scope),
    user = userEvent.setup();
  const { client } = view(<ExecutionControls scope={scope} />);
  await user.click(await screen.findByRole("button", { name: "Start story" }));
  await act(async () => {
    const second = await mockApi.createJam({
      name: "Other board",
      yourName: "Human",
      theme: null,
      template: "custom",
      startsAt: "",
      endsAt: "",
      timezone: "UTC",
      milestoneAt: null,
    });
    client.setQueryData(["app"], second);
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: `Start ${state.scopeKey}`,
      }),
    ).toBeDisabled(),
  );
  expect(
    mockApi.calls.filter((call) => call.command === "set_execution"),
  ).toHaveLength(0);
});

it("task permission guidance matches both workflow status and actual scope state", async () => {
  const { taskExecutionExplanation } = await import(
    "./execution/TaskExecutionNotice"
  );
  expect(taskExecutionExplanation("ready", true)).toMatch(
    /Ready for a connected worker/,
  );
  expect(taskExecutionExplanation("ready", true)).not.toMatch(
    /Start this story/,
  );
  expect(taskExecutionExplanation("ready", false)).toMatch(/Start this story/);
  expect(taskExecutionExplanation("backlog", true)).toMatch(/This is a draft/);
  expect(taskExecutionExplanation("review", false)).toMatch(
    /Review this task's result/,
  );
  expect(taskExecutionExplanation("done", false)).toMatch(/marked Done/);
  expect(taskExecutionExplanation("in_progress", false)).toMatch(/may report/);
});

it("Inbox decision leaves a stable live receipt and keyboard focus after its card disappears", async () => {
  const scope = await scopeOf(),
    pending = await request(scope);
  view(<ExecutionRequests />);
  const user = userEvent.setup(),
    button = await screen.findByRole("button", { name: "Not now" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull(),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    `${pending.scopeKey} was not started`,
  );
  expect(screen.getByRole("heading", { name: "Start requests" })).toHaveFocus();
});

it("direct Start and Pause return keyboard focus to the stable scope controls", async () => {
  const scope = await scopeOf(),
    state = await mockApi.getExecution(scope);
  view(<ExecutionControls scope={scope} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Start story" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: `Start ${state.scopeKey}`,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("region", { name: "Story execution" })).toHaveFocus();
  const pause = screen.getByRole("button", { name: "Pause new work" });
  await waitFor(() => expect(pause).toBeEnabled());
  await user.click(pause);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("paused for new work"),
  );
  expect(screen.getByRole("region", { name: "Story execution" })).toHaveFocus();
});

it("an imported closed story is explicitly paused when restored under a running epic", async () => {
  const original = await mockApi.getTask("JB-7");
  await mockApi.setStoryStatus(
    original.story.key,
    "done",
    "Import closed fixture",
  );
  const exported = await mockApi.exportJamJson();
  await mockApi.importJamJson(exported.path);
  const story = (await mockApi.listStories()).find(
    (item) => item.title === original.story.title,
  );
  if (!story) throw new Error("Missing imported story");
  await set({ type: "epic", id: story.epicId }, "start");
  await mockApi.setStoryStatus(story.key, "active");
  expect(
    await mockApi.getExecution({ type: "story", id: story.id }),
  ).toMatchObject({
    ownState: "paused",
    effectiveState: "paused",
  });
});

it("even the appointed brain cannot bypass independent review through direct Done mutations", async () => {
  const task = await mockApi.getTask("JB-7");
  await mockApi.setBrain(task.epic.key, "codex");
  await expect(
    mockApi.simulateAgent({
      action: "task.created",
      title: "Not independently reviewed",
      status: "done",
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    mockApi.simulateAgent({
      action: "task.moved",
      key: task.key,
      status: "done",
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    mockApi.simulateAgent({
      action: "task.updated",
      key: task.key,
      patch: { status: "done" },
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await mockApi.moveTask({
    key: task.key,
    status: "done",
    expectedUpdatedAt: (await mockApi.getTask(task.key)).updatedAt,
  });
  expect(await mockApi.getTask(task.key)).toMatchObject({
    status: "done",
    reviews: task.reviews,
  });
});
