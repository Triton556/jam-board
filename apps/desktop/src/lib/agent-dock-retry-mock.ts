import type { AgentDockEvent, ProviderErrorCode } from "./agent-dock-api";

export type MockProviderScenario =
  | "normal"
  | "overloaded"
  | "rate_limited"
  | "auth"
  | "context_too_long"
  | "network"
  | "auto-success"
  | "auto-exhausted";
const scenarios = new Map<string, MockProviderScenario>();
export const setMockProviderScenario = (
  sessionId: string,
  scenario: MockProviderScenario,
) => scenarios.set(sessionId, scenario);
export const resetMockProviderScenarios = () => scenarios.clear();
type Payload = AgentDockEvent extends infer E
  ? E extends AgentDockEvent
    ? Omit<E, "sessionId" | "seq" | "at">
    : never
  : never;
type Turn = { cancelled: boolean; resume?: () => void };
const providerText: Record<ProviderErrorCode, string> = {
  overloaded: "503: This model is currently at capacity. Try again shortly.",
  rate_limited: "429: Rate limit exceeded. Retry-After: 6 seconds.",
  auth: "401: Invalid API key. Check your credentials.",
  context_too_long: "413: The request exceeds this model's context window.",
  network: "The connection was interrupted before the provider responded.",
  provider: "The provider could not complete this request.",
  agent: "The agent could not complete this request.",
};
export async function runMockProviderTurn(
  id: string,
  turn: Turn,
  emit: (id: string, event: Payload) => void,
): Promise<boolean> {
  const scenario = scenarios.get(id) ?? "normal";
  if (scenario === "normal") return false;
  if (scenario === "auto-success" || scenario === "auto-exhausted") {
    for (const [index, delayMs] of [2000, 6000].entries()) {
      emit(id, {
        kind: "retrying",
        attempt: index + 2,
        maxAttempts: 3,
        delayMs,
        code: "overloaded",
      });
      await new Promise<void>((resolve) => {
        const finish = () => {
          turn.resume = undefined;
          resolve();
        };
        const timer = setTimeout(finish, delayMs);
        turn.resume = () => {
          clearTimeout(timer);
          finish();
        };
      });
      if (turn.cancelled) return true;
    }
    if (scenario === "auto-success") {
      emit(id, {
        kind: "agent_message_delta",
        messageId: `retry-success-${Date.now()}`,
        text: "The provider is available again. Your request completed successfully.",
      });
      emit(id, { kind: "turn_end", stopReason: "end_turn" });
      emit(id, { kind: "status", status: "ready" });
      return true;
    }
  }
  const code: ProviderErrorCode =
    scenario === "auto-exhausted" ? "overloaded" : scenario;
  emit(id, {
    kind: "error",
    code,
    message: providerText[code],
    retryable: ["network", "overloaded", "rate_limited"].includes(code),
    retryAfterMs: code === "rate_limited" ? 6000 : null,
  });
  emit(id, { kind: "turn_end", stopReason: "error" });
  emit(id, { kind: "status", status: "ready" });
  return true;
}
