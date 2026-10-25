import { agentDockApi } from "../../lib/agent-dock";
import { useUiStore } from "../../lib/ui-store";
import { processSessionOptions } from "./brain-settings";
import { useBrainState } from "./brain-store";

/** The subscription stays alive when the dock closes; loading it never starts a session. */
export function connectBrain(projectId: string) {
  let disposed = false;
  const updateActivity = () => {
    const sessions = useBrainState.getState().sessions;
    const status = sessions.some((s) => s.status === "awaiting_permission")
      ? "needs-you"
      : sessions.some((s) => s.status === "failed")
        ? "error"
        : sessions.some((s) => ["running", "starting"].includes(s.status))
          ? "working"
          : null;
    useBrainState.setState({
      activity: status
        ? {
            status,
            label:
              status === "needs-you"
                ? "Brain needs you"
                : status === "error"
                  ? "Brain error"
                  : "Brain working",
            tooltip:
              status === "needs-you"
                ? "Needs you"
                : status === "error"
                  ? "Error — open to see"
                  : `${sessions.find((s) => ["running", "starting"].includes(s.status))?.title ?? "Brain"} · working`,
          }
        : null,
    });
  };
  const offActivity = useBrainState.subscribe((next, previous) => {
    if (next.sessions !== previous.sessions) updateActivity();
    if (next.events !== previous.events || next.sessions !== previous.sessions)
      processSessionOptions(projectId);
  });
  updateActivity();
  const off = agentDockApi.onEvent((event) => {
    if (!disposed) useBrainState.getState().ingest(event);
  });
  void (async () => {
    try {
      const sessions = (await agentDockApi.sessions()).filter(
        (s) => s.projectId === projectId,
      );
      if (disposed) return;
      useBrainState.setState((s) => ({
        sessions,
        selected: {
          chat: sessions.some((item) => item.id === s.selected.chat)
            ? s.selected.chat
            : (sessions.find((item) => item.kind !== "terminal")?.id ?? null),
          terminal: sessions.some((item) => item.id === s.selected.terminal)
            ? s.selected.terminal
            : (sessions.find((item) => item.kind === "terminal")?.id ?? null),
        },
      }));
      for (const session of sessions) {
        const history = await agentDockApi.history(session.id);
        if (disposed) return;
        for (const event of history) useBrainState.getState().ingest(event);
      }
    } catch (error) {
      if (!disposed)
        useUiStore
          .getState()
          .error(`Could not load brain sessions: ${String(error)}`);
    }
  })();
  return () => {
    disposed = true;
    off();
    offActivity();
  };
}
