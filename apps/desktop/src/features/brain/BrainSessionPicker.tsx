import { Check } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Tooltip } from "../../components/ui";
import type { AgentSessionView } from "../../lib/agent-dock-api";
import { clearStoppedSessions, useBrainState } from "./brain-store";

export function sessionFolder(cwd: string) {
  const folder =
    cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || cwd;
  return /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i.test(
    folder,
  )
    ? "Project workspace"
    : folder;
}

export function BrainSessionPicker({
  sessions,
  selected,
  choose,
}: {
  sessions: AgentSessionView[];
  selected?: string;
  choose(id: string): void;
}) {
  const titles = useBrainState((state) => state.terminalTitles);
  const hidden = useBrainState((state) => state.hiddenSessions);
  const visible = sessions.filter(
    (session) =>
      !hidden?.[session.id] || !["stopped", "failed"].includes(session.status),
  );
  const stopped = visible.filter((session) =>
    ["stopped", "failed"].includes(session.status),
  );
  const clearFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const picker = clearFocus.current;
    if (!picker) return;
    clearFocus.current = null;
    const remaining = picker.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    if (remaining) remaining.focus();
    else
      picker.parentElement
        ?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
        ?.focus();
  });
  return (
    <>
      {!visible.length && <p>No sessions yet</p>}
      {([false, true] as const).map((inactive) => {
        const group = visible.filter(
          (session) =>
            ["stopped", "failed"].includes(session.status) === inactive,
        );
        return group.length ? (
          <section
            key={String(inactive)}
            aria-label={inactive ? "Stopped" : "Active"}
          >
            <h4>{inactive ? "Stopped" : "Active"}</h4>
            {group.map((session) => {
              const title =
                (session.kind === "terminal" && titles?.[session.id]) ||
                session.title;
              const folder = sessionFolder(session.cwd);
              return (
                <Tooltip key={session.id} text={title}>
                  <button
                    type="button"
                    key={session.id}
                    aria-current={selected === session.id ? "true" : undefined}
                    onClick={() => choose(session.id)}
                  >
                    <span className="brain-picker-title">
                      <strong>{title}</strong>
                      {selected === session.id && (
                        <Check size={14} aria-label="Current session" />
                      )}
                    </span>
                    <small title={session.cwd}>
                      {session.status.replaceAll("_", " ")} · started{" "}
                      {new Date(session.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}{" "}
                      · {folder}
                    </small>
                  </button>
                </Tooltip>
              );
            })}
          </section>
        ) : null;
      })}
      {!!stopped.length && (
        <button
          type="button"
          onClick={(event) => {
            clearFocus.current = event.currentTarget.closest<HTMLElement>(
              '[aria-label="Sessions"]',
            );
            clearStoppedSessions(stopped.map((session) => session.id));
          }}
        >
          Clear stopped
        </button>
      )}
    </>
  );
}
