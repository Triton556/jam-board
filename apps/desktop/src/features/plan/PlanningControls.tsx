import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { MarkdownField } from "../../components/ui/MarkdownField";
import { api } from "../../lib/api";
import {
  epicsQuery,
  invalidatePlanning,
  storiesQuery,
} from "../../lib/planning-queries";
import { usePlanningDraft } from "./planning-draft";
export const participationText = {
  each_iteration: "Check each iteration together before continuing.",
  first_sketch: "Agree on the first sketch, then let the brain continue.",
  autonomous: "Let the brain work within the agreed scope and report results.",
};
export function PlanningStatus({
  level,
  entityKey,
  value,
}: {
  level: "Epic" | "Story";
  entityKey: string;
  value: string;
}) {
  const client = useQueryClient(),
    [reason, setReason] = useState("");
  const update = useMutation({
    mutationFn: async ({
      status,
      overrideReason,
    }: {
      status: string;
      overrideReason?: string;
    }) =>
      level === "Epic"
        ? api.setEpicStatus(entityKey, status, overrideReason)
        : api.setStoryStatus(entityKey, status, overrideReason),
    onSuccess: () => {
      setReason("");
      invalidatePlanning(client);
    },
  });
  return (
    <div className="planning-status">
      <span className="planning-status-label small muted">Plan status</span>
      <CustomSelect
        label={`${level} plan status`}
        value={value}
        disabled={update.isPending}
        onChange={(status) => update.mutate({ status })}
        options={["draft", "active", "done", "archived"].map((value) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        }))}
      />
      {update.error && (
        <div className="inline-validation">
          <p role="alert">{update.error.message}</p>
          {update.error.message.toLowerCase().includes("override") && (
            <>
              <textarea
                aria-label={`${level} completion reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why can this be considered done?"
              />
              <Button
                disabled={!reason.trim()}
                onClick={() =>
                  update.mutate({ status: "done", overrideReason: reason })
                }
              >
                Complete anyway
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
export function SavedMarkdown({
  label,
  value,
  save,
  hint,
  disabled = false,
}: {
  label: string;
  value: string;
  save(value: string): Promise<unknown>;
  hint?: string;
  disabled?: boolean;
}) {
  const draft = usePlanningDraft(value);
  const saveScope = useId();
  const client = useQueryClient();
  const mutation = useMutation({
    scope: { id: saveScope },
    mutationFn: (submitted: typeof draft.snapshot & { save: typeof save }) =>
      submitted.save(submitted.draft),
    onSuccess: (_, submitted) => {
      draft.saved(submitted);
      invalidatePlanning(client);
    },
  });
  return (
    <>
      <MarkdownField
        label={label}
        value={draft.value}
        onChange={(text) => {
          draft.change(text, mutation.isPending);
        }}
        onSave={() => {
          if (draft.dirty) mutation.mutate({ ...draft.snapshot, save });
        }}
        hint={hint}
        disabled={disabled}
      />
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </>
  );
}
export function StoryPicker({
  value,
  onChange,
  label = "Story",
  epicKey,
  epicKeys,
  disabled = false,
  remember = false,
}: {
  value: string;
  onChange(key: string): void;
  label?: string;
  epicKey?: string;
  epicKeys?: string[];
  disabled?: boolean;
  remember?: boolean;
}) {
  const stories = useQuery(storiesQuery),
    epics = useQuery(epicsQuery);
  const allowedKeys = epicKeys ?? (epicKey ? [epicKey] : []);
  const allowedIds = new Set(
    (epics.data ?? [])
      .filter((epic) => allowedKeys.includes(epic.key))
      .map((epic) => epic.id),
  );
  return (
    <CustomSelect
      label={label}
      value={value}
      disabled={disabled}
      searchable
      onChange={(key) => {
        onChange(key);
        if (remember)
          try {
            localStorage.setItem("jam.lastStory", key);
          } catch {}
      }}
      options={[
        { value: "", label: "Choose a story" },
        ...(stories.data ?? [])
          .filter((s) => !allowedKeys.length || allowedIds.has(s.epicId))
          .map((s) => ({
            value: s.key,
            label: `${s.key} · ${s.title}`,
            group:
              epics.data?.find((e) => e.id === s.epicId)?.title ?? "Stories",
          })),
      ]}
    />
  );
}
export function NewTaskDialog({
  storyKey,
  close,
  created,
}: {
  storyKey?: string;
  close(): void;
  created(key: string): void;
}) {
  const [title, setTitle] = useState(""),
    [story, setStory] = useState(storyKey ?? "");
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api.createTask({
        title: title.trim(),
        status: "backlog",
        storyKey: story,
      }),
    onSuccess: (task) => {
      invalidatePlanning(client);
      close();
      created(task.key);
    },
  });
  return (
    <Dialog title="New task" onClose={close}>
      <form
        className="planning-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && story) save.mutate();
        }}
      >
        <label>
          Title
          <input
            aria-label="New planned task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
          />
        </label>
        <label htmlFor="new-story-picker">Story</label>
        <StoryPicker label="Task story" value={story} onChange={setStory} />
        <p className="muted">
          Start in Backlog, then write its brief and check readiness.
        </p>
        {save.error && <p role="alert">{save.error.message}</p>}
        <div className="dialog-actions">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!title.trim() || !story || save.isPending}
          >
            Create task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
