import { type Query, useMutation, useQueryClient } from "@tanstack/react-query";
import { type InputHTMLAttributes, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { invalidatePlanning } from "../../lib/planning-queries";
import type { AppState } from "../../lib/types";
import { usePlanningDraft } from "./planning-draft";

type PlanningInputProps = {
  identity: string;
  label: string;
  value: string;
  save(value: string): Promise<unknown>;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur"
>;

/** A field owns its draft and queued save target independently of entity refreshes. */
export function PlanningInput(props: PlanningInputProps) {
  return <ScopedPlanningInput key={props.identity} {...props} />;
}

function ScopedPlanningInput({
  identity,
  label,
  value,
  save,
  ...props
}: PlanningInputProps) {
  const client = useQueryClient();
  const draft = usePlanningDraft(value, identity);
  const live = useRef(true);
  const generation = useRef(0);
  const latestAttempt = useRef(0);
  const [feedback, setFeedback] = useState<{
    kind: "pending" | "saved" | "uncertain" | "not-sent";
    message?: string;
  } | null>(null);
  useEffect(() => {
    live.current = true;
    let project = client.getQueryData<AppState>(["app"])?.jam?.id;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "app") return;
      const next = client.getQueryData<AppState>(["app"])?.jam?.id;
      if (next === project) return;
      project = next;
      generation.current++;
      setFeedback(null);
    });
    return () => {
      live.current = false;
      generation.current++;
      unsubscribe();
    };
  }, [client]);
  type RetainedDraft = {
    source: string;
    baseline: string;
    draft: string;
    dirty: boolean;
  };
  type Attempt = typeof draft.snapshot & {
    save: typeof save;
    generation: number;
    project: string | undefined;
    id: number;
    dispatched: boolean;
    acknowledge: typeof draft.saved;
    bindingCurrent(): boolean;
    stopBinding(): void;
    retainedQuery: Query | undefined;
    baseline: string | undefined;
  };
  const current = (submitted: Attempt) =>
    live.current &&
    submitted.generation === generation.current &&
    submitted.project === client.getQueryData<AppState>(["app"])?.jam?.id;
  const mutation = useMutation({
    scope: { id: identity },
    retry: false,
    mutationFn: (submitted: Attempt) => {
      if (!submitted.project || !current(submitted))
        throw new Error(
          "The project or field changed before this save was sent.",
        );
      submitted.dispatched = true;
      return submitted.save(submitted.draft);
    },
    onSuccess: (_, submitted) => {
      if (!current(submitted)) {
        // A confirmed departed-field write still owns its captured cache baseline,
        // not the current UI. Preserve newer text/dirty state and never announce,
        // invalidate another surface, or acknowledge across project selection ABA.
        const key = ["planning-draft", identity];
        if (
          submitted.bindingCurrent() &&
          submitted.retainedQuery &&
          client.getQueryCache().find({ queryKey: key, exact: true }) ===
            submitted.retainedQuery
        ) {
          client.setQueryData<RetainedDraft>(key, (cached) => {
            if (
              !cached ||
              cached.baseline !== submitted.baseline ||
              (cached.source !== submitted.source &&
                cached.source !== submitted.draft)
            )
              return cached;
            return {
              ...cached,
              baseline: submitted.draft,
              dirty: cached.draft === submitted.draft ? false : cached.dirty,
            };
          });
        }
        return;
      }
      submitted.acknowledge(submitted);
      invalidatePlanning(client);
      if (submitted.id === latestAttempt.current)
        setFeedback({ kind: "saved" });
    },
    onSettled: (_result, _error, submitted) => submitted.stopBinding(),
    onError: (error, submitted) => {
      if (current(submitted) && submitted.id === latestAttempt.current)
        setFeedback({
          kind: submitted.dispatched ? "uncertain" : "not-sent",
          message: error.message,
        });
    },
  });
  const submit = () => {
    const project = client.getQueryData<AppState>(["app"])?.jam?.id;
    let bindingValid = !!project;
    // Outlives the field only until this attempt settles, so project ABA while
    // it is unmounted cannot authorize a late retained-cache acknowledgement.
    const stopBinding = client.getQueryCache().subscribe((event) => {
      if (
        event.query.queryKey[0] === "app" &&
        client.getQueryData<AppState>(["app"])?.jam?.id !== project
      )
        bindingValid = false;
    });
    const key = ["planning-draft", identity];
    setFeedback({ kind: "pending" });
    mutation.mutate({
      ...draft.snapshot,
      save,
      generation: generation.current,
      project,
      bindingCurrent: () =>
        bindingValid &&
        client.getQueryData<AppState>(["app"])?.jam?.id === project,
      stopBinding,
      retainedQuery: client
        .getQueryCache()
        .find({ queryKey: key, exact: true }),
      baseline: client.getQueryData<RetainedDraft>(key)?.baseline,
      id: ++latestAttempt.current,
      dispatched: false,
      acknowledge: draft.saved,
    });
  };
  return (
    <>
      <input
        {...props}
        aria-label={label}
        aria-busy={feedback?.kind === "pending"}
        value={draft.value}
        onChange={(e) => draft.change(e.target.value, mutation.isPending)}
        onBlur={() => {
          if (draft.dirty && !draft.conflict) submit();
        }}
      />
      {feedback?.kind === "pending" ? (
        <small role="status">Saving {label}…</small>
      ) : feedback?.kind === "uncertain" ? (
        <small role="status">Draft kept; save not confirmed.</small>
      ) : draft.dirty ? (
        <small role="status">
          {feedback?.kind === "saved"
            ? "Earlier change saved; newer changes are not saved yet."
            : "Unsaved changes"}
        </small>
      ) : feedback?.kind === "saved" ? (
        <small role="status">{label} saved.</small>
      ) : null}
      {draft.conflict && (
        <div role="alert">
          {label} changed remotely. Your unsaved draft is kept.
          <Button disabled={props.disabled} onClick={submit}>
            Save my {label}
          </Button>
          <Button onClick={() => draft.reset()}>Use remote {label}</Button>
        </div>
      )}
      {(feedback?.kind === "uncertain" || feedback?.kind === "not-sent") && (
        <p role="alert">
          {feedback.kind === "uncertain"
            ? "Save outcome is unconfirmed. Your draft is kept. Check the latest saved value before trying again."
            : "Save was not sent. Your draft is kept."}{" "}
          {feedback.message}
        </p>
      )}
    </>
  );
}
