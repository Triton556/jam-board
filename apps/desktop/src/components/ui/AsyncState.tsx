import { Button, EmptyState } from "./index";
export function PaperSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="paper-skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}
export function QueryError({ error, retry }: { error: Error; retry(): void }) {
  return (
    <EmptyState text="This page needs another try">
      <p role="alert">{error.message}</p>
      <Button variant="primary" onClick={retry}>
        Try again
      </Button>
    </EmptyState>
  );
}

/** Cached read failure: keep editable content mounted; retry only the read. */
export function QueryRefreshNotice({
  error,
  resource,
  retry,
  busy,
}: {
  error: Error;
  resource: string;
  retry(): void;
  busy: boolean;
}) {
  return (
    <div className="query-refresh-notice">
      <p role="alert" className="query-refresh-copy">
        Could not refresh {resource}. Showing the last loaded view.{" "}
        <span className="query-refresh-error-message">{error.message}</span>
      </p>
      <Button disabled={busy} onClick={retry}>
        Try again
      </Button>
      {busy && (
        <p role="status" className="query-refresh-copy">
          Reading {resource}…
        </p>
      )}
    </div>
  );
}
