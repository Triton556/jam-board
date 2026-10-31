export type TaskPresentation = "drawer" | "modal";
export function taskPresentation(value: unknown): TaskPresentation {
  return value === "modal" ? "modal" : "drawer";
}
export function taskViewSearch(value: unknown): "modal" | undefined {
  return value === "modal" ? "modal" : undefined;
}
/** Only presentation may differ; changing task, route or any other search still uses dirty guards. */
export function isTaskPresentationChange(
  current: { pathname: string; search: Record<string, unknown>; hash?: string },
  next: { pathname: string; search: Record<string, unknown>; hash?: string },
) {
  if (
    current.pathname !== next.pathname ||
    current.hash !== next.hash ||
    !current.search.task ||
    current.search.task !== next.search.task
  )
    return false;
  const withoutMode = (search: Record<string, unknown>) =>
    JSON.stringify(
      Object.entries(search)
        .filter(([key, value]) => key !== "taskView" && value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return withoutMode(current.search) === withoutMode(next.search);
}
