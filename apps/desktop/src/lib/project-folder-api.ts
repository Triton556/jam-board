import { useCallback, useEffect, useRef } from "react";
import type {
  FolderCommandContext,
  MoveProject,
  MoveReceipt,
  NewJamInput,
  ProjectFolderInfo,
  ProjectMovePreview,
  RegistryEntry,
  Settings,
  SettingsPatch,
  SnapshotComparison,
} from "../bindings";
import { commands } from "../bindings";
import { api } from "./api";

export interface ProjectFolderApi {
  create(
    folder: string,
    name: string,
    acknowledged: boolean,
    initialization?: NewJamInput | null,
  ): Promise<ProjectFolderInfo>;
  open(
    folder: string,
    acknowledged: boolean,
    separateCopy?: boolean,
  ): Promise<ProjectFolderInfo>;
  info(): Promise<ProjectFolderInfo>;
  list(): Promise<RegistryEntry[]>;
  remove(instanceId: string): Promise<unknown>;
  locate(
    instanceId: string,
    expectedProjectId: string,
    folder: string,
    acknowledged: boolean,
  ): Promise<ProjectFolderInfo>;
  preview(projectId: string, destination: string): Promise<ProjectMovePreview>;
  selection(): Promise<FolderCommandContext | null>;
  readSettings(): Promise<Settings>;
  writeSettings(
    projectId: string,
    patch: Partial<SettingsPatch>,
    context: FolderCommandContext | null,
  ): Promise<Settings>;
  rules(
    context: FolderCommandContext,
    rules: Record<string, string>,
    revision: string,
  ): Promise<ProjectFolderInfo>;
  move(
    input: MoveProject,
    context?: FolderCommandContext | null,
  ): Promise<MoveReceipt>;
  status(id: string): Promise<MoveReceipt>;
  rollback(id: string): Promise<MoveReceipt>;
  recover(folder: string, acknowledged: boolean): Promise<ProjectFolderInfo>;
  save(context: FolderCommandContext): Promise<unknown>;
  compare(context: FolderCommandContext): Promise<SnapshotComparison>;
  keep(context: FolderCommandContext, hash: string): Promise<unknown>;
}
async function unwrap<T>(
  result: Promise<
    { status: "ok"; data: T } | { status: "error"; error: unknown }
  >,
): Promise<T> {
  const value = await result;
  if (value.status === "ok") return value.data;
  const error = value.error as { message?: string; code?: string };
  throw new Error(
    `${error.code ?? ""} ${error.message ?? JSON.stringify(error)}`.trim(),
  );
}
export const tauriProjectFolders: ProjectFolderApi = {
  create: (folder, name, ack, initialization = null) =>
    unwrap(commands.createProjectFolder(folder, name, ack, initialization)),
  open: (folder, ack, separate = false) =>
    unwrap(commands.openProjectFolder(folder, ack, separate)),
  info: () => api.projectFolderInfo(),
  list: () => api.listProjectFolders(),
  remove: (id) => unwrap(commands.removeRecentProjectFolder(id)),
  locate: (id, expected, folder, ack) =>
    unwrap(commands.locateProjectFolder(id, expected, folder, ack)),
  preview: (projectId, destination) =>
    unwrap(commands.previewProjectMove(projectId, destination)),
  selection: async () => {
    try {
      return await api.projectSelectionContext();
    } catch (error) {
      if (/not_found.*active project: create or select/i.test(String(error)))
        return null;
      throw error;
    }
  },
  readSettings: () => api.getSettings(),
  writeSettings: (projectId, patch, context) =>
    api.setSettings(
      {
        projectFolder: null,
        expectedProjectId: projectId,
        colorBy: null,
        estimatesEnabled: null,
        wipLimit: null,
        assetsView: null,
        collapsedAssetKinds: null,
        theme: null,
        soundEnabled: null,
        ...patch,
      },
      context ?? undefined,
    ),
  rules: (context, rules, revision) =>
    unwrap(commands.setProjectFolderRules(context, rules, revision)),
  move: (input, context = null) =>
    unwrap(commands.moveProjectToFolder(input, context)),
  status: (id) => unwrap(commands.projectOperationStatus(id)),
  rollback: (id) => unwrap(commands.rollbackProjectMove(id)),
  recover: (folder, ack) => unwrap(commands.recoverProjectFolder(folder, ack)),
  save: (context) => unwrap(commands.saveBoardSnapshot(context)),
  compare: (context) => unwrap(commands.compareBoardSnapshot(context)),
  keep: (context, hash) => unwrap(commands.keepLiveBoard(context, hash)),
};
export const projectFolders: ProjectFolderApi =
  import.meta.env.VITE_MOCK_BRIDGE === "1"
    ? (await import("./mock-project-folders")).mockProjectFolders
    : tauriProjectFolders;
export const folderContext = (
  info: ProjectFolderInfo,
): FolderCommandContext => ({ ...info.context });
const nameKey = "jamboard:folder-project-names";
export function rememberFolderProject(info: ProjectFolderInfo) {
  try {
    const names = JSON.parse(localStorage.getItem(nameKey) ?? "{}");
    names[info.projectId] = info.manifest.name;
    localStorage.setItem(nameKey, JSON.stringify(names));
  } catch {
    /* Optional display metadata must not block opening a board. */
  }
}
export function folderProjectName(projectId: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(nameKey) ?? "{}")[projectId];
  } catch {
    return undefined;
  }
}
export function folderError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/recoveryRequired|Local DB is absent/i.test(text))
    return "This board needs to be restored from board.json.";
  if (
    /does not match.*expected project ID|expectedProjectIdMismatch/i.test(text)
  )
    return "This folder belongs to a different project. Choose the original folder.";
  if (
    /receipt not found|query returned no rows|not_found.*operation/i.test(text)
  )
    return "No saved move was found. You can start over.";
  if (/unsupported.*manifest|newer.*version/i.test(text))
    return "This project needs a newer version of Jam Board.";
  if (
    /invalid.*manifest|jamboard.json.*invalid|jamboard.json.*not found/i.test(
      text,
    )
  )
    return "This folder does not contain a valid Jam Board project.";
  if (/cloud.*acknowledg|acknowledg.*cloud/i.test(text))
    return "Choose whether to use this cloud-synced folder.";
  return /stale.*epoch|selection.*changed|conflict/i.test(text)
    ? "Project changed — reopen. Your draft is retained."
    : text;
}
export function folderPolicy(path: string) {
  const remote = /^(\\\\(?!\?\\[A-Za-z]:)|\/\/)|^(smb|nfs):/i.test(path);
  const cloud = /onedrive|dropbox|google[ -]?drive|icloud/i.test(path);
  return { remote, cloud };
}
export type FolderGuard = ((
  expected?: FolderCommandContext | null,
) => Promise<void>) & { context: FolderCommandContext | null };
export function sameFolderContext(
  a: FolderCommandContext | null,
  b: FolderCommandContext | null,
) {
  return (
    a?.instanceId === b?.instanceId && a?.selectionEpoch === b?.selectionEpoch
  );
}
/** Capture native selection before scheduling; lifecycle results name the new selection. */
export function useFolderGuard() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return useCallback(async (): Promise<FolderGuard> => {
    const context = await projectFolders.selection();
    if (!alive.current)
      throw new Error("Project changed — reopen. Your draft is retained.");
    const check: FolderGuard = Object.assign(
      async (expected = context) => {
        const current = await projectFolders.selection();
        if (!alive.current || !sameFolderContext(current, expected))
          throw new Error("Project changed — reopen. Your draft is retained.");
      },
      { context },
    );
    return check;
  }, []);
}

export async function readFolderSettings(projectId: string) {
  const settings = await projectFolders.readSettings();
  if (settings.projectId !== projectId)
    throw new Error("Project changed — reopen");
  return settings;
}
export async function writeFolderSettings(
  projectId: string,
  patch: Partial<SettingsPatch>,
  context: FolderCommandContext | null,
) {
  if (!context) throw new Error("Project changed — reopen");
  return projectFolders.writeSettings(
    projectId,
    { ...patch, expectedProjectId: projectId },
    context,
  );
}

export async function selectProjectWithFolderContext(
  projectId: string,
  restore = false,
) {
  if (import.meta.env.VITE_MOCK_BRIDGE === "1")
    return (
      await import("./mock-project-folders")
    ).mockProjectFolders.selectLegacy(projectId, restore);
  return restore ? api.restoreProject(projectId) : api.selectProject(projectId);
}
