import type { McpStatus } from "./types";

export type ConnectShell = "powershell" | "cmd" | "bash";
export type ConnectSnippets = {
  claude: Record<"stdio" | "http", Record<ConnectShell, string>>;
  mcpJson: Record<"stdio" | "http", string>;
  codex: Record<"stdio" | "http", string>;
};

export function makeSnippets(
  status: Pick<McpStatus, "sidecarPath" | "dataDir" | "port"> & {
    projectId?: string | null;
    projectKeyPrefix?: string | null;
    projectFolder?: string | null;
  },
  token: string,
): ConnectSnippets {
  const port = status.port ?? 47321;
  const project = status.projectId ?? status.projectKeyPrefix;
  const env: Record<string, string> = status.projectFolder
    ? { JAM_BOARD_PROJECT_FOLDER: status.projectFolder }
    : {
        JAM_BOARD_DATA_DIR: status.dataDir,
        ...(project ? { JAM_BOARD_PROJECT: project } : {}),
      };
  const headers: Record<string, string> = {
    ...(project ? { "X-Jam-Project": project } : {}),
    ...(status.projectFolder
      ? {
          "X-Jam-Project-Folder": `utf8:${encodeURIComponent(status.projectFolder)}`,
        }
      : {}),
  };
  const quote = {
    powershell: (value: string) => `'${value.replaceAll("'", "''")}'`,
    cmd: (value: string) => `"${value.replaceAll('"', '\\"')}"`,
    bash: (value: string) => `'${value.replaceAll("'", "'\\''")}'`,
  };
  const cli = (shell: ConnectShell) => {
    const q = quote[shell];
    return {
      stdio: `claude mcp add jam-board --env JAM_AGENT_NAME=Claude${Object.entries(
        env,
      )
        .map(([key, value]) => ` --env ${key}=${q(value)}`)
        .join("")} -- ${q(status.sidecarPath)}`,
      http: `claude mcp add --transport http jam-board http://127.0.0.1:${port}/mcp${Object.entries(
        {
          Authorization: `Bearer ${token}`,
          "X-Jam-Agent": "Claude",
          ...headers,
        },
      )
        .map(([key, value]) => ` --header ${q(`${key}: ${value}`)}`)
        .join("")}`,
    };
  };
  const shells: ConnectShell[] = ["powershell", "cmd", "bash"];
  const json = (server: object) =>
    JSON.stringify({ mcpServers: { "jam-board": server } }, null, 2);
  return {
    claude: {
      stdio: Object.fromEntries(
        shells.map((shell) => [shell, cli(shell).stdio]),
      ) as Record<ConnectShell, string>,
      http: Object.fromEntries(
        shells.map((shell) => [shell, cli(shell).http]),
      ) as Record<ConnectShell, string>,
    },
    mcpJson: {
      stdio: json({
        command: status.sidecarPath,
        args: [],
        env: { ...env, JAM_AGENT_NAME: "Claude" },
      }),
      http: json({
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          Authorization: `Bearer \${JAM_BOARD_TOKEN}`,
          "X-Jam-Agent": "Claude",
          ...headers,
        },
      }),
    },
    codex: {
      stdio: `[mcp_servers.jam-board]\ncommand = ${JSON.stringify(status.sidecarPath)}\nenv = { JAM_AGENT_NAME = "Codex"${Object.entries(
        env,
      )
        .map(([key, value]) => `, ${key} = ${JSON.stringify(value)}`)
        .join("")} }`,
      http: `# Set JAM_BOARD_TOKEN to ${token} in your environment.\n[mcp_servers.jam-board-http]\nurl = "http://127.0.0.1:${port}/mcp"\nbearer_token_env_var = "JAM_BOARD_TOKEN"\nhttp_headers = { "X-Jam-Agent" = "Codex"${Object.entries(
        headers,
      )
        .filter(([key]) => key === "X-Jam-Project")
        .map(
          ([key, value]) =>
            `, ${JSON.stringify(key)} = ${JSON.stringify(value)}`,
        )
        .join("")} }`,
    },
  };
}
