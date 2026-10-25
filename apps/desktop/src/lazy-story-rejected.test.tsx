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
vi.mock("@tauri-apps/plugin-opener", () => import("./test/mock-opener"));
vi.mock("./features/plan/StoryDrawer", async (original) => {
  load.requested();
  await load.promise;
  return original();
});

import { App, router } from "./app";
import { useUiStore } from "./lib/ui-store";

it("story module rejected stays local and closable without stale reopening", async () => {
  const user = userEvent.setup();
  const reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<App />);
  await screen.findByRole("link", { name: /Switch project/ });
  await act(async () => {
    await router.navigate({
      to: "/plan/$epicKey",
      params: { epicKey: "JB-E1" },
      search: { story: "JB-S1", tab: "Stories" },
    });
  });
  await waitFor(() => expect(load.requested).toHaveBeenCalledOnce());
  const key = router.state.location.search.story as string;
  await act(async () =>
    load.reject(new Error("Fictional story import failure")),
  );
  const dialog = await screen.findByRole("dialog", { name: key });
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Could not load story editor",
  );
  expect(document.querySelector(".app-shell")).toBeVisible();
  const close = within(dialog).getByRole("button", { name: "Close story" });
  close.focus();
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(within(dialog).getByRole("button", { name: "Close story" })).toBe(
    close,
  );
  expect(close).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(router.state.location.search.story).toBeUndefined(),
  );
  expect(load.requested).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
});
