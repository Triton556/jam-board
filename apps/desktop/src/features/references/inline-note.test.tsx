// RF01/RF03: functional DOM evidence only, not native pointer/visual acceptance.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { ReferencesPage } from "./ReferencesPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => undefined,
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => vi.restoreAllMocks());
async function mountDraft() {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const saved = vi.fn(),
    close = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined);
  const rendered = render(
    <QueryClientProvider client={client}>
      <DraftNote
        projectId={app.jam?.id ?? ""}
        x={40}
        y={80}
        saved={saved}
        close={close}
        refresh={refresh}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, client, app, saved, close, refresh };
}
async function fill() {
  await userEvent.type(
    screen.getByRole("textbox", { name: "Title" }),
    "Lighting notes",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note" }),
    "Amber lantern on snow",
  );
}
it("RF03 blank and whitespace drafts never persist; Cancel returns without a mutation", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { close } = await mountDraft();
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
  fireEvent.submit(screen.getByRole("form"));
  expect(create).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
    target: { value: "   " },
  });
  fireEvent.submit(screen.getByRole("form"));
  expect(create).not.toHaveBeenCalled();
});
it("RF03 inline title/body creates exactly once and preserves world geometry", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { saved } = await mountDraft();
  await fill();
  fireEvent.submit(screen.getByRole("form"));
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledExactlyOnceWith({
    kind: "note",
    title: "Lighting notes",
    text: "Amber lantern on snow",
    x: 40,
    y: 80,
  });
  const created = saved.mock.calls[0]?.[0];
  if (!created) throw Error("Missing created item");
  expect(
    (await mockApi.referenceCanvas()).items.find(
      (item) => item.id === created.id,
    ),
  ).toMatchObject({
    title: "Lighting notes",
    captionMd: "Amber lantern on snow",
  });
});
it("RF03 pending Escape/Cancel and repeated keyboard save cannot dismiss or duplicate", async () => {
  const item = await mockApi.addReference({
    kind: "note",
    text: "Existing fixture",
  });
  let resolve!: (
    value: Awaited<ReturnType<typeof mockApi.addReference>>,
  ) => void;
  const create = vi.spyOn(mockApi, "addReference").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { close, saved } = await mountDraft();
  await fill();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), {
    key: "s",
    ctrlKey: true,
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.keyDown(screen.getByRole("form"), { key: "Escape" });
  fireEvent.keyDown(screen.getByRole("form"), { key: "s", metaKey: true });
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => resolve(item));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledOnce();
});
it("RF03 commit then lost response retains text and read reconciliation never retries create", async () => {
  const original = mockApi.addReference.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "addReference")
    .mockImplementation(async (input) => {
      await original(input);
      throw Error("Response lost");
    });
  const { saved, refresh } = await mountDraft();
  await fill();
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByText(/Creation is unconfirmed/);
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue(
    "Amber lantern on snow",
  );
  expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh references" }),
  );
  fireEvent.submit(screen.getByRole("form"));
  expect(refresh).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
  expect(
    (await mockApi.referenceCanvas()).items.filter(
      (item) => item.title === "Lighting notes",
    ),
  ).toHaveLength(1);
});
it("RF03 dirty Escape requires explicit discard and Keep editing preserves both fields", async () => {
  const { close } = await mountDraft();
  await fill();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), {
    key: "Escape",
  });
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Lighting notes",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(close).toHaveBeenCalledOnce();
});
it("RF03 A→B→A project epoch refuses dispatch while keeping text copyable", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { client, app } = await mountDraft();
  await fill();
  act(() => {
    client.setQueryData(["app"], { ...app, jam: { ...app.jam, id: "other" } });
    client.setQueryData(["app"], app);
  });
  await screen.findByText(/project or form target changed/);
  fireEvent.submit(screen.getByRole("form"));
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue(
    "Amber lantern on snow",
  );
});
it("RF03 late response after unmount never invokes completion on a newer surface", async () => {
  const item = await mockApi.addReference({
    kind: "note",
    text: "Existing fixture",
  });
  let resolve!: (
    value: Awaited<ReturnType<typeof mockApi.addReference>>,
  ) => void;
  vi.spyOn(mockApi, "addReference").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { saved, unmount } = await mountDraft();
  await fill();
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(resolve).toBeDefined());
  unmount();
  await act(async () => resolve(item));
  expect(saved).not.toHaveBeenCalled();
});
it("RF01 frame-only canvas hides empty artwork and Add note opens a local inline paper, not dialog", async () => {
  vi.spyOn(mockApi, "referenceCanvas").mockResolvedValue({
    items: [],
    frames: [
      {
        id: "frame",
        jamId: "j",
        title: "Mood",
        epicId: null,
        x: 0,
        y: 0,
        w: 800,
        h: 600,
        color: "m1",
        archivedAt: null,
        collapsed: false,
      },
    ],
    edges: [],
    links: [],
  });
  const create = vi.spyOn(mockApi, "addReference");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReferencesPage />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Add" });
  expect(
    screen.queryByText("Drop images, sounds, videos or links here"),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await userEvent.click(screen.getByRole("button", { name: "Note" }));
  await screen.findByRole("form", { name: "New note draft" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});
