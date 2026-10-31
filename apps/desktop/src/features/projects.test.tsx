import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { makeSnippets } from "../lib/mcp-config";
import { MockBridge, mockApi } from "../lib/mock-bridge";
import { acceptProjectSelection } from "../lib/project-selection";
import { ProjectsPage } from "./projects/ProjectsPage";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useBlocker: () => ({}),
}));

const blank = (name: string) => ({
  name,
  yourName: "Human",
  theme: null,
  startsAt: "",
  endsAt: "",
  timezone: "UTC",
  template: "custom",
  milestoneAt: null,
});

beforeEach(async () => {
  navigate.mockReset();
  await mockApi.resetDemo();
});

it("creates independent projects with unique prefixes and restores the original board on switch", async () => {
  const bridge = new MockBridge();
  const first = await bridge.createJam(blank("First"));
  const task = await bridge.createTask({
    title: "First draft",
    status: "backlog",
  });
  const second = await bridge.createJam(blank("Second"));
  expect(first.jam?.keyPrefix).toBe("JB");
  expect(second.jam?.keyPrefix).toBe("JB2");
  expect((await bridge.listProjects()).map((p) => p.name)).toEqual(
    expect.arrayContaining(["First", "Second"]),
  );
  expect((await bridge.listBoardTasks()).backlog).toHaveLength(0);
  await expect(bridge.getTask(task.key)).rejects.toThrow("not found");
  await bridge.selectProject(first.jam?.id ?? "");
  expect((await bridge.getTask(task.key)).title).toBe("First draft");
  expect((await bridge.listProjects()).filter((p) => p.selected)).toHaveLength(
    1,
  );
});

it("archives and restores a whole project without changing individual task archives", async () => {
  const bridge = new MockBridge();
  const first = await bridge.createJam(blank("First"));
  const visible = await bridge.createTask({ title: "Keep", status: "backlog" });
  const archived = await bridge.createTask({
    title: "Already archived",
    status: "backlog",
  });
  await bridge.archiveTask(archived.key);
  const second = await bridge.createJam(blank("Second"));
  await bridge.selectProject(first.jam?.id ?? "");
  const state = await bridge.resetJam({ confirmName: "First" });
  expect(state.jam?.id).toBe(second.jam?.id);
  expect(await bridge.listProjects()).toHaveLength(1);
  expect(await bridge.listProjects(true)).toHaveLength(2);
  await expect(bridge.selectProject(first.jam?.id ?? "")).rejects.toThrow(
    "Restore",
  );
  await bridge.restoreProject(first.jam?.id ?? "");
  await expect(
    bridge.restoreProject(first.jam?.id ?? ""),
  ).resolves.toMatchObject({ jam: { id: first.jam?.id } });
  expect((await bridge.getTask(visible.key)).archivedAt).toBeNull();
  expect((await bridge.getTask(archived.key)).archivedAt).not.toBeNull();
});

it("failed creation does not erase current references; failed selection keeps current data", async () => {
  const bridge = new MockBridge();
  const first = await bridge.createJam(blank("First"));
  await bridge.addReference({ kind: "note", text: "Preserve my idea" });
  await expect(bridge.createJam(blank(""))).rejects.toThrow(
    "Check the jam name",
  );
  expect((await bridge.referenceCanvas()).items).toHaveLength(1);
  await expect(bridge.selectProject("missing")).rejects.toThrow(
    "Project not found",
  );
  expect((await bridge.appState()).jam?.id).toBe(first.jam?.id);
});

it("cannot archive a project while workers still have in-progress tasks", async () => {
  const bridge = new MockBridge();
  const state = await bridge.loadDemoJam();
  await expect(
    bridge.resetJam({ confirmName: state.jam?.name ?? "" }),
  ).rejects.toThrow("still in progress");
  expect((await bridge.appState()).jam?.id).toBe(state.jam?.id);
  expect((await bridge.listProjects(true))[0]?.archived).toBe(false);
});

it("demo creation keeps the old board and allocates new hierarchy keys and identities", async () => {
  const bridge = new MockBridge();
  const first = await bridge.loadDemoJam();
  const firstEpics = await bridge.listEpics();
  await bridge.loadDemoJam();
  const secondEpics = await bridge.listEpics();
  expect(secondEpics.every((e) => e.key.startsWith("JB2-"))).toBe(true);
  expect(
    secondEpics.every((e) => !firstEpics.some((old) => old.id === e.id)),
  ).toBe(true);
  await bridge.selectProject(first.jam?.id ?? "");
  expect((await bridge.listEpics()).map((e) => e.key)).toEqual(
    firstEpics.map((e) => e.key),
  );
});

it("all connection snippets explicitly pin the current project", () => {
  const snippets = makeSnippets(
    {
      sidecarPath: "C:\\Jam Board\\jam-board-mcp.exe",
      dataDir: "C:\\Jam Board\\data",
      port: 47321,
      projectKeyPrefix: "JB2",
    },
    "test-token",
  );
  expect(snippets.codexStdio).toContain('JAM_BOARD_PROJECT = "JB2"');
  expect(snippets.claudeStdio).toContain("JAM_BOARD_PROJECT='JB2'");
  expect(snippets.codexHttp).toContain('"X-Jam-Project" = "JB2"');
  expect(snippets.claudeHttp).toContain("X-Jam-Project: JB2");
});

it("project picker opens a chosen board, clears stale UI feedback but preserves planning drafts", async () => {
  const original = await mockApi.appState();
  const client = new QueryClient();
  await acceptProjectSelection(client, original);
  client.setQueryData(["planning-draft", "safe-id"], {
    dirty: true,
    draft: "My note",
  });
  await acceptProjectSelection(
    client,
    await mockApi.createJam(blank("Second project")),
  );
  expect(client.getQueryData(["planning-draft", "safe-id"])).toBeUndefined();
  render(
    <QueryClientProvider client={client}>
      <ProjectsPage />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const open = await screen.findByRole("button", {
    name: `Open project ${original.jam?.name}`,
  });
  await user.click(open);
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/plan",
      search: {},
      ignoreBlocker: true,
    }),
  );
  expect((await mockApi.appState()).jam?.id).toBe(original.jam?.id);
  expect(client.getQueryData(["planning-draft", "safe-id"])).toEqual({
    dirty: true,
    draft: "My note",
  });
});

it("reconciles the actual selected project after a lost selection response", async () => {
  const original = await mockApi.appState();
  await mockApi.createJam(blank("Second project"));
  const select = mockApi.selectProject.bind(mockApi);
  const failure = vi
    .spyOn(mockApi, "selectProject")
    .mockImplementationOnce(async (id) => {
      await select(id);
      throw new Error("Response interrupted");
    });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ProjectsPage />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: `Open project ${original.jam?.name}`,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "current project has been refreshed",
  );
  expect(client.getQueryData<{ jam: { id: string } }>(["app"])?.jam.id).toBe(
    original.jam?.id,
  );
  expect(navigate).not.toHaveBeenCalled();
  failure.mockRestore();
});

it("project list filters support arrow-key selection", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectsPage />
    </QueryClientProvider>,
  );
  const active = await screen.findByRole("radio", { name: "Active projects" });
  active.focus();
  await userEvent.setup().keyboard("{ArrowRight}");
  expect(
    screen.getByRole("radio", { name: "Archived projects" }),
  ).toBeChecked();
  expect(screen.getByText(/No archived projects/)).toBeVisible();
});
