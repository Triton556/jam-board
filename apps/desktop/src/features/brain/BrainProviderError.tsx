import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type { ProviderErrorEvent, RetryingEvent } from "./brain-retry";
import { providerErrorTitle, usageLimit } from "./brain-retry";
import "./brain-retry.css";

export function useRetrySeconds(at: string, delayMs: number) {
  const until = useMemo(() => {
    const start = Date.parse(at);
    return (Number.isFinite(start) ? start : Date.now()) + Math.max(0, delayMs);
  }, [at, delayMs]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
export function BrainRetryStatus({ event }: { event: RetryingEvent }) {
  const seconds = useRetrySeconds(event.at, event.delayMs);
  return (
    <p className="brain-retry-status" role="status">
      {seconds
        ? `Retrying in ${seconds} s (${event.attempt}/${event.maxAttempts})…`
        : `Retrying now (${event.attempt}/${event.maxAttempts})…`}
    </p>
  );
}
export function BrainProviderError({
  event,
  active = false,
  failedTurn = false,
  ready = false,
  switchModel,
  restart,
  connections,
  showLogs,
}: {
  event: ProviderErrorEvent;
  active?: boolean;
  failedTurn?: boolean;
  ready?: boolean;
  switchModel?: () => void;
  restart?: () => Promise<void>;
  connections?: () => void;
  showLogs?: () => void;
}) {
  const seconds = useRetrySeconds(
    event.at,
    active ? (event.retryAfterMs ?? 0) : 0,
  );
  const [issued, setIssued] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const startupTimeout = event.message.includes("chat didn't start in time");
  const title = startupTimeout ? event.message : providerErrorTitle(event);
  const limit = usageLimit(event);
  if (!active)
    return (
      <details className="brain-provider-error past">
        <summary title={title}>{title}</summary>
        <pre>{[event.message, event.detail].filter(Boolean).join("\n\n")}</pre>
      </details>
    );
  return (
    <section className="brain-provider-error" role="alert" aria-label={title}>
      <strong>{title}</strong>
      <details>
        <summary>Details</summary>
        <pre>{[event.message, event.detail].filter(Boolean).join("\n\n")}</pre>
      </details>
      <div className="button-row">
        {startupTimeout && (
          <>
            <Button
              variant="primary"
              disabled={issued || !restart}
              onClick={async () => {
                if (lock.current || !restart) return;
                lock.current = true;
                setIssued(true);
                try {
                  await restart();
                } catch (e) {
                  if (mounted.current) setError(String(e));
                } finally {
                  lock.current = false;
                  if (mounted.current) setIssued(false);
                }
              }}
            >
              Retry
            </Button>
            {showLogs && <Button onClick={showLogs}>Show logs</Button>}
          </>
        )}
        {!limit && (event.retryable === true || failedTurn) && (
          <Button
            variant="primary"
            disabled={!ready || !!seconds || issued}
            onClick={async () => {
              if (lock.current || !ready || seconds) return;
              lock.current = true;
              setIssued(true);
              setError("");
              try {
                await agentDockApi.retryTurn(event.sessionId);
              } catch (e) {
                if (mounted.current) {
                  setError(e instanceof Error ? e.message : String(e));
                  setIssued(false);
                }
                lock.current = false;
              }
            }}
          >
            {issued ? "Retrying…" : seconds ? `Retry in ${seconds} s` : "Retry"}
          </Button>
        )}
        {!limit &&
          ["overloaded", "rate_limited", "context_too_long"].includes(
            event.code ?? "",
          ) && (
            <Button
              disabled={!ready || issued || !switchModel}
              title={
                !switchModel
                  ? "This connection has not offered model controls."
                  : undefined
              }
              onClick={switchModel}
            >
              Switch model
            </Button>
          )}
        {!limit && !startupTimeout && !failedTurn && restart && (
          <Button onClick={() => void restart()}>Restart session</Button>
        )}
        {(limit || !failedTurn) && connections && (
          <Button variant="ghost" onClick={connections}>
            {limit ? "Switch connection" : "Connections…"}
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
