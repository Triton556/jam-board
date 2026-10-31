import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskFileInput } from "../../bindings";
import { commands } from "../../bindings";
import { mockApi } from "../../lib/mock-bridge";
import { mockTaskFiles } from "../../lib/mock-task-files";
import {
  registration,
  taskFilesApi,
  tauriTaskFiles,
} from "../../lib/task-files-api";
import { AssetLinkDialog } from "../assets/AssetLinkDialog";
import { AssetsPage } from "../assets/AssetsPage";
import { TaskFiles } from "./TaskFiles";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
  useNavigate: () => vi.fn(),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockTaskFiles.reset();
  mockTaskFiles.copyDelay = 0;
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const app = await mockApi.appState();
  const task = await mockApi.getTask("JB-7");
  const context = await taskFilesApi.capture(task.jamId);
  return { app, task, context };
}
async function file(
  storage: "board_file" | "linked_file" | "url",
  path: string,
) {
  const { context } = await fixture();
  const result = await taskFilesApi.register(
    context,
    registration(storage, path, crypto.randomUUID()),
  );
  if (!result.asset) throw new Error("Fixture registration returned no file");
  return result.asset;
}
async function link(
  assetId: string,
  role = "reference",
  taskKey = "JB-7",
  position = 0,
) {
  const { context } = await fixture();
  const version = await taskFilesApi.version(context, taskKey);
  const input: TaskFileInput = {
    taskKey,
    assetId,
    role,
    position,
    expectedClaimGeneration: version.claimGeneration,
    expectedUpdatedAt: version.updatedAt,
    requestId: crypto.randomUUID(),
  };
  return { result: await taskFilesApi.link(context, input), input, context };
}
async function mount(disabled = false) {
  const { app, task } = await fixture();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], app);
  const onChanged = vi.fn();
  const props = {
    task,
    writeContext: { projectId: task.jamId, taskId: task.id, taskKey: task.key },
    disabled,
    onChanged,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <TaskFiles {...props} />
    </QueryClientProvider>,
  );
  if (!disabled)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add file" })).toBeEnabled(),
    );
  return { ...view, client, props, app, user: userEvent.setup() };
}
async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}
it("FI-T01: one file has independent roles and positions on two tasks", async () => {
  const asset = await file("linked_file", "C:/mock/repo/Assets/Ship.blend");
  const first = await link(asset.id, "to_edit", "JB-7", 5);
  await link(asset.id, "reference", "JB-1", 2);
  expect(
    (await taskFilesApi.taskFiles(first.context, "JB-7")).find(
      (r) => r.asset.id === asset.id,
    ),
  ).toMatchObject({ role: "to_edit", position: 5 });
  expect(
    (await taskFilesApi.taskFiles(first.context, "JB-1")).find(
      (r) => r.asset.id === asset.id,
    ),
  ).toMatchObject({ role: "reference", position: 2 });
});
it("FI-T02: copy, repo-relative link, outside absolute link and URL preserve ownership", async () => {
  const copy = await file("board_file", "C:/source/Игрок.png");
  const linked = await file("linked_file", "C:/mock/repo/Assets/Ship.glb");
  const outside = await file("linked_file", "D:/Art/Ship.obj");
  const url = await file("url", "https://example.com/design");
  expect(copy).toMatchObject({
    storageType: "board_file",
    storedPath: "files/images/Игрок.png",
  });
  expect(linked).toMatchObject({
    pathBase: "repo",
    storedPath: "Assets/Ship.glb",
    kind: "model",
  });
  expect(outside).toMatchObject({
    pathBase: "absolute",
    storedPath: "D:/Art/Ship.obj",
  });
  expect(url).toMatchObject({ storageType: "url" });
});
it("FI-T03: cancel an in-flight copy leaves no registered file or mock bytes", async () => {
  mockTaskFiles.copyDelay = 50;
  const { context } = await fixture(),
    request = registration("board_file", "C:/source/cancel.png", "cancel-test");
  vi.useFakeTimers();
  try {
    const pending = taskFilesApi.register(context, request);
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (await taskFilesApi.status(context, request.requestId)).canCancel,
    ).toBe(true);
    await taskFilesApi.cancel(context, request.requestId);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(mockTaskFiles.bytes.size).toBe(0);
    expect(
      (await taskFilesApi.list(context)).some((a) => a.name === "cancel.png"),
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it("FI-T04: identical register and link retries return the original receipt; changed payload conflicts", async () => {
  const { context } = await fixture(),
    request = registration("board_file", "C:/source/retry.png", "retry-test");
  const first = await taskFilesApi.register(context, request);
  expect(await taskFilesApi.register(context, request)).toEqual(first);
  expect(mockTaskFiles.bytes.size).toBe(1);
  const linked = await link(first.asset?.id ?? "");
  expect(await taskFilesApi.link(context, linked.input)).toEqual(linked.result);
  await expect(
    taskFilesApi.link(context, { ...linked.input, role: "result" }),
  ).rejects.toThrow(/conflict/i);
});
it.each(["expectedUpdatedAt", "expectedClaimGeneration"] as const)(
  "FI-T05: stale %s rejects a mutation",
  async (validator) => {
    const asset = await file("linked_file", "C:/mock/repo/Assets/stale.fbx");
    const { context, input } = await link(asset.id);
    await expect(
      taskFilesApi.setRole(context, {
        ...input,
        [validator]: "stale",
        requestId: crypto.randomUUID(),
        role: "result",
      }),
    ).rejects.toThrow("Task changed — reload");
  },
);
it("FI-T06: unlink removes only the association and retains mock bytes", async () => {
  const asset = await file("board_file", "C:/source/retained.png");
  const { context } = await link(asset.id);
  const version = await taskFilesApi.version(context, "JB-7");
  await taskFilesApi.unlink(context, {
    taskKey: "JB-7",
    assetId: asset.id,
    role: null,
    position: null,
    requestId: "unlink",
    expectedUpdatedAt: version.updatedAt,
    expectedClaimGeneration: version.claimGeneration,
  });
  expect(mockTaskFiles.bytes.has(asset.storedPath)).toBe(true);
  expect(
    (await taskFilesApi.list(context)).some((a) => a.id === asset.id),
  ).toBe(true);
  expect(
    (await taskFilesApi.taskFiles(context, "JB-7")).some(
      (r) => r.asset.id === asset.id,
    ),
  ).toBe(false);
});
it("FI-T07: missing and unreadable statuses remain distinct; long Cyrillic paths have full tooltips", async () => {
  const name = `${"Длинное имя модели ".repeat(15)}missing.glb`;
  const missing = await file("linked_file", `D:/Иллюстрации/${name}`);
  const unreadable = await file("linked_file", "D:/unreadable.pdf");
  await link(missing.id, "to_edit");
  await link(unreadable.id, "result");
  await mount();
  expect(screen.getByText("Missing — file not found at path")).toBeVisible();
  expect(
    screen.getByText("Unreadable — file cannot be read at path"),
  ).toBeVisible();
  expect(screen.getAllByTitle(missing.storedPath).length).toBeGreaterThan(0);
  expect(screen.getByRole("article", { name })).toBeVisible();
});
it("FI-T08: add copied image, linked model, URL and a registered file through the UI", async () => {
  const pick = vi
    .spyOn(mockApi, "pickFiles")
    .mockResolvedValue(["C:/source/new.png"]);
  const view = await mount();
  for (const [menu, path] of [
    ["Copy into board…", "C:/source/new.png"],
    ["Link existing file…", "C:/mock/repo/Assets/Ship.glb"],
  ]) {
    pick.mockResolvedValue([path ?? ""]);
    await view.user.click(screen.getByRole("button", { name: "Add file" }));
    await view.user.click(screen.getByRole("button", { name: menu }));
    await view.user.click(
      screen.getByRole("button", { name: "Choose files…" }),
    );
    await screen.findByText(path ?? "");
    await view.user.click(screen.getByRole("button", { name: "Add files" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  }
  await view.user.click(screen.getByRole("button", { name: "Add file" }));
  await view.user.click(screen.getByRole("button", { name: "Add URL…" }));
  await view.user.type(
    screen.getByRole("textbox", { name: "File URL" }),
    "https://example.com/brief",
  );
  await choose("File role", "Result");
  await view.user.click(screen.getByRole("button", { name: "Add files" }));
  await screen.findByRole("heading", { name: "Results" });
  const available = await file("linked_file", "D:/library/Available.pdf");
  await view.user.click(screen.getByRole("button", { name: "Add file" }));
  await view.user.click(
    screen.getByRole("button", { name: "Pick from board files" }),
  );
  await choose("Board file", `${available.name} · Linked`);
  await view.user.click(screen.getByRole("button", { name: "Add files" }));
  await screen.findByRole("article", { name: "Available.pdf" });
  expect(view.props.onChanged).toHaveBeenCalledTimes(4);
});
it("FI-T09: stale row action keeps role choice through explicit reload", async () => {
  const asset = await file("linked_file", "D:/stale.glb");
  await link(asset.id);
  const view = await mount();
  await choose(`Role for ${asset.name}`, "Result");
  vi.spyOn(mockTaskFiles, "setRole").mockRejectedValueOnce(
    Object.assign(new Error("CONFLICT"), { code: "CONFLICT" }),
  );
  await view.user.click(screen.getByRole("button", { name: "Apply role" }));
  await screen.findByText("Task changed — reload");
  expect(
    screen.getByRole("combobox", { name: `Role for ${asset.name}` }),
  ).toHaveTextContent("Result");
  await view.user.click(screen.getByRole("button", { name: "Reload Files" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Apply role" })).toBeEnabled(),
  );
  expect(
    screen.getByRole("combobox", { name: `Role for ${asset.name}` }),
  ).toHaveTextContent("Result");
});
it("FI-T10: uncertain successful link retries the same ID without a duplicate copy", async () => {
  const original = mockTaskFiles.link.bind(mockTaskFiles);
  vi.spyOn(mockTaskFiles, "link").mockImplementationOnce(
    async (context, input) => {
      await original(context, input);
      throw new Error("Lost acknowledgement");
    },
  );
  vi.spyOn(mockApi, "pickFiles").mockResolvedValue(["C:/source/uncertain.png"]);
  const view = await mount();
  await view.user.click(screen.getByRole("button", { name: "Add file" }));
  await view.user.click(
    screen.getByRole("button", { name: "Copy into board…" }),
  );
  await view.user.click(screen.getByRole("button", { name: "Choose files…" }));
  await screen.findByText("C:/source/uncertain.png");
  await view.user.click(screen.getByRole("button", { name: "Add files" }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Lost acknowledgement");
  await view.user.click(
    within(dialog).getByRole("button", { name: "Retry same request" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const calls = mockTaskFiles.calls.filter(
    (c) => c.command === "link_task_file",
  );
  expect(calls[0]?.input).toEqual(calls[1]?.input);
  expect(mockTaskFiles.bytes.size).toBe(1);
});
it("FI-T11: disabled state prevents adding, changing role and unlinking", async () => {
  const asset = await file("linked_file", "D:/readonly.pdf");
  await link(asset.id);
  await mount(true);
  const row = await screen.findByRole("article", { name: asset.name });
  expect(screen.getByRole("button", { name: "Add file" })).toBeDisabled();
  expect(within(row).getByRole("combobox")).toBeDisabled();
  await userEvent.click(
    within(row).getByRole("button", { name: `More actions for ${asset.name}` }),
  );
  expect(screen.getByRole("menuitem", { name: "Unlink…" })).toBeDisabled();
});
it("FI-T12: mixed drop asks once; a late A→B→A delivery is discarded", async () => {
  let receive:
    | ((paths: string[], point?: { x: number; y: number }) => void)
    | undefined;
  vi.spyOn(mockApi, "onFileDrop").mockImplementation((cb) => {
    receive = cb;
    return () => {};
  });
  const view = await mount();
  const section = screen.getByRole("region", { name: "Task files" });
  vi.spyOn(section, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    toJSON: () => ({}),
  });
  act(() =>
    receive?.(["C:/mock/repo/a.png", "C:/mock/repo/b.glb"], { x: 50, y: 50 }),
  );
  expect(
    screen.getByRole("dialog", { name: "Add dropped files" }),
  ).toBeVisible();
  await view.user.click(
    screen.getByRole("button", { name: "Link batch in place" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const writes = mockTaskFiles.calls.length;
  act(() => {
    view.client.setQueryData(["app"], {
      ...view.app,
      jam: { ...view.app.jam, id: "B" },
    });
    view.client.setQueryData(["app"], view.app);
    receive?.(["C:/late.png"], { x: 50, y: 50 });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockTaskFiles.calls.length).toBe(writes);
});
it("FI-T13: late picker after a task A→B→A switch cannot attach", async () => {
  let deliver!: (paths: string[]) => void;
  vi.spyOn(mockApi, "pickFiles").mockImplementation(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const view = await mount();
  await view.user.click(screen.getByRole("button", { name: "Add file" }));
  await view.user.click(
    screen.getByRole("button", { name: "Link existing file…" }),
  );
  await view.user.click(screen.getByRole("button", { name: "Choose files…" }));
  view.rerender(
    <QueryClientProvider client={view.client}>
      <TaskFiles
        {...view.props}
        writeContext={{ ...view.props.writeContext, taskId: "other" }}
      />
    </QueryClientProvider>,
  );
  view.rerender(
    <QueryClientProvider client={view.client}>
      <TaskFiles {...view.props} />
    </QueryClientProvider>,
  );
  await act(async () => deliver(["C:/late.glb"]));
  expect(screen.queryByText("C:/late.glb")).not.toBeInTheDocument();
  expect(mockTaskFiles.calls.length).toBe(0);
});
it("FI-T14: Assets filters include model/document/storage and expose per-task roles", async () => {
  const asset = await file("board_file", "C:/source/Ship.glb");
  await link(asset.id, "to_edit");
  const { app } = await fixture();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  render(
    <QueryClientProvider client={client}>
      <AssetsPage openTask={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText("File usage and roles");
  await userEvent.click(screen.getByText("File usage and roles"));
  expect(screen.getByRole("button", { name: "JB-7 · To edit" })).toBeVisible();
  await choose("Storage", "Board file");
  fireEvent.click(screen.getByRole("button", { name: /^model /i }));
  expect(screen.getByRole("heading", { name: asset.name })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^document /i }));
  await screen.findByText("No assets match these filters");
});
it("FI-T15: AssetLinkDialog makes copy vs link an explicit choice", async () => {
  const { app } = await fixture(),
    client = new QueryClient();
  client.setQueryData(["app"], app);
  render(
    <QueryClientProvider client={client}>
      <AssetLinkDialog taskKey="JB-7" close={vi.fn()} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "File source" })).toBeEnabled(),
  );
  await choose("File source", "Copy into board");
  expect(screen.getByText(/Copy bytes into files/)).toBeVisible();
  await choose("File source", "Link in place");
  expect(
    screen.getByText(/outside files use absolute local paths/),
  ).toBeVisible();
});
it("FI-T16: reorder normalizes tied positions and keeps role groups independent", async () => {
  const a = await file("linked_file", "D:/First.glb"),
    b = await file("linked_file", "D:/Second.glb");
  await link(a.id, "to_edit", "JB-7", 0);
  await link(b.id, "to_edit", "JB-7", 0);
  const view = await mount();
  await view.user.click(
    screen.getByRole("button", { name: "More actions for Second.glb" }),
  );
  await view.user.click(screen.getByRole("menuitem", { name: "Move up" }));
  await waitFor(async () => {
    const { context } = await fixture();
    const rows = (await taskFilesApi.taskFiles(context, "JB-7"))
      .filter((row) => row.role === "to_edit")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    expect(rows.map((row) => row.asset.id)).toEqual([b.id, a.id]);
  });
});
it("FI-T17: copy progress exposes Cancel and cancellation keeps the user's selection", async () => {
  mockTaskFiles.copyDelay = 600;
  vi.spyOn(mockApi, "pickFiles").mockResolvedValue(["C:/source/Cancelled.png"]);
  const view = await mount();
  await view.user.click(screen.getByRole("button", { name: "Add file" }));
  await view.user.click(
    screen.getByRole("button", { name: "Copy into board…" }),
  );
  await view.user.click(screen.getByRole("button", { name: "Choose files…" }));
  await screen.findByText("C:/source/Cancelled.png");
  await view.user.click(screen.getByRole("button", { name: "Add files" }));
  const cancel = await screen.findByRole("button", { name: "Cancel copy" });
  await waitFor(() => expect(cancel).toBeEnabled());
  await view.user.click(cancel);
  const dialog = screen.getByRole("dialog", { name: "Copy into board" });
  await within(dialog).findByText("Copy cancelled");
  expect(within(dialog).getByText("C:/source/Cancelled.png")).toBeVisible();
  expect(mockTaskFiles.bytes.size).toBe(0);
});
it.each([false, true])(
  "C2-T01: native reveal=%s sends the captured asset identity to the backend without a frontend resolve",
  async (reveal) => {
    const { context } = await fixture();
    const open = vi
      .spyOn(commands, "openFileAsset")
      .mockResolvedValue({ status: "ok", data: null });
    const show = vi
      .spyOn(commands, "revealFileAsset")
      .mockResolvedValue({ status: "ok", data: null });
    const resolve = vi.spyOn(commands, "resolveFile");
    await tauriTaskFiles.open(context, "asset-identity", reveal);
    expect(reveal ? show : open).toHaveBeenCalledExactlyOnceWith(
      context,
      "asset-identity",
    );
    expect(reveal ? open : show).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "C2-T02: native reveal=%s preserves typed assetId failures and never retries the launch",
  async (reveal) => {
    const { context } = await fixture();
    const method = vi
      .spyOn(commands, reveal ? "revealFileAsset" : "openFileAsset")
      .mockResolvedValue({
        status: "error",
        error: {
          code: "validation",
          field: "assetId",
          message: "File is missing or unreadable",
        },
      });
    await expect(
      tauriTaskFiles.open(context, "unavailable", reveal),
    ).rejects.toMatchObject({
      code: "validation",
      field: "assetId",
      message: "File is missing or unreadable",
    });
    expect(method).toHaveBeenCalledTimes(1);
  },
);
it("C2-T03: mock file and URL Open/Reveal record asset intent without OS or browser launch", async () => {
  const asset = await file("linked_file", "D:/Intent.glb"),
    url = await file("url", "https://example.com/intent");
  const { context } = await fixture();
  const openUrl = vi.spyOn(mockApi, "openUrl"),
    revealPath = vi.spyOn(mockApi, "showInFolder");
  for (const target of [asset, url])
    for (const reveal of [false, true])
      await taskFilesApi.open(context, target.id, reveal);
  const intents = mockTaskFiles.calls.filter((call) =>
    ["open_file_asset", "reveal_file_asset"].includes(call.command),
  );
  expect(intents.map((call) => call.command)).toEqual([
    "open_file_asset",
    "reveal_file_asset",
    "open_file_asset",
    "reveal_file_asset",
  ]);
  expect(intents.map((call) => call.input)).toEqual(
    [asset.id, asset.id, url.id, url.id].map((assetId) => ({
      context: {
        instanceId: context.instanceId,
        selectionEpoch: context.selectionEpoch,
      },
      assetId,
    })),
  );
  expect(openUrl).not.toHaveBeenCalled();
  expect(revealPath).not.toHaveBeenCalled();
});
it.each([
  ["missing", "Missing", "Open"],
  ["unreadable", "Unreadable", "Open"],
  ["missing", "Missing", "Reveal"],
  ["unreadable", "Unreadable", "Reveal"],
] as const)(
  "C2-T04: %s after cached OK updates the row on %s (%s), with no accepted launch",
  async (status, label, action) => {
    const asset = await file("linked_file", "D:/Availability.glb");
    await link(asset.id);
    const { context } = await fixture();
    const previous = await taskFilesApi.resolve(context, asset.id);
    const view = await mount();
    const row = screen.getByRole("article", { name: asset.name });
    expect(within(row).queryByText(/^OK/)).not.toBeInTheDocument();
    const resolve = vi
      .spyOn(mockTaskFiles, "resolve")
      .mockResolvedValue({ ...previous, status });
    if (action === "Reveal") {
      await view.user.click(
        within(row).getByRole("button", {
          name: `More actions for ${asset.name}`,
        }),
      );
      await view.user.click(
        screen.getByRole("menuitem", { name: "Reveal in folder" }),
      );
    } else
      await view.user.click(within(row).getByRole("button", { name: action }));
    await within(row).findByText(new RegExp(`^${label} —`));
    expect(screen.getByRole("alert")).toHaveTextContent(`File is ${status}`);
    expect(resolve).toHaveBeenCalledTimes(2); // Mock launch preflight, then UI status refresh.
    expect(
      mockTaskFiles.calls.some((call) =>
        ["open_file_asset", "reveal_file_asset"].includes(call.command),
      ),
    ).toBe(false);
  },
);
it("C2-T05: unrelated launch errors retain their message and do not invent an unavailable state", async () => {
  const asset = await file("linked_file", "D:/Forbidden.glb");
  await link(asset.id);
  const view = await mount();
  const resolve = vi.spyOn(mockTaskFiles, "resolve");
  vi.spyOn(mockTaskFiles, "open").mockRejectedValue(
    Object.assign(new Error("Opener refused"), {
      code: "forbidden",
      field: "assetId",
    }),
  );
  const row = screen.getByRole("article", { name: asset.name });
  await view.user.click(within(row).getByRole("button", { name: "Open" }));
  await screen.findByText("Opener refused");
  expect(within(row).queryByText(/^OK/)).not.toBeInTheDocument();
  expect(resolve).not.toHaveBeenCalled();
});
it("P-T01: healthy rows hide OK and expose singular role chips", async () => {
  const asset = await file("linked_file", "C:/mock/repo/Healthy.glb");
  await link(asset.id);
  await mount();
  const row = screen.getByRole("article", { name: asset.name });
  expect(within(row).queryByText(/^OK/)).not.toBeInTheDocument();
  expect(row.querySelector(".file-availability")).toBeNull();
  expect(within(row).getByRole("combobox")).toHaveTextContent("Reference");
  expect(screen.getByRole("heading", { name: "References" })).toBeVisible();
});
it.each(["missing", "unreadable"])(
  "P-T02: %s rows warn, disable Open/Reveal with explanations, and accept no launch",
  async (status) => {
    const asset = await file("linked_file", `D:/${status}.glb`);
    await link(asset.id);
    const view = await mount();
    const row = screen.getByRole("article", { name: asset.name });
    const open = within(row).getByRole("button", { name: "Open" });
    expect(open).toBeDisabled();
    expect(
      row.querySelector(`.file-availability[data-status="${status}"] svg`),
    ).not.toBeNull();
    await view.user.hover(open.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Open unavailable/,
    );
    await view.user.click(
      within(row).getByRole("button", {
        name: `More actions for ${asset.name}`,
      }),
    );
    const reveal = screen.getByRole("menuitem", { name: "Reveal in folder" });
    expect(reveal).toBeDisabled();
    await view.user.hover(reveal.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Reveal unavailable/,
    );
    expect(
      mockTaskFiles.calls.some((call) =>
        ["open_file_asset", "reveal_file_asset"].includes(call.command),
      ),
    ).toBe(false);
  },
);
it("P-T03: URL has one label, host Open tooltip and no Reveal menu item", async () => {
  const asset = await file("url", "https://example.com/brief");
  await link(asset.id);
  const view = await mount();
  const row = screen.getByRole("article", { name: asset.name });
  expect(within(row).getAllByText("URL")).toHaveLength(1);
  const open = within(row).getByRole("button", { name: "Open" });
  await view.user.hover(open.parentElement as HTMLElement);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Open example.com",
  );
  await view.user.click(
    within(row).getByRole("button", { name: `More actions for ${asset.name}` }),
  );
  expect(
    screen.queryByRole("menuitem", { name: "Reveal in folder" }),
  ).not.toBeInTheDocument();
  await view.user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(
    within(row).getByRole("button", { name: `More actions for ${asset.name}` }),
  ).toHaveFocus();
});
it("P-T04: overflow supports keyboard reorder, Reveal and confirmed Unlink", async () => {
  const a = await file("linked_file", "C:/mock/repo/First.glb"),
    b = await file("linked_file", "C:/mock/repo/Second.glb");
  await link(a.id, "to_edit", "JB-7", 0);
  await link(b.id, "to_edit", "JB-7", 1);
  const view = await mount();
  const first = screen.getByRole("article", { name: a.name });
  const more = within(first).getByRole("button", {
    name: `More actions for ${a.name}`,
  });
  more.focus();
  await view.user.keyboard("{Enter}");
  expect(
    screen.getByRole("menuitem", { name: "Reveal in folder" }),
  ).toHaveFocus();
  await view.user.keyboard("{ArrowDown}{Enter}"); // skips disabled Move up, invokes Move down
  await waitFor(async () => {
    const { context } = await fixture();
    const rows = (await taskFilesApi.taskFiles(context, "JB-7"))
      .filter((row) => row.role === "to_edit")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    expect(rows.map((row) => row.asset.id)).toEqual([b.id, a.id]);
  });
  await waitFor(() => expect(more).toBeEnabled());
  more.focus();
  await view.user.keyboard("{Enter}{ArrowDown}{Enter}"); // Move up is now enabled
  await waitFor(async () => {
    const { context } = await fixture();
    const rows = (await taskFilesApi.taskFiles(context, "JB-7"))
      .filter((row) => row.role === "to_edit")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    expect(rows[0]?.asset.id).toBe(a.id);
  });
  await waitFor(() => expect(more).toBeEnabled());
  await view.user.click(more);
  await view.user.click(
    screen.getByRole("menuitem", { name: "Reveal in folder" }),
  );
  await waitFor(() =>
    expect(
      mockTaskFiles.calls.some((call) => call.command === "reveal_file_asset"),
    ).toBe(true),
  );
  await view.user.click(more);
  await view.user.click(screen.getByRole("menuitem", { name: "Unlink…" }));
  const confirm = screen.getByRole("dialog", { name: "Unlink file?" });
  expect(within(confirm).getByText(/never deletes file bytes/)).toBeVisible();
  await view.user.click(
    within(confirm).getByRole("button", { name: "Unlink file" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: a.name }),
    ).not.toBeInTheDocument(),
  );
});
it("P-T05: Assets filters storage and task role, and marks a missing linked card", async () => {
  const missing = await file("linked_file", "D:/missing-Ship.glb"),
    reference = await file("board_file", "C:/source/Reference.glb");
  await link(missing.id, "to_edit");
  await link(reference.id, "reference");
  const { app } = await fixture(),
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["app"], app);
  render(
    <QueryClientProvider client={client}>
      <AssetsPage openTask={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText("Missing — file not found at path");
  await userEvent.click(screen.getByRole("button", { name: /^model / }));
  await choose("Storage", "Linked");
  await choose("Used by tasks", "To edit");
  expect(screen.getByRole("heading", { name: missing.name })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: reference.name }),
  ).not.toBeInTheDocument();
  await choose("Used by tasks", "Reference");
  await screen.findByText("No assets match these filters");
  await choose("Storage", "Any");
  expect(screen.getByRole("heading", { name: reference.name })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: missing.name }),
  ).not.toBeInTheDocument();
});
