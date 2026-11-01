import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AssetRequestInput,
  AssetRevision,
  AssetUsage,
  DeleteAssetInput,
  FileAsset,
  FileAssetQuery,
  FilePreview,
  FileScope,
  LinkFileInput,
  RenameAssetInput,
  ReplaceAssetInput,
  UnlinkFileInput,
} from "../bindings";
import { commands } from "../bindings";
import { api } from "./api";
import { appQuery } from "./queries";
import {
  emptyFileQuery,
  type FileContext,
  taskFilesApi,
} from "./task-files-api";

export type { FileContext } from "./task-files-api";
export type Preview =
  | Exclude<FilePreview, { type: "media" }>
  | {
      type: "media";
      mediaKind: "image" | "audio" | "video";
      url: string;
      mime: string;
    };
export interface FileViewerApi {
  list(
    context: FileContext,
    query?: Partial<FileAssetQuery>,
  ): Promise<FileAsset[]>;
  preview(context: FileContext, assetId: string): Promise<Preview>;
  usage(context: FileContext, assetId: string): Promise<AssetUsage>;
  link(context: FileContext, input: LinkFileInput): Promise<unknown>;
  unlink(context: FileContext, input: UnlinkFileInput): Promise<unknown>;
  archive(
    context: FileContext,
    input: AssetRequestInput,
    archived: boolean,
  ): Promise<unknown>;
  delete(context: FileContext, input: DeleteAssetInput): Promise<unknown>;
  rename(context: FileContext, input: RenameAssetInput): Promise<unknown>;
  replace(context: FileContext, input: ReplaceAssetInput): Promise<unknown>;
  revisions(context: FileContext, assetId: string): Promise<AssetRevision[]>;
  revision(
    context: FileContext,
    assetId: string,
    revision: number,
    reveal: boolean,
  ): Promise<void>;
}
async function unwrap<T>(
  result: Promise<
    { status: "ok"; data: T } | { status: "error"; error: { message: string } }
  >,
): Promise<T> {
  const value = await result;
  if (value.status === "error")
    throw Object.assign(new Error(value.error.message), value.error);
  return value.data;
}
export const nativeFileViewerApi: FileViewerApi = {
  async list(context, query = {}) {
    const rows: FileAsset[] = [];
    let offset = Number(query.cursor ?? 0);
    for (;;) {
      const page = await unwrap(
        commands.listFileAssets(context, {
          ...emptyFileQuery,
          ...query,
          cursor: String(offset),
        }),
      );
      rows.push(...page);
      if (query.limit != null || page.length < 500) return rows;
      offset += page.length;
    }
  },
  async preview(context, assetId) {
    const preview = await unwrap(commands.previewFileAsset(context, assetId));
    return preview.type === "media"
      ? {
          type: "media",
          mediaKind: preview.mediaKind,
          url: convertFileSrc(preview.path),
          mime: preview.mime,
        }
      : preview;
  },
  usage: (context, id) => unwrap(commands.assetUsage(context, id)),
  link: (context, input) => unwrap(commands.linkFile(context, input)),
  unlink: (context, input) => unwrap(commands.unlinkFile(context, input)),
  archive: (context, input, archived) =>
    unwrap(
      archived
        ? commands.archiveAsset(context, input)
        : commands.unarchiveAsset(context, input),
    ),
  delete: (context, input) => unwrap(commands.deleteAsset(context, input)),
  rename: (context, input) => unwrap(commands.renameAsset(context, input)),
  replace: (context, input) => unwrap(commands.replaceAsset(context, input)),
  revisions: (context, id) => unwrap(commands.listAssetRevisions(context, id)),
  async revision(context, assetId, revision, reveal) {
    await invoke(reveal ? "reveal_asset_revision" : "open_asset_revision", {
      context,
      assetId,
      revision,
    });
  },
};
async function backend() {
  return api.fileViewer();
}
export const fileViewerApi: FileViewerApi = {
  list: async (c, q) => (await backend()).list(c, q),
  preview: async (c, id) => (await backend()).preview(c, id),
  usage: async (c, id) => (await backend()).usage(c, id),
  link: async (c, input) => (await backend()).link(c, input),
  unlink: async (c, input) => (await backend()).unlink(c, input),
  archive: async (c, input, archived) =>
    (await backend()).archive(c, input, archived),
  delete: async (c, input) => (await backend()).delete(c, input),
  rename: async (c, input) => (await backend()).rename(c, input),
  replace: async (c, input) => (await backend()).replace(c, input),
  revisions: async (c, id) => (await backend()).revisions(c, id),
  revision: async (c, id, rev, reveal) =>
    (await backend()).revision(c, id, rev, reveal),
};
export const fileCatalogQuery = (
  context: FileContext | undefined,
  query: Partial<FileAssetQuery> = {},
) =>
  queryOptions({
    queryKey: ["file-assets", "catalog-v2", context, query],
    enabled: !!context,
    queryFn: () =>
      context
        ? fileViewerApi.list(context, query)
        : Promise.reject(new Error("No file context")),
  });
export function useFileContext() {
  const app = useQuery(appQuery);
  const projectId = app.data?.jam?.id;
  return useQuery({
    queryKey: ["file-assets", "context", projectId],
    enabled: !!projectId,
    queryFn: () => taskFilesApi.capture(projectId ?? ""),
  });
}
export function useRefreshFiles() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["file-assets", "assets", "task", "epics", "stories", "planning"].map(
        (key) => client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}
/** Check the captured folder epoch again after a picker/read and before dispatch. */
export async function assertFileContext(context: FileContext) {
  const fresh = await taskFilesApi.capture(context.projectId);
  if (
    fresh.instanceId !== context.instanceId ||
    fresh.selectionEpoch !== context.selectionEpoch
  )
    throw new Error("The Files target changed. Reopen this dialog.");
}
export function scopeInput(scope: FileScope, assetId: string): LinkFileInput {
  return {
    scope,
    assetId,
    role: "document",
    requestId: crypto.randomUUID(),
    expectedUpdatedAt: null,
    expectedClaimGeneration: null,
  };
}
export function usageCount(usage: AssetUsage) {
  return (
    new Set([...usage.tasks.map((task) => task.key), ...usage.covers]).size +
    usage.scopes.length +
    usage.canvas.length +
    usage.components.length
  );
}
export const emptyUsage = (): AssetUsage => ({
  tasks: [],
  scopes: [],
  canvas: [],
  covers: [],
  components: [],
});
export const pickReplacement = async () => (await api.pickFiles())[0] ?? null;
