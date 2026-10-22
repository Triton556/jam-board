import type { ReactNode } from "react";
import { labels, statuses } from "../../lib/types";
import { Button } from "./index";
import { RoughLine } from "./RoughLine";
export const memberColors = [
  "#5B8DEF",
  "#E0679A",
  "#3FA37A",
  "#9B7BE0",
  "#F07E5F",
  "#D8A630",
];
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  stateText = false,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  stateText?: boolean;
}) {
  return (
    <label className="switch-label">
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="switch"
      >
        <span />
      </button>
      {stateText ? (checked ? "On" : "Off") : label}
    </label>
  );
}
export function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange(v: string): void;
}) {
  return (
    <fieldset className="color-swatches">
      <legend>Color</legend>
      {memberColors.map((c, i) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${i + 1}`}
          aria-pressed={value === c}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </fieldset>
  );
}
export function WorkloadBar({
  counts,
}: {
  counts: Record<string, number | undefined>;
}) {
  const total = statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  return (
    <div className="workload">
      <div
        role="img"
        className={`workload-bar ${total ? "" : "empty"}`}
        aria-label={total ? `${total} tasks` : "no tasks yet"}
      >
        {statuses.map((s) => (
          <span
            key={s}
            title={`${labels[s]}: ${counts[s] ?? 0}`}
            style={{
              width: total ? `${((counts[s] ?? 0) / total) * 100}%` : 0,
              background: `var(--st-${s})`,
            }}
          />
        ))}
      </div>
      {total ? (
        <div className="workload-counts">
          {statuses.map((s) => (
            <span key={s} title={labels[s]}>
              <i style={{ background: `var(--st-${s})` }} />
              {counts[s] ?? 0}
            </span>
          ))}
        </div>
      ) : (
        <small className="muted">no tasks yet</small>
      )}
    </div>
  );
}
export function FileDropZone({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div className={`file-drop-zone ${active ? "active" : ""}`}>
      {children}
      {active && (
        <div className="file-drop-hint">
          <RoughLine frame />
          Drop files to add assets
        </div>
      )}
    </div>
  );
}
export function CodeBlock({
  code,
  onCopy,
  disabled = false,
  pending = false,
}: {
  code: string;
  onCopy(): void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="code-block">
      <Button onClick={onCopy} disabled={disabled || pending}>
        {pending ? "Copying…" : "Copy"}
      </Button>
      <pre>
        <code>
          {code.split("\n").map((line) => (
            <span
              key={line}
              className={
                line.startsWith("[")
                  ? "code-section"
                  : line.startsWith("#")
                    ? "muted"
                    : ""
              }
            >
              {line.includes(" = ") ? (
                <>
                  <b>{line.split(" = ")[0]}</b>
                  {line.slice(line.indexOf(" = "))}
                </>
              ) : (
                line
              )}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
export function PageHeading({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <div className="heading-line">
          <RoughLine />
        </div>
        {note && <p className="hand-note">{note}</p>}
      </div>
      {children}
    </header>
  );
}
