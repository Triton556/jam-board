import type {
  AssetRevision,
  AssetUsage,
  FileAsset,
  FileAssetQuery,
  FileScope,
} from "../bindings";
import { assetKind } from "../features/assets/model";
import {
  audioFixture,
  imageFixture,
  textFixture,
  videoFixture,
} from "../features/files/mock-preview-fixtures";
import { api } from "./api";
import type { FileViewerApi, Preview } from "./file-viewer-api";
import { emptyUsage, usageCount } from "./file-viewer-api";
import { currentMockBridge, mockAdapter } from "./mock-adapter";
import type { MockBridge } from "./mock-bridge";
import { type FileContext, taskFilesApi } from "./task-files-api";

const textExtensions = [
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "log",
  "yaml",
  "yml",
  "toml",
];
function fixtureMetadata(asset: FileAsset): FileAsset {
  if (asset.storageType !== "board_file") return asset;
  const ext = asset.storedPath.split(".").at(-1)?.toLowerCase();
  const media =
    asset.kind === "sprite"
      ? imageFixture
      : asset.kind === "audio"
        ? audioFixture
        : asset.kind === "video"
          ? videoFixture
          : undefined;
  const byteSize = textExtensions.includes(ext ?? "")
    ? new TextEncoder().encode(textFixture).byteLength
    : media
      ? atob(media.slice(media.indexOf(",") + 1)).length
      : undefined;
  if (byteSize == null) return asset;
  return {
    ...asset,
    byteSize: asset.byteSize ?? byteSize,
    modifiedAt: asset.modifiedAt ?? "2026-10-31T08:00:00Z",
  };
}

type State = {
  overrides: Map<string, FileAsset>;
  deleted: Set<string>;
  scopes: { scope: FileScope; assetId: string }[];
  revisions: Map<string, AssetRevision[]>;
  receipts: Map<string, { payload: string; result: unknown }>;
  removedCanvas: Set<string>;
};
/** Separate round-12 state. Integration can fold this into the shared mock bridge. */
export class MockFilesV2 implements FileViewerApi {
  private projects = new Map<string, State>();
  constructor(private bridge?: MockBridge) {}
  private get host() {
    return this.bridge ?? api;
  }
  private get files() {
    return this.bridge?.taskFiles ?? taskFilesApi;
  }
  calls: { command: string; assetId: string; revision?: number }[] = [];
  readonly trash = new Map<string, string>();
  reset() {
    if (this.bridge) this.bridge.round12.files = null;
    this.projects.clear();
    this.calls = [];
    this.trash.clear();
  }
  private async state(context: FileContext) {
    const fresh = await this.files.capture(context.projectId);
    if (
      fresh.instanceId !== context.instanceId ||
      fresh.selectionEpoch !== context.selectionEpoch
    )
      throw new Error("The Files target changed.");
    let state = this.bridge
      ? (this.bridge.round12.files as State | null)
      : this.projects.get(context.projectId);
    if (!state) {
      state = {
        overrides: new Map(),
        deleted: new Set(),
        scopes: [],
        revisions: new Map(),
        receipts: new Map(),
        removedCanvas: new Set(),
      };
      if (this.bridge) this.bridge.round12.files = state;
      else this.projects.set(context.projectId, state);
    }
    return state;
  }
  private async all(context: FileContext) {
    const state = await this.state(context);
    const rows = new Map(
      (await this.files.list(context, { includeArchived: true })).map((a) => [
        a.id,
        a,
      ]),
    );
    for (const [id, asset] of state.overrides) rows.set(id, asset);
    return [...rows.values()]
      .filter((a) => !state.deleted.has(a.id))
      .map(fixtureMetadata);
  }
  private async asset(context: FileContext, id: string) {
    const asset = (await this.all(context)).find((a) => a.id === id);
    if (!asset) throw new Error("File not found");
    return structuredClone(asset);
  }
  private async write(
    context: FileContext,
    command: string,
    input: { assetId: string; requestId: string | null },
    run: (state: State) => Promise<unknown>,
  ) {
    const state = await this.state(context),
      payload = JSON.stringify([command, { ...input, requestId: null }]);
    const receipt = input.requestId
      ? state.receipts.get(`${command}:${input.requestId}`)
      : undefined;
    if (receipt) {
      if (receipt.payload !== payload)
        throw Object.assign(
          new Error("requestId already used for another payload"),
          { code: "idempotency_conflict" },
        );
      return receipt.result;
    }
    const result = await run(state);
    this.calls.push({ command, assetId: input.assetId });
    if (input.requestId)
      state.receipts.set(`${command}:${input.requestId}`, { payload, result });
    this.bridge?.applyFileState(state);
    return result;
  }
  async list(context: FileContext, query: Partial<FileAssetQuery> = {}) {
    const rows: FileAsset[] = [];
    for (const asset of await this.all(context)) {
      const usage = await this.usage(context, asset.id);
      if (
        (!query.includeArchived && asset.archivedAt) ||
        (query.kind && asset.kind !== query.kind) ||
        (query.storageType && asset.storageType !== query.storageType) ||
        (query.query &&
          !`${asset.name} ${asset.storedPath}`
            .toLowerCase()
            .includes(query.query.toLowerCase()))
      )
        continue;
      if (
        query.scope &&
        !(query.scope.type === "task"
          ? usage.tasks.some(
              (t) => !query.scope?.key || t.key === query.scope.key,
            )
          : usage.scopes.some(
              (s) =>
                s.type === query.scope?.type &&
                (!query.scope.key || s.key === query.scope.key),
            ))
      )
        continue;
      rows.push({ ...asset, usageCount: usageCount(usage) });
    }
    const offset = Number(query.cursor ?? 0);
    return rows.slice(
      offset,
      query.limit == null ? undefined : offset + query.limit,
    );
  }
  async usage(context: FileContext, id: string): Promise<AssetUsage> {
    const state = await this.state(context),
      usage = emptyUsage();
    if (state.deleted.has(id)) return usage;
    const tasks = await this.files.usages(context);
    usage.tasks = (tasks[id] ?? []).map((t) => ({
      key: t.key,
      title: t.title,
      role: t.role,
    }));
    usage.scopes = await Promise.all(
      state.scopes
        .filter((s) => s.assetId === id)
        .map(async (s) => ({
          type: s.scope.type,
          key: s.scope.key,
          title:
            s.scope.type === "project"
              ? "Project documents"
              : s.scope.type === "epic"
                ? (await this.host.getEpic(s.scope.key ?? "")).epic.title
                : (await this.host.getStory(s.scope.key ?? "")).story.title,
          role: "document",
        })),
    );
    const canvas = await this.host.referenceCanvas();
    usage.canvas = canvas.items
      .filter(
        (item) =>
          item.assetId === id &&
          !item.archivedAt &&
          !state.removedCanvas.has(item.id),
      )
      .map((item) => ({
        itemId: item.id,
        frameTitle:
          canvas.frames.find((frame) => frame.id === item.frameId)?.title ??
          null,
      }));
    return usage;
  }
  async preview(context: FileContext, id: string): Promise<Preview> {
    const a = await this.asset(context, id);
    if (["missing", "unreadable"].includes(a.resolution.status))
      throw Object.assign(new Error(`File is ${a.resolution.status}`), {
        code: a.resolution.status,
      });
    if (a.storageType === "url") return { type: "url", url: a.location };
    const ext = a.storedPath.split(".").at(-1)?.toLowerCase();
    if (textExtensions.includes(ext ?? ""))
      return {
        type: "text",
        text: textFixture,
        mime:
          ext === "md" || ext === "markdown" ? "text/markdown" : "text/plain",
        truncated: false,
      };
    if (["sprite", "audio", "video"].includes(a.kind)) {
      const mediaKind =
        a.kind === "sprite" ? "image" : (a.kind as "audio" | "video");
      const url =
        mediaKind === "image"
          ? imageFixture
          : mediaKind === "audio"
            ? audioFixture
            : videoFixture;
      return {
        type: "media",
        mediaKind,
        url,
        mime: `${mediaKind}/${mediaKind === "image" ? "png" : mediaKind === "audio" ? "wav" : "webm"}`,
      };
    }
    return {
      type: "metadata",
      name: a.name,
      kind: a.kind,
      byteSize: a.byteSize,
      modifiedAt: a.modifiedAt ?? null,
      path: a.storedPath,
      storageType: a.storageType,
    };
  }
  link: FileViewerApi["link"] = (c, input) =>
    this.write(c, "link_file", input, async (s) => {
      await this.asset(c, input.assetId);
      if (input.scope.type === "task") {
        if (
          !input.scope.key ||
          !input.expectedUpdatedAt ||
          input.expectedClaimGeneration == null
        )
          throw new Error("Task validators required");
        if (input.role === "document")
          throw new Error("Task role must be to_edit, reference or result");
        return this.files.link(c, {
          taskKey: input.scope.key,
          assetId: input.assetId,
          role: input.role ?? "reference",
          requestId: input.requestId ?? crypto.randomUUID(),
          expectedUpdatedAt: input.expectedUpdatedAt,
          expectedClaimGeneration: input.expectedClaimGeneration,
          position: null,
        });
      }
      if (
        !s.scopes.some(
          (row) =>
            row.assetId === input.assetId &&
            JSON.stringify(row.scope) === JSON.stringify(input.scope),
        )
      )
        s.scopes.push({ scope: input.scope, assetId: input.assetId });
      return null;
    });
  unlink: FileViewerApi["unlink"] = (c, input) =>
    this.write(c, "unlink_file", input, async (s) => {
      if (input.scope.type === "task") {
        if (
          !input.scope.key ||
          !input.expectedUpdatedAt ||
          input.expectedClaimGeneration == null
        )
          throw new Error("Task validators required");
        return this.files.unlink(c, {
          taskKey: input.scope.key,
          assetId: input.assetId,
          role: null,
          requestId: input.requestId ?? crypto.randomUUID(),
          expectedUpdatedAt: input.expectedUpdatedAt,
          expectedClaimGeneration: input.expectedClaimGeneration,
          position: null,
        });
      }
      s.scopes = s.scopes.filter(
        (row) =>
          !(
            row.assetId === input.assetId &&
            JSON.stringify(row.scope) === JSON.stringify(input.scope)
          ),
      );
      return null;
    });
  archive: FileViewerApi["archive"] = (c, input, archived) =>
    this.write(
      c,
      archived ? "archive_asset" : "unarchive_asset",
      input,
      async (s) => {
        const a = await this.asset(c, input.assetId);
        s.overrides.set(a.id, {
          ...a,
          archivedAt: archived ? new Date().toISOString() : null,
        });
        return null;
      },
    );
  rename: FileViewerApi["rename"] = (c, input) =>
    this.write(c, "rename_asset", input, async (s) => {
      if (!input.name.trim() || input.name.length > 140)
        throw new Error("Use a name of 1–140 characters");
      const a = await this.asset(c, input.assetId);
      s.overrides.set(a.id, { ...a, name: input.name.trim() });
      return null;
    });
  delete: FileViewerApi["delete"] = (c, input) =>
    this.write(c, "delete_asset", input, async (s) => {
      const asset = await this.asset(c, input.assetId);
      const usage = await this.usage(c, input.assetId);
      if (usageCount(usage) && !input.force)
        throw Object.assign(new Error("File is in use"), {
          code: "in_use",
          data: usage,
        });
      for (const task of usage.tasks) {
        const version = await this.files.version(c, task.key);
        await this.files.unlink(c, {
          taskKey: task.key,
          assetId: input.assetId,
          role: null,
          requestId: crypto.randomUUID(),
          expectedUpdatedAt: version.updatedAt,
          expectedClaimGeneration: version.claimGeneration,
          position: null,
        });
      }
      s.scopes = s.scopes.filter((row) => row.assetId !== input.assetId);
      for (const row of usage.canvas) s.removedCanvas.add(row.itemId);
      if (asset.storageType === "board_file")
        this.trash.set(
          `${c.projectId}:${asset.id}`,
          `.state/trash/${new Date().toISOString().slice(0, 10).replaceAll("-", "")}/${asset.id}-${asset.originalName}`,
        );
      s.deleted.add(input.assetId);
      return null;
    });
  replace: FileViewerApi["replace"] = (c, input) =>
    this.write(c, "replace_asset", input, async (s) => {
      const a = await this.asset(c, input.assetId),
        source = input.sourcePath ?? input.url;
      if (
        !source ||
        (a.storageType === "url" && !/^https?:\/\/[^\s]+$/i.test(source))
      )
        throw new Error("Choose a readable file or an http(s) URL");
      if (a.storageType === "board_file")
        s.revisions.set(a.id, [
          {
            assetId: a.id,
            revision: a.contentRevision,
            storedPath: `.state/revisions/${a.id}/${a.contentRevision}.${a.storedPath.split(".").at(-1)}`,
            byteSize: a.byteSize,
            contentHash: a.contentHash,
            mimeType: a.mimeType,
            createdBy: "human",
            createdAt: new Date().toISOString(),
          },
          ...(s.revisions.get(a.id) ?? []),
        ]);
      const path = a.storageType === "board_file" ? a.storedPath : source;
      s.overrides.set(a.id, {
        ...a,
        storedPath: path,
        location: path,
        kind: assetKind(source),
        contentRevision: a.contentRevision + 1,
        modifiedAt: new Date().toISOString(),
        resolution: {
          ...a.resolution,
          storedPath: path,
          resolvedPath: path,
          status: "available",
        },
      });
      return null;
    });
  async revisions(c: FileContext, id: string) {
    return structuredClone((await this.state(c)).revisions.get(id) ?? []);
  }
  async revision(
    c: FileContext,
    id: string,
    revision: number,
    reveal: boolean,
  ) {
    if (!(await this.revisions(c, id)).some((r) => r.revision === revision))
      throw new Error("Revision not found");
    this.calls.push({
      command: reveal ? "reveal_asset_revision" : "open_asset_revision",
      assetId: id,
      revision,
    });
  }
}
const instances = new WeakMap<MockBridge, MockFilesV2>();
export function mockFilesFor(bridge: MockBridge) {
  let instance = instances.get(bridge);
  if (!instance) {
    instance = new MockFilesV2(bridge);
    instances.set(bridge, instance);
  }
  return instance;
}
export const mockFilesV2 = mockAdapter(() => mockFilesFor(currentMockBridge()));
