import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
it("H-S01 Brain dock stays first; external controls remain mounted inside one initially closed disclosure", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage initialSection="Agents" />
    </QueryClientProvider>,
  );
  const summary = screen.getByText("External agents (MCP)");
  const details = summary.closest("details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  const dock = await screen.findByRole("heading", { name: "Brain dock" });
  expect(
    dock.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Connect an agent that runs outside Jam Board, such as a terminal or IDE session.",
    ),
  ).toBeVisible();
  const manual = within(details).getByRole("heading", {
    name: "Manual connection and role setup",
    hidden: true,
  });
  expect(manual).not.toBeVisible();
  await waitFor(() =>
    expect(
      within(details).getByText("Connect an agent to this board"),
    ).toBeInTheDocument(),
  );
  for (const title of ["Your AI teammates", "Connect the board"])
    expect(
      within(details).getByRole("heading", { name: title, hidden: true }),
    ).toBeInTheDocument();
  expect(
    within(details).getByText("How the board and brain work together"),
  ).toBeInTheDocument();
  expect(
    within(details).getByText("Read-only connection check"),
  ).toBeInTheDocument();
  await userEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(true));
  expect(manual).toBeVisible();
  const nav = within(
    screen.getByRole("navigation", { name: "Settings sections" }),
  );
  await userEvent.click(nav.getByRole("button", { name: "Data" }));
  await userEvent.click(nav.getByRole("button", { name: "Agents" }));
  const restored = screen
    .getByText("External agents (MCP)")
    .closest("details") as HTMLDetailsElement;
  expect(restored.open).toBe(true);
  await userEvent.click(screen.getByText("External agents (MCP)"));
  await waitFor(() => expect(restored.open).toBe(false));
  await userEvent.click(nav.getByRole("button", { name: "Data" }));
  await userEvent.click(nav.getByRole("button", { name: "Agents" }));
  expect(
    screen.getByText("External agents (MCP)").closest("details"),
  ).not.toHaveAttribute("open");
});
