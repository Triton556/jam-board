import { CatchBoundary, Link } from "@tanstack/react-router";
import { createContext, type ReactNode, Suspense, useContext } from "react";
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
      <CatchBoundary getResetKey={() => label} errorComponent={PageLoadError}>
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
      </CatchBoundary>
    </PageLabel.Provider>
  );
}

type DrawerLoad = {
  title: string;
  kind: "task" | "story";
  close(): void;
  returnFocus?: ModalFocusReturn;
};
const DrawerContext = createContext<DrawerLoad | null>(null);

function DrawerLoadState({ failed = false }: { failed?: boolean }) {
  const state = useContext(DrawerContext);
  if (!state) throw new Error("Drawer loading state needs its boundary");
  return (
    <Drawer
      title={state.title}
      onClose={state.close}
      closeLabel={`Close ${state.kind}`}
      returnFocus={state.returnFocus}
    >
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
      <CatchBoundary
        getResetKey={() => `${state.kind}:${state.title}`}
        errorComponent={DrawerLoadError}
      >
        <Suspense fallback={<DrawerLoadState />}>{children}</Suspense>
      </CatchBoundary>
    </DrawerContext.Provider>
  );
}
