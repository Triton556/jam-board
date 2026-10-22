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

it("Table rejected keeps visible recovery, stable focus and no stale navigation", async () => {
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
  await act(async () =>
    load.reject(new Error("Fictional Table import rejection")),
  );
  expect(
    await screen.findByRole("heading", { name: "Could not open Table" }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Unsaved drafts");
  expect(document.querySelector(".app-shell")).toBeVisible();
  expect(reload).not.toHaveBeenCalled();
  const reloadButton = screen.getByRole("button", { name: "Reload app" });
  reloadButton.focus();
  for (const duration of [1000, 1000, 5000])
    act(() => useUiStore.getState().tick(useUiStore.getState().now + duration));
  expect(screen.getByRole("button", { name: "Reload app" })).toBe(reloadButton);
  expect(reloadButton).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(reload).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("link", { name: "Back to Board" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/board"));
  await user.click(screen.getByRole("link", { name: "Table" }));
  expect(
    await screen.findByRole("heading", { name: "Could not open Table" }),
  ).toBeVisible();
  expect(load.requested).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});
