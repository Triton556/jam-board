import { useState } from "react";
import { Button } from "../../components/ui";
import type { AgentDockEvent, LaunchWarning } from "../../lib/agent-dock-api";
import { useBrainState } from "./brain-store";

export function retainedWarnings(events: AgentDockEvent[]): LaunchWarning[] {
  return events.flatMap((event) => {
    if (
      event.kind !== "status" ||
      !event.message?.startsWith("Launch warning: ")
    )
      return [];
    try {
      const warning = JSON.parse(
        event.message.slice("Launch warning: ".length),
      );
      return typeof warning.configPath === "string" &&
        typeof warning.suggestedFix === "string"
        ? [{ ...warning, sessionId: event.sessionId }]
        : [];
    } catch {
      return [];
    }
  });
}
export function BrainLaunchWarnings({
  sessionId,
  events,
  focusComposer,
}: {
  sessionId: string;
  events: AgentDockEvent[];
  focusComposer?(): void;
}) {
  const live = useBrainState((s) => s.launchWarnings?.[sessionId]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const warnings = [
    ...new Map(
      [...retainedWarnings(events), ...(live ?? [])].map((w) => [
        w.configPath,
        w,
      ]),
    ).values(),
  ];
  return (
    <>
      {warnings
        .filter((w) => !dismissed.includes(w.configPath))
        .map((w) => (
          <section
            className="brain-launch-warning"
            aria-label="Agent launch warning"
            key={w.configPath}
          >
            <strong>Review a stale Jam Board connection</strong>
            <code>{w.configPath}</code>
            <p>{w.suggestedFix}</p>
            <div className="button-row">
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(w.configPath);
                    setCopied(w.configPath);
                    setError("");
                  } catch {
                    setError(
                      "Could not copy path. Select the path above to copy it.",
                    );
                  }
                }}
              >
                Copy path
              </Button>
              <Button
                data-brain-warning-dismiss
                onClick={(event) => {
                  const dock =
                    event.currentTarget.closest<HTMLElement>(".brain-dock");
                  const dismissButtons = Array.from(
                    dock?.querySelectorAll<HTMLButtonElement>(
                      "[data-brain-warning-dismiss]",
                    ) ?? [],
                  );
                  const index = dismissButtons.indexOf(event.currentTarget);
                  const next =
                    dismissButtons[index + 1] ??
                    dismissButtons.find(
                      (button) => button !== event.currentTarget,
                    );
                  setDismissed((previous) => [...previous, w.configPath]);
                  requestAnimationFrame(() => {
                    if (next?.isConnected) next.focus();
                    else {
                      const composer = dock?.querySelector<HTMLTextAreaElement>(
                        ".brain-composer textarea",
                      );
                      if (composer) composer.focus();
                      else if (focusComposer) focusComposer();
                      else dock?.focus();
                    }
                  });
                }}
              >
                Dismiss
              </Button>
            </div>
            {copied === w.configPath && <p role="status">Path copied</p>}
            {error && <p role="alert">{error}</p>}
          </section>
        ))}
    </>
  );
}
