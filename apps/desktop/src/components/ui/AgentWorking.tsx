import { PencilLine } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  lazy,
  type ReactNode,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { WorkingState } from "../../lib/agent-working";
import { Tooltip } from ".";
import { ErrorBoundary } from "./ErrorBoundary";

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

const Drawing = lazy(() =>
  import("./WorkingUnderline").then((module) => ({
    default: module.Underline,
  })),
);
function Underline({ staticMotion }: { staticMotion: boolean }) {
  const fallback = (
    <svg
      className="working-underline"
      viewBox="0 0 220 6"
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
        d="M1.10515534381762 0.9301492603340251 C44.56248544825758 3.572924080381571, 89.3711472792451 5.543018466877533, 216.50449377673377 1.5255728751246458 M2.509342815230923 2.1031111318767954 C83.1829869692544 3.7463849284928328, 164.99701259140303 4.394907741222406, 218.34571805168125 3.3416669459297728"
        pathLength={100}
      />
    </svg>
  );
  return (
    <ErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Drawing staticMotion={staticMotion} />
      </Suspense>
    </ErrorBoundary>
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
      <Tooltip
        text={
          state.tooltip.includes(state.text)
            ? state.tooltip
            : `${state.text}. ${state.tooltip}`
        }
      >
        <WorkingPencil staticMotion={!!reduced} />
        <WorkingCopy
          text={state.text}
          staticMotion={!!reduced || state.mode === "quiet"}
        />
      </Tooltip>
    </div>
  );
}
export function fitWorkingText(
  text: string,
  width: number,
  measure: (text: string) => number,
) {
  if (width <= 0 || measure(text) <= width) return text;
  const words = text.trim().split(/\s+/u);
  const candidate = (count: number) =>
    `${words
      .slice(0, count)
      .join(" ")
      .replace(/[\s·,:;—–-]+$/u, "")}…`;
  let low = 0,
    high = words.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(candidate(middle)) <= width) low = middle;
    else high = middle - 1;
  }
  return candidate(low);
}
function WorkingCopy({
  text,
  staticMotion,
}: {
  text: string;
  staticMotion: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null),
    measure = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState({ source: text, value: text });
  useLayoutEffect(() => {
    let mounted = true;
    const refit = () => {
      if (!mounted || !root.current || !measure.current) return;
      const probe = measure.current;
      const value = fitWorkingText(
        text,
        root.current.clientWidth,
        (candidate) => {
          probe.textContent = candidate;
          return probe.getBoundingClientRect().width;
        },
      );
      probe.textContent = "";
      setFitted((previous) =>
        previous.source === text && previous.value === value
          ? previous
          : { source: text, value },
      );
    };
    refit();
    const observer = new ResizeObserver(refit);
    if (root.current) observer.observe(root.current);
    const fonts = document.fonts;
    void fonts?.ready.then(refit);
    fonts?.addEventListener("loadingdone", refit);
    return () => {
      mounted = false;
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", refit);
    };
  }, [text]);
  return (
    <span className="working-copy" ref={root}>
      {fitted.source === text ? fitted.value : text}
      <span className="working-measure" ref={measure} aria-hidden="true" />
      <Underline staticMotion={staticMotion} />
    </span>
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
