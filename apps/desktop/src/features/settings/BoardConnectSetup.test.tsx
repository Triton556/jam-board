// S01: project-scoped external MCP setup; no connection or execution is launched.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { mockApi } from "../../lib/mock-bridge";
import { BoardConnectSetup } from "./BoardConnectSetup";

vi.mock("../brain/brain-profiles", () => ({
  profilesQuery: { queryKey: ["agentDockProfiles"], queryFn: async () => [] },
}));
vi.mock("../../lib/project-folder-api", () => ({
  useFolderGuard: () => async () =>
    Object.assign(async () => {}, { context: {} }),
  readFolderSettings: async (projectId: string) => ({
    projectId,
    projectFolder: "C:\\Board",
    workingDirectory: "C:\\Code",
  }),
  writeFolderSettings: vi.fn(),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => vi.restoreAllMocks());
async function mount(transport: "stdio" | "http" = "stdio") {
  const state = await api.appState();
  if (!state.jam) throw new Error("Missing fixture project");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], state);
  client.setQueryData(["members"], []);
  const setup = {
    project: state.jam,
    client: "claude" as const,
    transport,
    sidecarPath: "C:\\Jam\\mcp.exe",
    dataDir: "C:\\Data",
    port: 47321,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <BoardConnectSetup setup={setup} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled(),
  );
  return { ...view, client, setup };
}
it("switches tabs, remembers choice, copies code, shows CLI-only PATH and restart/JSON lines", async () => {
  const { unmount } = await mount();
  fireEvent.click(screen.getByRole("tab", { name: "Command Prompt" }));
  expect(screen.getByText(/If/)).toHaveTextContent("isn't recognized");
  expect(screen.getByText(/Then restart/)).toHaveTextContent(
    "get_session_context",
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('JAM_BOARD_PROJECT_FOLDER="C:\\Board"'),
    ),
  );
  expect(localStorage.getItem("jam-board.connect-shell")).toBe("cmd");
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: ".mcp.json" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("tab", { name: ".mcp.json" }));
  expect(screen.queryByText(/isn't recognized/)).toBeNull();
  expect(screen.getByText(/Save as/)).toHaveTextContent(
    "Claude Code asks once to trust it",
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2),
  );
  expect(
    JSON.parse(
      vi.mocked(navigator.clipboard.writeText).mock.calls[1]?.[0] ?? "",
    ).mcpServers["jam-board"].env.JAM_BOARD_PROJECT_FOLDER,
  ).toBe("C:\\Board");
  unmount();
  await mount();
  expect(screen.getByRole("tab", { name: ".mcp.json" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
it("shows waiting then actual online agent and optional client", async () => {
  const { client } = await mount();
  expect(screen.getByText("Waiting for an agent to connect…")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await act(async () => {
    client.setQueryData(
      ["members"],
      [
        {
          id: "fake",
          kind: "agent",
          name: "Claude",
          online: true,
          client: "claude-code 2.1",
          lastSeenAt: new Date().toISOString(),
        },
      ],
    );
  });
  await waitFor(() =>
    expect(screen.getByText(/sees this project/)).toHaveTextContent(
      "✓ Claude (claude-code 2.1) connected just now — sees this project",
    ),
  );
  await act(async () => {
    client.setQueryData(
      ["members"],
      [
        {
          kind: "agent",
          name: "Worker",
          online: true,
          lastSeenAt: new Date().toISOString(),
        },
      ],
    );
  });
  await waitFor(() =>
    expect(screen.getByText(/sees this project/)).not.toHaveTextContent(
      "claude-code",
    ),
  );
});
it("uses the existing available Claude profile absolute path", async () => {
  const { client } = await mount();
  fireEvent.click(screen.getByRole("tab", { name: "PowerShell" }));
  await act(async () => {
    client.setQueryData(
      ["agentDockProfiles"],
      [
        {
          preset: "claude-code",
          available: true,
          command: "C:\\Claude\\claude.exe",
        },
      ],
    );
  });
  await waitFor(() =>
    expect(screen.getByText("C:\\Claude\\claude.exe")).toBeInTheDocument(),
  );
});
it("JSON HTTP copy never reveals the token", async () => {
  const reveal = vi.spyOn(api, "revealMcpToken");
  await mount("http");
  fireEvent.click(screen.getByRole("tab", { name: ".mcp.json" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  expect(reveal).not.toHaveBeenCalled();
  expect(
    vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? "",
  ).toContain(`\${JAM_BOARD_TOKEN}`);
});
it("locks duplicate HTTP copies and tabs; unmount cancels a late secret", async () => {
  let finish!: (token: string) => void;
  const reveal = vi.spyOn(api, "revealMcpToken").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = await mount("http");
  fireEvent.click(screen.getByRole("tab", { name: "PowerShell" }));
  const copy = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(copy);
  fireEvent.click(copy);
  await waitFor(() => expect(reveal).toHaveBeenCalledOnce());
  expect(screen.getByRole("tab", { name: "bash" })).toBeDisabled();
  unmount();
  await act(async () => {
    finish("fictional-private-token");
  });
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});

it("defaults to PowerShell on Windows and bash elsewhere", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
  const first = await mount();
  expect(screen.getByRole("tab", { name: "PowerShell" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  first.unmount();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Linux");
  await mount();
  expect(screen.getByRole("tab", { name: "bash" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
it("clipboard failure retains the command and permits an explicit retry", async () => {
  await mount();
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
    Error("Clipboard blocked"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Clipboard blocked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Configuration copied.")).toBeInTheDocument();
});
it("a project change during token reveal cancels the clipboard write", async () => {
  let finish!: (token: string) => void;
  vi.spyOn(api, "revealMcpToken").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { client } = await mount("http");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => {
    client.setQueryData(["app"], { jam: { id: "other-project" } });
    finish("fictional-private-token");
  });
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(screen.queryByText("Configuration copied.")).toBeNull();
});
it("token reveal failure does not write the clipboard or auto-retry", async () => {
  const reveal = vi
    .spyOn(api, "revealMcpToken")
    .mockRejectedValueOnce(Error("Token unavailable"));
  await mount("http");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Token unavailable")).toBeInTheDocument();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(reveal).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
});
