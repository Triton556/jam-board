import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ApiError_Serialize } from "../bindings";
import { commands, events } from "../bindings";
import type { JamApi } from "./api";
import { emptyBoard, JamError, statuses } from "./types";

async function unwrap<T>(
  promise: Promise<
    { status: "ok"; data: T } | { status: "error"; error: ApiError_Serialize }
  >,
): Promise<T> {
  const result = await promise;
  if (result.status === "error")
    throw new JamError(
      result.error.code,
      result.error.message,
      result.error.field,
    );
  return result.data;
}
export const tauriApi: JamApi = {
  pickFiles: () => unwrap(commands.pickFiles()),
  attachFile: (key, path) => unwrap(commands.attachFile(key, path)),
  appReady: async () => {
    await unwrap(commands.appReady());
  },
  listAssets: (input) =>
    unwrap(
      commands.listAssets({
        kind: input?.kind ?? null,
        text: input?.text ?? null,
      }),
    ),
  createAsset: (input) =>
    unwrap(commands.createAsset({ notes: null, ...input })),
  updateAsset: async (input) => {
    await unwrap(
      commands.updateAsset({ name: null, notes: null, kind: null, ...input }),
    );
  },
  linkAsset: async (input) => {
    await unwrap(commands.linkAsset(input));
  },
  unlinkAsset: async (input) => {
    await unwrap(commands.unlinkAsset(input));
  },
  assetPreview: (id) => unwrap(commands.assetPreview(id)),
  createMember: (input) =>
    unwrap(commands.createMember({ avatar: null, ...input })),
  updateMember: (input) =>
    unwrap(
      commands.updateMember({
        name: null,
        color: null,
        avatar: null,
        ...input,
      }),
    ),
  getSettings: () => unwrap(commands.getSettings()),
  setSettings: (input) =>
    unwrap(
      commands.setSettings({
        theme: null,
        soundEnabled: null,
        colorBy: null,
        estimatesEnabled: null,
        wipLimit: null,
        assetsView: null,
        collapsedAssetKinds: null,
        ...input,
      }),
    ),
  resetJam: (input) => unwrap(commands.resetJam(input)),
  exportJamJson: () => unwrap(commands.exportJamJson()),
  importJamJson: (path) => unwrap(commands.importJamJson(path)),
  pickFile: (jsonOnly) => unwrap(commands.pickFile(jsonOnly)),
  mcpStatus: () => unwrap(commands.mcpStatus()),
  setMcpHttpEnabled: async (enabled) => {
    await unwrap(commands.setMcpHttpEnabled(enabled));
  },
  regenerateMcpToken: async () => {
    await unwrap(commands.regenerateMcpToken());
  },
  revealMcpToken: () => unwrap(commands.revealMcpToken()),
  mcpConfigSnippets: () => unwrap(commands.mcpConfigSnippets()),
  onMcpChanged: (cb) => subscribe(events.mcpCallsChanged.listen(() => cb())),
  onFileDrop: (cb, onActive) =>
    subscribe(
      getCurrentWebview().onDragDropEvent((e) => {
        onActive?.(e.payload.type === "enter" || e.payload.type === "over");
        if (e.payload.type === "drop") cb(e.payload.paths);
      }),
    ),
  showInFolder: revealItemInDir,
  openUrl,

  listTasks: (input) =>
    unwrap(
      commands.listTasks({
        status: null,
        assignee: null,
        tags: null,
        text: null,
        includeArchived: null,
        sort: null,
        ...input,
      }),
    ),
  updateTask: (input) => unwrap(commands.updateTask(input)),
  archiveTask: (key, reason) =>
    unwrap(commands.archiveTask(key, reason ?? null)),
  unarchiveTask: (key) => unwrap(commands.unarchiveTask(key)),
  addComment: (input) => unwrap(commands.addComment(input)),
  listTags: () => unwrap(commands.listTags()),
  runtimeInfo: () => unwrap(commands.runtimeInfo()),
  seedBulk: async (n) => {
    if (!import.meta.env.DEV) throw new JamError("validation", "Debug only");
    await unwrap(commands.seedBulk(n));
  },
  appState: () => unwrap(commands.appState()),
  createJam: (input) => unwrap(commands.createJam(input)),
  loadDemoJam: () => unwrap(commands.loadDemoJam()),
  setCurrentMember: (id) => unwrap(commands.setCurrentMember(id)),
  addSelf: (name) => unwrap(commands.addSelf(name)),
  getBoard: () => unwrap(commands.getBoard()),
  listBoardTasks: async () => {
    const data = await unwrap(commands.listBoardTasks());
    const board = emptyBoard();
    for (const status of statuses) board[status] = data[status] ?? [];
    return board;
  },
  getTask: (key) => unwrap(commands.getTask(key)),
  createTask: (input) =>
    unwrap(
      commands.createTask({
        title: input.title,
        status: input.status,
        description: input.description ?? null,
        priority: input.priority ?? null,
        tags: input.tags ?? null,
        estimate: input.estimate ?? null,
        dueAt: input.dueAt ?? null,
        idempotencyKey: null,
      }),
    ),
  moveTask: (input) =>
    unwrap(
      commands.moveTask({
        ...input,
        beforeKey: input.beforeKey ?? null,
        afterKey: input.afterKey ?? null,
      }),
    ),
  listMembers: () => unwrap(commands.listMembers()),
  listActivity: (input) =>
    unwrap(
      commands.listActivity({
        beforeSeq: input?.beforeSeq ?? null,
        actorKind: input?.actorKind ?? null,
        limit: input?.limit ?? null,
      }),
    ),
  setTheme: async (theme) => {
    await unwrap(commands.setTheme(theme));
  },
  onBoardChanged: (cb) => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void events.boardChanged
      .listen((event) => cb(event.payload.events))
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  },
};

function subscribe(promise: Promise<() => void>) {
  let disposed = false;
  let stop: (() => void) | undefined;
  void promise.then((fn) => {
    if (disposed) fn();
    else stop = fn;
  });
  return () => {
    disposed = true;
    stop?.();
  };
}
