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
import { currentMockBridge, mockAdapter } from "./mock-adapter";
import type { ProjectFolderApi } from "./project-folder-api";

const rules = {
  sprite: "files/images",
  audio: "files/audio",
  model: "files/models",
  document: "files/docs",
  level: "files/other",
  font: "files/other",
  other: "files/other",
};
/** Synthetic local fixtures only. No filesystem or agent access. */
export class MockProjectFolders implements ProjectFolderApi {
  folders = new Map<string, ProjectFolderInfo>();
  receipts = new Map<string, MoveReceipt>();
  entries: RegistryEntry[] = [];
  selected: ProjectFolderInfo | null = null;
  epoch = 0;
  external: SnapshotComparison | null = null;
  bound = false;
  agentBound = false;
  interrupt = false;
  missingState = new Set<string>();
  legacyId: string | null = null;
  localSettings: Record<string, Partial<SettingsPatch>> = {};
  inventories = new Map<
    string,
    Pick<
      ProjectMovePreview,
      | "tasks"
      | "managedCopies"
      | "linkedFiles"
      | "missingFiles"
      | "missingFileCount"
    >
  >();
  destinationPolicies = new Map<
    string,
    ProjectMovePreview["destinationPolicy"]
  >();
  reset() {
    this.folders.clear();
    this.receipts.clear();
    this.entries = [];
    this.selected = null;
    this.legacyId = null;
    this.external = null;
    this.bound = false;
    this.agentBound = false;
    this.interrupt = false;
    this.missingState.clear();
    this.inventories.clear();
    this.destinationPolicies.clear();
    this.localSettings = {};
    this.epoch++;
    this.persist();
  }
  selectedProject(projectId: string | null) {
    const info = [...this.folders.values()].find(
      (row) => row.projectId === projectId,
    );
    this.epoch++;
    this.selected = info
      ? {
          ...info,
          selectionEpoch: this.epoch,
          context: { instanceId: info.instanceId, selectionEpoch: this.epoch },
        }
      : null;
    this.legacyId = info ? null : projectId;
    this.persist();
  }
  renamed(projectId: string, name: string) {
    for (const info of this.folders.values())
      if (info.projectId === projectId) info.manifest.name = name;
    if (this.selected?.projectId === projectId)
      this.selected.manifest.name = name;
    for (const entry of this.entries)
      if (entry.projectId === projectId) entry.projectName = name;
    this.persist();
  }
  constructor(private bridge: import("./mock-bridge").MockBridge) {
    if (import.meta.env.VITE_MOCK_BRIDGE !== "1") return;
    try {
      const saved = JSON.parse(
        localStorage.getItem("jamboard:mock-folders") ?? "null",
      );
      if (saved) {
        this.folders = new Map(saved.folders);
        this.receipts = new Map(saved.receipts);
        this.entries = saved.entries;
        this.selected = saved.selected;
        this.epoch = saved.epoch;
        this.legacyId = saved.legacyId ?? null;
        this.localSettings = saved.localSettings ?? {};
        for (const info of this.folders.values()) {
          info.context ??= {
            instanceId: info.instanceId,
            selectionEpoch: info.selectionEpoch,
          };
          info.lastSnapshotAt ??= null;
        }
        if (this.selected) {
          this.selected.context ??= {
            instanceId: this.selected.instanceId,
            selectionEpoch: this.selected.selectionEpoch,
          };
          this.selected.lastSnapshotAt ??= null;
        }
      }
    } catch {
      /* An invalid synthetic fixture does not become a project. */
    }
  }
  private persist() {
    if (import.meta.env.VITE_MOCK_BRIDGE === "1")
      localStorage.setItem(
        "jamboard:mock-folders",
        JSON.stringify({
          folders: [...this.folders],
          receipts: [...this.receipts],
          entries: this.entries,
          selected: this.selected,
          epoch: this.epoch,
          legacyId: this.legacyId,
          localSettings: this.localSettings,
        }),
      );
  }
  private validate(folder: string, ack: boolean) {
    if (/^(\\\\(?!\?\\[A-Za-z]:)|\/\/)/.test(folder))
      throw new Error(
        "Remote / UNC folders are refused. Choose a local folder; SQLite needs local locking.",
      );
    if (/onedrive|dropbox|google[ -]?drive|icloud/i.test(folder) && !ack)
      throw new Error("Cloud acknowledgement required");
  }
  async selection(): Promise<FolderCommandContext | null> {
    const id = this.bridge.currentProjectId;
    if (id && id === this.selected?.projectId)
      return {
        instanceId: this.selected.instanceId,
        selectionEpoch: this.epoch,
      };
    if (this.legacyId !== id || this.selected) {
      this.epoch++;
      this.legacyId = id;
      this.selected = null;
      this.persist();
    }
    return id
      ? { instanceId: `mock-legacy:${id}`, selectionEpoch: this.epoch }
      : null;
  }
  async selectLegacy(projectId: string, restore = false) {
    const result = await (restore
      ? this.bridge.restoreProject(projectId)
      : this.bridge.selectProject(projectId));
    return result;
  }
  private async expect(context: FolderCommandContext | null) {
    const current = await this.selection();
    if (
      context &&
      (context.instanceId !== current?.instanceId ||
        context.selectionEpoch !== current.selectionEpoch)
    )
      throw new Error("Stale selection epoch");
  }
  private async check(context: FolderCommandContext) {
    await this.expect(context);
    if (!this.selected) throw new Error("No folder project selected");
    return this.selected;
  }
  private async select(info: ProjectFolderInfo) {
    await this.bridge.selectProject(info.projectId);
    const context = {
      instanceId: info.instanceId,
      selectionEpoch: ++this.epoch,
    };
    this.selected = { ...info, selectionEpoch: this.epoch, context };
    this.legacyId = null;
    this.folders.set(info.folder, this.selected);
    for (const entry of this.entries)
      if (entry.instanceId === info.instanceId) {
        entry.projectName = info.manifest.name;
        entry.lastOpenedAt = new Date().toISOString();
        entry.availability = "available";
      }
    this.persist();
    return this.selected;
  }
  async create(
    folder: string,
    name: string,
    ack: boolean,
    initialization?: NewJamInput | null,
  ) {
    this.validate(folder, ack);
    if (this.folders.has(folder) || /nonempty/i.test(folder))
      throw new Error(
        "Destination is not empty. Choose an empty folder; existing files will not be overwritten.",
      );
    if (initialization && initialization.name !== name)
      throw new Error("Initialization name must match the project name");
    if (
      initialization?.milestoneAt &&
      Number.isNaN(Date.parse(initialization.milestoneAt))
    )
      throw new Error("Choose a valid milestone");
    const state = await this.bridge.createJam(
      initialization ?? {
        name,
        yourName: "Human",
        template: "custom",
        theme: null,
        startsAt: "",
        endsAt: "",
        timezone: "UTC",
      },
    );
    const id = state.jam?.id ?? crypto.randomUUID();
    return this.register(folder, name, id);
  }
  private register(folder: string, name: string, id: string) {
    const info: ProjectFolderInfo = {
      instanceId: crypto.randomUUID(),
      projectId: id,
      folder,
      selectionEpoch: ++this.epoch,
      databaseGeneration: crypto.randomUUID(),
      manifestRevision: "1",
      sqliteVersion: "mock",
      context: { instanceId: "", selectionEpoch: this.epoch },
      lastSnapshotAt: new Date().toISOString(),
      manifest: {
        schemaVersion: 1,
        id,
        name,
        folderRules: { ...rules },
        repository: null,
      },
    };
    info.context = {
      instanceId: info.instanceId,
      selectionEpoch: info.selectionEpoch,
    };
    this.folders.set(folder, info);
    this.entries.push({
      instanceId: info.instanceId,
      projectId: id,
      projectName: name,
      canonicalFolder: folder,
      displayFolder: folder,
      availability: "available",
      repoCommonDir: null,
      lastOpenedAt: new Date().toISOString(),
      migrationId: null,
    });
    this.selected = info;
    this.legacyId = null;
    this.bridge.saveFolderSnapshot(id);
    this.persist();
    return info;
  }
  async open(folder: string, ack: boolean, separate = false) {
    this.validate(folder, ack);
    const info = this.folders.get(folder);
    if (!info)
      throw new Error(
        /newer/i.test(folder)
          ? "Unsupported manifest version; writable open refused"
          : "Invalid project: jamboard.json was not found or is invalid",
      );
    if (this.missingState.has(folder))
      throw new Error(
        "recoveryRequired: Local DB is absent; explicitly recover from board.json",
      );
    const registered = this.entries.find(
      (e) => e.projectId === info.projectId && e.canonicalFolder !== folder,
    );
    if (registered && !separate)
      throw new Error(
        `duplicateProjectId: Open registered board at ${registered.canonicalFolder} or explicitly open as a separate copy`,
      );
    if (separate) return this.createCopy(info, ack);
    if (!this.entries.some((entry) => entry.instanceId === info.instanceId))
      this.entries.push({
        instanceId: info.instanceId,
        projectId: info.projectId,
        projectName: info.manifest.name,
        canonicalFolder: folder,
        displayFolder: folder,
        repoCommonDir: null,
        lastOpenedAt: new Date().toISOString(),
        availability: "available",
        migrationId: null,
      });
    return this.select(info);
  }
  private async createCopy(info: ProjectFolderInfo, ack: boolean) {
    this.validate(info.folder, ack);
    await this.bridge.selectProject(info.projectId);
    const exported = await this.bridge.exportJamJson();
    await this.bridge.importJamJson(exported.path);
    const id = (await this.bridge.appState()).jam?.id;
    if (!id) throw new Error("Separate copy fixture has no project identity");
    return this.register(info.folder, info.manifest.name, id);
  }
  async info() {
    if (!this.selected) throw new Error("No folder project selected");
    if (this.missingState.has(this.selected.folder))
      throw new Error(
        "recoveryRequired: Local DB is absent; explicitly recover from board.json",
      );
    if ((await this.bridge.appState()).jam?.id !== this.selected.projectId)
      throw new Error("No folder project selected for this board");
    return this.selected;
  }
  async list() {
    return structuredClone(this.entries);
  }
  async remove(instanceId: string) {
    if ((await this.selection())?.instanceId === instanceId)
      throw new Error(
        "The selected project cannot be removed from recent folders",
      );
    if (!this.entries.some((entry) => entry.instanceId === instanceId))
      throw new Error("Recent folder not found");
    this.entries = this.entries.filter(
      (entry) => entry.instanceId !== instanceId,
    );
    this.persist();
  }
  async locate(
    instanceId: string,
    expectedProjectId: string,
    folder: string,
    ack: boolean,
  ) {
    const entry = this.entries.find((entry) => entry.instanceId === instanceId);
    const info = this.folders.get(folder);
    if (!entry) throw new Error("Recent folder not found");
    if (
      entry.projectId !== expectedProjectId ||
      info?.manifest.id !== expectedProjectId
    )
      throw new Error(
        "The selected folder does not match the expected project ID",
      );
    this.validate(folder, ack);
    const duplicate = this.entries.some(
      (entry) =>
        entry.instanceId !== instanceId &&
        entry.projectId === expectedProjectId &&
        entry.canonicalFolder !== folder,
    );
    if (duplicate)
      throw new Error("Another board with this project ID is registered");
    const result = await this.select({ ...info, instanceId });
    this.entries = this.entries.map((entry) =>
      entry.instanceId === instanceId
        ? {
            ...entry,
            projectName: info.manifest.name,
            canonicalFolder: folder,
            displayFolder: folder,
            availability: "available",
          }
        : entry,
    );
    this.persist();
    return result;
  }
  async preview(
    projectId: string,
    destination: string,
  ): Promise<ProjectMovePreview> {
    const project = (await this.bridge.listProjects(true)).find(
      (project) => project.id === projectId,
    );
    if (!project) throw new Error("Project not found");
    const inventory =
      this.inventories.get(projectId) ?? this.bridge.moveInventory(projectId);
    const remote = /^(\\\\(?!\?\\[A-Za-z]:)|\/\/)|^(smb|nfs):/i.test(
      destination,
    );
    const cloud = /onedrive|dropbox|google[ -]?drive|icloud/i.test(destination);
    const nonEmpty =
      this.folders.has(destination) || /nonempty/i.test(destination);
    const exists = nonEmpty || /existing-empty/i.test(destination);
    return structuredClone({
      ...inventory,
      missingFiles: inventory.missingFiles.slice(0, 100),
      agentSessionBound:
        this.agentBound || this.bridge.hasActiveSessions(projectId),
      hasBoundOwners:
        this.bound ||
        this.agentBound ||
        this.bridge.hasActiveSessions(projectId),
      destinationPolicy: this.destinationPolicies.get(destination) ?? {
        allowed: !remote && !exists && !!destination,
        cloudAcknowledgementNeeded: cloud,
        nonEmpty,
        errorField: remote || exists || !destination ? "destination" : null,
        message: remote
          ? "Remote / UNC folders are refused. Choose a local drive."
          : exists
            ? "Move requires a destination that does not exist yet."
            : !destination
              ? "Choose a destination."
              : null,
      },
    });
  }
  async readSettings(): Promise<Settings> {
    const settings = await this.bridge.getSettings();
    return settings;
  }
  async writeSettings(
    projectId: string,
    patch: Partial<SettingsPatch>,
    context: FolderCommandContext | null,
  ) {
    await this.expect(context);
    if (
      (await this.bridge.appState()).jam?.id !== projectId ||
      patch.expectedProjectId !== projectId
    )
      throw new Error("Stale selection epoch");
    // No await between the final expectation and this synthetic write.
    await this.expect(context);
    return this.bridge.setSettings(patch);
  }
  async rules(
    context: { instanceId: string; selectionEpoch: number },
    next: Record<string, string>,
    revision: string,
  ) {
    const info = await this.check(context);
    if (revision !== info.manifestRevision)
      throw new Error("Manifest revision stale. Reload folder rules.");
    if (
      Object.values(next).some(
        (v) => !v.startsWith("files/") || v.includes(".."),
      )
    )
      throw new Error("Folder rules must stay below files/");
    const updated = {
      ...info,
      manifestRevision: String(Number(revision) + 1),
      manifest: { ...info.manifest, folderRules: next },
    };
    this.selected = updated;
    this.folders.set(info.folder, updated);
    this.persist();
    return updated;
  }
  async move(input: MoveProject, context: FolderCommandContext | null = null) {
    await this.expect(context);
    if (context && (await this.bridge.appState()).jam?.id !== input.projectId)
      throw new Error("Stale selection epoch");
    const preview = await this.preview(input.projectId, input.destination);
    await this.expect(context);
    if (
      !preview.destinationPolicy.allowed &&
      !this.receipts.has(input.requestId)
    )
      throw new Error(
        preview.destinationPolicy.message ?? "Destination refused",
      );
    this.validate(input.destination, input.cloudAcknowledged);
    if (
      this.bound ||
      this.agentBound ||
      this.bridge.hasActiveSessions(input.projectId)
    )
      throw new Error(
        "Disconnect all agent sessions and MCP connections before moving this project. Stop sessions in Agents and disconnect external MCP clients.",
      );
    const old = this.receipts.get(input.requestId);
    if (
      old &&
      (old.projectId !== input.projectId ||
        old.destination !== input.destination)
    )
      throw new Error(
        "Move request ID was already used for another destination",
      );
    if (old?.state === "committed") return old;
    if (old?.state === "rolled_back")
      throw new Error("Operation was rolled back. Choose a new destination.");
    const receipt: MoveReceipt = {
      id: input.requestId,
      projectId: input.projectId,
      state: this.interrupt ? "copied" : "committed",
      destination: input.destination,
      staging: `${input.destination}.staging`,
      sourceBackup: "fixture/pre-move.db",
      sourceDigest: "fixture-hash",
      destinationDigest: "fixture-hash",
      tableCounts: {
        tasks:
          (await this.bridge.listProjects(true)).find(
            (p) => p.id === input.projectId,
          )?.taskCount ?? 0,
      },
      fileHashes: {},
      byteTotal: preview.managedCopies.bytes,
      unresolvedLinks: preview.missingFiles,
      error: this.interrupt
        ? "Interrupted. The source remains available."
        : null,
    };
    this.receipts.set(input.requestId, receipt);
    this.persist();
    if (receipt.state === "committed") {
      const source = (await this.bridge.listProjects(true)).find(
        (p) => p.id === input.projectId,
      );
      const info: ProjectFolderInfo = {
        instanceId: crypto.randomUUID(),
        projectId: input.projectId,
        folder: input.destination,
        selectionEpoch: ++this.epoch,
        databaseGeneration: crypto.randomUUID(),
        manifestRevision: "1",
        sqliteVersion: "mock",
        context: { instanceId: "", selectionEpoch: this.epoch },
        lastSnapshotAt: new Date().toISOString(),
        manifest: {
          schemaVersion: 1,
          id: input.projectId,
          name: source?.name ?? "Moved project",
          folderRules: { ...rules },
          repository: null,
        },
      };
      info.context = {
        instanceId: info.instanceId,
        selectionEpoch: info.selectionEpoch,
      };
      this.folders.set(input.destination, info);
      this.entries.push({
        instanceId: info.instanceId,
        projectId: input.projectId,
        projectName: source?.name ?? "Moved project",
        canonicalFolder: input.destination,
        displayFolder: input.destination,
        availability: "available",
        repoCommonDir: null,
        lastOpenedAt: new Date().toISOString(),
        migrationId: input.requestId,
      });
      // Native cutover keeps the source readonly. Mock UI derives that label
      // from migrationId; no shared MockBridge internals are mutated here.
      await this.select(info);
    }
    return receipt;
  }
  async status(id: string) {
    const receipt = this.receipts.get(id);
    if (!receipt) throw new Error("Operation receipt not found");
    return receipt;
  }
  async rollback(id: string) {
    const receipt = await this.status(id);
    if (receipt.state === "committed")
      throw new Error("Committed moves cannot be rolled back");
    const result = { ...receipt, state: "rolled_back", error: null };
    this.receipts.set(id, result);
    this.persist();
    return result;
  }
  async recover(folder: string, ack: boolean) {
    this.validate(folder, ack);
    const info = this.folders.get(folder);
    if (
      this.bound ||
      this.agentBound ||
      this.bridge.hasActiveSessions(info?.projectId ?? "")
    )
      throw new Error("Disconnect agents and MCP before restoring");
    if (!info) throw new Error("Recovery manifest is invalid");
    this.external = null;
    this.missingState.delete(folder);
    const result = await this.select({
      ...info,
      databaseGeneration: crypto.randomUUID(),
    });
    this.bridge.restoreFolderSnapshot(info.projectId);
    return result;
  }
  async save(context: { instanceId: string; selectionEpoch: number }) {
    const info = await this.check(context);
    this.bridge.saveFolderSnapshot(info.projectId);
    this.selected = { ...info, lastSnapshotAt: new Date().toISOString() };
    this.folders.set(info.folder, this.selected);
    this.persist();
  }
  async compare(context: {
    instanceId: string;
    selectionEpoch: number;
  }): Promise<SnapshotComparison> {
    await this.check(context);
    return (
      this.external ?? {
        liveHash: "same",
        externalHash: "same",
        liveRevision: 1,
        externalRevision: 1,
        externalValid: true,
        changedTables: [],
        error: null,
      }
    );
  }
  async keep(
    context: { instanceId: string; selectionEpoch: number },
    hash: string,
  ) {
    await this.check(context);
    if (hash !== (this.external?.externalHash ?? "same"))
      throw new Error("Snapshot changed again. Compare again.");
    this.external = null;
    if (this.selected) this.bridge.saveFolderSnapshot(this.selected.projectId);
  }
}
export const mockProjectFolders = mockAdapter(
  () => currentMockBridge().folders,
);
