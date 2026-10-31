import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockDockApi, resetMockDock } from "../lib/agent-dock-mock";
import { mockPhase4Api } from "../lib/agent-dock-phase4-mock";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import {
  acceptProjectSelection,
  matchingSelection,
  selectedContext,
} from "../lib/project-selection";
import { registration, taskFilesApi } from "../lib/task-files-api";
import { GlobalBoardRecovery } from "./projects/GlobalBoardRecovery";
import { TaskDrawer } from "./task/TaskDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/board",
  useBlocker: () => ({}),
}));
vi.mock("../lib/project-folder-api", async (original) => ({
  ...(await original<typeof import("../lib/project-folder-api")>()),
  projectFolders: (await import("../lib/mock-project-folders"))
    .mockProjectFolders,
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  resetMockDock();
  mockApi.taskFiles.copyDelay = 0;
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing integration fixture");
  return value;
}
const client = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

it("R11-G1 shared create → copy/link → role → modal → A→B→A → move → recovery", async () => {
  const cache = client();
  const legacy = required((await api.appState()).jam);
  const a = await api.createProjectFolder(
    "C:/fictional/A",
    "Lantern workshop",
    false,
  );
  const task = await api.createTask({
    title: "Build lantern",
    status: "backlog",
  });
  await acceptProjectSelection(cache, await api.appState());
  const context = await taskFilesApi.capture(a.projectId);
  for (const [storage, path] of [
    ["board_file", "C:/source/Lantern.glb"],
    ["linked_file", "C:/source/config.json"],
  ] as const) {
    const file = await api.registerFile(
      context,
      registration(storage, path, crypto.randomUUID()),
    );
    const version = await taskFilesApi.version(context, task.key);
    await api.linkTaskFile(context, {
      assetId: required(file.asset).id,
      taskKey: task.key,
      role: "reference",
      position: 0,
      expectedUpdatedAt: version.updatedAt,
      expectedClaimGeneration: version.claimGeneration,
      requestId: crypto.randomUUID(),
    });
  }
  const before = await api.getTask(task.key);
  expect(before.files).toHaveLength(2);
  expect((await api.listAssets()).map((asset) => asset.kind)).toEqual([
    "model",
    "other",
  ]);
  const result = await api.setTaskFileRole(context, {
    assetId: required(before.files?.[0]).asset.id,
    taskKey: task.key,
    role: "result",
    position: 0,
    expectedUpdatedAt: before.updatedAt,
    expectedClaimGeneration: before.claimGeneration ?? "0",
    requestId: crypto.randomUUID(),
  });
  expect((await api.getTask(task.key)).updatedAt).toBe(
    required(result.taskVersion).updatedAt,
  );
  function Host() {
    const [presentation, setPresentation] = useState<"drawer" | "modal">(
      "drawer",
    );
    return (
      <TaskDrawer
        taskKey={task.key}
        close={() => {}}
        presentation={presentation}
        onPresentationChange={setPresentation}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={cache}>
      <Host />
    </QueryClientProvider>,
  );
  await screen.findByRole("textbox", { name: "Task title" });
  const form = document.querySelector("#task-form");
  await userEvent.click(screen.getByRole("button", { name: "Open larger" }));
  expect(document.querySelector("#task-form")).toBe(form);
  expect(screen.getByRole("dialog", { name: task.key })).toHaveAttribute(
    "data-presentation",
    "modal",
  );
  view.unmount();
  cache.setQueryData(["planning-draft", "same-task"], { value: "A draft" });
  const oldEvent = required(selectedContext(cache));
  const b = await api.createProjectFolder(
    "C:/fictional/B",
    "Second board",
    false,
  );
  await acceptProjectSelection(cache, await api.appState());
  expect(cache.getQueryData(["planning-draft", "same-task"])).toBeUndefined();
  cache.setQueryData(["planning-draft", "same-task"], { value: "B draft" });
  await api.openProjectFolder(a.folder, false);
  await acceptProjectSelection(cache, await api.appState());
  expect(cache.getQueryData(["planning-draft", "same-task"])).toEqual({
    value: "A draft",
  });
  expect(matchingSelection(cache, oldEvent)).toBe(false);
  await expect(
    api.registerFile(
      context,
      registration("url", "https://example.test/stale", "stale"),
    ),
  ).rejects.toThrow(/target changed/);
  expect((await api.getTask(task.key)).files?.[0]?.role).toBe("result");
  expect(b.projectId).not.toBe(a.projectId);
  await api.selectProject(legacy.id);
  const move = {
    projectId: legacy.id,
    destination: "C:/fictional/Moved",
    cloudAcknowledged: false,
    requestId: "move-g1",
  };
  mockApi.folders.interrupt = true;
  expect(
    (await mockApi.folders.move(move, await api.projectSelectionContext()))
      .state,
  ).toBe("copied");
  mockApi.folders.interrupt = false;
  expect(
    (await mockApi.folders.move(move, await api.projectSelectionContext()))
      .state,
  ).toBe("committed");
  await acceptProjectSelection(cache, await api.appState());
  const generation = required(selectedContext(cache)).databaseGeneration;
  cache.setQueryData(["planning-draft", "same-task"], {
    value: "Before recovery",
  });
  await mockApi.folders.recover(move.destination, false);
  await acceptProjectSelection(cache, await api.appState());
  expect(required(selectedContext(cache)).databaseGeneration).not.toBe(
    generation,
  );
  expect(cache.getQueryData(["planning-draft", "same-task"])).toBeUndefined();
  expect(
    (await api.listExecution()).every(
      (scope) => scope.effectiveState !== "running",
    ),
  ).toBe(true);
});

it("R11-G1 global recovery detects an external edit and replaces generation caches", async () => {
  const info = await api.createProjectFolder(
    "C:/fictional/recovery",
    "Recover board",
    false,
  );
  const cache = client();
  await acceptProjectSelection(cache, await api.appState());
  const original = required(selectedContext(cache));
  mockApi.folders.external = {
    liveHash: "live",
    externalHash: "external",
    liveRevision: 1,
    externalRevision: 2,
    externalValid: true,
    changedTables: ["tasks"],
    error: null,
  };
  render(
    <QueryClientProvider client={cache}>
      <GlobalBoardRecovery />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Compare" }));
  // The explicit comparison enables Restore, never an automatic recovery/write.
  const compare = required(
    screen.getAllByRole("button", { name: "Compare" }).at(-1),
  );
  await userEvent.click(compare);
  await userEvent.click(
    await screen.findByRole("button", { name: "Restore from board.json" }),
  );
  await waitFor(() =>
    expect(selectedContext(cache)?.databaseGeneration).not.toBe(
      original.databaseGeneration,
    ),
  );
  expect((await api.projectFolderInfo()).instanceId).toBe(info.instanceId);
});

it("R11-G1 fake sessions pin locator/cwd, block move, retain cwd on resume and reject unavailable cwd", async () => {
  const info = await api.createProjectFolder(
    "C:/fictional/agents",
    "Agent board",
    false,
  );
  await api.setSettings({ workingDirectory: "C:/worktree/original" });
  const session = await mockDockApi.startSession({
    profileId: "codex",
    userConfig: "exclude",
  });
  expect(session.cwd).toBe("C:/worktree/original");
  expect(
    (await mockApi.folders.preview(info.projectId, "C:/fictional/moved"))
      .agentSessionBound,
  ).toBe(true);
  await api.createProjectFolder("C:/fictional/other", "Other board", false);
  expect(mockApi.sessionLocators.get(session.id)?.projectId).toBe(
    info.projectId,
  );
  await api.openProjectFolder(info.folder, false);
  await mockDockApi.stopSession(session.id);
  await api.setSettings({ workingDirectory: "C:/worktree/new" });
  const resumed = await mockPhase4Api.resume(session.id, "exclude");
  expect(resumed.cwd).toBe(session.cwd);
  await mockDockApi.stopSession(resumed.id);
  await expect(
    mockDockApi.startSession({
      profileId: "codex",
      cwd: "C:/missing",
      userConfig: "exclude",
    }),
  ).rejects.toThrow(/unavailable/);
  const explicit = await mockDockApi.startSession({
    profileId: "codex",
    cwd: "C:/explicit",
    userConfig: "exclude",
  });
  expect(explicit.cwd).toBe("C:/explicit");
  await mockDockApi.stopSession(explicit.id);
});
