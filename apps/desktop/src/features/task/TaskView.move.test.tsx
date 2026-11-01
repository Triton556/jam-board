import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { TaskView } from "./TaskView";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/board",
  useBlocker: () => ({ status: "idle" }),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
async function view(status: string) {
  const task = await mockApi.getTask("JB-2");
  task.status = status;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <TaskView task={task} close={vi.fn()} Files={() => null} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("TaskView header opens the story picker after closing its action menu", async () => {
  const user = await view("backlog");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(screen.getByRole("button", { name: "Move to story…" }));
  expect(
    await screen.findByRole("dialog", { name: "Move to story" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "Search stories" }),
  ).toBeInTheDocument();
});
it("TaskView header disables a working task's move and explains why", async () => {
  const user = await view("in_progress");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  expect(screen.getByRole("button", { name: "Move to story…" })).toBeDisabled();
  expect(
    screen.getByText("Only tasks in Backlog or Ready can move."),
  ).toBeInTheDocument();
});
