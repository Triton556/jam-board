import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { useUiStore } from "../../lib/ui-store";

export const loadReadinessDialog = () => import("./Readiness");
const ReadinessDialog = lazy(() =>
  loadReadinessDialog().then((module) => ({ default: module.ReadinessDialog })),
);
function ReadyFallback({ failed = false }: { failed?: boolean }) {
  const request = useUiStore((state) => state.readyRequest);
  if (!request) return null;
  const close = () => useUiStore.setState({ readyRequest: null });
  return (
    <Dialog
      title={`Not ready · ${request.key}`}
      onClose={close}
      className="readiness-dialog"
    >
      <p>Add task details so a worker knows what success looks like.</p>
      <p className="small">
        Ready describes the task plan. It does not grant execution permission or
        launch an agent session.
      </p>
      {failed ? (
        <>
          <p role="alert">
            Could not open readiness review. Close to keep working, or reload
            the app to try again. Unsaved drafts anywhere in the app will be
            lost on reload.
          </p>
          <Button onClick={() => window.location.reload()}>Reload app</Button>
        </>
      ) : (
        <p role="status">Checking the saved brief…</p>
      )}
      <Button onClick={close}>Cancel</Button>
    </Dialog>
  );
}
function ReadyFailure() {
  return <ReadyFallback failed />;
}
export function LazyReadinessDialog() {
  const request = useUiStore((state) => state.readyRequest);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (request) setActive(true);
  }, [request]);
  // Keep the loaded controller mounted so its post-save announcement/focus effect runs.
  if (!request && !active) return null;
  return (
    <ErrorBoundary fallback={<ReadyFailure />}>
      <Suspense fallback={<ReadyFallback />}>
        <ReadinessDialog />
      </Suspense>
    </ErrorBoundary>
  );
}
