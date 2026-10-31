import {
  type ApiError_Serialize,
  commands,
  type FileAsset,
  type FileAssetQuery,
  type FileMutationResult,
  type FileOperationStatus,
  type FileResolution,
  type FileTaskVersion,
  type FolderCommandContext,
  type RegisterFile,
  type TaskFile,
  type TaskFileInput,
} from "../bindings";
import { api } from "./api";

export type FileRole = "to_edit" | "reference" | "result";
export const fileRoles: Record<FileRole, string> = {
  to_edit: "To edit",
  reference: "References",
  result: "Results",
};
export const fileRoleLabels: Record<FileRole, string> = {
  to_edit: "To edit",
  reference: "Reference",
  result: "Result",
};
export type FileContext = FolderCommandContext & { projectId: string };
export type FileUsage = {
  key: string;
  title: string;
  role: string;
  status: string;
};
export const emptyFileQuery: FileAssetQuery = {
  kind: null,
  query: null,
  storageType: null,
  taskKey: null,
  role: null,
  limit: 500,
  cursor: null,
  workingDirectory: null,
};
export interface TaskFilesApi {
  capture(projectId: string): Promise<FileContext>;
  list(
    context: FileContext,
    query?: Partial<FileAssetQuery>,
  ): Promise<FileAsset[]>;
  taskFiles(context: FileContext, taskKey: string): Promise<TaskFile[]>;
  read(
    context: FileContext,
    taskKey: string,
  ): Promise<{ files: TaskFile[]; version: FileTaskVersion }>;
  version(context: FileContext, taskKey: string): Promise<FileTaskVersion>;
  register(
    context: FileContext,
    input: RegisterFile,
  ): Promise<FileMutationResult>;
  link(context: FileContext, input: TaskFileInput): Promise<FileMutationResult>;
  setRole(
    context: FileContext,
    input: TaskFileInput,
  ): Promise<FileMutationResult>;
  unlink(
    context: FileContext,
    input: TaskFileInput,
  ): Promise<FileMutationResult>;
  status(context: FileContext, requestId: string): Promise<FileOperationStatus>;
  cancel(context: FileContext, requestId: string): Promise<FileOperationStatus>;
  resolve(context: FileContext, assetId: string): Promise<FileResolution>;
  open(context: FileContext, assetId: string, reveal: boolean): Promise<void>;
  usages(context: FileContext): Promise<Record<string, FileUsage[]>>;
}
async function unwrap<T>(
  promise: Promise<
    { status: "ok"; data: T } | { status: "error"; error: ApiError_Serialize }
  >,
): Promise<T> {
  const result = await promise;
  if (result.status === "error")
    throw Object.assign(new Error(result.error.message), result.error);
  return result.data;
}
export const tauriTaskFiles: TaskFilesApi = {
  async version(context, taskKey) {
    const task = await api.getTask(taskKey);
    if (task.jamId !== context.projectId)
      throw new Error("The Files target changed.");
    return {
      updatedAt: task.updatedAt,
      claimGeneration: task.claimGeneration ?? "0",
    };
  },
  async capture(projectId) {
    const [context, app] = await Promise.all([
      api.projectSelectionContext(),
      api.appState(),
    ]);
    if (!context || app.jam?.id !== projectId)
      throw new Error("The Files target changed. Reopen this task.");
    return {
      ...context,
      projectId,
    };
  },
  async list(context, query = {}) {
    const files: FileAsset[] = [];
    const limit = query.limit ?? 500;
    let offset = Number(query.cursor ?? 0);
    for (;;) {
      const page = await api.listFileAssets(context, {
        ...emptyFileQuery,
        ...query,
        limit,
        cursor: String(offset),
      });
      files.push(...page);
      if (query.limit != null || page.length < limit) return files;
      offset += page.length;
    }
  },
  async taskFiles(context, taskKey) {
    return (await this.read(context, taskKey)).files;
  },
  async read(context, taskKey) {
    const task = await api.getTask(taskKey);
    if (task.jamId !== context.projectId)
      throw new Error("The Files target changed.");
    const fresh = await this.list(context, { taskKey });
    const files = (task.files ?? []).map((row) => ({
      ...row,
      asset: fresh.find((a) => a.id === row.asset.id) ?? row.asset,
    }));
    return {
      files,
      version: {
        updatedAt: task.updatedAt,
        claimGeneration: task.claimGeneration ?? "0",
      },
    };
  },
  register: (context, input) => api.registerFile(context, input),
  link: (context, input) => api.linkTaskFile(context, input),
  setRole: (context, input) => api.setTaskFileRole(context, input),
  unlink: (context, input) => api.unlinkTaskFile(context, input),
  status: (context, requestId) =>
    unwrap(commands.fileOperationStatus(context, requestId)),
  cancel: (context, requestId) =>
    unwrap(commands.cancelFileOperation(context, requestId)),
  async resolve(context, assetId) {
    const settings = await api.getSettings();
    return unwrap(
      commands.resolveFile(context, {
        assetId,
        workingDirectory: settings.workingDirectory ?? null,
      }),
    );
  },
  async open(context, assetId, reveal) {
    await unwrap(
      reveal
        ? commands.revealFileAsset(context, assetId)
        : commands.openFileAsset(context, assetId),
    );
  },
  async usages(context) {
    const [board, assets] = await Promise.all([
      api.listBoardTasks(),
      api.listAssets(),
    ]);
    const keys = new Set([
      ...Object.values(board)
        .flat()
        .map((task) => task.key),
      ...assets.flatMap((asset) => asset.tasks.map((task) => task.key)),
    ]);
    const result: Record<string, FileUsage[]> = {};
    for (const key of keys) {
      const detail = await api.getTask(key);
      if (detail.jamId !== context.projectId)
        throw new Error("The Files target changed.");
      for (const row of detail.files ?? []) {
        const usages = result[row.asset.id] ?? [];
        result[row.asset.id] = usages;
        usages.push({
          key: detail.key,
          title: detail.title,
          role: row.role,
          status: detail.status,
        });
      }
    }
    return result;
  },
};
export const taskFilesApi: TaskFilesApi = {
  ...tauriTaskFiles,
  status: (context, id) => api.fileOperationStatus(context, id),
  cancel: (context, id) => api.cancelFileOperation(context, id),
  resolve: (context, id) => api.resolveFile(context, id),
  open: (context, id, reveal) => api.openFile(context, id, reveal),
};

export function registration(
  storageType: RegisterFile["storageType"],
  source: string,
  requestId: string,
): RegisterFile {
  return {
    storageType,
    sourcePath: storageType === "url" ? null : source,
    url: storageType === "url" ? source : null,
    pathBase: null,
    fileKind: null,
    name: null,
    notes: null,
    companions: null,
    requestId,
    taskKey: null,
    role: null,
    expectedClaimGeneration: null,
    expectedUpdatedAt: null,
    workingDirectory: null,
  };
}
export function storageLabel(storageType: string) {
  return storageType === "board_file"
    ? "Board file"
    : storageType === "url"
      ? "URL"
      : "Linked";
}
export function fileStatus(asset: FileAsset) {
  const status = asset.resolution.status;
  if (asset.storageType === "url" && asset.resolution.resolvedPath) return "";
  return status === "available"
    ? ""
    : status === "missing"
      ? "Missing — file not found at path"
      : status === "unreadable"
        ? "Unreadable — file cannot be read at path"
        : "Availability unknown";
}
export function fileUnavailable(asset: FileAsset) {
  return (
    asset.storageType !== "url" &&
    ["missing", "unreadable"].includes(asset.resolution.status)
  );
}
