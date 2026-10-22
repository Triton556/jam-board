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
  releaseTask: (input) => unwrap(commands.releaseTask(input)),
  getExecution: (scope) => unwrap(commands.getExecution(scope)),
  listExecution: () => unwrap(commands.listExecution()),
  setExecution: (input) => unwrap(commands.setExecution(input)),
  listExecutionRequests: (status) =>
    unwrap(commands.listExecutionRequests(status ?? null)),
  resolveExecutionRequest: (input) =>
    unwrap(commands.resolveExecutionRequest(input)),
  listProjects: (includeArchived = false) =>
    unwrap(commands.listProjects(includeArchived)),
  selectProject: (projectId) => unwrap(commands.selectProject(projectId)),
  restoreProject: (projectId) => unwrap(commands.restoreProject(projectId)),
  getProject: () => unwrap(commands.getProject()),
  updateProject: (input) =>
    unwrap(
      commands.updateProject({
        name: null,
        milestoneAt: null,
        startsAt: null,
        endsAt: null,
        timezone: null,
        ...input,
      }),
    ),
  pickFolder: () => unwrap(commands.pickFolder()),
  skillSavedPath: () => unwrap(commands.skillSavedPath()),
  skillCheck: (input) => unwrap(commands.skillCheck(input)),
  runSkill: (input, step) => unwrap(commands.runSkill(input, step)),
  cancelSkill: async () => {
    await unwrap(commands.cancelSkill());
  },
  onSkillOutput: (cb) => {
    let stop: (() => void) | undefined;
    let disposed = false;
    void events.skillOutput
      .listen((e) => cb(e.payload.line))
      .then((off) => {
        if (disposed) off();
        else stop = off;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  },

  referenceCanvas: () => unwrap(commands.referenceCanvas()),
  addReference: (input) =>
    unwrap(
      commands.addReference({
        filePath: null,
        url: null,
        text: null,
        title: null,
        caption: null,
        tags: null,
        frameEpicKey: null,
        frameId: null,
        linkTo: null,
        x: null,
        y: null,
        ...input,
      }),
    ),
  updateReference: (itemId, patch) =>
    unwrap(commands.updateReference({ itemId, ...patch })),
  linkReference: (itemId, targetKey) =>
    unwrap(commands.linkReference({ itemId, targetKey })),
  canvasGeometry: (input) => unwrap(commands.canvasGeometry(input)),
  canvasArchive: async (input) => {
    await unwrap(commands.canvasArchive(input));
  },
  createRefFrame: (input) =>
    unwrap(
      commands.createRefFrame({
        id: "",
        jamId: "",
        epicId: null,
        w: 850,
        h: 620,
        color: "m4",
        archivedAt: null,
        collapsed: false,
        ...input,
      }),
    ),
  updateRefFrame: (id, patch) =>
    unwrap(commands.updateRefFrame({ id, ...patch })),
  createRefEdge: (fromItem, toItem, label) =>
    unwrap(commands.createRefEdge({ fromItem, toItem, label })),
  updateRefEdge: (id, label) => unwrap(commands.updateRefEdge(id, label)),
  referenceMetadata: (id, metadata) =>
    unwrap(commands.referenceMetadata(id, metadata)),
  referenceMedia: (id) => unwrap(commands.referenceMedia(id)),
  clipboardReference: (bytes, x, y) =>
    unwrap(commands.clipboardReference(bytes, x, y)),
  fetchReferencePreview: (id) => unwrap(commands.fetchReferencePreview(id)),
  clearReferencePreview: (id) => unwrap(commands.clearReferencePreview(id)),
  canvasViewport: (value) => unwrap(commands.canvasViewport(value ?? null)),
  listEpics: () => unwrap(commands.listPlanEpics()),
  listStories: () => unwrap(commands.listPlanStories()),
  getEpic: (key) => unwrap(commands.getEpic(key)),
  getStory: (key) => unwrap(commands.getStory(key)),
  createEpic: (input) =>
    unwrap(
      commands.createEpic({
        color: null,
        goalMd: null,
        doneWhenMd: null,
        notIncludedMd: null,
        decidedMd: null,
        openQuestionsMd: null,
        participation: null,
        reviewer: null,
        workerModel: null,
        ...input,
      }),
    ),
  updateEpic: (key, patch) =>
    unwrap(
      commands.updateEpic({
        title: null,
        color: null,
        goalMd: null,
        doneWhenMd: null,
        notIncludedMd: null,
        decidedMd: null,
        openQuestionsMd: null,
        participation: null,
        reviewer: null,
        ...patch,
        key,
      }),
    ),
  setEpicStatus: (key, status, overrideReason) =>
    unwrap(
      commands.setEpicStatus({
        key,
        status,
        overrideReason: overrideReason ?? null,
      }),
    ),
  setBrain: (epicKey, handle) =>
    handle === null
      ? unwrap(commands.clearBrain(epicKey))
      : unwrap(commands.setBrain({ epicKey, memberHandle: handle })),
  createStory: (input) =>
    unwrap(
      commands.createStory({
        outcomeMd: null,
        basisMd: null,
        preserveMd: null,
        scaleMd: null,
        rejectionRisksMd: null,
        openDecisionsMd: null,
        acceptance: null,
        ...input,
      }),
    ),
  updateStory: (key, patch) => unwrap(commands.updateStory({ key, ...patch })),
  setStoryStatus: (key, status, overrideReason) =>
    unwrap(
      commands.setStoryStatus({
        key,
        status,
        overrideReason: overrideReason ?? null,
      }),
    ),
  reorderStory: (key, beforeKey) =>
    unwrap(commands.reorderStory(key, beforeKey ?? null)),
  updateTaskBrief: (key, patch) =>
    unwrap(commands.updateTaskBrief({ key, ...patch })),
  checkReady: (key) => unwrap(commands.checkReady(key)),
  markReady: (input) =>
    unwrap(
      commands.markReady({
        ...input,
        overrideReason: input.overrideReason ?? null,
      }),
    ),
  listQuestions: (status, scope) =>
    unwrap(
      commands.listQuestions({ status: status ?? null, scope: scope ?? null }),
    ),
  answerQuestion: (input) => unwrap(commands.answerQuestion(input)),
  withdrawQuestion: (id) => unwrap(commands.withdrawQuestion(id)),
  askUser: (input) => unwrap(commands.askUser(input)),
  reviewTask: (input) => unwrap(commands.reviewTask(input)),
  epicJournal: (key) => unwrap(commands.epicJournal(key, 0)),
  listChangesSince: (cursor, epicKey) =>
    unwrap(commands.listChangesSince({ cursor, epicKey: epicKey ?? null })),
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
        if (e.payload.type === "drop")
          cb(e.payload.paths, {
            x: e.payload.position.x / devicePixelRatio,
            y: e.payload.position.y / devicePixelRatio,
          });
      }),
    ),
  showInFolder: revealItemInDir,
  openUrl,

  listTasks: (input) =>
    unwrap(
      commands.listTasks({
        epic: null,
        story: null,
        ready: null,
        changesRequested: null,
        needsInfo: null,
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
        storyKey: input.storyKey ?? null,
        ...input.brief,
      }),
    ),
  moveTask: (input) =>
    unwrap(
      commands.moveTask({
        overrideReason: null,
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
