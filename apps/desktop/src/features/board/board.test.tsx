import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { mockApi } from "../../lib/mock-bridge";
import { useMoveTask } from "../../lib/queries";
import type {
  ActivityEvent,
  BoardTasks,
  Member,
  TaskSummary,
} from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { Welcome, welcomeSchema } from "../onboarding/Welcome";
import { Board } from "./Board";
import { TaskCard } from "./TaskCard";

function wrapper(
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  }),
) {
  return {
    client,
    Wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
let members: Member[];
let task: TaskSummary;
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  members = await mockApi.listMembers();
  const board = await mockApi.listBoardTasks();
  task = board.in_progress.find(
    (t) => t.assigneeId === members.find((m) => m.handle === "codex")?.id,
  ) as TaskSummary;
  mockApi.calls.length = 0;
  useUiStore.setState({
    highlights: {},
    agentPulse: {},
    toasts: [],
    quickColumn: null,
  });
});
describe("paper task card", () => {
  it("renders a flat card and an agent antenna", () => {
    render(<TaskCard task={task} members={members} />);
    expect(screen.getByText(task.key)).toBeVisible();
    expect(screen.getByTestId("task-card")).not.toHaveAttribute("data-tilt");
    expect(screen.getByTestId("agent-badge")).toBeVisible();
  });
  it.each(["low", "medium", "high", "critical"])(
    "shows the %s priority icon",
    (priority) => {
      render(<TaskCard task={{ ...task, priority }} members={members} />);
      expect(screen.getByLabelText(`${priority} priority`)).toBeVisible();
      expect(document.querySelector(".tape")).toBeNull();
    },
  );
});
describe("agent events", () => {
  function event(kind = "agent"): ActivityEvent {
    const actor = members.find((m) => m.kind === kind) as Member;
    return {
      seq: 99,
      action: "task.created",
      actor,
      taskKey: task.key,
      payload: { title: "Add jump buffer" },
      createdAt: new Date().toISOString(),
    };
  }
  it("highlights for four seconds and pulses for two", () => {
    vi.useFakeTimers();
    render(<TaskCard task={task} members={members} />);
    const timer = setInterval(
      () => useUiStore.getState().tick(Date.now()),
      100,
    );
    act(() => useUiStore.getState().receive([event()]));
    expect(screen.getByTestId("task-card")).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(Object.keys(useUiStore.getState().agentPulse)).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1900));
    expect(screen.getByTestId("task-card")).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByTestId("task-card")).toHaveAttribute(
      "data-highlighted",
      "false",
    );
    clearInterval(timer);
  });
  it("ignores human toasts and caps the agent stack at three", () => {
    useUiStore.getState().receive([event("human")]);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    useUiStore.getState().receive([event(), event(), event(), event()]);
    expect(useUiStore.getState().toasts).toHaveLength(3);
    expect(useUiStore.getState().toasts[0]?.text).toContain("Add jump buffer");
  });
  it("pauses toast expiry while hovered", () => {
    vi.useFakeTimers();
    useUiStore.getState().receive([event()]);
    const toast = useUiStore.getState().toasts[0];
    if (!toast) throw new Error("Missing toast");
    useUiStore.getState().pauseToast(toast.id, true);
    vi.advanceTimersByTime(6000);
    useUiStore.getState().tick(Date.now());
    expect(useUiStore.getState().toasts).toHaveLength(1);
    useUiStore.getState().pauseToast(toast.id, false);
    vi.advanceTimersByTime(5000);
    useUiStore.getState().tick(Date.now());
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
it("rolls back the optimistic move when move_task fails", async () => {
  const board = await api.listBoardTasks();
  const source = board.ready[0];
  if (!source) throw new Error("Missing task");
  const { client, Wrapper } = wrapper();
  client.setQueryData(["boardTasks"], board);
  function Move() {
    const move = useMoveTask();
    return (
      <button
        type="button"
        onClick={() =>
          move.mutate({
            key: source?.key ?? "",
            status: "review",
            expectedUpdatedAt: source?.updatedAt ?? "missing",
          })
        }
      >
        Move
      </button>
    );
  }
  render(<Move />, { wrapper: Wrapper });
  mockApi.failNext("move_task");
  mockApi.setLatency(100);
  fireEvent.click(screen.getByText("Move"));
  await waitFor(() =>
    expect(
      client
        .getQueryData<BoardTasks>(["boardTasks"])
        ?.review.some((t) => t.key === source.key),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      client
        .getQueryData<BoardTasks>(["boardTasks"])
        ?.ready.some((t) => t.key === source.key),
    ).toBe(true),
  );
  expect(useUiStore.getState().toasts[0]?.text).toBe(
    `Couldn't move ${source.key} — Simulated failure`,
  );
  mockApi.setLatency(0);
});
it("creates on Enter, keeps the editor, ignores blank titles and cancels on Escape", async () => {
  const user = userEvent.setup();
  const { Wrapper } = wrapper();
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  await screen.findByText("Player movement: coyote time & jump buffer");
  await user.click(screen.getByRole("button", { name: "Add task to Backlog" }));
  const input = screen.getByRole("textbox", { name: "New task in Backlog" });
  await user.keyboard("{Enter}");
  expect(mockApi.calls.filter((c) => c.command === "create_task")).toHaveLength(
    0,
  );
  await user.type(input, "Make a warm lantern");
  await user.keyboard("{Enter}");
  await screen.findByText("Make a warm lantern");
  expect(input).toHaveValue("");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("moves with Space, Right, Space and supplies destination neighbors", async () => {
  await mockApi.startAllDemoScopes();
  const user = userEvent.setup();
  const { Wrapper } = wrapper();
  const original = await api.listBoardTasks();
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  const button = await screen.findByRole("button", { name: /Open JB-7:/ });
  button.focus();
  await user.keyboard("[Space]");
  await user.keyboard("[ArrowRight]");
  await user.keyboard("[Space]");
  await waitFor(() =>
    expect(mockApi.calls.some((c) => c.command === "move_task")).toBe(true),
  );
  const call = mockApi.calls.find((c) => c.command === "move_task");
  expect(call?.input).toEqual({
    key: "JB-7",
    status: "in_progress",
    expectedUpdatedAt: original.ready.find((task) => task.key === "JB-7")
      ?.updatedAt,
    afterKey: original.in_progress.at(-1)?.key,
    beforeKey: undefined,
  });
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("region", { name: "In progress column" }),
      ).getByText("JB-7"),
    ).toBeVisible(),
  );
});
describe("onboarding validation", () => {
  const valid = {
    name: "Little Jam",
    theme: "",
    startsAt: "2026-10-19T10:00",
    endsAt: "2026-10-21T10:00",
    timezone: "UTC",
    yourName: "Danil",
  };
  it("accepts a valid jam and rejects blank/long names and reversed dates", () => {
    expect(welcomeSchema.safeParse(valid).success).toBe(true);
    for (const value of [
      { name: "" },
      { name: "x".repeat(61) },
      { yourName: " " },
      { yourName: "x".repeat(41) },
      { endsAt: valid.startsAt },
    ])
      expect(welcomeSchema.safeParse({ ...valid, ...value }).success).toBe(
        false,
      );
  });
  it("shows field errors without sending an invalid form to Rust", async () => {
    const { Wrapper } = wrapper();
    const router = createRouter({
      routeTree: createRootRoute({ component: Welcome }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Game jam" }));
    const submit = await screen.findByRole("button", {
      name: "Create jam",
    });
    fireEvent.click(submit);
    expect(await screen.findByText("Give your project a name")).toBeVisible();
    expect(screen.getByText("Tell us your name")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Jam name"), {
      target: { value: "A tiny jam" },
    });
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Danil" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "2020-01-01T10:00" },
    });
    fireEvent.click(submit);
    expect(
      await screen.findByText("End must be later than start"),
    ).toBeVisible();
    expect(mockApi.calls.some((call) => call.command === "create_jam")).toBe(
      false,
    );
  });
});

it("Enter opens a card without starting a drag or mutating its status", async () => {
  const open = vi.fn(),
    { Wrapper } = wrapper(),
    user = userEvent.setup();
  render(<Board open={open} />, { wrapper: Wrapper });
  const card = await screen.findByRole("button", { name: /Open JB-7:/ });
  card.focus();
  await user.keyboard("{Enter}");
  expect(open).toHaveBeenCalledExactlyOnceWith("JB-7");
  expect(card).not.toHaveAttribute("aria-pressed", "true");
  expect(mockApi.calls.some((call) => call.command === "move_task")).toBe(
    false,
  );
});
it("activation without implicit focus retains an explicit drawer return target", async () => {
  let openingFocus: Element | null = null;
  const { Wrapper } = wrapper();
  render(
    <Board
      open={() => {
        openingFocus = document.activeElement;
      }}
    />,
    { wrapper: Wrapper },
  );
  const card = await screen.findByRole("button", { name: /Open JB-7:/ });
  // Exercise activation without synthetic pointer focus (also relevant to accessibility APIs).
  fireEvent.click(card);
  expect(openingFocus).toBe(card);
});
it("an epic filter does not hide a project-wide Doing-limit warning", async () => {
  const { client, Wrapper } = wrapper(),
    source = await api.listBoardTasks();
  const base = source.in_progress[0];
  if (!base) throw new Error("Missing fixture");
  const board = {
    ...source,
    in_progress: Array.from({ length: 7 }, (_, i) => ({
      ...base,
      id: `capacity-${i}`,
      key: `CP-${i + 1}`,
      epicKey: i < 2 ? "CP-E1" : "CP-E2",
    })),
  };
  client.setQueryData(["boardTasks"], board);
  client.setQueryData(["settings"], {
    ...(await api.getSettings()),
    wipLimit: 6,
  });
  render(<Board open={() => {}} epicKeys={["CP-E1"]} />, { wrapper: Wrapper });
  const column = await screen.findByRole("region", {
    name: "In progress column",
  });
  expect(within(column).getAllByTestId("task-card")).toHaveLength(2);
  expect(
    within(column).getByText("7 / 6 Doing across board · 2 shown"),
  ).toHaveClass("over-wip");
});

it("quick capture is Backlog-only and cards show readable story context", async () => {
  const { Wrapper } = wrapper();
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  const card = await screen.findByRole("button", { name: /Open JB-7:/ });
  const detail = await mockApi.getTask("JB-7");
  await waitFor(() =>
    expect(card).toHaveAccessibleName(
      expect.stringContaining(detail.story.title),
    ),
  );
  expect(within(card).getByText(detail.story.title)).toHaveAttribute(
    "title",
    `${detail.story.key} · ${detail.story.title}`,
  );
  expect(screen.getAllByRole("button", { name: /^Add task to / })).toHaveLength(
    1,
  );
  expect(document.querySelectorAll(".column-policy")).toHaveLength(5);
  expect(
    screen.getByText("Brief ready · scope permission still required"),
  ).toBeVisible();
});
it("unfiltered quick capture names its default and does not promise later Story reassignment", async () => {
  const { Wrapper } = wrapper(),
    user = userEvent.setup();
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  await user.click(
    await screen.findByRole("button", { name: "Add task to Backlog" }),
  );
  expect(
    screen.getByText(
      "This draft goes to Unplanned work. Filter by Epic first to choose a Story.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "A task’s Story cannot be changed after creation. Refine its brief before Ready.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "Story for new draft" }),
  ).toBeNull();
  await user.type(
    screen.getByRole("textbox", { name: "New task in Backlog" }),
    "Rough capture in the default Story",
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByRole("button", {
    name: /Open .*Rough capture in the default Story/,
  });
  const saved = (await mockApi.listBoardTasks()).backlog.find(
    (task) => task.title === "Rough capture in the default Story",
  );
  expect(saved).toBeDefined();
  if (!saved) throw new Error("Missing created capture");
  const detail = await mockApi.getTask(saved.key);
  expect(detail.story.title).toBe("Unplanned work");
  expect(detail.status).toBe("backlog");
});
it("filtered quick capture requires a matching story and keeps its draft visible in that epic", async () => {
  const { Wrapper } = wrapper(),
    user = userEvent.setup();
  const story = (await mockApi.getTask("JB-7")).story;
  const { epic } = await mockApi.getTask("JB-7");
  render(<Board open={() => {}} epicKeys={[epic.key]} />, { wrapper: Wrapper });
  await user.click(
    await screen.findByRole("button", { name: "Add task to Backlog" }),
  );
  expect(screen.getByText("Choose the Story for this draft.")).toBeVisible();
  expect(
    screen.getByText(
      "A task’s Story cannot be changed after creation. Refine its brief before Ready.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/This draft goes to Unplanned work/)).toBeNull();
  const input = screen.getByRole("textbox", { name: "New task in Backlog" });
  await user.type(input, "A scoped draft");
  await user.keyboard("{Enter}");
  expect(
    mockApi.calls.filter((call) => call.command === "create_task"),
  ).toHaveLength(0);
  await user.click(
    screen.getByRole("combobox", { name: "Story for new draft" }),
  );
  await user.click(
    screen.getByRole("option", { name: `${story.key} · ${story.title}` }),
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(
    await screen.findByRole("button", { name: /Open .*A scoped draft/ }),
  ).toBeVisible();
  const saved = (await mockApi.listBoardTasks()).backlog.find(
    (task) => task.title === "A scoped draft",
  );
  expect(saved?.storyKey).toBe(story.key);
  expect(saved?.epicKey).toBe(epic.key);
});
it("changing an epic filter retains quick text but cannot reuse a story from another epic", async () => {
  const { Wrapper } = wrapper(),
    user = userEvent.setup();
  const { epic, story } = await mockApi.getTask("JB-7");
  const other = (await mockApi.listEpics()).find((item) => item.id !== epic.id);
  if (!other) throw new Error("Missing other epic");
  const view = render(<Board open={() => {}} epicKeys={[epic.key]} />, {
    wrapper: Wrapper,
  });
  await user.click(
    await screen.findByRole("button", { name: "Add task to Backlog" }),
  );
  const input = screen.getByRole("textbox", { name: "New task in Backlog" });
  await user.type(input, "Retain this thought");
  await user.click(
    screen.getByRole("combobox", { name: "Story for new draft" }),
  );
  await user.click(
    screen.getByRole("option", { name: `${story.key} · ${story.title}` }),
  );
  view.rerender(<Board open={() => {}} epicKeys={[other.key]} />);
  expect(input).toHaveValue("Retain this thought");
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  await user.click(
    screen.getByRole("combobox", { name: "Story for new draft" }),
  );
  expect(
    screen.queryByRole("option", { name: `${story.key} · ${story.title}` }),
  ).toBeNull();
  expect(
    mockApi.calls.filter((call) => call.command === "create_task"),
  ).toHaveLength(0);
});
it("quick-create failure keeps the title and an inline error for retry", async () => {
  const { Wrapper } = wrapper(),
    user = userEvent.setup();
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  await user.click(
    await screen.findByRole("button", { name: "Add task to Backlog" }),
  );
  const input = screen.getByRole("textbox", { name: "New task in Backlog" });
  await user.type(input, "Retain after error");
  mockApi.failNext("create_task");
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(input).toHaveValue("Retain after error");
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("button", { name: /Open .*Retain after error/ }),
  ).toBeVisible();
});

it("pending quick capture is single-submit, returns focus for the next draft and restores its trigger on close", async () => {
  const { Wrapper } = wrapper(),
    user = userEvent.setup();
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  const trigger = await screen.findByRole("button", {
    name: "Add task to Backlog",
  });
  await user.click(trigger);
  const input = screen.getByRole("textbox", { name: "New task in Backlog" });
  await user.type(input, "Only one draft");
  let resolve: (() => void) | undefined;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const original = mockApi.createTask.bind(mockApi);
  const spy = vi
    .spyOn(mockApi, "createTask")
    .mockImplementation(async (value) => {
      await gate;
      return original(value);
    });
  await user.dblClick(screen.getByRole("button", { name: "Add" }));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(input).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Cancel new task" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(input).toBeInTheDocument();
  await act(async () => resolve?.());
  await waitFor(() => expect(input).toHaveFocus());
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});

it("a keyboard drag keeps its starting version after a newer task arrives, refuses the stale drop and restores authoritative state", async () => {
  await mockApi.startAllDemoScopes();
  const user = userEvent.setup();
  const { Wrapper, client } = wrapper();
  const captured = await mockApi.getTask("JB-7");
  render(<Board open={() => {}} />, { wrapper: Wrapper });
  const button = await screen.findByRole("button", { name: /Open JB-7:/ });
  button.focus();
  await user.keyboard("[Space]");
  const newer = await mockApi.updateTask({
    key: captured.key,
    expectedUpdatedAt: captured.updatedAt,
    descriptionMd: "A newer brief must be inspected before moving.",
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["boardTasks"] });
  });
  expect(newer.updatedAt).not.toBe(captured.updatedAt);
  const beforeHistory = (await mockApi.getTask(captured.key)).history.length;
  await user.keyboard("[ArrowRight][Space]");
  await waitFor(() =>
    expect(mockApi.calls.some((call) => call.command === "move_task")).toBe(
      true,
    ),
  );
  expect(
    mockApi.calls.find((call) => call.command === "move_task")?.input,
  ).toMatchObject({
    key: captured.key,
    status: "in_progress",
    expectedUpdatedAt: captured.updatedAt,
  });
  await waitFor(() =>
    expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
      "Inspect the task before moving it again",
    ),
  );
  const saved = await mockApi.getTask(captured.key);
  expect(saved.status).toBe("ready");
  expect(saved.updatedAt).toBe(newer.updatedAt);
  expect(saved.history).toHaveLength(beforeHistory);
  await waitFor(() =>
    expect(
      client
        .getQueryData<BoardTasks>(["boardTasks"])
        ?.ready.find((task) => task.key === captured.key)?.updatedAt,
    ).toBe(newer.updatedAt),
  );
  expect(
    within(screen.getByRole("region", { name: "Ready column" })).getByText(
      captured.key,
    ),
  ).toBeVisible();
});
