import { useQuery } from "@tanstack/react-query";
import type { ComponentPropsWithRef } from "react";
import { api } from "../../lib/api";

/** The title is readable with the shell; autosizing uses native field-sizing. */
export function TaskTitleInput(props: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      className="autosize-textarea task-title-input"
      aria-label="Task title"
      rows={2}
      {...props}
    />
  );
}

export function TaskTitlePreview({ taskKey }: { taskKey: string }) {
  const task = useQuery({
    queryKey: ["task", taskKey],
    queryFn: () => api.getTask(taskKey),
  });
  if (!task.data) return null;
  return (
    <div className="task-form">
      <TaskTitleInput
        aria-label="Task title (loading)"
        value={task.data.title}
        readOnly
      />
    </div>
  );
}
