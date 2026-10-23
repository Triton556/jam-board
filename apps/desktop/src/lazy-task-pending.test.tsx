import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const load = vi.hoisted(() => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject, requested: vi.fn() };
});
vi.mock("./lib/api", async () => {
  localStorage.clear();
  const { MockBridge } = await import("./lib/mock-bridge");
  const api = new MockBridge();
  await api.loadDemoJam();
  return { api };
});
vi.mock("./lib/grain", () => ({ preparePaperGrain: () => Promise.resolve() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.mock("./features/task/TaskDrawer", async (original) => {
  load.requested();
  await load.promise;
  return original();
});

import { App, router } from "./app";
import { useUiStore } from "./lib/ui-store";

it("task module pending keeps a closable focused drawer and cannot reopen after dismissal", async () => {
  const user = userEvent.setup();
  const reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<App />);
  await screen.findByRole("link", { name: /Switch project/ });
  const card = (
    await screen.findAllByRole("button", { name: /^Open [A-Z]+-\d+:/ })
  )[0];
  if (!card) throw new Error("Fictional demo card missing");
  await user.click(card);
  await waitFor(() => expect(load.requested).toHaveBeenCalledOnce());
  const key = router.state.location.search.task as string;
  const dialog = await screen.findByRole("dialog", { name: key });
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "Loading task editor…",
  );
  expect(dialog).toHaveFocus();
  await user.keyboard("{Tab}");
  const close = within(dialog).getByRole("button", { name: "Close task" });
  expect(close).toHaveFocus();
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(within(dialog).getByRole("button", { name: "Close task" })).toBe(
    close,
  );
  expect(close).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  expect(card).toHaveFocus();
  await user.click(card);
  await screen.findByRole("dialog", { name: key });
  await user.click(screen.getByRole("button", { name: "Close task" }));
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  await act(async () => load.resolve());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(card);
  const title = await screen.findByRole("textbox", { name: "Task title" });
  const originalTitle = (title as HTMLInputElement).value;
  await user.type(title, " local draft");
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(title).toHaveValue(`${originalTitle} local draft`);
  expect(title).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Task title" })).toBe(title);
  expect(reload).not.toHaveBeenCalled();
});
