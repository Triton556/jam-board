import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../../components/ui";
import { executionQuery } from "../../lib/execution-queries";
import type { TaskDetail } from "../../lib/types";

export function taskExecutionExplanation(status: string, running: boolean) {
  if (status === "in_progress")
    return "This task is already In progress and may report. Scope permission controls new claims, restarts and new assignees.";
  if (status === "review")
    return "Review this task's result and evidence. A requested follow-up still needs scope permission before work starts again.";
  if (status === "done")
    return "This task is marked Done. Reopening work requires the usual brief checks and a started scope.";
  if (status === "backlog")
    return "This is a draft. Refine its brief and mark Ready before asking a worker to take it.";
  return running
    ? "Ready for a connected worker to claim inside this authorized story."
    : "Ready describes the brief. Start this story or its epic before taking new work.";
}

export function TaskExecutionNotice({ task }: { task: TaskDetail }) {
  const state = useQuery(executionQuery({ type: "story", id: task.story.id }));
  const navigate = useNavigate();
  const running = state.data?.effectiveState === "running";
  return (
    <section
      className="task-execution-notice"
      aria-label="Task work permission"
    >
      <div>
        <strong>
          {state.isPending
            ? "Checking work permission…"
            : state.error
              ? "Work permission unavailable"
              : running
                ? "Story allows new work"
                : "New work paused"}
        </strong>
        <p className="small muted">
          {state.error
            ? "Could not refresh this story's work permission. New work is still checked by the board."
            : taskExecutionExplanation(task.status, running)}
        </p>
      </div>
      {state.error && (
        <Button onClick={() => void state.refetch()}>
          Retry permission check
        </Button>
      )}
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
    </section>
  );
}
