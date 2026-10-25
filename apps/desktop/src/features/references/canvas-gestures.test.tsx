// Event-handler integration with a mocked ReactFlow surface; real pointer QA is separate.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { tauriApi } from "../../lib/tauri-bridge";
import { canvasPick } from "./linking";
import type { FrameNode, ItemNode } from "./Nodes";
import { ReferencesPage } from "./ReferencesPage";
import { VerdictToolbar } from "./VerdictToolbar";

type CanvasNode = FrameNode | ItemNode;
type FlowProps = ComponentProps<
  typeof import("@xyflow/react").ReactFlow<CanvasNode>
>;
const surface = vi.hoisted(() => ({
  props: null as FlowProps | null,
  navigate: vi.fn(),
}));
const nativeDrop = vi.hoisted(() => ({
  callback: null as
    | null
    | ((event: {
        payload: {
          type: "drop";
          paths: string[];
          position: { x: number; y: number };
        };
      }) => void),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (
      callback: NonNullable<typeof nativeDrop.callback>,
    ) => {
      nativeDrop.callback = callback;
      return () => {};
    },
  }),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => surface.navigate,
  useRouterState: () => undefined,
  useBlocker: () => ({}),
}));
vi.mock("./OverviewScene", () => ({ OverviewScene: () => null }));
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  ReactFlow: (props: FlowProps) => {
    surface.props = props;
    return (
      <div className="react-flow__pane">
        {props.nodes?.map((node) => (
          <div key={node.id} className="react-flow__node" data-id={node.id}>
            <span>{node.id}</span>
            <button type="button">Control {node.id}</button>
            {node.type === "reference" && (
              <VerdictToolbar item={node.data.item} />
            )}
          </div>
        ))}
        {props.children as ReactNode}
      </div>
    );
  },
  Background: () => null,
  MiniMap: () => null,
  useReactFlow: () => flow,
}));
const flow = {
  getNodes: () => surface.props?.nodes ?? [],
  getNode: (id: string) => surface.props?.nodes?.find((node) => node.id === id),
  getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  screenToFlowPosition: (point: { x: number; y: number }) => point,
  getZoom: () => 1,
  fitView: async () => true,
  setViewport: async () => true,
};
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
  canvasPick.set(null);
  surface.navigate.mockClear();
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => []),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  nativeDrop.callback = null;
  document.querySelectorAll("[data-native-drop-test]").forEach((element) => {
    element.remove();
  });
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
});
async function mount(picking = false) {
  const app = await mockApi.appState();
  const frame = await mockApi.createRefFrame({
    title: "Moodboard",
    x: 400,
    y: 0,
  });
  const item = await mockApi.addReference({
    kind: "note",
    title: "Candidate",
    text: "Candidate",
    x: 40,
    y: 80,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], app);
  if (picking)
    canvasPick.set({
      projectId: app.jam?.id ?? "",
      targetKey: "JB-1",
      returnTo: "/board?task=JB-1",
    });
  render(
    <QueryClientProvider client={client}>
      <ReferencesPage />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(surface.props?.nodes?.some((node) => node.id === item.id)).toBe(
      true,
    ),
  );
  return { frame, item, client };
}
function props() {
  if (!surface.props) throw Error("Missing flow");
  return surface.props;
}
function node(id: string) {
  const row = props().nodes?.find((value) => value.id === id);
  if (!row) throw Error("Missing node");
  return row;
}
function body(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-id="${id}"] span`);
  if (!element) throw Error("Missing body");
  return element;
}
function dragStart(id: string) {
  fireEvent.pointerDown(body(id), { button: 0, clientX: 40, clientY: 80 });
  act(() =>
    props().onNodeDragStart?.(new MouseEvent("mousedown"), node(id), [
      node(id),
    ]),
  );
}
it.each([1, 2])(
  "native file drops exclude dock and composer bounds at DPR %s without changing canvas imports",
  async (dpr) => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: dpr,
    });
    vi.spyOn(mockApi, "onFileDrop").mockImplementation(tauriApi.onFileDrop);
    await mount();
    await waitFor(() => expect(nativeDrop.callback).not.toBeNull());
    const importFile = vi.spyOn(mockApi, "addReference");
    const hosts = [
      {
        attribute: "id",
        value: "brain-dock",
        x: 900,
        y: 50,
        width: 300,
        height: 700,
      },
      {
        attribute: "data-board-ref-drop",
        value: "brain-composer",
        x: 300,
        y: 200,
        width: 200,
        height: 150,
      },
      {
        attribute: "data-brain-dock",
        value: "",
        x: 600,
        y: 50,
        width: 200,
        height: 500,
      },
    ];
    for (const host of hosts) {
      const element = document.createElement("aside");
      element.setAttribute(host.attribute, host.value);
      element.dataset.nativeDropTest = "";
      document.body.append(element);
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect(host),
      );
    }
    const drop = async (x: number, y: number) => {
      await act(async () =>
        nativeDrop.callback?.({
          payload: {
            type: "drop",
            paths: ["C:/mock/drop.png"],
            position: { x: x * dpr, y: y * dpr },
          },
        }),
      );
    };
    await drop(1000, 400);
    await drop(400, 250);
    await drop(700, 300);
    expect(importFile).not.toHaveBeenCalled();
    await drop(100, 120);
    await waitFor(() => expect(importFile).toHaveBeenCalledTimes(1));
    expect(importFile).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "asset",
        filePath: "C:/mock/drop.png",
        x: 100,
        y: 120,
      }),
    );
  },
);
it.each(["item", "frame"] as const)(
  "Link to is a ghost button with an empty-selection tooltip and enables for a selected %s",
  async (kind) => {
    const f = await mount();
    const toolbar = screen.getByRole("toolbar", { name: "Canvas tools" });
    const button = within(toolbar).getByRole("button", { name: "Link to…" });
    expect(button).toHaveClass("ghost");
    expect(button.querySelector(".lucide-link-2")).not.toBeNull();
    expect(button).toBeDisabled();
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Select items or a frame",
    );
    fireEvent.mouseLeave(button.parentElement as HTMLElement);
    const id = kind === "item" ? f.item.id : f.frame.id;
    act(() =>
      props().onNodesChange?.([{ type: "select", id, selected: true }]),
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Link to work" });
    expect(
      within(dialog).getByRole("button", { name: "Link 1" }),
    ).toBeDisabled();
  },
);
it("adds the viewport gesture class and releases it 150 ms after the final move", async () => {
  await mount();
  vi.useFakeTimers();
  const canvas = screen.getByRole("region", { name: "References canvas" });
  expect(canvas).not.toHaveClass("reference-viewport-moving");
  act(() => props().onMoveStart?.(null, { x: 0, y: 0, zoom: 2 }));
  expect(canvas).toHaveClass("reference-viewport-moving");
  act(() => props().onMoveEnd?.(null, { x: 0, y: 0, zoom: 2 }));
  act(() => vi.advanceTimersByTime(149));
  expect(canvas).toHaveClass("reference-viewport-moving");
  act(() => props().onMoveStart?.(null, { x: 10, y: 0, zoom: 4 }));
  act(() => vi.advanceTimersByTime(151));
  expect(canvas).toHaveClass("reference-viewport-moving");
  act(() => props().onMoveEnd?.(null, { x: 10, y: 0, zoom: 4 }));
  act(() => vi.advanceTimersByTime(150));
  expect(canvas).not.toHaveClass("reference-viewport-moving");
  act(() => props().onMoveStart?.(null, { x: 0, y: 0, zoom: 1 }));
  fireEvent.blur(window);
  act(() => vi.advanceTimersByTime(150));
  expect(canvas).not.toHaveClass("reference-viewport-moving");
});
it("item bodies and empty frame backgrounds use whole-node dragging with a four-pixel threshold", async () => {
  const f = await mount();
  expect(props().nodeDragThreshold).toBe(4);
  expect(node(f.frame.id).dragHandle).toBeUndefined();
  dragStart(f.item.id);
  const moved = { ...node(f.item.id), position: { x: 72, y: 96 } };
  act(() =>
    props().onNodeDragStop?.(new MouseEvent("mouseup"), moved, [moved]),
  );
  await waitFor(() =>
    expect(
      mockApi.calls.some((call) => call.command === "canvas_geometry"),
    ).toBe(true),
  );
});
it("inner controls stop mouse propagation while ordinary bodies remain draggable", async () => {
  const f = await mount();
  const parent = body(f.item.id).parentElement;
  if (!parent) throw Error("No parent");
  const receive = vi.fn();
  parent.addEventListener("mousedown", receive);
  fireEvent.mouseDown(body(f.item.id));
  expect(receive).toHaveBeenCalledOnce();
  const control = parent.querySelector("button");
  if (!control) throw Error("Missing control");
  fireEvent.mouseDown(control);
  expect(receive).toHaveBeenCalledOnce();
});
it("Escape restores drag origin and suppresses geometry writes and drop events", async () => {
  const f = await mount();
  const start = node(f.item.id).position;
  const receive = vi.fn();
  window.addEventListener("jam:board-ref-drop", receive, { once: true });
  dragStart(f.item.id);
  act(() =>
    props().onNodesChange?.([
      {
        type: "position",
        id: f.item.id,
        position: { x: 240, y: 280 },
        dragging: true,
      },
    ]),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  act(() =>
    props().onNodeDragStop?.(
      new MouseEvent("mouseup"),
      { ...node(f.item.id), position: { x: 240, y: 280 } },
      [node(f.item.id)],
    ),
  );
  expect(node(f.item.id).position).toEqual(start);
  expect(mockApi.calls.some((call) => call.command === "canvas_geometry")).toBe(
    false,
  );
  expect(receive).not.toHaveBeenCalled();
  window.removeEventListener("jam:board-ref-drop", receive);
});
it("dropping over a board-ref target highlights it, restores positions and emits frame URI", async () => {
  const f = await mount();
  const target = document.createElement("div");
  target.dataset.boardRefDrop = "brain-composer";
  document.body.append(target);
  vi.spyOn(document, "elementsFromPoint").mockReturnValue([target]);
  const receive = vi.fn();
  window.addEventListener("jam:board-ref-drop", receive, { once: true });
  const start = node(f.frame.id).position;
  dragStart(f.frame.id);
  act(() =>
    props().onNodeDrag?.(
      new MouseEvent("mousemove", { clientX: 900, clientY: 200 }),
      node(f.frame.id),
      [node(f.frame.id)],
    ),
  );
  expect(target).toHaveClass("board-ref-drag-over");
  expect(document.querySelector(".reference-drag-preview")).toHaveTextContent(
    "Moodboard",
  );
  act(() =>
    props().onNodesChange?.([
      {
        type: "position",
        id: f.frame.id,
        position: { x: 800, y: 200 },
        dragging: true,
      },
    ]),
  );
  act(() =>
    props().onNodeDragStop?.(
      new MouseEvent("mouseup", { clientX: 900, clientY: 200 }),
      node(f.frame.id),
      [node(f.frame.id)],
    ),
  );
  expect(node(f.frame.id).position).toEqual(start);
  expect(receive.mock.calls[0]?.[0].detail).toEqual({
    target: "brain-composer",
    refs: [
      {
        uri: `jam://frame/${f.frame.id}`,
        label: "Moodboard",
        text: "Moodboard",
      },
    ],
  });
  expect(target).not.toHaveClass("board-ref-drag-over");
  expect(document.querySelector(".reference-drag-preview")).toBeNull();
  expect(
    mockApi.calls.some((call) => call.command === "update_ref_frame"),
  ).toBe(false);
  target.remove();
});
it.each(["item", "frame"] as const)(
  "%s drag preview appears over an overlapping drawer, follows the pointer, hides on canvas and clears on Escape",
  async (kind) => {
    const f = await mount();
    const canvas = screen.getByRole("region", { name: "References canvas" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 }),
    );
    const drawer = document.createElement("div");
    drawer.className = "drawer";
    drawer.dataset.nativeDropTest = "";
    document.body.append(drawer);
    vi.spyOn(document, "elementsFromPoint").mockImplementation((x) => [
      x >= 600 ? drawer : canvas,
    ]);
    const id = kind === "frame" ? f.frame.id : f.item.id;
    const move = (x: number, y: number) =>
      act(() =>
        props().onNodeDrag?.(
          new MouseEvent("mousemove", { clientX: x, clientY: y }),
          node(id),
          [node(id)],
        ),
      );
    dragStart(id);
    move(100, 200);
    expect(document.querySelector(".reference-drag-preview")).toBeNull();
    move(700, 220);
    const preview = document.querySelector(
      ".reference-drag-preview",
    ) as HTMLElement;
    expect(preview).toBeVisible();
    expect(preview.parentElement).toBe(document.body);
    expect(preview).toHaveTextContent(
      kind === "frame" ? "Moodboard" : "Candidate",
    );
    expect(
      preview.querySelector(
        kind === "frame" ? ".lucide-frame" : ".lucide-sticky-note",
      ),
    ).not.toBeNull();
    const left = preview.style.left;
    move(720, 240);
    expect(preview.style.left).not.toBe(left);
    move(500, 220);
    expect(document.querySelector(".reference-drag-preview")).toBeNull();
    move(900, 220);
    expect(document.querySelector(".reference-drag-preview")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".reference-drag-preview")).toBeNull();
    move(700, 220);
    expect(document.querySelector(".reference-drag-preview")).toBeNull();
  },
);
it("Shift+click adds a frame; Shift+drag over its background draws a marquee", async () => {
  const f = await mount();
  act(() =>
    props().onNodesChange?.([
      { type: "select", id: f.item.id, selected: true },
    ]),
  );
  fireEvent.pointerDown(body(f.frame.id), {
    button: 0,
    shiftKey: true,
    clientX: 400,
    clientY: 20,
  });
  fireEvent.pointerUp(window, { clientX: 401, clientY: 21 });
  expect(node(f.item.id).selected).toBe(true);
  expect(node(f.frame.id).selected).toBe(true);
  fireEvent.pointerDown(body(f.frame.id), {
    button: 0,
    shiftKey: true,
    clientX: 400,
    clientY: 20,
  });
  fireEvent.pointerMove(window, { clientX: 1000, clientY: 500 });
  expect(document.querySelector(".reference-marquee")).toBeInTheDocument();
  fireEvent.pointerUp(window, { clientX: 1000, clientY: 500 });
  expect(document.querySelector(".reference-marquee")).toBeNull();
  expect(mockApi.calls.some((call) => call.command === "canvas_geometry")).toBe(
    false,
  );
});
it("pick mode Cancel returns to its drawer and makes no link writes", async () => {
  await mount(true);
  expect(
    screen.getByRole("region", { name: "Pick references" }),
  ).toHaveTextContent("Select items or a frame to link to JB-1");
  expect(screen.getByRole("button", { name: "Link 0" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(canvasPick.get()).toBeNull();
  expect(surface.navigate).toHaveBeenCalledWith({ href: "/board?task=JB-1" });
  expect(
    mockApi.calls.some((call) =>
      ["link_reference", "link_ref_frame"].includes(call.command),
    ),
  ).toBe(false);
});
it("pick mode links the selected frame and returns to the exact drawer URL", async () => {
  const f = await mount(true);
  act(() =>
    props().onNodesChange?.([
      { type: "select", id: f.frame.id, selected: true },
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Link 1" }));
  await waitFor(() =>
    expect(surface.navigate).toHaveBeenCalledWith({ href: "/board?task=JB-1" }),
  );
  expect(canvasPick.get()).toBeNull();
  expect(mockApi.calls.some((call) => call.command === "link_ref_frame")).toBe(
    true,
  );
});
it("Shift body/title click is handled once and does not reach ReactFlow's second selection toggle", async () => {
  const f = await mount();
  act(() =>
    props().onNodesChange?.([
      { type: "select", id: f.item.id, selected: true },
    ]),
  );
  const title = body(f.frame.id),
    nativeClick = vi.fn();
  title.addEventListener("click", nativeClick);
  fireEvent.pointerDown(title, {
    button: 0,
    shiftKey: true,
    clientX: 450,
    clientY: 30,
  });
  fireEvent.pointerUp(window, { shiftKey: true, clientX: 450, clientY: 30 });
  fireEvent.click(title, { shiftKey: true });
  expect(node(f.item.id).selected).toBe(true);
  expect(node(f.frame.id).selected).toBe(true);
  expect(nativeClick).not.toHaveBeenCalled();
});
it.each(["move", "delete", "verdict", "link"] as const)(
  "one Undo and Redo cover the complete two-item %s action",
  async (kind) => {
    const f = await mount();
    const second = await mockApi.addReference({
      kind: "note",
      title: "Second",
      text: "Second",
      x: 100,
      y: 300,
    });
    await f.client.invalidateQueries({ queryKey: ["references"] });
    await waitFor(() =>
      expect(props().nodes?.some((row) => row.id === second.id)).toBe(true),
    );
    act(() =>
      props().onNodesChange?.(
        [f.item.id, second.id].map((id) => ({
          type: "select" as const,
          id,
          selected: true,
        })),
      ),
    );
    const ids = [f.item.id, second.id];
    if (kind === "move") {
      dragStart(f.item.id);
      const moved = ids.map((id) => ({
        ...node(id),
        position: { x: node(id).position.x + 32, y: node(id).position.y + 24 },
      }));
      const primary = moved[0];
      if (!primary) throw Error("Missing moved item");
      act(() =>
        props().onNodeDragStop?.(new MouseEvent("mouseup"), primary, moved),
      );
    } else if (kind === "delete") {
      fireEvent.keyDown(body(f.item.id).parentElement as HTMLElement, {
        key: "Delete",
      });
    } else if (kind === "verdict") {
      const row = document.querySelector(
        `[data-id="${f.item.id}"]`,
      ) as HTMLElement;
      await userEvent.click(within(row).getByRole("button", { name: "Keep" }));
    } else {
      await userEvent.click(screen.getByRole("button", { name: "Link to…" }));
      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByRole("option", { name: /^JB-1 ·/ }));
      await userEvent.click(screen.getByRole("button", { name: "Link 2" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    const check = async (changed: boolean) => {
      const data = await mockApi.referenceCanvas();
      const rows = ids.map((id) => data.items.find((item) => item.id === id));
      if (kind === "move")
        expect(rows.map((item) => [item?.x, item?.y])).toEqual(
          changed
            ? [
                [72, 104],
                [132, 324],
              ]
            : [
                [40, 80],
                [100, 300],
              ],
        );
      if (kind === "delete")
        expect(rows.map((item) => !item || !!item.archivedAt)).toEqual([
          changed,
          changed,
        ]);
      if (kind === "verdict")
        expect(rows.map((item) => item?.verdict ?? null)).toEqual(
          changed ? ["keep", "keep"] : [null, null],
        );
      if (kind === "link")
        expect(
          ids.map((id) =>
            data.links.some((link) => link.itemId === id && !link.archivedAt),
          ),
        ).toEqual([changed, changed]);
    };
    await waitFor(() => check(true));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => check(false));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => check(true));
  },
);
it("a failed second group move compensates the first and restores both visible nodes", async () => {
  const f = await mount();
  const second = await mockApi.addReference({
    kind: "note",
    title: "Second",
    text: "Second",
    x: 100,
    y: 300,
  });
  await f.client.invalidateQueries({ queryKey: ["references"] });
  await waitFor(() =>
    expect(props().nodes?.some((row) => row.id === second.id)).toBe(true),
  );
  const original = mockApi.canvasGeometry.bind(mockApi);
  const write = vi
    .spyOn(mockApi, "canvasGeometry")
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(Error("Second move failed"));
  dragStart(f.item.id);
  const a = { ...node(f.item.id), position: { x: 72, y: 104 } },
    b = { ...node(second.id), position: { x: 132, y: 324 } };
  act(() => props().onNodeDragStop?.(new MouseEvent("mouseup"), a, [a, b]));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect([node(f.item.id).position, node(second.id).position]).toEqual([
      { x: 40, y: 80 },
      { x: 100, y: 300 },
    ]),
  );
  const data = await mockApi.referenceCanvas();
  expect(
    [f.item.id, second.id].map((id) => {
      const row = data.items.find((row) => row.id === id);
      return [row?.x, row?.y];
    }),
  ).toEqual([
    [40, 80],
    [100, 300],
  ]);
});
