import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { AssetDialog } from "./assets/AssetsPage";

afterEach(() => vi.restoreAllMocks());
it("a real router refuses navigation during a captured asset save and restores normal Escape/focus after known failure", async () => {
  await mockApi.resetDemo();
  const asset = (await mockApi.listAssets())[0];
  if (!asset) throw Error("Missing demo asset");
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, no) => {
    reject = no;
  });
  const save = vi.spyOn(api, "updateAsset").mockReturnValue(pending),
    user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  function Editor() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open asset editor
        </button>
        {open && <AssetDialog asset={asset} close={() => setOpen(false)} />}
      </>
    );
  }
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const editor = createRoute({
    getParentRoute: () => root,
    path: "/assets",
    component: Editor,
  });
  const other = createRoute({
    getParentRoute: () => root,
    path: "/projects",
    component: () => <h1>Other page</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([editor, other]),
    history: createMemoryHistory({ initialEntries: ["/assets"] }),
  });
  render(<RouterProvider router={router} />);
  const opener = await screen.findByRole("button", {
    name: "Open asset editor",
  });
  await user.click(opener);
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Captured asset title");
  const form = screen
    .getByRole("button", { name: "Save asset" })
    .closest("form");
  if (!form) throw Error("Missing form");
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(window, { key: "Escape" });
    void router.navigate({ to: "/projects" });
  });
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(router.state.location.pathname).toBe("/assets");
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]?.[0]).toMatchObject({
    id: asset.id,
    name: "Captured asset title",
  });
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveFocus();
  await act(async () => reject(new Error("Known fictional rejection")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Known fictional rejection",
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Captured asset title");
  expect(screen.getByLabelText("Name")).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(opener).toHaveFocus();
  await act(async () => {
    await router.navigate({ to: "/projects" });
  });
  expect(
    await screen.findByRole("heading", { name: "Other page" }),
  ).toBeVisible();
});
