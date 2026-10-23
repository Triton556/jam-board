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
    expect(snippets.codexHttp).toContain('"X-Jam-Agent" = "Codex"');
    if (projectId)
      expect(snippets.codexHttp).toContain('"X-Jam-Project" = "project-A"');
    expect(
      JSON.parse(
        snippets.codexStdio.split("\n")[1]?.slice("command = ".length) ?? "",
      ),
    ).toBe(path);
    expect(snippets.codexStdio).toContain('JAM_AGENT_NAME = "Codex"');
    expect(snippets.claudeHttp).toContain("X-Jam-Agent: Claude");
  },
);
