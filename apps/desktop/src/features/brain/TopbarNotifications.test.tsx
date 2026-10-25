import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const load = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
});
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
vi.mock("../notifications/NotificationBell", async (original) => {
  await load.promise;
  return original();
});

import { App } from "../../app";

it("H-BD04 top bar keeps a named bell while its lazy module loads, then opens existing project notifications", async () => {
  render(<App />);
  expect(
    await screen.findByRole("button", {
      name: "Loading project notifications…",
    }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Brain chat · Ctrl+J" }),
  ).toBeVisible();
  await act(async () => load.resolve());
  const bell = await screen.findByRole("button", {
    name: /^Project notifications/,
  });
  expect(bell.querySelector(".lucide-bell")).not.toBeNull();
  await userEvent.click(bell);
  expect(
    await screen.findByRole("dialog", { name: "Project notifications" }),
  ).toBeVisible();
});
