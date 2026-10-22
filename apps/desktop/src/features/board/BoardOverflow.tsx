import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui";

/** Preserve readable columns; make their overflow discoverable without borrowing drag keys. */
export function BoardOverflow({ children }: { children: ReactNode }) {
  const scroll = useRef<HTMLElement>(null),
    hint = useId();
  const [bounds, setBounds] = useState({ left: 0, max: 0 });
  const measure = useCallback(() => {
    const node = scroll.current;
    if (!node) return;
    const max = Math.max(0, node.scrollWidth - node.clientWidth);
    const left = Math.max(0, Math.min(max, node.scrollLeft));
    setBounds((previous) =>
      previous.left === left && previous.max === max ? previous : { left, max },
    );
  }, []);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    node.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  const move = (target: "left" | "right" | "first" | "last") => {
    const node = scroll.current;
    if (!node) return;
    const max = Math.max(0, node.scrollWidth - node.clientWidth),
      step = Math.max(232, node.clientWidth * 0.8);
    const left =
      target === "first"
        ? 0
        : target === "last"
          ? max
          : node.scrollLeft + (target === "right" ? step : -step);
    // Always immediate: no motion preference or CSS smooth-scroll can hide the destination.
    node.scrollTo({
      left: Math.max(0, Math.min(max, left)),
      behavior: "instant",
    });
    measure();
  };
  const overflow = bounds.max > 1,
    canLeft = bounds.left > 1,
    canRight = bounds.max - bounds.left > 1;
  return (
    <>
      {overflow && (
        <div className="board-overflow-controls">
          <span id={hint}>
            More columns{" "}
            {canLeft && canRight
              ? "on both sides"
              : canRight
                ? "to the right"
                : "to the left"}
            . Scroll across, or focus the board and use Left/Right or Home/End.
          </span>
          <div className="button-row">
            <Button
              aria-label="Scroll board left"
              disabled={!canLeft}
              onClick={() => move("left")}
            >
              <ChevronLeft size={15} /> Left
            </Button>
            <Button
              aria-label="Scroll board right"
              disabled={!canRight}
              onClick={() => move("right")}
            >
              Right <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}
      <section
        ref={scroll}
        className="board-scroll"
        aria-label="Board columns"
        aria-describedby={overflow ? hint : undefined}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Named scroll region needs a keyboard entry point; descendant drag/open keys are preserved.
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          const target = (
            {
              ArrowLeft: "left",
              ArrowRight: "right",
              Home: "first",
              End: "last",
            } as const
          )[event.key as "ArrowLeft" | "ArrowRight" | "Home" | "End"];
          if (target) {
            event.preventDefault();
            move(target);
          }
        }}
      >
        {children}
      </section>
    </>
  );
}
