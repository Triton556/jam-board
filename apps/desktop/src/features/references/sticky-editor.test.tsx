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
import type { RefItem } from "../../bindings";
import { mockApi } from "../../lib/mock-bridge";
import { JamError } from "../../lib/types";
import { StickyEditor } from "./StickyEditor";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(item?: RefItem) {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const confirmed = vi.fn(),
    finished = vi.fn();
  const view = (value = item) => (
    <QueryClientProvider client={client}>
      <StickyEditor
        item={value}
        local={!value}
        projectId={app.jam?.id ?? ""}
        position={{ x: 42, y: 75 }}
        confirmed={confirmed}
        finished={finished}
      />
    </QueryClientProvider>
  );
  const rendered = render(view());
  return { ...rendered, app, client, confirmed, finished, view };
}
async function makeNote() {
  return mockApi.addReference({
    kind: "note",
    text: "Original **agent** result",
    title: "Existing heading",
  });
}
async function edit() {
  await userEvent.click(screen.getByRole("button", { name: /Edit note/ }));
  return screen.getByRole("textbox", { name: "Note text" });
}

it("empty paper never creates; optional heading and body autosave without a Save form", async () => {
  const create = vi.spyOn(mockApi, "addReference");
  await mount();
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveFocus();
  expect(
    screen.queryByRole("button", { name: /^Save/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Optional note heading" }),
    "Only a heading",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note text" }),
    "A tiny playable lantern",
  );
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1), {
    timeout: 1500,
  });
  expect(create).toHaveBeenCalledWith({
    kind: "note",
    text: "A tiny playable lantern",
    title: "Only a heading",
    x: 42,
    y: 75,
  });
  await screen.findByText("Saved");
});
it("confirmed create keeps the same focused body and serially saves newer typing by confirmed ID", async () => {
  const original = mockApi.addReference.bind(mockApi),
    response = deferred<RefItem>();
  const create = vi
    .spyOn(mockApi, "addReference")
    .mockImplementation(async (input, untitled) => {
      const row = await original(input, untitled);
      await response.promise;
      return row;
    });
  const update = vi.spyOn(mockApi, "updateReference");
  await mount();
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, "First");
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  await userEvent.type(body, " plus newer text");
  await act(async () => response.resolve({} as RefItem));
  expect(screen.getByRole("textbox", { name: "Note text" })).toBe(body);
  expect(body).toHaveFocus();
  expect(body).toHaveValue("First plus newer text");
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1), {
    timeout: 1500,
  });
  expect(update.mock.calls[0]?.[1]).toEqual({
    title: "",
    caption: "First plus newer text",
  });
  expect(update.mock.calls[0]?.[2]).toEqual({
    title: "",
    caption: "First",
  });
  expect(create).toHaveBeenCalledTimes(1);
});
it("lost create response retains text and never retries even after typing, Escape and read-only check", async () => {
  const original = mockApi.addReference.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "addReference")
    .mockImplementation(async (input, untitled) => {
      await original(input, untitled);
      throw new Error("Reply lost after commit");
    });
  await mount();
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, "Retain me");
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  await screen.findByText(/Save unconfirmed/);
  await userEvent.type(body, " even now");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Check latest" }));
  await screen.findByText(/original create may have succeeded/);
  expect(create).toHaveBeenCalledTimes(1);
  expect(body).toHaveValue("Retain me even now");
});
it("existing Markdown remains untouched until deliberate edit; body/caret events cannot bubble to canvas drag", async () => {
  const note = await makeNote(),
    update = vi.spyOn(mockApi, "updateReference");
  const app = await mockApi.appState(),
    client = new QueryClient();
  client.setQueryData(["app"], app);
  const pointer = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <div onPointerDown={pointer}>
        <StickyEditor item={note} projectId={note.jamId} confirmed={() => {}} />
      </div>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
  const body = await edit();
  pointer.mockClear();
  fireEvent.pointerDown(body);
  expect(pointer).not.toHaveBeenCalled();
  await userEvent.type(body, " + a human wish");
  await userEvent.keyboard("{Escape}");
  await screen.findByRole("button", { name: /Edit note/ });
  expect(update).toHaveBeenCalledWith(
    note.id,
    { title: note.title, caption: `${note.captionMd} + a human wish` },
    { title: note.title, caption: note.captionMd },
  );
  await edit();
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    `${note.captionMd} + a human wish`,
  );
});
it("atomic conflict keeps the exact draft and requires read + explicit choice before any retry", async () => {
  const note = await makeNote(),
    response = deferred<RefItem>();
  const update = vi
    .spyOn(mockApi, "updateReference")
    .mockReturnValueOnce(response.promise);
  await mount(note);
  const body = await edit();
  await userEvent.clear(body);
  await userEvent.type(body, "My retained draft");
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  await act(async () =>
    response.reject(new JamError("conflict", "Content changed")),
  );
  expect(body).toHaveValue("My retained draft");
  await userEvent.click(screen.getByRole("button", { name: "Check latest" }));
  await screen.findByText("Latest saved note");
  expect(update).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Save my retained text" }),
  );
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1]?.[2]).toEqual({
    title: note.title,
    caption: note.captionMd,
  });
});
it("observed remote title/body change pauses autosave without rewriting human text", async () => {
  const note = await makeNote(),
    update = vi.spyOn(mockApi, "updateReference");
  const h = await mount(note),
    body = await edit();
  await userEvent.type(body, " human addition");
  h.rerender(h.view({ ...note, captionMd: "New external result" }));
  await screen.findByText(/This note changed elsewhere/);
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  expect(update).not.toHaveBeenCalled();
  expect(body).toHaveValue(`${note.captionMd} human addition`);
});
it("ABA and unmount prevent late acknowledgment from publishing or queuing newer writes", async () => {
  const note = await makeNote(),
    response = deferred<RefItem>();
  const update = vi
    .spyOn(mockApi, "updateReference")
    .mockReturnValue(response.promise);
  const h = await mount(note),
    body = await edit();
  await userEvent.type(body, " first");
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await userEvent.type(body, " newer");
  act(() => {
    h.client.setQueryData(["app"], {
      ...h.app,
      jam: { ...h.app.jam, id: "other" },
    });
    h.client.setQueryData(["app"], h.app);
  });
  await act(async () =>
    response.resolve({ ...note, captionMd: `${note.captionMd} first` }),
  );
  expect(h.confirmed).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledTimes(1);
  expect(body).toHaveValue(`${note.captionMd} first newer`);
  h.unmount();
});

it("synchronous transport failure releases the flight lock but never automatically replays", async () => {
  const create = vi.spyOn(mockApi, "addReference").mockImplementation(() => {
    throw Error("Transport unavailable");
  });
  await mount();
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, "Keep this exact text");
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  await screen.findByText(/The save outcome is unconfirmed/);
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Check latest" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Check latest" }));
  await screen.findByText(/original create may have succeeded/);
  expect(create).toHaveBeenCalledTimes(1);
  expect(body).toHaveValue("Keep this exact text");
});
it("clearing an existing note saves an empty caption by guarded update, never archive or recreate", async () => {
  const note = await makeNote(),
    update = vi.spyOn(mockApi, "updateReference"),
    create = vi.spyOn(mockApi, "addReference"),
    archive = vi.spyOn(mockApi, "canvasArchive");
  await mount(note);
  const body = await edit();
  await userEvent.clear(body);
  await userEvent.keyboard("{Escape}");
  await screen.findByRole("button", { name: /Edit note/ });
  expect(update).toHaveBeenCalledExactlyOnceWith(
    note.id,
    { title: note.title, caption: "" },
    { title: note.title, caption: note.captionMd },
  );
  expect(create).not.toHaveBeenCalled();
  expect(archive).not.toHaveBeenCalled();
});
it.each(["", "A body too"])(
  "literal heading Note survives autosave and a fresh editor with body %j",
  async (text) => {
    const h = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Optional note heading" }),
      "Note",
    );
    const body = screen.getByRole("textbox", { name: "Note text" });
    if (text) await userEvent.type(body, text);
    fireEvent.keyDown(body, { key: "s", ctrlKey: true });
    await screen.findByText("Saved");
    const saved = (await mockApi.referenceCanvas()).items[0];
    if (!saved) throw Error("No saved note");
    expect(saved.title).toBe("Note");
    expect(saved.captionMd).toBe(text);
    h.unmount();
    await mount(saved);
    expect(
      screen.getByRole("button", { name: "Edit note Note" }),
    ).toHaveAccessibleName("Edit note Note");
    await edit();
    expect(
      screen.getByRole("textbox", { name: "Optional note heading" }),
    ).toHaveValue("Note");
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
      text,
    );
  },
);
it("an unmounted finishing paper cannot close or focus a replacement after acknowledgment", async () => {
  const response = deferred<RefItem>(),
    original = mockApi.addReference.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "addReference")
    .mockReturnValue(response.promise);
  const h = await mount();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Note text" }),
    "First local paper",
  );
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  h.unmount();
  const next = await mount(),
    replacement = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(replacement, "Replacement");
  await act(async () =>
    response.resolve(
      await original({ kind: "note", text: "First local paper" }),
    ),
  );
  expect(h.finished).not.toHaveBeenCalled();
  expect(h.confirmed).not.toHaveBeenCalled();
  expect(next.finished).not.toHaveBeenCalled();
  expect(replacement).toHaveFocus();
  expect(replacement).toHaveValue("Replacement");
});
it("existing Markdown links retain their own action instead of opening the note editor", async () => {
  const note = await mockApi.addReference({
    kind: "note",
    text: "[Source](https://example.com)",
  });
  await mount(note);
  const link = await screen.findByRole("link", { name: "Source" });
  // Prevent this isolated DOM fixture from performing external navigation;
  // the assertion concerns event ownership, not opening the remote website.
  expect(link.closest("button")).toBeNull();
  link.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(link);
  expect(
    screen.queryByRole("textbox", { name: "Note text" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Edit note/ }));
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "[Source](https://example.com)",
  );
});
it("a removed project before dispatch refuses the write and does not mislabel it unconfirmed", async () => {
  const create = vi.spyOn(mockApi, "addReference"),
    h = await mount();
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, "Never sent");
  act(() => {
    fireEvent.keyDown(body, { key: "s", ctrlKey: true });
    h.client.removeQueries({ queryKey: ["app"] });
  });
  await screen.findByText("Not sent · text retained");
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByText(/Save unconfirmed/)).not.toBeInTheDocument();
  expect(body).toHaveValue("Never sent");
});
it("returning focus during a blur save keeps editing open after the confirmed response", async () => {
  const note = await makeNote(),
    response = deferred<RefItem>();
  const update = vi
    .spyOn(mockApi, "updateReference")
    .mockReturnValue(response.promise);
  await mount(note);
  const outside = document.createElement("button");
  outside.textContent = "Other control";
  document.body.append(outside);
  try {
    const body = await edit();
    await userEvent.type(body, " changed");
    await userEvent.click(outside);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await userEvent.click(body);
    await act(async () =>
      response.resolve({ ...note, captionMd: `${note.captionMd} changed` }),
    );
    expect(screen.getByRole("textbox", { name: "Note text" })).toBe(body);
    expect(body).toHaveFocus();
    expect(body).toHaveValue(`${note.captionMd} changed`);
  } finally {
    outside.remove();
  }
});
it("no heading survives a fresh editor, and removing literal Note persists an explicit empty title", async () => {
  const note = await mockApi.addReference({
    kind: "note",
    title: "Note",
    text: "Body remains",
  });
  const h = await mount(note);
  await edit();
  await userEvent.clear(
    screen.getByRole("textbox", { name: "Optional note heading" }),
  );
  await userEvent.keyboard("{Escape}");
  await screen.findByRole("button", { name: "Edit note Body remains" });
  const saved = (await mockApi.referenceCanvas()).items.find(
    (item) => item.id === note.id,
  );
  if (!saved) throw Error("Missing saved note");
  expect(saved.title).toBe("");
  expect(saved.captionMd).toBe("Body remains");
  h.unmount();
  await mount(saved);
  await edit();
  expect(
    screen.queryByRole("textbox", { name: "Optional note heading" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
    "Body remains",
  );
});
it("whitespace-only heading uses explicit no-title once without a repeat autosave", async () => {
  const create = vi.spyOn(mockApi, "addReference"),
    update = vi.spyOn(mockApi, "updateReference");
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Optional note heading" }),
    "   ",
  );
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, "Exact body preserved");
  fireEvent.keyDown(body, { key: "s", ctrlKey: true });
  await screen.findByText("Saved");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 900)));
  expect(create).toHaveBeenCalledExactlyOnceWith(
    { kind: "note", text: "Exact body preserved", x: 42, y: 75 },
    true,
  );
  expect(update).not.toHaveBeenCalled();
  expect(body).toHaveValue("Exact body preserved");
  expect((await mockApi.referenceCanvas()).items[0]?.title).toBe("");
});

it("a canvas geometry rerender after our save is not a remote text edit", async () => {
  const item = await mockApi.addReference(
    { kind: "note", text: "Body only" },
    true,
  );
  const h = await mount(item);
  const update = vi.spyOn(mockApi, "updateReference");
  await edit();
  await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
  const heading = screen.getByRole("textbox", {
    name: "Optional note heading",
  });
  await userEvent.type(heading, "Lantern idea");
  await userEvent.keyboard("{Control>}s{/Control}");
  await waitFor(() => expect(h.confirmed).toHaveBeenCalledOnce());
  const saved = h.confirmed.mock.calls[0]?.[0] as RefItem;
  // Canvas geometry/selection can clone the still-displayed query row before
  // the acknowledged write's refetch arrives. No server text changed here.
  h.rerender(h.view({ ...item, x: 200 }));
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  h.rerender(h.view(saved));
  await userEvent.keyboard("{Escape}");
  await screen.findByRole("button", { name: "Edit note Lantern idea" });
  const reopened = await edit();
  expect(reopened).toHaveValue("Body only");
  expect(
    screen.getByRole("textbox", { name: "Optional note heading" }),
  ).toHaveValue("Lantern idea");
  expect(update).toHaveBeenCalledOnce();
});

it.each(["changed-text-same-marker", "old-text-new-marker"])(
  "an actual newer observation still stops editing after our own save: %s",
  async (kind) => {
    const item = await makeNote();
    const h = await mount(item);
    const update = vi.spyOn(mockApi, "updateReference");
    const body = await edit();
    await userEvent.type(body, " human addition");
    await userEvent.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(h.confirmed).toHaveBeenCalledOnce());
    // Different content must be detected even if clock precision is identical;
    // an actual new observation reverting old content must not be mistaken for
    // a geometry-only clone. No chronological timestamp comparison is used.
    h.rerender(
      h.view({
        ...item,
        ...(kind === "changed-text-same-marker"
          ? { captionMd: "A different agent result" }
          : { updatedAt: "another-observation-marker" }),
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Changed elsewhere");
    expect(body).toHaveValue(`${item.captionMd} human addition`);
    await userEvent.keyboard("{Escape}");
    expect(body).toBeInTheDocument();
    expect(update).toHaveBeenCalledOnce();
  },
);
