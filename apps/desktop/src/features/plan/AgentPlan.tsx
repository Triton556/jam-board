import type { ReactNode } from "react";

/** Progressive disclosure only: children stay mounted, registered and unchanged. */
export function AgentPlan({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="agent-plan">
      <summary>
        <span>Agent plan</span>
        <span className="agent-plan-summary">{summary}</span>
      </summary>
      <div className="agent-plan-content">
        <p className="agent-plan-explanation small muted">
          The structured plan used by agents and readiness checks. You can
          inspect or edit it; describing your idea above does not require
          filling every field yourself.
        </p>
        {children}
      </div>
    </details>
  );
}
