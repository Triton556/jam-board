// S01: project-scoped external MCP setup; no connection or execution is launched.
import { expect, it } from "vitest";
import { makeSnippets } from "./mcp-config";

it.each([undefined, "project-A"])(
  "Codex HTTP has an explicit stable identity with optional project %s",
  (projectId) => {
    const path = "C:\\Users\\O'Brien\\jam-board-mcp.exe";
    const snippets = makeSnippets(
      {
        sidecarPath: path,
        dataDir: "C:\\O'Brien\\data",
        port: 47321,
        projectId,
      },
      "synthetic-token",
    );
    expect(snippets.codex.http).toContain('"X-Jam-Agent" = "Codex"');
    if (projectId)
      expect(snippets.codex.http).toContain('"X-Jam-Project" = "project-A"');
    expect(
      JSON.parse(
        snippets.codex.stdio.split("\n")[1]?.slice("command = ".length) ?? "",
      ),
    ).toBe(path);
    expect(snippets.codex.stdio).toContain('JAM_AGENT_NAME = "Codex"');
    expect(snippets.claude.http.powershell).toContain("X-Jam-Agent: Claude");
  },
);

const fixture = {
  sidecarPath: 'C:\\Игры\\Little Stones – & "test"\\mcp.exe',
  dataDir: 'C:\\Игры\\Little Stones – & "test"',
  port: 47321,
  projectId: "project-A",
};
const token = "fictional-test-token";
it.each(["powershell", "bash"] as const)(
  "quotes apostrophes and special paths for %s",
  (shell) => {
    const path = `${fixture.dataDir}\\O'Brien`;
    const snippets = makeSnippets(
      { ...fixture, dataDir: path, sidecarPath: path },
      token,
    );
    const escaped =
      shell === "powershell"
        ? path.replaceAll("'", "''")
        : path.replaceAll("'", "'\\''");
    expect(snippets.claude.stdio[shell]).toContain(`'${escaped}'`);
    expect(snippets.claude.http[shell]).toContain(
      `Authorization: Bearer ${token}`,
    );
  },
);
it("cmd double-quotes special paths without shell-added apostrophes", () => {
  const snippets = makeSnippets(fixture, token);
  expect(snippets.claude.stdio.cmd).toContain(
    `"${fixture.sidecarPath.replaceAll('"', '\\"')}"`,
  );
  expect(snippets.claude.stdio.cmd).not.toContain("'");
  expect(snippets.claude.http.cmd).not.toContain("'");
});
it("preserves literal apostrophes in cmd paths; the brief conflicts for this input", () => {
  expect(
    makeSnippets({ ...fixture, sidecarPath: "C:\\O'Brien\\mcp.exe" }, token)
      .claude.stdio.cmd,
  ).toContain("O'Brien");
});
it("both JSON variants parse and never embed the token", () => {
  const snippets = makeSnippets(fixture, token);
  for (const json of Object.values(snippets.mcpJson)) {
    expect(json).not.toContain(token);
    expect(JSON.parse(json).mcpServers["jam-board"]).toBeTruthy();
  }
  expect(JSON.parse(snippets.mcpJson.stdio).mcpServers["jam-board"]).toEqual({
    command: fixture.sidecarPath,
    args: [],
    env: {
      JAM_AGENT_NAME: "Claude",
      JAM_BOARD_DATA_DIR: fixture.dataDir,
      JAM_BOARD_PROJECT: fixture.projectId,
    },
  });
  expect(
    JSON.parse(snippets.mcpJson.http).mcpServers["jam-board"].headers
      .Authorization,
  ).toBe(`Bearer \${JAM_BOARD_TOKEN}`);
});
it("folder storage replaces legacy env across all stdio snippets", () => {
  const projectFolder = "C:\\Игры\\Little Stones";
  const snippets = makeSnippets({ ...fixture, projectFolder }, token);
  expect(
    JSON.parse(snippets.mcpJson.stdio).mcpServers["jam-board"].env,
  ).toEqual({
    JAM_AGENT_NAME: "Claude",
    JAM_BOARD_PROJECT_FOLDER: projectFolder,
  });
  for (const cli of [
    ...Object.values(snippets.claude.stdio),
    snippets.codex.stdio,
  ]) {
    expect(cli).toContain("JAM_BOARD_PROJECT_FOLDER");
    expect(cli).not.toContain("JAM_BOARD_DATA_DIR");
    expect(cli).not.toContain("JAM_BOARD_PROJECT=");
  }
  expect(
    JSON.parse(snippets.mcpJson.http).mcpServers["jam-board"].headers[
      "X-Jam-Project-Folder"
    ],
  ).toBe(`utf8:${encodeURIComponent(projectFolder)}`);
});
