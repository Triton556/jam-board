import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { MarkdownField } from "../../components/ui/MarkdownField";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
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
      <span className="planning-status-label small muted">Planning status</span>
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
export type PlanningSaveState = {
  label: string;
  pending: boolean;
  error: Error | null;
};
export function SavedMarkdown({
  identity,
  label,
  value,
  save,
  hint,
  onSaveState,
  disabled = false,
}: {
  identity?: string;
  label: string;
  value: string;
  save(value: string): Promise<unknown>;
  hint?: string;
  onSaveState?(identity: string, state: PlanningSaveState | null): void;
  disabled?: boolean;
}) {
  const draft = usePlanningDraft(value, identity);
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
  useEffect(() => {
    if (identity)
      onSaveState?.(identity, {
        label,
        pending: mutation.isPending,
        error: mutation.error,
      });
  }, [identity, label, onSaveState, mutation.isPending, mutation.error]);
  useEffect(
    () => () => {
      if (identity) onSaveState?.(identity, null);
    },
    [identity, onSaveState],
  );
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
      {!onSaveState && mutation.error && (
        <p role="alert">{mutation.error.message}</p>
      )}
    </>
  );
}
export { StoryPicker } from "./StoryPicker";
