import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { Board } from "./Board";

vi.mock("../../components/ui/RoughLine", async () => {
  throw Error("Drawing chunk unavailable");
});
it("H-B01 Board columns and quick-create remain usable when decorative drawing cannot load", async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ quickColumn: null });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <Board open={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(
    container.querySelectorAll(".column-heading > .rough-line"),
  ).toHaveLength(5);
  await userEvent.click(
    screen.getByRole("button", { name: "Add task to Backlog" }),
  );
  const draft = screen.getByRole("textbox", { name: "New task in Backlog" });
  await userEvent.type(draft, "Still usable");
  expect(draft).toHaveValue("Still usable");
  error.mockRestore();
});
