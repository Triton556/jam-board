import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RefItem } from "../../bindings";
import { mockApi } from "../../lib/mock-bridge";
import { type ItemData, ReferenceNode } from "./Nodes";
import { CanvasContext, type CanvasRuntime } from "./runtime";
import { editedNoteTarget, retainNoteEditors } from "./sticky-node-ownership";

const viewport = vi.hoisted(() => ({ zoom: 1 }));
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  useStore: (select: (state: { transform: number[] }) => unknown) =>
    select({ transform: [0, 0, viewport.zoom] }),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  viewport.zoom = 1;
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  const item = await mockApi.addReference({
    kind: "note",
    title: "Agent result",
    text: "Keep this result",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const runtime: CanvasRuntime = {
    edit: vi.fn(),
    archive: vi.fn(),
    resize: vi.fn(),
    resizeFrame: vi.fn(),
    collapse: vi.fn(),
    editFrame: vi.fn(),
    open: vi.fn(),
    lightbox: vi.fn(),
    edgeLabel: vi.fn(),
    caption: vi.fn(),
  };
  const data: ItemData = {
    item,
    path: "",
    links: [],
    color: "var(--m1)",
    dim: false,
    connect: false,
  };
  const view = (missing = false) => (
    <QueryClientProvider client={client}>
      <ReactFlowProvider>
        <CanvasContext.Provider value={runtime}>
          <ReferenceNode
            id={item.id}
            data={{ ...data, missing }}
            type="reference"
            selected={false}
            dragging={false}
            zIndex={0}
            isConnectable
            selectable
            draggable
            deletable
            positionAbsoluteX={0}
            positionAbsoluteY={0}
          />
        </CanvasContext.Provider>
      </ReactFlowProvider>
    </QueryClientProvider>
  );
  return { ...render(view()), view, runtime, item };
}
it("a keyboard-open unselected note retains its exact editor and draft across overview zoom", async () => {
  const h = await mount();
  const opener = screen.getByRole("button", { name: "Edit note Agent result" });
  opener.focus();
  await userEvent.keyboard("{Enter}");
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, " plus human text");
  viewport.zoom = 0.39;
  h.rerender(h.view());
  expect(screen.getByRole("textbox", { name: "Note text" })).toBe(body);
  expect(body).toHaveValue("Keep this result plus human text");
  expect(body).toHaveFocus();
});
it("a pending note save cannot be archived out from under its retained error", async () => {
  let reject!: (e: unknown) => void;
  const response = new Promise<RefItem>((_, no) => {
    reject = no;
  });
  const update = vi.spyOn(mockApi, "updateReference").mockReturnValue(response);
  const h = await mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit note Agent result" }),
  );
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, " plus retained text");
  await userEvent.click(screen.getByLabelText("Actions for Agent result"));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  const archive = screen.getByRole("button", { name: "Archive" });
  await userEvent.click(archive);
  expect(h.runtime.archive).not.toHaveBeenCalled();
  expect(archive).toBeDisabled();
  await act(async () => reject(new Error("Response lost")));
  expect(
    await screen.findByText("Save unconfirmed · text retained"),
  ).toBeVisible();
  expect(body).toHaveValue("Keep this result plus retained text");
  expect(h.runtime.archive).not.toHaveBeenCalled();
});

it("an omitted note keeps its exact editor/copyable text, and only explicit local discard ends it", async () => {
  const h = await mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit note Agent result" }),
  );
  const body = screen.getByRole("textbox", { name: "Note text" });
  await userEvent.type(body, " unsaved wishes");
  const update = vi.spyOn(mockApi, "updateReference");
  h.rerender(h.view(true));
  expect(screen.getByRole("textbox", { name: "Note text" })).toBe(body);
  expect(body).toHaveValue("Keep this result unsaved wishes");
  expect(body).toHaveAttribute("readonly");
  expect(
    await screen.findByText(/missing from the latest board/),
  ).toBeVisible();
  expect(update).not.toHaveBeenCalled();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  await userEvent.click(
    screen.getByRole("button", { name: "Discard my edits" }),
  );
  expect(
    screen.queryByRole("textbox", { name: "Note text" }),
  ).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
  expect(h.runtime.archive).not.toHaveBeenCalled();
});
it("only active note nodes survive omitted/collapsed reads; same-note and containing-frame operations are fenced", async () => {
  const h = await mount();
  const node = {
    id: h.item.id,
    type: "reference" as const,
    position: { x: 10, y: 20 },
    parentId: "frame",
    data: {
      item: h.item,
      path: "",
      links: [],
      color: "red",
      dim: false,
      connect: false,
    },
  };
  const media = {
    ...node,
    id: "media",
    data: { ...node.data, item: { ...h.item, id: "media", kind: "asset" } },
  };
  const active = new Set([node.id]);
  expect(editedNoteTarget("item", node.id, [node, media], active)).toBe(true);
  expect(editedNoteTarget("frame", "frame", [node, media], active)).toBe(true);
  expect(editedNoteTarget("item", "media", [node, media], active)).toBe(false);
  expect(editedNoteTarget("edge", "edge", [node, media], active)).toBe(false);
  const retained = retainNoteEditors([], [node, media], active, h.item.jamId);
  expect(retained).toHaveLength(1);
  expect(
    retainNoteEditors([], [node, media], active, "another-project"),
  ).toEqual([]);
  expect(retainNoteEditors([], [node, media], active, undefined)).toEqual([]);
  expect(retained[0]).toMatchObject({
    id: node.id,
    hidden: false,
    parentId: undefined,
    data: { missing: true, item: { captionMd: "Keep this result" } },
  });
  expect(retainNoteEditors([], retained, new Set(), h.item.jamId)).toEqual([]);
  const collapsed = retainNoteEditors(
    [{ ...node, hidden: true }, media],
    [node, media],
    active,
    h.item.jamId,
  );
  expect(collapsed[0]).toMatchObject({ hidden: false });
  expect(collapsed[1]).toBe(media);
});
