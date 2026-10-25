import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const load = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  let loaded!: () => void;
  const ready = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  return {
    promise,
    resolve,
    ready,
    loaded,
    requested: vi.fn(),
    actual: undefined as
      | typeof import("./features/task/TaskDrawer")
      | undefined,
  };
});
vi.mock("./lib/api", async () => {
  localStorage.clear();
  const { MockBridge } = await import("./lib/mock-bridge");
  const api = new MockBridge();
  await api.loadDemoJam();
  return { api };
});
vi.mock("./lib/grain", () => ({ preparePaperGrain: () => Promise.resolve() }));
vi.mock("@tauri-apps/plugin-opener", () => import("./test/mock-opener"));
vi.mock("./features/task/TaskDrawer", async () => {
  load.requested();
  await load.promise;
  if (!load.actual) throw new Error("Real task editor was not prepared");
  load.loaded();
  return load.actual;
});

import { App, router } from "./app";
import { api } from "./lib/api";
import { useUiStore } from "./lib/ui-store";

beforeAll(async () => {
  // Compile the real editor outside the interaction deadline. The lazy-facing
  // promise below still stays pending until this test explicitly releases it.
  load.actual = await vi.importActual("./features/task/TaskDrawer");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function state<T>(read: () => T): Promise<T> {
  return vi.waitFor(async () => {
    // Flush query notifications and zero-duration drawer animation fallbacks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return read();
  });
}

it("task module pending keeps a closable focused drawer and cannot reopen after dismissal", async () => {
  vi.useFakeTimers();
  const idle = new Map<number, IdleRequestCallback>();
  let nextIdle = 0;
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idle.set(++nextIdle, callback);
    return nextIdle;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => idle.delete(id));
  const reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<App />);
  const card = await state(
    () => screen.getAllByRole("button", { name: /^Open [A-Z]+-\d+:/ })[0],
  );
  if (!card) throw new Error("Fictional demo card missing");
  card.focus();
  fireEvent.click(card);
  await state(() => expect(load.requested).toHaveBeenCalledOnce());
  const key = router.state.location.search.task as string;
  const dialog = await state(() => screen.getByRole("dialog", { name: key }));
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "Loading task editor…",
  );
  expect(dialog).toHaveFocus();
  const preview = await state(() =>
    screen.getByRole("textbox", {
      name: "Task title (loading)",
    }),
  );
  expect(preview).toHaveAttribute("readonly");
  expect(preview).toHaveValue((await api.getTask(key)).title);
  fireEvent.keyDown(dialog, { key: "Tab" });
  const close = within(dialog).getByRole("button", { name: "Close task" });
  expect(close).toHaveFocus();
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(within(dialog).getByRole("button", { name: "Close task" })).toBe(
    close,
  );
  expect(close).toHaveFocus();
  async function dismiss(drawer: HTMLElement, action: () => void) {
    const queued = new Set(idle.keys());
    action();
    await state(() => expect(drawer).toHaveClass("closed"));
    const teardown = [...idle].filter(([id]) => !queued.has(id));
    expect(teardown).toHaveLength(1);
    // Run this drawer's idle removal, keeping unrelated app prefetch deferred.
    await act(async () => {
      for (const [id, callback] of teardown) {
        idle.delete(id);
        callback({ didTimeout: false, timeRemaining: () => 16 });
      }
      await vi.advanceTimersByTimeAsync(0);
    });
    await state(() =>
      expect(router.state.location.search.task).toBeUndefined(),
    );
    expect(drawer).not.toBeInTheDocument();
  }
  await dismiss(dialog, () => fireEvent.keyDown(close, { key: "Escape" }));
  expect(card).toHaveFocus();
  fireEvent.click(card);
  const reopened = await state(() => screen.getByRole("dialog", { name: key }));
  expect(within(reopened).getByRole("status")).toHaveTextContent(
    "Loading task editor…",
  );
  expect(load.requested).toHaveBeenCalledOnce();
  await dismiss(reopened, () =>
    fireEvent.click(screen.getByRole("button", { name: "Close task" })),
  );
  await act(async () => {
    load.resolve();
    await load.ready;
  });
  await state(() => expect(router.state.location.search.task).toBeUndefined());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(card);
  await state(() => screen.getByRole("combobox", { name: "Status" }));
  const title = screen.getByRole("textbox", { name: "Task title" });
  const originalTitle = (title as HTMLInputElement).value;
  title.focus();
  fireEvent.change(title, {
    target: { value: `${originalTitle} local draft` },
  });
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(title).toHaveValue(`${originalTitle} local draft`);
  expect(title).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Task title" })).toBe(title);
  expect(reload).not.toHaveBeenCalled();
});
