import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

vi.mock("./lib/api", async () => {
  localStorage.clear();
  const { MockBridge } = await import("./lib/mock-bridge");
  const api = new MockBridge();
  await api.loadDemoJam();
  return { api };
});
vi.mock("./lib/grain", () => ({ preparePaperGrain: () => Promise.resolve() }));
vi.mock("@tauri-apps/plugin-opener", () => import("./test/mock-opener"));

import { App, router } from "./app";
// This suite exercises save/focus recovery. Cold imports have their own gated suites.
import "./features/task/TaskDrawer";
import { api } from "./lib/api";

it("closing after a keyboard Status save focuses the same task's replacement Board card", async () => {
  const user = userEvent.setup();
  render(<App />);
  const original = await screen.findByRole("button", { name: /^Open JB-2:/ });
  original.focus();
  await user.keyboard("{Enter}");
  const status = await screen.findByRole("combobox", { name: "Status" });
  await user.click(status);
  await screen.findByRole("option", { name: "Backlog" });
  await user.keyboard("{Home}{Enter}");
  await user.click(screen.getByRole("button", { name: /^Save Ctrl/ }));
  await screen.findByText("All changes saved");
  expect((await api.getTask("JB-2")).status).toBe("backlog");
  await waitFor(() => expect(original.isConnected).toBe(false));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(router.state.location.search.task).toBeUndefined(),
  );
  const replacement = screen.getByRole("button", { name: /^Open JB-2:/ });
  expect(replacement).not.toBe(original);
  expect(replacement).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("textbox", { name: "Task title" }),
  ).toHaveValue((await api.getTask("JB-2")).title);
});

it("closing immediately after save uses a stable Board entry while its list read is pending", async () => {
  const user = userEvent.setup();
  render(<App />);
  await act(async () => router.navigate({ to: "/board", search: {} }));
  const original = await screen.findByRole("button", { name: /^Open JB-4:/ });
  await user.click(original);
  await screen.findByRole("combobox", { name: "Status" });
  const originalRead = api.listBoardTasks.bind(api);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.spyOn(api, "listBoardTasks").mockImplementation(async () => {
    await gate;
    return originalRead();
  });
  try {
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await screen.findByRole("option", { name: "Backlog" });
    await user.keyboard("{Home}{Enter}");
    await user.click(screen.getByRole("button", { name: /^Save Ctrl/ }));
    await screen.findByText("All changes saved");
    expect((await api.getTask("JB-4")).status).toBe("backlog");
    expect(read).toHaveBeenCalled();
    expect(original.isConnected).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(router.state.location.search.task).toBeUndefined(),
    );
    const board = screen.getByRole("region", { name: "Board columns" });
    expect(board).toHaveFocus();
    await act(async () => release());
    await waitFor(() => expect(original.isConnected).toBe(false));
    expect(board).toHaveFocus();
    expect(
      screen.getByRole("button", { name: /^Open JB-4:/ }),
    ).not.toHaveFocus();
  } finally {
    release();
    read.mockRestore();
  }
});
