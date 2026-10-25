import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const prefetched = vi.hoisted(() => ({
  plan: vi.fn(),
  references: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock("../../lib/api", async () => {
  const { MockBridge } = await import("../../lib/mock-bridge");
  const api = new MockBridge();
  await api.loadDemoJam();
  return { api };
});
vi.mock("../../lib/grain", () => ({
  preparePaperGrain: () => Promise.resolve(),
}));
vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
vi.mock("../plan/PlanPage", () => {
  prefetched.plan();
  return { PlanPage: () => null };
});
vi.mock("../references/ReferencesPage", () => {
  prefetched.references();
  return { ReferencesPage: () => null };
});
vi.mock("../task/Readiness", () => {
  prefetched.readiness();
  return { ReadinessDialog: () => null };
});

import { App } from "../../app";

it("H-B01 Board controls and draft work before idle route/dialog prefetch; prefetch preserves the draft", async () => {
  const callbacks: IdleRequestCallback[] = [];
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  render(<App />);
  const add = await screen.findByRole("button", {
    name: "Add task to Backlog",
  });
  expect(prefetched.plan).not.toHaveBeenCalled();
  expect(prefetched.references).not.toHaveBeenCalled();
  expect(prefetched.readiness).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(add);
  const draft = screen.getByRole("textbox", { name: "New task in Backlog" });
  await user.type(draft, "Draft before idle");
  await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));
  await act(async () => {
    for (const callback of callbacks.splice(0))
      callback({ didTimeout: false, timeRemaining: () => 50 });
  });
  await waitFor(() => expect(prefetched.plan).toHaveBeenCalledOnce());
  await waitFor(() => expect(prefetched.references).toHaveBeenCalledOnce());
  await waitFor(() => expect(prefetched.readiness).toHaveBeenCalledOnce());
  expect(draft).toHaveValue("Draft before idle");
  expect(screen.queryByText("Loading Plan…")).toBeNull();
  vi.unstubAllGlobals();
});
