import { useEffect, useRef, useState } from "react";
import rough from "roughjs";

const generator = rough.generator();
const lines = new Map<number, string>();
export function workingUnderline(width: number) {
  const w = Math.max(8, Math.round(width));
  let path = lines.get(w);
  if (!path) {
    path = generator
      .toPaths(
        generator.line(2, 3, w - 2, 3, {
          seed: 27,
          roughness: 1.2,
          bowing: 1,
          strokeWidth: 1.3,
        }),
      )
      .map((p) => p.d)
      .join(" ");
    if (lines.size > 256) lines.clear();
    lines.set(w, path);
  }
  return path;
}
const resizing = new Map<Element, (width: number) => void>();
let sizes: ResizeObserver | undefined;
export function Underline({ staticMotion }: { staticMotion: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(220);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    sizes ??= new ResizeObserver((entries) => {
      for (const entry of entries)
        resizing.get(entry.target)?.(Math.round(entry.contentRect.width));
    });
    resizing.set(node, (w) => setWidth(Math.max(8, w)));
    sizes.observe(node);
    return () => {
      sizes?.unobserve(node);
      resizing.delete(node);
      if (!resizing.size) {
        sizes?.disconnect();
        sizes = undefined;
      }
    };
  }, []);
  return (
    <svg
      ref={ref}
      className="working-underline"
      viewBox={`0 0 ${width} 6`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        className="working-animated"
        style={
          staticMotion
            ? { animation: "none", strokeDashoffset: 0, opacity: 1 }
            : undefined
        }
        d={workingUnderline(width)}
        pathLength={100}
      />
    </svg>
  );
}
