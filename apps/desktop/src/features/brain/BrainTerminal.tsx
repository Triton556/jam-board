import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentProfileView,
  AgentSessionView,
} from "../../lib/agent-dock-api";
import "@xterm/xterm/css/xterm.css";
import { quotedPaths, useDockFileDrop } from "./BrainAttachments";

export function BrainTerminal({
  session,
  profile,
  restart,
  focusEpoch = 0,
}: {
  session: AgentSessionView;
  profile?: AgentProfileView;
  restart(): Promise<void>;
  focusEpoch?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const focusRequested = useRef(focusEpoch >= 0);
  focusRequested.current = focusEpoch >= 0;
  useEffect(() => {
    if (focusEpoch >= 0) terminalRef.current?.focus();
  }, [focusEpoch]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dropOverlay = useDockFileDrop(
    host,
    (files) => {
      const paths = files.map(
        (file) => (file as File & { path?: string }).path ?? file.name,
      );
      void agentDockApi
        .terminalWrite({ sessionId: session.id, data: quotedPaths(paths) })
        .catch((e) => setError(String(e)));
    },
    (paths) => {
      void agentDockApi
        .terminalWrite({ sessionId: session.id, data: quotedPaths(paths) })
        .catch((e) => setError(String(e)));
    },
  );
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let off: (() => void) | undefined;
    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
      fontSize: 12,
      cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    terminal.loadAddon(fit);
    terminal.open(host.current);
    if (focusRequested.current) terminal.focus();
    const theme = () => {
      const tokens = getComputedStyle(document.documentElement);
      terminal.options.theme = {
        background: tokens.getPropertyValue("--paper").trim() || "#faf7f0",
        foreground: tokens.getPropertyValue("--ink").trim() || "#302c28",
        cursor: tokens.getPropertyValue("--coral").trim() || "#d66a55",
        selectionBackground:
          tokens.getPropertyValue("--line-soft").trim() || "#ccc4b8",
      };
    };
    const resize = () => {
      if (disposed || !host.current?.clientWidth) return;
      fit.fit();
      void agentDockApi
        .terminalResize({
          sessionId: session.id,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    };
    theme();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    const themes = new MutationObserver(theme);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const input = terminal.onData((data) => {
      void agentDockApi
        .terminalWrite({ sessionId: session.id, data })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    });
    void agentDockApi
      .terminalSnapshot(session.id)
      .then((snapshot) => {
        if (disposed) return;
        terminal.write(snapshot);
        off = agentDockApi.onTerminalOutput((event) => {
          if (!disposed && event.sessionId === session.id)
            terminal.write(event.data);
        });
        resize();
        if (focusRequested.current) terminal.focus();
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
      off?.();
      observer.disconnect();
      themes.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [session.id]);
  const action = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="brain-terminal">
      {dropOverlay}
      <div className="brain-terminal-header">
        <code
          title={[profile?.command, ...(profile?.args ?? [])]
            .filter(Boolean)
            .join(" ")}
        >
          {[profile?.command, ...(profile?.args ?? [])]
            .filter(Boolean)
            .join(" ")}
        </code>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              if (session.status !== "stopped")
                await agentDockApi.stopSession(session.id);
              await restart();
            })
          }
        >
          Restart
        </Button>
        <Button
          variant="ghost"
          disabled={busy || session.status === "stopped"}
          onClick={() =>
            void action(() => agentDockApi.stopSession(session.id))
          }
        >
          Stop
        </Button>
      </div>
      {error && (
        <p role="alert" className="brain-error">
          {error}
        </p>
      )}
      {session.status === "stopped" && (
        <p className="muted">Terminal stopped</p>
      )}
      <section
        className="brain-terminal-host"
        ref={host}
        aria-label="Agent terminal"
      />
    </div>
  );
}
