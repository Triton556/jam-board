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
  await mockApi.loadDemoJam();
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
  const source = board.todo[0];
  if (!source) throw new Error("Missing task");
  const { client, Wrapper } = wrapper();
  client.setQueryData(["boardTasks"], board);
  function Move() {
    const move = useMoveTask();
    return (
      <button
        type="button"
        onClick={() =>
          move.mutate({ key: source?.key ?? "", status: "review" })
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
        ?.todo.some((t) => t.key === source.key),
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
  await user.click(screen.getByRole("button", { name: "Add task to To do" }));
  const input = screen.getByRole("textbox", { name: "New task in To do" });
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
    const submit = await screen.findByRole("button", {
      name: "Create jam",
    });
    fireEvent.click(submit);
    expect(await screen.findByText("Give your jam a name")).toBeVisible();
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
