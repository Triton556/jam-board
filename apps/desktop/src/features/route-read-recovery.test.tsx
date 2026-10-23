import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { useUiStore } from "../lib/ui-store";
import { Board } from "./board/Board";
import { PlanPage } from "./plan/PlanPage";
import { TaskTable } from "./table/TaskTable";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/plan/JB-E1",
  useBlocker: () => ({}),
}));
async function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  return {
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
    client,
  };
}
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  useUiStore.setState({ quickColumn: null });
  mockApi.calls.length = 0;
});
afterEach(() => vi.restoreAllMocks());
it.each([
  ["boardTasks", "listBoardTasks"],
  ["members", "listMembers"],
] as const)(
  "Board cached %s refetch failure preserves quick capture and retries reads only",
  async (key, method) => {
    const u = userEvent.setup(),
      { client } = await mount(<Board open={() => {}} />);
    await u.click(
      await screen.findByRole("button", { name: "Add task to Backlog" }),
    );
    const input = screen.getByRole("textbox", { name: "New task in Backlog" });
    await u.type(input, "Fictional unsaved board draft");
    const cached = client.getQueryData([key]);
    expect(cached).toBeDefined();
    vi.spyOn(api, method).mockRejectedValueOnce(
      new Error(`Fictional ${key} read failure`),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: [key] });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Fictional ${key} read failure`,
    );
    expect(client.getQueryData([key])).toEqual(cached);
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("textbox", { name: "New task in Backlog" }),
    ).toBe(input);
    expect(input).toHaveValue("Fictional unsaved board draft");
    expect(
      mockApi.calls.filter((c) => c.command === "create_task"),
    ).toHaveLength(0);
  },
);
it("Plan cached epics refetch failure preserves the open new epic draft", async () => {
  const u = userEvent.setup(),
    { client } = await mount(
      <PlanPage
        epicKey="JB-E1"
        search={{}}
        openTask={() => {}}
        openStory={() => {}}
      />,
    );
  await u.click(await screen.findByRole("button", { name: "New epic" }));
  const input = await screen.findByRole("textbox", { name: "Epic name" });
  await u.type(input, "Fictional unsaved epic draft");
  const cached = client.getQueryData(["epics"]);
  expect(cached).toBeDefined();
  vi.spyOn(api, "listEpics").mockRejectedValueOnce(
    new Error("Fictional epics read failure"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["epics"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Fictional epics read failure",
  );
  expect(client.getQueryData(["epics"])).toEqual(cached);
  expect(input).toBeInTheDocument();
  expect(input).toHaveFocus();
  // A modal still owns focus; model background read recovery rather than clicking behind it.
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["epics"] });
  });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(input).toHaveFocus();
  expect(await screen.findByRole("textbox", { name: "Epic name" })).toBe(input);
  expect(input).toHaveValue("Fictional unsaved epic draft");
  expect(mockApi.calls.filter((c) => c.command === "create_epic")).toHaveLength(
    0,
  );
});
it("Unchanged Table cached list refetch error preserves inline-create draft through Retry", async () => {
  const u = userEvent.setup(),
    { client } = await mount(
      <TaskTable search={{}} change={() => {}} open={() => {}} />,
    );
  await u.click(await screen.findByRole("button", { name: "+ New task" }));
  const input = await screen.findByRole("textbox", { name: "New task title" });
  await u.type(input, "Fictional unsaved table draft");
  await waitFor(() =>
    expect(
      client.getQueriesData({ queryKey: ["tableTasks"] })[0]?.[1],
    ).toBeDefined(),
  );
  vi.spyOn(api, "listTasks").mockRejectedValueOnce(
    new Error("Fictional table read failure"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["tableTasks"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Fictional table read failure",
  );
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue("Fictional unsaved table draft");
  await u.click(screen.getByRole("button", { name: "Retry task list" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(input).toHaveValue("Fictional unsaved table draft");
  expect(mockApi.calls.filter((c) => c.command === "create_task")).toHaveLength(
    0,
  );
});

it.each([
  ["boardTasks", "listBoardTasks"],
  ["members", "listMembers"],
] as const)(
  "Board initial %s failure blocks uncached content and retries only reads",
  async (key, method) => {
    const user = userEvent.setup();
    vi.spyOn(api, method).mockRejectedValueOnce(
      new Error(`Initial ${key} failed`),
    );
    await mount(<Board open={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Initial ${key} failed`,
    );
    expect(
      screen.queryByRole("button", { name: "Add task to Backlog" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Add task to Backlog" }),
    ).toBeEnabled();
    expect(
      mockApi.calls.filter((c) => c.command === "create_task"),
    ).toHaveLength(0);
  },
);
it("Plan initial epics failure stays blocking and read-retryable", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "listEpics").mockRejectedValueOnce(
    new Error("Initial epics failed"),
  );
  await mount(
    <PlanPage
      epicKey="JB-E1"
      search={{}}
      openTask={() => {}}
      openStory={() => {}}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Initial epics failed",
  );
  expect(screen.queryByRole("button", { name: "New epic" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "New epic" })).toBeEnabled();
  expect(mockApi.calls.filter((c) => c.command === "create_epic")).toHaveLength(
    0,
  );
});
