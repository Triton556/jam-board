import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../../components/ui";
import { executionQuery } from "../../lib/execution-queries";
import type { TaskDetail } from "../../lib/types";
import { taskExecutionExplanation } from "../execution/TaskExecutionNotice";
import { claimRecoveryExplanation } from "./ReleaseClaim";

/** Compact presentation of the existing permission read and navigation actions. */
export function TaskPermissionStatus({ task }: { task: TaskDetail }) {
  const state = useQuery(executionQuery({ type: "story", id: task.story.id }));
  const navigate = useNavigate();
  const running = state.data?.effectiveState === "running";
  return (
    <section
      className="task-permission-status"
      aria-label="Task work permission"
    >
      <span className="task-permission-pill">
        {state.isPending
          ? "Checking work permission…"
          : state.error
            ? "Work permission unavailable"
            : running
              ? "Story allows new work"
              : "New work paused"}
      </span>
      <Button
        variant="ghost"
        onClick={() =>
          void navigate({
            to: "/plan/$epicKey",
            params: { epicKey: task.epic.key },
            search: { story: task.story.key },
          })
        }
      >
        Open {task.story.key}
      </Button>
      {state.error && (
        <Button onClick={() => void state.refetch()}>
          Retry permission check
        </Button>
      )}
      <details className="task-status-why">
        <summary>Why?</summary>
        <div className="task-status-explanations">
          <p className="small muted">
            {state.error
              ? "Could not refresh this story's work permission. New work is still checked by the board."
              : taskExecutionExplanation(task.status, running)}
          </p>
          {task.status === "in_progress" && (
            <p className="small muted">{claimRecoveryExplanation}</p>
          )}
        </div>
      </details>
    </section>
  );
}
