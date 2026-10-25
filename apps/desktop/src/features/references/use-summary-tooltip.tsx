import { type RefObject, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/** Keep SUMMARY a direct child of DETAILS while providing the shared tooltip behavior. */
export function useSummaryTooltip(
  summary: RefObject<HTMLElement | null>,
  open: boolean,
  text: string,
) {
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    setPosition(null);
    const element = summary.current;
    if (!element || open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      setPosition(null);
    };
    const show = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const rect = element.getBoundingClientRect();
        setPosition({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
          top:
            rect.bottom + 40 < window.innerHeight
              ? rect.bottom + 8
              : Math.max(8, rect.top - 40),
        });
      }, 500);
    };
    element.addEventListener("focus", show);
    element.addEventListener("mouseenter", show);
    element.addEventListener("blur", hide);
    element.addEventListener("mouseleave", hide);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("focus", show);
      element.removeEventListener("mouseenter", show);
      element.removeEventListener("blur", hide);
      element.removeEventListener("mouseleave", hide);
    };
  }, [summary, open]);
  return {
    id: position ? id : undefined,
    tip: position
      ? createPortal(
          <span
            id={id}
            role="tooltip"
            className="tooltip"
            style={{
              position: "fixed",
              ...position,
              transform: "none",
              opacity: 1,
              maxWidth: 280,
              whiteSpace: "normal",
            }}
          >
            {text}
          </span>,
          document.body,
        )
      : null,
  };
}
