// RF02: behavioral DOM/drawing calls only; native geometry and visual hierarchy are separate gates.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RefFrame, RefItem } from "../../bindings";
import { ReferenceFrame } from "./Nodes";
import { OverviewScene } from "./OverviewScene";
import { CanvasContext, type CanvasRuntime } from "./runtime";

const camera = vi.hoisted(() => ({ zoom: 1 }));
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  useStore: (selector: (state: { transform: number[] }) => unknown) =>
    selector({ transform: [0, 0, camera.zoom] }),
  ViewportPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  useOnViewportChange: () => {},
}));
afterEach(() => {
  vi.restoreAllMocks();
  camera.zoom = 1;
});
const frame: RefFrame = {
  id: "frame",
  jamId: "j",
  epicId: null,
  title: "Lighting studies",
  x: 0,
  y: 0,
  w: 800,
  h: 600,
  color: "m1",
  archivedAt: null,
  collapsed: false,
};
const runtime = (): CanvasRuntime => ({
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
});
function Frame({
  value = frame,
  selected = false,
}: {
  value?: RefFrame;
  selected?: boolean;
}) {
  return (
    <ReferenceFrame
      id={value.id}
      data={{ frame: value, dim: false }}
      type="frame"
      selected={selected}
      dragging={false}
      zIndex={-1}
      isConnectable={false}
      selectable
      draggable
      deletable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />
  );
}
it.each([1, 0.75, 0.4, 0.39])(
  "RF02 frame title and full grip remain present at zoom %s; actions retain their exact target",
  (zoom) => {
    camera.zoom = zoom;
    const actions = runtime();
    const { container, rerender } = render(
      <ReactFlowProvider>
        <CanvasContext.Provider value={actions}>
          <Frame />
        </CanvasContext.Provider>
      </ReactFlowProvider>,
    );
    expect(screen.getAllByText("Lighting studies")).toHaveLength(1);
    expect(
      container.querySelector(".reference-frame-grip"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".reference-frame-outline rect"),
    ).toHaveAttribute("vector-effect", "non-scaling-stroke");
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Lighting studies" }),
    );
    expect(actions.collapse).toHaveBeenCalledExactlyOnceWith(frame);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit frame Lighting studies" }),
    );
    expect(actions.editFrame).toHaveBeenCalledExactlyOnceWith(frame);
    fireEvent.click(
      screen.getByRole("button", { name: "Archive frame Lighting studies" }),
    );
    expect(actions.archive).toHaveBeenCalledExactlyOnceWith("frame", "frame");
    expect(actions.resizeFrame).not.toHaveBeenCalled();
    rerender(
      <ReactFlowProvider>
        <CanvasContext.Provider value={actions}>
          <Frame value={{ ...frame, collapsed: true }} selected />
        </CanvasContext.Provider>
      </ReactFlowProvider>,
    );
    expect(
      container.querySelector(".reference-frame-outline"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand Lighting studies" }),
    ).toBeInTheDocument();
  },
);
it.each(["light", "dark"])(
  "RF02 %s overview has one live frame title, no raster duplicate, and still draws note cards",
  async (theme) => {
    camera.zoom = 0.39;
    const context = {
      resetTransform: vi.fn(),
      clearRect: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      stroke: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      globalAlpha: 1,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const note: RefItem = {
      id: "note",
      jamId: "j",
      createdBy: "human",
      updatedBy: "human",
      createdAt: "now",
      updatedAt: "now",
      archivedAt: null,
      position: 0,
      kind: "note",
      title: "Warm light",
      captionMd: "Amber snow",
      tags: [],
      x: 24,
      y: 56,
      w: 240,
      h: 180,
      z: 0,
      frameId: "frame",
      assetId: null,
      url: null,
      linkPreview: null,
      metadata: null,
    };
    render(
      <ReactFlowProvider>
        <CanvasContext.Provider value={runtime()}>
          <Frame />
          <OverviewScene
            data={{ frames: [frame], items: [note], links: [], edges: [] }}
            assets={[]}
            excluded=""
            filters=""
            highlights={{}}
            theme={theme}
            targets={[]}
          />
        </CanvasContext.Provider>
      </ReactFlowProvider>,
    );
    await waitFor(() =>
      expect(context.fillText).toHaveBeenCalledWith("Warm light", 34, 78, 220),
    );
    expect(screen.getAllByText("Lighting studies")).toHaveLength(1);
    expect(
      context.fillText.mock.calls.some((args) => args[0] === frame.title),
    ).toBe(false);
    expect(context.roundRect).toHaveBeenCalledWith(24, 56, 240, 180, 10);
  },
);
