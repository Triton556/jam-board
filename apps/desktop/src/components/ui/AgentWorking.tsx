import { PencilLine } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import rough from "roughjs";
import type { WorkingState } from "../../lib/agent-working";
import { Tooltip } from ".";

let visibility: IntersectionObserver | undefined;
const watched = new Set<Element>();
export function watchWorkingVisibility(node: HTMLElement | null) {
  if (!node || typeof IntersectionObserver === "undefined") return;
  visibility ??= new IntersectionObserver((entries) => {
    for (const entry of entries)
      (entry.target as HTMLElement).dataset.workingVisible = String(
        entry.isIntersecting,
      );
  });
  node.dataset.workingVisible = "false";
  watched.add(node);
  visibility.observe(node);
  return () => {
    visibility?.unobserve(node);
    watched.delete(node);
    if (!watched.size) {
      visibility?.disconnect();
      visibility = undefined;
    }
  };
}

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
function Underline({ staticMotion }: { staticMotion: boolean }) {
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

function paint(state: NonNullable<WorkingState>): CSSProperties {
  return { "--working-color": state.color } as CSSProperties;
}
export function WorkingRing({
  state,
  children,
  compact = false,
  layered = false,
}: {
  state: WorkingState;
  children: ReactNode;
  compact?: boolean;
  layered?: boolean;
}) {
  const reduced = useReducedMotion();
  if (!state) return children;
  return (
    <span
      className={`working-avatar ${state.mode} ${compact ? "compact" : ""}`}
      style={paint(state)}
      title={state.tooltip}
      data-testid="working-avatar"
    >
      {children}
      <span
        className={`working-ring ${layered ? "table-ring-anchor" : "working-animated"}`}
        style={reduced || layered ? { animation: "none" } : undefined}
        aria-hidden="true"
      >
        {!layered && (
          <svg
            className="working-ring-art"
            viewBox={compact ? "0 0 16 16" : "0 0 34 34"}
            aria-hidden="true"
          >
            <circle
              cx={compact ? 8 : 17}
              cy={compact ? 8 : 17}
              r={compact ? 7 : 15}
            />
          </svg>
        )}
      </span>
    </span>
  );
}
export function WorkingPencil({
  staticMotion = false,
  label,
}: {
  staticMotion?: boolean;
  label?: string;
}) {
  return (
    <span
      className="working-pencil working-animated"
      style={
        staticMotion ? { animation: "none", willChange: "auto" } : undefined
      }
      role="img"
      aria-hidden={!label}
      aria-label={label ?? "Working"}
    >
      <PencilLine size={14} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
export function WorkingLine({ state }: { state: WorkingState }) {
  const reduced = useReducedMotion();
  if (!state) return null;
  return (
    <div
      className={`working-line ${state.mode}`}
      style={paint(state)}
      data-testid="working-line"
      data-mode={state.mode}
    >
      <Tooltip text={state.tooltip}>
        <WorkingPencil staticMotion={!!reduced} />
        <span className="working-copy">
          {state.text}
          <Underline staticMotion={!!reduced || state.mode === "quiet"} />
        </span>
      </Tooltip>
    </div>
  );
}
export function WorkingPill({ state }: { state: WorkingState }) {
  const reduced = useReducedMotion();
  if (!state) return null;
  return (
    <span
      ref={watchWorkingVisibility}
      className={`working-pill ${state.mode}`}
      style={paint(state)}
      title={state.tooltip}
      data-testid="working-pill"
      data-mode={state.mode}
    >
      <WorkingPencil staticMotion={!!reduced} />
      <span>
        {state.mode === "quiet"
          ? state.text
          : `${state.name} is working · ${state.status}`}
      </span>
    </span>
  );
}
