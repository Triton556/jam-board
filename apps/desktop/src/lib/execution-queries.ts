import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { ExecutionScope } from "./execution-api";
export const executionQuery = (scope: ExecutionScope) => ({
  queryKey: ["execution", scope.type, scope.id],
  queryFn: () => api.getExecution(scope),
});
export const executionRequestsQuery = {
  queryKey: ["executionRequests"],
  queryFn: () => api.listExecutionRequests(),
};
export function invalidateExecution(client: QueryClient) {
  for (const key of [
    "execution",
    "executionRequests",
    "journal",
    "activity",
    "board",
    "boardTasks",
    "task",
  ])
    void client.invalidateQueries({ queryKey: [key] });
}
