import { CalendarDays, X } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Member } from "../../lib/types";
import { CustomSelect } from "./CustomSelect";
import { Button, Chip, IconButton } from "./index";

/** Visible native tab stops, including disclosure summaries but not their hidden contents. */
export function modalTabStops(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
    ),
  ).filter((node) => {
    if (node.matches("[tabindex]") && node.tabIndex < 0) return false;
    if (node.matches('input[type="hidden"]')) return false;
    for (
      let parent: HTMLElement | null = node;
      parent && root.contains(parent);
      parent = parent.parentElement
    ) {
      if (
        parent.hidden ||
        parent.hasAttribute("inert") ||
        parent.getAttribute("aria-hidden") === "true"
      )
        return false;
      const style = getComputedStyle(parent);
      if (
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility)
      )
        return false;
      if (parent.matches("details:not([open])")) {
        const summary = Array.from(parent.children).find(
          (child) => child.tagName === "SUMMARY",
        );
        if (!summary?.contains(node)) return false;
      }
    }
    return true;
  });
}

const layers: symbol[] = [];
export type ModalFocusReturn = () => HTMLElement | null;
export function useModal(onClose: () => void, returnFocus?: ModalFocusReturn) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose),
    restore = useRef(returnFocus);
  close.current = onClose;
  restore.current = returnFocus;
  useEffect(() => {
    const token = Symbol();
    layers.push(token);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (layers.at(-1) !== token) return;
      if (event.key === "Escape") {
        if (
          event.target instanceof Element &&
          event.target
            .closest(".custom-select")
            ?.querySelector('[aria-expanded="true"]')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const nodes = ref.current ? modalTabStops(ref.current) : [];
      const first = nodes[0],
        last = nodes.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current ||
          !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === ref.current ||
          !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      const wasTop = layers.at(-1) === token;
      layers.splice(layers.indexOf(token), 1);
      document.removeEventListener("keydown", key, true);
      // An older closing layer must not steal focus from a newer dialog.
      if (!wasTop) return;
      if (restore.current) {
        const target = restore.current();
        // Explicit null denies restoration (expired view/project); it must not
        // fall back to a still-connected trigger from another selection epoch.
        if (!target?.isConnected) return;
        const parent = layers.length
          ? Array.from(
              document.querySelectorAll<HTMLElement>(
                '[role="dialog"][aria-modal="true"]',
              ),
            ).at(-1)
          : undefined;
        if (parent) {
          if (previous?.isConnected && parent.contains(previous))
            previous.focus();
          else parent.focus();
        } else target.focus();
        return;
      }
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"][aria-modal="true"]',
          ),
        )
          .at(-1)
          ?.focus();
    };
  }, []);
  return ref;
}
export function Dialog({
  title,
  children,
  onClose,
  className = "",
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  className?: string;
  busy?: boolean;
}) {
  const close = () => {
    if (!busy) onClose();
  };
  const ref = useModal(close);
  const id = useId();
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: Only direct backdrop clicks close; Escape and the close button provide keyboard access.
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={id}
        tabIndex={-1}
        ref={ref}
      >
        <div className="dialog-heading">
          <h2 id={id}>{title}</h2>
          <IconButton label={`Close ${title}`} onClick={close} disabled={busy}>
            <X />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(props.children).flatMap((child) =>
    isValidElement<{ value?: string; children?: ReactNode }>(child)
      ? [
          {
            value: String(child.props.value ?? ""),
            label: String(child.props.children ?? ""),
          },
        ]
      : [],
  );
  const [local, setLocal] = useState(
    String(props.defaultValue ?? options[0]?.value ?? ""),
  );
  return (
    <CustomSelect
      id={props.id}
      disabled={props.disabled}
      label={props["aria-label"] ?? props.name ?? "Select"}
      value={String(props.value ?? local)}
      options={options.map((o) => ({
        ...o,
        color:
          props["aria-label"] === "Status" ? `var(--st-${o.value})` : undefined,
      }))}
      onChange={(value) => {
        setLocal(value);
        props.onChange?.({
          target: { value, name: props.name },
          type: "change",
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
  size = "default",
}: {
  label: string;
  value: T;
  onChange(value: T): void;
  options: { value: T; label: ReactNode; title?: string }[];
  disabled?: boolean;
  size?: "default" | "large";
}) {
  return (
    <div
      className={`segmented segmented-${size}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o, index) => (
        // biome-ignore lint/a11y/useSemanticElements: A button radio supports rich icon labels and a single roving keyboard focus target.
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-label={o.title ?? String(o.label)}
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => {
            if (
              ![
                "ArrowRight",
                "ArrowLeft",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (index +
                      (event.key === "ArrowRight" || event.key === "ArrowDown"
                        ? 1
                        : -1) +
                      options.length) %
                    options.length;
            const option = options[next];
            if (option) {
              onChange(option.value);
              (
                event.currentTarget.parentElement?.children[
                  next
                ] as HTMLButtonElement
              )?.focus();
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
export function Combobox({
  members,
  value,
  onChange,
  disabled,
}: {
  members: Member[];
  value: string | null;
  onChange(id: string | null): void;
  disabled?: boolean;
}) {
  return (
    <CustomSelect
      label="Assignee"
      value={value ?? ""}
      disabled={disabled}
      searchable
      onChange={(v) => onChange(v || null)}
      options={[
        { value: "", label: "Unassigned" },
        ...members.map((m) => ({
          value: m.id,
          label: m.name,
          group: m.kind === "human" ? "Humans" : "Agents",
        })),
      ]}
    />
  );
}
export function TagInput({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  label = "Tags",
}: {
  value: string[];
  onChange(v: string[]): void;
  suggestions?: string[];
  disabled?: boolean;
  label?: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (tag.length > 24) {
      setError("Use at most 24 characters");
      return;
    }
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText("");
    setError("");
  };
  return (
    <div className="tag-control">
      <div className="tag-input">
        {value.map((tag) => (
          <Chip key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              ×
            </button>
          </Chip>
        ))}
        <input
          aria-label={label}
          disabled={disabled}
          value={text}
          list={id}
          placeholder="Add a tag…"
          onChange={(e) => {
            const parts = e.target.value.split(",");
            if (parts.length > 1) add(parts[0] ?? "");
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text)
              onChange(value.slice(0, -1));
          }}
        />
      </div>
      <datalist id={id}>
        {suggestions
          .filter((t) => !value.includes(t))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
const dueFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function formatDue(value: string) {
  return dueFormatter.format(new Date(value));
}

export function DateTimeInput({
  value,
  onChange,
  disabled,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string | null;
  onChange(value: string | null): void;
}) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    try {
      input.current?.showPicker?.();
    } catch {
      /* Keyboard editing remains available if a native picker needs a gesture. */
    }
  }, [editing]);
  const local = value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
  return (
    <div className="date-input">
      {editing ? (
        <input
          ref={input}
          onBlur={() => setEditing(false)}
          {...props}
          type="datetime-local"
          value={local}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              e.target.value ? new Date(e.target.value).toISOString() : null,
            )
          }
        />
      ) : (
        <Button
          className="due-display"
          disabled={disabled}
          onClick={() => setEditing(true)}
        >
          <CalendarDays size={16} />
          {value ? formatDue(value) : "Set due date"}
        </Button>
      )}
      {value && (
        <IconButton
          label="Clear due date"
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setEditing(false);
          }}
        >
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}
