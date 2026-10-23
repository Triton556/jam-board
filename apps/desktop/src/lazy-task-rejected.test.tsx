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

it("task module rejected keeps a closable focused drawer and cannot reopen after dismissal", async () => {
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
  await act(async () =>
    load.reject(new Error("Fictional TaskDrawer import rejection")),
  );
  const dialog = await screen.findByRole("dialog", { name: key });
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Could not load task editor",
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Unsaved drafts");
  expect(document.querySelector(".app-shell")).toBeVisible();
  const reloadButton = within(dialog).getByRole("button", {
    name: "Reload app",
  });
  reloadButton.focus();
  for (const duration of [1000, 1000, 5000])
    act(() => useUiStore.getState().tick(useUiStore.getState().now + duration));
  expect(within(dialog).getByRole("button", { name: "Reload app" })).toBe(
    reloadButton,
  );
  expect(reloadButton).toHaveFocus();
  expect(reload).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  expect(card).toHaveFocus();
  await user.click(card);
  const failed = await screen.findByRole("dialog", { name: key });
  await user.click(within(failed).getByRole("button", { name: "Reload app" }));
  expect(reload).toHaveBeenCalledOnce();
  expect(load.requested).toHaveBeenCalledOnce();
  await user.click(within(failed).getByRole("button", { name: "Close task" }));
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  expect(card).toHaveFocus();
});
