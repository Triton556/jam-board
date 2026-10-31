import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { validateTableSearch } from "../table/search";
import { TaskDrawer } from "./TaskDrawer";
import {
  isTaskPresentationChange,
  type TaskPresentation,
  taskPresentation,
  taskViewSearch,
} from "./task-view-route";

const route = vi.hoisted(() => ({
  pathname: "/board",
  guard: undefined as undefined | ((input: never) => boolean),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => route.pathname,
  useBlocker: (options: {
    withResolver?: boolean;
    shouldBlockFn: typeof route.guard;
  }) => {
    if (options.withResolver) route.guard = options.shouldBlockFn;
    return { status: "idle" };
  },
}));
beforeEach(async () => {
  route.pathname = "/board";
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ taskChanges: {}, toasts: [] });
});
afterEach(() => vi.restoreAllMocks());
async function fixture(presentation: TaskPresentation = "drawer") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const task = await mockApi.getTask("JB-7");
  client.setQueryData(["task", "JB-7"], task);
  const close = vi.fn();
  let change!: (mode: TaskPresentation) => void;
  function View() {
    const [mode, setMode] = useState(presentation);
    change = setMode;
    return (
      <TaskDrawer
        taskKey="JB-7"
        close={close}
        presentation={mode}
        onPresentationChange={setMode}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <View />
    </QueryClientProvider>,
  );
  const title = await screen.findByRole("textbox", { name: "Task title" });
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Write a comment" }),
    ).toBeEnabled(),
  );
  return {
    ...view,
    title,
    client,
    close,
    task,
    change: (mode: TaskPresentation) => act(() => change(mode)),
    user: userEvent.setup(),
    shell: screen.getByRole("dialog", { name: "JB-7" }),
  };
}
it("retains the actual editor, field and scroll-root identities, dirty drafts, focus and subscription on both switches", async () => {
  const subscription = vi.spyOn(mockApi, "onFileDrop");
  const { title, shell, user } = await fixture();
  const form = title.closest("form");
  const description = screen.getByRole("textbox", { name: "Description" });
  const comment = screen.getByRole("textbox", { name: "Write a comment" });
  fireEvent.change(title, { target: { value: "Unsaved modal title" } });
  fireEvent.change(description, { target: { value: "Unsaved description" } });
  fireEvent.change(comment, { target: { value: "Retained comment" } });
  title.focus();
  shell.scrollTop = 120;
  const count = subscription.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Open larger" }));
  expect(shell).toHaveAttribute("data-presentation", "modal");
  expect(screen.getByRole("textbox", { name: "Task title" })).toBe(title);
  expect(title.closest("form")).toBe(form);
  expect(title).toHaveFocus();
  expect(shell.scrollTop).toBe(120);
  await user.click(screen.getByRole("button", { name: "Use side panel" }));
  expect(screen.getByRole("dialog", { name: "JB-7" })).toBe(shell);
  expect(title).toHaveValue("Unsaved modal title");
  expect(description).toHaveValue("Unsaved description");
  expect(comment).toHaveValue("Retained comment");
  expect(subscription).toHaveBeenCalledTimes(count);
});
it("keeps brief editing and prevents pointer or keyboard presentation changes from blur-saving", async () => {
  const { user } = await fixture();
  const save = vi.spyOn(mockApi, "updateTask");
  await user.click(screen.getByText("Agent plan", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  const goal = screen.getByRole("textbox", { name: "Goal" });
  fireEvent.change(goal, { target: { value: "Unsaved goal" } });
  await user.click(screen.getByRole("button", { name: "Open larger" }));
  expect(goal).toHaveFocus();
  expect(goal).toHaveValue("Unsaved goal");
  const switcher = screen.getByRole("button", { name: "Use side panel" });
  act(() => switcher.focus());
  await user.keyboard("{Enter}");
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  expect(screen.getByRole("textbox", { name: "Goal" })).toHaveValue(
    "Unsaved goal",
  );
});
it("retains the pending mutation and typing during it; Ctrl+S saves in either presentation", async () => {
  const { title, user } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mockApi.updateTask.bind(mockApi);
  const update = vi
    .spyOn(mockApi, "updateTask")
    .mockImplementationOnce(async (input) => {
      await gate;
      return original(input);
    });
  fireEvent.change(title, { target: { value: "Submitted title" } });
  fireEvent.keyDown(title, { key: "s", ctrlKey: true });
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "Open larger" }));
  expect(title).toBeEnabled();
  fireEvent.change(title, { target: { value: "Typed while saving" } });
  fireEvent.keyDown(title, { key: "s", ctrlKey: true });
  expect(update).toHaveBeenCalledOnce();
  await act(async () => {
    release();
    await gate;
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Save Ctrl/ })).toBeEnabled(),
  );
  expect(title).toHaveValue("Typed while saving");
  expect((await mockApi.getTask("JB-7")).title).toBe("Submitted title");
  fireEvent.keyDown(title, { key: "s", ctrlKey: true });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByText("All changes saved", { exact: true }),
    ).toBeInTheDocument(),
  );
  expect((await mockApi.getTask("JB-7")).title).toBe("Typed while saving");
});
it("retains an open conflict comparison and dismisses only the inner dialog on Escape or task backdrop", async () => {
  const { title, client, task, change, user, shell, close } = await fixture();
  fireEvent.change(title, { target: { value: "My comparison draft" } });
  act(() =>
    client.setQueryData(["task", "JB-7"], {
      ...task,
      title: "Remote comparison",
      updatedAt: "2099-01-01T00:00:00Z",
    }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Review changes" }),
  );
  const comparison = screen.getByRole("dialog", { name: "Review changes" });
  change("modal");
  expect(screen.getByRole("dialog", { name: "Review changes" })).toBe(
    comparison,
  );
  expect(comparison).toHaveTextContent("Remote comparison");
  expect(comparison).toHaveTextContent("My comparison draft");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull();
  expect(shell).toHaveClass("open");
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(shell.parentElement as HTMLElement);
  expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull();
  expect(close).not.toHaveBeenCalled();
});
it("modal makes background inert, wraps Tab, restores the origin on final close, and References drawer stays non-modal", async () => {
  const origin = document.createElement("button");
  origin.textContent = "Origin row";
  document.body.append(origin);
  origin.focus();
  const { shell, user, unmount, change } = await fixture("modal");
  expect(origin.inert).toBe(true);
  const buttons = within(shell)
    .getAllByRole("button")
    .filter((button) => !button.hasAttribute("disabled"));
  const close = screen.getByRole("button", { name: "Close task" });
  close.focus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(document.activeElement).toBeInTheDocument();
  expect(shell.contains(document.activeElement)).toBe(true);
  expect(buttons.length).toBeGreaterThan(2);
  change("drawer");
  unmount();
  expect(origin.inert).toBeFalsy();
  expect(origin).toHaveFocus();
  origin.remove();
  route.pathname = "/references";
  const refs = await fixture();
  expect(refs.shell).not.toHaveAttribute("aria-modal");
  refs.change("modal");
  expect(refs.shell).toHaveAttribute("aria-modal", "true");
});
it("deep-link validation accepts modal and falls back to drawer for invalid values", () => {
  expect(taskPresentation("modal")).toBe("modal");
  for (const invalid of [undefined, null, "huge", "drawer", ["modal"]]) {
    expect(taskPresentation(invalid)).toBe("drawer");
    expect(taskViewSearch(invalid)).toBeUndefined();
  }
  expect(
    validateTableSearch({ task: "JB-7", taskView: "modal", q: "keep" }),
  ).toEqual({ task: "JB-7", taskView: "modal", q: "keep" });
  expect(validateTableSearch({ task: "JB-7", taskView: "invalid" })).toEqual({
    task: "JB-7",
  });
});
it("bypasses the dirty guard only for the same task presentation; leaving still blocks", async () => {
  const { title } = await fixture();
  fireEvent.change(title, { target: { value: "Dirty guard draft" } });
  const current = {
    pathname: "/board",
    search: { task: "JB-7", epics: "JB-E1" },
  };
  const next = { ...current, search: { ...current.search, taskView: "modal" } };
  expect(isTaskPresentationChange(current, next)).toBe(true);
  expect(route.guard?.({ current, next } as never)).toBe(false);
  for (const next of [
    { pathname: "/table", search: current.search },
    { ...current, search: { task: "JB-8" } },
    { ...current, search: {} },
    { ...current, search: { ...current.search, epics: "JB-E2" } },
  ]) {
    expect(route.guard?.({ current, next } as never)).toBe(true);
  }
});

it("Escape cancels a brief edit before dismissing the task, and a removed origin falls back to the route heading", async () => {
  const view = render(
    <main>
      <h1>Task table</h1>
      <button type="button">Removed row</button>
    </main>,
  );
  const origin = screen.getByRole("button", { name: "Removed row" });
  origin.focus();
  const { user, shell, close, unmount } = await fixture("modal");
  await user.click(screen.getByText("Agent plan", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "Goal" })).toBeNull();
  expect(shell).toHaveClass("open");
  expect(close).not.toHaveBeenCalled();
  view.rerender(
    <main>
      <h1>Task table</h1>
    </main>,
  );
  unmount();
  expect(screen.getByRole("heading", { name: "Task table" })).toHaveFocus();
});

it("the actual app routes retain modal deep links and fall back to drawer for invalid modes", async () => {
  const { router } = await import("../../app");
  for (const path of [
    "/board",
    "/table",
    "/plan",
    "/plan/JB-E1",
    "/assets",
    "/references",
    "/activity",
    "/inbox",
    "/team",
    "/settings",
  ]) {
    const modal = router
      .matchRoutes(path, {
        task: "JB-7",
        taskView: "modal",
        section: "MCP",
        q: "filter",
      })
      .at(-1);
    expect(modal?.search).toMatchObject({ task: "JB-7", taskView: "modal" });
    const invalid = router
      .matchRoutes(path, { task: "JB-7", taskView: "invalid" })
      .at(-1);
    expect(
      taskPresentation((invalid?.search as { taskView?: unknown })?.taskView),
    ).toBe("drawer");
  }
});
