import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { appQuery } from "../../lib/queries";
import { StoryPicker } from "./PlanningControls";

type CreationTarget =
  | { kind: "epic" }
  | { kind: "story"; epicKey: string }
  | { kind: "task"; storyKey?: string };

/** One explicit creation attempt; dismissal never pretends to cancel a write. */
export function NewPlanningDialog({
  target,
  close,
  created,
}: {
  target: CreationTarget;
  close(): void;
  created(key: string): void;
}) {
  const [capturedTarget] = useState(target);
  const kind = capturedTarget.kind;
  const [title, setTitle] = useState(""),
    [story, setStory] = useState(
      capturedTarget.kind === "task" ? (capturedTarget.storyKey ?? "") : "",
    );
  const client = useQueryClient();
  const app = useQuery(appQuery);
  const projectId = useRef(app.data?.jam?.id);
  const mounted = useRef(true),
    locked = useRef(false),
    invalidated = useRef(false);
  const [projectChanged, setProjectChanged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "app") return;
      const current = client.getQueryData<
        Awaited<ReturnType<typeof api.appState>>
      >(["app"])?.jam?.id;
      if (!projectId.current && current) projectId.current = current;
      else if (projectId.current && current !== projectId.current) {
        invalidated.current = true;
        setProjectChanged(true);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [client]);
  const save = useMutation({
    retry: false,
    mutationFn: async (input: {
      title: string;
      storyKey: string;
      projectId: string;
    }) => {
      if (invalidated.current) throw new Error("The current project changed.");
      if (capturedTarget.kind === "epic")
        return api.createEpic({ title: input.title });
      if (capturedTarget.kind === "story")
        return api.createStory({
          epicKey: capturedTarget.epicKey,
          title: input.title,
        });
      return api.createTask({
        title: input.title,
        status: "backlog",
        storyKey: input.storyKey,
      });
    },
    onSuccess: (entity, input) => {
      invalidatePlanning(client);
      locked.current = false;
      if (
        mounted.current &&
        !invalidated.current &&
        projectId.current === input.projectId
      ) {
        close();
        created(entity.key);
      }
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  useEffect(() => {
    if (save.isPending) progressRef.current?.focus();
    else if (save.error && !projectChanged) inputRef.current?.focus();
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
    (kind !== "task" || !!story) &&
    !!app.data?.jam &&
    !projectChanged &&
    !save.isPending;
  return (
    <Dialog title={`New ${kind}`} onClose={dismiss} busy={save.isPending}>
      <form
        className="planning-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canCreate || locked.current || invalidated.current) return;
          const id = app.data?.jam?.id;
          if (!id) return;
          projectId.current ??= id;
          if (projectId.current !== id) return;
          locked.current = true;
          save.mutate({ title: title.trim(), storyKey: story, projectId: id });
        }}
      >
        <label>
          Title
          <input
            ref={inputRef}
            aria-label={
              kind === "task"
                ? "New planned task title"
                : kind === "epic"
                  ? "Epic name"
                  : "Story name"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            disabled={save.isPending || projectChanged}
          />
        </label>
        {kind === "task" && (
          <>
            <div className="field">
              <span>Story</span>
              <StoryPicker
                label="Task story"
                value={story}
                onChange={setStory}
                disabled={save.isPending || projectChanged}
              />
            </div>
            <p className="muted">
              Start in Backlog, then write its brief and check readiness.
            </p>
          </>
        )}
        {save.isPending && (
          <p role="status" aria-live="polite" tabIndex={-1} ref={progressRef}>
            Creating {kind}… Wait for the result before closing.
          </p>
        )}
        {projectChanged && (
          <p role="alert">
            The project changed. Close and reopen this form in the intended
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
        {save.error && <p role="alert">{save.error.message}</p>}
        <div className="dialog-actions">
          <Button onClick={dismiss} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canCreate}>
            Create {kind}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
