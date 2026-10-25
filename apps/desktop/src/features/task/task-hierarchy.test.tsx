import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { TaskDrawer } from "./TaskDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/board",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
it("H-D01/D08 title and breadcrumb precede compact permission; Refine stays in heading actions", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskDrawer taskKey="JB-12" close={vi.fn()} />
    </QueryClientProvider>,
  );
  const title = await screen.findByRole("textbox", { name: "Task title" });
  const permission = screen.getByRole("region", {
    name: "Task work permission",
  });
  expect(
    title.compareDocumentPosition(permission) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const breadcrumb = document.querySelector(".task-breadcrumb") as HTMLElement;
  expect(
    breadcrumb.compareDocumentPosition(title) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Refine with brain" })
      .closest(".task-heading-actions"),
  ).not.toBeNull();
  const detail = permission.querySelector("details") as HTMLDetailsElement;
  expect(screen.getAllByText("Why?")).toHaveLength(1);
  expect(detail.open).toBe(false);
  await userEvent.click(within(permission).getByText("Why?"));
  expect(detail.open).toBe(true);
  expect(detail.querySelectorAll("p")).toHaveLength(2);
  expect(detail).toHaveTextContent(
    "Returning it to Backlog does not stop a worker process.",
  );
  expect(
    within(permission).getByRole("button", { name: /Open JB-S/ }),
  ).toBeVisible();
});
