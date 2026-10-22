import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  selectClip,
  selectPlacement,
  selectViewport,
} from "./select-placement";
export type SelectOption = {
  value: string;
  label: string;
  group?: string;
  color?: string;
  disabled?: boolean;
};
export function CustomSelect({
  value,
  onChange,
  options,
  label,
  disabled,
  id,
  searchable = false,
}: {
  value: string;
  onChange(value: string): void;
  options: SelectOption[];
  label: string;
  disabled?: boolean;
  id?: string;
  searchable?: boolean;
}) {
  const uid = useId(),
    listId = `${uid}-list`;
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] =
    useState<ReturnType<typeof selectPlacement>>();
  const [presentation, setPresentation] = useState<
    "anchored" | "top-layer" | "inline"
  >("anchored");
  useLayoutEffect(() => {
    if (!open) return;
    const element = popup.current;
    if (!element) return;
    let topLayer = false;
    let inlineFallback = false;
    // The native top layer escapes a short dialog's overflow without moving
    // the popup out of its modal/select DOM ownership or keyboard scope.
    if (
      typeof element.showPopover === "function" &&
      typeof element.hidePopover === "function"
    ) {
      try {
        element.setAttribute("popover", "manual");
        element.showPopover();
        topLayer = true;
      } catch {
        element.removeAttribute("popover");
      }
    }
    const update = () => {
      if (!button.current || !root.current || !popup.current) return;
      const anchor = button.current.getBoundingClientRect();
      const clip = selectClip(root.current);
      if (
        (anchor.width > 0 || anchor.height > 0) &&
        (anchor.bottom <= clip.top ||
          anchor.top >= clip.bottom ||
          anchor.right <= clip.left ||
          anchor.left >= clip.right)
      ) {
        // A scrolled-away trigger must not leave an orphaned popup. Do not
        // refocus/scroll it back against the person's navigation intent.
        setOpen(false);
        setQuery("");
        return;
      }
      const viewport = selectViewport();
      const height = Math.min(300, popup.current.scrollHeight + 4);
      const next = selectPlacement(
        anchor,
        topLayer
          ? { left: 0, top: 0, right: 0, bottom: 0 }
          : root.current.getBoundingClientRect(),
        topLayer ? viewport : clip,
        height,
      );
      if (!topLayer && next.maxHeight < Math.min(height, searchable ? 150 : 80))
        inlineFallback = true;
      // Unsupported/throwing Popover implementations must still expose choices.
      // Stay in flow for this opening, rather than oscillating as the dialog grows.
      if (inlineFallback)
        next.maxHeight = Math.max(
          1,
          Math.min(300, viewport.bottom - viewport.top - 32),
        );
      setPresentation(
        topLayer ? "top-layer" : inlineFallback ? "inline" : "anchored",
      );
      setPlacement((old) =>
        old &&
        Object.entries(next).every(
          ([key, value]) => old[key as keyof typeof old] === value,
        )
          ? old
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (root.current) observer.observe(root.current);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      if (topLayer) {
        try {
          element.hidePopover();
        } catch {
          // The owner may already have removed this popup during navigation.
        }
        element.removeAttribute("popover");
      }
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, searchable]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${uid}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, uid]);
  useEffect(() => {
    if (open && searchable) search.current?.focus();
  }, [open, searchable]);
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const focus = (e: FocusEvent) => {
      // A newer modal must never sit behind an old manual top-layer popup.
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("focusin", focus);
    };
  }, [open]);
  const choose = (v: string) => {
    if (options.find((o) => o.value === v)?.disabled) return;
    onChange(v);
    setOpen(false);
    setQuery("");
    button.current?.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegates option keyboard events while focus remains in the combobox or its search input.
    <div
      className="custom-select"
      ref={root}
      onKeyDown={(e) => {
        if (disabled) return;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          setOpen(true);
          setActive((i) => {
            let next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? filtered.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        filtered.length - 1,
                        i + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    );
            const direction = e.key === "ArrowUp" || e.key === "End" ? -1 : 1;
            while (filtered[next]?.disabled) {
              next += direction;
              if (next < 0 || next >= filtered.length) return i;
            }
            return next;
          });
        }
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
        if (e.key === "Enter" && open) {
          e.preventDefault();
          const o = filtered[active];
          if (o) choose(o.value);
        }
        if (e.key === "Tab") setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        disabled={disabled}
        className="input-like"
        onClick={() => {
          setOpen(!open);
          setActive(
            Math.max(
              0,
              options.findIndex((o) => o.value === value),
            ),
          );
        }}
      >
        <span>
          {selected?.color && (
            <i className="select-dot" style={{ background: selected.color }} />
          )}
          {selected?.label ?? "Select…"}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          className="combo-popup"
          ref={popup}
          data-placement={placement?.side}
          data-presentation={presentation}
          style={
            presentation === "inline"
              ? { width: "100%", minWidth: 0, maxHeight: placement?.maxHeight }
              : placement
                ? {
                    left: placement.left,
                    top: placement.top,
                    width: placement.width,
                    minWidth: 0,
                    maxHeight: placement.maxHeight,
                  }
                : undefined
          }
        >
          {searchable && (
            <input
              ref={search}
              aria-label={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
            />
          )}
          <div id={listId} role="listbox" aria-label={`${label} options`}>
            {filtered.map((o, i) => (
              <div key={o.value}>
                {o.group && filtered[i - 1]?.group !== o.group && (
                  <small className="eyebrow">{o.group}</small>
                )}
                <button
                  type="button"
                  role="option"
                  id={`${uid}-${i}`}
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  aria-disabled={o.disabled}
                  className={i === active ? "active-option" : ""}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(o.value)}
                >
                  {o.color && (
                    <i className="select-dot" style={{ background: o.color }} />
                  )}
                  {o.label}
                </button>
              </div>
            ))}
            {!filtered.length && <p className="muted">No matches</p>}
          </div>
        </div>
      )}
    </div>
  );
}
