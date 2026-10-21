import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/** Keep local input separate from observed query data and acknowledged saves. */
export function usePlanningDraft<T>(value: T, identity?: string) {
  const client = useQueryClient();
  const initial = {
    source: value,
    baseline: value,
    draft: value,
    dirty: false,
  };
  // Reuse the existing session cache: drafts survive drawers/tabs, never a restart.
  const cacheKey = ["planning-draft", identity];
  if (identity)
    client.setQueryDefaults(["planning-draft"], { gcTime: Infinity });
  const [state, setState] = useState(() =>
    identity
      ? (client.getQueryData<typeof initial>(cacheKey) ?? initial)
      : initial,
  );
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    if (!identity) return;
    return client.getQueryCache().subscribe((event) => {
      if (
        event.query.queryKey[0] !== "planning-draft" ||
        event.query.queryKey[1] !== identity
      )
        return;
      const next = event.query.state.data as typeof initial | undefined;
      if (next && next !== current.current) {
        current.current = next;
        setState(next);
      }
    });
  }, [client, identity]);
  const update = (fn: (state: typeof initial) => typeof initial) => {
    const next = fn(
      (identity && client.getQueryData<typeof initial>(cacheKey)) ||
        current.current,
    );
    current.current = next;
    if (identity) client.setQueryData(cacheKey, next);
    setState(next);
  };
  if (!same(state.source, value)) {
    update(() => ({
      source: value,
      baseline: state.dirty ? state.baseline : value,
      draft: state.dirty ? state.draft : value,
      dirty: state.dirty,
    }));
  }
  return {
    value: state.draft,
    dirty: state.dirty,
    conflict:
      state.dirty &&
      !same(state.source, state.baseline) &&
      !same(state.source, state.draft),
    reset() {
      update((current) => ({
        ...current,
        baseline: current.source,
        draft: current.source,
        dirty: false,
      }));
    },
    snapshot: { source: state.source, draft: state.draft },
    change(draft: T, pending: boolean) {
      update((current) => ({
        ...current,
        draft,
        dirty: pending || !same(draft, current.baseline),
      }));
    },
    saved(submitted: { source: T; draft: T }) {
      update((current) => {
        // A query may already contain a remote update newer than this response.
        const newerSource =
          !same(current.source, submitted.source) &&
          !same(current.source, submitted.draft);
        const baseline = newerSource ? current.source : submitted.draft;
        return same(current.draft, submitted.draft)
          ? { ...current, baseline, draft: baseline, dirty: false }
          : { ...current, baseline };
      });
    },
  };
}
