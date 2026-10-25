import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Tooltip } from "../../components/ui";
import "./reference-popover.css";

/** A canvas-safe menu that stays above transformed nodes and within the viewport. */
export function ReferencePopover({
  label,
  trigger,
  children,
  className = "",
  tooltip = label,
}: {
  label: string;
  trigger: ReactNode;
  children(close: () => void): ReactNode;
  className?: string;
  tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    menu = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !menu.current || !button.current) return;
    const element = menu.current;
    try {
      if (typeof element.showPopover === "function") element.showPopover();
      else element.removeAttribute("popover");
    } catch {
      /* Fixed positioning remains the fallback. */
    }
    const position = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = element.offsetWidth,
        height = element.offsetHeight;
      element.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
      element.style.top = `${anchor.bottom + height + 8 <= window.innerHeight ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)}px`;
    };
    position();
    element.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      try {
        element.hidePopover?.();
      } catch {
        /* Already removed. */
      }
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);
  return (
    <div ref={root} className={`reference-popover nodrag nopan ${className}`}>
      <Tooltip text={tooltip}>
        <button
          type="button"
          ref={button}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {trigger}
        </button>
      </Tooltip>
      {open && (
        <div
          ref={menu}
          popover="manual"
          role="menu"
          aria-label={label}
          className="reference-popover-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              event.preventDefault();
              close();
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const buttons = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? [],
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length
            ]?.focus();
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
