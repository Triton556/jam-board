import { hashKey, type QueryClient } from "@tanstack/react-query";
import type { AppState, ProjectEventContext } from "../bindings";
import { api } from "./api";
import { useUiStore } from "./ui-store";

const selections = new WeakMap<QueryClient, ProjectEventContext>();
const globalQueries = new Set([
  "app",
  "selection-scope",
  "project-folders",
  "projects",
  "runtime",
]);
export function selectedContext(client: QueryClient) {
  return selections.get(client);
}
export function selectionIdentity(context?: ProjectEventContext) {
  return context
    ? `${context.instanceId}:${context.projectId}:${context.databaseGeneration}`
    : "unselected";
}
export function matchingSelection(
  client: QueryClient,
  event?: ProjectEventContext | null,
) {
  const current = selectedContext(client);
  return (
    !!event &&
    !!current &&
    selectionIdentity(event) === selectionIdentity(current) &&
    event.selectionEpoch === current.selectionEpoch
  );
}
export async function captureSelection(
  state: AppState,
): Promise<ProjectEventContext | undefined> {
  if (!state.jam) return undefined;
  const [context, live] = await Promise.all([
    api.projectSelectionContext(),
    api.appState(),
  ]);
  if (live.jam?.id !== state.jam.id)
    throw new Error("Project changed — reopen");
  if (!context) throw new Error("Project selection is unavailable");
  let generation = "legacy";
  if (!context.instanceId.includes("legacy")) {
    const info = await api.projectFolderInfo();
    if (
      info.context.instanceId !== context.instanceId ||
      info.context.selectionEpoch !== context.selectionEpoch ||
      info.projectId !== state.jam.id
    )
      throw new Error("Project changed — reopen");
    generation = info.databaseGeneration;
  }
  return {
    ...context,
    projectId: state.jam.id,
    databaseGeneration: generation,
  };
}

/** Replace the cache namespace before exposing a selected or recovered board to editors. */
export async function acceptProjectSelection(
  client: QueryClient,
  state: AppState,
) {
  const context = await captureSelection(state);
  await client.cancelQueries();
  const current = context ? await api.projectSelectionContext() : null;
  if (
    context &&
    (current?.instanceId !== context.instanceId ||
      current.selectionEpoch !== context.selectionEpoch)
  )
    throw new Error("Project changed — reopen");
  const previous = selections.get(client);
  if (
    previous &&
    context &&
    previous.instanceId === context.instanceId &&
    previous.databaseGeneration !== context.databaseGeneration
  ) {
    const oldScope = selectionIdentity(previous);
    client.removeQueries({
      predicate: (query) =>
        !globalQueries.has(String(query.queryKey[0])) &&
        query.meta?.jamScope === oldScope,
    });
  }
  if (context) selections.set(client, context);
  else selections.delete(client);
  const scope = selectionIdentity(context);
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      meta: { ...defaults.queries?.meta, jamScope: scope },
      queryKeyHashFn: (key) =>
        hashKey(globalQueries.has(String(key[0])) ? key : [scope, ...key]),
    },
  });
  client.setQueryData(["selection-scope"], context ?? null);
  client.setQueryData(["app"], state);
  useUiStore.setState({
    quickColumn: null,
    readyRequest: null,
    taskChanges: {},
    boardEvents: [],
    highlights: {},
    agentPulse: {},
    toasts: [],
  });
  await client.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] !== "planning-draft" &&
      query.meta?.jamScope === scope &&
      !globalQueries.has(String(query.queryKey[0])),
    // Observers still attached to A must never refetch B into A's namespace.
    // The selection render rebinds them; entering queries then read the selected handle.
    refetchType: "none",
  });
  await client.invalidateQueries({
    predicate: (query) =>
      ["projects", "project-folders"].includes(String(query.queryKey[0])),
  });
}
