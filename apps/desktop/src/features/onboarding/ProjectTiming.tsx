import { milestoneLabel } from "../../lib/project-template";
import { useUiStore } from "../../lib/ui-store";
export function ProjectTiming({
  template = "game_jam",
  endsAt,
  milestoneAt,
}: {
  template: string | undefined;
  endsAt: string | null;
  milestoneAt: string | null | undefined;
}) {
  const now = useUiStore((s) => Math.floor(s.now / 1000));
  if (template !== "game_jam") {
    const label = milestoneLabel(template, milestoneAt);
    return label ? <span className="mono muted small">{label}</span> : null;
  }
  if (!endsAt) return null;
  const left = Math.max(0, Math.floor(Date.parse(endsAt) / 1000 - now));
  const text = left
    ? `${Math.floor(left / 3600)
        .toString()
        .padStart(2, "0")}:${Math.floor((left / 60) % 60)
        .toString()
        .padStart(2, "0")}:${(left % 60).toString().padStart(2, "0")} left`
    : "Jam over";
  return (
    <span
      className={`countdown ${left < 10800 ? "ending" : ""}`}
      role="timer"
      aria-label="Jam time remaining"
    >
      {text}
    </span>
  );
}
