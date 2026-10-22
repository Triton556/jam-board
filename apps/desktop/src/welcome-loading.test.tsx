import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const load = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve, requested: vi.fn() };
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

it("a delayed Welcome chunk has visible loading feedback and cannot supersede a later route", async () => {
  const create = vi.spyOn(api, "createJam"),
    demo = vi.spyOn(api, "loadDemoJam"),
    user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(load.requested).toHaveBeenCalledOnce());
  expect(await screen.findByRole("status", { name: "" })).toHaveTextContent(
    "Loading project setup…",
  );
  expect(screen.getByRole("main")).toHaveTextContent("Loading project setup…");
  await act(async () => {
    await router.navigate({ to: "/projects" });
  });
  expect(
    await screen.findByRole("heading", { name: "Your projects" }),
  ).toBeVisible();
  await act(async () => load.resolve());
  expect(router.state.location.pathname).toBe("/projects");
  expect(create).not.toHaveBeenCalled();
  expect(demo).not.toHaveBeenCalled();
  await act(async () => {
    await router.navigate({ to: "/welcome" });
  });
  expect(
    await screen.findByRole("heading", { name: "What are we making?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Load demo jam" }));
  expect(
    await screen.findByRole("link", { name: /Switch project/ }),
  ).toBeVisible();
  expect(demo).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});
