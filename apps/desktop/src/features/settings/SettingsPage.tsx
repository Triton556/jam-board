import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy, Eye, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import wave from "../../assets/chibi/danil-wave-256.webp";
import { Button, Dialog, IconButton, Select, Tabs } from "../../components/ui";
import { CodeBlock, PageHeading, Switch } from "../../components/ui/m5";
import { api } from "../../lib/api";
import { makeSnippets } from "../../lib/mcp-config";
import { appQuery } from "../../lib/queries";
import { paperRustle } from "../../lib/sound";
import type { ConfigSnippets, Theme } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";

const tabs = [
  "Codex · stdio",
  "Codex · HTTP",
  "Claude Code · stdio",
  "Claude Code · HTTP",
];
const keys: (keyof ConfigSnippets)[] = [
  "codexStdio",
  "codexHttp",
  "claudeStdio",
  "claudeHttp",
];
export const tryPrompt =
  "Use the jam-board MCP server: call get_board, then take the highest-priority unassigned To do task, claim it, and add a comment with your plan.";
export function archiveConfirmed(name: string, typed: string) {
  return name.length > 0 && name === typed;
}
export function SettingsPage({
  initialSection = "MCP",
}: {
  initialSection?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const app = useQuery(appQuery);
  const status = useQuery({
    queryKey: ["mcpStatus"],
    queryFn: () => api.mcpStatus(),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
  });
  const [section, setSection] = useState(initialSection);
  const [tab, setTab] = useState(tabs[0] ?? "Codex · stdio");
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, setConfirm] = useState<"token" | "demo" | "archive" | null>(
    null,
  );
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);
  const run = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
      if (message) setNotice(message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["mcpStatus"] });
  };
  const copy = async (text: string, message = "Copied") => {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  };
  const show = async () => {
    const token = await api.revealMcpToken();
    setShown(token);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), 30000);
  };
  const changeTheme = useMutation({
    mutationFn: (theme: Theme) =>
      api.setSettings({ theme, soundEnabled: null }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["app"] });
      await client.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const data = status.data;
  const snippetKey = keys[tabs.indexOf(tab)] ?? "codexStdio";
  const masked = data ? makeSnippets(data, `••••${data.tokenTail}`) : null;
  const activate = async (
    state: Awaited<ReturnType<typeof api.appState>>,
    to: "/board" | "/welcome",
  ) => {
    client.setQueryData(["app"], state);
    await client.invalidateQueries();
    await navigate({ to });
  };
  return (
    <main className="feature-page settings-page">
      <PageHeading title="Settings" note="make yourself at home" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {["MCP", "Data", "Board", "Appearance", "About"].map((s) => (
            <Button
              key={s}
              aria-current={section === s ? "page" : undefined}
              onClick={() => {
                setSection(s);
                setShown(null);
                setNotice("");
              }}
            >
              {s}
            </Button>
          ))}
        </nav>
        <div className="settings-content">
          {section === "MCP" && (
            <>
              <h2>Your AI teammates</h2>
              <p className="muted">
                Connect locally. Your board stays on this computer.
              </p>
              <section className="settings-card">
                <div className="setting-row">
                  <div>
                    <strong>
                      <i
                        className={`status-dot ${data?.running ? "running" : ""}`}
                      />
                      {data?.running ? "Running" : "Stopped"}
                    </strong>
                    <p className="mono small">
                      http://127.0.0.1:{data?.port ?? 47321}/mcp
                    </p>
                  </div>
                  <Switch
                    label="HTTP server"
                    checked={data?.httpEnabled ?? false}
                    disabled={busy}
                    onChange={(v) =>
                      void run(async () => {
                        await api.setMcpHttpEnabled(v);
                        await refresh();
                      })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <small className="field-label">MCP token</small>
                    <p className="mono token-value">
                      {shown ?? `••••${data?.tokenTail ?? "••••"}`}
                    </p>
                  </div>
                  <div className="button-row">
                    <Button onClick={() => void run(show)}>
                      <Eye size={15} />
                      {shown ? "Shown for 30s" : "Show"}
                    </Button>
                    <IconButton
                      label="Copy token"
                      onClick={() =>
                        void run(async () => copy(await api.revealMcpToken()))
                      }
                    >
                      <Copy size={16} />
                    </IconButton>
                    <Button onClick={() => setConfirm("token")}>
                      <RefreshCw size={15} />
                      Regenerate
                    </Button>
                  </div>
                </div>
                <div>
                  <small className="field-label">stdio sidecar</small>
                  <div className="setting-row">
                    <code className="path-value">{data?.sidecarPath}</code>
                    <IconButton
                      label="Copy sidecar path"
                      onClick={() =>
                        void run(() => copy(data?.sidecarPath ?? ""))
                      }
                    >
                      <Copy size={16} />
                    </IconButton>
                  </div>
                </div>
              </section>
              <section>
                <h2>Connect your agent</h2>
                <Tabs value={tab} onChange={setTab} items={tabs} />
                {masked && (
                  <CodeBlock
                    code={masked[snippetKey]}
                    onCopy={() =>
                      void run(async () => {
                        const snippets = await api.mcpConfigSnippets();
                        await copy(
                          snippets[snippetKey],
                          tab.includes("HTTP")
                            ? "Copied with your token"
                            : "Copied",
                        );
                      })
                    }
                  />
                )}
                <p className="muted small">
                  {tab.startsWith("Codex")
                    ? "Paste into ~/.codex/config.toml. HTTP uses the JAM_BOARD_TOKEN environment variable."
                    : "Run this command in your terminal."}
                </p>
              </section>
              <section className="recent-calls">
                <h2>Recent agent calls</h2>
                <p className="muted small">
                  Last 20 calls · kept in memory while this window is open
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Agent</th>
                      <th>Tool</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.recentCalls.map((call) => (
                      <tr key={`${call.at}:${call.tool}`}>
                        <td className="mono">
                          {new Date(call.at).toLocaleTimeString("en", {
                            hour12: false,
                          })}
                        </td>
                        <td>{call.agent}</td>
                        <td className="mono">{call.tool}</td>
                        <td
                          className={call.ok ? "ok" : "field-error"}
                          title={call.error ?? undefined}
                        >
                          {call.ok ? "ok" : `error · ${call.error ?? ""}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data?.recentCalls.length && (
                  <p className="muted">
                    No calls yet. Connect an agent and try the prompt below.
                  </p>
                )}
              </section>
              <section className="try-card">
                <h3>Try it</h3>
                <p>{tryPrompt}</p>
                <Button onClick={() => void run(() => copy(tryPrompt))}>
                  Copy prompt
                </Button>
              </section>
            </>
          )}
          {section === "Data" && (
            <>
              <h2>Your local sketchbook</h2>
              <section className="settings-card">
                <small className="field-label">Database</small>
                <p className="mono path-value">
                  {data?.dataDir}
                  {data?.dataDir.includes("\\") ? "\\" : "/"}jam.db
                </p>
                <Button
                  onClick={() =>
                    void run(() => api.showInFolder(`${data?.dataDir}/jam.db`))
                  }
                >
                  <FolderOpen size={16} />
                  Open folder
                </Button>
              </section>
              <section className="settings-card">
                <h3>Take your jam with you</h3>
                <p className="muted">
                  Export a JSON snapshot, or import one into a new jam. Existing
                  history stays here.
                </p>
                <div className="button-row">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await api.exportJamJson();
                        setNotice(`Exported to ${result.path}`);
                      })
                    }
                  >
                    Export JSON
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const path = await api.pickFile(true);
                        if (path)
                          await activate(
                            await api.importJamJson(path),
                            "/board",
                          );
                      })
                    }
                  >
                    Import JSON
                  </Button>
                </div>
              </section>
              <section className="settings-card">
                <h3>A fresh page</h3>
                <p className="muted">
                  A demo makes a new active jam. Your current jam stays in
                  history.
                </p>
                <Button onClick={() => setConfirm("demo")}>
                  Load demo jam
                </Button>
              </section>
              <section className="settings-card archive-card">
                <h3>Archive this jam</h3>
                <p className="muted">
                  Archive every task and return to the welcome screen. Nothing
                  is deleted.
                </p>
                <Button
                  variant="danger"
                  onClick={() => {
                    setTyped("");
                    setConfirm("archive");
                  }}
                >
                  Archive this jam
                </Button>
              </section>
            </>
          )}
          {section === "Board" && (
            <section className="settings-card">
              <h2>Your board</h2>
              <label className="field" htmlFor="board-color-mode">
                Color by
                <Select
                  id="board-color-mode"
                  aria-label="Board color by"
                  value={settings.data?.colorBy ?? "none"}
                  onChange={(e) =>
                    void run(async () => {
                      client.setQueryData(
                        ["settings"],
                        await api.setSettings({ colorBy: e.target.value }),
                      );
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="assignee">Assignee</option>
                </Select>
              </label>
              <Switch
                label="Story point estimates"
                checked={settings.data?.estimatesEnabled ?? false}
                onChange={(v) =>
                  void run(async () => {
                    client.setQueryData(
                      ["settings"],
                      await api.setSettings({ estimatesEnabled: v }),
                    );
                  })
                }
              />
              <label className="field">
                In progress WIP limit
                <input
                  aria-label="WIP limit"
                  type="number"
                  min={1}
                  max={999}
                  key={settings.data?.wipLimit}
                  defaultValue={settings.data?.wipLimit ?? 6}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 1 && n <= 999)
                      void run(async () => {
                        client.setQueryData(
                          ["settings"],
                          await api.setSettings({ wipLimit: n }),
                        );
                      });
                    else
                      e.currentTarget.value = String(
                        settings.data?.wipLimit ?? 6,
                      );
                  }}
                />
              </label>
            </section>
          )}
          {section === "Appearance" && (
            <>
              <h2>Paper, your way</h2>
              <section className="settings-card">
                <h3>Theme</h3>
                <div className="theme-previews">
                  {(["system", "light", "dark"] as const).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      aria-pressed={settings.data?.theme === theme}
                      onClick={() => changeTheme.mutate(theme)}
                    >
                      <span className={`theme-preview ${theme}`}>
                        <i />
                      </span>
                      <span className="capitalize">{theme}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-card setting-row">
                <div>
                  <h3>Sounds</h3>
                  <p className="muted">
                    A soft paper rustle when an agent helps out.
                  </p>
                </div>
                <Switch
                  label="Sounds"
                  checked={settings.data?.soundEnabled ?? false}
                  onChange={(v) =>
                    void run(async () => {
                      const next = await api.setSettings({
                        theme: null,
                        soundEnabled: v,
                      });
                      useUiStore.setState({ soundEnabled: next.soundEnabled });
                      client.setQueryData(["settings"], next);
                    })
                  }
                />
                <Button onClick={() => paperRustle()}>Preview</Button>
              </section>
            </>
          )}
          {section === "About" && (
            <section className="about-card">
              <img src={wave} width={120} height={120} alt="Danil waving" />
              <h2>Jam Board</h2>
              <span className="mono muted">Version 0.1.0</span>
              <p>Made by Danil Volodin</p>
              <p className="hand-note">
                Plan your game jam with your AI teammates.
              </p>
              <Button
                onClick={() =>
                  void run(() =>
                    api.openUrl("https://github.com/Triton556/jam-board"),
                  )
                }
              >
                Triton556 / jam-board ↗
              </Button>
              <p>MIT License · © 2026 Danil Volodin</p>
              <p className="muted small">
                Credits: Tauri, React, TanStack, Lucide, rough.js, Motion,
                Fontsource and the Rust community. See CREDITS.md in the
                project.
              </p>
              <Button
                variant="ghost"
                onClick={() =>
                  void run(() =>
                    api.openUrl(
                      "https://github.com/Triton556/jam-board/blob/main/CREDITS.md",
                    ),
                  )
                }
              >
                CREDITS.md ↗
              </Button>
            </section>
          )}
          {status.error && <p role="alert">{status.error.message}</p>}
          {notice && (
            <p role="status" className="settings-notice">
              {notice}
            </p>
          )}
        </div>
      </div>
      {confirm && (
        <Dialog
          title={
            confirm === "token"
              ? "Regenerate MCP token?"
              : confirm === "demo"
                ? "Load a demo jam?"
                : "Archive this jam"
          }
          onClose={() => setConfirm(null)}
        >
          <div className="m5-form">
            {confirm === "token" ? (
              <p>Existing HTTP connections will stop working.</p>
            ) : confirm === "demo" ? (
              <p>
                A new demo jam will become active; your current jam stays in
                history.
              </p>
            ) : (
              <>
                <p>
                  Type <strong>{app.data?.jam?.name}</strong> to archive this
                  jam.
                </p>
                <label>
                  Jam name
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </label>
              </>
            )}
            <div className="dialog-actions">
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant={confirm === "demo" ? "primary" : "danger"}
                disabled={
                  busy ||
                  (confirm === "archive" &&
                    !archiveConfirmed(app.data?.jam?.name ?? "", typed))
                }
                onClick={() =>
                  void run(async () => {
                    if (confirm === "token") {
                      await api.regenerateMcpToken();
                      setShown(null);
                      await refresh();
                    } else if (confirm === "demo") {
                      await activate(await api.loadDemoJam(), "/board");
                    } else
                      await activate(
                        await api.resetJam({ confirmName: typed }),
                        "/welcome",
                      );
                    setConfirm(null);
                  })
                }
              >
                {confirm === "token"
                  ? "Regenerate token"
                  : confirm === "demo"
                    ? "Load demo jam"
                    : "Archive jam"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </main>
  );
}
