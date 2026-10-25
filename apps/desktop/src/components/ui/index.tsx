import { type ModalFocusReturn, useModal } from "./controls";

export type { ModalFocusReturn } from "./controls";

export {
  Combobox,
  DateTimeInput,
  Dialog,
  Kbd,
  SegmentedControl,
  Select,
  TagInput,
} from "./controls";
export { TabPanels, Tabs } from "./Tabs";

import { Bot, X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import laptop from "../../assets/chibi/danil-laptop-256.webp";
import type { MemberRef } from "../../bindings";
import { avatarInitials } from "../../lib/avatar-initials";
import { scheduleIdle } from "./idle";
export const AvatarMembersContext = createContext<readonly MemberRef[]>([]);
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      type="button"
      className={`button ${variant} ${className}`}
      {...props}
    />
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const show = useCallback(() => {
    // Navigation already shows its name, in both compact and expanded rails.
    const navigationLabel = anchor.current?.querySelector(
      ".nav-link .nav-label",
    );
    if (
      navigationLabel?.textContent?.trim() === text &&
      getComputedStyle(navigationLabel).display !== "none"
    )
      return;
    const rect = anchor.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(
          8,
          Math.min(
            rect.left,
            window.innerWidth - Math.min(280, text.length * 7 + 24) - 8,
          ),
        ),
        top:
          rect.bottom + (tip.current?.offsetHeight ?? 32) + 8 <
          window.innerHeight
            ? rect.bottom + 8
            : Math.max(8, rect.top - (tip.current?.offsetHeight ?? 32) - 8),
      });
  }, [text]);
  const open = position !== null;
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPosition(null);
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(show, 500);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    if (open) show();
  }, [open, show]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The wrapper observes descendant focus without becoming another focus target.
    <span
      className="tooltip-wrap"
      ref={anchor}
      aria-describedby={position ? id : undefined}
      onMouseEnter={schedule}
      onMouseLeave={hide}
      onFocus={schedule}
      onBlur={hide}
    >
      {children}
      {position &&
        createPortal(
          <span
            role="tooltip"
            ref={tip}
            id={id}
            className="tooltip"
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              transform: "none",
              opacity: 1,
              maxWidth: 280,
              whiteSpace: "normal",
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
export function Chip({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`chip ${className}`} {...props}>
      {children}
    </span>
  );
}
export const Stamp = Chip;
export function Avatar({
  member,
  size = 28,
  allMembers,
}: {
  member: MemberRef & { avatar?: string | null };
  size?: number;
  allMembers?: readonly MemberRef[];
}) {
  const contextMembers = useContext(AvatarMembersContext);
  return (
    <Tooltip
      text={`${member.name}${member.kind === "agent" ? " · agent" : ""}`}
    >
      <span
        className="avatar"
        role="img"
        aria-label={`${member.name}${member.kind === "agent" ? " · agent" : ""}`}
        style={{
          width: size,
          height: size,
          borderColor: member.color,
          background: `color-mix(in srgb, ${member.color} 18%, var(--card))`,
        }}
      >
        {member.avatar && !member.avatar.includes("/")
          ? member.avatar
          : avatarInitials(member, allMembers ?? contextMembers)}
        {member.kind === "agent" && (
          <Bot className="agent-badge" data-testid="agent-badge" size={10} />
        )}
      </span>
    </Tooltip>
  );
}
export function EmptyState({
  text = "Nothing here yet",
  image = laptop,
  size = 96,
  children,
}: {
  text?: string;
  image?: string;
  size?: number;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <img src={image} width={size} height={size} alt="" />
      <p>{text}</p>
      {children}
    </div>
  );
}
const DrawerTitleContext = createContext<{
  titleId: string;
  restore(): void;
} | null>(null);
export function useDrawerRestore() {
  return useContext(DrawerTitleContext)?.restore;
}
export function DrawerHeading({
  title,
  leading,
  actions,
  closeLabel = "Close task",
  onClose,
}: {
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
  onClose(): void;
}) {
  const titleId = useContext(DrawerTitleContext)?.titleId;
  return (
    <div className="drawer-heading">
      <span className="mono" id={titleId}>
        {title}
      </span>
      {leading}
      <div className="drawer-heading-actions">
        {actions}
        <IconButton
          label={`${closeLabel} · Esc`}
          aria-label={closeLabel}
          onClick={onClose}
        >
          <X />
        </IconButton>
      </div>
    </div>
  );
}

export function Drawer({
  children,
  onClose,
  title,
  leading,
  actions,
  closeLabel = "Close task",
  returnFocus,
  onEntered,
  hideHeading = false,
  onRequestClose,
  modal = true,
}: {
  children: ReactNode | ((close: () => void) => ReactNode);
  onClose(): void;
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
  returnFocus?: ModalFocusReturn;
  onEntered?(): void;
  hideHeading?: boolean;
  onRequestClose?(close: () => void): void;
  modal?: boolean;
}) {
  const [phase, setPhase] = useState<
    "entering" | "open" | "closing" | "closed"
  >("entering");
  const restore = useCallback(() => setPhase("open"), []);
  const finish = useRef(onClose);
  const entered = useRef(onEntered);
  finish.current = onClose;
  entered.current = onEntered;
  const animateClose = useCallback(() => setPhase("closing"), []);
  const requestClose = () => {
    if (phase === "closing" || phase === "closed") return;
    if (onRequestClose) onRequestClose(animateClose);
    else animateClose();
  };
  const ref = useModal(requestClose, returnFocus, {
    modal,
    active: phase !== "closed",
  });
  const id = useId();
  const context = useMemo(() => ({ titleId: id, restore }), [id, restore]);
  const content = useMemo(
    () => (typeof children === "function" ? children(animateClose) : children),
    [children, animateClose],
  );
  useEffect(() => {
    if (phase === "open") return;
    if (phase === "closed") return scheduleIdle(() => finish.current());
    const node = ref.current;
    if (!node) return;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (phase === "closing") {
        setPhase("closed");
      } else {
        setPhase("open");
        entered.current?.();
      }
    };
    const end = (event: AnimationEvent) => {
      if (
        event.target === node &&
        event.animationName === `drawer-${phase === "entering" ? "in" : "out"}`
      )
        complete();
    };
    node.addEventListener("animationend", end);
    // Computed duration follows the token and also covers disabled animations in
    // reduced motion, background tabs and DOM test environments.
    const style = getComputedStyle(node);
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : (Number.parseFloat(style.animationDuration) || 0) *
        (style.animationDuration.endsWith("ms") ? 1 : 1000);
    const timer = window.setTimeout(complete, duration ? duration + 64 : 0);
    return () => {
      node.removeEventListener("animationend", end);
      window.clearTimeout(timer);
    };
  }, [phase, ref]);
  return createPortal(
    <DrawerTitleContext.Provider value={context}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: The backdrop closes only on a direct pointer click; Escape and Close provide keyboard access. */}
      <div
        className={`drawer-backdrop ${phase}${modal ? "" : " non-modal"}`}
        onClick={(event) => {
          if (modal && event.target === event.currentTarget) requestClose();
        }}
        role="presentation"
      >
        <div
          className={`drawer ${phase}`}
          role="dialog"
          aria-modal={modal ? true : undefined}
          aria-hidden={phase === "closed" || undefined}
          inert={phase === "closed"}
          aria-labelledby={id}
          tabIndex={-1}
          ref={ref}
        >
          {!hideHeading && (
            <DrawerHeading
              title={title}
              leading={leading}
              actions={actions}
              closeLabel={closeLabel}
              onClose={requestClose}
            />
          )}
          {content}
        </div>
      </div>
    </DrawerTitleContext.Provider>,
    document.body,
  );
}
