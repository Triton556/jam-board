import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InputHTMLAttributes } from "react";
import { Button } from "../../components/ui";
import { invalidatePlanning } from "../../lib/planning-queries";
import { usePlanningDraft } from "./planning-draft";

/** A field owns its draft and queued save target independently of entity refreshes. */
export function PlanningInput({
  identity,
  label,
  value,
  save,
  ...props
}: {
  identity: string;
  label: string;
  value: string;
  save(value: string): Promise<unknown>;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur"
>) {
  const client = useQueryClient();
  const draft = usePlanningDraft(value, identity);
  const mutation = useMutation({
    scope: { id: identity },
    mutationFn: (submitted: typeof draft.snapshot & { save: typeof save }) =>
      submitted.save(submitted.draft),
    onSuccess: (_, submitted) => {
      draft.saved(submitted);
      invalidatePlanning(client);
    },
  });
  const submit = () => mutation.mutate({ ...draft.snapshot, save });
  return (
    <>
      <input
        {...props}
        aria-label={label}
        value={draft.value}
        onChange={(e) => draft.change(e.target.value, mutation.isPending)}
        onBlur={() => {
          if (draft.dirty && !draft.conflict) submit();
        }}
      />
      {draft.conflict && (
        <div role="alert">
          {label} changed remotely. Your unsaved draft is kept.
          <Button disabled={props.disabled} onClick={submit}>
            Save my {label}
          </Button>
          <Button onClick={() => draft.reset()}>Use remote {label}</Button>
        </div>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </>
  );
}
