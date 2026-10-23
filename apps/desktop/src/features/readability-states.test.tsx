import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { useUiStore } from "../lib/ui-store";
import { ActivityPage } from "./activity/ActivityPage";
import { TaskTable } from "./table/TaskTable";
import { AgentStatus } from "./team/AgentStatus";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
const clients: QueryClient[] = [];
async function mount(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(["app"], await mockApi.appState());
  return {
    ...render(
      <QueryClientProvider client={client}>{child}</QueryClientProvider>,
    ),
    client,
  };
}
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  useUiStore.setState({ boardEvents: [] });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("H01 does not announce empty or caught-up while the first activity read is pending or failed", async () => {
  let reject!: (e: Error) => void;
  vi.spyOn(api, "listActivity").mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await mount(<ActivityPage openTask={vi.fn()} />);
  await screen.findByRole("status", { name: "Loading activity" });
  expect(screen.queryByText("You’re all caught up")).not.toBeInTheDocument();
  expect(screen.queryByText("End of loaded activity")).not.toBeInTheDocument();
  await act(async () => reject(new Error("Synthetic activity read failure")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Synthetic activity read failure",
  );
  expect(screen.queryByText("You’re all caught up")).not.toBeInTheDocument();
  expect(screen.queryByText("End of loaded activity")).not.toBeInTheDocument();
  expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  expect(
    screen.queryByText("The story of your jam starts here"),
  ).not.toBeInTheDocument();
});
it("H01 initial read retry visibly stays pending and only reports end after a successful read", async () => {
  let finish!: (events: Awaited<ReturnType<typeof api.listActivity>>) => void;
  const read = vi
    .spyOn(api, "listActivity")
    .mockRejectedValueOnce(new Error("Synthetic read failure"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await mount(<ActivityPage openTask={vi.fn()} />);
  await screen.findByRole("alert");
  const user = userEvent.setup();
  await user.dblClick(screen.getByRole("button", { name: "Try again" }));
  expect(read).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("status", { name: "Loading activity" }),
  ).toBeVisible();
  expect(screen.queryByText("End of loaded activity")).not.toBeInTheDocument();
  expect(screen.queryByText("You’re all caught up")).not.toBeInTheDocument();
  await act(async () => finish([]));
  expect(await screen.findByText("No activity yet")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("End of loaded activity")).toBeVisible();
});
it("H01 keeps earlier rows on page failure and retries exactly that cursor, without a caught-up message", async () => {
  const seed = (await mockApi.listActivity({ limit: 1 }))[0];
  if (!seed) throw new Error("Expected a seeded activity");
  const page = Array.from({ length: 30 }, (_, i) => ({
    ...seed,
    seq: 100 - i,
  }));
  const read = vi
    .spyOn(api, "listActivity")
    .mockResolvedValueOnce(page)
    .mockRejectedValueOnce(new Error("Synthetic older page failure"))
    .mockResolvedValueOnce([]);
  await mount(<ActivityPage openTask={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Load earlier events" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Synthetic older page failure",
  );
  expect(document.querySelectorAll(".activity-entry").length).toBe(30);
  expect(screen.queryByText("End of loaded activity")).not.toBeInTheDocument();
  expect(screen.queryByText("You’re all caught up")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read.mock.calls[1]?.[0]?.beforeSeq).toBe(71);
  expect(read.mock.calls[2]?.[0]?.beforeSeq).toBe(71);
  await screen.findByText("End of loaded activity");
});
it("M02 no activity message does not claim the agent is online or ready", async () => {
  const member = (await mockApi.listMembers()).find((m) => m.kind === "agent");
  if (!member) throw new Error("Expected seeded agent");
  await mount(
    <AgentStatus
      member={{
        ...member,
        statusText: undefined,
        statusAt: null,
        lastSeenAt: "2020-01-01T00:00:00Z",
      }}
    />,
  );
  await userEvent
    .setup()
    .hover(screen.getByRole("button", { name: `${member.name} status` }));
  expect(screen.getByText("No activity message reported")).toBeVisible();
  expect(
    screen.queryByText("Online and ready to help"),
  ).not.toBeInTheDocument();
});
it.each([false, true])(
  "T01 genuine empty vs filtered-empty text is distinct (filtered=%s)",
  async (filtered) => {
    vi.spyOn(api, "listTasks").mockResolvedValue({ tasks: [], total: 0 });
    await mount(
      <TaskTable
        search={filtered ? { q: "No matching title" } : {}}
        change={vi.fn()}
        open={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(
        filtered ? "No tasks match these filters" : "No tasks to show",
      ),
    ).toBeVisible();
    expect(
      screen.queryAllByRole("button", { name: "Clear filters" }).length > 0,
    ).toBe(filtered);
    expect(
      mockApi.calls.filter((c) =>
        ["create_task", "move_task", "set_execution"].includes(c.command),
      ),
    ).toHaveLength(0);
  },
);
