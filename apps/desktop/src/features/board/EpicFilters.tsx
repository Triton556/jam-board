import { useQuery } from "@tanstack/react-query";
import { epicsQuery } from "../../lib/planning-queries";
export function EpicFilters({
  value,
  onChange,
}: {
  value: string[];
  onChange(keys: string[]): void;
}) {
  const epics = useQuery(epicsQuery);
  return (
    <fieldset className="board-epic-filters" aria-label="Board epics">
      <button
        type="button"
        aria-pressed={!value.length}
        onClick={() => onChange([])}
      >
        All epics
      </button>
      {epics.data
        ?.filter((e) => e.status === "active")
        .map((e) => (
          <button
            type="button"
            key={e.key}
            aria-pressed={value.includes(e.key)}
            style={
              { "--epic-color": `var(--${e.color})` } as React.CSSProperties
            }
            onClick={() =>
              onChange(
                value.includes(e.key)
                  ? value.filter((k) => k !== e.key)
                  : [...value, e.key],
              )
            }
          >
            <i style={{ background: `var(--${e.color})` }} />
            {e.title}
          </button>
        ))}
    </fieldset>
  );
}
