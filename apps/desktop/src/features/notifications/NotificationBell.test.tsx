import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import type { ActivityEvent } from "../../lib/types";
import { NotificationBell } from "./NotificationBell";
import { readBaseline } from "./read-state";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
let signal: (events: ActivityEvent[]) => void;
let projectId: string;
let rows: ActivityEvent[];
function event(seq: number): ActivityEvent {
  return {
    seq,
    action: "task.created",
    taskKey: "JB-1",
    payload: {},
    createdAt: "2026-10-22T08:00:00Z",
    actor: {
      id: "agent",
      kind: "agent",
      name: "Test agent",
      handle: "test",
      color: "blue",
    },
    sentence: `Update ${seq}`,
    epicId: null,
  };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate.mockReset();
  localStorage.clear();
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  projectId = (await mockApi.appState()).jam?.id ?? "missing";
  rows = [event(10)];
  vi.spyOn(mockApi, "listActivity").mockImplementation(async () => rows);
  vi.spyOn(mockApi, "onBoardChanged").mockImplementation((cb) => {
    signal = cb;
    return () => {};
  });
});
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const result = render(
    <QueryClientProvider client={client}>
      <NotificationBell
        projectId={projectId}
        projectName="Test project"
        memberId="human"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Project notifications" }),
  );
  await screen.findByText("Update 10");
  return { client, ...result };
}
it("NT01 opens keyboard dialog, reconstructs history, marks older updates too, leaves arrivals unread and reader stable", async () => {
  await mount();
  expect(readBaseline(projectId, "human")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(readBaseline(projectId, "human")).toBe(10);
  rows = [event(11), event(10)];
  act(() => signal([event(999)]));
  await screen.findByRole("button", { name: "Show 1 new notifications" });
  expect(screen.queryByText("Update 11")).toBeNull();
  expect(screen.queryByText("Update 999")).toBeNull();
  expect(readBaseline(projectId, "human")).toBe(10);
  fireEvent.click(
    screen.getByRole("button", { name: "Show 1 new notifications" }),
  );
  expect(screen.getByText("Update 11")).toBeInTheDocument();
  expect(screen.getByText("New", { selector: "span" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("NT01 local read metadata failures do not break history", async () => {
  await mount();
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: () => {
      throw new Error("blocked");
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(
    screen.getByText(/Read position could not be saved/),
  ).toBeInTheDocument();
  expect(screen.getByText("Update 10")).toBeInTheDocument();
});
it("NT01 missing task stays in history with explicit error and no navigation", async () => {
  await mount();
  vi.spyOn(mockApi, "getTask").mockRejectedValue({
    code: "not_found",
    message: "missing",
  });
  fireEvent.click(screen.getByRole("button", { name: "View: Update 10" }));
  await screen.findByText("This task is no longer available in this project.");
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("NT01 close while View resolves cancels late navigation", async () => {
  await mount();
  let resolve!: (value: Awaited<ReturnType<typeof mockApi.getTask>>) => void;
  const real = await mockApi.getTask("JB-1");
  vi.spyOn(mockApi, "getTask").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "View: Update 10" }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(
    screen.getByRole("button", { name: "Close Project notifications" }),
  );
  await act(async () => resolve(real));
  expect(navigate).not.toHaveBeenCalled();
});
it("NT01 actual cache selection A→B→A suppresses a late page even when ID matches again", async () => {
  const { client } = await mount();
  let resolve!: (value: ActivityEvent[]) => void;
  vi.spyOn(mockApi, "listActivity")
    .mockResolvedValue(rows)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(resolve).toBeDefined());
  const state = await mockApi.appState();
  act(() => {
    client.setQueryData(["app"], {
      ...state,
      jam: { ...state.jam, id: "other" },
    });
    client.setQueryData(["app"], state);
  });
  await act(async () => resolve([event(999)]));
  fireEvent.click(
    screen.getByRole("button", { name: "Project notifications" }),
  );
  await screen.findByText("Update 10");
  expect(screen.queryByText("Update 999")).toBeNull();
});
it("NT01 bulk read watermark covers older pages but not new arrivals withheld from the reader", async () => {
  rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
  const client = new QueryClient();
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <NotificationBell
        projectId={projectId}
        projectName="Test"
        memberId="human"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Project notifications" }),
  );
  await screen.findByText("Update 200");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Mark current updates as read" }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(readBaseline(projectId, "human")).toBe(200);
  rows = [event(100)];
  fireEvent.click(screen.getByRole("button", { name: "Load older updates" }));
  await screen.findByText("Update 100");
  expect(screen.queryByText("New", { selector: "span" })).toBeNull();
  rows = [event(201), event(200)];
  act(() => signal([]));
  await screen.findByRole("button", { name: "Show 1 new notifications" });
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(readBaseline(projectId, "human")).toBe(200);
});
