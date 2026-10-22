import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

// Own empty fictional application, rather than inheriting a demo project's cache.
vi.mock("./lib/api", async () => {
  localStorage.clear();
  const { MockBridge } = await import("./lib/mock-bridge");
  return { api: new MockBridge() };
});
vi.mock("./lib/grain", () => ({ preparePaperGrain: () => Promise.resolve() }));

import { App, router } from "./app";
import { api } from "./lib/api";

it("on-demand Welcome opens for an empty app, then the visible project switcher retains the full name and existing route", async () => {
  const user = userEvent.setup();
  expect((await api.appState()).hasJam).toBe(false);
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "What are we making?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Load demo jam" }));
  await screen.findByRole("link", { name: /Switch project/ });
  const app = await api.appState();
  const link = await screen.findByRole("link", {
    name: `Switch project · ${app.jam?.name}`,
  });
  expect(link).toHaveTextContent("Switch project");
  expect(link).toHaveAttribute("title", app.jam?.name);
  expect(link).toHaveAttribute("href", "/projects");
  const longName =
    "Fictional desktop and server project with a descriptive name";
  await act(async () => {
    await api.updateProject({
      name: longName,
      template: app.jam?.template ?? "game_jam",
    });
  });
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: `Switch project · ${longName}` }),
    ).toHaveAttribute("title", longName),
  );
  await user.click(
    screen.getByRole("link", { name: `Switch project · ${longName}` }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  expect(
    await screen.findByRole("heading", { name: "Your projects" }),
  ).toBeVisible();
});
