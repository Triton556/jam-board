import type { QueryClient } from "@tanstack/react-query";
import type { AppState } from "../bindings";
import { useUiStore } from "./ui-store";

/** Switch cached view state, never the pinned project of an agent session. */
export async function acceptProjectSelection(
  client: QueryClient,
  state: AppState,
) {
  await client.cancelQueries({
    predicate: (query) => query.queryKey[0] !== "planning-draft",
  });
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
  // Detail identities are global, list queries follow the selected project.
  // Unsaved planning drafts stay available when their project is reopened.
  client.removeQueries({
    type: "inactive",
    predicate: (query) =>
      !["app", "planning-draft"].includes(String(query.queryKey[0])),
  });
  await client.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== "planning-draft",
  });
}
