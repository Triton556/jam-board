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
