import { type RefObject, useEffect, useRef } from "react";

/** Focus after Dialog captures its opener, including fields enabled by project readiness. */
export function useReferenceDialogFocus(
  form: RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const focused = useRef(false);
  useEffect(() => {
    if (!ready || focused.current) return;
    const first = form.current?.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), button[role="combobox"]:not(:disabled)',
    );
    if (first) {
      first.focus();
      focused.current = true;
    }
  }, [form, ready]);
}
