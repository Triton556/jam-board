import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ModalFocusReturn } from "../../components/ui";
import type { AppState, TaskDetail } from "../../lib/types";

/** Synchronous return to the originating Board, never a delayed focus retry. */
export function useBoardReturnFocus(
  taskKey?: string,
): ModalFocusReturn | undefined {
  const client = useQueryClient();
  const scope = useRef({
    mounted: true,
    generation: 0,
    projectId: client.getQueryData<AppState>(["app"])?.jam?.id,
  });
  const sync = useCallback(() => {
    const id = client.getQueryData<AppState>(["app"])?.jam?.id;
    if (id !== scope.current.projectId) {
      scope.current.projectId = id;
      scope.current.generation++;
    }
  }, [client]);
  useEffect(() => {
    scope.current.mounted = true;
    sync();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") sync();
    });
    return () => {
      scope.current.mounted = false;
      unsubscribe();
    };
  }, [client, sync]);
  return useMemo(() => {
    sync();
    if (!taskKey) return undefined;
    const { projectId, generation } = scope.current;
    return () => {
      sync();
      if (
        !scope.current.mounted ||
        !projectId ||
        scope.current.projectId !== projectId ||
        scope.current.generation !== generation
      )
        return null;
      const board = document.querySelector<HTMLElement>(".board-scroll");
      const card = board?.querySelector<HTMLElement>(
        `[data-board-task-key="${CSS.escape(taskKey)}"]`,
      );
      const latest = client.getQueryData<TaskDetail>(["task", taskKey]);
      // Closing before a post-save list read settles must not focus an old
      // column's card that will disappear. Use the stable Board entry instead.
      const reconciled =
        !latest ||
        (latest.jamId === projectId &&
          !latest.archivedAt &&
          latest.status ===
            card?.closest("[data-column]")?.getAttribute("data-column"));
      return card && reconciled ? card : board;
    };
  }, [client, sync, taskKey]);
}
