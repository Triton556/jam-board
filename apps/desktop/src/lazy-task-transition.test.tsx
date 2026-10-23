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

it("resolving the visible pending task transfers modal focus then restores the real opener", async () => {
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
  const pending = await screen.findByRole("dialog", { name: key });
  expect(pending).toHaveFocus();

  await act(async () => load.resolve());
  await screen.findByRole("textbox", { name: "Task title" });
  const loaded = screen.getByRole("dialog", { name: key });
  expect(loaded).toContainElement(document.activeElement as HTMLElement);
  const close = within(loaded).getByRole("button", { name: "Close task" });
  close.focus();
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(close).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  expect(card).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});
