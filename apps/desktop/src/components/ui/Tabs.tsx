import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/** Manual activation: arrows explore labels; Enter/Space selects without losing drafts. */
export function Tabs({
  id,
  label,
  value,
  onChange,
  items,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
  items: string[];
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(value);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setFocused(value);
  }, [value]);
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      ref={list}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(value);
      }}
    >
      {items.map((item, index) => (
        <button
          key={item}
          type="button"
          disabled={disabled}
          role="tab"
          id={`${id}-tab-${index}`}
          aria-controls={`${id}-panel-${index}`}
          aria-selected={value === item}
          tabIndex={focused === item ? 0 : -1}
          onFocus={() => setFocused(item)}
          onClick={() => {
            if (!disabled) onChange(item);
          }}
          onKeyDown={(event) => {
            if (
              disabled ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      items.length) %
                    items.length;
            list.current
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

/** Keep every relationship addressable; only current content is mounted/exposed. */
export function TabPanels({
  id,
  value,
  items,
  children,
}: {
  id: string;
  value: string;
  items: string[];
  children: ReactNode;
}) {
  if (items.length === 0) return <>{children}</>;
  return (
    <>
      {items.map((item, index) => (
        <div
          key={item}
          className="tab-panel"
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={item !== value}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tab panels containing read-only evidence need a keyboard entry point after their tablist.
          tabIndex={0}
        >
          {item === value ? children : null}
        </div>
      ))}
    </>
  );
}
