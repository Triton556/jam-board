import { act, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("./features/table/TaskTable", async (original) => {
  load.requested();
  await load.promise;
  return original();
});

import { App, router } from "./app";
import { useUiStore } from "./lib/ui-store";

it("Table pending keeps visible recovery, stable focus and no stale navigation", async () => {
  const user = userEvent.setup();
  const reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<App />);
  await screen.findByRole("link", { name: /Switch project/ });
  await user.click(screen.getByRole("link", { name: "Table" }));
  await waitFor(() => expect(load.requested).toHaveBeenCalledOnce());
  expect(
    await screen.findByRole("status", { name: "Loading Table" }),
  ).toHaveTextContent("Loading Table…");
  const back = screen.getByRole("link", { name: "Back to Board" });
  back.focus();
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(screen.getByRole("link", { name: "Back to Board" })).toBe(back);
  expect(back).toHaveFocus();
  expect(document.querySelector(".app-shell")).toBeVisible();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/board"));
  await act(async () => load.resolve());
  expect(router.state.location.pathname).toBe("/board");
  await user.click(screen.getByRole("link", { name: "Table" }));
  expect(
    await screen.findByRole("heading", { name: "Task table" }),
  ).toBeVisible();
  expect(load.requested).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
});
