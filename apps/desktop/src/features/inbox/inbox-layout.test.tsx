import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { InboxPage } from "./InboxPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => ({}),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
it("H-I01/I02 section controls share the question column and retain refresh receipts", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <InboxPage />
    </QueryClientProvider>,
  );
  const section = screen.getByRole("region", { name: "Questions" });
  const refresh = await within(section).findByRole("button", {
    name: "Refresh",
  });
  const row = refresh.parentElement as HTMLElement;
  expect(within(row).getByRole("heading", { name: "Questions" })).toBeVisible();
  expect(within(row).getByRole("status")).toBeInTheDocument();
  expect(row.parentElement).toHaveClass("question-groups");
  expect(section.parentElement).toBe(
    screen.getByRole("region", { name: "Scope start requests" }).parentElement,
  );
  await userEvent.click(refresh);
  expect(await within(row).findByText(/Checked questions/)).toBeVisible();
  expect(
    screen
      .getByRole("radiogroup", { name: "Inbox status" })
      .closest(".inbox-scroll"),
  ).toBeNull();
});
