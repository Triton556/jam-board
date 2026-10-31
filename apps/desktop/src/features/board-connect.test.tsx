import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import {
  type BoardConnectionSetup,
  boardConnectionPrompt,
} from "../lib/brain-handoff";
import { mockApi } from "../lib/mock-bridge";
import { BoardConnectSetup } from "./settings/BoardConnectSetup";

beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const app = await mockApi.appState();
  if (!app.jam) throw Error("No demo");
  const setup: BoardConnectionSetup = {
    project: app.jam,
    client: "codex",
    transport: "stdio",
    sidecarPath: "C:\\Jam Board\\jam-board-mcp.exe",
    dataDir: "C:\\Jam data",
    port: 47321,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  render(
    <QueryClientProvider client={client}>
      <BoardConnectSetup setup={setup} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy agent connection prompt" }),
    ).toBeEnabled(),
  );
  return { app, setup, client };
}
it("copies neutral exact-project bootstrap without tokens, role or task mutations", async () => {
  const user = userEvent.setup();
  const { setup } = await fixture();
  await user.click(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  );
  const copied = await navigator.clipboard.readText();
  expect(copied).toBe(boardConnectionPrompt(setup));
  expect(copied).toContain(setup.project.id);
  expect(copied).toContain("jam://guide");
  expect(copied).toContain("No filesystem project folder is saved");
  expect(copied).toContain(
    "not an instruction to start work or appoint yourself as brain",
  );
  expect(copied).toContain("reload/restart");
  expect(copied).toContain("do not overwrite an existing connection");
  expect(await screen.findByRole("status")).toHaveTextContent(
    "nothing has connected yet",
  );
  expect(
    mockApi.calls.some((c) =>
      [
        "reveal_mcp_token",
        "mcp_config_snippets",
        "set_brain",
        "run_skill",
        "claim_task",
      ].includes(c.command),
    ),
  ).toBe(false);
});
it("HTTP setup contains endpoint metadata, not a token value or authorization header", async () => {
  const { setup } = await fixture();
  const prompt = boardConnectionPrompt({
    ...setup,
    transport: "http",
    projectFolder: "C:\\Code\\Game",
  });
  expect(prompt).toContain("http://127.0.0.1:47321/mcp");
  expect(prompt).not.toContain("Authorization: Bearer");
  expect(prompt).not.toContain(setup.dataDir);
  expect(prompt).toContain("saved filesystem hint");
  expect(prompt).toContain("C:\\\\Code\\\\Game");
});
it("saves picked folder for this project and includes it in later prompts", async () => {
  const user = userEvent.setup();
  const { setup } = await fixture();
  vi.spyOn(api, "pickFolder").mockResolvedValue("C:\\Code\\Game");
  await user.click(screen.getByRole("button", { name: "Choose code folder…" }));
  expect(await screen.findByText("C:\\Code\\Game")).toBeVisible();
  expect((await api.getSettings()).workingDirectory).toBe("C:\\Code\\Game");
  await user.click(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  );
  expect(await navigator.clipboard.readText()).toBe(
    boardConnectionPrompt({ ...setup, projectFolder: "C:\\Code\\Game" }),
  );
});
it("cancelled folder choice leaves saved folder unchanged", async () => {
  const user = userEvent.setup();
  await fixture();
  vi.spyOn(api, "pickFolder").mockResolvedValue(null);
  const save = vi.spyOn(api, "setSettings");
  await user.click(screen.getByRole("button", { name: "Choose code folder…" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(/Not set. The agent will ask/)).toBeVisible();
});
it("delayed folder picker cannot save into newly selected board", async () => {
  const user = userEvent.setup();
  const { app, client } = await fixture();
  let resolve!: (value: string) => void;
  vi.spyOn(api, "pickFolder").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const save = vi.spyOn(api, "setSettings");
  await user.click(screen.getByRole("button", { name: "Choose code folder…" }));
  await act(async () => {
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "another-board" },
    });
    resolve("C:\\Code\\Wrong");
  });
  expect(save).not.toHaveBeenCalled();
});
it("copy failure is visible and permits retry without claiming connection success", async () => {
  const user = userEvent.setup();
  await fixture();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
    new Error("Clipboard blocked"),
  );
  await user.click(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Clipboard blocked",
  );
  expect(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  ).toBeEnabled();
  await user.click(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Connection prompt copied",
  );
});
it("settings read failure blocks copying until retry", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "getSettings").mockRejectedValueOnce(
    new Error("Read unavailable"),
  );
  const app = await mockApi.appState();
  if (!app.jam) throw Error("No demo");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  render(
    <QueryClientProvider client={client}>
      <BoardConnectSetup
        setup={{
          project: app.jam,
          client: "claude",
          transport: "http",
          sidecarPath: "",
          dataDir: "",
          port: 47321,
        }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not read");
  expect(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  ).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: "Retry folder" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy agent connection prompt" }),
    ).toBeEnabled(),
  );
});

it("copy stays visibly pending and suppresses repeated clicks until clipboard resolves", async () => {
  const user = userEvent.setup();
  await fixture();
  let resolve!: () => void;
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  await user.click(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  );
  const pending = screen.getByRole("button", { name: "Copying…" });
  expect(pending).toBeDisabled();
  await user.click(pending);
  expect(copy).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  ).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "nothing has connected yet",
  );
});

it("failed folder save keeps the previous value and shows its error", async () => {
  const user = userEvent.setup();
  await fixture();
  vi.spyOn(api, "pickFolder").mockResolvedValue("C:/Rejected");
  vi.spyOn(api, "setSettings").mockRejectedValueOnce(
    new Error("Project changed"),
  );
  await user.click(screen.getByRole("button", { name: "Choose code folder…" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Project changed",
  );
  expect(screen.getByText(/Not set. The agent will ask/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Choose code folder…" }),
  ).toBeEnabled();
});

it("folder retry stays pending, ignores duplicate clicks and recovers after another error", async () => {
  const user = userEvent.setup();
  const { client, setup } = await fixture();
  const value = await api.getSettings();
  const read = vi
    .spyOn(api, "getSettings")
    .mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["settings", setup.project.id] });
  });
  let reject!: (error: Error) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await user.click(await screen.findByRole("button", { name: "Retry folder" }));
  const retry = screen.getByRole("button", { name: "Reading folder…" });
  expect(retry).toBeDisabled();
  expect(retry).toHaveAttribute("aria-busy", "true");
  await user.click(retry);
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error("still offline")));
  expect(
    await screen.findByRole("button", { name: "Retry folder" }),
  ).toBeEnabled();
  read.mockResolvedValueOnce(value);
  await user.click(await screen.findByRole("button", { name: "Retry folder" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy agent connection prompt" }),
    ).toBeEnabled(),
  );
});

it("rejects delayed settings for a different project instead of caching its folder", async () => {
  const { client, setup } = await fixture();
  const old = await api.getSettings();
  let resolve!: (value: typeof old) => void;
  vi.spyOn(api, "getSettings").mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let refetch!: Promise<void>;
  act(() => {
    refetch = client.refetchQueries({
      queryKey: ["settings", setup.project.id],
    });
  });
  await act(async () => {
    resolve({ ...old, projectId: "old-board", projectFolder: "/wrong/folder" });
    await refetch;
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not read");
  expect(
    screen.getByRole("button", { name: "Copy agent connection prompt" }),
  ).toBeDisabled();
  expect(
    client.getQueryData<typeof old>(["settings", setup.project.id])
      ?.projectFolder,
  ).not.toBe("/wrong/folder");
});
