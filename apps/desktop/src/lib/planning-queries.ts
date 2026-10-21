import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
export const epicsQuery = {
  queryKey: ["epics"],
  queryFn: () => api.listEpics(),
};
export const questionsQuery = {
  queryKey: ["questions"],
  queryFn: () => api.listQuestions(),
};
export const storiesQuery = {
  queryKey: ["stories"],
  queryFn: () => api.listStories(),
};
export function invalidatePlanning(client: QueryClient) {
  for (const queryKey of [
    ["epics"],
    ["epic"],
    ["stories"],
    ["story"],
    ["questions"],
    ["readiness"],
    ["journal"],
    ["task"],
    ["boardTasks"],
    ["tableTasks"],
    ["board"],
    ["activity"],
    ["members"],
  ])
    void client.invalidateQueries({ queryKey });
}
