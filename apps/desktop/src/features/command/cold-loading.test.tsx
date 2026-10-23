import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const gate = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
});
vi.mock("./CommandPalette", async (original) => {
  await gate.promise;
  return await original();
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { CommandCenter } from "./CommandCenter";

it("F11: cold loading acknowledges, Escape cancels even after repeated shortcut, reopening works", async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CommandCenter newTask={vi.fn()} toggleTheme={vi.fn()} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.keyboard("{Control>}k{/Control}");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Loading search");
  await user.keyboard("{Control>}k{/Control}{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => gate.resolve());
  expect(
    screen.queryByRole("combobox", { name: "Search commands" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Search and commands" }));
  expect(
    await screen.findByRole("combobox", { name: "Search commands" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("combobox", { name: "Search commands" }),
  ).toBeNull();
});
