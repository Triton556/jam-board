import { Bot } from "lucide-react";
import { memo } from "react";
import {
  WorkingPencil,
  WorkingRing,
  watchWorkingVisibility,
} from "../../components/ui/AgentWorking";
import { Priority } from "../../components/ui/Priority";
import type { WorkingState } from "../../lib/agent-working";
import type { Member, TaskSummary } from "../../lib/types";
import { labels } from "../../lib/types";

export interface TableRowProps {
  task: TaskSummary;
  estimatesEnabled?: boolean;
  hiddenByFilters?: boolean;
  assignee?: Member;
  initials: string;
  highlightUntil: number;
  highlightColor?: string;
  selected: boolean;
  tabStop: boolean;
  timeLabel: string;
  exactTime: string;
  working?: WorkingState;
}
export function sameTableRow(a: TableRowProps, b: TableRowProps) {
  return (
    a.working?.mode === b.working?.mode &&
    a.working?.text === b.working?.text &&
    a.working?.tooltip === b.working?.tooltip &&
    a.working?.color === b.working?.color &&
    a.estimatesEnabled === b.estimatesEnabled &&
    a.hiddenByFilters === b.hiddenByFilters &&
    a.task.key === b.task.key &&
    a.task.updatedAt === b.task.updatedAt &&
    a.task.ready === b.task.ready &&
    a.task.needsInfo === b.task.needsInfo &&
    a.task.changesRequested === b.task.changesRequested &&
    a.task.epicColor === b.task.epicColor &&
    a.task.storyKey === b.task.storyKey &&
    a.highlightUntil === b.highlightUntil &&
    a.selected === b.selected &&
    a.tabStop === b.tabStop &&
    a.timeLabel === b.timeLabel &&
    a.assignee === b.assignee &&
    a.initials === b.initials &&
    a.highlightColor === b.highlightColor
  );
}
export const TableRow = memo(function TableRow({
  task,
  estimatesEnabled = false,
  hiddenByFilters = false,
  assignee,
  initials,
  highlightUntil,
  highlightColor,
  selected,
  tabStop,
  timeLabel,
  exactTime,
  working = null,
}: TableRowProps) {
  return (
    <tr
      ref={watchWorkingVisibility}
      data-working={working?.mode}
      data-task-key={task.key}
      data-testid="table-row"
      className={`${task.archivedAt ? "archived" : ""} ${selected ? "focused" : ""}`}
      tabIndex={tabStop ? 0 : -1}
      style={{
        background: highlightUntil
          ? `color-mix(in srgb, ${highlightColor} 12%, var(--card))`
          : undefined,
      }}
    >
      <td className="mono">{task.key}</td>
      <td className="mono small">
        <i
          className="table-epic-dot"
          style={{ background: `var(--${task.epicColor})` }}
        />
        {task.epicKey}
      </td>
      <td className="mono small">{task.storyKey}</td>
      <td className="table-title" title={task.title}>
        <span className="table-title-text">{task.title}</span>
        {hiddenByFilters && (
          <span className="table-stamp">hidden by filters</span>
        )}
        {task.archivedAt && <span className="table-stamp">archived</span>}
      </td>
      <td>
        <span
          className="table-stamp"
          style={{ background: `var(--st-${task.status})` }}
        >
          {labels[task.status as keyof typeof labels]}
        </span>
      </td>
      <td>
        <Priority value={task.priority} text />
      </td>
      <td>
        {assignee ? (
          <span
            className={`assignee-cell ${working?.mode ?? ""}`}
            title={working?.tooltip}
            style={{ "--working-color": working?.color } as React.CSSProperties}
          >
            <WorkingRing state={working} compact layered>
              <span
                className="table-avatar"
                title={
                  working
                    ? `${working.tooltip} · agent`
                    : `${assignee.name}${assignee.kind === "agent" ? " · agent" : ""}`
                }
                style={{
                  borderColor: assignee.color,
                  background: `color-mix(in srgb, ${assignee.color} 18%, var(--card))`,
                }}
              >
                {initials}
                {assignee.kind === "agent" && (
                  <Bot className="table-antenna" size={10} aria-label="agent" />
                )}
              </span>
            </WorkingRing>
            {working && <WorkingPencil label={working.text} staticMotion />}
            <span>{assignee.name}</span>
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}
      </td>
      <td className="table-tags">
        {task.tags.slice(0, 2).map((tag) => (
          <span className="table-stamp" key={tag}>
            {tag}
          </span>
        ))}
        {task.tags.length > 2 && <span>+{task.tags.length - 2}</span>}
      </td>
      {estimatesEnabled && <td className="mono">{task.estimate ?? "–"}</td>}
      <td>
        <span
          className={`readiness-dot ${task.ready ? "ready" : ""}`}
          title={task.ready ? "Brief complete" : "Brief incomplete"}
        />
      </td>
      <td className="table-flags">
        {task.changesRequested && (
          <span className="table-stamp changes-requested">
            Changes requested
          </span>
        )}
        {task.needsInfo && (
          <span className="table-stamp needs-info">Needs info</span>
        )}
      </td>
      <td title={exactTime}>
        <span className="muted">{timeLabel}</span>
      </td>
    </tr>
  );
}, sameTableRow);
