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

it("a rejected task import after dismissal stays local and does not reopen or reload", async () => {
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

  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  expect(card).toHaveFocus();
  await act(async () =>
    load.reject(new Error("Fictional late task module failure")),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(card).toHaveFocus();
  expect(router.state.location.pathname).toBe("/board");
  expect(router.state.location.search.task).toBeUndefined();
  expect(reload).not.toHaveBeenCalled();
  await user.click(card);
  const failed = await screen.findByRole("dialog", { name: key });
  expect(within(failed).getByRole("alert")).toHaveTextContent(
    "Could not load task editor",
  );
  expect(load.requested).toHaveBeenCalledOnce();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  expect(card).toHaveFocus();
});
