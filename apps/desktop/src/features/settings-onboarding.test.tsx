import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { brainHandoff, projectConnectionPrompt } from "../lib/brain-handoff";
import { mockApi } from "../lib/mock-bridge";
import { SettingsPage } from "./settings/SettingsPage";
import {
  playbookCloneCommand,
  playbookRepository,
  SkillSetup,
} from "./settings/SkillSetup";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
afterEach(() => vi.restoreAllMocks());
function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
  return { ...view, client };
}
function connectionCard() {
  const card = screen
    .getByRole("heading", { name: "Connect the board" })
    .closest("section");
  if (!card) throw Error("Missing connection card");
  return within(card);
}
it("names the bound project, separates connection/appointment/permission and does not reveal tokens on read", async () => {
  const app = await mockApi.appState();
  wrap(<SettingsPage initialSection="Agents" />);
  expect(
    await screen.findByText(`${app.jam?.name} · ${app.jam?.keyPrefix}`, {
      selector: "strong",
    }),
  ).toBeVisible();
  expect(
    screen.getByText(/Switching boards in Jam Board does not redirect/),
  ).toBeVisible();
  expect(
    screen.getByText(/Repeat for each epic it should coordinate/),
  ).toBeVisible();
  expect(
    screen.getByText(/MCP works without installing this skill/),
  ).toBeVisible();
  expect(
    screen.getByText(
      /Installation verification checks files, not protocol compatibility/,
    ),
  ).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Show configuration" }));
  expect(
    screen.getByRole("region", { name: "Connect the board" }),
  ).toHaveFocus();
  await userEvent
    .setup()
    .click(screen.getByText("Connect another project or upgrade a client"));
  expect(screen.getByText(/Do not paste duplicate entries/)).toBeVisible();
  expect(
    mockApi.calls.some((c) =>
      [
        "reveal_mcp_token",
        "mcp_config_snippets",
        "set_brain",
        "set_execution",
        "run_skill",
      ].includes(c.command),
    ),
  ).toBe(false);
});
it("copies an exact project ID check without a claim, role mutation or token access", async () => {
  const user = userEvent.setup();
  const app = await mockApi.appState();
  if (!app.jam) throw Error("Missing fixture");
  wrap(<SettingsPage initialSection="Agents" />);
  const button = screen.getByRole("button", { name: "Copy connection check" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await navigator.clipboard.readText()).toBe(
    projectConnectionPrompt(app.jam),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    `Connection check copied for ${app.jam.name} · ${app.jam.keyPrefix}`,
  );
  expect(
    mockApi.calls.some((c) =>
      ["reveal_mcp_token", "mcp_config_snippets"].includes(c.command),
    ),
  ).toBe(false);
});
it("stdio copy uses the displayed project and does not fetch an unnecessary token", async () => {
  const user = userEvent.setup();
  const app = await mockApi.appState();
  wrap(<SettingsPage initialSection="Agents" />);
  await waitFor(() =>
    expect(
      connectionCard().getByRole("button", { name: "Copy" }),
    ).toBeEnabled(),
  );
  await user.click(connectionCard().getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toContain(
    `JAM_BOARD_PROJECT = "${app.jam?.id}"`,
  );
  expect(
    mockApi.calls.some((c) =>
      ["reveal_mcp_token", "mcp_config_snippets"].includes(c.command),
    ),
  ).toBe(false);
});
it("an HTTP copy keeps its captured target label across a project rename", async () => {
  const user = userEvent.setup();
  let resolve!: (value: string) => void;
  vi.spyOn(mockApi, "revealMcpToken").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { client } = wrap(<SettingsPage initialSection="Agents" />);
  const original = await mockApi.appState();
  await waitFor(() =>
    expect(
      connectionCard().getByRole("button", { name: "Copy" }),
    ).toBeEnabled(),
  );
  await user.click(connectionCard().getByRole("tab", { name: "Codex · HTTP" }));
  await user.click(connectionCard().getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  const oldStatus = await mockApi.mcpStatus();
  await act(async () => {
    client.setQueryData(["app"], {
      ...original,
      jam: {
        ...original.jam,
        id: original.jam?.id,
        keyPrefix: original.jam?.keyPrefix,
        name: "Renamed project",
      },
    });
    client.setQueryData(["mcpStatus"], {
      ...oldStatus,
      projectId: original.jam?.id,
      projectKeyPrefix: original.jam?.keyPrefix,
    });
    resolve("local-test-token");
  });
  expect(await navigator.clipboard.readText()).toContain(
    `"X-Jam-Project" = "${original.jam?.id}"`,
  );
  expect(await navigator.clipboard.readText()).not.toContain("OTHER");
  expect(await screen.findByRole("status")).toHaveTextContent(
    `Configuration copied for ${original.jam?.name} · JB`,
  );
  expect(screen.getByRole("status")).toHaveTextContent("keep it private");
});
it("unmatched project settings do not offer a configuration or a misleading connection check", async () => {
  const status = await mockApi.mcpStatus();
  vi.spyOn(mockApi, "mcpStatus").mockResolvedValueOnce({
    ...status,
    projectId: "other-id",
  });
  wrap(<SettingsPage initialSection="Agents" />);
  await screen.findByText(
    /Connection settings are unavailable or do not match/,
  );
  expect(
    screen.getByRole("button", { name: "Copy connection check" }),
  ).toBeDisabled();
  expect(connectionCard().queryByRole("button", { name: "Copy" })).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry connection settings" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy connection check" }),
    ).toBeEnabled(),
  );
  expect(connectionCard().getByRole("button", { name: "Copy" })).toBeVisible();
});
it("optional acquisition is user-triggered, copy-only and has honest browser failure recovery", async () => {
  const user = userEvent.setup();
  const open = vi
    .spyOn(mockApi, "openUrl")
    .mockRejectedValueOnce(Error("offline"));
  wrap(<SkillSetup />);
  expect(open).not.toHaveBeenCalled();
  await user.click(screen.getByText("I don't have agent-playbook yet"));
  await user.click(screen.getByRole("button", { name: "Copy clone command" }));
  expect(await navigator.clipboard.readText()).toBe(playbookCloneCommand);
  expect(screen.getByRole("status")).toHaveTextContent("Run it yourself");
  expect(mockApi.calls.some((c) => c.command === "run_skill")).toBe(false);
  await user.click(
    screen.getByRole("button", { name: "Open playbook instructions ↗" }),
  );
  expect(open).toHaveBeenCalledWith(`${playbookRepository}#quick-start`);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "nothing was installed",
  );
});
it("optional acquisition keeps a selectable command after clipboard failure", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
    Error("denied"),
  );
  wrap(<SkillSetup />);
  await user.click(screen.getByText("I don't have agent-playbook yet"));
  await user.click(screen.getByRole("button", { name: "Copy clone command" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Clipboard unavailable",
  );
  expect(screen.getByText(playbookCloneCommand)).toBeVisible();
});
it("planning prompts defer to live schemas and preserve the separate per-epic appointment", () => {
  const prompt = brainHandoff(
    { type: "epic", id: "fixture-epic", key: "JB-E1" },
    { id: "exact-project", name: "Fictional project", keyPrefix: "JB" },
  );
  expect(prompt).toContain("Read the connected tool schemas");
  expect(prompt).toContain("do not replace another brain");
  expect(prompt).toContain(
    "only for an unassigned epic after my explicit appointment",
  );
  expect(prompt).toContain("never refill validators and replay blindly");
});

it("explains stable connection identities without changing configuration, role or authorization", async () => {
  const user = userEvent.setup();
  wrap(<SettingsPage initialSection="Agents" />);
  expect(await screen.findByText("Agent identity")).toBeVisible();
  expect(screen.getByText(/replace its default Codex or Claude/)).toBeVisible();
  await user.click(screen.getByText("Several workers or inherited subagents?"));
  expect(
    screen.getByText(/same normalized name share one board member/),
  ).toBeVisible();
  expect(
    screen.getByText(/Subagents inheriting the same MCP connection/),
  ).toBeVisible();
  expect(screen.getByText(/hides those peers' events/)).toBeVisible();
  expect(
    mockApi.calls.some((c) =>
      [
        "reveal_mcp_token",
        "mcp_config_snippets",
        "set_brain",
        "set_execution",
        "run_skill",
      ].includes(c.command),
    ),
  ).toBe(false);
});
