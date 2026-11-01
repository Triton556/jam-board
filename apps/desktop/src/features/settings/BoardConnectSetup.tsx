import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, TabPanels, Tabs } from "../../components/ui";
import { CodeBlock } from "../../components/ui/m5";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  type BoardConnectionSetup,
  boardConnectionPrompt,
} from "../../lib/brain-handoff";
import { type ConnectShell, makeSnippets } from "../../lib/mcp-config";
import {
  readFolderSettings,
  useFolderGuard,
  writeFolderSettings,
} from "../../lib/project-folder-api";
import { membersQuery } from "../../lib/queries";
import { relativeTime } from "../../lib/time";
import { profilesQuery } from "../brain/brain-profiles";

type ShellTab = ConnectShell | "json";
const shellTabs: { value: ShellTab; label: string }[] = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt" },
  { value: "bash", label: "bash" },
  { value: "json", label: ".mcp.json" },
];
const shellStorageKey = "jam-board.connect-shell";
function initialShell(): ShellTab {
  try {
    const saved = localStorage.getItem(shellStorageKey);
    if (shellTabs.some((tab) => tab.value === saved)) return saved as ShellTab;
  } catch {
    /* Storage may be unavailable. */
  }
  return /Windows/i.test(navigator.userAgent) ? "powershell" : "bash";
}

export function BoardConnectSetup({
  setup,
  disabled = false,
}: {
  setup: Omit<BoardConnectionSetup, "projectFolder">;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const capture = useFolderGuard();
  const members = useQuery(membersQuery);
  const profiles = useQuery(profilesQuery);
  const tabsId = useId();
  const [shell, setShell] = useState<ShellTab>(initialShell);
  const shellLabel =
    shellTabs.find((tab) => tab.value === shell)?.label ?? "PowerShell";
  const online = members.data?.find(
    (member) => member.kind === "agent" && member.online,
  );
  const claudePath = profiles.data?.find(
    (profile) =>
      profile.available &&
      profile.preset === "claude-code" &&
      profile.command &&
      /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(profile.command),
  )?.command;
  const settings = useQuery({
    queryKey: ["settings", setup.project.id],
    queryFn: async () => {
      const result = await readFolderSettings(setup.project.id);
      if (result.projectId !== setup.project.id)
        throw new Error(
          "Project changed. Reload this board before connecting.",
        );
      return result;
    },
    staleTime: 0,
  });
  const [pending, setPending] = useState<"copy" | "folder" | "snippet" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const mounted = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    queryClient.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
      ?.jam?.id === setup.project.id;
  const run = async (
    kind: "copy" | "folder" | "snippet",
    action: () => Promise<void>,
  ) => {
    if (locked.current || disabled || !current()) return;
    locked.current = true;
    setPending(kind);
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (current())
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const chooseFolder = () =>
    run("folder", async () => {
      const check = await capture();
      const folder = await api.pickFolder();
      await check();
      if (!folder || !current()) return;
      await writeFolderSettings(
        setup.project.id,
        {
          workingDirectory: folder,
          expectedProjectId: setup.project.id,
        },
        check.context,
      );
      await check();
      if (!current()) return;
      await settings.refetch();
      await check();
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await check();
      if (current())
        setNotice(
          "Agent working directory saved. Board storage has not moved.",
        );
    });
  const copy = () =>
    run("copy", async () => {
      if (settings.isPending || settings.isError) return;
      const check = await capture();
      const prompt = boardConnectionPrompt({
        ...setup,
        projectFolder:
          settings.data?.workingDirectory ?? settings.data?.projectFolder,
      });
      await navigator.clipboard.writeText(prompt);
      await check();
      if (current())
        setNotice(
          "Connection prompt copied. Paste it into your agent chat; nothing has connected yet.",
        );
    });
  const snippetStatus = {
    ...setup,
    projectId: setup.project.id,
    // The working directory is a code hint, never a board storage selector.
    projectFolder: settings.data?.projectFolder,
  };
  const code = (token: string) => {
    const snippets = makeSnippets(snippetStatus, token);
    return shell === "json"
      ? snippets.mcpJson[setup.transport]
      : snippets.claude[setup.transport][shell];
  };
  const copySnippet = () =>
    run("snippet", async () => {
      if (settings.isPending || settings.isError) return;
      const check = await capture();
      const token =
        setup.transport === "http" && shell !== "json"
          ? await api.revealMcpToken()
          : "";
      await check();
      if (!current()) return;
      await navigator.clipboard.writeText(code(token));
      await check();
      if (current()) setNotice("Configuration copied.");
    });
  return (
    <SettingsSection
      title="Connect an agent to this board"
      description="One prompt helps your agent check or set up MCP, verify this project and read the board instructions."
    >
      <SettingsRow
        label="Agent connection"
        hint={`${setup.client === "codex" ? "Codex" : "Claude Code"} · ${setup.transport}. Change the client and transport in the configuration section below.`}
      >
        <Button
          variant="primary"
          disabled={
            disabled ||
            pending !== null ||
            settings.isPending ||
            settings.isError
          }
          onClick={() => void copy()}
          style={{ maxWidth: "100%", whiteSpace: "normal" }}
        >
          {pending === "copy" ? "Copying…" : "Copy agent connection prompt"}
        </Button>
        <p className="small">
          No token is copied. Connecting does not appoint a brain or start work.
        </p>
      </SettingsRow>
      <SettingsRow
        label="Connection command"
        hint="Choose the shell you will use in your game repo."
      >
        <div className="connect-shells">
          <Tabs
            id={tabsId}
            label="Connection shell"
            value={shellLabel}
            items={shellTabs.map((tab) => tab.label)}
            disabled={disabled || pending !== null}
            onChange={(label) => {
              const tab = shellTabs.find((item) => item.label === label);
              if (!tab) return;
              setShell(tab.value);
              try {
                localStorage.setItem(shellStorageKey, tab.value);
              } catch {
                /* Optional preference. */
              }
            }}
          />
        </div>
        <TabPanels
          id={tabsId}
          value={shellLabel}
          items={shellTabs.map((tab) => tab.label)}
        >
          <div className="connect-snippet">
            <CodeBlock
              code={code(`\${JAM_BOARD_TOKEN}`)}
              pending={pending === "snippet"}
              disabled={
                disabled ||
                pending !== null ||
                settings.isPending ||
                settings.isError
              }
              onCopy={() => void copySnippet()}
            />
          </div>
        </TabPanels>
        {shell !== "json" && (
          <p className="small">
            If <code>claude</code> isn't recognized, Claude desktop has its own
            copy:{" "}
            {claudePath ? (
              <code className="path-value">{claudePath}</code>
            ) : (
              <>
                find <code>claude.exe</code> in the Claude app folder and use
                its full path instead of <code>claude</code>.
              </>
            )}
          </p>
        )}
        <p>
          <strong>
            Then restart the Claude Code session in this folder and run{" "}
            <code>get_session_context</code>. It should show{" "}
            {setup.project.name}.
          </strong>
        </p>
        {shell === "json" && (
          <>
            <p className="small">
              Save as <code>.mcp.json</code> in your game repo root. Claude Code
              asks once to trust it.
            </p>
            {setup.transport === "http" && (
              <p className="small">
                Set <code>JAM_BOARD_TOKEN</code> in your environment before
                starting Claude Code.
              </p>
            )}
          </>
        )}
        <p className="connect-presence" role="status" aria-live="polite">
          {online ? (
            <>
              ✓ {online.name}{" "}
              {online.client && (
                <span className="muted">({online.client}) </span>
              )}
              connected{" "}
              {online.lastSeenAt ? relativeTime(online.lastSeenAt) : "just now"}{" "}
              — sees this project
            </>
          ) : (
            <>
              <span className="connect-spinner" aria-hidden="true" />
              Waiting for an agent to connect…
            </>
          )}
        </p>
      </SettingsRow>
      <SettingsRow
        label="Agent working directory"
        hint="Optional code folder, such as your Unity project. Board storage is shown in Project settings → Folder."
      >
        {settings.isPending && !settings.isFetching ? (
          <span>Reading saved folder…</span>
        ) : settings.isError || (settings.isPending && settings.isFetching) ? (
          <>
            <span role={settings.isError ? "alert" : "status"}>
              {settings.isError
                ? "Could not read the saved folder."
                : "Reading saved folder…"}
            </span>
            <Button
              disabled={disabled || settings.isFetching}
              aria-busy={settings.isFetching}
              onClick={() => void settings.refetch({ cancelRefetch: false })}
            >
              {settings.isFetching ? "Reading folder…" : "Retry folder"}
            </Button>
          </>
        ) : (
          <span className="path-value">
            {settings.data?.workingDirectory ||
              "Not set. The agent will ask where the project lives."}
          </span>
        )}
        <Button
          disabled={
            disabled ||
            pending !== null ||
            settings.isPending ||
            settings.isError
          }
          onClick={() => void chooseFolder()}
        >
          {pending === "folder" ? "Saving folder…" : "Choose code folder…"}
        </Button>
      </SettingsRow>
      {notice && (
        <p
          role="status"
          aria-label="Connection setup feedback"
          aria-live="polite"
        >
          {notice}
        </p>
      )}
    </SettingsSection>
  );
}
