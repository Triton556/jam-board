// RF02: behavioral DOM/drawing calls only; native geometry and visual hierarchy are separate gates.
import { readFileSync } from "node:fs";
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
  useStoreApi: () => ({ getState: () => ({ transform: [0, 0, camera.zoom] }) }),
  ViewportPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  useOnViewportChange: () => {},
}));
afterEach(() => {
  vi.restoreAllMocks();
  camera.zoom = 1;
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
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
it.each(
  [280, 320, 880].flatMap((width) =>
    [0.2, 0.4, 1].map((zoom) => [width, zoom]),
  ),
)(
  "RF02 %spx frame at zoom %s keeps screen targets, title and bounded header with reachable actions",
  (width, zoom) => {
    camera.zoom = zoom;
    const actions = runtime();
    const value = { ...frame, w: width };
    const { container } = render(
      <ReactFlowProvider>
        <style>
          {readFileSync("src/features/references/references.css", "utf8")}
        </style>
        <CanvasContext.Provider value={actions}>
          <Frame value={value} />
        </CanvasContext.Provider>
      </ReactFlowProvider>,
    );
    const header = container.querySelector<HTMLElement>(".reference-frame-tab");
    if (!header) throw Error("Missing frame header");
    const scale = Number(header.style.transform.match(/[\d.]+/)?.[0]);
    expect(Number.parseFloat(header.style.width) * scale).toBeCloseTo(width);
    expect(container.querySelector(".reference-frame-title")).toHaveTextContent(
      value.title,
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".reference-frame-actions .tooltip-wrap > button",
    );
    for (const button of buttons) {
      const style = getComputedStyle(button);
      expect(
        Number.parseFloat(style.minWidth) * scale * zoom,
      ).toBeGreaterThanOrEqual(24);
      expect(
        Number.parseFloat(style.minHeight) * scale * zoom,
      ).toBeGreaterThanOrEqual(24);
    }
    const more = screen.queryByRole("button", {
      name: `Frame actions for ${value.title}`,
    });
    expect(buttons).toHaveLength(width * zoom < 120 ? 1 : 4);
    if (more) {
      expect(
        screen.queryByRole("button", { name: `Archive frame ${value.title}` }),
      ).toBeNull();
      for (const name of [
        `Collapse ${value.title}`,
        `Edit frame ${value.title}`,
        `Archive frame ${value.title}`,
      ]) {
        fireEvent.click(more);
        const command = screen.getByRole("menuitem", { name });
        expect(
          Number.parseFloat(getComputedStyle(command).minHeight),
        ).toBeGreaterThanOrEqual(24);
        fireEvent.click(command);
        expect(screen.queryByRole("menu")).toBeNull();
        expect(more).toHaveFocus();
      }
      expect(actions.collapse).toHaveBeenCalledExactlyOnceWith(value);
      expect(actions.editFrame).toHaveBeenCalledExactlyOnceWith(value);
      expect(actions.archive).toHaveBeenCalledExactlyOnceWith(
        "frame",
        value.id,
      );
    }
  },
);
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
it.each([
  ["light", 1, null],
  ["dark", 1, null],
  ["light", 2, null],
  ["dark", 2, null],
  ["light", 1, "keep"],
  ["dark", 2, "reject"],
] as const)(
  "RF02 %s DPR %s verdict %s overview has one live frame title and puts feedback beside the card title",
  async (theme, dpr, verdict) => {
    camera.zoom = 0.39;
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: dpr,
    });
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
      verdict,
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
      expect(context.fillText).toHaveBeenCalledWith(
        "Warm light",
        34,
        78,
        verdict === "reject" ? 156 : verdict ? 196 : 220,
      ),
    );
    expect(screen.getAllByText("Lighting studies")).toHaveLength(1);
    expect(
      context.fillText.mock.calls.some((args) => args[0] === frame.title),
    ).toBe(false);
    expect(context.roundRect).toHaveBeenCalledWith(24, 56, 240, 180, 10);
    if (verdict)
      expect(context.fillText).toHaveBeenCalledWith(
        verdict === "keep" ? "✓" : "Not this",
        verdict === "keep" ? 240 : 200,
        78,
        verdict === "keep" ? 16 : 56,
      );
    expect(context.scale).toHaveBeenCalledWith(0.65 * dpr, 0.65 * dpr);
    const raster = document.querySelector("canvas.reference-overview-scene");
    expect(raster).toHaveAttribute(
      "width",
      String(Math.ceil(864 * 0.65 * dpr)),
    );
  },
);

it("RF02 native-sized narrow frame keeps title above controls and collapsed bounds reserve both rows", () => {
  camera.zoom = 0.49;
  const value = { ...frame, title: "Agent inbox", w: 320, h: 1200 };
  const { container, rerender } = render(
    <ReactFlowProvider>
      <CanvasContext.Provider value={runtime()}>
        <Frame value={value} />
      </CanvasContext.Provider>
    </ReactFlowProvider>,
  );
  const header = container.querySelector<HTMLElement>(".reference-frame-tab");
  expect(header).toHaveClass("compact");
  expect(header?.firstElementChild).toHaveClass("reference-frame-heading");
  expect(header?.firstElementChild).toHaveTextContent("Agent inbox");
  expect(header?.lastElementChild).toHaveClass("reference-frame-actions");
  expect(
    screen.getByRole("button", { name: "Edit frame Agent inbox" }),
  ).toBeVisible();
  rerender(
    <ReactFlowProvider>
      <CanvasContext.Provider value={runtime()}>
        <Frame value={{ ...value, collapsed: true }} />
      </CanvasContext.Provider>
    </ReactFlowProvider>,
  );
  const root = container.querySelector<HTMLElement>(".reference-frame");
  expect(Number.parseFloat(root?.style.minHeight ?? "0")).toBeCloseTo(
    84 * (0.75 / 0.49),
  );
  expect(container.querySelector(".reference-frame-outline")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Expand Agent inbox" }),
  ).toBeVisible();
});
