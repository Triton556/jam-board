// RF01/RF03: real editable-paper behavior; DOM is not native pointer/visual proof.
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
    confirmed = vi.fn();
  const rendered = render(
    <QueryClientProvider client={client}>
      <DraftNote
        projectId={app.jam?.id ?? ""}
        x={40}
        y={80}
        saved={saved}
        close={close}
        confirmed={confirmed}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, client, app, saved, close, confirmed };
}
async function fill(withHeading = true) {
  if (withHeading) {
    await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Optional note heading" }),
      "Lighting notes",
    );
  }
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note text" }),
    "Amber lantern on snow",
  );
}
function flush() {
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Note text" }), {
    key: "s",
    ctrlKey: true,
  });
}
it.each(["", "   "])(
  "RF03 empty/whitespace paper %j removes without any create or form",
  async (body) => {
    const create = vi.spyOn(mockApi, "addReference");
    const { close } = await mountDraft();
    expect(
      screen.getByRole("article", { name: "New note paper" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveFocus();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save note" }),
    ).not.toBeInTheDocument();
    if (body)
      await userEvent.type(
        screen.getByRole("textbox", { name: "Note text" }),
        body,
      );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
  },
);
it("RF03 heading alone autosaves exactly once without copying heading into its empty body", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { close, saved, confirmed } = await mountDraft();
  await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
  const heading = screen.getByRole("textbox", {
    name: "Optional note heading",
  });
  await userEvent.type(heading, "Heading only");
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce(), {
    timeout: 2000,
  });
  expect(create).toHaveBeenCalledExactlyOnceWith({
    kind: "note",
    title: "Heading only",
    text: "",
    x: 40,
    y: 80,
  });
  expect(heading).toHaveValue("Heading only");
  expect(heading).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue("");
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  const created = confirmed.mock.calls[0]?.[0];
  expect(
    (await mockApi.referenceCanvas()).items.find(
      (item) => item.id === created?.id,
    ),
  ).toMatchObject({ title: "Heading only", captionMd: "" });
  expect(close).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledOnce();
});
it("RF03 body directly autosaves once without a heading, preserving world coordinates and focused textarea", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { confirmed, saved } = await mountDraft();
  const body = screen.getByRole("textbox", { name: "Note text" });
  await fill(false);
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce(), {
    timeout: 2000,
  });
  expect(create).toHaveBeenCalledExactlyOnceWith(
    {
      kind: "note",
      text: "Amber lantern on snow",
      x: 40,
      y: 80,
    },
    true,
  );
  expect(screen.getByRole("textbox", { name: "Note text" })).toBe(body);
  expect(body).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  expect(saved).not.toHaveBeenCalled();
  const created = confirmed.mock.calls[0]?.[0];
  expect(
    (await mockApi.referenceCanvas()).items.find(
      (item) => item.id === created?.id,
    ),
  ).toMatchObject({
    title: "",
    captionMd: "Amber lantern on snow",
    x: 40,
    y: 80,
  });
});
it("RF03 optional heading/body flush exactly once; Escape finishes only after confirmation", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { confirmed, saved } = await mountDraft();
  await fill();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(confirmed).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledExactlyOnceWith({
    kind: "note",
    title: "Lighting notes",
    text: "Amber lantern on snow",
    x: 40,
    y: 80,
  });
});
it("RF03 pending Escape and repeated keyboard flush cannot finish early or duplicate create", async () => {
  const item = await mockApi.addReference({
    kind: "note",
    title: "Lighting notes",
    text: "Amber lantern on snow",
  });
  let resolve!: (value: typeof item) => void;
  const create = vi.spyOn(mockApi, "addReference").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { close, saved, confirmed } = await mountDraft();
  await fill();
  flush();
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await userEvent.keyboard("{Escape}{Escape}");
  flush();
  expect(close).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Finish editing note" }),
  ).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Saving…");
  await act(async () => resolve(item));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(confirmed).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
});
it("RF03 commit then lost response retains editable text and read reconciliation never retries create", async () => {
  const original = mockApi.addReference.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "addReference")
    .mockImplementation(async (input, untitled) => {
      await original(input, untitled);
      throw Error("Response lost");
    });
  const { saved, close, confirmed } = await mountDraft();
  await fill();
  flush();
  await screen.findByText("Save unconfirmed · text retained");
  const body = screen.getByRole("textbox", { name: "Note text" });
  expect(body).toHaveValue("Amber lantern on snow");
  expect(body).not.toHaveAttribute("readonly");
  const read = vi.spyOn(mockApi, "referenceCanvas");
  await userEvent.click(screen.getByRole("button", { name: "Check latest" }));
  await screen.findByText(/Board checked\. Inspect its notes/);
  expect(read).toHaveBeenCalledOnce();
  await userEvent.type(body, " — newer local detail");
  await userEvent.keyboard("{Escape}");
  flush();
  expect(create).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
  expect(confirmed).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(body).toHaveValue("Amber lantern on snow — newer local detail");
  expect(
    (await mockApi.referenceCanvas()).items.filter(
      (item) => item.title === "Lighting notes",
    ),
  ).toHaveLength(1);
});
it("RF03 A→B→A project epoch refuses dispatch while retaining copyable draft", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  const { client, app } = await mountDraft();
  await fill();
  act(() => {
    client.setQueryData(["app"], { ...app, jam: { ...app.jam, id: "other" } });
    client.setQueryData(["app"], app);
  });
  await screen.findByText(/The project changed/);
  flush();
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Amber lantern on snow",
  );
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveAttribute(
    "readonly",
  );
  expect(screen.getByRole("textbox", { name: "Note text" })).not.toBeDisabled();
});
it("RF03 late response after unmount cannot confirm or finish a newer surface", async () => {
  const item = await mockApi.addReference({
    kind: "note",
    text: "Existing fixture",
  });
  let resolve!: (value: typeof item) => void;
  vi.spyOn(mockApi, "addReference").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { saved, confirmed, unmount } = await mountDraft();
  await fill(false);
  flush();
  await waitFor(() => expect(resolve).toBeDefined());
  unmount();
  await act(async () => resolve(item));
  expect(saved).not.toHaveBeenCalled();
  expect(confirmed).not.toHaveBeenCalled();
});
it("RF01 frame-only canvas hides empty artwork; placement is cancellable and Enter creates only a local paper", async () => {
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
  const arm = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.click(screen.getByRole("button", { name: "Note" }));
    await screen.findByText(/Click the canvas to place a note/);
    expect(
      screen.getByRole("region", { name: "References canvas" }),
    ).toHaveFocus();
    expect(
      screen.queryByRole("article", { name: "New note paper" }),
    ).not.toBeInTheDocument();
  };
  await arm();
  await userEvent.keyboard("{Escape}");
  expect(
    screen.queryByText(/Click the canvas to place a note/),
  ).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  await arm();
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("article", { name: "New note paper" });
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});
