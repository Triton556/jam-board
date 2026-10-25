import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Drawer, useDrawerRestore } from "../../components/ui";
import { mockApi } from "../../lib/mock-bridge";
import { TaskDrawer } from "./TaskDrawer";

const route = vi.hoisted(() => ({
  pathname: "/board",
  blocker: { status: "idle" },
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => route.pathname,
  useBlocker: () => route.blocker,
}));

const idle = new Map<number, IdleRequestCallback>();
function flushIdle() {
  act(() => {
    for (const [id, callback] of idle) {
      idle.delete(id);
      callback({ didTimeout: false, timeRemaining: () => 16 });
    }
  });
}
beforeEach(async () => {
  route.pathname = "/board";
  route.blocker.status = "idle";
  idle.clear();
  let nextIdle = 0;
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idle.set(++nextIdle, callback);
    return nextIdle;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => idle.delete(id));
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((node) => {
    const style = computed(node);
    return new Proxy(style, {
      get(target, property) {
        if (
          node.classList.contains("drawer") &&
          property === "animationDuration"
        )
          return "0.24s";
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function animationEnd(node: HTMLElement, name: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  fireEvent(node, event);
}

async function open(close = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const task = await mockApi.getTask("JB-12");
  client.setQueryData(["task", "JB-12"], task);
  const view = render(
    <QueryClientProvider client={client}>
      <TaskDrawer taskKey="JB-12" close={close} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    close,
    shell: screen.getByRole("dialog", { name: "JB-12" }),
    rerenderDrawer: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <TaskDrawer taskKey="JB-12" close={close} />
        </QueryClientProvider>,
      ),
  };
}

it("H-D01: cached task still opens a shell and skeleton before editor queries; entry keeps the same focus surface", async () => {
  const ready = vi.spyOn(mockApi, "checkReady");
  const { shell, client } = await open();
  expect(shell).toHaveClass("entering");
  expect(shell).toHaveFocus();
  expect(screen.getByLabelText("Loading task")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Task title" })).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Task title (loading)" }),
  ).toHaveValue((await mockApi.getTask("JB-12")).title);
  expect(ready).not.toHaveBeenCalled();
  animationEnd(shell, "drawer-in");
  await screen.findByRole("textbox", { name: "Task title" });
  expect(screen.getByRole("dialog", { name: "JB-12" })).toBe(shell);
  expect(shell).toHaveClass("open");
  expect(shell).toHaveFocus();
  expect(ready).toHaveBeenCalledTimes(1);
  await act(() => client.invalidateQueries({ queryKey: ["task", "JB-12"] }));
  expect(screen.getByRole("dialog", { name: "JB-12" })).toBe(shell);
  expect(shell).toHaveClass("open");
});

it("H-D01: Escape closes the task menu first, then retains the editor until exit completes", async () => {
  const { shell, close } = await open();
  animationEnd(shell, "drawer-in");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Task actions" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Task actions" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(shell).toHaveClass("open");
  await user.keyboard("{Escape}");
  expect(shell).toHaveClass("closing");
  expect(
    screen.getByRole("textbox", { name: "Task title" }),
  ).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  animationEnd(shell, "drawer-out");
  expect(shell).toHaveClass("closed");
  expect(shell.querySelector('[aria-label="Task title"]')).not.toBeNull();
  expect(close).not.toHaveBeenCalled();
  flushIdle();
  expect(close).toHaveBeenCalledTimes(1);
});

it("H-D01: close during entry never mounts the editor, and unmount restores trigger focus", async () => {
  const ready = vi.spyOn(mockApi, "checkReady");
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const { shell, close, unmount } = await open();
  await userEvent.click(screen.getByRole("button", { name: "Close task" }));
  expect(shell).toHaveClass("closing");
  animationEnd(shell, "drawer-out");
  expect(close).not.toHaveBeenCalled();
  flushIdle();
  expect(close).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it("H-D01: reduced motion completes entry and exit without waiting for animation events", async () => {
  const media = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    ...media(query),
    matches: query.includes("prefers-reduced-motion"),
  }));
  const { shell, close } = await open();
  await screen.findByRole("textbox", { name: "Task title" });
  expect(shell).toHaveClass("open");
  await userEvent.click(screen.getByRole("button", { name: "Close task" }));
  await waitFor(() => expect(shell).toHaveClass("closed"));
  flushIdle();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("H-D01: a superseded drawer cancels idle teardown rather than closing a new route", async () => {
  const { shell, close, unmount } = await open();
  await userEvent.click(screen.getByRole("button", { name: "Close task" }));
  animationEnd(shell, "drawer-out");
  expect(idle.size).toBe(1);
  unmount();
  expect(idle.size).toBe(0);
  flushIdle();
  expect(close).not.toHaveBeenCalled();
});

it("H-D01: a blocked idle close restores the same editor and retains its dirty draft", async () => {
  const { shell, rerenderDrawer } = await open();
  animationEnd(shell, "drawer-in");
  const title = await screen.findByRole("textbox", { name: "Task title" });
  fireEvent.change(title, { target: { value: "Retained unsaved title" } });
  await userEvent.click(screen.getByRole("button", { name: "Close task" }));
  animationEnd(shell, "drawer-out");
  flushIdle();
  expect(shell).toHaveClass("closed");
  route.blocker.status = "blocked";
  rerenderDrawer();
  await waitFor(() => expect(shell).toHaveClass("open"));
  expect(shell).toHaveClass("open");
  expect(screen.getByRole("textbox", { name: "Task title" })).toBe(title);
  expect(title).toHaveValue("Retained unsaved title");
});

it("H-D01: a completed exit stays hidden while its asynchronous owner finishes closing", async () => {
  const { shell, close } = await open();
  await userEvent.click(screen.getByRole("button", { name: "Close task" }));
  animationEnd(shell, "drawer-out");
  flushIdle();
  expect(close).toHaveBeenCalledOnce();
  expect(shell).toHaveClass("closed");
  expect(shell).toHaveAttribute("aria-hidden", "true");
});

it("H-D01: shell phase changes do not rerender heavy content before idle teardown", () => {
  const rendered = vi.fn();
  function Heavy() {
    useDrawerRestore();
    rendered();
    return <p>Heavy editor content</p>;
  }
  render(
    <Drawer title="JB-12" onClose={vi.fn()}>
      {() => <Heavy />}
    </Drawer>,
  );
  const shell = screen.getByRole("dialog");
  expect(rendered).toHaveBeenCalledOnce();
  animationEnd(shell, "drawer-in");
  fireEvent.click(screen.getByRole("button", { name: "Close task" }));
  animationEnd(shell, "drawer-out");
  flushIdle();
  expect(rendered).toHaveBeenCalledOnce();
});

it("H-D01/R20: References canvas stays clickable and focusable; Tab is free, outside click retains drawer, Escape still closes", async () => {
  route.pathname = "/references";
  const pointer = vi.fn(),
    select = vi.fn();
  render(
    <button type="button" onPointerDown={pointer} onClick={select}>
      Canvas item
    </button>,
  );
  const { shell, close } = await open();
  expect(shell).not.toHaveAttribute("aria-modal");
  expect(shell.parentElement).toHaveClass("non-modal");
  animationEnd(shell, "drawer-in");
  await screen.findByRole("textbox", { name: "Task title" });
  const canvas = screen.getByRole("button", { name: "Canvas item" });
  await userEvent.click(canvas);
  expect(pointer).toHaveBeenCalledOnce();
  expect(select).toHaveBeenCalledOnce();
  expect(canvas).toHaveFocus();
  expect(fireEvent.keyDown(canvas, { key: "Tab" })).toBe(true);
  fireEvent.click(shell.parentElement as HTMLElement);
  expect(close).not.toHaveBeenCalled();
  expect(shell).toHaveClass("open");
  canvas.addEventListener("keydown", (event) => event.preventDefault(), {
    once: true,
  });
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(shell).toHaveClass("open");
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(shell).toHaveClass("closing");
  animationEnd(shell, "drawer-out");
  flushIdle();
  expect(close).toHaveBeenCalledOnce();
});

it("H-D01: native title, description and comment edits never measure textarea layout on editor mount or input", async () => {
  vi.stubGlobal("CSS", { ...CSS, supports: () => true });
  const measured = vi.fn();
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === "TEXTAREA") measured();
      return 200;
    },
  );
  const { shell } = await open();
  animationEnd(shell, "drawer-in");
  const title = await screen.findByRole("textbox", { name: "Task title" });
  const description = screen.getByRole("textbox", {
    name: "Description",
  });
  const comment = screen.getByRole("textbox", { name: "Write a comment" });
  for (const field of [title, description, comment]) {
    expect(field).toHaveClass("autosize-textarea");
    fireEvent.change(field, { target: { value: "More\ncontent" } });
    fireEvent.input(field);
  }
  expect(measured).not.toHaveBeenCalled();
});

it("H-D01: Board still traps Tab and dismisses on its scrim", async () => {
  const { shell } = await open();
  expect(shell).toHaveAttribute("aria-modal", "true");
  const close = screen.getByRole("button", { name: "Close task" });
  close.focus();
  await userEvent.keyboard("{Tab}");
  expect(
    screen.getByRole("textbox", { name: "Task title (loading)" }),
  ).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  expect(close).toHaveFocus();
  fireEvent.click(shell.parentElement as HTMLElement);
  expect(shell).toHaveClass("closing");
});

it("H-D01/R20: canvas focus and idle-close retention never grant the hidden task Ctrl+S", async () => {
  route.pathname = "/references";
  render(<button type="button">Canvas</button>);
  const update = vi.spyOn(mockApi, "updateTask");
  const { shell } = await open();
  animationEnd(shell, "drawer-in");
  const title = await screen.findByRole("textbox", { name: "Task title" });
  fireEvent.change(title, { target: { value: "Unsubmitted drawer draft" } });
  const canvas = screen.getByRole("button", { name: "Canvas" });
  canvas.focus();
  expect(fireEvent.keyDown(canvas, { key: "s", ctrlKey: true })).toBe(true);
  expect(update).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Close task" }));
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(true);
  animationEnd(shell, "drawer-out");
  expect(shell).toHaveClass("closed");
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(true);
  expect(update).not.toHaveBeenCalled();
});
