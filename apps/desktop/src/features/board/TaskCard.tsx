import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  MessageCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { Avatar, Stamp } from "../../components/ui";
import {
  WorkingLine,
  WorkingRing,
  watchWorkingVisibility,
} from "../../components/ui/AgentWorking";
import { useAgentWorking } from "../../lib/agent-working";
import type { ColorBy, Member, TaskSummary } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";

const icons = {
  low: ChevronDown,
  medium: Equal,
  high: ChevronUp,
  critical: ChevronsUp,
};
export function TaskCard({
  task,
  members,
  overlay = false,
  colorBy = "none",
  estimatesEnabled = false,
}: {
  task: TaskSummary;
  members: Member[];
  overlay?: boolean;
  colorBy?: ColorBy;
  estimatesEnabled?: boolean;
}) {
  const highlight = useUiStore((s) => s.highlights[task.key]);
  const reduced = useReducedMotion();

  const member = members.find((m) => m.id === task.assigneeId);
  const working = useAgentWorking(task, member);
  const Icon = icons[task.priority as keyof typeof icons] ?? Equal;
  const paint =
    colorBy === "epic" && task.epicColor
      ? `var(--${task.epicColor})`
      : colorBy === "assignee" && member
        ? member.color
        : null;
  const style: CSSProperties = {
    "--assignee-color": paint ?? "transparent",
    "--card-fill": paint
      ? `color-mix(in srgb, ${paint} var(--card-mix), var(--card))`
      : "var(--card)",
    "--card-border": paint
      ? `color-mix(in srgb, ${paint} 45%, var(--line-soft))`
      : "var(--line-soft)",
    "--agent-color": member?.kind === "agent" ? member.color : "transparent",
    boxShadow: highlight
      ? `0 0 0 2px ${highlight.color}, 0 0 24px color-mix(in srgb, ${highlight.color} 40%, transparent)`
      : overlay
        ? "var(--shadow-lift)"
        : "var(--shadow-card)",
  } as CSSProperties;
  return (
    <motion.div
      ref={watchWorkingVisibility}
      className={`sticker-wrap ${overlay ? "lifted" : ""}`}
      data-testid="task-card"
      data-key={task.key}
      data-color-by={paint ? colorBy : "none"}
      data-highlighted={highlight ? "true" : "false"}
      style={style}
      layout={!reduced && !overlay}
      layoutId={overlay || reduced ? undefined : task.key}
      initial={
        highlight?.action === "task.created" && !reduced
          ? { y: -12, scale: 0.94 }
          : false
      }
      animate={{ y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
    >
      <div className="task-card">
        <div className="card-key">
          <span>{task.key}</span>
          <Icon
            className={`priority ${task.priority}`}
            aria-label={`${task.priority} priority`}
            size={17}
          />
        </div>
        <div className="card-hierarchy">
          <i style={{ background: `var(--${task.epicColor ?? "m1"})` }} />
          <span>{task.storyKey}</span>
        </div>
        <div className="card-title">{task.title}</div>
        {(task.changesRequested || task.needsInfo) && (
          <div className="card-flags">
            {task.changesRequested && (
              <span className="chip flag-changes">Changes requested</span>
            )}
            {task.needsInfo && (
              <span className="chip flag-info">Needs info</span>
            )}
          </div>
        )}
        {task.tags.length > 0 && (
          <div className="card-tags">
            {task.tags.slice(0, 3).map((tag) => (
              <Stamp key={tag}>{tag}</Stamp>
            ))}
            {task.tags.length > 3 && (
              <span className="tag-extra">+{task.tags.length - 3}</span>
            )}
          </div>
        )}
        <WorkingLine state={working} />
        <div className="card-footer">
          {estimatesEnabled && task.estimate !== null && (
            <span
              className="estimate"
              role="img"
              aria-label={`${task.estimate} story points`}
            >
              {task.estimate}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="comment-count">
              <MessageCircle size={14} />
              {task.commentCount}
            </span>
          )}
          {member && (
            <span className="card-assignee">
              <WorkingRing state={working}>
                <Avatar member={member} allMembers={members} size={26} />
              </WorkingRing>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
