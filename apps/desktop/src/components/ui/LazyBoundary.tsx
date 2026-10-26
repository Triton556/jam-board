import { Link, useRouterState } from "@tanstack/react-router";
import { createContext, type ReactNode, Suspense, useContext } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { Button, Drawer, type ModalFocusReturn } from "./index";

const PageLabel = createContext("screen");

// Keep the error component type stable: Shell clock updates must not replace
// focused recovery controls. Resetting this boundary cannot retry a cached lazy
// rejection, so only an explicit full reload is advertised as a load retry.
function PageLoadError() {
  const label = useContext(PageLabel);
  return (
    <main className="loading">
      <h1>Could not open {label}</h1>
      <p role="alert">
        Return to Board to keep working, or reload the app to try loading again.
        Unsaved drafts anywhere in the app will be lost on reload.
      </p>
      <div className="button-row">
        <Button onClick={() => window.location.reload()}>Reload app</Button>
        <Link to="/board" className="button secondary">
          Back to Board
        </Link>
      </div>
    </main>
  );
}

export function LazyPageBoundary({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <PageLabel.Provider value={label}>
      <ErrorBoundary resetKey={label} fallback={<PageLoadError />}>
        <Suspense
          fallback={
            <main className="loading">
              <p role="status" aria-label={`Loading ${label}`}>
                Loading {label}…
              </p>
              <Link to="/board" className="button secondary">
                Back to Board
              </Link>
            </main>
          }
        >
          {children}
        </Suspense>
      </ErrorBoundary>
    </PageLabel.Provider>
  );
}

type DrawerLoad = {
  title: string;
  kind: "task" | "story";
  close(): void;
  returnFocus?: ModalFocusReturn;
  preview?: ReactNode;
};
const DrawerContext = createContext<DrawerLoad | null>(null);

function DrawerLoadState({ failed = false }: { failed?: boolean }) {
  const state = useContext(DrawerContext);
  const pathname = useRouterState({
    select: (route) => route.location.pathname,
  });
  if (!state) throw new Error("Drawer loading state needs its boundary");
  return (
    <Drawer
      title={state.title}
      onClose={state.close}
      // The lazy editor can replace this shell during its exit animation.
      // Close the route now so resolving the module cannot cancel dismissal.
      onRequestClose={state.close}
      closeLabel={`Close ${state.kind}`}
      returnFocus={state.returnFocus}
      modal={state.kind !== "task" || !/^\/references(?:\/|$)/.test(pathname)}
    >
      {state.preview}
      <div className="drawer-load-state">
        {failed ? (
          <>
            <p role="alert">
              Could not load {state.kind} editor. Close this drawer to keep
              working, or reload the app to try loading again. Unsaved drafts
              anywhere in the app will be lost on reload.
            </p>
            <Button onClick={() => window.location.reload()}>Reload app</Button>
          </>
        ) : (
          <p role="status">Loading {state.kind} editor…</p>
        )}
      </div>
    </Drawer>
  );
}
function DrawerLoadError() {
  return <DrawerLoadState failed />;
}

export function LazyDrawerBoundary({
  children,
  ...state
}: DrawerLoad & { children: ReactNode }) {
  return (
    <DrawerContext.Provider value={state}>
      <ErrorBoundary
        resetKey={`${state.kind}:${state.title}`}
        fallback={<DrawerLoadError />}
      >
        <Suspense fallback={<DrawerLoadState />}>{children}</Suspense>
      </ErrorBoundary>
    </DrawerContext.Provider>
  );
}
