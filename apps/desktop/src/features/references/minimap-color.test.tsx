import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import {
  MiniMap,
  type Node,
  ReactFlowProvider,
  useStoreApi,
} from "@xyflow/react";
import { expect, it } from "vitest";
import { referenceMiniMapColor } from "./minimap-color";

it.each([
  ["light", ["transparent", "#f8e3a3", "#f4c6cf", "#dcd3f2"]],
  ["dark", ["transparent", "#6e5d2e", "#6e4450", "#4e4670"]],
])(
  "standard minimap computed fills retain frame/note/image/link colours in %s",
  (theme, expected) => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent =
      readFileSync("node_modules/@xyflow/react/dist/style.css", "utf8") +
      readFileSync("src/styles/tokens.css", "utf8").replace(
        '@import "tailwindcss";',
        "",
      );
    document.head.append(stylesheet);
    let store!: ReturnType<typeof useStoreApi>;
    function Capture() {
      store = useStoreApi();
      return null;
    }
    try {
      const { container } = render(
        <div className={`react-flow ${theme}`} data-theme={theme}>
          <ReactFlowProvider initialWidth={1000} initialHeight={600}>
            <Capture />
            <MiniMap pannable zoomable nodeColor={referenceMiniMapColor} />
          </ReactFlowProvider>
        </div>,
      );
      const nodes: Node[] = [
        {
          id: "frame",
          type: "frame",
          data: {},
          position: { x: 100, y: 200 },
          width: 800,
          height: 600,
        },
        {
          id: "note",
          type: "reference",
          data: { item: { kind: "note" } },
          parentId: "frame",
          position: { x: 20, y: 30 },
          width: 240,
          height: 180,
        },
        {
          id: "image",
          type: "reference",
          data: { item: { kind: "asset" }, path: "reference.png" },
          position: { x: 6000, y: 0 },
          width: 240,
          height: 180,
        },
        {
          id: "link",
          type: "reference",
          data: { item: { kind: "link" } },
          position: { x: 7000, y: 0 },
          width: 240,
          height: 180,
        },
      ];
      act(() => store.getState().setNodes(nodes));
      const rectangles = [
        ...container.querySelectorAll(".react-flow__minimap-node"),
      ];
      expect(rectangles).toHaveLength(4);
      expect(rectangles.map((rect) => getComputedStyle(rect).fill)).toEqual(
        expected,
      );
      act(() => store.setState({ transform: [-5000, 20, 0.199] }));
      expect(
        [...container.querySelectorAll(".react-flow__minimap-node")].map(
          (rect) => getComputedStyle(rect).fill,
        ),
      ).toEqual(expected);
    } finally {
      stylesheet.remove();
    }
  },
);
