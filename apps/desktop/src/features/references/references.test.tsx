import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceCanvas, RefFrame, RefItem } from "../../bindings";
import {
  CanvasHistory,
  debounceSave,
  geometryAt,
  linkedTargets,
  pasteContent,
  referenceKind,
} from "./model";
import { type ItemData, ReferenceNode } from "./Nodes";
import { CanvasContext, type CanvasRuntime } from "./runtime";

// This file renders static node fixtures. Actual navigation/draft guards are
// exercised with a real memory router in inline-note-router.test.tsx.
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
}));

const item: RefItem = {
  id: "i",
  jamId: "j",
  position: 0,
  createdBy: "h",
  updatedBy: "h",
  createdAt: "now",
  updatedAt: "now",
  archivedAt: null,
  kind: "note",
  assetId: null,
  url: null,
  title: "Snow lantern",
  captionMd: "Soft amber on snow",
  tags: [],
  x: 20,
  y: 40,
  w: 240,
  h: 180,
  z: 0,
  frameId: null,
  linkPreview: null,
  metadata: null,
};
const frame: RefFrame = {
  id: "f",
  jamId: "j",
  title: "Lighting",
  epicId: "e",
  x: 400,
  y: 200,
  w: 800,
  h: 600,
  color: "m1",
  archivedAt: null,
  collapsed: false,
};
describe("reference canvas domain helpers", () => {
  it("detects every local media kind without fetching a URL", () => {
    for (const [path, kind] of [
      ["sprite.PNG", "image"],
      ["snow.wav", "audio"],
      ["clip.webm", "video"],
      ["font.woff2", "font"],
      ["level.ldtk", "file"],
    ])
      expect(referenceKind({ kind: "asset" }, path)).toBe(kind);
    expect(referenceKind({ kind: "link" }, "https://example.test/x.png")).toBe(
      "link",
    );
    expect(
      referenceKind({ kind: "asset" }, String.raw`\\?\C:\Jam Board\snow.WAV`),
    ).toBe("audio");
    expect(
      referenceKind({ kind: "asset" }, String.raw`\\?\C:\Jam Board\sprite.png`),
    ).toBe("image");
    expect(referenceKind({ kind: "asset" }, "C:/Jam Board/sprite#2.png")).toBe(
      "image",
    );
  });
  it("parents a drop in world coordinates and releases a drag-out", () => {
    expect(geometryAt(item, { x: 430, y: 260 }, [frame])).toMatchObject({
      frameId: "f",
      x: 30,
      y: 60,
    });
    expect(
      geometryAt({ ...item, frameId: "f" }, { x: 1500, y: 900 }, [frame]),
    ).toMatchObject({ frameId: null, x: 1500, y: 900 });
  });
  it("derives an epic chip via a frame without duplicating an explicit link", () => {
    const data: ReferenceCanvas = {
        items: [item],
        frames: [frame],
        links: [],
        edges: [],
      },
      targets = [{ id: "e", key: "JB-E1", kind: "epic" }];
    expect(
      linkedTargets({ ...item, frameId: "f" }, data, targets),
    ).toMatchObject([{ key: "JB-E1", viaFrame: true }]);
    data.links.push({
      itemId: "i",
      targetType: "epic",
      targetId: "e",
      archivedAt: null,
    });
    expect(
      linkedTargets({ ...item, frameId: "f" }, data, targets),
    ).toMatchObject([{ key: "JB-E1", viaFrame: false }]);
  });
  it("undoes and redoes move, caption and archive in session order", async () => {
    const h = new CanvasHistory(),
      state = { x: 0, caption: "before", archived: false };
    for (const [key, before, after] of [
      ["x", 0, 8],
      ["caption", "before", "after"],
      ["archived", false, true],
    ] as const) {
      Object.assign(state, { [key]: after });
      h.record({
        label: key,
        undo: async () => Object.assign(state, { [key]: before }),
        redo: async () => Object.assign(state, { [key]: after }),
      });
    }
    await h.undo();
    expect(state.archived).toBe(false);
    await h.undo();
    expect(state.caption).toBe("before");
    await h.undo();
    expect(state.x).toBe(0);
    await h.redo();
    await h.redo();
    await h.redo();
    expect(state).toEqual({ x: 8, caption: "after", archived: true });
  });
  it("routes pasted images before URL/text and leaves empty clipboard alone", () => {
    const data = (text: string, files: File[] = []) => ({
      files: files as unknown as FileList,
      getData: () => text,
    });
    expect(pasteContent(data("https://example.test"))).toEqual({
      kind: "link",
      text: "https://example.test",
    });
    expect(pasteContent(data("a caption"))).toEqual({
      kind: "note",
      text: "a caption",
    });
    expect(
      pasteContent(
        data("https://example.test", [
          new File(["png"], "clip.png", { type: "image/png" }),
        ]),
      )?.kind,
    ).toBe("image");
    expect(pasteContent(data(" "))).toBeNull();
  });
  it("saves final geometry once after 300 ms and cancels on unmount", () => {
    vi.useFakeTimers();
    const save = vi.fn(),
      d = debounceSave(save);
    d.schedule(1);
    vi.advanceTimersByTime(100);
    d.schedule(2);
    vi.advanceTimersByTime(299);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(2);
    d.schedule(3);
    d.cancel();
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
it.each(["image", "audio", "video", "font", "file", "link", "note"])(
  "renders the %s node fixture with a common accessible paper frame",
  (kind) => {
    const path =
        {
          image: "x.png",
          audio: "x.wav",
          video: "x.webm",
          font: "x.ttf",
          file: "x.bin",
          link: "",
          note: "",
        }[kind] ?? "",
      runtime: CanvasRuntime = {
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
      },
      data: ItemData = {
        item: {
          ...item,
          kind: kind === "link" ? "link" : kind === "note" ? "note" : "asset",
          url: kind === "link" ? "https://example.test" : null,
        },
        path,
        links: [
          { key: "JB-E1", viaFrame: true },
          { key: "JB-1", viaFrame: false },
        ],
        color: "var(--m1)",
        dim: false,
        connect: false,
      };
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ReactFlowProvider>
          <CanvasContext.Provider value={runtime}>
            <ReferenceNode
              id="i"
              data={data}
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
      </QueryClientProvider>,
    );
    expect(screen.getByRole("article")).toHaveClass(`kind-${kind}`);
    expect(screen.getByRole("article")).toHaveAccessibleName(
      `${kind} reference: Snow lantern, linked to JB-E1, JB-1`,
    );
    expect(screen.queryByText("via frame")).toBeNull();
    expect(screen.getByRole("button", { name: "JB-1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "JB-E1" })).toBeNull();
  },
);
