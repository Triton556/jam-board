import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const load = vi.hoisted(() => {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_, no) => {
    reject = no;
  });
  return { promise, reject, requested: vi.fn() };
});
vi.mock("./lib/api", async () => {
  localStorage.clear();
  const { MockBridge } = await import("./lib/mock-bridge");
  return { api: new MockBridge() };
});
vi.mock("./lib/grain", () => ({ preparePaperGrain: () => Promise.resolve() }));
vi.mock("./features/onboarding/Welcome", async (original) => {
  load.requested();
  await load.promise;
  return original();
});

import { App, router } from "./app";
import { api } from "./lib/api";
import { useUiStore } from "./lib/ui-store";

it("a rejected Welcome chunk offers explicit app reload or Projects, never an automatic or cached fake retry", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {}),
    reload = vi.spyOn(window.location, "reload").mockImplementation(() => {}),
    create = vi.spyOn(api, "createJam"),
    demo = vi.spyOn(api, "loadDemoJam"),
    user = userEvent.setup();
  try {
    render(<App />);
    await waitFor(() => expect(load.requested).toHaveBeenCalledOnce());
    await act(async () =>
      load.reject(new Error("Fictional chunk load failed")),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Could not open project setup",
      }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Unsaved fields");
    expect(reload).not.toHaveBeenCalled();
    // The empty-project Shell also renders Welcome and updates its clock each second.
    await act(async () => {
      await router.navigate({ to: "/board" });
    });
    const reloadButton = screen.getByRole("button", { name: "Reload app" });
    reloadButton.focus();
    act(() => useUiStore.getState().tick(useUiStore.getState().now + 1000));
    expect(screen.getByRole("button", { name: "Reload app" })).toBe(
      reloadButton,
    );
    expect(reloadButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(reload).toHaveBeenCalledOnce();
    expect(load.requested).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("link", { name: "Open Projects" }));
    expect(
      await screen.findByRole("heading", { name: "Your projects" }),
    ).toBeVisible();
    await act(async () => {
      await router.navigate({ to: "/welcome" });
    });
    expect(
      await screen.findByRole("heading", {
        name: "Could not open project setup",
      }),
    ).toBeVisible();
    expect(load.requested).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(demo).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    reload.mockRestore();
  }
});
