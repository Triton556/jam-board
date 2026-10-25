import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { api } from "./api";
import { appQuery } from "./queries";

type Attempt = {
  projectId: string;
  perform(): Promise<unknown>;
  complete(value: unknown): void;
};
/** UI intent fence, not server idempotency, rollback, or an execution grant. */
export function useProjectWrite(scope: string, expectedProjectId?: string) {
  const client = useQueryClient(),
    app = useQuery(appQuery);
  const project = useRef(expectedProjectId ?? app.data?.jam?.id);
  const initialScope = useRef(scope),
    mounted = useRef(true),
    locked = useRef(false),
    invalidated = useRef(false);
  const [projectChanged, setChanged] = useState(false);
  // Fence a changed scope synchronously, without scheduling state during render.
  if (scope !== initialScope.current) invalidated.current = true;
  const changed = projectChanged || invalidated.current;
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      const id = client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
        "app",
      ])?.jam?.id;
      if (!project.current && id) project.current = id;
      else if (project.current && id && project.current !== id) {
        invalidated.current = true;
        setChanged(true);
      }
    };
    check();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      // useQuery adds/updates observers during render. Only cache state updates
      // can change the project; observer bookkeeping must not notify other UIs.
      if (event.type === "updated" && event.query.queryKey[0] === "app")
        check();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [client]);
  const eligible = (id: string) =>
    mounted.current &&
    !invalidated.current &&
    project.current === id &&
    client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])?.jam
      ?.id === id;
  const save = useMutation({
    retry: false,
    mutationFn: async (attempt: Attempt) => {
      if (!eligible(attempt.projectId))
        throw new Error(
          "The project or form target changed before this write was sent.",
        );
      // Capture the operation itself, not a later render's mutable props/selection.
      return attempt.perform();
    },
    onSuccess: (result, attempt) => {
      locked.current = false;
      if (eligible(attempt.projectId)) attempt.complete(result);
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  useBlocker({
    shouldBlockFn: () => locked.current,
    enableBeforeUnload: save.isPending,
  });
  const ready =
    !!app.data?.jam &&
    app.data.jam.id === project.current &&
    !app.error &&
    !changed &&
    !save.isPending;
  const run = <T>(
    perform: () => Promise<T>,
    complete: (result: T) => void = () => {},
  ) => {
    const id = project.current;
    if (!ready || !id || locked.current || !eligible(id)) return false;
    locked.current = true;
    save.mutate({
      projectId: id,
      perform,
      complete: (value) => complete(value as T),
    });
    return true;
  };
  return {
    pending: save.isPending,
    error: save.error,
    changed,
    ready,
    checking: app.isPending,
    contextError: app.error,
    retryContext: () => void app.refetch(),
    isLocked: () => locked.current,
    run,
    dismiss: (close: () => void) => {
      if (!locked.current) close();
    },
  };
}
export type ProjectWriteState = ReturnType<typeof useProjectWrite>;
