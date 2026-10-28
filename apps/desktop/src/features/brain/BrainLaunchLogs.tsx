import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type { AgentDockEvent } from "../../lib/agent-dock-api";
import { retainedWarnings } from "./BrainLaunchWarnings";
import { DisabledReason } from "./DisabledReason";

export const launchStateLabels = {
  running: "Running",
  ok: "OK",
  failed: "Failed",
  skipped: "Skipped",
};
function LaunchState({ state }: { state: keyof typeof launchStateLabels }) {
  return (
    <strong
      className={`brain-launch-state ${state === "failed" ? "brain-failure" : ""}`}
      data-state={state}
    >
      {launchStateLabels[state]}
    </strong>
  );
}
export function launchLogTime(at: string) {
  const date = new Date(at);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "Time unavailable";
}
function statusLogMessage(event: Extract<AgentDockEvent, { kind: "status" }>) {
  const warning = retainedWarnings([event])[0];
  return warning
    ? `${warning.configPath} — ${warning.suggestedFix}`
    : event.message || event.status.replaceAll("_", " ");
}

export function launchSteps(events: AgentDockEvent[]) {
  const steps = new Map<
    string,
    Extract<AgentDockEvent, { kind: "launch_step" }>
  >();
  for (const event of events)
    if (event.kind === "launch_step") {
      const previous = steps.get(event.step);
      if (!previous || event.seq > previous.seq) steps.set(event.step, event);
    }
  return [...steps.values()];
}
export function BrainLaunchSteps({ events }: { events: AgentDockEvent[] }) {
  const steps = launchSteps(events);
  return (
    <div
      className="brain-launch-steps"
      role="log"
      aria-label="Launch steps"
      aria-live="polite"
    >
      {steps.length ? (
        <ol>
          {steps.map((step) => (
            <li key={step.step} data-state={step.state}>
              <LaunchState state={step.state} />
              <span>{step.message}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p>Waiting for launch events…</p>
      )}
    </div>
  );
}
export function BrainLaunchLogs({
  title,
  sessionId,
  events,
  close,
}: {
  title: string;
  sessionId?: string;
  events: AgentDockEvent[];
  close(): void;
}) {
  const logs = useQuery({
    queryKey: ["agent-launch-logs", sessionId],
    enabled: !!sessionId,
    queryFn: () => agentDockApi.launchLogs(sessionId ?? ""),
    refetchInterval: 2000,
  });
  const retained = sessionId ? (logs.data ?? []) : events;
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [copyStatus, setCopyStatus] = useState("");
  const [copyError, setCopyError] = useState("");
  useLayoutEffect(() => {
    if (retained.length && pinned.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [retained]);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const trigger = panel.current
      ?.closest(".brain-dock")
      ?.querySelector<HTMLElement>('[aria-label="Session actions"]');
    panel.current?.querySelector("button")?.focus();
    return () => {
      if (
        element?.contains(document.activeElement) ||
        document.activeElement === document.body
      )
        trigger?.focus();
    };
  }, []);
  return (
    <section
      className="brain-launch-logs"
      aria-label="Session logs"
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header>
        <h3>Logs · {title}</h3>
        <div className="button-row">
          <Button onClick={close}>Back to session</Button>
          <DisabledReason
            label="Copy raw"
            reason={!retained.length ? "No log entries yet" : undefined}
          >
            <Button
              variant="ghost"
              disabled={!retained.length}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(retained, null, 2),
                  );
                  setCopyStatus("Raw events copied");
                  setCopyError("");
                } catch {
                  setCopyError("Could not copy raw events. Try again.");
                }
              }}
            >
              Copy raw
            </Button>
          </DisabledReason>
        </div>
      </header>
      <p className="muted">
        Read-only launch and adapter events available for this session.
      </p>
      {sessionId && logs.isPending && <p role="status">Loading launch logs…</p>}
      {logs.error && (
        <p role="alert">
          Could not load launch logs.{" "}
          <Button onClick={() => void logs.refetch()}>Retry</Button>
        </p>
      )}
      {copyStatus && <p role="status">{copyStatus}</p>}
      {copyError && <p role="alert">{copyError}</p>}
      <div
        className="brain-launch-timeline"
        role="log"
        aria-label="Launch timeline"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrolling timeline must support keyboard scrolling.
        tabIndex={0}
        ref={viewport}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        <ol>
          {retained.map((event) => (
            <li
              key={`${event.sessionId}:${event.seq}`}
              className="brain-launch-log-row"
            >
              <time dateTime={event.at}>{launchLogTime(event.at)}</time>
              <div>
                {event.kind === "launch_step" ? (
                  <>
                    <div className="brain-launch-log-heading">
                      <span>{event.step.replaceAll("_", " ")}</span>
                      <LaunchState state={event.state} />
                    </div>
                    <p>{event.message}</p>
                  </>
                ) : event.kind === "launch_log" ? (
                  <>
                    <span className="brain-launch-log-source">
                      Launch · Adapter stderr
                    </span>
                    <pre>{event.message}</pre>
                  </>
                ) : (
                  <>
                    <span className="brain-launch-log-source">Launch</span>
                    <p>
                      {event.kind === "status"
                        ? statusLogMessage(event)
                        : event.kind === "error"
                          ? event.message
                          : event.kind.replaceAll("_", " ")}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!retained.length && (!sessionId || !logs.isPending) && !logs.error && (
          <p>No events received yet.</p>
        )}
      </div>
    </section>
  );
}
