import { Inbox, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Kbd } from "../../components/ui";
import type { Member } from "../../lib/types";
import { AgentStatus, InboxBadge } from "../team/AgentStatus";

export function TopbarActions({
  children,
  newTask,
  openInbox,
  openSearch,
  inboxCount,
  agents,
  pulse,
}: {
  children: ReactNode;
  newTask(): void;
  openInbox(): void;
  openSearch(): void;
  inboxCount: number;
  agents: Member[];
  pulse: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const focusLast = useRef(false);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const items =
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const select = (action: () => void) => {
    close();
    action();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: Labels shell actions, rather than grouping form fields.
    <div
      ref={root}
      className="topbar-actions"
      role="group"
      aria-label="Board actions"
    >
      <button
        type="button"
        ref={trigger}
        className="button secondary topbar-more"
        aria-label="More board actions"
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        onClick={() => {
          focusLast.current = false;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusLast.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">{"\u2022\u2022\u2022"}</span>
      </button>
      <div className="topbar-desktop-actions">{children}</div>
      {open && (
        <div
          id={id}
          ref={menu}
          className="topbar-action-items"
          role="menu"
          aria-label="Board actions"
          onBlur={(event) => {
            if (
              event.relatedTarget &&
              !root.current?.contains(event.relatedTarget)
            )
              setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // The agent details handle their own first Escape and return focus to their row.
              if (menu.current?.querySelector(".agent-status-popover")) return;
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            if (
              !(event.target instanceof HTMLElement) ||
              event.target.getAttribute("role") !== "menuitem"
            )
              return;
            event.preventDefault();
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              ) ?? [],
            );
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[index]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => select(newTask)}
          >
            <Plus size={18} aria-hidden="true" />
            <span>New task</span>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => select(openInbox)}
          >
            <Inbox size={18} aria-hidden="true" />
            <span>Inbox</span>
            <InboxBadge count={inboxCount} />
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => select(openSearch)}
          >
            <Search size={18} aria-hidden="true" />
            <span>Search</span>
            <Kbd>Ctrl K</Kbd>
          </button>
          {agents.map((agent) => (
            <AgentStatus
              key={agent.id}
              member={agent}
              pulse={!!pulse[agent.handle]}
              menu
            />
          ))}
        </div>
      )}
    </div>
  );
}
