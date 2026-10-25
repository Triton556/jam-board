// F01: production Root and creation dialog with the real router/query lifecycle.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { router as productionRouter } from "../../app";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { NewPlanningDialog } from "./NewPlanningDialog";

vi.mock("../../lib/grain", () => ({ preparePaperGrain: vi.fn() }));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ readyRequest: null, toasts: [] });
});
afterEach(() => vi.restoreAllMocks());
function mountRoot() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  function PlanningSurface() {
    const [creating, setCreating] = useState(false);
    return (
      <>
        <h1>Planning surface</h1>
        <button type="button" onClick={() => setCreating(true)}>
          New epic
        </button>
        {creating && (
          <NewPlanningDialog
            target={{ kind: "epic" }}
            close={() => setCreating(false)}
            created={vi.fn()}
          />
        )}
      </>
    );
  }
  const rootComponent = productionRouter.options.routeTree?.options.component;
  if (!rootComponent) throw new Error("Missing production Root component");
  const root = createRootRoute({ component: rootComponent });
  const child = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: PlanningSurface,
  });
  const router = createRouter({
    routeTree: root.addChildren([child]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
it("F01 first-load app read failure shows the full error page; Retry opens the app", async () => {
  vi.spyOn(mockApi, "appState").mockRejectedValueOnce(
    new Error("First project read failed"),
  );
  mountRoot();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "First project read failed",
  );
  expect(screen.getByText("The sketchbook couldn't open")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Planning surface" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New epic" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Planning surface" }),
  ).toBeVisible();
  expect(
    screen.queryByText("The sketchbook couldn't open"),
  ).not.toBeInTheDocument();
});
it("F01 failed background app read retains the same editor/draft and stale data; inline Retry only rereads", async () => {
  const { client } = mountRoot();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New epic" }));
  const title = screen.getByRole("textbox", { name: "Epic name" });
  await user.type(title, "Draft survives background failure");
  const cached = client.getQueryData(["app"]);
  const create = vi.spyOn(mockApi, "createEpic");
  vi.spyOn(mockApi, "appState").mockRejectedValueOnce(
    new Error("Background app read failed"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["app"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not check the current project: Background app read failed",
  );
  expect(
    screen.queryByText("The sketchbook couldn't open"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Planning surface" }),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Epic name" })).toBe(title);
  expect(title).toHaveValue("Draft survives background failure");
  expect(client.getQueryData(["app"])).toBe(cached);
  expect(screen.getByRole("button", { name: "Create epic" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry project check" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("textbox", { name: "Epic name" })).toBe(title);
  expect(title).toHaveValue("Draft survives background failure");
  expect(screen.getByRole("button", { name: "Create epic" })).toBeEnabled();
  expect(create).not.toHaveBeenCalled();
});
