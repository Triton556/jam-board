import { type ReactNode, useRef } from "react";
import { Button } from "../../components/ui";
import type { PlanningSaveState } from "./PlanningControls";

/** Progressive disclosure only: children stay mounted, registered and unchanged. */
export function AgentPlan({
  summary,
  children,
  saveStates = [],
  readLatest,
  reading = false,
}: {
  summary: string;
  children: ReactNode;
  saveStates?: PlanningSaveState[];
  readLatest?(): void;
  reading?: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const errors = saveStates.filter((state) => state.error);
  const pending = saveStates.filter((state) => state.pending);
  return (
    <>
      <details className="agent-plan" ref={disclosure}>
        <summary>
          <span>Agent plan</span>
          <span className="agent-plan-summary">{summary}</span>
        </summary>
        <div className="agent-plan-content">
          <p className="agent-plan-explanation small muted">
            Agents use these details to plan and check work. You can inspect the
            plan here; editing may be disabled. You do not need to fill every
            field to describe your idea above.
          </p>
          {children}
        </div>
      </details>
      {(pending.length > 0 || errors.length > 0) && (
        <div className="agent-plan-feedback">
          {pending.length > 0 && (
            <p
              role="status"
              aria-label="Agent plan save status"
              className="field-hint"
            >
              Saving agent plan:{" "}
              {pending.map((state) => state.label).join(", ")}…
            </p>
          )}
          {errors.map((state) => (
            <p
              key={state.label}
              role="alert"
              aria-label="Agent plan save problem"
              className="notice"
            >
              {state.label} save is unconfirmed: {state.error?.message}. Your
              draft is kept. Inspect the latest saved content before trying
              again; an error does not prove nothing was saved.
            </p>
          ))}
          {errors.length > 0 && (
            <Button
              onClick={() => {
                if (disclosure.current) {
                  disclosure.current.open = true;
                  disclosure.current.querySelector("summary")?.focus();
                }
              }}
            >
              Open Agent plan to inspect drafts
            </Button>
          )}
          {errors.length > 0 && readLatest && (
            <Button disabled={reading} onClick={readLatest}>
              {reading ? "Reading latest Story…" : "Read latest Story"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
