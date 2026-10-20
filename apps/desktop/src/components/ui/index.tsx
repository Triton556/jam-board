import { useModal } from "./controls";

export {
  Combobox,
  DateTimeInput,
  Dialog,
  Kbd,
  SegmentedControl,
  Select,
  Tabs,
  TagInput,
} from "./controls";

import { Bot, X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import laptop from "../../assets/chibi/danil-laptop-256.webp";
import type { MemberRef } from "../../bindings";
import { avatarInitials } from "../../lib/avatar-initials";
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
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(
          8,
          Math.min(
            rect.left,
            window.innerWidth - Math.min(320, text.length * 7 + 24) - 8,
          ),
        ),
        top:
          rect.bottom + 40 < window.innerHeight
            ? rect.bottom + 8
            : rect.top - 34,
      });
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The wrapper observes descendant focus without becoming another focus target.
    <span
      className="tooltip-wrap"
      ref={anchor}
      aria-describedby={position ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setPosition(null)}
      onFocus={show}
      onBlur={() => setPosition(null)}
    >
      {children}
      {position &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            className="tooltip"
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              transform: "none",
              opacity: 1,
              maxWidth: 320,
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
export function Drawer({
  children,
  onClose,
  title,
  leading,
  actions,
}: {
  children: ReactNode;
  onClose(): void;
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useModal(onClose);
  const id = useId();
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: The backdrop closes only on a direct pointer click; Escape and the Close button provide keyboard access.
    <div
      className="drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        ref={ref}
      >
        <div className="drawer-heading">
          <span className="mono" id={id}>
            {title}
          </span>
          {leading}
          <div className="drawer-heading-actions">
            {actions}
            <IconButton label="Close task" onClick={onClose}>
              <X />
            </IconButton>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
