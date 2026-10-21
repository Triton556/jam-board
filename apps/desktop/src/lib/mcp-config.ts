import type { ConfigSnippets, McpStatus } from "./types";
export function makeSnippets(
  status: Pick<McpStatus, "sidecarPath" | "dataDir" | "port"> & {
    projectKeyPrefix?: string | null;
  },
  token: string,
): ConfigSnippets {
  const port = status.port ?? 47321;
  const shellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const project = status.projectKeyPrefix;
  const projectEnv = project
    ? `, JAM_BOARD_PROJECT = ${JSON.stringify(project)}`
    : "";
  const projectHeader = project
    ? `\nhttp_headers = { "X-Jam-Project" = ${JSON.stringify(project)} }`
    : "";
  return {
    codexStdio: `[mcp_servers.jam-board]\ncommand = ${JSON.stringify(status.sidecarPath)}\nenv = { JAM_AGENT_NAME = "Codex", JAM_BOARD_DATA_DIR = ${JSON.stringify(status.dataDir)}${projectEnv} }`,
    codexHttp: `# Set JAM_BOARD_TOKEN to ${token} in your environment.\n[mcp_servers.jam-board-http]\nurl = "http://127.0.0.1:${port}/mcp"\nbearer_token_env_var = "JAM_BOARD_TOKEN"${projectHeader}`,
    claudeStdio: `claude mcp add jam-board --env JAM_AGENT_NAME=Claude --env JAM_BOARD_DATA_DIR=${shellQuote(status.dataDir)}${project ? ` --env JAM_BOARD_PROJECT=${shellQuote(project)}` : ""} -- ${shellQuote(status.sidecarPath)}`,
    claudeHttp: `claude mcp add --transport http jam-board http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${token}" --header "X-Jam-Agent: Claude"${project ? ` --header ${shellQuote(`X-Jam-Project: ${project}`)}` : ""}`,
  };
}
