import "../../components/MarkdownContent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssetUsage } from "../../bindings";
import { commands } from "../../bindings";
import { api } from "../../lib/api";
import {
  emptyUsage,
  fileViewerApi,
  nativeFileViewerApi,
  type Preview,
  scopeInput,
} from "../../lib/file-viewer-api";
import { mockApi } from "../../lib/mock-bridge";
import { mockFilesV2 } from "../../lib/mock-files-v2";
import { mockTaskFiles } from "../../lib/mock-task-files";
import { registration, taskFilesApi } from "../../lib/task-files-api";
import { AssetHistory } from "./AssetHistory";
import { AssetUsageList } from "./AssetUsageList";
import { DeleteAssetDialog } from "./DeleteAssetDialog";
import { FilePreviewBody, FileViewer } from "./FileViewer";
import { textFixture } from "./mock-preview-fixtures";
import { ReplaceAssetDialog } from "./ReplaceAssetDialog";
import { ScopeDocuments } from "./ScopeDocuments";

vi.hoisted(() => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
});
const navigate = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(null),
  convert: vi.fn(
    (path: string) => `asset://fixture/${encodeURIComponent(path)}`,
  ),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: native.invoke,
  convertFileSrc: native.convert,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
  useNavigate: () => navigate,
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockTaskFiles.reset();
  mockTaskFiles.copyDelay = 0;
  mockFilesV2.reset();
  navigate.mockReset();
});
afterEach(() => vi.restoreAllMocks());
async function fixture(
  path = "C:/source/plan.md",
  storage: "board_file" | "linked_file" | "url" = "board_file",
) {
  const app = await mockApi.appState(),
    context = await taskFilesApi.capture(app.jam?.id ?? "");
  const asset = (
    await taskFilesApi.register(
      context,
      registration(storage, path, crypto.randomUUID()),
    )
  ).asset;
  if (!asset) throw new Error("Missing fixture asset");
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], app);
  return {
    asset,
    context,
    client,
    mount: (node: ReactNode) =>
      render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  };
}
const previewCases: [string, Preview][] = [
  [
    "text",
    { type: "text", text: "plain words", mime: "text/plain", truncated: true },
  ],
  [
    "markdown",
    {
      type: "text",
      text: "# Plan\n\n**Shared** plan",
      mime: "text/markdown",
      truncated: false,
    },
  ],
  [
    "image",
    {
      type: "media",
      mediaKind: "image",
      url: "data:image/png;base64,AA==",
      mime: "image/png",
    },
  ],
  [
    "audio",
    {
      type: "media",
      mediaKind: "audio",
      url: "data:audio/wav;base64,AA==",
      mime: "audio/wav",
    },
  ],
  [
    "video",
    {
      type: "media",
      mediaKind: "video",
      url: "data:video/webm;base64,AA==",
      mime: "video/webm",
    },
  ],
  [
    "metadata",
    {
      type: "metadata",
      name: "Mesh",
      kind: "model",
      byteSize: 100,
      modifiedAt: "2026-11-01",
      path: "files/mesh.glb",
      storageType: "board_file",
    },
  ],
  ["url", { type: "url", url: "https://example.com/design" }],
];
it.each(previewCases)("renders %s preview", async (type, preview) => {
  const open = vi.fn();
  const view = render(
    <FilePreviewBody preview={preview} name="Fixture" openExternal={open} />,
  );
  if (type === "markdown") {
    await screen.findByRole("heading", { name: "Plan" });
    await userEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByText(/# Plan/).tagName).toBe("PRE");
  }
  if (type === "text") {
    expect(screen.getByText("plain words").tagName).toBe("PRE");
    expect(screen.getByRole("status")).toHaveTextContent("first 2 MiB");
  }
  if (type === "image") {
    await userEvent.click(
      screen.getByRole("button", { name: "View image at 100%" }),
    );
    expect(screen.getByRole("button", { name: "Fit image" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  if (type === "audio" || type === "video")
    expect(view.container.querySelector(type)).toHaveAttribute("controls");
  if (type === "url" || type === "metadata") {
    await userEvent.click(screen.getByRole("button"));
    expect(open).toHaveBeenCalledOnce();
  }
});
it("opens Markdown, renames only the display name, and Esc closes", async () => {
  const f = await fixture(),
    close = vi.fn();
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={close} openTarget={vi.fn()} />,
  );
  await screen.findByRole("heading", { name: "Project plan" });
  await userEvent.click(screen.getByRole("button", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "File name" });
  await userEvent.clear(input);
  await userEvent.type(input, "Decision register");
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByRole("heading", { name: "Decision register" });
  expect(
    (await mockFilesV2.list(f.context)).find((a) => a.id === f.asset.id),
  ).toMatchObject({
    name: "Decision register",
    storedPath: f.asset.storedPath,
  });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
it.each(["board_file", "linked_file", "url"] as const)(
  "delete unused %s gives exact ownership copy",
  async (storage) => {
    const f = await fixture(
        storage === "url" ? "https://example.com/plan" : "C:/source/plan.md",
        storage,
      ),
      close = vi.fn();
    f.mount(
      <DeleteAssetDialog asset={f.asset} context={f.context} onClose={close} />,
    );
    await screen.findByText("This removes it from the board.");
    if (storage === "board_file")
      screen.getByText("The file moves to the board's trash folder.");
    if (storage === "linked_file")
      screen.getByText("The file in your project stays where it is.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(
      (await mockFilesV2.list(f.context)).some((a) => a.id === f.asset.id),
    ).toBe(false);
  },
);
it("used delete lists scopes, removes links only after the red action", async () => {
  const f = await fixture();
  await mockFilesV2.link(
    f.context,
    scopeInput({ type: "project", key: null }, f.asset.id),
  );
  f.mount(
    <DeleteAssetDialog asset={f.asset} context={f.context} onClose={vi.fn()} />,
  );
  await screen.findByText("Used in 1 place");
  screen.getByText("Project documents");
  expect(mockFilesV2.calls.some((c) => c.command === "delete_asset")).toBe(
    false,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Remove links and delete" }),
  );
  await waitFor(() =>
    expect(mockFilesV2.calls.some((c) => c.command === "delete_asset")).toBe(
      true,
    ),
  );
  expect((await mockFilesV2.usage(f.context, f.asset.id)).scopes).toEqual([]);
});
it("does not offer destructive action while usage failed", async () => {
  const f = await fixture();
  vi.spyOn(fileViewerApi, "usage").mockRejectedValueOnce(
    new Error("Usage offline"),
  );
  f.mount(
    <DeleteAssetDialog asset={f.asset} context={f.context} onClose={vi.fn()} />,
  );
  await screen.findByText("Usage offline");
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry usage" }));
  await screen.findByText("This removes it from the board.");
});
it("replace uses fake picker and History opens the old revision explicitly", async () => {
  const f = await fixture(),
    close = vi.fn();
  vi.spyOn(api, "pickFiles").mockResolvedValue(["C:/source/new-plan.md"]);
  const view = f.mount(
    <ReplaceAssetDialog asset={f.asset} context={f.context} onClose={close} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Choose replacement…" }),
  );
  await screen.findByText(
    "Replace with new-plan.md? The current version is kept in History.",
  );
  expect(mockFilesV2.calls.some((c) => c.command === "replace_asset")).toBe(
    false,
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  view.unmount();
  expect(
    (await mockFilesV2.list(f.context)).find((a) => a.id === f.asset.id)
      ?.contentRevision,
  ).toBe(2);
  f.mount(
    <AssetHistory assetId={f.asset.id} context={f.context} onClose={vi.fn()} />,
  );
  await screen.findByRole("heading", { name: "Revision 1" });
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  await userEvent.click(screen.getByRole("button", { name: "Show in folder" }));
  expect(mockFilesV2.calls).toContainEqual({
    command: "open_asset_revision",
    assetId: f.asset.id,
    revision: 1,
  });
  expect(mockFilesV2.calls).toContainEqual({
    command: "reveal_asset_revision",
    assetId: f.asset.id,
    revision: 1,
  });
});
it("URL replacement uses inline input and does not pick a file", async () => {
  const f = await fixture("https://example.com/old", "url"),
    pick = vi.spyOn(api, "pickFiles");
  f.mount(
    <ReplaceAssetDialog
      asset={f.asset}
      context={f.context}
      onClose={vi.fn()}
    />,
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Replacement URL" }),
    "https://example.com/new",
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  await waitFor(() =>
    expect(mockFilesV2.calls.some((c) => c.command === "replace_asset")).toBe(
      true,
    ),
  );
  expect(pick).not.toHaveBeenCalled();
});
it("usage links close the viewer and navigate to the correct target", async () => {
  const f = await fixture(),
    close = vi.fn(),
    open = vi.fn();
  const usage: AssetUsage = {
    ...emptyUsage(),
    tasks: [{ key: "JB-7", title: "Task", role: "reference" }],
    scopes: [
      { type: "epic", key: "JB-E1", title: "Epic", role: "document" },
      { type: "story", key: "JB-S1", title: "Story", role: "document" },
      { type: "project", key: null, title: "Project", role: "document" },
    ],
    canvas: [{ itemId: "canvas-1", frameTitle: "Frame" }],
  };
  vi.spyOn(fileViewerApi, "usage").mockResolvedValue(usage);
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={close} openTarget={open} />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "JB-S1 · Story" }),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith({ type: "story", key: "JB-S1" });
  for (const group of ["Tasks", "Epics", "Stories", "Project", "Canvas"])
    screen.getByRole("heading", { name: group });
});
it("missing preview offers Locate and guarded Remove link", async () => {
  const f = await fixture("C:/source/missing.md");
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={vi.fn()} openTarget={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Locate…" });
  await userEvent.click(screen.getByRole("button", { name: "Remove link" }));
  await screen.findByRole("dialog", { name: `Delete ${f.asset.name}?` });
});
it("scope picker searches, filters kind, links, then unlinks without deleting", async () => {
  const f = await fixture();
  f.mount(<ScopeDocuments scope={{ type: "epic", key: "JB-E1" }} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "+ Link document" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Search documents" }),
    "plan.md",
  );
  await userEvent.click(await screen.findByRole("option", { name: "plan.md" }));
  const dialog = screen.getByRole("dialog", { name: "Link document" });
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Link document" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await screen.findByRole("button", { name: "plan.md" });
  await userEvent.click(
    screen.getByRole("button", { name: "Actions for plan.md" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Unlink from epic" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "plan.md" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    (await mockFilesV2.list(f.context)).some((a) => a.id === f.asset.id),
  ).toBe(true);
});
it("native operations carry the captured context, including revision commands", async () => {
  const f = await fixture(),
    list = vi
      .spyOn(commands, "listFileAssets")
      .mockResolvedValue({ status: "ok", data: [f.asset] }),
    usage = vi
      .spyOn(commands, "assetUsage")
      .mockResolvedValue({ status: "ok", data: emptyUsage() });
  await nativeFileViewerApi.list(f.context, {
    scope: { type: "project", key: null },
    includeArchived: true,
  });
  await nativeFileViewerApi.usage(f.context, f.asset.id);
  expect(list).toHaveBeenCalledWith(
    f.context,
    expect.objectContaining({
      includeArchived: true,
      scope: { type: "project", key: null },
    }),
  );
  expect(usage).toHaveBeenCalledWith(f.context, f.asset.id);
});
it("mock receipts reject changed payload and archive keeps document links readable", async () => {
  const f = await fixture();
  await mockFilesV2.link(
    f.context,
    scopeInput({ type: "story", key: "JB-S1" }, f.asset.id),
  );
  await mockFilesV2.rename(f.context, {
    assetId: f.asset.id,
    name: "New",
    requestId: "rename-1",
  });
  await mockFilesV2.rename(f.context, {
    assetId: f.asset.id,
    name: "New",
    requestId: "rename-1",
  });
  await expect(
    mockFilesV2.rename(f.context, {
      assetId: f.asset.id,
      name: "Other",
      requestId: "rename-1",
    }),
  ).rejects.toThrow("requestId");
  await mockFilesV2.archive(
    f.context,
    { assetId: f.asset.id, requestId: "archive-1" },
    true,
  );
  expect(
    (await mockFilesV2.list(f.context)).some((a) => a.id === f.asset.id),
  ).toBe(false);
  expect(
    (await mockFilesV2.list(f.context, { includeArchived: true })).find(
      (a) => a.id === f.asset.id,
    )?.archivedAt,
  ).toBeTruthy();
  expect((await mockFilesV2.usage(f.context, f.asset.id)).scopes).toHaveLength(
    1,
  );
});
it("picker results from a different selection epoch cannot replace the original file", async () => {
  const f = await fixture();
  let finish: (paths: string[]) => void = () => {};
  vi.spyOn(api, "pickFiles").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.mount(
    <ReplaceAssetDialog
      asset={f.asset}
      context={f.context}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(api.pickFiles).toHaveBeenCalled());
  vi.spyOn(taskFilesApi, "capture").mockResolvedValue({
    ...f.context,
    selectionEpoch: f.context.selectionEpoch + 1,
  });
  finish(["C:/other/project.md"]);
  await screen.findByRole("alert");
  expect(screen.queryByText(/Replace with project.md/)).not.toBeInTheDocument();
  expect(mockFilesV2.calls.some((c) => c.command === "replace_asset")).toBe(
    false,
  );
});
it("replacement failures retain the selected file and reuse the receipt on an explicit retry", async () => {
  const f = await fixture();
  vi.spyOn(api, "pickFiles").mockResolvedValue(["C:/source/new-plan.md"]);
  const replace = vi
    .spyOn(fileViewerApi, "replace")
    .mockRejectedValueOnce(new Error("Write interrupted"));
  f.mount(
    <ReplaceAssetDialog
      asset={f.asset}
      context={f.context}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText(
    "Replace with new-plan.md? The current version is kept in History.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  await screen.findByText("Write interrupted");
  expect(replace).toHaveBeenCalledOnce();
  screen.getByText(
    "Replace with new-plan.md? The current version is kept in History.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
  expect(replace.mock.calls[0]?.[1].requestId).toBe(
    replace.mock.calls[1]?.[1].requestId,
  );
});
it("native media converts only the checked preview path and revision openers retain revision identity", async () => {
  const f = await fixture();
  vi.spyOn(commands, "previewFileAsset").mockResolvedValue({
    status: "ok",
    data: {
      type: "media",
      mediaKind: "image",
      path: "C:/board/files/a b.png",
      mime: "image/png",
    },
  });
  const preview = await nativeFileViewerApi.preview(f.context, f.asset.id);
  expect(native.convert).toHaveBeenCalledWith("C:/board/files/a b.png");
  expect(preview).toMatchObject({
    type: "media",
    url: "asset://fixture/C%3A%2Fboard%2Ffiles%2Fa%20b.png",
  });
  await nativeFileViewerApi.revision(f.context, f.asset.id, 1, false);
  await nativeFileViewerApi.revision(f.context, f.asset.id, 1, true);
  expect(native.invoke).toHaveBeenCalledWith("open_asset_revision", {
    context: f.context,
    assetId: f.asset.id,
    revision: 1,
  });
  expect(native.invoke).toHaveBeenCalledWith("reveal_asset_revision", {
    context: f.context,
    assetId: f.asset.id,
    revision: 1,
  });
});
it("archive, unarchive, archive are three intents with independent receipts", async () => {
  const f = await fixture();
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={vi.fn()} openTarget={vi.fn()} />,
  );
  await screen.findByRole("heading", { name: "Project plan" });
  for (const [index, action] of ["Archive", "Unarchive", "Archive"].entries()) {
    await userEvent.click(
      screen.getByRole("button", { name: "More file actions" }),
    );
    await userEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() =>
      expect(
        mockFilesV2.calls.filter(
          (c) =>
            c.command === "archive_asset" || c.command === "unarchive_asset",
        ),
      ).toHaveLength(index + 1),
    );
    await waitFor(() => {
      if (action === "Unarchive")
        expect(screen.queryByText("Archived")).not.toBeInTheDocument();
      else expect(screen.getByText("Archived")).toBeInTheDocument();
    });
  }
  expect(
    (await mockFilesV2.list(f.context, { includeArchived: true })).find(
      (a) => a.id === f.asset.id,
    )?.archivedAt,
  ).toBeTruthy();
});
it("Escape dismisses the file menu before the viewer and returns focus to its trigger", async () => {
  const f = await fixture(),
    close = vi.fn();
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={close} openTarget={vi.fn()} />,
  );
  const trigger = await screen.findByRole("button", {
    name: "More file actions",
  });
  await userEvent.click(trigger);
  screen.getByRole("button", { name: "Archive" });
  await userEvent.keyboard("{Escape}");
  expect(
    screen.queryByRole("button", { name: "Archive" }),
  ).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
});
it("Fix 1: scope and task usage labels retain real seeded titles", async () => {
  const f = await fixture(),
    epic = (await api.getEpic("JB-E1")).epic,
    story = (await api.getStory("JB-S1")).story,
    task = await api.getTask("JB-7");
  expect(epic.title).not.toBe(epic.key);
  expect(story.title).not.toBe(story.key);
  await mockFilesV2.link(
    f.context,
    scopeInput({ type: "epic", key: epic.key }, f.asset.id),
  );
  await mockFilesV2.link(
    f.context,
    scopeInput({ type: "story", key: story.key }, f.asset.id),
  );
  await mockFilesV2.link(f.context, {
    ...scopeInput({ type: "task", key: task.key }, f.asset.id),
    role: "reference",
    expectedUpdatedAt: task.updatedAt,
    expectedClaimGeneration: task.claimGeneration ?? "0",
  });
  const usage = await mockFilesV2.usage(f.context, f.asset.id);
  expect(usage.scopes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: epic.key, title: epic.title }),
      expect.objectContaining({ key: story.key, title: story.title }),
    ]),
  );
  render(<AssetUsageList usage={usage} openTarget={vi.fn()} />);
  screen.getByRole("button", { name: `${epic.key} · ${epic.title}` });
  screen.getByRole("button", { name: `${story.key} · ${story.title}` });
  screen.getByRole("button", { name: `${task.key} · ${task.title}` });
});
it("Fix 1: project and unframed canvas rows have readable fixed labels", () => {
  render(
    <AssetUsageList
      usage={{
        ...emptyUsage(),
        scopes: [
          {
            type: "project",
            key: null,
            title: "Raw project name",
            role: "document",
          },
        ],
        canvas: [
          { itemId: "opaque-item-id", frameTitle: null },
          { itemId: "framed-item", frameTitle: "Lantern board" },
        ],
      }}
      openTarget={vi.fn()}
    />,
  );
  screen.getByRole("button", { name: "Project documents" });
  screen.getByRole("button", { name: "Canvas" });
  screen.getByRole("button", { name: "Lantern board" });
  expect(screen.queryByText("opaque-item-id")).not.toBeInTheDocument();
});
it("Fix 1: known board metadata matches fixture bytes and uses a readable header", async () => {
  const f = await fixture();
  const asset = (await mockFilesV2.list(f.context)).find(
    (a) => a.id === f.asset.id,
  );
  expect(asset?.byteSize).toBe(
    new TextEncoder().encode(textFixture).byteLength,
  );
  expect(asset?.modifiedAt).toBe("2026-10-31T08:00:00Z");
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={vi.fn()} openTarget={vi.fn()} />,
  );
  await screen.findByText("2.1 KB · Modified 31 Oct");
  expect(screen.queryByText(/Unknown size/)).not.toBeInTheDocument();
});
it("Fix 1: a board asset without fixture metadata still reports unknown size and date", async () => {
  const f = await fixture("C:/source/unmeasured.glb");
  f.mount(
    <FileViewer assetId={f.asset.id} onClose={vi.fn()} openTarget={vi.fn()} />,
  );
  await screen.findByText("Unknown size · Modified date unknown");
});
it("Fix 1: image metadata reports the real decoded fixture byte count", async () => {
  const f = await fixture("C:/source/landscape.png"),
    preview = await mockFilesV2.preview(f.context, f.asset.id);
  if (preview.type !== "media") throw new Error("Expected the image fixture");
  const bytes = atob(preview.url.slice(preview.url.indexOf(",") + 1)).length;
  expect(
    (await mockFilesV2.list(f.context)).find((a) => a.id === f.asset.id),
  ).toMatchObject({ byteSize: bytes, modifiedAt: "2026-10-31T08:00:00Z" });
});
