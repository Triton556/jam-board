import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RefItem } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { appQuery } from "../../lib/queries";
import { StoryPicker } from "../plan/PlanningControls";

/** Uses the existing planning dialog controls; its global opener has no prefill API. */
export function NoteTaskDialog({
  item,
  close,
  created,
}: {
  item: RefItem;
  close(): void;
  created(key: string): void;
}) {
  const [title, setTitle] = useState(
    () =>
      item.title || (item.captionMd.split(/\r?\n/, 1)[0] ?? "").slice(0, 80),
  );
  const [description, setDescription] = useState(item.captionMd);
  const [story, setStory] = useState("");
  const client = useQueryClient();
  const app = useQuery(appQuery);
  const [projectChanged, setProjectChanged] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const captured = useRef({ projectId: item.jamId, noteId: item.id });
  const confirmedTask = useRef<string | null>(null);
  const attempted = useRef(false),
    completed = useRef(false),
    locked = useRef(false),
    invalidated = useRef(false),
    mounted = useRef(true);
  const owns = () =>
    mounted.current &&
    !invalidated.current &&
    client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])?.jam
      ?.id === captured.current.projectId;
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      const projectId = client.getQueryData<
        Awaited<ReturnType<typeof api.appState>>
      >(["app"])?.jam?.id;
      if (projectId !== captured.current.projectId) {
        invalidated.current = true;
        setProjectChanged(true);
      }
    };
    check();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [client]);
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!owns())
        throw new Error(
          "The project changed. Reopen this form in the intended project.",
        );
      if (!confirmedTask.current) {
        // A missing create response is not permission to replay creation.
        if (attempted.current)
          throw new Error(
            "Task creation was not confirmed. Check the board before creating another task.",
          );
        attempted.current = true;
        const task = await api.createTask({
          title: title.trim(),
          description,
          status: "backlog",
          storyKey: story || undefined,
        });
        confirmedTask.current = task.key;
        if (!owns())
          throw new Error(
            `Task ${task.key} created; the project changed before linking the note.`,
          );
        setCreatedKey(task.key);
        invalidatePlanning(client);
      }
      const key = confirmedTask.current;
      if (!owns())
        throw new Error(
          `Task ${key} created; the project changed before linking the note.`,
        );
      try {
        await api.linkReference(captured.current.noteId, key);
      } catch {
        throw new Error(`Task ${key} created; linking the note failed`);
      }
      return key;
    },
    onSuccess: (key) => {
      if (!owns() || completed.current) return;
      completed.current = true;
      void client.invalidateQueries({ queryKey: ["references"] });
      created(key);
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  useBlocker({
    shouldBlockFn: () => locked.current,
    enableBeforeUnload: save.isPending,
  });
  const dismiss = () => {
    if (!locked.current) close();
  };
  const cannotCreate =
    !title.trim() ||
    !app.data?.jam ||
    projectChanged ||
    save.isPending ||
    completed.current ||
    (attempted.current && !createdKey);
  return (
    <Dialog title="New task" onClose={dismiss} busy={save.isPending}>
      <form
        className="planning-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (cannotCreate || locked.current || completed.current || !owns())
            return;
          locked.current = true;
          save.mutate();
        }}
      >
        <fieldset
          disabled={save.isPending || projectChanged || !!createdKey}
          className="note-task-fields"
        >
          <label>
            Title
            <input
              aria-label="New planned task title"
              maxLength={140}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              aria-label="New task description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="note-task-story-field">
            <span>Story (optional)</span>
            <StoryPicker
              label="Task story"
              value={story}
              onChange={setStory}
              disabled={save.isPending || projectChanged || !!createdKey}
            />
          </div>
          <p className="small muted">
            New tasks are saved in Backlog. Without a Story, this draft goes to
            Unplanned work.
          </p>
        </fieldset>
        {save.isPending && (
          <p role="status">
            {createdKey ? "Linking note…" : "Creating task…"} Wait for the
            result before closing.
          </p>
        )}
        {projectChanged && (
          <p role="alert">
            The project changed. Close and reopen this form in the intended
            project. An already submitted creation is not cancelled.
          </p>
        )}
        {save.error && (
          <p role="alert">
            {save.error.message}
            {!createdKey &&
              attempted.current &&
              " Check the board before creating another task; the result is unconfirmed."}
          </p>
        )}
        <div className="dialog-actions">
          <Button onClick={dismiss} disabled={save.isPending}>
            {createdKey ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" type="submit" disabled={cannotCreate}>
            {createdKey ? "Retry linking note" : "Create task"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
