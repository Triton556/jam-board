// RF03: real TanStack router ownership; useBlocker is not mocked.
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
import type { RefItem } from "../../bindings";
import { mockApi } from "../../lib/mock-bridge";
import { DraftNote } from "./DraftNote";
import { StickyEditor } from "./StickyEditor";

beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(item?: RefItem) {
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
    component: () =>
      item ? (
        <StickyEditor
          item={item}
          projectId={app.jam?.id ?? ""}
          confirmed={() => {}}
        />
      ) : (
        <DraftNote
          projectId={app.jam?.id ?? ""}
          x={0}
          y={0}
          close={() => {}}
          saved={() => {}}
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
  if (item) await screen.findByRole("button", { name: /Edit note/ });
  else await screen.findByRole("article", { name: "New note paper" });
  return router;
}
it("RF03 one deliberate navigation waits for confirmed flush before leaving, with no discarded text", async () => {
  const original = mockApi.addReference.bind(mockApi);
  let acknowledge!: () => void;
  const create = vi
    .spyOn(mockApi, "addReference")
    .mockImplementation(async (input, untitled) => {
      const item = await original(input, untitled);
      await new Promise<void>((done) => {
        acknowledge = done;
      });
      return item;
    });
  const router = await mount();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note text" }),
    "Keep this through navigation",
  );
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  await waitFor(() => expect(acknowledge).toBeDefined());
  expect(router.state.location.pathname).toBe("/references");
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Keep this through navigation",
  );
  await act(async () => acknowledge());
  await screen.findByRole("heading", { name: "Other route" });
  expect(router.state.location.pathname).toBe("/board");
  expect(create).toHaveBeenCalledOnce();
  expect(
    (await mockApi.referenceCanvas()).items.filter(
      (item) => item.captionMd === "Keep this through navigation",
    ),
  ).toHaveLength(1);
});
it("RF03 pending navigation followed by failure retains paper/error and never retries the uncertain create", async () => {
  let reject!: (error: Error) => void;
  const create = vi.spyOn(mockApi, "addReference").mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const router = await mount();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note text" }),
    "Pending text",
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Note text" }), {
    key: "s",
    ctrlKey: true,
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  expect(router.state.location.pathname).toBe("/references");
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Pending text",
  );
  await act(async () => reject(Error("Lost response")));
  await screen.findByText("Save unconfirmed · text retained");
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  expect(router.state.location.pathname).toBe("/references");
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Pending text",
  );
  expect(create).toHaveBeenCalledOnce();
});
it("RF03 an empty local paper may leave without a record", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const router = await mount();
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  await screen.findByRole("heading", { name: "Other route" });
  expect(router.state.location.pathname).toBe("/board");
  expect(create).not.toHaveBeenCalled();
});

it("RF03 failed existing-note read can be deliberately abandoned locally, releasing the real route guard without replay", async () => {
  const item = await mockApi.addReference({
    kind: "note",
    title: "Saved note",
    text: "Original",
  });
  const update = vi
    .spyOn(mockApi, "updateReference")
    .mockRejectedValue(new Error("Lost response"));
  const read = vi
    .spyOn(mockApi, "referenceCanvas")
    .mockRejectedValue(new Error("Offline"));
  const archive = vi.spyOn(mockApi, "canvasArchive");
  const router = await mount(item);
  await userEvent.click(
    screen.getByRole("button", { name: "Edit note Saved note" }),
  );
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, " retained wishes");
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  await screen.findByText("Save unconfirmed · text retained");
  expect(router.state.location.pathname).toBe("/references");
  await userEvent.click(screen.getByRole("button", { name: "Check latest" }));
  await screen.findByText(/Could not check the latest note/);
  expect(body).toHaveValue("Original retained wishes");
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("confirm", confirm);
  await userEvent.click(
    screen.getByRole("button", { name: "Discard my edits" }),
  );
  expect(body).toHaveValue("Original retained wishes");
  confirm.mockReturnValue(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Discard my edits" }),
  );
  expect(confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("does not undo any save"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit note Saved note" }),
  );
  const reopened = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(reopened, " new retained text");
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  expect(router.state.location.pathname).toBe("/references");
  expect(reopened).toHaveValue("Original new retained text");
  expect(update).toHaveBeenCalledOnce();
  await userEvent.click(
    screen.getByRole("button", { name: "Discard my edits" }),
  );
  await userEvent.click(screen.getByRole("link", { name: "Leave references" }));
  await screen.findByRole("heading", { name: "Other route" });
  expect(router.state.location.pathname).toBe("/board");
  expect(update).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  expect(archive).not.toHaveBeenCalled();
});
