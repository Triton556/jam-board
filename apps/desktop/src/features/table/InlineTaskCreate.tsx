import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning, storiesQuery } from "../../lib/planning-queries";
import { appQuery } from "../../lib/queries";
import {
  labels,
  type Status,
  statuses,
  type TaskSummary,
} from "../../lib/types";
import { StoryPicker } from "../plan/PlanningControls";

/** The editor is outside the virtualized, fixed-height header: feedback stays visible. */
export function InlineTaskCreate({
  close,
  created,
  busy,
}: {
  close(): void;
  created(task: TaskSummary): void;
  busy(value: boolean): void;
}) {
  const [title, setTitle] = useState("");
  const [story, setStory] = useState(() => {
    try {
      return localStorage.getItem("jam.lastStory") ?? "";
    } catch {
      return "";
    }
  });
  const [status, setStatus] = useState<Status>("backlog");
  const [priority, setPriority] = useState("medium");
  const app = useQuery(appQuery),
    stories = useQuery(storiesQuery),
    client = useQueryClient();
  const project = useRef(app.data?.jam?.id),
    invalidated = useRef(false),
    mounted = useRef(true),
    locked = useRef(false);
  const [projectChanged, setProjectChanged] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    progress = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    mounted.current = true;
    input.current?.focus();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "app") return;
      const id = client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
        "app",
      ])?.jam?.id;
      if (!project.current && id) project.current = id;
      else if (project.current && project.current !== id) {
        invalidated.current = true;
        setProjectChanged(true);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      busy(false);
    };
  }, [client, busy]);
  const save = useMutation({
    retry: false,
    mutationFn: async (submitted: {
      projectId: string;
      input: Parameters<typeof api.createTask>[0];
    }) => {
      if (invalidated.current || submitted.projectId !== project.current)
        throw new Error(
          "The current project changed. Reopen this editor in the intended project.",
        );
      return api.createTask(submitted.input);
    },
    onSuccess: (task, submitted) => {
      invalidatePlanning(client);
      locked.current = false;
      if (
        mounted.current &&
        !invalidated.current &&
        submitted.projectId === project.current
      ) {
        busy(false);
        created(task);
      }
    },
    onSettled: () => {
      locked.current = false;
      if (mounted.current) busy(false);
    },
  });
  useEffect(() => {
    if (save.isPending) progress.current?.focus();
    else if (save.error && !projectChanged) input.current?.focus();
  }, [save.isPending, save.error, projectChanged]);
  useBlocker({
    shouldBlockFn: () => locked.current,
    enableBeforeUnload: save.isPending,
  });
  const dismiss = () => {
    if (!locked.current) close();
  };
  const canCreate =
    !!title.trim() &&
    !!stories.data?.some((s) => s.key === story) &&
    !!app.data?.jam &&
    !projectChanged &&
    !save.isPending;
  return (
    <form
      className="table-inline-create"
      aria-label="New table task"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate || locked.current || invalidated.current) return;
        const id = app.data?.jam?.id;
        if (!id) return;
        project.current ??= id;
        if (project.current !== id) return;
        locked.current = true;
        busy(true);
        save.mutate({
          projectId: id,
          input: { title: title.trim(), storyKey: story, status, priority },
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <div className="inline-task-form">
        <input
          ref={input}
          aria-label="New task title"
          placeholder="What needs making?"
          maxLength={140}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={save.isPending || projectChanged}
        />
        <StoryPicker
          label="New task story"
          value={story}
          onChange={setStory}
          remember
          disabled={save.isPending || projectChanged}
        />
        <Select
          aria-label="New task status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status)}
          disabled={save.isPending || projectChanged}
        >
          {statuses.map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="New task priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          disabled={save.isPending || projectChanged}
        >
          {["low", "medium", "high", "critical"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Button variant="primary" type="submit" disabled={!canCreate}>
          Create
        </Button>
        <Button onClick={dismiss} disabled={save.isPending}>
          Cancel new task
        </Button>
      </div>
      {save.isPending && (
        <p role="status" aria-live="polite" tabIndex={-1} ref={progress}>
          Creating task… Wait for the result before closing.
        </p>
      )}
      {projectChanged && (
        <p role="alert">
          The project changed. Close and reopen this editor in the intended
          project. An already submitted creation is not cancelled.
        </p>
      )}
      {app.isPending && <p role="status">Checking the current project…</p>}
      {app.error && (
        <div>
          <p role="alert">
            Could not check the current project: {app.error.message}
          </p>
          <Button onClick={() => void app.refetch()}>
            Retry project check
          </Button>
        </div>
      )}
      {stories.error && (
        <div>
          <p role="alert">Could not read stories: {stories.error.message}</p>
          <Button onClick={() => void stories.refetch()}>Retry stories</Button>
        </div>
      )}
      {save.error && <p role="alert">{save.error.message}</p>}
    </form>
  );
}
