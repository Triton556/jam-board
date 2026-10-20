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
  ConfigSnippets,
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
export interface JamApi {
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
  setSettings(input: SettingsPatch): Promise<Settings>;
  resetJam(input: { confirmName: string }): Promise<AppState>;
  exportJamJson(): Promise<{ path: string }>;
  importJamJson(path: string): Promise<AppState>;
  pickFile(jsonOnly: boolean): Promise<string | null>;
  mcpStatus(): Promise<McpStatus>;
  setMcpHttpEnabled(enabled: boolean): Promise<void>;
  regenerateMcpToken(): Promise<void>;
  revealMcpToken(): Promise<string>;
  mcpConfigSnippets(): Promise<ConfigSnippets>;
  onMcpChanged(cb: () => void): () => void;
  onFileDrop(
    cb: (paths: string[]) => void,
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
  listMembers(): Promise<MemberWithStats[]>;
  listActivity(input?: Partial<ActivityQuery>): Promise<ActivityEvent[]>;
  setTheme(theme: Theme): Promise<void>;
  onBoardChanged(cb: (events: ActivityEvent[]) => void): () => void;
}
export const api: JamApi =
  import.meta.env.VITE_MOCK_BRIDGE === "1"
    ? (await import("./mock-bridge")).mockApi
    : tauriApi;
