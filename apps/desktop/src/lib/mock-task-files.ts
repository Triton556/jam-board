import type {
  FileAsset,
  FileMutationResult,
  FileOperationStatus,
  FileTaskVersion,
  RegisterFile,
  TaskFile,
  TaskFileInput,
} from "../bindings";
import { assetKind } from "../features/assets/model";
import { currentMockBridge, mockAdapter } from "./mock-adapter";
import type { FileContext, FileUsage, TaskFilesApi } from "./task-files-api";

type State = {
  assets: FileAsset[];
  links: Record<string, TaskFile[]>;
  receipts: Record<string, { payload: string; result: FileMutationResult }>;
};
export function asFileAsset(asset: import("./types").Asset): FileAsset {
  const file = asset as FileAsset;
  const isUrl = /^https?:\/\//i.test(asset.location);
  const storageType = file.storageType ?? (isUrl ? "url" : "linked_file");
  const pathBase = file.pathBase ?? (isUrl ? "url" : "absolute");
  return {
    ...asset,
    storageType,
    pathBase,
    storedPath: file.storedPath ?? asset.location,
    originalName: file.originalName ?? asset.name,
    mimeType: file.mimeType ?? null,
    byteSize: file.byteSize ?? null,
    contentHash: file.contentHash ?? null,
    contentRevision: file.contentRevision ?? 1,
    metadata: file.metadata ?? {},
    resolution: file.resolution ?? {
      storageType,
      pathBase,
      storedPath: asset.location,
      resolvedPath: asset.location,
      worktreeRoot: null,
      resolutionBasis: pathBase,
      status: /missing/i.test(asset.location)
        ? "missing"
        : /unreadable/i.test(asset.location)
          ? "unreadable"
          : "available",
      checkedAt: new Date().toISOString(),
    },
  };
}
const key = "jam-board:r11-task-files:v1";
export class MockTaskFiles implements TaskFilesApi {
  private state: Record<string, Pick<State, "receipts">> = {};
  private operations = new Map<string, FileOperationStatus>();
  copyDelay = 700;
  /** Synthetic bytes inventory: unlink must never remove an entry. No disk IO. */
  readonly bytes = new Set<string>();
  readonly calls: { command: string; input: unknown }[] = [];
  constructor(private bridge: import("./mock-bridge").MockBridge) {
    if (import.meta.env.VITE_MOCK_BRIDGE === "1") {
      try {
        this.state = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        /* disposable mock */
      }
    }
  }
  reset() {
    this.state = {};
    this.operations.clear();
    this.bytes.clear();
    this.calls.length = 0;
    this.persist();
  }
  private persist() {
    if (import.meta.env.VITE_MOCK_BRIDGE === "1")
      localStorage.setItem(key, JSON.stringify(this.state));
  }
  private async check(context: FileContext) {
    const now = await this.capture(context.projectId);
    if (
      now.instanceId !== context.instanceId ||
      now.selectionEpoch !== context.selectionEpoch
    )
      throw new Error("The Files target changed. Reopen this task.");
    const scope = `${context.instanceId}:${context.projectId}:${this.bridge.folders.selected?.databaseGeneration ?? "legacy"}`;
    const saved = this.state[scope] ?? { receipts: {} };
    this.state[scope] = saved;
    const live = this.bridge.fileInventory();
    const assets = live.assets.map((asset) => this.resolveAsset(asset));
    for (const asset of assets)
      if (asset.storageType === "board_file") this.bytes.add(asset.storedPath);
    return {
      assets,
      links: Object.fromEntries(
        live.tasks.map((task) => [task.key, this.projectTaskFiles(task)]),
      ),
      receipts: saved.receipts,
    };
  }
  async capture(projectId: string): Promise<FileContext> {
    const selected = await this.bridge.folders.selection();
    if (this.bridge.currentProjectId !== projectId || !selected)
      throw new Error("The Files target changed. Reopen this task.");
    return { ...selected, projectId };
  }
  projectTaskFiles(task: import("./types").TaskDetail): TaskFile[] {
    const assets = this.bridge.fileInventory().assets;
    return (
      task.files ??
      task.assets.map((asset, position) => ({
        asset: asFileAsset(asset),
        role: "reference",
        position,
      }))
    ).flatMap((row) => {
      const asset = assets.find((a) => a.id === row.asset.id);
      return asset ? [{ ...row, asset: this.resolveAsset(asset) }] : [];
    });
  }

  private resolveAsset(asset: import("./types").Asset) {
    const file = asFileAsset(asset);
    if (file.pathBase === "board")
      file.resolution = {
        ...file.resolution,
        resolvedPath: `${this.bridge.folders.selected?.folder ?? "C:/mock/repo/JamBoard"}/${file.storedPath}`,
      };
    return file;
  }
  async list(
    context: FileContext,
    query: Parameters<TaskFilesApi["list"]>[1] = {},
  ) {
    const state = await this.check(context);
    return structuredClone(
      state.assets
        .filter(
          (a) =>
            (!query.kind || a.kind === query.kind) &&
            (!query.storageType || a.storageType === query.storageType) &&
            (!query.taskKey ||
              (state.links[query.taskKey] ?? []).some(
                (r) =>
                  r.asset.id === a.id && (!query.role || r.role === query.role),
              )) &&
            (!query.query ||
              `${a.name} ${a.storedPath}`
                .toLowerCase()
                .includes(query.query.toLowerCase())),
        )
        .slice(
          Number(query.cursor ?? 0),
          query.limit == null
            ? undefined
            : Number(query.cursor ?? 0) + query.limit,
        ),
    );
  }
  async taskFiles(context: FileContext, taskKey: string) {
    const state = await this.check(context);
    await this.list(context);
    if (!(taskKey in state.links)) {
      const live = await this.bridge.getTask(taskKey);
      state.links[taskKey] = live.assets.flatMap((asset, position) => {
        const file = state.assets.find((a) => a.id === asset.id);
        return file ? [{ asset: file, role: "reference", position }] : [];
      });
    }
    return structuredClone(state.links[taskKey] ?? []);
  }
  async read(context: FileContext, taskKey: string) {
    const files = await this.taskFiles(context, taskKey);
    const version = await this.version(context, taskKey);
    return { files, version };
  }
  private replay(
    state: State,
    command: string,
    input: RegisterFile | TaskFileInput,
  ) {
    const receipt = state.receipts[input.requestId];
    const payload = JSON.stringify({ command, input });
    if (receipt && receipt.payload !== payload)
      throw Object.assign(new Error("Request ID payload conflict"), {
        code: "CONFLICT",
      });
    return { receipt, payload };
  }
  async version(context: FileContext, taskKey: string) {
    await this.check(context);
    const live = await this.bridge.getTask(taskKey);
    return {
      updatedAt: live.updatedAt,
      claimGeneration: live.claimGeneration ?? "0",
    };
  }

  private async nextVersion(context: FileContext, input: TaskFileInput) {
    const live = await this.bridge.getTask(input.taskKey);
    const version = await this.version(context, input.taskKey);
    // A real task edit invalidates a Files validator too.
    if (
      input.expectedUpdatedAt !== version.updatedAt ||
      input.expectedClaimGeneration !== (live.claimGeneration ?? "0")
    )
      throw Object.assign(new Error("Task changed — reload"), {
        code: "CONFLICT",
      });
    return {
      updatedAt: new Date(
        Math.max(Date.now(), Date.parse(live.updatedAt) + 1),
      ).toISOString(),
      claimGeneration: live.claimGeneration ?? "0",
    };
  }
  async register(
    context: FileContext,
    input: RegisterFile,
  ): Promise<FileMutationResult> {
    const state = await this.check(context);
    const replay = this.replay(state, "register_file", input);
    this.calls.push({
      command: "register_file",
      input: structuredClone(input),
    });
    if (replay.receipt) return structuredClone(replay.receipt.result);
    const source = input.sourcePath ?? input.url ?? "";
    if (input.storageType === "url" && !/^https?:\/\/[^\s]+$/i.test(source))
      throw new Error("Use an http:// or https:// URL");
    if (!source) throw new Error("Choose a file");
    if (input.storageType === "board_file") {
      if (this.operations.get(input.requestId)?.state === "cancelled")
        throw new Error("Copy cancelled. Start a new copy request.");
      this.operations.set(input.requestId, {
        requestId: input.requestId,
        state: "copying",
        canCancel: true,
      });
      await new Promise((resolve) => setTimeout(resolve, this.copyDelay));
      if (this.operations.get(input.requestId)?.state === "cancelled")
        throw new Error("Copy cancelled");
      await this.check(context);
    }
    const kind = input.fileKind ?? assetKind(source);
    const baseName = source.split(/[\\/]/).at(-1) ?? source;
    const pathBase =
      input.storageType === "board_file"
        ? "board"
        : input.storageType === "url"
          ? "url"
          : source.replaceAll("\\", "/").startsWith("C:/mock/repo/")
            ? "repo"
            : "absolute";
    const folder =
      kind === "sprite"
        ? "images"
        : kind === "model"
          ? "models"
          : kind === "audio"
            ? "audio"
            : kind === "document"
              ? "docs"
              : "other";
    const folderPath =
      this.bridge.folders.selected?.manifest.folderRules[kind] ??
      `files/${folder}`;
    let storedPath =
      pathBase === "board"
        ? `${folderPath}/${baseName}`
        : pathBase === "repo"
          ? source.replaceAll("\\", "/").slice(13)
          : source;
    let suffix = 2;
    while (
      pathBase === "board" &&
      state.assets.some((a) => a.storedPath === storedPath)
    )
      storedPath = `files/${folder}/${baseName.replace(/(\.[^.]*)?$/, ` (${suffix++})$1`)}`;
    const asset: FileAsset = {
      id: crypto.randomUUID(),
      jamId: context.projectId,
      kind,
      name: input.name ?? baseName,
      location: storedPath,
      notes: input.notes,
      createdBy: "human",
      createdAt: new Date().toISOString(),
      storageType: input.storageType,
      pathBase,
      storedPath,
      originalName: baseName,
      mimeType: null,
      byteSize: null,
      contentHash: null,
      contentRevision: 1,
      metadata: {},
      resolution: {
        storageType: input.storageType,
        pathBase,
        storedPath,
        resolvedPath:
          pathBase === "board"
            ? `${this.bridge.folders.selected?.folder ?? "C:/mock/repo/JamBoard"}/${storedPath}`
            : source,
        worktreeRoot: pathBase === "repo" ? "C:/mock/repo" : null,
        resolutionBasis: pathBase,
        status: /missing/i.test(source)
          ? "missing"
          : /unreadable/i.test(source)
            ? "unreadable"
            : "available",
        checkedAt: new Date().toISOString(),
      },
    };
    let taskVersion: FileTaskVersion | null = null;
    if (input.taskKey) {
      if (!input.expectedUpdatedAt || input.expectedClaimGeneration == null)
        throw new Error("Task validators are required");
      taskVersion = await this.nextVersion(context, {
        taskKey: input.taskKey,
        assetId: asset.id,
        role: input.role ?? "reference",
        expectedUpdatedAt: input.expectedUpdatedAt,
        expectedClaimGeneration: input.expectedClaimGeneration,
        requestId: input.requestId,
        position: null,
      });
    }
    await this.check(context);
    this.bridge.writeFileAsset(asset);
    state.assets.push(asset);
    if (pathBase === "board") this.bytes.add(storedPath);
    const result: FileMutationResult = {
      reference: null,
      asset,
      taskFile: null,
      taskVersion: null,
      operationId: input.requestId,
      unlinked: false,
      warnings: [],
    };
    if (input.taskKey && taskVersion) {
      const taskFile = { asset, role: input.role ?? "reference", position: 0 };
      this.bridge.writeTaskFiles(
        input.taskKey,
        [...(state.links[input.taskKey] ?? []), taskFile],
        taskVersion,
      );
      result.taskFile = taskFile;
      result.taskVersion = taskVersion;
    }
    state.receipts[input.requestId] = { payload: replay.payload, result };
    this.operations.set(input.requestId, {
      requestId: input.requestId,
      state: "committed",
      canCancel: false,
    });
    this.persist();
    this.bridge.filesChanged(input.taskKey ?? undefined);
    return structuredClone(result);
  }
  private async mutate(
    command: string,
    context: FileContext,
    input: TaskFileInput,
  ) {
    const state = await this.check(context);
    this.calls.push({ command, input: structuredClone(input) });
    const replay = this.replay(state, command, input);
    if (replay.receipt) return structuredClone(replay.receipt.result);
    const taskVersion = await this.nextVersion(context, input);
    await this.check(context);
    const asset = state.assets.find((a) => a.id === input.assetId);
    if (!asset) throw new Error("File not found");
    const rows = state.links[input.taskKey] ?? [];
    state.links[input.taskKey] = rows;
    const index = rows.findIndex((r) => r.asset.id === input.assetId);
    if (input.role && !["to_edit", "reference", "result"].includes(input.role))
      throw new Error("Invalid file role");
    const row = {
      asset,
      role: input.role ?? "reference",
      position: input.position ?? 0,
    };
    if (command === "link_task_file") {
      if (index >= 0) throw new Error("Already linked");
      rows.push(row);
    } else if (index < 0) throw new Error("Association not found");
    else if (command === "unlink_task_file") rows.splice(index, 1);
    else
      rows[index] = {
        ...row,
        position: input.position ?? rows[index]?.position ?? 0,
      };
    this.bridge.writeTaskFiles(input.taskKey, rows, taskVersion);
    const result: FileMutationResult = {
      reference: null,
      asset,
      taskFile: command === "unlink_task_file" ? null : row,
      taskVersion,
      operationId: input.requestId,
      unlinked: command === "unlink_task_file",
      warnings: [],
    };
    state.receipts[input.requestId] = { payload: replay.payload, result };
    this.persist();
    this.bridge.filesChanged(input.taskKey);
    return structuredClone(result);
  }
  link(context: FileContext, input: TaskFileInput) {
    return this.mutate("link_task_file", context, input);
  }
  setRole(context: FileContext, input: TaskFileInput) {
    return this.mutate("set_task_file_role", context, input);
  }
  unlink(context: FileContext, input: TaskFileInput) {
    return this.mutate("unlink_task_file", context, input);
  }
  async status(context: FileContext, requestId: string) {
    await this.check(context);
    return (
      this.operations.get(requestId) ?? {
        requestId,
        state: "unknown",
        canCancel: false,
      }
    );
  }
  async cancel(context: FileContext, requestId: string) {
    const status = await this.status(context, requestId);
    if (status.canCancel) {
      status.state = "cancelled";
      status.canCancel = false;
    }
    return { ...status };
  }
  async resolve(context: FileContext, assetId: string) {
    const asset = (await this.list(context)).find((a) => a.id === assetId);
    if (!asset) throw new Error("File not found");
    return asset.resolution;
  }
  async open(context: FileContext, assetId: string, reveal: boolean) {
    const file = await this.resolve(context, assetId);
    if (
      !file.resolvedPath ||
      (file.storageType === "url"
        ? !/^https?:\/\/[^\s]+$/i.test(file.resolvedPath)
        : file.status !== "available")
    )
      throw Object.assign(new Error(`File is ${file.status}`), {
        code: "validation",
        field: "assetId",
      });
    // Accepted intent only. The mock never opens an application or browser.
    this.calls.push({
      command: reveal ? "reveal_file_asset" : "open_file_asset",
      input: {
        context: {
          instanceId: context.instanceId,
          selectionEpoch: context.selectionEpoch,
        },
        assetId,
      },
    });
  }
  async usages(context: FileContext) {
    const state = await this.check(context);
    const result: Record<string, FileUsage[]> = {};
    for (const task of Object.values(await this.bridge.listBoardTasks()).flat())
      await this.taskFiles(context, task.key);
    for (const [taskKey, rows] of Object.entries(state.links)) {
      const task = await this.bridge.getTask(taskKey);
      for (const row of rows) {
        const usages = result[row.asset.id] ?? [];
        result[row.asset.id] = usages;
        usages.push({
          key: taskKey,
          title: task.title,
          role: row.role,
          status: task.status,
        });
      }
    }
    return result;
  }
  async taskVersion(context: FileContext, taskKey: string) {
    return this.version(context, taskKey);
  }
}
export const mockTaskFiles = mockAdapter(() => currentMockBridge().taskFiles);
