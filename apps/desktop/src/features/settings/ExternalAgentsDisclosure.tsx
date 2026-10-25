import type { ReactNode } from "react";
import { usePlanningDraft } from "../plan/planning-draft";
import "./external-agents.css";

export function ExternalAgentsDisclosure({
  children,
}: {
  children: ReactNode;
}) {
  const disclosure = usePlanningDraft(false, "settings:external-agents");
  return (
    <details
      className="external-agents"
      open={disclosure.value}
      onToggle={(event) => {
        if (event.currentTarget.open !== disclosure.value)
          disclosure.change(event.currentTarget.open, false);
      }}
    >
      <summary>
        <span>External agents (MCP)</span>
        <span className="external-agents-description small muted">
          Connect an agent that runs outside Jam Board, such as a terminal or
          IDE session.
        </span>
      </summary>
      <div className="external-agents-content">{children}</div>
    </details>
  );
}
