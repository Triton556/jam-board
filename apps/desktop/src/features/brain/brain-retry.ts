import type {
  AgentDockEvent,
  ProviderErrorCode,
  SessionStatus,
} from "../../lib/agent-dock-api";

export type ProviderErrorEvent = Extract<AgentDockEvent, { kind: "error" }>;
export type RetryingEvent = Extract<AgentDockEvent, { kind: "retrying" }>;
export const providerErrorTitles: Record<ProviderErrorCode, string> = {
  overloaded: "The model is busy right now",
  rate_limited: "Rate limit reached",
  auth: "Check the API key or sign in",
  context_too_long: "The conversation is too long for this model",
  network: "Can't reach the provider",
  provider: "The provider returned an error",
  agent: "The agent ran into a problem",
};
export const providerErrorTitle = (error: ProviderErrorEvent) =>
  providerErrorTitles[error.code ?? "agent"];

/** A retry begins a new attempt even when the backend retains the original user event. */
export function latestTurnError(events: AgentDockEvent[]) {
  const error = events.filter((event) => event.kind === "error").at(-1);
  if (!error) return null;
  const index = events.indexOf(error);
  if (
    events
      .slice(index + 1)
      .some(
        (event) =>
          event.kind === "user_message" ||
          event.kind === "retrying" ||
          event.kind === "agent_message_delta" ||
          event.kind === "agent_thought_delta" ||
          event.kind === "tool_call" ||
          (event.kind === "status" &&
            ["starting", "running"].includes(event.status)) ||
          (event.kind === "turn_end" && event.stopReason !== "error"),
      )
  )
    return null;
  const user = events
    .slice(0, index)
    .filter((event) => event.kind === "user_message")
    .at(-1);
  const lastUser = user ? events.indexOf(user) : -1;
  const failedTurn =
    lastUser >= 0 &&
    !events
      .slice(lastUser + 1, index)
      .some(
        (event) => event.kind === "turn_end" && event.stopReason !== "error",
      );
  return { error, failedTurn };
}
export function activeRetry(events: AgentDockEvent[], status: SessionStatus) {
  if (["stopped", "failed"].includes(status)) return null;
  const retry = events.filter((event) => event.kind === "retrying").at(-1);
  if (!retry) return null;
  return events
    .slice(events.indexOf(retry) + 1)
    .some(
      (event) =>
        [
          "user_message",
          "error",
          "turn_end",
          "agent_message_delta",
          "agent_thought_delta",
          "tool_call",
        ].includes(event.kind) || event.kind === "status",
    )
    ? null
    : retry;
}
