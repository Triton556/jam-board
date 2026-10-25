import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../Markdown";
import { AutosizeTextarea } from "./AutosizeTextarea";
import { Tooltip } from "./index";
export function MarkdownField({
  label,
  value,
  onChange,
  onSave,
  hint = "Add a little context using Edit",
  meaning,
  disabled = false,
  field,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  onSave?(nextFocus?: EventTarget | null): void;
  hint?: string;
  meaning?: string;
  disabled?: boolean;
  field?: string;
}) {
  const [editing, setEditing] = useState(false);
  const start = useRef(value),
    input = useRef<HTMLTextAreaElement>(null),
    edit = useRef<HTMLButtonElement>(null),
    restoreEditFocus = useRef(false);
  const canceled = useRef(false);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreEditFocus.current) {
      restoreEditFocus.current = false;
      edit.current?.focus();
    }
  }, [editing]);
  return (
    <section className="markdown-field" data-brief-field={field}>
      <div className="section-heading">
        <h3>{label}</h3>
        <div className="markdown-field-actions">
          {meaning && (
            <Tooltip text={meaning}>
              <button
                type="button"
                aria-label="Field help"
                className="help-mark"
                tabIndex={0}
              >
                ?
              </button>
            </Tooltip>
          )}
          <button
            ref={edit}
            type="button"
            className="button ghost markdown-field-edit"
            disabled={disabled || editing}
            aria-label={`Edit ${label}`}
            onClick={() => {
              if (disabled || editing) return;
              start.current = value;
              canceled.current = false;
              setEditing(true);
            }}
          >
            <Pencil size={13} aria-hidden="true" /> Edit
          </button>
        </div>
      </div>
      {editing && !disabled ? (
        <AutosizeTextarea
          ref={input}
          aria-label={label}
          value={value}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(event) => {
            setEditing(false);
            if (!canceled.current) onSave?.(event.relatedTarget);
            canceled.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              canceled.current = true;
              onChange(start.current);
              restoreEditFocus.current = true;
              setEditing(false);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              e.stopPropagation();
              onSave?.();
              restoreEditFocus.current = true;
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="markdown-field-view">
          {value ? (
            <Markdown>{value}</Markdown>
          ) : (
            <span className="hand-note">
              {disabled ? "Not provided" : hint}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
