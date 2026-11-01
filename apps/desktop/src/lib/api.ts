import type { RefFrame, RefFrameTarget, RefItem } from "../bindings";
import { nativeReferenceApi } from "../features/references/native-commands";
import type { ExecutionApi } from "./execution-api";
import type { PlanningApi } from "./planning-api";
import type { ProjectsApi } from "./project-api";
import type { ReferencesApi } from "./references-api";
import { tauriApi } from "./tauri-bridge";
import type {
  ActivityEvent,
  ActivityQuery,
  AppState,
  Asset,
  AssetEdit,
  AssetLink,
  AssetWithTasks,
  BoardSummary,
  BoardTasks,
  Comment,
  ConnectSnippets,
  CreateInput,
  McpStatus,
  Member,
  MemberEdit,
  MemberWithStats,
  MoveInput,
  NewAsset,
  NewJamInput,
  NewMember,
  RuntimeInfo,
  Settings,
  SettingsPatch,
  TagCount,
  TaskDetail,
  TaskListPage,
  TaskQuery,
  TaskSummary,
  Theme,
  UpdateInput,
} from "./types";
import { stablePayload } from "./types";
export interface JamApi
  extends PlanningApi,
    ReferencesApi,
    ProjectsApi,
    ExecutionApi {
  listInboxEvents(
    input: import("./inbox-events-api").InboxEventsQuery,
  ): Promise<import("../bindings").InboxEventsPage>;
  markInboxEventsSeen(seq: number): Promise<number>;
  fileViewer(): Promise<import("./file-viewer-api").FileViewerApi>;
  moodboard(): Promise<import("./moodboard-api").MoodboardApi>;
  importPlan(
    context: import("./import-plan-api").PlanContext,
    input: import("./import-plan-api").ImportPlanInput,
  ): Promise<import("./import-plan-api").ImportReport>;
  undoImport(
    context: import("./import-plan-api").PlanContext,
    batchId: string,
    requestId: string,
  ): Promise<import("./import-plan-api").UndoImportResult>;
  listImportBatches(
    context: import("./import-plan-api").PlanContext,
  ): Promise<import("./import-plan-api").ImportBatch[]>;
  moveStory(
    context: import("./import-plan-api").PlanContext,
    input: import("../bindings").MoveStoryInput,
  ): Promise<import("../bindings").Story_Serialize>;
  moveTaskToStory(
    context: import("./import-plan-api").PlanContext,
    input: import("../bindings").MoveTaskToStoryInput,
  ): Promise<import("../bindings").TaskDetail_Serialize>;
  projectSelectionContext(): Promise<
    import("../bindings").FolderCommandContext | null
  >;
  projectFolderInfo(): Promise<import("../bindings").ProjectFolderInfo>;
  listProjectFolders(): Promise<import("../bindings").RegistryEntry[]>;
  createProjectFolder: import("./project-folder-api").ProjectFolderApi["create"];
  openProjectFolder: import("./project-folder-api").ProjectFolderApi["open"];
  registerFile: import("./task-files-api").TaskFilesApi["register"];
  linkTaskFile: import("./task-files-api").TaskFilesApi["link"];
  setTaskFileRole: import("./task-files-api").TaskFilesApi["setRole"];
  unlinkTaskFile: import("./task-files-api").TaskFilesApi["unlink"];
  listFileAssets: import("./task-files-api").TaskFilesApi["list"];
  fileOperationStatus: import("./task-files-api").TaskFilesApi["status"];
  cancelFileOperation: import("./task-files-api").TaskFilesApi["cancel"];
  resolveFile: import("./task-files-api").TaskFilesApi["resolve"];
  openFile: import("./task-files-api").TaskFilesApi["open"];

  getProject(): Promise<import("../bindings").Project>;
  updateProject(
    input: Partial<import("../bindings").ProjectEditInput> & {
      template: string;
    },
  ): Promise<import("../bindings").Project>;
  pickFolder(): Promise<string | null>;
  skillSavedPath(): Promise<string | null>;
  skillCheck(
    input: import("../bindings").SkillInput,
  ): Promise<import("../bindings").SkillCheck>;
  runSkill(
    input: import("../bindings").SkillInput,
    step: "plan" | "install" | "verify",
  ): Promise<import("../bindings").SkillResult>;
  cancelSkill(): Promise<void>;
  onSkillOutput(cb: (line: string) => void): () => void;

  pickFiles(): Promise<string[]>;
  attachFile(key: string, path: string): Promise<Asset>;
  appReady(): Promise<void>;
  listAssets(input?: {
    kind?: string;
    text?: string;
  }): Promise<AssetWithTasks[]>;
  createAsset(input: NewAsset): Promise<Asset>;
  updateAsset(input: AssetEdit): Promise<void>;
  linkAsset(input: AssetLink): Promise<void>;
  unlinkAsset(input: AssetLink): Promise<void>;
  assetPreview(id: string): Promise<string | null>;
  createMember(input: NewMember): Promise<Member>;
  updateMember(input: MemberEdit): Promise<Member>;
  getSettings(): Promise<Settings>;
  setSettings(
    input: SettingsPatch,
    context?: import("../bindings").FolderCommandContext,
  ): Promise<Settings>;
  resetJam(input: { confirmName: string }): Promise<AppState>;
  exportJamJson(): Promise<{ path: string }>;
  importJamJson(path: string): Promise<AppState>;
  pickFile(jsonOnly: boolean): Promise<string | null>;
  mcpStatus(): Promise<McpStatus>;
  setMcpHttpEnabled(enabled: boolean): Promise<void>;
  regenerateMcpToken(): Promise<void>;
  revealMcpToken(): Promise<string>;
  mcpConfigSnippets(): Promise<ConnectSnippets>;
  onMcpChanged(cb: () => void): () => void;
  onFileDrop(
    cb: (paths: string[], point?: { x: number; y: number }) => void,
    onActive?: (active: boolean) => void,
  ): () => void;
  showInFolder(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;

  listTasks(input: TaskQuery): Promise<TaskListPage>;
  updateTask(input: UpdateInput): Promise<TaskDetail>;
  archiveTask(key: string, reason?: string): Promise<TaskSummary>;
  unarchiveTask(key: string): Promise<TaskSummary>;
  addComment(input: { key: string; bodyMd: string }): Promise<Comment>;
  listTags(): Promise<TagCount[]>;
  runtimeInfo(): Promise<RuntimeInfo>;
  seedBulk(n: number): Promise<void>;
  appState(): Promise<AppState>;
  createJam(input: NewJamInput): Promise<AppState>;
  loadDemoJam(): Promise<AppState>;
  setCurrentMember(memberId: string): Promise<AppState>;
  addSelf(name: string): Promise<AppState>;
  getBoard(): Promise<BoardSummary>;
  listBoardTasks(): Promise<BoardTasks>;
  getTask(key: string): Promise<TaskDetail>;
  createTask(input: CreateInput): Promise<TaskDetail>;
  moveTask(input: MoveInput): Promise<TaskSummary>;
  releaseTask(input: import("../bindings").ReleaseClaim): Promise<TaskSummary>;
  listMembers(): Promise<MemberWithStats[]>;
  listActivity(input?: Partial<ActivityQuery>): Promise<ActivityEvent[]>;
  setTheme(theme: Theme): Promise<void>;
  onBoardChanged(
    cb: (
      events: ActivityEvent[],
      context?: import("../bindings").ProjectEventContext | null,
    ) => void,
  ): () => void;
}
const baseApi: JamApi =
  import.meta.env.VITE_MOCK_BRIDGE === "1"
    ? (await import("./mock-bridge")).mockApi
    : tauriApi;

export type ReferenceVerdict = import("../bindings").ReferenceVerdict | null;
export type FrameTarget = RefFrameTarget;
export type VerdictItem = RefItem;
export type LinkedFrame = RefFrame;
const mockReferences =
  import.meta.env.VITE_MOCK_BRIDGE === "1"
    ? await import("./mock-bridge").then(({ mockApi }) => ({
        setReferenceVerdict: mockApi.setReferenceVerdict.bind(mockApi),
        linkRefFrame: mockApi.linkRefFrame.bind(mockApi),
        unlinkRefFrame: mockApi.unlinkRefFrame.bind(mockApi),
        unlinkReference: mockApi.unlinkReference.bind(mockApi),
        openReferenceFile: mockApi.openReferenceFile.bind(mockApi),
      }))
    : null;
// An uncertain failure keeps the captured ID; a confirmed success ends the intent.
// Include the selection epoch so A→B→A can never reuse an old project's intent.
const pendingCreates = new Map<string, string>();
let selectionEpoch = 0;
let observedProject: string | null | undefined;
function selectionBoundary<A extends unknown[], R>(
  run: (...args: A) => Promise<R>,
) {
  return (...args: A) => {
    selectionEpoch++;
    pendingCreates.clear();
    return run(...args);
  };
}
const readApp = baseApi.appState.bind(baseApi);
function withRequestId<T extends { requestId?: string | null }, R>(
  tool: string,
  run: (input: T) => Promise<R>,
) {
  return async (input: T): Promise<R> => {
    // Dispatch synchronously after the caller's project fence; no read may
    // insert an asynchronous selection gap before the native command captures it.
    const key = stablePayload([observedProject, selectionEpoch, tool, input]);
    const requestId =
      input.requestId ?? pendingCreates.get(key) ?? crypto.randomUUID();
    pendingCreates.set(key, requestId);
    const result = await run({ ...input, requestId });
    pendingCreates.delete(key);
    return result;
  };
}
export const api = Object.assign(
  baseApi,
  mockReferences ?? nativeReferenceApi,
  {
    appState: async () => {
      const state = await readApp();
      const project = state.jam?.id ?? null;
      if (project !== observedProject) {
        observedProject = project;
        selectionEpoch++;
        pendingCreates.clear();
      }
      return state;
    },
    selectProject: selectionBoundary(baseApi.selectProject.bind(baseApi)),
    restoreProject: selectionBoundary(baseApi.restoreProject.bind(baseApi)),
    createJam: selectionBoundary(baseApi.createJam.bind(baseApi)),
    loadDemoJam: selectionBoundary(baseApi.loadDemoJam.bind(baseApi)),
    resetJam: selectionBoundary(baseApi.resetJam.bind(baseApi)),
    importJamJson: selectionBoundary(baseApi.importJamJson.bind(baseApi)),
    createProjectFolder: selectionBoundary(
      baseApi.createProjectFolder.bind(baseApi),
    ),
    openProjectFolder: selectionBoundary(
      baseApi.openProjectFolder.bind(baseApi),
    ),
    createTask: withRequestId("create_task", baseApi.createTask.bind(baseApi)),
    createEpic: withRequestId("create_epic", baseApi.createEpic.bind(baseApi)),
    createStory: withRequestId(
      "create_story",
      baseApi.createStory.bind(baseApi),
    ),
    askUser: withRequestId("ask_user", baseApi.askUser.bind(baseApi)),
  },
);
