import type { Rect, Viewport } from "@xyflow/react";

export function frameHeaderScale(width: number, zoom: number): number {
  return Math.min(
    Math.max(1, 0.75 / Math.max(0.1, zoom)),
    Math.max(1, width / 200),
  );
}

export function frameHeaderLayout(width: number, zoom: number, linked = false) {
  const scale = frameHeaderScale(width, zoom);
  const cssWidth = width / scale;
  const compact = cssWidth < 320;
  return {
    scale,
    cssWidth,
    compact,
    height: (compact ? 84 : 46) + (linked ? 40 : 0),
  };
}

export type FitReference = Rect & {
  frame?: { collapsed: boolean; linked?: boolean };
};

/** Reserve the taller header during Fit so a zoom-dependent row switch cannot clip it. */
export function referenceFitBounds(nodes: FitReference[], zoom: number): Rect {
  const rectangles = nodes.map((node) => {
    if (!node.frame) return node;
    const header = frameHeaderLayout(node.width, zoom, node.frame.linked);
    const width = Math.max(node.width, header.cssWidth * header.scale);
    const height = (node.frame.linked ? 124 : 84) * header.scale;
    return node.frame.collapsed
      ? { ...node, width, height: Math.max(node.height, height) }
      : {
          x: node.x,
          y: node.y - height - 4,
          width,
          height: node.height + height + 4,
        };
  });
  const x = Math.min(...rectangles.map((r) => r.x));
  const y = Math.min(...rectangles.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rectangles.map((r) => r.x + r.width)) - x,
    height: Math.max(...rectangles.map((r) => r.y + r.height)) - y,
  };
}

/** Explicit Fit only. The saved camera is never changed on ordinary route entry. */
export function referenceFitViewport(
  nodes: FitReference[],
  canvas: { width: number; height: number; toolsBottom: number },
): Viewport | null {
  if (!nodes.length || canvas.width <= 0 || canvas.height <= 0) return null;
  const left = 24;
  const top = Math.max(24, canvas.toolsBottom + 24);
  const width = Math.max(1, canvas.width - left * 2);
  const height = Math.max(1, canvas.height - top - 24);
  // A constant maximum header height makes painted size monotonic in zoom.
  // This bounded search also includes the minimum screen-size header at overview.
  let low = 0.1;
  let high = 4;
  for (let i = 0; i < 24; i++) {
    const zoom = (low + high) / 2;
    const bounds = referenceFitBounds(nodes, zoom);
    if (bounds.width * zoom <= width && bounds.height * zoom <= height)
      low = zoom;
    else high = zoom;
  }
  const bounds = referenceFitBounds(nodes, low);
  return {
    x: left + Math.max(0, (width - bounds.width * low) / 2) - bounds.x * low,
    y: top + Math.max(0, (height - bounds.height * low) / 2) - bounds.y * low,
    zoom: low,
  };
}
