import { useReducedMotion } from "motion/react";
import { watchWorkingVisibility } from "../../components/ui/AgentWorking";
import type { WorkingState } from "../../lib/agent-working";

// Batch circles by paint color instead of allocating an animated SVG use/shadow
// tree per row. Task rows retain their real keys, focus and accessible content.
export function WorkingLayer({
  rows,
}: {
  rows: { key: string; state: WorkingState }[];
}) {
  const reduced = useReducedMotion();
  if (!rows.some((r) => r.state)) return null;
  const animated = rows.some((r) => r.state?.mode === "active") && !reduced;
  const groups = new Map<
    string,
    { mode: string; color: string; keys: string[]; circles: string[] }
  >();
  for (const [index, { key, state }] of rows.entries()) {
    if (!state) continue;
    const paintKey = `${state.mode}:${state.color}`;
    let group = groups.get(paintKey);
    if (!group) {
      group = { mode: state.mode, color: state.color, keys: [], circles: [] };
      groups.set(paintKey, group);
    }
    group.keys.push(key);
    group.circles.push(`M13 ${index * 44 + 22}a7 7 0 1 0 14 0a7 7 0 1 0 -14 0`);
  }
  return (
    <tr className="table-working-layer-row" inert ref={watchWorkingVisibility}>
      <td>
        <svg
          className="table-working-layer table-working-rotor working-animated"
          aria-hidden="true"
          data-testid="table-working-layer"
          style={animated ? undefined : { animation: "none" }}
        >
          {[...groups]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, group]) => (
              <path
                key={key}
                data-mode={group.mode}
                data-working-keys={group.keys.join(" ")}
                data-working-count={group.keys.length}
                d={group.circles.join(" ")}
                fill="none"
                stroke={group.color}
                strokeWidth={2}
                strokeDasharray="4 3"
                // Six 4/3 dash periods per circle make an eight-second loop seamless.
                pathLength={group.keys.length * 42}
                style={
                  group.mode === "quiet" || reduced
                    ? { strokeDashoffset: 0 }
                    : undefined
                }
              />
            ))}
        </svg>
      </td>
    </tr>
  );
}
