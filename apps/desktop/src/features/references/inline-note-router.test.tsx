// RF03: real TanStack router blockers, no mocked useBlocker.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { DraftNote } from "./DraftNote";

beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  vi.stubGlobal("confirm", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const root = createRootRoute({
    component: () => (
      <>
        <Link to="/board">Leave references</Link>
        <Outlet />
      </>
    ),
  });
  const references = createRoute({
    getParentRoute: () => root,
    path: "/references",
    component: () => (
      <DraftNote
        projectId={app.jam?.id ?? ""}
        x={0}
        y={0}
        close={() => {}}
        saved={() => {}}
        refresh={async () => {}}
      />
    ),
  });
  const board = createRoute({
    getParentRoute: () => root,
    path: "/board",
    component: () => <h1>Other route</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([references, board]),
    history: createMemoryHistory({ initialEntries: ["/references"] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("form", { name: "New note draft" });
  return router;
}
it("RF03 real navigation Stay retains dirty fields; explicit Leave discards only local draft without create", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const router = await mount();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Title" }),
    "Keep my title",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note" }),
    "Keep my text",
  );
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(router.state.location.pathname).toBe("/references");
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Keep my title",
  );
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue(
    "Keep my text",
  );
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  await screen.findByRole("heading", { name: "Other route" });
  expect(router.state.location.pathname).toBe("/board");
  expect(create).not.toHaveBeenCalled();
});
it("RF03 real pending navigation is refused without asking to discard; failure retains text and uncertainty", async () => {
  let reject!: (error: Error) => void;
  const create = vi.spyOn(mockApi, "addReference").mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const router = await mount();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note" }),
    "Pending text",
  );
  fireEvent.submit(screen.getByRole("form", { name: "New note draft" }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  expect(router.state.location.pathname).toBe("/references");
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue(
    "Pending text",
  );
  await act(async () => reject(Error("Lost response")));
  await screen.findByText("Creation unconfirmed · text retained");
  expect(router.state.location.pathname).toBe("/references");
  expect(create).toHaveBeenCalledOnce();
});
