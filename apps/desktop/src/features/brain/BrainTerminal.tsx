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
import { setTerminalTitle } from "./brain-store";

const terminalFont = '"JetBrains Mono Variable", "JetBrains Mono", monospace';

async function loadTerminalFonts() {
  if (document.fonts) {
    await Promise.all(
      [400, 700].flatMap((weight) =>
        ["Wm0123456789", "Что Си Ос на Противоречие Ёё"].map((sample) =>
          document.fonts.load(
            `${weight} 12px "JetBrains Mono Variable"`,
            sample,
          ),
        ),
      ),
    );
    await document.fonts.ready;
  }
}

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
  const [now, setNow] = useState(Date.now);
  const starting = session.status === "starting";
  useEffect(() => {
    if (!starting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [starting]);
  const elapsed = Math.max(
    0,
    Math.floor((now - (Date.parse(session.createdAt) || now)) / 1000),
  );
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
    let opened = false;
    const terminal = new Terminal({
      fontFamily: terminalFont,
      fontSize: 12,
      cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollback: 5000,
      // A PTY already supplies CR/LF and cursor control; do not rewrite it.
      convertEol: false,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    terminal.loadAddon(fit);
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
      if (
        disposed ||
        !opened ||
        !host.current?.clientWidth ||
        !host.current.clientHeight
      )
        return;
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
    const title = terminal.onTitleChange((value) => {
      if (!disposed) setTerminalTitle(session.id, value);
    });
    const remeasure = () => {
      if (disposed || !opened) return;
      // Public font options invalidate xterm's character measurements and DOM
      // renderer width cache even when the final font size has not changed.
      terminal.options.fontSize = 12.001;
      terminal.options.fontSize = 12;
      terminal.refresh(0, terminal.rows - 1);
      resize();
    };
    document.fonts?.addEventListener("loadingdone", remeasure);
    void (async () => {
      const [history] = await Promise.all([
        agentDockApi.history(session.id),
        loadTerminalFonts(),
      ]);
      if (disposed || !host.current) return;
      const metadata = history.find(
        (event) =>
          event.kind === "status" &&
          event.message?.startsWith("Terminal renderer: "),
      );
      if (metadata?.kind === "status" && metadata.message) {
        const pty = JSON.parse(
          metadata.message.slice("Terminal renderer: ".length),
        );
        if (pty.backend === "conpty") {
          terminal.options.windowsPty = {
            backend: "conpty",
            ...(typeof pty.buildNumber === "number"
              ? { buildNumber: pty.buildNumber }
              : {}),
          };
        }
      }
      const probe = document.createElement("span");
      probe.textContent = "Wm Что Си Ос на Ёё";
      probe.style.cssText = `position:absolute;visibility:hidden;font:12px ${terminalFont};white-space:pre`;
      host.current.append(probe);
      probe.getBoundingClientRect();
      probe.remove();
      terminal.open(host.current);
      // Fit before snapshot replay. The first backend resize is deliberately
      // delayed until the output subscription is installed, then launches PTY.
      fit.fit();
      const snapshot = await agentDockApi.terminalSnapshot(session.id);
      if (disposed) return;
      terminal.write(snapshot);
      off = agentDockApi.onTerminalOutput((event) => {
        if (!disposed && event.sessionId === session.id) {
          terminal.write(event.data);
        }
      });
      opened = true;
      resize();
      if (focusRequested.current) terminal.focus();
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      off?.();
      observer.disconnect();
      themes.disconnect();
      document.fonts?.removeEventListener("loadingdone", remeasure);
      input.dispose();
      title.dispose();
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
      <div className="brain-terminal-area">
        <section
          className="brain-terminal-host"
          ref={host}
          aria-label="Agent terminal"
        />
        {starting && (
          <div className="brain-terminal-starting" role="status">
            <span>Starting {profile?.label ?? "agent"}…</span>
            <span aria-live="off">{elapsed} s</span>
            {elapsed >= 5 && (
              <span className="brain-terminal-starting-hint">
                CLIs can take a while on first start: update check, MCP servers
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
