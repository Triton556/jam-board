import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Copy, Eye, FolderOpen, RefreshCw, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { version } from "../../../package.json";
import wave from "../../assets/chibi/danil-wave-256.webp";
import {
  Button,
  Dialog,
  IconButton,
  Select,
  TabPanels,
  Tabs,
} from "../../components/ui";
import { CodeBlock, PageHeading, Switch } from "../../components/ui/m5";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  connectionPrompt,
  projectConnectionPrompt,
} from "../../lib/brain-handoff";
import { makeSnippets } from "../../lib/mcp-config";
import { acceptProjectSelection } from "../../lib/project-selection";
import { appQuery } from "../../lib/queries";
import { paperRustle } from "../../lib/sound";
import type { ConfigSnippets, Theme } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { BrainHandoff, WorkflowGuide } from "../plan/BrainHandoff";
import { ProjectSettings } from "./ProjectSettings";
import { SkillSetup } from "./SkillSetup";

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
export const tryPrompt = connectionPrompt;
export function archiveConfirmed(name: string, typed: string) {
  return name.length > 0 && name === typed;
}
export function SettingsPage({
  initialSection = "Project",
}: {
  initialSection?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const app = useQuery(appQuery);
  const projects = useQuery({
    queryKey: ["projects", true],
    queryFn: () => api.listProjects(true),
    enabled: !!app.data?.hasJam,
    staleTime: 0,
  });
  const workingCount =
    projects.data?.find((project) => project.id === app.data?.jam?.id)
      ?.inProgressCount ?? 0;
  const status = useQuery({
    queryKey: ["mcpStatus"],
    queryFn: () => api.mcpStatus(),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
  });
  const [section, setSection] = useState(
    initialSection === "MCP" ? "Agents" : initialSection,
  );
  const [tab, setTab] = useState(tabs[0] ?? "Codex · stdio");
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configuration = useRef<HTMLElement>(null);
  const configurationTabs = useId();
  const [confirm, setConfirm] = useState<"token" | "demo" | "archive" | null>(
    null,
  );
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const runLock = useRef(false);
  const mounted = useRef(true);
  const copyGeneration = useRef(0);
  const currentProject = useRef(app.data?.jam?.id);
  currentProject.current = app.data?.jam?.id;
  const [copyPending, setCopyPending] = useState(false);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] !== "app") return;
        const next = client.getQueryData<
          Awaited<ReturnType<typeof api.appState>>
        >(["app"])?.jam?.id;
        if (next !== currentProject.current) {
          currentProject.current = next;
          copyGeneration.current += 1;
        }
      }),
    [client],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      copyGeneration.current += 1;
    };
  }, []);
  useBlocker({ shouldBlockFn: () => busy, enableBeforeUnload: busy });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    setSection(initialSection === "MCP" ? "Agents" : initialSection);
  }, [initialSection]);
  const run = async (action: () => Promise<unknown>, message?: string) => {
    if (runLock.current) return;
    runLock.current = true;
    setBusy(true);
    setNotice("");
    try {
      await action();
      if (message && mounted.current) setNotice(message);
    } catch (e) {
      if (mounted.current)
        setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      runLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["mcpStatus"] });
  };
  const copy = async (
    source: string | (() => Promise<string>),
    message = "Copied",
  ) => {
    const generation = ++copyGeneration.current;
    const projectId = currentProject.current;
    const valid = () =>
      mounted.current &&
      generation === copyGeneration.current &&
      projectId ===
        client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
          ?.jam?.id;
    setCopyPending(true);
    try {
      const text = typeof source === "string" ? source : await source();
      if (!valid()) return;
      await navigator.clipboard.writeText(text);
      if (valid()) setNotice(message);
    } catch (error) {
      if (valid()) throw error;
    } finally {
      if (mounted.current) setCopyPending(false);
    }
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
  const project = app.data?.jam;
  const connectionReady =
    !!project &&
    data?.projectId === project.id &&
    data?.projectKeyPrefix === project.keyPrefix;
  const checkPrompt = project ? projectConnectionPrompt(project) : tryPrompt;
  const snippetKey = keys[tabs.indexOf(tab)] ?? "codexStdio";
  const masked = data ? makeSnippets(data, `••••${data.tokenTail}`) : null;
  const activate = async (
    state: Awaited<ReturnType<typeof api.appState>>,
    to: "/board" | "/welcome",
  ) => {
    await acceptProjectSelection(client, state);
    await navigate({
      to: to === "/welcome" && state.hasJam ? "/projects" : to,
      ignoreBlocker: true,
    });
  };
  return (
    <main className="feature-page settings-page">
      <PageHeading title="Settings" note="make yourself at home" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {["Project", "Agents", "Data", "Board", "Appearance", "About"].map(
            (s) => (
              <Button
                key={s}
                disabled={busy}
                aria-current={section === s ? "page" : undefined}
                onClick={() => {
                  setSection(s);
                  setShown(null);
                  setNotice("");
                }}
              >
                {s}
              </Button>
            ),
          )}
        </nav>
        <div className="settings-content">
          {section === "Project" && <ProjectSettings />}
          {section === "Agents" && (
            <>
              <WorkflowGuide />
              <SettingsSection
                title="Set up in three steps"
                description="Connect your agent, verify the project, then appoint a planning brain. Jam Board does not launch a model or change your client configuration."
              >
                <SettingsRow
                  label="Connection target"
                  hint="The configuration and check below are for this project."
                >
                  {project ? (
                    <strong>
                      {project.name} · {project.keyPrefix}
                    </strong>
                  ) : (
                    <span>Reading selected project…</span>
                  )}
                  <p className="small">
                    Switching boards in Jam Board does not redirect an already
                    connected agent.
                  </p>
                </SettingsRow>
                <SettingsRow
                  label="1 · Connect MCP"
                  hint="Choose one transport below: stdio runs its own sidecar; HTTP needs Jam Board open."
                >
                  <span>
                    Use the configuration for this project, then restart or
                    reconnect your agent.
                  </span>
                  <Button onClick={() => configuration.current?.focus()}>
                    Show configuration
                  </Button>
                </SettingsRow>
                <SettingsRow
                  label="2 · Check the connection"
                  hint="The test prompt below only reads the board. It does not take a task."
                >
                  <Button
                    disabled={busy || !connectionReady}
                    onClick={() =>
                      void run(() =>
                        copy(
                          checkPrompt,
                          `Connection check copied for ${project?.name} · ${project?.keyPrefix}`,
                        ),
                      )
                    }
                  >
                    Copy connection check
                  </Button>
                </SettingsRow>
                <SettingsRow
                  label="3 · Appoint a brain and plan"
                  hint="In Plan, open an epic and choose its Brain. The connected agent appears after its first board call. Repeat for each epic it should coordinate."
                >
                  <BrainHandoff
                    scope={{ type: "project" }}
                    label="Prepare planning prompt"
                    disabled={busy || !connectionReady}
                  />
                  <p className="small">
                    No epic yet? Ask the connected agent to draft one first.
                    Brain appointment and Ready are not Start permission.
                  </p>
                </SettingsRow>
              </SettingsSection>
              <SettingsSection
                title="Your AI teammates"
                description="Connect locally. Your board stays on this computer."
              >
                <SettingsRow
                  label="HTTP server"
                  hint={`http://127.0.0.1:${data?.port ?? 47321}/mcp`}
                >
                  <div className="button-row">
                    <Switch
                      label="HTTP server"
                      stateText
                      checked={data?.httpEnabled ?? false}
                      disabled={busy}
                      onChange={(v) =>
                        void run(async () => {
                          await api.setMcpHttpEnabled(v);
                          await refresh();
                        })
                      }
                    />
                    <span>
                      <i
                        className={`status-dot ${data?.running ? "running" : ""}`}
                      />
                      {data?.running ? "Running" : "Stopped"}
                    </span>
                  </div>
                </SettingsRow>
                <SettingsRow label="MCP token">
                  <p className="mono token-value">
                    {shown ?? `••••${data?.tokenTail ?? "••••"}`}
                  </p>
                  <div className="button-row">
                    <Button disabled={busy} onClick={() => void run(show)}>
                      <Eye size={15} />
                      {shown ? "Shown for 30s" : "Show"}
                    </Button>
                    <IconButton
                      label="Copy token"
                      disabled={busy}
                      onClick={() =>
                        void run(() => copy(() => api.revealMcpToken()))
                      }
                    >
                      <Copy size={16} />
                    </IconButton>
                    <Button disabled={busy} onClick={() => setConfirm("token")}>
                      <RefreshCw size={15} />
                      Regenerate
                    </Button>
                  </div>
                </SettingsRow>
                <SettingsRow label="stdio sidecar">
                  <code className="path-value">{data?.sidecarPath}</code>
                  <IconButton
                    label="Copy sidecar path"
                    disabled={busy}
                    onClick={() =>
                      void run(() => copy(data?.sidecarPath ?? ""))
                    }
                  >
                    <Copy size={16} />
                  </IconButton>
                </SettingsRow>
              </SettingsSection>
              <SettingsSection
                title="Connect the board"
                ref={configuration}
                description="Copying shows or copies instructions only. Apply them yourself in the intended agent client, then restart or reconnect it."
              >
                <SettingsRow
                  label="Which project?"
                  hint="Each MCP session keeps its original project binding."
                >
                  <p>
                    {project?.name ?? "Selected project"} ·{" "}
                    {project?.keyPrefix ?? "…"}
                  </p>
                  <details className="connection-help">
                    <summary>
                      Connect another project or upgrade a client
                    </summary>
                    <ol>
                      <li>
                        Choose the other project in Projects, then return to
                        Settings → Agents for its configuration.
                      </li>
                      <li>
                        These snippets use the same jam-board connection name.
                        Intentionally replace the old entry, or use a separate
                        client configuration and session to keep both boards
                        connected. Do not paste duplicate entries.
                      </li>
                      <li>
                        Restart or reconnect the intended agent session. An
                        existing session does not move when the UI selection
                        changes.
                      </li>
                      <li>
                        Run this project's read-only connection check. Confirm
                        its name, key prefix and project ID before planning or
                        writing.
                      </li>
                    </ol>
                    <p>
                      After upgrading Jam Board, refresh the client's tool
                      schemas and reread task/report context before a new
                      action. Old call examples may lack required fields. A
                      stale error means reconcile the draft with current
                      evidence, not automatically retry it with new validators.
                    </p>
                  </details>
                </SettingsRow>
                <SettingsRow
                  label="Agent identity"
                  hint="A stable board identity, not a process ID or an authorization credential."
                >
                  <p>
                    Before applying a snippet, replace its default Codex or
                    Claude name with a distinct stable name for each
                    independently configured brain or worker, for example
                    Planner and Worker-1. Use <code>JAM_AGENT_NAME</code> for
                    stdio or <code>X-Jam-Agent</code> for HTTP, then reconnect
                    the client.
                  </p>
                  <details className="connection-help">
                    <summary>Several workers or inherited subagents?</summary>
                    <ul className="connection-help-points">
                      <li>
                        <strong>One name, one member.</strong> Connections with
                        matching names share one board member, tasks and
                        activity. Capitalization or punctuation alone may not
                        make names distinct. A new chat is not a new board
                        identity.
                      </li>
                      <li>
                        <strong>
                          Separate workers need separate connections.
                        </strong>{" "}
                        Subagents that inherit an MCP connection also inherit
                        its identity. Give independently tracked workers
                        distinct names. Jam Board does not launch or reconfigure
                        them.
                      </li>
                      <li>
                        <strong>Reviews need another identity.</strong> An agent
                        cannot independently review its own report using the
                        same identity.
                      </li>
                      <li>
                        <strong>Observe shared work.</strong> With shared
                        identities, <code>excludeSelf=true</code> hides peers’
                        events too. Use the documented{" "}
                        <code>excludeSelf=false</code> observation policy. Each
                        connection remains pinned to its project.
                      </li>
                    </ul>
                  </details>
                </SettingsRow>
                <SettingsRow
                  label="Configuration"
                  hint={
                    tab.startsWith("Codex")
                      ? "Paste into ~/.codex/config.toml. HTTP uses JAM_BOARD_TOKEN."
                      : "Run this PowerShell command, or adapt it for your shell before applying."
                  }
                >
                  <Tabs
                    id={configurationTabs}
                    label="Agent client and transport"
                    disabled={busy}
                    value={tab}
                    onChange={setTab}
                    items={tabs}
                  />
                  <TabPanels id={configurationTabs} value={tab} items={tabs}>
                    {!connectionReady &&
                      (status.isPending || app.isPending) && (
                        <p role="status">
                          Reading the selected project's connection settings…
                        </p>
                      )}
                    {!connectionReady &&
                      !status.isPending &&
                      !app.isPending && (
                        <>
                          <p role="alert">
                            Connection settings are unavailable or do not match
                            the selected project. Reread them before copying a
                            configuration.
                          </p>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await Promise.all([
                                  status.refetch(),
                                  app.refetch(),
                                ]);
                              })
                            }
                          >
                            Retry connection settings
                          </Button>
                        </>
                      )}
                    {masked && connectionReady && (
                      <CodeBlock
                        code={masked[snippetKey]}
                        disabled={busy}
                        pending={copyPending}
                        onCopy={() =>
                          void run(async () => {
                            // Capture displayed settings before any asynchronous token read.
                            const captured = data;
                            const target = `${project?.name} · ${project?.keyPrefix}`;
                            const http = tab.includes("HTTP");
                            await copy(
                              async () => {
                                const token = http
                                  ? await api.revealMcpToken()
                                  : "";
                                return makeSnippets(captured, token)[
                                  snippetKey
                                ];
                              },
                              `Configuration copied for ${target}${http ? " (includes your token; keep it private)" : ""}`,
                            );
                          })
                        }
                      />
                    )}
                  </TabPanels>
                </SettingsRow>
              </SettingsSection>
              <SkillSetup disabled={busy} />
              <SettingsSection
                title="Recent agent calls"
                description="Last 20 calls · kept in memory while this window is open"
              >
                <SettingsRow label="Calls">
                  <div className="recent-calls">
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
                  </div>
                </SettingsRow>
                <SettingsRow label="Read-only connection check">
                  <p>{checkPrompt}</p>
                  <Button
                    disabled={busy || !connectionReady}
                    onClick={() =>
                      void run(() =>
                        copy(
                          checkPrompt,
                          `Connection check copied for ${project?.name} · ${project?.keyPrefix}`,
                        ),
                      )
                    }
                  >
                    Copy prompt
                  </Button>
                </SettingsRow>
              </SettingsSection>
            </>
          )}
          {section === "Data" && (
            <SettingsSection title="Project data">
              <SettingsRow label="Database">
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
              </SettingsRow>
              <SettingsRow
                label="Export or import a project"
                hint="Export this project as JSON. Import creates a separate project; it does not replace this one."
              >
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
              </SettingsRow>
              <SettingsRow
                label="Demo project"
                hint="A demo creates a separate project. Your current board remains available under Your projects."
              >
                <Button onClick={() => setConfirm("demo")}>
                  Load demo jam
                </Button>
              </SettingsRow>
              <SettingsRow
                label="Archive this project"
                hint="Hide the project without changing its tasks or history. Restore it later under Your projects → Archived projects."
              >
                <Button
                  variant="danger"
                  onClick={() => {
                    setTyped("");
                    setNotice("");
                    void projects.refetch();
                    setConfirm("archive");
                  }}
                >
                  Archive this project
                </Button>
              </SettingsRow>
            </SettingsSection>
          )}
          {section === "Board" && (
            <SettingsSection title="Your board">
              <SettingsRow label="Color cards by">
                <Select
                  id="board-color-mode"
                  aria-label="Board color by"
                  value={settings.data?.colorBy ?? "epic"}
                  onChange={(e) =>
                    void run(async () => {
                      client.setQueryData(
                        ["settings"],
                        await api.setSettings({ colorBy: e.target.value }),
                      );
                    })
                  }
                >
                  <option value="epic">Epic</option>
                  <option value="none">None</option>
                  <option value="assignee">Assignee</option>
                </Select>
              </SettingsRow>
              <SettingsRow
                label="Story point estimates"
                hint="Show estimates on cards, table and task panel"
              >
                <Switch
                  label="Story point estimates"
                  stateText
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
              </SettingsRow>
              <SettingsRow
                label="In progress limit"
                hint="Highlights In progress above this number, even when epic filters hide cards. Review is tracked separately."
              >
                <input
                  aria-label="In progress limit"
                  type="number"
                  min={1}
                  max={99}
                  key={settings.data?.wipLimit}
                  defaultValue={settings.data?.wipLimit ?? 6}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n <= 99)
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
              </SettingsRow>
            </SettingsSection>
          )}
          {section === "Appearance" && (
            <SettingsSection title="Paper, your way">
              <SettingsRow label="Theme">
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
              </SettingsRow>
              <SettingsRow
                label="Sounds"
                hint="A soft paper rustle plays when an agent changes the board. Play a sample to hear it."
              >
                <div className="button-row">
                  <Switch
                    label="Sounds"
                    stateText
                    checked={settings.data?.soundEnabled ?? false}
                    onChange={(v) =>
                      void run(async () => {
                        const next = await api.setSettings({
                          theme: null,
                          soundEnabled: v,
                        });
                        useUiStore.setState({
                          soundEnabled: next.soundEnabled,
                        });
                        client.setQueryData(["settings"], next);
                      })
                    }
                  />
                  <Button onClick={() => paperRustle()}>
                    <Volume2 size={16} />
                    Play sample
                  </Button>
                </div>
              </SettingsRow>
            </SettingsSection>
          )}
          {section === "About" && (
            <section className="settings-card about-card">
              <header className="about-heading">
                <img src={wave} width={72} height={72} alt="Danil waving" />
                <div>
                  <h2>Jam Board</h2>
                  <span className="mono muted">Version {version}</span>
                </div>
              </header>
              <div className="settings-rows">
                <SettingsRow label="Made by">Danil Volodin</SettingsRow>
                <SettingsRow label="Tagline">
                  <span className="hand-note about-tagline">
                    Plan your game jam with your AI teammates.
                  </span>
                </SettingsRow>
                <SettingsRow label="GitHub">
                  <Button
                    onClick={() =>
                      void run(() =>
                        api.openUrl("https://github.com/Triton556/jam-board"),
                      )
                    }
                  >
                    Triton556 / jam-board ↗
                  </Button>
                </SettingsRow>
                <SettingsRow label="License">
                  MIT · © 2026 Danil Volodin
                </SettingsRow>
                <SettingsRow label="Credits">
                  <Button
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
                </SettingsRow>
              </div>
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
                : "Archive this project"
          }
          onClose={() => setConfirm(null)}
        >
          <div className="m5-form">
            {confirm === "token" ? (
              <p>Existing HTTP connections will stop working.</p>
            ) : confirm === "demo" ? (
              <p>
                A separate demo project will become active. Your current board
                remains available under Your projects.
              </p>
            ) : (
              <>
                <p>
                  Type <strong>{app.data?.jam?.name}</strong> to archive this
                  project. Its tasks, reports and references are kept.
                </p>
                {workingCount > 0 && (
                  <p className="notice" role="status">
                    {workingCount} tasks are still In progress, including
                    archived cards. Pause new work and let them report before
                    archiving the project. To release an archived task,
                    unarchive it first. Switching projects is safe without
                    archiving.
                  </p>
                )}
                {projects.isPending && (
                  <p role="status">Checking running work…</p>
                )}
                {projects.error && (
                  <p role="alert">
                    Could not check running work.{" "}
                    <Button onClick={() => void projects.refetch()}>
                      Retry
                    </Button>
                  </p>
                )}
                <label>
                  Project name
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
                    (!archiveConfirmed(app.data?.jam?.name ?? "", typed) ||
                      workingCount > 0 ||
                      projects.isPending ||
                      !!projects.error))
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
                    : "Archive project"}
              </Button>
            </div>
            {notice && <p role="alert">{notice}</p>}
          </div>
        </Dialog>
      )}
    </main>
  );
}
