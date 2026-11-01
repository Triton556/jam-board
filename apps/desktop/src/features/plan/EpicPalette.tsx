import type { EpicColor } from "../../bindings";
import { Tooltip } from "../../components/ui";
import { memberColors } from "../../components/ui/m5";
import "./round12-plan.css";

export function EpicPalette({
  value,
  choose,
  disabled = false,
}: {
  value?: string;
  choose(value: EpicColor): void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="epic-palette" disabled={disabled}>
      <legend>Epic color</legend>
      <div className="epic-palette-options">
        {memberColors.slice(0, 6).map((color, i) => (
          <Tooltip key={color} text={`Palette color ${i + 1}`}>
            <button
              type="button"
              title={`Palette color ${i + 1}`}
              aria-label={`Color ${i + 1}`}
              aria-pressed={value === `m${i + 1}`}
              onClick={() => choose(`m${i + 1}` as EpicColor)}
            >
              <i aria-hidden="true" style={{ background: color }} />
              Color {i + 1}
            </button>
          </Tooltip>
        ))}
      </div>
      <p className="small muted">
        Only helps tell epics apart. Doesn't mean anything else.
      </p>
    </fieldset>
  );
}
