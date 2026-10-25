import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { LazyReadinessDialog } from "./LazyReadinessDialog";

const load = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve, requested: vi.fn() };
});
vi.mock("./Readiness", async (original) => {
  load.requested();
  await load.promise;
  return original();
});
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
it("H-BD04 lazy readiness can cancel before import, ignores late completion, and keeps post-save focus/announcement", async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ readyRequest: null, toasts: [] });
  const task = await mockApi.createTask({
    title: "Lazy readiness draft",
    status: "backlog",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const move = vi.spyOn(mockApi, "moveTask");
  render(
    <QueryClientProvider client={client}>
      <section
        className="drawer"
        role="dialog"
        aria-labelledby="lazy-task-title"
        tabIndex={-1}
      >
        <h2 id="lazy-task-title">{task.key}</h2>
        <button
          type="button"
          onClick={() =>
            useUiStore.setState({
              readyRequest: {
                key: task.key,
                status: "ready",
                expectedUpdatedAt: task.updatedAt,
              },
            })
          }
        >
          Mark ready
        </button>
      </section>
      <LazyReadinessDialog />
    </QueryClientProvider>,
  );
  expect(load.requested).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  expect(await screen.findByText("Checking the saved brief…")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(useUiStore.getState().readyRequest).toBeNull();
  await act(async () => load.resolve());
  expect(screen.queryByText("Checking the saved brief…")).toBeNull();
  expect(move).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  const override = await screen.findByRole("button", {
    name: "Mark ready anyway…",
  });
  await waitFor(() => expect(override).toBeEnabled());
  const dialog = screen.getByRole("dialog", {
    name: `Not ready · ${task.key}`,
  });
  await user.click(override);
  await user.type(
    within(dialog).getByRole("textbox", { name: "Override reason" }),
    "A bounded planning exception.",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Mark ready anyway" }),
  );
  await waitFor(() => expect(useUiStore.getState().readyRequest).toBeNull());
  await waitFor(() =>
    expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
      "no agent session was launched",
    ),
  );
  expect(screen.getByRole("dialog", { name: task.key })).toHaveFocus();
});
