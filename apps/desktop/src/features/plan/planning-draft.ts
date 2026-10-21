import { useState } from "react";

const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/** Keep local input separate from observed query data and acknowledged saves. */
export function usePlanningDraft<T>(value: T) {
  const [state, setState] = useState({
    source: value,
    baseline: value,
    draft: value,
    dirty: false,
  });
  if (!same(state.source, value)) {
    setState({
      source: value,
      baseline: value,
      draft: state.dirty ? state.draft : value,
      dirty: state.dirty,
    });
  }
  return {
    value: state.draft,
    dirty: state.dirty,
    snapshot: { source: state.source, draft: state.draft },
    change(draft: T, pending: boolean) {
      setState((current) => ({
        ...current,
        draft,
        dirty: pending || !same(draft, current.baseline),
      }));
    },
    saved(submitted: { source: T; draft: T }) {
      setState((current) => {
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
