import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { commands } from "../../bindings";
import { api } from "../../lib/api";
import { mockApi } from "../../lib/mock-bridge";
import {
  MockProjectFolders,
  mockProjectFolders,
} from "../../lib/mock-project-folders";
import {
  folderContext,
  folderPolicy,
  tauriProjectFolders,
} from "../../lib/project-folder-api";
import { tauriApi } from "../../lib/tauri-bridge";
import { relativeTime } from "../../lib/time";
import { Welcome } from "../onboarding/Welcome";
import { ProjectFolderSettings } from "../settings/ProjectSettings";
import { BoardRecovery } from "./BoardRecovery";
import { MoveToFolder } from "./MoveToFolder";
import { ProjectFolderDialog } from "./ProjectFolderDialog";
import { ProjectsPage } from "./ProjectsPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
vi.mock("../../lib/project-folder-api", async (original) => ({
  ...(await original<typeof import("../../lib/project-folder-api")>()),
  projectFolders: (await import("../../lib/mock-project-folders"))
    .mockProjectFolders,
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  Object.assign(mockProjectFolders, new MockProjectFolders(mockApi));
  await mockApi.resetDemo();
  vi.spyOn(tauriProjectFolders, "selection").mockImplementation(() =>
    mockProjectFolders.selection(),
  );
  vi.spyOn(tauriProjectFolders, "readSettings").mockImplementation(() =>
    mockProjectFolders.readSettings(),
  );
  vi.spyOn(tauriProjectFolders, "writeSettings").mockImplementation(
    (id, patch, context) =>
      mockProjectFolders.writeSettings(id, patch, context),
  );
});
async function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  return {
    ...render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    ),
    client,
  };
}
const dialog = (
  key: string,
  mode: "create" | "open" = "create",
  folder = "",
) => (
  <ProjectFolderDialog
    mode={mode}
    draftKey={key}
    initialFolder={folder}
    onClose={vi.fn()}
    onOpened={vi.fn()}
  />
);

it("merges unavailable folders into named project cards without IDs or availability noise", async () => {
  const info = await mockProjectFolders.create(
    "C:/missing-game",
    "Missing game",
    false,
  );
  const entry = mockProjectFolders.entries[0];
  if (!entry) throw new Error("Missing registry fixture");
  entry.availability = "unavailable";
  await mockProjectFolders.create("C:/current-game", "Current game", false);
  await mount(<ProjectsPage />);
  const list = await screen.findByRole("region", { name: "Active projects" });
  const heading = await within(list).findByRole("heading", {
    name: "Missing game",
  });
  const card = heading.closest("article");
  if (!card) throw new Error("Missing card");
  expect(within(card).getByText("Folder not found")).toBeVisible();
  expect(within(card).getByRole("button", { name: "Locate…" })).toBeEnabled();
  expect(
    within(card).getByRole("button", { name: "Remove from list" }),
  ).toBeEnabled();
  expect(within(card).getByTitle(info.folder)).toBeVisible();
  expect(
    within(list).getAllByRole("heading", { name: "Missing game" }),
  ).toHaveLength(1);
  expect(screen.queryByText(info.projectId)).not.toBeInTheDocument();
  expect(screen.queryByText("Available")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Recent folders" }),
  ).not.toBeInTheDocument();
});
it("uses a radio choice and one enabled primary action for duplicate boards", async () => {
  const user = userEvent.setup();
  const original = await mockProjectFolders.create(
    "C:/radio-original",
    "Radio game",
    false,
  );
  mockProjectFolders.folders.set("C:/radio-copy", {
    ...original,
    folder: "C:/radio-copy",
  });
  await mount(dialog("radio-choice", "open", "C:/radio-copy"));
  expect(screen.getByLabelText("Chosen folder")).toHaveValue("C:/radio-copy");
  await user.click(screen.getByRole("button", { name: "Open" }));
  const group = await screen.findByRole("group", {
    name: "Which board would you like to open?",
  });
  const registered = within(group).getByRole("radio", {
    name: /Open the board already registered/,
  });
  expect(registered).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Open registered board" }),
  ).toBeEnabled();
  await user.click(
    within(group).getByRole("radio", { name: /Open as a separate copy/ }),
  );
  expect(
    screen.getByRole("button", { name: "Open separate copy" }),
  ).toBeEnabled();
  await user.click(registered);
  await user.click(
    screen.getByRole("button", { name: "Open registered board" }),
  );
  await waitFor(() =>
    expect(mockProjectFolders.selected?.folder).toBe(original.folder),
  );
});
it("highlights the human move step and keeps technical progress in Details", async () => {
  const user = userEvent.setup();
  const id = (await mockApi.appState()).jam?.id ?? "missing";
  mockProjectFolders.interrupt = true;
  await mount(
    <MoveToFolder projectId={id} name="Readable progress" onClose={vi.fn()} />,
  );
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  await user.click(screen.getByRole("button", { name: "Move to folder" }));
  expect(
    await screen.findByText("Move interrupted while copying files"),
  ).toBeVisible();
  const steps = screen.getByRole("list", { name: "Move progress" });
  expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent(
    "Copying files",
  );
  expect(
    within(steps)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("Preparing"),
    "Copying files",
    "Checking",
    "Switching over",
    "Done",
  ]);
  expect(within(steps).getByRole("img", { name: "Completed" })).toBeVisible();
  expect(
    steps.querySelectorAll('.folder-step-connector[aria-hidden="true"]'),
  ).toHaveLength(4);
  expect(
    screen.getByText(
      "Your board is still safe in its old place. Resume to continue, or roll back to undo.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("Interrupted. The source remains available."),
  ).not.toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Check operation" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Source backup:/)).not.toBeVisible();
});
it("shows the disconnect warning only for owners reported by the preview", async () => {
  const user = userEvent.setup();
  const id = (await mockApi.appState()).jam?.id ?? "missing";
  await mount(
    <MoveToFolder projectId={id} name="Owner visibility" onClose={vi.fn()} />,
  );
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move to folder" }),
    ).toBeEnabled(),
  );
  expect(
    screen.queryByText("Disconnect these before moving:"),
  ).not.toBeInTheDocument();
  mockProjectFolders.agentBound = true;
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Agent sessions — disconnect in Agents",
  );
  expect(
    screen.queryByText(/External MCP connections/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Move to folder" })).toBeDisabled();
});
it("retains the typed name after picker cancellation and remount", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "pickFolder").mockResolvedValue(null);
  const view = await mount(dialog("cancel"));
  await user.type(screen.getByLabelText("Project name"), "Retained idea");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  expect(screen.getByLabelText("Project name")).toHaveValue("Retained idea");
  expect(screen.getByPlaceholderText("No folder chosen")).toBeVisible();
  view.unmount();
  await mount(dialog("cancel"));
  expect(screen.getByLabelText("Project name")).toHaveValue("Retained idea");
});
it("rejects a late A→B→A picker receipt and preserves the scoped name draft", async () => {
  const user = userEvent.setup();
  const a = (await mockApi.appState()).jam;
  const b = await mockApi.createJam({
    name: "Project B",
    yourName: "Human",
    template: "custom",
    theme: null,
    startsAt: "",
    endsAt: "",
    timezone: "UTC",
  });
  if (!a || !b.jam) throw new Error("Missing A/B fixture");
  await mockProjectFolders.selectLegacy(a.id);
  let finish: (path: string) => void = () => {};
  vi.spyOn(mockApi, "pickFolder").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount(dialog("late"));
  await user.type(screen.getByLabelText("Project name"), "Project A draft");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  await act(async () => {
    await mockProjectFolders.selectLegacy(b.jam?.id ?? "missing");
    await mockProjectFolders.selectLegacy(a.id);
    finish("C:/wrong-project");
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Project changed — reopen",
  );
  expect(screen.getByPlaceholderText("No folder chosen")).toBeVisible();
  expect(screen.getByLabelText("Project name")).toHaveValue("Project A draft");
});
it("refuses UNC while preserving verbatim local Windows paths", async () => {
  expect(folderPolicy("\\\\?\\C:\\local").remote).toBe(false);
  expect(folderPolicy("\\\\?\\UNC\\server\\share").remote).toBe(true);
  await mount(dialog("unc", "create", "\\\\server\\share"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose a folder on this computer",
  );
  expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
});
it("requires explicit cloud acknowledgement before creating", async () => {
  const user = userEvent.setup();
  await mount(dialog("cloud", "create", "C:/OneDrive/Idea"));
  await user.type(screen.getByLabelText("Project name"), "Cloud idea");
  const create = screen.getByRole("button", { name: "Create project" });
  expect(create).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  expect(create).toBeEnabled();
  await user.click(create);
  await waitFor(() =>
    expect(mockProjectFolders.selected?.manifest.name).toBe("Cloud idea"),
  );
});
it("shows a non-empty destination refusal without losing the name", async () => {
  const user = userEvent.setup();
  await mount(dialog("nonempty", "create", "C:/nonempty"));
  await user.type(screen.getByLabelText("Project name"), "Keep me");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not empty");
  expect(screen.getByLabelText("Project name")).toHaveValue("Keep me");
});
it("offers registered board or a separate copy for a duplicate ID", async () => {
  const user = userEvent.setup();
  const original = await mockProjectFolders.create(
    "C:/anchor",
    "Original",
    false,
  );
  mockProjectFolders.folders.set("C:/clone", {
    ...original,
    folder: "C:/clone",
  });
  await mount(dialog("duplicate", "open", "C:/clone"));
  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(
    await screen.findByRole("radio", {
      name: /Open the board already registered at C:\/anchor/,
    }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("radio", { name: /Open as a separate copy/ }),
  );
  await user.click(screen.getByRole("button", { name: "Open separate copy" }));
  await waitFor(() =>
    expect(mockProjectFolders.selected?.projectId).not.toBe(original.projectId),
  );
});
it("marks unavailable recents and removes only their registry entry", async () => {
  const user = userEvent.setup();
  const info = await mockProjectFolders.create(
    "C:/offline",
    "Unavailable",
    false,
  );
  const entry = mockProjectFolders.entries[0];
  if (!entry) throw new Error("Missing recent fixture");
  entry.availability = "unavailable";
  await mockProjectFolders.create("C:/current", "Current", false);
  await mount(<ProjectsPage />);
  expect(await screen.findByText("Folder not found")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove from list" }));
  await waitFor(() =>
    expect(
      mockProjectFolders.entries.some(
        (entry) => entry.projectId === info.projectId,
      ),
    ).toBe(false),
  );
  expect(mockProjectFolders.folders.has(info.folder)).toBe(true);
  expect(
    await screen.findByText(
      "Removed from list. Your project files are unchanged.",
    ),
  ).toBeVisible();
});
it.each(["C:/invalid-manifest", "C:/newer-version"])(
  "reports invalid/newer manifest at %s",
  async (folder) => {
    const user = userEvent.setup();
    await mount(dialog(folder, "open", folder));
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /valid Jam Board project|newer version of Jam Board/,
    );
  },
);
it("shows an interrupted move receipt and resumes the same operation", async () => {
  const user = userEvent.setup();
  const app = await mockApi.appState();
  if (!app.jam) throw new Error("Missing project fixture");
  mockProjectFolders.interrupt = true;
  await mount(
    <MoveToFolder
      projectId={app.jam.id}
      name="Legacy"
      taskCount={5}
      onClose={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  await user.click(screen.getByRole("button", { name: "Move to folder" }));
  expect(
    await screen.findByText("Move interrupted while copying files"),
  ).toBeVisible();
  const id = [...mockProjectFolders.receipts.keys()][0];
  mockProjectFolders.interrupt = false;
  await user.click(screen.getByRole("button", { name: "Resume" }));
  expect(await screen.findByText("Move complete")).toBeVisible();
  expect([...mockProjectFolders.receipts.keys()]).toEqual([id]);
});
it("reads a retained operation and rolls back with an explicit receipt", async () => {
  const user = userEvent.setup();
  const projectId = (await mockApi.appState()).jam?.id ?? "missing";
  const input = {
    projectId,
    destination: "C:/rollback",
    requestId: "rollback-test",
    cloudAcknowledged: false,
  };
  mockProjectFolders.interrupt = true;
  await mockProjectFolders.move(input);
  localStorage.setItem(
    `jamboard:folder-move:${projectId}`,
    JSON.stringify(input),
  );
  await mount(
    <MoveToFolder projectId={projectId} name="Legacy" onClose={vi.fn()} />,
  );
  expect(
    await screen.findByText("Move interrupted while copying files"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Roll back" }));
  expect(
    await screen.findByText("Move rolled back. Your board is unchanged."),
  ).toBeVisible();
});

it("shows polled operation progress while the move response is still pending", async () => {
  const user = userEvent.setup();
  const projectId = (await mockApi.appState()).jam?.id;
  if (!projectId) throw new Error("Missing project fixture");
  mockProjectFolders.interrupt = true;
  const move = mockProjectFolders.move.bind(mockProjectFolders);
  let finish = () => {};
  vi.spyOn(mockProjectFolders, "move").mockImplementation(
    async (input, context) => {
      const receipt = await move(input, context);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return receipt;
    },
  );
  await mount(
    <MoveToFolder
      projectId={projectId}
      name="Pending progress"
      onClose={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  const start = screen.getByRole("button", { name: "Move to folder" });
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
  expect(await screen.findByText("Copying files…")).toBeVisible();
  expect(
    screen.queryByText("Interrupted. The source remains available."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^Close$/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Roll back" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Resume" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  await act(async () => {
    finish();
  });
  expect(
    await screen.findByText("Move interrupted while copying files"),
  ).toBeVisible();
});
it("refuses a move bound to agent/MCP ownership and explains disconnection", async () => {
  const user = userEvent.setup();
  mockProjectFolders.bound = true;
  const id = (await mockApi.appState()).jam?.id ?? "missing";
  await mount(<MoveToFolder projectId={id} name="Bound" onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Disconnect these before moving",
  );
  expect(screen.getByRole("button", { name: "Move to folder" })).toBeDisabled();
  expect(mockProjectFolders.receipts.size).toBe(0);
});
it("retains a folder rule draft after a stale CAS and offers reload", async () => {
  const user = userEvent.setup();
  const info = await mockProjectFolders.create("C:/rules", "Rules", false);
  await mount(
    <ProjectFolderSettings projectId={info.projectId} name="Rules" />,
  );
  const field = await screen.findByLabelText("Sprites folder");
  expect(
    screen.queryByRole("button", { name: "Reload folder rules" }),
  ).not.toBeInTheDocument();
  await user.clear(field);
  await user.type(field, "files/art");
  mockProjectFolders.selected = { ...info, manifestRevision: "2" };
  await user.click(screen.getByRole("button", { name: "Save folder rules" }));
  expect(
    await screen.findByText(/Folder rules changed elsewhere\./),
  ).toBeVisible();
  expect(field).toHaveValue("files/art");
  await user.click(screen.getByRole("button", { name: "Reload folder rules" }));
  await waitFor(() => expect(field).toHaveValue("files/images"));
});
it.each(["keep", "restore"])(
  "compares an external snapshot then chooses %s",
  async (action) => {
    const user = userEvent.setup();
    const info = await mockProjectFolders.create(
      `C:/recovery-${action}`,
      "Recovery",
      false,
    );
    mockProjectFolders.external = {
      liveHash: "live",
      externalHash: "external",
      liveRevision: 3,
      externalRevision: 2,
      externalValid: true,
      changedTables: ["tasks"],
      error: null,
    };
    await mount(<BoardRecovery folder={info.folder} info={info} />);
    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect(
      screen.getByRole("button", { name: "Restore from board.json" }),
    ).toBeDisabled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Compare",
      }),
    );
    expect(await screen.findByText("Changes: tasks")).toBeVisible();
    expect(screen.getByText(/A safety backup is kept/)).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name:
          action === "keep" ? "Keep current board" : "Restore from board.json",
      }),
    );
    expect(
      await screen.findByText("Board recovery decision saved."),
    ).toBeVisible();
    expect(mockProjectFolders.external).toBeNull();
  },
);
it("offers explicit recovery when local .state is missing", async () => {
  const user = userEvent.setup();
  const info = await mockProjectFolders.create(
    "C:/missing-state",
    "Recovery",
    false,
  );
  const recovered = vi.fn();
  await mount(
    <BoardRecovery folder={info.folder} missingState onRecovered={recovered} />,
  );
  await user.click(
    screen.getByRole("button", { name: "Restore from board.json" }),
  );
  await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
});
it("rejects a captured stale epoch rather than using the newly selected board", async () => {
  const user = userEvent.setup();
  const info = await mockProjectFolders.create("C:/epoch", "Epoch", false);
  await mount(<BoardRecovery folder={info.folder} info={info} />);
  mockProjectFolders.epoch++;
  await user.click(screen.getByRole("button", { name: "Compare" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Compare",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Project changed — reopen",
  );
});
it("passes exact generated arguments and captured context to the Tauri contract", async () => {
  const info = await mockProjectFolders.create(
    "C:/native-contract",
    "Contract",
    false,
  );
  const create = vi
    .spyOn(commands, "createProjectFolder")
    .mockResolvedValue({ status: "ok", data: info });
  const save = vi
    .spyOn(commands, "saveBoardSnapshot")
    .mockResolvedValue({ status: "ok", data: null });
  expect(
    await tauriProjectFolders.create(info.folder, "Contract", true),
  ).toEqual(info);
  await tauriProjectFolders.save(folderContext(info));
  expect(create).toHaveBeenCalledWith(info.folder, "Contract", true, null);
  expect(save).toHaveBeenCalledWith({
    instanceId: info.instanceId,
    selectionEpoch: info.selectionEpoch,
  });
});

it("uses expected-ID Locate without changing selection on mismatch, then relocates", async () => {
  const user = userEvent.setup();
  const original = await mockProjectFolders.create(
    "C:/missing-original",
    "Locate me",
    false,
  );
  const current = await mockProjectFolders.create(
    "C:/another",
    "Current",
    false,
  );
  const entry = mockProjectFolders.entries.find(
    (entry) => entry.instanceId === original.instanceId,
  );
  if (!entry) throw new Error("Missing Locate fixture");
  entry.availability = "unavailable";
  mockProjectFolders.folders.set("C:/found", {
    ...original,
    folder: "C:/found",
  });
  vi.spyOn(api, "pickFolder")
    .mockResolvedValueOnce(current.folder)
    .mockResolvedValueOnce("C:/found");
  const context = await mockProjectFolders.selection();
  await mount(<ProjectsPage />);
  await user.click(await screen.findByRole("button", { name: "Locate…" }));
  const form = within(
    screen.getByRole("dialog", { name: "Open project folder" }),
  );
  await user.click(form.getByRole("button", { name: "Choose folder…" }));
  await user.click(form.getByRole("button", { name: "Open" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This folder belongs to a different project. Choose the original folder.",
  );
  expect(await mockProjectFolders.selection()).toEqual(context);
  expect(entry.canonicalFolder).toBe(original.folder);
  await user.click(form.getByRole("button", { name: "Change…" }));
  await user.click(form.getByRole("button", { name: "Open" }));
  await waitFor(() =>
    expect(mockProjectFolders.selected?.folder).toBe("C:/found"),
  );
  expect(
    mockProjectFolders.entries.find(
      (entry) => entry.instanceId === original.instanceId,
    )?.canonicalFolder,
  ).toBe("C:/found");
});

it("refuses removing the selected instance and can reopen a removed recent", async () => {
  const first = await mockProjectFolders.create(
    "C:/retained",
    "Retained",
    false,
  );
  await expect(mockProjectFolders.remove(first.instanceId)).rejects.toThrow(
    "selected project",
  );
  await mockProjectFolders.create("C:/other", "Other", false);
  await mockProjectFolders.remove(first.instanceId);
  expect(mockProjectFolders.folders.has(first.folder)).toBe(true);
  await mockProjectFolders.open(first.folder, false);
  expect(
    mockProjectFolders.entries.some(
      (entry) => entry.instanceId === first.instanceId,
    ),
  ).toBe(true);
});

it("renders an inventory preview without creating a move receipt", async () => {
  const user = userEvent.setup();
  const preview = vi.spyOn(mockProjectFolders, "preview");
  const id = (await mockApi.appState()).jam?.id;
  if (!id) throw new Error("Missing preview project");
  mockProjectFolders.inventories.set(id, {
    tasks: { count: 7, bytes: 444 },
    managedCopies: { count: 3, bytes: 1200 },
    linkedFiles: { count: 2, bytes: 800 },
    missingFiles: ["C:/missing/model.blend"],
    missingFileCount: 1,
  });
  await mount(<MoveToFolder projectId={id} name="Preview" onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Choose destination…" }));
  expect(
    await screen.findByText(
      "7 tasks · 3 files copied (1.2 KB) · 2 files stay linked · 1 missing",
    ),
  ).toBeVisible();
  await user.click(screen.getByText("Details", { selector: "summary" }));
  expect(screen.getByText("C:/missing/model.blend")).toBeVisible();
  expect(mockProjectFolders.receipts.size).toBe(0);
  expect(preview).toHaveBeenCalledWith(id, "/mock/project/Preview");
  await user.clear(screen.getByLabelText("New folder name"));
  await user.type(screen.getByLabelText("New folder name"), "New board");
  await waitFor(() =>
    expect(preview).toHaveBeenCalledWith(id, "/mock/project/New board"),
  );
});

it.each([
  ["C:/existing-empty", false, false, false],
  ["C:/nonempty", false, true, false],
  ["\\\\server\\share", false, false, false],
  ["C:/OneDrive/board", true, false, true],
] as const)(
  "previews destination policy for %s without side effects",
  async (destination, allowed, nonEmpty, cloud) => {
    const id = (await mockApi.appState()).jam?.id ?? "missing";
    const selection = await mockProjectFolders.selection();
    const preview = await mockProjectFolders.preview(id, destination);
    expect(preview.destinationPolicy).toMatchObject({
      allowed,
      nonEmpty,
      cloudAcknowledgementNeeded: cloud,
    });
    expect(mockProjectFolders.receipts.size).toBe(0);
    expect(await mockProjectFolders.selection()).toEqual(selection);
  },
);

it("reads persisted snapshot time, updates it on save and retains it after reopen", async () => {
  const user = userEvent.setup();
  const info = await mockProjectFolders.create(
    "C:/snapshot-time",
    "Snapshot",
    false,
  );
  info.lastSnapshotAt = "2026-01-01T10:00:00Z";
  await mount(
    <ProjectFolderSettings projectId={info.projectId} name="Snapshot" />,
  );
  expect(
    await screen.findByText(`Last saved: ${relativeTime(info.lastSnapshotAt)}`),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save now" }));
  await waitFor(() =>
    expect(mockProjectFolders.selected?.lastSnapshotAt).not.toBe(
      info.lastSnapshotAt,
    ),
  );
  const saved = mockProjectFolders.selected?.lastSnapshotAt;
  expect(
    (await mockProjectFolders.open(info.folder, false)).lastSnapshotAt,
  ).toBe(saved);
});

it.each(["rules", "move", "settings"] as const)(
  "rejects a stale captured context for %s before changing data",
  async (action) => {
    const info = await mockProjectFolders.create(
      "C:/stale-write",
      "Stale",
      false,
    );
    const context = folderContext(info);
    await mockProjectFolders.open(info.folder, false);
    const operation =
      action === "rules"
        ? mockProjectFolders.rules(
            context,
            { sprite: "files/new" },
            info.manifestRevision,
          )
        : action === "move"
          ? mockProjectFolders.move(
              {
                projectId: info.projectId,
                requestId: "stale-request",
                destination: "C:/new-destination",
                cloudAcknowledged: false,
              },
              context,
            )
          : mockProjectFolders.writeSettings(
              info.projectId,
              {
                expectedProjectId: info.projectId,
                workingDirectory: "C:/wrong",
              },
              context,
            );
    await expect(operation).rejects.toThrow("Stale selection epoch");
    expect(mockProjectFolders.receipts.size).toBe(0);
    expect(mockProjectFolders.localSettings[info.projectId]).toBeUndefined();
    expect(mockProjectFolders.selected?.manifest.folderRules.sprite).toBe(
      "files/images",
    );
  },
);

it.each(["game_jam", "gamedev", "webapp", "custom"])(
  "applies full %s onboarding initialization before returning folder info",
  async (template) => {
    const initialization = {
      name: `Initialized ${template}`,
      template,
      yourName: "Alex",
      theme: "Tiny lights",
      timezone: "Asia/Vladivostok",
      startsAt: "2026-11-01T00:00:00Z",
      endsAt: "2026-11-03T00:00:00Z",
      milestoneAt: "2026-12-01T00:00:00Z",
    };
    const info = await mockProjectFolders.create(
      `C:/${template}`,
      initialization.name,
      false,
      initialization,
    );
    const app = await mockApi.appState();
    expect(app.jam).toMatchObject({
      id: info.projectId,
      template,
      theme: initialization.theme,
      timezone: initialization.timezone,
    });
    expect(app.currentMember?.name).toBe("Alex");
    expect(info.context).toEqual(await mockProjectFolders.selection());
  },
);

it("forwards the onboarding form to folder create, including a renamed dialog draft", async () => {
  const user = userEvent.setup();
  const create = vi.spyOn(mockProjectFolders, "create");
  await mount(<Welcome />);
  await user.click(screen.getByRole("button", { name: "Web app" }));
  await user.type(screen.getByLabelText("Project name"), "Product");
  await user.type(screen.getByLabelText(/Theme/), "Small lights");
  await user.clear(screen.getByLabelText("Your name"));
  await user.type(screen.getByLabelText("Your name"), "Alex");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  const form = screen.getByRole("dialog", { name: "Create project folder" });
  const field = within(form).getByLabelText("Project name");
  await user.clear(field);
  await user.type(field, "Renamed product");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  await user.click(
    within(form).getByRole("button", { name: "Create project" }),
  );
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      "/mock/project",
      "Renamed product",
      false,
      expect.objectContaining({
        name: "Renamed product",
        template: "webapp",
        theme: "Small lights",
        yourName: "Alex",
        startsAt: "",
        endsAt: "",
      }),
    ),
  );
});

it("ignores query refreshes when the native selection context is unchanged", async () => {
  const user = userEvent.setup();
  let finish: (path: string) => void = () => {};
  vi.spyOn(api, "pickFolder").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { client } = await mount(dialog("refresh-safe"));
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  await act(async () => {
    client.setQueryData(["app"], await mockApi.appState());
    finish("C:/unchanged-context");
  });
  expect(await screen.findByLabelText("Project folder")).toHaveValue(
    "C:/unchanged-context",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("forwards C2 expected contexts, recent IDs, preview and initialization through generated commands", async () => {
  const info = await mockProjectFolders.create("C:/c2-contract", "C2", false);
  const context = folderContext(info);
  const initialization = {
    name: "C2",
    yourName: "Alex",
    template: "custom",
    theme: null,
    startsAt: "",
    endsAt: "",
    timezone: "UTC",
  };
  const preview = await mockProjectFolders.preview(
    info.projectId,
    "C:/destination",
  );
  const settings = await mockProjectFolders.readSettings();
  const input = {
    projectId: info.projectId,
    requestId: "c2-request",
    destination: "C:/destination",
    cloudAcknowledged: false,
  };
  mockProjectFolders.interrupt = true;
  const receipt = await mockProjectFolders.move(input, context);
  const create = vi
    .spyOn(commands, "createProjectFolder")
    .mockResolvedValue({ status: "ok", data: info });
  const locate = vi
    .spyOn(commands, "locateProjectFolder")
    .mockResolvedValue({ status: "ok", data: info });
  const remove = vi
    .spyOn(commands, "removeRecentProjectFolder")
    .mockResolvedValue({ status: "ok", data: null });
  const preflight = vi
    .spyOn(commands, "previewProjectMove")
    .mockResolvedValue({ status: "ok", data: preview });
  const move = vi
    .spyOn(commands, "moveProjectToFolder")
    .mockResolvedValue({ status: "ok", data: receipt });
  const rules = vi
    .spyOn(commands, "setProjectFolderRules")
    .mockResolvedValue({ status: "ok", data: info });
  const set = vi
    .spyOn(commands, "setSettings")
    .mockResolvedValue({ status: "ok", data: settings });
  vi.mocked(tauriProjectFolders.writeSettings).mockRestore();
  vi.spyOn(api, "setSettings").mockImplementation(tauriApi.setSettings);
  await tauriProjectFolders.create(info.folder, "C2", false, initialization);
  await tauriProjectFolders.locate(
    info.instanceId,
    info.projectId,
    info.folder,
    false,
  );
  await tauriProjectFolders.remove(info.instanceId);
  await tauriProjectFolders.preview(info.projectId, input.destination);
  await tauriProjectFolders.move(input, context);
  await tauriProjectFolders.rules(
    context,
    info.manifest.folderRules,
    info.manifestRevision,
  );
  await tauriProjectFolders.writeSettings(
    info.projectId,
    { workingDirectory: "C:/Unity" },
    context,
  );
  expect(create).toHaveBeenCalledWith(info.folder, "C2", false, initialization);
  expect(locate).toHaveBeenCalledWith(
    info.instanceId,
    info.projectId,
    info.folder,
    false,
  );
  expect(remove).toHaveBeenCalledWith(info.instanceId);
  expect(preflight).toHaveBeenCalledWith(info.projectId, input.destination);
  expect(move).toHaveBeenCalledWith(input, context);
  expect(rules).toHaveBeenCalledWith(
    context,
    info.manifest.folderRules,
    info.manifestRevision,
  );
  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedProjectId: info.projectId,
      workingDirectory: "C:/Unity",
    }),
    context,
  );
});
