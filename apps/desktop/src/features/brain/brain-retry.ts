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
  usage_limit: "Usage limit reached",
  auth: "Check the API key or sign in",
  context_too_long: "The conversation is too long for this model",
  network: "Can't reach the provider",
  provider: "The provider returned an error",
  agent: "The agent ran into a problem",
};
// Optional adapter data is consumed locally until the bridge exports it.
export type LimitErrorEvent = ProviderErrorEvent & {
  data?: { codexErrorInfo?: string; type?: string };
  codexErrorInfo?: string;
};
export function usageLimit(error: LimitErrorEvent) {
  const text = [error.message, error.detail].filter(Boolean).join(" ");
  const limit =
    error.code === "usage_limit" ||
    error.data?.codexErrorInfo === "usageLimitExceeded" ||
    error.codexErrorInfo === "usageLimitExceeded" ||
    /usageLimitExceeded|usage limit|you(?:'|’)ve hit your limit|out of (?:extra )?usage|limit reached.*reset/is.test(
      text,
    );
  if (!limit) return null;
  const dateText = text
    .match(/try again at\s+(.+?)(?:\.(?:\s|$)|$)/i)?.[1]
    ?.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  const reset = error.resetsAt
    ? new Date(error.resetsAt)
    : dateText
      ? new Date(dateText)
      : null;
  return { reset: reset && Number.isFinite(reset.getTime()) ? reset : null };
}
export function usageResetTime(reset: Date, now = new Date(), locale?: string) {
  return reset.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    ...(reset.getFullYear() !== now.getFullYear()
      ? { year: "numeric" as const }
      : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}
export const providerErrorTitle = (error: ProviderErrorEvent) => {
  const limit = usageLimit(error);
  return limit
    ? "Usage limit reached" +
        (limit.reset ? ` — resets ${usageResetTime(limit.reset)}` : "")
    : providerErrorTitles[error.code ?? "agent"];
};

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
