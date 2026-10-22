import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "./api";
import type { BoardTasks, MoveInput, Status } from "./types";
import { emptyBoard, statuses } from "./types";
import { useUiStore } from "./ui-store";
export const settingsQuery = {
  queryKey: ["settings"],
  queryFn: () => api.getSettings(),
};
export function useBoardSettings() {
  const client = useQueryClient();
  const settings = useQuery(settingsQuery);
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.setSettings>[0]) =>
      api.setSettings(input),
    onSuccess: (next) => client.setQueryData(["settings"], next),
    onError: (error) => useUiStore.getState().error(error.message),
  });
  return { settings: settings.data, update: update.mutate };
}
export const appQuery = { queryKey: ["app"], queryFn: () => api.appState() };
export const tasksQuery = {
  queryKey: ["boardTasks"],
  queryFn: () => api.listBoardTasks(),
};
export const boardQuery = {
  queryKey: ["board"],
  queryFn: () => api.getBoard(),
};
export const membersQuery = {
  queryKey: ["members"],
  queryFn: () => api.listMembers(),
};
export function relocate(
  board: BoardTasks,
  key: string,
  status: Status,
  index: number,
) {
  const result = emptyBoard();
  const task = statuses.flatMap((s) => board[s]).find((t) => t.key === key);
  for (const s of statuses) result[s] = board[s].filter((t) => t.key !== key);
  if (task) result[status].splice(Math.max(0, index), 0, { ...task, status });
  return result;
}
export function moveInput(
  board: BoardTasks,
  key: string,
  status: Status,
  expectedUpdatedAt: string,
): MoveInput {
  const index = board[status].findIndex((t) => t.key === key);
  return {
    key,
    expectedUpdatedAt,
    status,
    afterKey: board[status][index - 1]?.key,
    beforeKey: board[status][index + 1]?.key,
  };
}
/** A move belongs to one mounted view and selection generation, including A→B→A. */
export function useMoveTask() {
  const client = useQueryClient();
  const [, refreshOwnership] = useReducer((value: number) => value + 1, 0);
  const scope = useRef({
    mounted: true,
    generation: 0,
    projectId: client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
      "app",
    ])?.jam?.id,
  });
  const checkSelection = useCallback(
    (notify = false) => {
      const id = client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
        "app",
      ])?.jam?.id;
      if (id !== scope.current.projectId) {
        scope.current.projectId = id;
        scope.current.generation++;
        if (notify) refreshOwnership();
      }
    },
    [client],
  );
  useEffect(() => {
    scope.current.mounted = true;
    checkSelection();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") checkSelection(true);
    });
    return () => {
      scope.current.mounted = false;
      scope.current.generation++;
      unsubscribe();
    };
  }, [client, checkSelection]);
  type Attempt = {
    input: MoveInput;
    projectId: string | undefined;
    generation: number;
    dispatched: boolean;
  };
  const pending = useRef(new Set<Attempt>());
  const eligible = (attempt: Attempt) => {
    checkSelection();
    return (
      scope.current.mounted &&
      !!attempt.projectId &&
      attempt.projectId === scope.current.projectId &&
      attempt.generation === scope.current.generation
    );
  };
  const capture = (input: MoveInput): Attempt => {
    checkSelection();
    return {
      input: { ...input },
      projectId: scope.current.projectId,
      generation: scope.current.generation,
      dispatched: false,
    };
  };
  const mutation = useMutation({
    retry: false,
    mutationFn: (attempt: Attempt) => {
      if (!eligible(attempt))
        throw new Error(
          "The project or board changed before this move was sent.",
        );
      attempt.dispatched = true;
      pending.current.add(attempt);
      refreshOwnership();
      return api.moveTask(attempt.input);
    },
    onError: (error, attempt) => {
      if (!eligible(attempt) || !attempt.dispatched) return;
      const code = "code" in error ? error.code : undefined;
      const knownRefusal =
        code === "conflict" ||
        code === "not_ready" ||
        code === "execution_required";
      // Native persistence can precede a notification/IPC error. Never restore
      // a whole-board snapshot or describe a generic rejection as a rollback.
      if (knownRefusal)
        useUiStore
          .getState()
          .error(
            `Couldn't move ${attempt.input.key} — ${error.message} The board is being refreshed. Inspect the task before moving it again.`,
          );
      else
        useUiStore
          .getState()
          .notify(
            `Move result unconfirmed for ${attempt.input.key}. It may already have been saved.`,
            {
              persistent: true,
              details: [{ label: "Unconfirmed move", text: error.message }],
              hint: "The board is being refreshed; if that read fails, use Try again before inspecting the task. Nothing was automatically retried or rolled back.",
            },
          );
      if (code === "not_ready")
        useUiStore.setState({ readyRequest: attempt.input });
    },
    onSettled: async (_data, _error, attempt) => {
      try {
        if (eligible(attempt) && attempt.dispatched)
          await client.invalidateQueries({ queryKey: ["boardTasks"] });
      } finally {
        pending.current.delete(attempt);
        if (scope.current.mounted) refreshOwnership();
      }
    },
  });
  const owned = !!mutation.variables && eligible(mutation.variables);
  return {
    ...mutation,
    isPending:
      (owned && mutation.isPending) || [...pending.current].some(eligible),
    error: owned ? mutation.error : null,
    isError: owned && mutation.isError,
    mutate: (input: MoveInput) => mutation.mutate(capture(input)),
    mutateAsync: (input: MoveInput) => mutation.mutateAsync(capture(input)),
  };
}
