import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
export function useMoveTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveInput) => api.moveTask(input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ["boardTasks"] });
      const snapshot = client.getQueryData<BoardTasks>(["boardTasks"]);
      const captured =
        snapshot &&
        Object.values(snapshot)
          .flat()
          .find((task) => task.key === input.key);
      if (snapshot && captured?.updatedAt === input.expectedUpdatedAt) {
        const dest = snapshot[input.status].filter((t) => t.key !== input.key);
        const index = input.beforeKey
          ? dest.findIndex((t) => t.key === input.beforeKey)
          : input.afterKey
            ? dest.findIndex((t) => t.key === input.afterKey) + 1
            : dest.length;
        client.setQueryData(
          ["boardTasks"],
          relocate(snapshot, input.key, input.status, index),
        );
      }
      return { snapshot };
    },
    onError: (error, input, context) => {
      const stale = "code" in error && error.code === "conflict";
      // Never roll a newer event back to a stale optimistic snapshot. The
      // settled refetch restores authoritative state after a refused intent.
      if (context?.snapshot && !stale)
        client.setQueryData(["boardTasks"], context.snapshot);
      useUiStore
        .getState()
        .error(
          `Couldn't move ${input.key} — ${error.message}${stale ? " The board is being refreshed. Inspect the task before moving it again." : ""}`,
        );
      if ("code" in error && error.code === "not_ready")
        useUiStore.setState({ readyRequest: input });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["boardTasks"] }),
  });
}
