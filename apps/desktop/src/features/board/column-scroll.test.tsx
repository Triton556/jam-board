import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import type { BoardTasks } from "../../lib/types";
import { statuses } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { Board } from "./Board";

beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ quickColumn: null, highlights: {} });
});
afterEach(() => vi.restoreAllMocks());

async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const result = render(
    <QueryClientProvider client={client}>
      <Board open={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /Open JB-2:/ });
  return { ...result, client };
}

it("H-B01: each column has its own card scroller with pinned heading, policy and Add draft", async () => {
  const { container } = await mount();
  expect(
    container.querySelector(".board-surface > .board-scroll > .board-columns"),
  ).toBeInTheDocument();
  for (const status of statuses) {
    const column = container.querySelector(`[data-column="${status}"]`);
    const scroller = column?.querySelector(":scope > .column-cards");
    expect(scroller).toBeInTheDocument();
    expect(
      column?.querySelector(":scope > .column-heading > h2"),
    ).toBeInTheDocument();
    expect(
      column?.querySelector(":scope > .column-policy"),
    ).toBeInTheDocument();
    expect(
      scroller?.querySelector(".column-heading, .column-policy, .column-add"),
    ).toBeNull();
    expect(scroller).not.toHaveAttribute("tabindex");
    expect(scroller?.querySelectorAll(".card-button").length).toBeGreaterThan(
      0,
    );
  }
  expect(
    screen.getByRole("button", { name: "Add draft" }).parentElement,
  ).toHaveAttribute("data-column", "backlog");
});

it("H-B02: opening QuickCreate reveals the whole editor at the bottom of Backlog", async () => {
  await mount();
  const reveal = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Add draft" }));
  const input = screen.getByRole("textbox", { name: "New task in Backlog" });
  expect(input).toHaveFocus();
  const form = input.closest(".quick-create");
  expect(form?.parentElement).toHaveClass("column-cards");
  expect(form).toBe(form?.parentElement?.lastElementChild);
  expect(reveal).toHaveBeenCalledWith({ block: "nearest" });
  expect(reveal.mock.contexts).toContain(form);
  await userEvent.setup().keyboard("{Escape}");
  expect(input).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add draft" })).toHaveFocus();
});

it("H-B01: a refreshed list retains the columns, scrollers and existing card nodes", async () => {
  const { container, client } = await mount();
  const columns = [...container.querySelectorAll(".board-column")];
  const scrollers = [...container.querySelectorAll(".column-cards")];
  const card = screen.getByRole("button", { name: /Open JB-2:/ });
  const board = client.getQueryData<BoardTasks>(["boardTasks"]);
  const backlog = scrollers[0],
    ready = columns[1],
    template = board?.backlog[0];
  if (!board || !backlog || !ready || !template)
    throw new Error("Missing fixture board");
  backlog.scrollTop = 450;
  await act(async () => {
    client.setQueryData(["boardTasks"], {
      ...board,
      backlog: [
        ...Array.from({ length: 5 }, (_, i) => ({
          ...template,
          key: `JB-insert-${i}`,
          id: `insert-${i}`,
        })),
        ...board.backlog,
      ],
    });
  });
  for (const [index, status] of statuses.entries()) {
    const column = columns[index];
    if (!column) throw new Error(`Missing ${status} column`);
    expect(container.querySelector(`[data-column="${status}"]`)).toBe(column);
    expect(column.querySelector(".column-cards")).toBe(scrollers[index]);
  }
  expect(
    within(ready as HTMLElement).getByRole("button", {
      name: /Open JB-2:/,
    }),
  ).toBe(card);
  // DOM identity is tested here; native anchoring geometry is covered in Playwright.
  expect(backlog.scrollTop).toBe(450);
});
