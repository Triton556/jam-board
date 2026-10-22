import {
  getBezierPath,
  Position,
  useOnViewportChange,
  useReactFlow,
  useStore,
  ViewportPortal,
} from "@xyflow/react";
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReferenceCanvas } from "../../bindings";
import { api } from "../../lib/api";
import { decodedThumbnail } from "./Media";
import { referenceKind, worldPosition } from "./model";
import { roughPaths } from "./rough";
// At overview scale a cached raster avoids repainting hundreds of text/card layers
// on every zoom frame. Real React Flow nodes remain the interactive/accessible model.
export const OverviewScene = memo(function OverviewScene({
  data,
  assets,
  excluded,
  filters,
  highlights,
  theme,
  targets,
}: {
  data: ReferenceCanvas;
  assets: { id: string; location: string }[];
  excluded: string;
  filters: string;
  highlights: Record<string, { color: string; until: number }>;
  theme: string;
  targets: { id: string; epicId?: string; color?: string }[];
}) {
  const overview = useStore((s) => s.transform[2] < 0.4),
    flow = useReactFlow(),
    canvas = useRef<HTMLCanvasElement>(null),
    images = useRef(new Map<string, HTMLImageElement>()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useRef(() => {});
  useOnViewportChange({
    onEnd: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => load.current(), 160);
    },
  });
  const frames = useMemo(
      () => data.frames.filter((f) => !f.archivedAt),
      [data.frames],
    ),
    positions = useMemo(
      () => data.items.map((i) => worldPosition(i, data.frames)),
      [data.items, data.frames],
    ),
    left =
      Math.min(
        0,
        ...frames.map((f) => f.x ?? 0),
        ...positions.map((p) => p.x),
      ) - 32,
    top =
      Math.min(
        0,
        ...frames.map((f) => f.y ?? 0),
        ...positions.map((p) => p.y),
      ) - 40,
    right =
      Math.max(
        800,
        ...frames.map((f) => (f.x ?? 0) + (f.w ?? 0)),
        ...data.items.map((i, n) => (positions[n]?.x ?? 0) + (i.w ?? 240)),
      ) + 32,
    bottom =
      Math.max(
        600,
        ...frames.map((f) => (f.y ?? 0) + (f.h ?? 0)),
        ...data.items.map((i, n) => (positions[n]?.y ?? 0) + (i.h ?? 180)),
      ) + 32,
    scale = Math.min(0.65, 4096 / (right - left), 4096 / (bottom - top));
  useEffect(() => {
    if (!overview) return;
    let live = true;
    let paintFrame: number | undefined;
    const element = canvas.current;
    if (!element) return;
    element.dataset.theme = theme;
    const excludedIds = new Set(excluded.split(",")),
      filterIds = filters.split(",").filter(Boolean),
      style = getComputedStyle(document.documentElement);
    const color = (value: string) =>
      /^m[1-6]$/.test(value)
        ? style.getPropertyValue(`--${value}`).trim()
        : value;
    element.width = Math.ceil((right - left) * scale);
    element.height = Math.ceil((bottom - top) * scale);
    const draw = () => {
      if (!live) return;
      const c = element.getContext("2d");
      if (!c) return;
      const ink = style.getPropertyValue("--ink").trim(),
        card = style.getPropertyValue("--card").trim();
      c.resetTransform();
      c.clearRect(0, 0, element.width, element.height);
      c.scale(scale, scale);
      c.translate(-left, -top);
      c.lineWidth = 1.5;
      const lookup = new Map(data.items.map((i) => [i.id, i]));
      // Frame boundaries and titles stay live DOM at every zoom. Painting them
      // here too creates a second title and a mismatched legacy outline.
      for (const e of data.edges) {
        if (excludedIds.has(e.fromItem) || excludedIds.has(e.toItem)) continue;
        const a = lookup.get(e.fromItem),
          b = lookup.get(e.toItem);
        if (!a || !b) continue;
        const p = worldPosition(a, data.frames),
          q = worldPosition(b, data.frames),
          [path] = getBezierPath({
            sourceX: p.x + (a.w ?? 240),
            sourceY: p.y + (a.h ?? 180) / 2,
            targetX: q.x,
            targetY: q.y + (b.h ?? 180) / 2,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
          });
        c.strokeStyle = ink;
        for (const d of roughPaths(path)) c.stroke(new Path2D(d));
      }
      for (const item of data.items) {
        if (excludedIds.has(item.id)) continue;
        const frame = frames.find((f) => f.id === item.frameId);
        if (frame?.collapsed) continue;
        const p = worldPosition(item, data.frames),
          w = item.w ?? 240,
          h = item.h ?? 180,
          links = data.links.filter((l) => l.itemId === item.id),
          linked = !!frame?.epicId || links.length > 0,
          epicId =
            frame?.epicId ??
            links
              .map((l) => targets.find((t) => t.id === l.targetId)?.epicId)
              .find(Boolean),
          epicColor = targets.find((t) => t.id === epicId)?.color;
        c.globalAlpha =
          !filterIds.length ||
          filterIds.includes(epicId ?? "") ||
          links.some((l) => filterIds.includes(l.targetId)) ||
          (filterIds.includes("unlinked") && !linked)
            ? 1
            : 0.15;
        c.fillStyle = card;
        c.strokeStyle = ink;
        c.beginPath();
        c.roundRect(p.x, p.y, w, h, 10);
        c.fill();
        if (item.kind === "note") {
          c.save();
          c.globalAlpha *= 0.35;
          c.fillStyle = epicColor
            ? color(epicColor)
            : style.getPropertyValue("--butter").trim();
          c.fill();
          c.restore();
        }
        c.stroke();
        const image = images.current.get(item.id);
        if (image) {
          const ratio = Math.min(
            (w - 14) / image.naturalWidth,
            (h - 38) / image.naturalHeight,
          );
          const iw = image.naturalWidth * ratio,
            ih = image.naturalHeight * ratio;
          c.drawImage(
            image,
            p.x + (w - iw) / 2,
            p.y + 30 + (h - 38 - ih) / 2,
            iw,
            ih,
          );
        } else {
          c.fillStyle = ink;
          c.font = '22px "Caveat"';
          c.fillText(
            (item.captionMd || item.url || "")
              .replace(/[#*\n]/g, " ")
              .slice(0, 42),
            p.x + 10,
            p.y + 60,
            w - 20,
          );
        }
        c.fillStyle = ink;
        c.font = '600 16px "Manrope Variable"';
        c.fillText(item.title, p.x + 10, p.y + 22, w - 20);
        const highlight = highlights[item.id];
        if (highlight) {
          c.strokeStyle = color(highlight.color);
          c.lineWidth = 4;
          c.strokeRect(p.x - 2, p.y - 2, w + 4, h + 4);
          c.lineWidth = 1.5;
        }
        c.globalAlpha = 1;
      }
    };
    load.current = () => {
      const viewport = flow.getViewport(),
        host = document
          .querySelector(".references-page")
          ?.getBoundingClientRect();
      if (!host) return;
      for (const item of data.items) {
        if (images.current.has(item.id) || !item.assetId) continue;
        const asset = assets.find((a) => a.id === item.assetId);
        if (referenceKind(item, asset?.location) !== "image") continue;
        const p = worldPosition(item, data.frames),
          x = p.x * viewport.zoom + viewport.x,
          y = p.y * viewport.zoom + viewport.y;
        if (
          x > host.width ||
          y > host.height ||
          x + (item.w ?? 240) * viewport.zoom < 0 ||
          y + (item.h ?? 180) * viewport.zoom < 0
        )
          continue;
        void api
          .assetPreview(item.assetId)
          .then((url) => (url ? decodedThumbnail(url) : null))
          .then(async (url) => {
            if (!url || !live) return;
            const image = new Image();
            image.src = url;
            await image.decode();
            if (live) {
              images.current.set(item.id, image);
              // Many visible thumbnails can decode together. Repaint the shared
              // overview once per frame, rather than once per decoded image.
              if (paintFrame === undefined)
                paintFrame = requestAnimationFrame(() => {
                  paintFrame = undefined;
                  draw();
                });
            }
          })
          .catch(() => {});
      }
    };
    draw();
    const firstFrame = requestAnimationFrame(draw);
    load.current();
    return () => {
      live = false;
      cancelAnimationFrame(firstFrame);
      if (paintFrame !== undefined) cancelAnimationFrame(paintFrame);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [
    overview,
    data,
    assets,
    excluded,
    filters,
    highlights,
    flow,
    left,
    top,
    right,
    bottom,
    scale,
    frames,
    theme,
    targets,
  ]);
  if (!overview) return null;
  return (
    <ViewportPortal>
      <div aria-hidden="true" inert>
        <canvas
          ref={canvas}
          className="reference-overview-scene"
          style={{ left, top, width: right - left, height: bottom - top }}
        />
      </div>
    </ViewportPortal>
  );
});
