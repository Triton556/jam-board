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
vi.mock("./features/plan/StoryDrawer", async (original) => {
  load.requested();
  await load.promise;
  return original();
});

import { App, router } from "./app";
import { useUiStore } from "./lib/ui-store";

it("story module pending stays local and closable without stale reopening", async () => {
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
  const dialog = await screen.findByRole("dialog", { name: key });
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "Loading story editor…",
  );
  expect(dialog).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(router.state.location.search.story).toBeUndefined(),
  );
  await act(async () => load.resolve());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const card = await screen.findByRole("button", { name: /^JB-S1 / });
  await user.click(card);
  const title = await screen.findByRole("textbox", { name: "Story title" });
  const originalTitle = (title as HTMLInputElement).value;
  await user.type(title, " local draft");
  act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
  expect(title).toHaveValue(`${originalTitle} local draft`);
  expect(title).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Story title" })).toBe(title);
  expect(reload).not.toHaveBeenCalled();
});
