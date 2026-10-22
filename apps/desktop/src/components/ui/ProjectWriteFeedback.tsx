import { type RefObject, useEffect, useRef } from "react";
import type { ProjectWriteState } from "../../lib/use-project-write";
import { Button } from "./index";

/** Visible pending feedback belongs outside any disabled fieldset. */
export function ProjectWriteFeedback({
  write,
  action,
  form,
  focusPending = true,
}: {
  write: ProjectWriteState;
  action: string;
  form?: RefObject<HTMLElement | null>;
  focusPending?: boolean;
}) {
  const progress = useRef<HTMLParagraphElement>(null),
    changed = useRef<HTMLParagraphElement>(null);
  const wasPending = useRef(false);
  useEffect(() => {
    if (write.pending && focusPending) progress.current?.focus();
    else if (write.changed) changed.current?.focus();
    else if (wasPending.current && write.error) {
      const root = form?.current;
      (
        root?.querySelector<HTMLElement>("[data-write-focus]:not(:disabled)") ??
        root?.querySelector<HTMLElement>(
          "input:not(:disabled),textarea:not(:disabled),button:not(:disabled)",
        )
      )?.focus();
    }
    wasPending.current = write.pending;
  }, [write.pending, write.changed, write.error, form, focusPending]);
  return (
    <>
      {write.pending && (
        <p ref={progress} role="status" aria-live="polite" tabIndex={-1}>
          {action}… Wait for the result before closing.
        </p>
      )}
      {write.changed && (
        <p ref={changed} role="alert" tabIndex={-1}>
          The project or form target changed. Close and reopen in the intended
          context. An already submitted write is not cancelled.
        </p>
      )}
      {write.checking && <p role="status">Checking the current project…</p>}
      {write.contextError && (
        <div>
          <p role="alert">
            Could not check the current project: {write.contextError.message}
          </p>
          <Button onClick={write.retryContext}>Retry project check</Button>
        </div>
      )}
      {write.error && (
        <p role="alert">
          {write.error instanceof Error
            ? write.error.message
            : String(write.error)}
        </p>
      )}
    </>
  );
}
