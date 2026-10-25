import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";

export function BrainLoadState({
  label,
  retry,
  close,
}: {
  label: string;
  retry?: () => void;
  close?: () => void;
}) {
  return (
    <div className="brain-load-state">
      <p role={retry ? "alert" : "status"}>
        {retry ? `Could not load ${label}.` : `Loading ${label}…`}
      </p>
      <div className="button-row">
        {retry && (
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        )}
        {close && (
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
/** Reset React's rejected promise; the module loader also refreshes failed URLs. */
export function createBrainSurface<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
  fallback?: (props: Props, retry?: () => void) => ReactNode,
) {
  return function BrainSurface(props: Props) {
    const [Surface, setSurface] = useState(() => lazy(load));
    const [attempt, setAttempt] = useState(0);
    const retry = () => {
      setSurface(() => lazy(load));
      setAttempt((value) => value + 1);
    };
    const placeholder = (retry?: () => void) =>
      fallback ? (
        fallback(props, retry)
      ) : (
        <BrainLoadState label={label} retry={retry} />
      );
    const failure = useRef<() => ReactNode>(placeholder);
    failure.current = () => placeholder(retry);
    // A stable error component keeps Retry focused when the shell updates.
    const [ErrorView] = useState(() => () => failure.current());
    return (
      <ErrorBoundary resetKey={attempt} fallback={<ErrorView />}>
        <Suspense fallback={placeholder()}>
          <Surface {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  };
}
