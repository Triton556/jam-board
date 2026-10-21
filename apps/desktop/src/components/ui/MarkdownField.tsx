import { useEffect, useRef, useState } from "react";
import { Markdown } from "../Markdown";
import { Button, Tooltip } from "./index";
export function MarkdownField({
  label,
  value,
  onChange,
  onSave,
  hint = "Click to add a little context",
  meaning,
  disabled = false,
  field,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  onSave?(): void;
  hint?: string;
  meaning?: string;
  disabled?: boolean;
  field?: string;
}) {
  const [editing, setEditing] = useState(false);
  const start = useRef(value),
    input = useRef<HTMLTextAreaElement>(null);
  const canceled = useRef(false);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  return (
    <section className="markdown-field" data-brief-field={field}>
      <div className="section-heading">
        <h3>{label}</h3>
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
      </div>
      {editing && !disabled ? (
        <textarea
          ref={input}
          aria-label={label}
          value={value}
          rows={Math.max(4, value.split("\n").length + 1)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (!canceled.current) onSave?.();
            canceled.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              canceled.current = true;
              onChange(start.current);
              setEditing(false);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              e.stopPropagation();
              onSave?.();
              setEditing(false);
            }
          }}
        />
      ) : (
        <Button
          variant="ghost"
          className="markdown-field-view"
          disabled={disabled}
          aria-label={`Edit ${label}`}
          onClick={() => {
            start.current = value;
            canceled.current = false;
            setEditing(true);
          }}
        >
          {value ? (
            <Markdown>{value}</Markdown>
          ) : (
            <span className="hand-note">{hint}</span>
          )}
        </Button>
      )}
    </section>
  );
}
