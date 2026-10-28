import type { AskUser, Scope, SubmitReport } from "../bindings";
import { assetKind, assetName } from "../features/assets/model";
import type { JamApi, LinkedFrame, ReferenceVerdict, VerdictItem } from "./api";
import fixture from "./demo-fixture.json";
import { makeSnippets } from "./mcp-config";
import {
  emptyExecution,
  MockExecution,
  type MockExecutionData,
} from "./mock-execution";
import {
  MockPlanning,
  mockReadiness,
  type PlanData,
  validateBrief,
} from "./mock-planning";
import { emptyCanvas, MockReferences } from "./mock-references";
import type { ProjectSummary } from "./project-api";
import { tagSuggestions, templateInfo } from "./project-template";
import type { ReferenceInput } from "./references-api";
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
  CreateInput,
  McpStatus,
  Member,
  MemberEdit,
  MoveInput,
  NewAsset,
  NewJamInput,
  NewMember,
  Settings,
  SettingsPatch,
  Status,
  TaskDetail,
  TaskQuery,
  Theme,
  UpdateInput,
} from "./types";
import { emptyBoard, JamError, statuses } from "./types";
export type AgentSimulation = {
  action:
    | "task.created"
    | "task.moved"
    | "task.claimed"
    | "comment.added"
    | "task.updated"
    | "task.brief_updated"
    | "agent.status"
    | "report.submitted"
    | "question.asked"
    | "reference.added"
    | "execution.requested";
  reference?: ReferenceInput;
  scope?: Scope;
  text?: string;
  question?: AskUser;
  report?: SubmitReport;
  key?: string;
  title?: string;
  status?: Status;
  agent?: string;
  lastSeenAt?: string;
  statusAt?: string;
  patch?: Omit<UpdateInput, "key" | "expectedUpdatedAt">;
};
const clone = <T>(value: T): T => structuredClone(value);
type MockProjectSnapshot = {
  state: AppState;
  tasks: TaskDetail[];
  planData: PlanData;
  executionData: MockExecutionData;
  members: Member[];
  assets: Asset[];
  activity: ActivityEvent[];
  canvasData: import("../bindings").ReferenceCanvas;
  canvasViewportValue: string | null;
  archived: boolean;
};
export class MockBridge implements JamApi {
  private projects: Record<string, MockProjectSnapshot> = {};
  private snapshot(archived = false): MockProjectSnapshot {
    return clone({
      state: this.state,
      tasks: this.tasks,
      planData: this.planData,
      executionData: this.executionData,
      members: this.members,
      assets: this.assets,
      activity: this.activity,
      canvasData: this.canvasData,
      canvasViewportValue: this.canvasViewportValue,
      archived,
    });
  }
  private stashProject(archived = false) {
    if (this.state.jam)
      this.projects[this.state.jam.id] = this.snapshot(archived);
  }
  private openProject(project: MockProjectSnapshot) {
    const theme = this.state.theme;
    const { archived: _archived, ...data } = clone(project);
    Object.assign(this, data);
    this.executionData = data.executionData ?? emptyExecution();
    this.state.theme = theme;
    this.state.hasJam = true;
    if (this.state.jam) delete this.projects[this.state.jam.id];
    this.checkpoint();
  }
  private nextProjectPrefix() {
    const used = new Set([
      this.state.jam?.keyPrefix,
      ...Object.values(this.projects).map((p) => p.state.jam?.keyPrefix),
    ]);
    let suffix = 1;
    while (used.has(suffix === 1 ? "JB" : `JB${suffix}`)) suffix++;
    return suffix === 1 ? "JB" : `JB${suffix}`;
  }
  async listProjects(includeArchived = false): Promise<ProjectSummary[]> {
    await this.call("list_projects", { includeArchived });
    const snapshots = [
      ...Object.values(this.projects),
      ...(this.state.jam ? [this.snapshot()] : []),
    ];
    return snapshots
      .flatMap((p) =>
        p.state.jam && (includeArchived || !p.archived)
          ? [
              {
                ...p.state.jam,
                archived: p.archived,
                selected: p.state.jam?.id === this.state.jam?.id,
                taskCount: p.tasks.filter((t) => !t.archivedAt).length,
                inProgressCount: p.tasks.filter(
                  (t) => t.status === "in_progress",
                ).length,
              },
            ]
          : [],
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async selectProject(projectId: string) {
    await this.call("select_project", { projectId });
    if (this.state.jam?.id === projectId) return clone(this.state);
    const project = this.projects[projectId];
    if (!project) throw new JamError("not_found", "Project not found");
    if (project.archived)
      throw new JamError("archived", "Restore this project first");
    this.stashProject();
    this.openProject(project);
    return clone(this.state);
  }
  async restoreProject(projectId: string) {
    await this.call("restore_project", { projectId });
    if (this.state.jam?.id === projectId) return clone(this.state);
    const project = this.projects[projectId];
    if (!project) throw new JamError("not_found", "Project not found");
    this.stashProject();
    this.openProject(project);
    return clone(this.state);
  }
  /** Unit-test fixture reset; unlike the product action this deliberately replaces all mock data. */
  async resetDemo() {
    this.projects = {};
    this.state.jam = null;
    return this.loadDemoJam();
  }
  private canvasData = emptyCanvas();
  private canvas = new MockReferences({
    data: () => this.canvasData,
    epics: () => this.planData.epics,
    targets: () => [
      ...this.planData.epics.map((e) => ({ ...e, kind: "epic" })),
      ...this.planData.stories.map((s) => ({ ...s, kind: "story" })),
      ...this.tasks.map((t) => ({ ...t, kind: "task" })),
    ],
    assets: () => this.assets,
    human: () => this.human(),
    jam: () => this.state.jam?.id ?? "",
    changed: (a, actor, p, e) => this.event(a, actor, undefined, p, e),
    call: (c, i) => this.call(c, i),
    save: () => this.checkpoint(),
  });
  referenceCanvas: JamApi["referenceCanvas"] = async () => {
    const data = await this.canvas.snapshot();
    return {
      ...data,
      items: data.items.map((item) => ({
        verdict: null,
        archivedBy: null,
        ...item,
      })),
      frames: data.frames.map((frame) => ({ links: [], ...frame })),
    };
  };
  async setReferenceVerdict(itemId: string, verdict: ReferenceVerdict) {
    await this.call("set_reference_verdict", { input: { itemId, verdict } });
    const item: VerdictItem = this.canvas.item(itemId);
    item.verdict = verdict;
    this.canvas.change("reference.updated", itemId);
    return clone(item);
  }
  openReferenceFile = async (path: string) => {
    await this.call("open_reference_file", { path });
  };
  private async frameLink(frameId: string, targetKey: string, unlink: boolean) {
    await this.call(unlink ? "unlink_ref_frame" : "link_ref_frame", {
      input: { frameId, targetKey },
    });
    const frame: LinkedFrame | undefined = this.canvasData.frames.find(
      (f) => f.id === frameId && !f.archivedAt,
    );
    const target = [
      ...this.planData.epics.map((t) => ({ ...t, kind: "epic" as const })),
      ...this.planData.stories.map((t) => ({ ...t, kind: "story" as const })),
      ...this.tasks.map((t) => ({ ...t, kind: "task" as const })),
    ].find((t) => t.key === targetKey && !t.archivedAt);
    if (!frame || !target)
      throw new JamError("not_found", "Frame or target not found");
    frame.links = (frame.links ?? []).filter((l) => l.targetKey !== targetKey);
    if (!unlink)
      frame.links.push({ targetKey, kind: target.kind, title: target.title });
    if (unlink && frame.epicId === target.id) frame.epicId = null;
    this.canvas.change("reference.linked", frameId);
    return clone(frame);
  }
  linkRefFrame = (frameId: string, targetKey: string) =>
    this.frameLink(frameId, targetKey, false);
  unlinkRefFrame = (frameId: string, targetKey: string) =>
    this.frameLink(frameId, targetKey, true);
  async unlinkReference(itemId: string, targetKey: string) {
    await this.call("unlink_reference", { input: { itemId, targetKey } });
    const target = [
      ...this.planData.epics,
      ...this.planData.stories,
      ...this.tasks,
    ].find((t) => t.key === targetKey);
    this.canvasData.links = this.canvasData.links.filter(
      (l) => l.itemId !== itemId || l.targetId !== target?.id,
    );
    this.canvas.change("reference.unlinked", itemId);
  }
  addReference: JamApi["addReference"] = (input, untitled) =>
    this.canvas.add(input, undefined, untitled);
  updateReference: JamApi["updateReference"] = (...a) =>
    this.canvas.update(...a);
  linkReference: JamApi["linkReference"] = (...a) => this.canvas.link(...a);
  canvasGeometry: JamApi["canvasGeometry"] = (i) => this.canvas.geometry(i);
  canvasArchive: JamApi["canvasArchive"] = (i) => this.canvas.archive(i);
  createRefFrame: JamApi["createRefFrame"] = (i) => this.canvas.frame(i);
  updateRefFrame: JamApi["updateRefFrame"] = (...a) =>
    this.canvas.updateFrame(...a);
  createRefEdge: JamApi["createRefEdge"] = (...a) => this.canvas.edge(...a);
  updateRefEdge: JamApi["updateRefEdge"] = (...a) =>
    this.canvas.updateEdge(...a);
  referenceMetadata: JamApi["referenceMetadata"] = (...a) =>
    this.canvas.metadata(...a);
  referenceMedia = async (id: string) => this.assetPreview(id);
  clipboardReference: JamApi["clipboardReference"] = async (_bytes, x, y) =>
    this.canvas.add({
      kind: "asset",
      filePath: "C:/mock/references/clipboard.png",
      title: "Clipboard image",
      x,
      y,
    });
  fetchReferencePreview = (id: string) => this.canvas.preview(id);
  clearReferencePreview = (id: string) => this.canvas.preview(id, true);
  canvasViewport = async (value?: string) => {
    if (value !== undefined) {
      this.canvas.viewport = value;
      this.canvasViewportValue = value;
      this.checkpoint();
    }
    return this.canvasViewportValue;
  };
  private canvasViewportValue: string | null = null;
  /** Disposable mock-only References fixture. Call before entering /references,
   * or use Refresh references afterwards. Existing tasks and project stay put. */
  async seedBusyBoard() {
    this.assets = this.assets.filter(
      (asset) => !asset.id.startsWith("perf-asset-"),
    );
    await this.seedBulkReferences(500, 50, 200);
    for (const [index, item] of this.canvasData.items.entries())
      item.verdict =
        index % 11 === 0 ? "keep" : index % 13 === 0 ? "reject" : null;
    this.canvasViewportValue = JSON.stringify({ x: 80, y: 90, zoom: 1 });
    this.checkpoint();
  }
  async seedBulkReferences(count = 500, frameCount = 40, edgeCount = 300) {
    await this.call("seed_bulk_references", { count, frameCount, edgeCount });
    if (import.meta.env.VITE_MOCK_BRIDGE !== "1" && !import.meta.env.DEV)
      throw new JamError("forbidden", "Mock benchmark only");
    const now = new Date().toISOString(),
      actor = this.human(),
      jamId = this.state.jam?.id ?? "",
      epics = this.planData.epics;
    this.canvasData = emptyCanvas();
    for (let n = 0; n < frameCount; n++)
      this.canvasData.frames.push({
        id: `perf-frame-${n}`,
        jamId,
        epicId: epics[n % epics.length]?.id ?? null,
        title: `Reference study ${n + 1}`,
        x: (n % 8) * 940,
        y: Math.floor(n / 8) * 760,
        w: 880,
        h: 690,
        color: `m${(n % 6) + 1}`,
        archivedAt: null,
        collapsed: false,
      });
    for (let n = 0; n < count; n++) {
      const f = this.canvasData.frames[n % frameCount],
        index = Math.floor(n / frameCount),
        kind = n % 5 === 0 ? "asset" : n % 5 === 1 ? "link" : "note",
        assetId = kind === "asset" ? `perf-asset-${n}` : null;
      if (assetId)
        this.assets.push({
          id: assetId,
          jamId,
          kind: "sprite",
          name: `Study ${n}`,
          location: `C:/mock/study-${n}.webp`,
          notes: null,
          role: "reference",
          createdBy: actor.id,
          createdAt: now,
        });
      this.canvasData.items.push({
        verdict: null,
        archivedBy: null,
        id: `perf-item-${n}`,
        jamId,
        position: n * 1024,
        createdBy: actor.id,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        kind,
        assetId,
        url: kind === "link" ? "https://example.test/reference" : null,
        title: `Lantern reference ${n + 1}`,
        captionMd:
          n % 3 === 0
            ? "## Warm amber\nKeep silhouettes readable against the snowy path."
            : "Soft light, quiet shapes, a clear path home.",
        tags: ["lighting", "cozy"],
        x: 20 + (index % 4) * 210,
        y: 60 + Math.floor(index / 4) * 155,
        w: 195,
        h: 145,
        z: 0,
        frameId: f?.id ?? null,
        linkPreview: null,
        metadata: null,
      });
    }
    for (let n = 0; n < edgeCount; n++)
      this.canvasData.edges.push({
        id: `perf-edge-${n}`,
        jamId,
        fromItem: `perf-item-${n}`,
        toItem: `perf-item-${(n + frameCount) % count}`,
        label: n % 4 === 0 ? "same mood" : "",
        archivedAt: null,
      });
    this.checkpoint();
  }
  readonly buildMode = import.meta.env.PROD ? "production" : "development";
  private state: AppState = {
    hasJam: false,
    currentMember: null,
    jam: null,
    theme: "system",
  };
  private tasks: TaskDetail[] = [];
  private planData: PlanData = { epics: [], stories: [], questions: [] };
  private executionData = emptyExecution();
  private execution = new MockExecution({
    data: () => this.executionData,
    plan: () => this.planData,
    tasks: () => this.tasks,
    project: () => this.state.jam,
    human: () => this.human(),
    call: (name, input) => this.call(name, input),
    changed: (action, actor, scope) =>
      this.event(
        action,
        actor,
        undefined,
        { scope },
        scope.type === "epic"
          ? scope.id
          : this.planData.stories.find((story) => story.id === scope.id)
              ?.epicId,
      ),
  });
  getExecution: JamApi["getExecution"] = (scope) => this.execution.get(scope);
  listExecution: JamApi["listExecution"] = () => this.execution.list();
  setExecution: JamApi["setExecution"] = (input) => this.execution.set(input);
  listExecutionRequests: JamApi["listExecutionRequests"] = (status) =>
    this.execution.requests(status);
  resolveExecutionRequest: JamApi["resolveExecutionRequest"] = (input) =>
    this.execution.resolve(input);
  /** Explicit human fixture actions for tests unrelated to the execution gate. */
  async startAllDemoScopes() {
    for (const epic of this.planData.epics.filter(
      (epic) => !epic.archivedAt && epic.status !== "done",
    )) {
      const state = await this.getExecution({ type: "epic", id: epic.id });
      await this.setExecution({
        scope: state.scope,
        action: "start",
        expectedRevision: state.revision,
      });
    }
  }
  private planning = new MockPlanning({
    data: () => this.planData,
    tasks: () => this.tasks,
    members: () => this.members,
    jam: () => this.state.jam,
    human: () => this.human(),
    call: (c, i) => this.call(c, i),
    checkpoint: () => this.checkpoint(),
    emit: (...args) => this.event(...args),
    move: (input) => this.moveTask({ ...input, status: "ready" }),
  });
  listEpics = () => this.planning.listEpics();
  listStories = async () => {
    await this.call("list_plan_stories");
    return clone(
      this.planData.stories.filter(
        (s) => !s.archivedAt && !this.planning.epic(s.epicId).archivedAt,
      ),
    );
  };
  getEpic = async (key: string) => ({
    ...(await this.planning.getEpic(key)),
    journal: await this.epicJournal(key),
  });
  getStory = (key: string) => this.planning.getStory(key);
  createEpic: JamApi["createEpic"] = (input) => this.planning.createEpic(input);
  updateEpic: JamApi["updateEpic"] = (key, patch) =>
    this.planning.updateEpic(key, patch);
  setEpicStatus: JamApi["setEpicStatus"] = (...a) =>
    this.planning.setEpicStatus(...a);
  setBrain: JamApi["setBrain"] = (...a) => this.planning.setBrain(...a);
  createStory: JamApi["createStory"] = (...a) =>
    this.planning.createStory(...a);
  updateStory: JamApi["updateStory"] = (...a) =>
    this.planning.updateStory(...a);
  setStoryStatus: JamApi["setStoryStatus"] = (...a) =>
    this.planning.setStoryStatus(...a);
  reorderStory: JamApi["reorderStory"] = (...a) =>
    this.planning.reorderStory(...a);
  checkReady: JamApi["checkReady"] = (...a) => this.planning.checkReady(...a);
  markReady: JamApi["markReady"] = (...a) => this.planning.markReady(...a);
  updateTaskBrief: JamApi["updateTaskBrief"] = (...a) =>
    this.planning.updateTaskBrief(...a);
  listQuestions: JamApi["listQuestions"] = (...a) =>
    this.planning.listQuestions(...a);
  answerQuestion: JamApi["answerQuestion"] = (...a) =>
    this.planning.answerQuestion(...a);
  askUser: JamApi["askUser"] = (...a) => this.planning.askUser(...a);
  withdrawQuestion: JamApi["withdrawQuestion"] = (...a) =>
    this.planning.withdrawQuestion(...a);
  reviewTask: JamApi["reviewTask"] = (...a) => this.planning.reviewTask(...a);
  async epicJournal(key: string) {
    await this.call("epic_journal", key);
    return clone(
      this.activity.filter((e) => e.epicId === this.planning.epic(key).id),
    );
  }
  async listChangesSince(cursor: number, key?: string) {
    await this.call("list_changes_since", { cursor, key });
    return clone(
      this.activity.filter(
        (e) =>
          e.seq > cursor && (!key || e.epicId === this.planning.epic(key).id),
      ),
    );
  }
  private assets: Asset[] = [];
  private soundEnabled = false;
  private boardSettings: Record<
    string,
    {
      colorBy: string;
      estimatesEnabled: boolean;
      wipLimit: number;
      projectFolder?: string | null;
    }
  > = {};
  private assetsView = "grid";
  private collapsedAssetKinds: string[] = [];
  private httpEnabled = true;
  private recentCalls: McpStatus["recentCalls"] = [];
  private mockToken = "mock-token-for-local-tests-only";
  private mcpListeners = new Set<() => void>();
  private fileDropListeners = new Set<{
    cb: (paths: string[]) => void;
    active?: (value: boolean) => void;
  }>();
  private exported: {
    canvasData: import("../bindings").ReferenceCanvas;
    planData: PlanData;
    state: AppState;
    tasks: TaskDetail[];
    members: Member[];
    assets: Asset[];
    activity: ActivityEvent[];
  } | null = null;
  private members: Member[] = [];
  private activity: ActivityEvent[] = [];
  private listeners = new Set<(events: ActivityEvent[]) => void>();
  private failures = new Set<string>();
  private latency = 0;
  readonly calls: { command: string; input: unknown }[] = [];
  constructor(private persist = false) {
    if (persist) {
      try {
        const raw = sessionStorage.getItem("jam.mock");
        if (raw) {
          const { contexts, ...stored } = JSON.parse(raw);
          if (contexts)
            stored.tasks = stored.tasks.map(
              ({ context, ...task }: TaskDetail & { context: number }) => ({
                ...task,
                ...contexts[context],
              }),
            );
          Object.assign(this, stored);
        }
      } catch {
        /* A blocked storage area leaves the mock in memory. */
      }
    }
  }
  private checkpoint() {
    if (this.persist)
      try {
        // Briefs and hierarchy context repeat across thousands of tasks. Keep one copy
        // per distinct context so a reload stays within sessionStorage's quota.
        const contexts: Pick<TaskDetail, "brief" | "story" | "epic">[] = [];
        const indexes = new Map<string, number>();
        const tasks = this.tasks.map(({ brief, story, epic, ...task }) => {
          const value = { brief, story, epic },
            key = JSON.stringify(value);
          let index = indexes.get(key);
          if (index === undefined) {
            index = contexts.length;
            indexes.set(key, index);
            contexts.push(value);
          }
          return { ...task, context: index };
        });
        sessionStorage.setItem(
          "jam.mock",
          JSON.stringify({
            projects: this.projects,
            skillPath: this.skillPath,
            canvasData: this.canvasData,
            canvasViewportValue: this.canvasViewportValue,
            planData: this.planData,
            executionData: this.executionData,
            state: this.state,
            tasks,
            contexts,
            members: this.members,
            activity: this.activity,
            assets: this.assets,
            soundEnabled: this.soundEnabled,
            boardSettings: this.boardSettings,
            assetsView: this.assetsView,
            collapsedAssetKinds: this.collapsedAssetKinds,
            httpEnabled: this.httpEnabled,
            mockToken: this.mockToken,
          }),
        );
      } catch {
        /* Storage is optional. */
      }
  }
  private async call(command: string, input?: unknown) {
    this.calls.push({ command, input });
    if (this.latency)
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    if (this.failures.delete(command))
      throw new JamError("internal", "Simulated failure");
  }
  failNext(command: string) {
    this.failures.add(command);
  }
  setLatency(ms: number) {
    this.latency = Math.max(0, ms);
  }
  onBoardChanged(cb: (events: ActivityEvent[]) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(events: ActivityEvent[]) {
    for (const cb of this.listeners) cb(clone(events));
  }
  private event(
    action: string,
    actor: Member,
    task?: TaskDetail,
    payload: ActivityEvent["payload"] = {},
    epicId?: string,
    sentence = "",
  ) {
    if (action === "epic.status" || action === "story.status") {
      const type = action === "epic.status" ? "epic" : "story";
      const fields =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload
          : {};
      const entity = (
        type === "epic" ? this.planData.epics : this.planData.stories
      ).find((item) => item.key === fields.key);
      this.execution.revokeClosed(
        actor,
        false,
        fields.wasClosed && entity ? { type, id: entity.id } : undefined,
      );
    }
    if (action === "jam.archived") this.execution.revokeClosed(actor, true);
    if (task) this.planning.sync(task);
    else if (action.startsWith("epic.") || action.startsWith("story."))
      this.planning.sync();
    const event: ActivityEvent = {
      seq: (this.activity.at(-1)?.seq ?? 0) + 1,
      action,
      actor,
      taskKey: task?.key,
      payload,
      createdAt: new Date().toISOString(),
      epicId: epicId ?? task?.epicId ?? null,
      sentence,
    };
    this.activity.push(event);
    this.checkpoint();
    this.emit([event]);
  }
  private human() {
    if (!this.state.currentMember)
      throw new JamError(
        "validation",
        "Choose a human member first",
        "current_member_id",
      );
    return this.state.currentMember;
  }
  async appReady() {}
  async appState() {
    await this.call("app_state");
    return clone(this.state);
  }
  private skillPath = "";
  private skillListeners = new Set<(line: string) => void>();
  private skillCancelled = false;
  async pickFolder() {
    await this.call("pick_folder");
    return "/mock/project";
  }
  async skillSavedPath() {
    return this.skillPath || null;
  }
  async skillCheck(
    input: import("../bindings").SkillInput,
  ): Promise<import("../bindings").SkillCheck> {
    await this.call("skill_check", input);
    this.skillPath = input.target;
    this.checkpoint();
    return {
      version: "0.3.0-alpha.44",
      destination: input.target
        ? `${input.target.replace(/[\\/]$/, "")}/${input.client === "claude" ? ".claude" : ".agents"}/skills/jam-board`
        : null,
      status: input.target ? "new" : "blocked",
      errors: !input.target ? ["Choose an existing project folder"] : [],
    };
  }
  onSkillOutput(cb: (line: string) => void) {
    this.skillListeners.add(cb);
    return () => {
      this.skillListeners.delete(cb);
    };
  }
  async runSkill(
    input: import("../bindings").SkillInput,
    step: "plan" | "install" | "verify",
  ) {
    await this.call("run_skill", { input, step });
    this.skillCancelled = false;
    for (const cb of this.skillListeners)
      cb(`${step} ${input.client} Jam Board skill → ${input.target}`);
    await new Promise((r) => setTimeout(r, 100));
    return {
      exitCode: this.skillCancelled ? null : 0,
      cancelled: this.skillCancelled,
      timedOut: false,
    };
  }
  async cancelSkill() {
    this.skillCancelled = true;
  }
  async getProject() {
    await this.call("get_project");
    const jam = this.state.jam;
    if (!jam) throw new JamError("not_found", "No active project");
    return clone({
      jam,
      template: jam.template ?? "game_jam",
      milestoneAt: jam.milestoneAt ?? null,
      templateLabel: templateInfo(jam.template).label,
      tagSuggestions: tagSuggestions(jam.template ?? "game_jam"),
      epics: this.planData.epics.length,
      stories: this.planData.stories.length,
      tasks: this.tasks.length,
      openQuestions: this.planData.questions.filter((q) => q.status === "open")
        .length,
    });
  }
  async updateProject(input: Parameters<JamApi["updateProject"]>[0]) {
    await this.call("update_project", input);
    const jam = this.state.jam;
    if (!jam) throw new JamError("not_found", "No active project");
    if (!["game_jam", "gamedev", "webapp", "custom"].includes(input.template))
      throw new JamError("validation", "Unknown project template");
    if (
      input.name !== undefined &&
      input.name !== null &&
      (!input.name.trim() || input.name.trim().length > 60)
    )
      throw new JamError("validation", "Use 1–60 characters");
    const next = {
      ...jam,
      ...input,
      name: input.name?.trim() ?? jam.name,
      timezone: input.timezone ?? jam.timezone,
    };
    if (input.template === "game_jam") {
      next.startsAt = input.startsAt ?? jam.startsAt;
      next.endsAt = input.endsAt ?? jam.endsAt;
      if (!(Date.parse(next.endsAt ?? "") > Date.parse(next.startsAt ?? "")))
        throw new JamError("validation", "End must be after start");
      next.milestoneAt = null;
    } else {
      next.startsAt = null;
      next.endsAt = null;
      next.milestoneAt =
        input.template === "custom" ? null : (input.milestoneAt ?? null);
    }
    this.state.jam = next;
    this.event("project.updated", this.human(), undefined, {
      fields: Object.keys(input),
    });
    return this.getProject();
  }
  async createJam(input: NewJamInput) {
    await this.call("create_jam", input);
    if (
      !input.name.trim() ||
      input.name.trim().length > 60 ||
      !input.yourName.trim() ||
      input.yourName.trim().length > 40 ||
      ((input.template ?? "game_jam") === "game_jam" &&
        !(Date.parse(input.endsAt) > Date.parse(input.startsAt)))
    )
      throw new JamError(
        "validation",
        "Check the jam name, your name and dates",
      );
    const prefix = this.nextProjectPrefix();
    this.stashProject();
    this.canvasData = emptyCanvas();
    this.canvasViewportValue = null;
    this.assets = [];
    const now = new Date().toISOString();
    const human: Member = {
      id: crypto.randomUUID(),
      kind: "human",
      name: input.yourName.trim(),
      handle: input.yourName.toLowerCase().replace(/\s+/g, "-"),
      color: "#5B8DEF",
      avatar: null,
      client: null,
      lastSeenAt: null,
      createdAt: now,
    };
    this.members = [human];
    this.tasks = [];
    this.planData = { epics: [], stories: [], questions: [] };
    this.executionData = emptyExecution();
    this.activity = [];
    this.state = {
      ...this.state,
      hasJam: true,
      currentMember: human,
      jam: {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        theme: input.theme,
        startsAt:
          (input.template ?? "game_jam") === "game_jam" ? input.startsAt : null,
        endsAt:
          (input.template ?? "game_jam") === "game_jam" ? input.endsAt : null,
        timezone: input.timezone,
        template: input.template ?? "game_jam",
        milestoneAt:
          input.template === "gamedev" || input.template === "webapp"
            ? (input.milestoneAt ?? null)
            : null,
        taskSeq: 0,
        keyPrefix: prefix,
        createdAt: now,
      },
    };
    this.event("jam.updated", human);
    return clone(this.state);
  }
  async loadDemoJam() {
    await this.call("load_demo_jam");
    const prefix = this.nextProjectPrefix();
    this.stashProject();
    // TypeScript infers optional `undefined` keys for heterogeneous JSON unions;
    // the Rust exporter guarantees the wire types and JSON has no undefined.
    const ids = new Map<string, string>();
    for (const item of [
      ...fixture.details,
      ...fixture.epics,
      ...fixture.stories,
      ...fixture.questions,
      ...fixture.assets,
    ])
      ids.set(item.id, crypto.randomUUID());
    const remapDemo = (value: unknown): unknown => {
      if (typeof value === "string")
        return ids.get(value) ?? value.replace(/^JB(?=-[ES]?\d+$)/, prefix);
      if (Array.isArray(value)) return value.map(remapDemo);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, v]) => [key, remapDemo(v)]),
        );
      return value;
    };
    const data = remapDemo(clone(fixture)) as {
      app: AppState;
      members: Member[];
      details: TaskDetail[];
      activity: ActivityEvent[];
      assets: Asset[];
      epics: PlanData["epics"];
      stories: PlanData["stories"];
      questions: PlanData["questions"];
    };
    const now = new Date().toISOString();
    const jamId = crypto.randomUUID();
    this.canvasData = emptyCanvas();
    this.state = {
      ...data.app,
      theme: this.state.theme,
      jam: data.app.jam
        ? { ...data.app.jam, id: jamId, keyPrefix: prefix }
        : null,
    };
    if (this.state.jam)
      this.state.jam.endsAt = new Date(Date.now() + 31 * 3600000).toISOString();
    this.members = data.members.map((member) => ({
      ...member,
      lastSeenAt: member.kind === "agent" ? now : member.lastSeenAt,
      statusAt:
        member.kind === "agent" && member.statusText ? now : member.statusAt,
    }));
    this.tasks = data.details.map((task) => ({
      ...task,
      jamId,
      story: { ...task.story, jamId },
      epic: { ...task.epic, jamId },
      assets: task.assets.map((asset) => ({ ...asset, jamId })),
    }));
    this.assets = data.assets.map((asset) => ({ ...asset, jamId }));
    for (const task of this.tasks) task.history ??= task.activity;
    this.planData = clone({
      epics: data.epics,
      stories: data.stories,
      questions: data.questions,
    }) as PlanData;
    for (const e of this.planData.epics) e.jamId = jamId;
    for (const e of this.planData.stories) e.jamId = jamId;
    for (const q of this.planData.questions) q.jamId = jamId;
    this.planning.sync();
    this.activity = data.activity;
    this.executionData = emptyExecution();
    this.checkpoint();
    return clone(this.state);
  }
  async setCurrentMember(id: string) {
    await this.call("set_current_member", id);
    const member = this.members.find((m) => m.id === id && m.kind === "human");
    if (!member) throw new JamError("validation", "Choose a human");
    this.state.currentMember = member;
    this.checkpoint();
    return clone(this.state);
  }
  async addSelf(name: string) {
    await this.call("add_self", name);
    if (!name.trim() || name.trim().length > 40)
      throw new JamError("validation", "Use 1–40 characters");
    const member: Member = {
      avatar: null,
      client: null,
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      kind: "human",
      name: name.trim(),
      handle: name.toLowerCase().replace(/\s+/g, "-"),
      color: "#5B8DEF",
    };
    this.members.push(member);
    this.state.currentMember = member;
    this.event("member.joined", member);
    return clone(this.state);
  }
  async listBoardTasks(): Promise<BoardTasks> {
    await this.call("list_board_tasks");
    const board = emptyBoard();
    for (const task of this.tasks
      .filter((t) => !t.archivedAt)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
      board[task.status as Status].push(clone(task));
    return board;
  }
  async getBoard(): Promise<BoardSummary> {
    await this.call("get_board");
    const jam = this.state.jam;
    if (!jam) throw new JamError("not_found", "No active jam");
    const tasks = this.tasks.filter((t) => !t.archivedAt);
    const summary = (task: TaskDetail) => ({
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      changesRequested: !!task.changesRequested,
      needsInfo: !!task.needsInfo,
      epicKey: task.epicKey ?? "",
      assignee: this.members.find((m) => m.id === task.assigneeId) ?? null,
    });
    return clone({
      jam: {
        name: jam.name,
        template: jam.template ?? "game_jam",
        milestoneAt: jam.milestoneAt ?? null,
        theme: jam.theme,
        endsAt: jam.template === "game_jam" ? jam.endsAt : null,
        timeLeft:
          jam.template === "game_jam" && jam.endsAt
            ? Math.floor((Date.parse(jam.endsAt) - Date.now()) / 1000)
            : null,
      },
      tagSuggestions: fixture.board.tagSuggestions,
      openQuestionCount: this.planData.questions.filter(
        (q) => q.status === "open",
      ).length,
      columns: statuses.map((status) => ({
        status,
        count: tasks.filter((t) => t.status === status).length,
      })),
      inProgress: tasks.filter((t) => t.status === "in_progress").map(summary),
      myTasks: tasks
        .filter((t) => t.assigneeId === this.state.currentMember?.id)
        .map(summary),
      onlineAgents: this.members
        .filter(
          (m) =>
            m.kind === "agent" &&
            Date.now() - Date.parse(m.lastSeenAt ?? "") < 120000,
        )
        .map((m) => ({
          ...m,
          counts: Object.fromEntries(
            statuses.map((s) => [
              s,
              tasks.filter((t) => t.status === s && t.assigneeId === m.id)
                .length,
            ]),
          ),
          online: true,
          statusStale:
            !!m.statusText &&
            Date.now() - Date.parse(m.statusAt ?? "") > 1800000,
          workingOn: tasks
            .filter((t) => t.status === "in_progress" && t.assigneeId === m.id)
            .map((t) => t.key),
        })),
    });
  }
  async getTask(key: string) {
    await this.call("get_task", key);
    const task = this.tasks.find((t) => t.key === key);
    if (!task) throw new JamError("not_found", `Task ${key} was not found`);
    this.planning.sync(task);
    const targetIds = new Set([task.id, task.epic.id, task.story.id]);
    const targetKeys = new Set([task.key, task.epic.key, task.story.key]);
    const references = this.canvasData.items.flatMap((item) => {
      if (item.archivedAt) return [];
      const direct = this.canvasData.links.some(
        (link) =>
          !link.archivedAt &&
          link.itemId === item.id &&
          targetIds.has(link.targetId),
      );
      const frame = this.canvasData.frames.find(
        (frame) => frame.id === item.frameId && !frame.archivedAt,
      );
      const inherited =
        frame &&
        (targetIds.has(frame.epicId ?? "") ||
          frame.links?.some((link) => targetKeys.has(link.targetKey)));
      return direct || inherited
        ? [
            {
              ...item,
              via: direct ? null : "frame",
              frameTitle: !direct && frame ? frame.title : null,
            },
          ]
        : [];
    });
    return clone({
      ...task,
      references: [
        ...new Map(
          [...task.references, ...references].map((item) => [item.id, item]),
        ).values(),
      ],
      activity: this.activity.filter((e) => e.taskKey === key).slice(-20),
      history: this.activity.filter((e) => e.taskKey === key).slice(-50),
    });
  }
  private create(
    input: CreateInput,
    actor: Member,
    planned = actor.kind === "agent",
  ) {
    const jam = this.state.jam;
    if (!jam) throw new JamError("not_found", "No active jam");
    if (input.status === "done" && actor.kind !== "human")
      throw new JamError(
        "forbidden",
        "Agents must use independent report review to mark Done",
      );
    const title = input.title.trim();
    if (!title || title.length > 140)
      throw new JamError("validation", "Use 1–140 characters", "title");
    const now = new Date().toISOString();
    const base = clone(
      (this.tasks.find((t) =>
        planned
          ? t.story.status === "active"
          : t.story.title === "Unplanned work",
      ) ??
        fixture.details.find((t) => t.story.status === "active")) as TaskDetail,
    );
    const story = clone(base.story),
      epic = clone(base.epic);
    const existingUnplanned = this.tasks.find(
      (t) => t.story.title === "Unplanned work",
    );
    if (!planned && !input.storyKey && !existingUnplanned) {
      epic.id = crypto.randomUUID();
      epic.key =
        jam.keyPrefix +
        "-E" +
        (Math.max(
          0,
          ...this.planData.epics.map((e) => Number(e.key.split("-E")[1]) || 0),
        ) +
          1);
      epic.title = "Unplanned work";
      epic.status = "draft";
      epic.goalMd = "";
      epic.doneWhenMd = "";
      epic.brainMemberId = null;
      epic.color = "m3";
      story.id = crypto.randomUUID();
      story.key =
        jam.keyPrefix +
        "-S" +
        (Math.max(
          0,
          ...this.planData.stories.map(
            (s) => Number(s.key.split("-S")[1]) || 0,
          ),
        ) +
          1);
      story.title = "Unplanned work";
      story.status = "draft";
      story.outcomeMd = "";
      story.acceptance = [];
      story.epicId = epic.id;
    }
    if (input.storyKey) {
      Object.assign(story, clone(this.planning.story(input.storyKey)));
      Object.assign(epic, clone(this.planning.epic(story.epicId)));
    }
    story.jamId = jam.id;
    epic.jamId = jam.id;
    const brief =
      input.brief ??
      (planned
        ? clone(base.brief)
        : {
            goalMd: "",
            contextMd: "",
            whereMd: "",
            changes: [],
            tests: [],
            boundariesMd: "",
            resultMd: "",
            userQuotesMd: "",
          });
    const task: TaskDetail = {
      id: crypto.randomUUID(),
      jamId: jam.id,
      key: `${jam.keyPrefix}-${jam.taskSeq + 1}`,
      title,
      descriptionMd: input.description ?? "",
      status: input.status,
      priority: input.priority ?? "medium",
      tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()))],
      estimate: input.estimate ?? null,
      dueAt: input.dueAt ?? null,
      position:
        Math.max(
          0,
          ...this.tasks
            .filter((t) => t.status === input.status)
            .map((t) => t.position ?? 0),
        ) + 1024,
      assigneeId: null,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      idempotencyKey: null,
      commentCount: 0,
      assets: [],
      comments: [],
      activity: [],
      history: [],
      brief,
      story,
      epic,
      reports: [],
      reviews: [],
      references: [],
      ancestorQuestions: [],
      storyKey: story.key,
      ready: false,
      storyId: story.id,
      epicId: epic.id,
      epicKey: epic.key,
      epicColor: epic.color,
      changesRequested: false,
      needsInfo: false,
      reviewRound: 0,
      claimGeneration: crypto.randomUUID(),
      reviewContextRevision: null,
    };
    task.ready = mockReadiness(task).ready;
    if (task.status === "ready") this.guardReady(task, actor);
    if (task.status === "in_progress") this.execution.requireTaskStart(task);
    if (!this.planData.epics.some((e) => e.id === epic.id))
      this.planData.epics.push(epic);
    if (!this.planData.stories.some((s) => s.id === story.id))
      this.planData.stories.push(story);
    jam.taskSeq += 1;
    this.tasks.push(task);
    this.event("task.created", actor, task, {
      title: task.title,
      status: task.status,
    });
    return clone(task);
  }
  async createTask(input: CreateInput) {
    await this.call("create_task", input);
    return this.create(input, this.human());
  }

  private guardReady(task: TaskDetail, actor: Member, reason?: string) {
    const missing = mockReadiness(task).missing;
    if (!missing.length) return;
    if (reason?.trim()) {
      if (actor.kind !== "human" && task.epic.brainMemberId !== actor.id)
        throw new JamError(
          "forbidden",
          "Only a human or the epic's brain may override",
        );
      return;
    }
    throw new JamError(
      "not_ready",
      `not_ready: ${missing.map((c) => `${c.code}: ${c.message}`).join("; ")}`,
    );
  }

  private move(input: MoveInput, actor: Member) {
    const task = this.tasks.find((t) => t.key === input.key);
    if (!task) throw new JamError("not_found", "Task not found");
    const before = this.tasks.find((t) => t.key === input.beforeKey);
    if (task.archivedAt)
      throw new JamError("archived", "Unarchive this task first");
    if (input.status === "done" && actor.kind !== "human")
      throw new JamError(
        "forbidden",
        "Agents must use independent report review to mark Done",
      );
    if (input.status === "ready" && task.status !== "ready")
      this.guardReady(task, actor, input.overrideReason);
    if (input.status === "in_progress" && task.status !== "in_progress")
      this.execution.requireTaskStart(task);
    const after = this.tasks.find((t) => t.key === input.afterKey);
    task.position =
      before && after
        ? ((before.position ?? 0) + (after.position ?? 0)) / 2
        : before
          ? (before.position ?? 0) - 1024
          : after
            ? (after.position ?? 0) + 1024
            : Math.max(
                0,
                ...this.tasks
                  .filter((t) => t.status === input.status)
                  .map((t) => t.position ?? 0),
              ) + 1024;
    const old = task.status;
    task.status = input.status;
    task.updatedBy = actor.id;
    this.touch(task, actor);
    this.planning.sync();
    this.event(
      input.overrideReason ? "task.ready_override" : "task.moved",
      actor,
      task,
      {
        status: [old, input.status],
        overrideReason: input.overrideReason ?? null,
      },
    );
    return clone(task);
  }
  async moveTask(input: MoveInput) {
    await this.call("move_task", input);
    if (!input.expectedUpdatedAt?.trim())
      throw new JamError(
        "validation",
        "A captured task version is required",
        "expectedUpdatedAt",
      );
    if (this.find(input.key).updatedAt !== input.expectedUpdatedAt)
      throw new JamError(
        "conflict",
        "This task changed after the move was prepared. Read the latest task before deciding again.",
        "expectedUpdatedAt",
      );
    return this.move(input, this.human());
  }
  releaseTask: JamApi["releaseTask"] = async (input) => {
    await this.call("release_task", input);
    const actor = this.human(),
      task = this.find(input.key);
    if (task.updatedAt !== input.expectedUpdatedAt)
      throw new JamError(
        "conflict",
        "This task changed. Review the latest claim before returning it.",
      );
    if (!task.assigneeId && task.status !== "in_progress")
      throw new JamError(
        "wrong_status",
        "There is no current claim or In progress work to return",
      );
    const oldStatus = task.status,
      oldHolder = task.assigneeId;
    task.assigneeId = null;
    task.status = "backlog";
    this.touch(task, actor);
    this.planning.sync();
    this.event("task.released", actor, task, {
      status: [oldStatus, "backlog"],
      assigneeId: [oldHolder, null],
    });
    return clone(task);
  };
  async listMembers() {
    await this.call("list_members");
    return clone(
      this.members.map((member) => ({
        ...member,
        counts: Object.fromEntries(
          statuses.map((status) => [
            status,
            this.tasks.filter(
              (t) =>
                !t.archivedAt &&
                t.assigneeId === member.id &&
                t.status === status,
            ).length,
          ]),
        ),
        statusStale:
          !!member.statusText &&
          Date.now() - Date.parse(member.statusAt ?? "") > 1800000,
        online:
          member.kind === "agent" &&
          !!member.lastSeenAt &&
          Date.now() - Date.parse(member.lastSeenAt) <= 120000,
        workingOn: this.tasks
          .filter(
            (t) =>
              !t.archivedAt &&
              t.assigneeId === member.id &&
              t.status === "in_progress",
          )
          .map((t) => ({ key: t.key, title: t.title, status: t.status })),
      })),
    );
  }
  async listActivity(input?: Partial<ActivityQuery>) {
    await this.call("list_activity", input);
    return clone(
      this.activity
        .filter(
          (e) =>
            (!input?.beforeSeq || e.seq < input.beforeSeq) &&
            (!input?.actorKind || e.actor.kind === input.actorKind),
        )
        .sort((a, b) => b.seq - a.seq)
        .slice(0, input?.limit ?? 100),
    );
  }
  async listAssets(input?: {
    kind?: string;
    text?: string;
  }): Promise<AssetWithTasks[]> {
    await this.call("list_assets", input);
    return clone(
      this.assets
        .filter(
          (a) =>
            (!input?.kind || a.kind === input.kind) &&
            (!input?.text ||
              `${a.name} ${a.location} ${a.notes}`
                .toLowerCase()
                .includes(input.text.toLowerCase())),
        )
        .map((asset) => ({
          ...asset,
          tasks: this.tasks
            .filter((t) => t.assets.some((a) => a.id === asset.id))
            .map((t) => ({ key: t.key, title: t.title, status: t.status })),
        })),
    );
  }
  private validateAsset(input: NewAsset) {
    if (
      !["sprite", "audio", "level", "font", "other"].includes(input.kind) ||
      !input.name.trim() ||
      input.name.length > 140 ||
      !input.location.trim() ||
      (input.notes?.length ?? 0) > 4000
    )
      throw new JamError(
        "validation",
        "Check the asset name, location and kind",
      );
  }
  async pickFiles() {
    await this.call("pick_files");
    return ["C:/JamBoard/player.png", "C:/JamBoard/jump.wav"];
  }
  async attachFile(key: string, path: string) {
    await this.call("attach_file", { key, path });
    const task = this.tasks.find((t) => t.key === key);
    if (!task) throw new JamError("not_found", "Task not found");
    if (task.archivedAt) throw new JamError("archived", "Task is archived");
    if (!/^[a-z]:[\\/]/i.test(path) && !path.startsWith("/"))
      throw new JamError("validation", "Choose an absolute file path");
    const asset: Asset = {
      id: crypto.randomUUID(),
      jamId: task.jamId,
      kind: assetKind(path),
      name: assetName(path),
      location: path,
      notes: null,
      createdBy: this.human().id,
      createdAt: new Date().toISOString(),
    };
    this.assets.push(asset);
    task.assets.push(clone(asset));
    task.updatedAt = new Date().toISOString();
    this.event("asset.linked", this.human(), task, {
      assetId: asset.id,
      name: asset.name,
      created: true,
    });
    return clone(asset);
  }
  async seed_bulk_assets(n: number) {
    for (let i = 0; i < Math.min(n, 5000); i++)
      await this.createAsset({
        kind: ["sprite", "audio", "level", "font", "other"][i % 5] ?? "other",
        name: `Asset ${i + 1}`,
        location: `assets/bulk/item-${i + 1}.png`,
        notes: "Bulk fixture",
      });
  }
  async createAsset(input: NewAsset) {
    await this.call("create_asset", input);
    this.validateAsset(input);
    const asset: Asset = {
      ...input,
      notes: input.notes ?? null,
      id: crypto.randomUUID(),
      jamId: this.state.jam?.id ?? "",
      createdBy: this.human().id,
      createdAt: new Date().toISOString(),
    };
    this.assets.push(asset);
    this.event("asset.created", this.human(), undefined, {
      assetId: asset.id,
      name: asset.name,
    });
    return clone(asset);
  }
  async updateAsset(input: AssetEdit) {
    await this.call("update_asset", input);
    const asset = this.assets.find((a) => a.id === input.id);
    if (!asset) throw new JamError("not_found", "Asset not found");
    const next = {
      ...asset,
      name: input.name ?? asset.name,
      kind: input.kind ?? asset.kind,
      notes: input.notes ?? asset.notes,
    };
    this.validateAsset(next);
    Object.assign(asset, next);
    for (const t of this.tasks)
      t.assets = t.assets.map((a) => (a.id === asset.id ? clone(asset) : a));
    this.event("asset.updated", this.human(), undefined, {
      assetId: asset.id,
      name: asset.name,
    });
  }
  async linkAsset(input: AssetLink) {
    await this.call("link_asset", input);
    const asset = this.assets.find((a) => a.id === input.assetId);
    const task = this.tasks.find((t) => t.key === input.taskKey);
    if (!asset || !task)
      throw new JamError("not_found", "Asset or task not found");
    if (task.archivedAt) throw new JamError("archived", "Task is archived");
    if (!task.assets.some((a) => a.id === asset.id))
      task.assets.push(clone(asset));
    task.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(task.updatedAt) + 1),
    ).toISOString();
    this.event("asset.linked", this.human(), task, {
      assetId: asset.id,
      name: asset.name,
    });
  }
  async unlinkAsset(input: AssetLink) {
    await this.call("unlink_asset", input);
    const task = this.tasks.find((t) => t.key === input.taskKey);
    if (!task) throw new JamError("not_found", "Task not found");
    if (task.archivedAt) throw new JamError("archived", "Task is archived");
    if (!task.assets.some((a) => a.id === input.assetId))
      throw new JamError("not_found", "Asset link not found");
    task.assets = task.assets.filter((a) => a.id !== input.assetId);
    task.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(task.updatedAt) + 1),
    ).toISOString();
    this.event("asset.unlinked", this.human(), task, {
      assetId: input.assetId,
    });
  }
  async assetPreview(id: string) {
    await this.call("asset_preview", id);
    if (!this.assets.some((a) => a.id === id))
      throw new JamError("not_found", "Asset not found");
    const asset = this.assets.find((a) => a.id === id);
    return asset?.role === "reference" &&
      /\.(png|webp|jpg)$/i.test(asset.location)
      ? new URL("../assets/chibi/danil-laptop-256.webp", import.meta.url).href
      : null;
  }
  private validateMember(input: {
    name: string;
    color: string;
    avatar?: string | null;
  }) {
    if (
      !input.name.trim() ||
      input.name.length > 40 ||
      ![
        "#5B8DEF",
        "#E0679A",
        "#3FA37A",
        "#9B7BE0",
        "#F07E5F",
        "#D8A630",
      ].includes(input.color) ||
      (input.avatar?.length ?? 0) > 16
    )
      throw new JamError(
        "validation",
        "Check the name, palette color and emoji",
      );
  }
  async createMember(input: NewMember) {
    await this.call("create_member", input);
    this.validateMember(input);
    const base =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "human";
    let handle = base;
    let n = 2;
    while (this.members.some((m) => m.handle === handle)) handle = base + n++;
    const member: Member = {
      ...input,
      avatar: input.avatar ?? null,
      id: crypto.randomUUID(),
      kind: "human",
      handle,
      client: null,
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
    };
    this.members.push(member);
    this.event("member.joined", this.human(), undefined, {
      memberId: member.id,
      name: member.name,
    });
    return clone(member);
  }
  async updateMember(input: MemberEdit) {
    await this.call("update_member", input);
    const member = this.members.find((m) => m.id === input.id);
    if (!member) throw new JamError("not_found", "Member not found");
    if (member.kind === "agent" && input.avatar != null)
      throw new JamError(
        "validation",
        "Only name and color can be edited for agents",
      );
    const next = {
      ...member,
      name: input.name ?? member.name,
      color: input.color ?? member.color,
      avatar: input.avatar ?? member.avatar,
    };
    this.validateMember(next);
    Object.assign(member, next);
    if (this.state.currentMember?.id === member.id)
      this.state.currentMember = member;
    this.event("member.updated", this.human(), undefined, {
      memberId: member.id,
    });
    return clone(member);
  }
  async getSettings(): Promise<Settings> {
    await this.call("get_settings");
    return {
      theme: this.state.theme,
      soundEnabled: this.soundEnabled,
      projectId: this.state.jam?.id ?? null,
      projectFolder: null,
      colorBy: "epic",
      estimatesEnabled: false,
      wipLimit: 6,
      ...this.boardSettings[this.state.jam?.id ?? ""],
      assetsView: this.assetsView,
      collapsedAssetKinds: this.collapsedAssetKinds,
    };
  }
  async setSettings(input: SettingsPatch) {
    await this.call("set_settings", input);
    if (input.theme != null) {
      if (!["system", "light", "dark"].includes(input.theme))
        throw new JamError("validation", "Invalid theme");
    }
    const id = this.state.jam?.id ?? "";
    if (input.projectFolder != null && input.expectedProjectId !== id)
      throw new JamError(
        "conflict",
        "The project changed before saving its folder",
      );
    if (
      input.projectFolder != null &&
      (input.projectFolder.length > 4096 ||
        Array.from(input.projectFolder).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ))
    )
      throw new JamError("validation", "Choose a valid project folder");
    if (
      input.colorBy != null &&
      !["none", "assignee", "epic"].includes(input.colorBy)
    )
      throw new JamError("validation", "Invalid color mode");
    if (
      input.wipLimit != null &&
      (!Number.isInteger(input.wipLimit) ||
        input.wipLimit < 1 ||
        input.wipLimit > 999)
    )
      throw new JamError("validation", "Use 1-999");
    if (
      input.assetsView != null &&
      !["grid", "list"].includes(input.assetsView)
    )
      throw new JamError("validation", "Choose grid or list");
    if (
      input.collapsedAssetKinds?.some(
        (kind) => !["sprite", "audio", "level", "font", "other"].includes(kind),
      )
    )
      throw new JamError("validation", "Unknown asset kind");
    if (input.theme != null) this.state.theme = input.theme;
    if (input.soundEnabled != null) this.soundEnabled = input.soundEnabled;
    this.boardSettings[id] = {
      projectFolder:
        input.projectFolder != null
          ? input.projectFolder.trim() || null
          : (this.boardSettings[id]?.projectFolder ?? null),
      colorBy: input.colorBy ?? this.boardSettings[id]?.colorBy ?? "epic",
      estimatesEnabled:
        input.estimatesEnabled ??
        this.boardSettings[id]?.estimatesEnabled ??
        false,
      wipLimit: input.wipLimit ?? this.boardSettings[id]?.wipLimit ?? 6,
    };
    if (input.assetsView != null) this.assetsView = input.assetsView;
    if (input.collapsedAssetKinds != null)
      this.collapsedAssetKinds = input.collapsedAssetKinds;
    this.checkpoint();
    return this.getSettings();
  }
  async resetJam(input: { confirmName: string }) {
    await this.call("reset_jam", input);
    if (input.confirmName !== this.state.jam?.name)
      throw new JamError("validation", "Type the exact jam name");
    if (this.tasks.some((task) => task.status === "in_progress"))
      throw new JamError(
        "validation",
        "Tasks are still in progress. Pause new work and let running tasks finish or release them before archiving.",
      );
    this.event("jam.archived", this.human());
    this.stashProject(true);
    this.state.hasJam = false;
    this.state.jam = null;
    this.tasks = [];
    this.planData = { epics: [], stories: [], questions: [] };
    this.executionData = emptyExecution();
    this.assets = [];
    this.activity = [];
    this.canvasData = emptyCanvas();
    const next = Object.values(this.projects)
      .filter((p) => !p.archived)
      .sort((a, b) =>
        (b.state.jam?.createdAt ?? "").localeCompare(
          a.state.jam?.createdAt ?? "",
        ),
      )[0];
    if (next) this.openProject(next);
    this.checkpoint();
    return clone(this.state);
  }
  async exportJamJson() {
    await this.call("export_jam_json");
    this.exported = clone({
      canvasData: this.canvasData,
      planData: this.planData,
      state: this.state,
      tasks: this.tasks,
      members: this.members,
      assets: this.assets,
      activity: this.activity,
    });
    return { path: "mock://jam-export.json" };
  }
  async importJamJson(path: string) {
    await this.call("import_jam_json", path);
    if (path !== "mock://jam-export.json" || !this.exported)
      throw new JamError("validation", "Invalid Jam Board JSON");
    const snapshot = clone(this.exported),
      actor = this.human(),
      theme = this.state.theme;
    const prefix = this.nextProjectPrefix();
    this.stashProject();
    const oldKeys = new Map(
      snapshot.tasks.map((t, i) => [t.key, `${prefix}-${i + 1}`]),
    );
    const jid = crypto.randomUUID(),
      ids = new Map<string, string>();
    for (const member of snapshot.members) {
      const existing = this.members.find((m) => m.handle === member.handle);
      if (existing) {
        if (existing.kind !== member.kind)
          throw new JamError(
            "validation",
            "A handle has a different member kind",
          );
        ids.set(member.id, existing.id);
      } else {
        const id = crypto.randomUUID();
        ids.set(member.id, id);
        this.members.push({ ...member, id });
      }
    }
    for (const row of [
      ...(snapshot.canvasData?.items ?? []),
      ...(snapshot.canvasData?.frames ?? []),
      ...(snapshot.canvasData?.edges ?? []),
    ])
      ids.set(row.id, crypto.randomUUID());
    for (const task of snapshot.tasks) ids.set(task.id, crypto.randomUUID());
    for (const asset of snapshot.assets) ids.set(asset.id, crypto.randomUUID());
    if (snapshot.state.jam) ids.set(snapshot.state.jam.id, jid);
    for (const entity of [
      ...snapshot.planData.epics,
      ...snapshot.planData.stories,
    ]) {
      ids.set(entity.id, crypto.randomUUID());
      oldKeys.set(entity.key, entity.key.replace(/^.*-(E|S)/, `${prefix}-$1`));
    }
    for (const q of snapshot.planData.questions)
      ids.set(q.id, crypto.randomUUID());
    for (const task of snapshot.tasks) {
      for (const entity of [
        task.epic,
        task.story,
        ...task.reports,
        ...task.reviews,
        ...task.references,
        ...task.comments,
      ]) {
        if (!ids.has(entity.id)) ids.set(entity.id, crypto.randomUUID());
      }
      for (const entity of [task.epic, task.story])
        oldKeys.set(
          entity.key,
          entity.key.replace(/^.*-(E|S)/, `${prefix}-$1`),
        );
    }
    const mapped = (id: string) => ids.get(id) ?? id;
    const remap = <T>(value: T): T => {
      if (typeof value === "string")
        return (oldKeys.get(value) ?? mapped(value)) as T;
      if (Array.isArray(value)) return value.map(remap) as T;
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, v]) => [key, remap(v)]),
        ) as T;
      return value;
    };
    this.assets = snapshot.assets.map((a) => ({
      ...a,
      id: mapped(a.id),
      jamId: jid,
      createdBy: mapped(a.createdBy),
    }));
    const remapEvent = (e: ActivityEvent): ActivityEvent => ({
      ...remap(e),
      actor: { ...remap(e.actor), id: mapped(e.actor.id) },
      taskKey: e.taskKey ? oldKeys.get(e.taskKey) : undefined,
      sentence: e.sentence?.replace(
        /\b[A-Za-z0-9]+-(?:E|S)?\d+\b/g,
        (key) => oldKeys.get(key) ?? key,
      ),
    });
    this.activity = snapshot.activity.map(remapEvent);
    this.planData = remap(snapshot.planData);
    this.executionData = emptyExecution();
    this.canvasData = remap(snapshot.canvasData ?? emptyCanvas());
    this.tasks = snapshot.tasks.map((t) => ({
      ...t,
      story: remap(t.story),
      epic: remap(t.epic),
      storyId: mapped(t.storyId ?? ""),
      epicId: mapped(t.epicId ?? ""),
      epicKey: oldKeys.get(t.epicKey ?? "") ?? t.epicKey,
      reports: remap(t.reports),
      reviews: remap(t.reviews),
      references: remap(t.references),
      key: oldKeys.get(t.key) ?? t.key,
      id: mapped(t.id),
      claimGeneration: crypto.randomUUID(),
      reviewContextRevision: null,
      jamId: jid,
      createdBy: mapped(t.createdBy),
      updatedBy: mapped(t.updatedBy),
      assigneeId: t.assigneeId ? mapped(t.assigneeId) : null,
      assets: t.assets
        .map((a) => this.assets.find((x) => x.id === mapped(a.id)))
        .filter((a): a is Asset => !!a),
      comments: t.comments.map((c) => ({
        ...c,
        id: crypto.randomUUID(),
        taskId: mapped(t.id),
        authorId: mapped(c.authorId),
      })),
      activity: t.activity.map(remapEvent),
      history: t.history.map(remapEvent),
      idempotencyKey: null,
    }));
    this.state = {
      ...snapshot.state,
      theme,
      currentMember: actor,
      hasJam: true,
      jam: snapshot.state.jam
        ? {
            ...snapshot.state.jam,
            id: jid,
            keyPrefix: prefix,
            createdAt: new Date().toISOString(),
            taskSeq: this.tasks.length,
          }
        : null,
    };
    this.event("jam.imported", actor);
    return clone(this.state);
  }
  async pickFile(jsonOnly: boolean) {
    await this.call("pick_file", jsonOnly);
    return jsonOnly && this.exported ? "mock://jam-export.json" : null;
  }
  async mcpStatus() {
    await this.call("mcp_status");
    return {
      projectId: this.state.jam?.id ?? null,
      projectKeyPrefix: this.state.jam?.keyPrefix ?? null,
      httpEnabled: this.httpEnabled,
      running: this.httpEnabled,
      port: 47321,
      tokenTail: this.mockToken.slice(-4),
      sidecarPath: "C:\\Jam Board\\jam-board-mcp.exe",
      dataDir: "C:\\Jam Board\\data",
      recentCalls: clone(this.recentCalls),
    };
  }
  async setMcpHttpEnabled(enabled: boolean) {
    await this.call("set_mcp_http_enabled", enabled);
    this.httpEnabled = enabled;
    this.checkpoint();
    for (const cb of this.mcpListeners) cb();
  }
  async regenerateMcpToken() {
    await this.call("regenerate_mcp_token");
    this.mockToken = crypto.randomUUID();
    this.checkpoint();
    for (const cb of this.mcpListeners) cb();
  }
  async revealMcpToken() {
    await this.call("reveal_mcp_token");
    return this.mockToken;
  }
  async mcpConfigSnippets() {
    await this.call("mcp_config_snippets");
    return makeSnippets(await this.mcpStatus(), this.mockToken);
  }
  onMcpChanged(cb: () => void) {
    this.mcpListeners.add(cb);
    return () => {
      this.mcpListeners.delete(cb);
    };
  }
  onFileDrop(cb: (paths: string[]) => void, active?: (value: boolean) => void) {
    const listener = { cb, active };
    this.fileDropListeners.add(listener);
    return () => {
      this.fileDropListeners.delete(listener);
    };
  }
  simulateFileDrop(paths: string[]) {
    for (const listener of this.fileDropListeners) {
      listener.active?.(false);
      listener.cb(paths);
    }
  }
  async showInFolder(path: string) {
    await this.call("show_in_folder", path);
  }
  async openUrl(url: string) {
    await this.call("open_url", url);
  }
  async setTheme(theme: Theme) {
    await this.call("set_theme", theme);
    this.state.theme = theme;
    this.checkpoint();
  }
  async simulateAgent(input: AgentSimulation) {
    const names: Record<AgentSimulation["action"], string> = {
      "task.created": "create_task",
      "task.moved": "move_task",
      "task.claimed": "claim_task",
      "comment.added": "add_comment",
      "task.updated": "update_task",
      "task.brief_updated": "update_task_brief",
      "agent.status": "set_status",
      "report.submitted": "submit_report",
      "question.asked": "ask_user",
      "reference.added": "add_reference",
      "execution.requested": "request_execution",
    };
    const call = {
      at: new Date().toISOString(),
      agent:
        this.members.find((m) => m.handle === (input.agent ?? "codex"))?.name ??
        input.agent ??
        "Codex",
      tool: names[input.action],
      ok: true,
      error: null as string | null,
    };
    try {
      return await this.agentAction(input);
    } catch (error) {
      call.ok = false;
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.recentCalls.unshift(call);
      this.recentCalls.length = Math.min(20, this.recentCalls.length);
      for (const cb of this.mcpListeners) cb();
    }
  }
  private async agentAction(input: AgentSimulation) {
    let actor = this.members.find(
      (m) => m.kind === "agent" && m.handle === (input.agent ?? "codex"),
    );
    if (!actor) {
      const handle = input.agent ?? "codex";
      actor = {
        id: crypto.randomUUID(),
        kind: "agent",
        name:
          handle === "codex"
            ? "Codex"
            : handle === "claude"
              ? "Claude"
              : handle,
        handle,
        color:
          [
            "#5B8DEF",
            "#E0679A",
            "#3FA37A",
            "#9B7BE0",
            "#F07E5F",
            "#D8A630",
          ].find((c) => !this.members.some((m) => m.color === c)) ?? "#9B7BE0",
        avatar: null,
        client: handle.includes("claude") ? "claude-code" : "codex",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        statusText: "",
        statusScope: null,
        statusAt: null,
      };
      this.members.push(actor);
      this.event("member.joined", actor);
    }
    actor.lastSeenAt = input.lastSeenAt ?? new Date().toISOString();
    if (input.action === "execution.requested") {
      if (!input.scope || !["epic", "story"].includes(input.scope.type))
        throw new JamError("validation", "Choose an epic or story to start");
      return this.execution.request(
        { type: input.scope.type as "epic" | "story", id: input.scope.id },
        input.text ?? "The plan is ready for this scope.",
        actor,
      );
    }
    if (input.action === "reference.added")
      return this.canvas.add(
        input.reference ?? {
          kind: "note",
          text: input.text ?? "A warm lantern palette",
          title: input.title ?? "Agent reference",
        },
        actor,
      );
    if (input.action === "question.asked")
      return this.planning.askUser(
        input.question ?? {
          scope: input.scope ?? { type: "task", id: input.key ?? "JB-12" },
          title: input.title ?? "Which lantern color?",
          bodyMd: "Choose a warm light.",
          options: [
            { label: "Warm amber", description: "Keep the cozy palette" },
            { label: "Cool blue", description: "A colder contrast" },
          ],
          recommendedIndex: 0,
          allowFreeText: true,
          roundLabel: "Round 1",
        },
        actor,
      );
    if (input.action === "agent.status") {
      actor.statusText = input.text ?? "Working on the next step";
      actor.statusScope = input.scope ?? null;
      actor.statusAt = input.statusAt ?? new Date().toISOString();
      this.event(
        "agent.status",
        actor,
        undefined,
        {},
        undefined,
        `${actor.name}: ${actor.statusText}`,
      );
      return clone(actor);
    }
    if (input.action === "report.submitted")
      return this.planning.submitReport(
        input.report ?? {
          key: input.key ?? "JB-12",
          expectedClaimGeneration:
            this.find(input.key ?? "JB-12").claimGeneration ?? "",
          summaryMd: "Implemented the lantern cue.",
          changedFiles: ["game/lantern.gd"],
          tests: [
            {
              name: "1",
              command: "run lantern tests",
              expected: "One safe tile",
              actual: "Two tiles",
              result: "FAIL",
            },
          ],
          deviationsMd: "",
          notVerifiedMd: "Controller hardware",
        },
        actor,
      );
    if (input.action === "task.created")
      return this.create(
        {
          title: input.title ?? "Add jump buffer",
          status: input.status ?? "ready",
        },
        actor,
      );
    const task = this.tasks.find((t) => t.key === input.key);
    if (!task) throw new JamError("not_found", "Choose an existing task");
    if (
      input.action === "task.updated" ||
      input.action === "task.brief_updated"
    )
      return this.patchTask(
        {
          key: task.key,
          expectedUpdatedAt: task.updatedAt,
          ...input.patch,
          ...(input.title ? { title: input.title } : {}),
        },
        actor,
      );
    if (input.action === "task.moved")
      return this.move(
        {
          key: task.key,
          expectedUpdatedAt: task.updatedAt,
          status: input.status ?? "review",
        },
        actor,
      );
    if (input.action === "task.claimed") {
      if (task.assigneeId && task.assigneeId !== actor.id)
        throw new JamError("claim_conflict", "Already held by another member");
      if (task.status !== "ready" && task.epic.brainMemberId !== actor.id)
        throw new JamError(
          task.status === "backlog" ? "not_ready" : "wrong_status",
          `Expected ready, current status is ${task.status}`,
        );
      this.guardReady(task, actor);
      if (task.status !== "in_progress" || task.assigneeId !== actor.id)
        this.execution.requireTaskStart(task);
      task.assigneeId = actor.id;
      task.status = "in_progress";
    } else {
      task.comments.push({
        id: crypto.randomUUID(),
        taskId: task.id,
        authorId: actor.id,
        bodyMd: "Ready for a playtest.",
        createdAt: new Date().toISOString(),
      });
      task.commentCount++;
    }
    this.touch(task, actor);
    this.event(input.action, actor, task);
    return clone(task);
  }
  private touch(task: TaskDetail, actor: Member) {
    task.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(task.updatedAt) + 1),
    ).toISOString();
    task.updatedBy = actor.id;
  }
  private find(key: string) {
    const task = this.tasks.find((t) => t.key === key);
    if (!task) throw new JamError("not_found", `Task ${key} was not found`);
    return task;
  }
  private patchTask(input: UpdateInput, actor: Member) {
    if (!input.expectedUpdatedAt)
      throw new JamError(
        "validation",
        "A task version is required",
        "expectedUpdatedAt",
      );
    const task = this.find(input.key);
    if (task.archivedAt)
      throw new JamError("archived", "Unarchive this task first");
    if (task.updatedAt !== input.expectedUpdatedAt)
      throw new JamError(
        "conflict",
        "This task changed. Review the latest version before saving.",
      );
    const next = { ...task };
    if (input.title != null) next.title = input.title.trim();
    if (!next.title || next.title.length > 140)
      throw new JamError("validation", "Use 1–140 characters", "title");
    if (input.brief) {
      validateBrief(input.brief);
      next.brief = clone(input.brief);
    }
    if (input.status != null) {
      if (input.status === "done" && actor.kind !== "human")
        throw new JamError(
          "forbidden",
          "Agents must use independent report review to mark Done",
        );
      if (input.status === "ready" && task.status !== "ready")
        this.guardReady(next, actor);
      next.status = input.status;
    }
    if (!statuses.includes(next.status as Status))
      throw new JamError("validation", "Unknown status", "status");
    if (input.priority != null) next.priority = input.priority;
    if (!["low", "medium", "high", "critical"].includes(next.priority))
      throw new JamError("validation", "Unknown priority", "priority");
    if (input.descriptionMd != null) next.descriptionMd = input.descriptionMd;
    if (input.assigneeId !== undefined) {
      if (
        input.assigneeId &&
        !this.members.some((m) => m.id === input.assigneeId)
      )
        throw new JamError("validation", "Unknown member", "assigneeId");
      next.assigneeId = input.assigneeId;
    }
    if (input.estimate !== undefined) next.estimate = input.estimate;
    if (next.estimate !== null && ![1, 2, 3, 5, 8].includes(next.estimate))
      throw new JamError("validation", "Choose 1, 2, 3, 5 or 8", "estimate");
    if (input.dueAt !== undefined) next.dueAt = input.dueAt;
    if (next.dueAt && !Number.isFinite(Date.parse(next.dueAt)))
      throw new JamError("validation", "Invalid date", "dueAt");
    if (input.tags)
      next.tags = [
        ...new Set(
          input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
        ),
      ].sort();
    if (next.tags.some((t) => t.length > 24))
      throw new JamError(
        "validation",
        "Tags use at most 24 characters",
        "tags",
      );
    if (next.status !== task.status)
      next.position =
        Math.max(
          0,
          ...this.tasks
            .filter((t) => t.status === next.status && !t.archivedAt)
            .map((t) => t.position ?? 0),
        ) + 1024;
    if (
      next.status === "in_progress" &&
      (task.status !== "in_progress" ||
        (!!next.assigneeId && next.assigneeId !== task.assigneeId))
    )
      this.execution.requireTaskStart(next);
    const payload = Object.fromEntries(
      Object.keys(input)
        .filter((k) => !["key", "expectedUpdatedAt"].includes(k))
        .map((k) => [
          k,
          [
            (task as unknown as Record<string, ActivityEvent["payload"]>)[k] ??
              null,
            (next as unknown as Record<string, ActivityEvent["payload"]>)[k] ??
              null,
          ],
        ]),
    );
    Object.assign(task, next);
    this.touch(task, actor);
    this.planning.sync();
    this.event(
      input.brief ? "task.brief_updated" : "task.updated",
      actor,
      task,
      payload,
    );
    return clone(task);
  }
  async updateTask(input: UpdateInput) {
    await this.call("update_task", input);
    return this.patchTask(input, this.human());
  }
  async archiveTask(key: string, reason?: string) {
    await this.call("archive_task", { key, reason });
    const actor = this.human();
    const task = this.find(key);
    if (task.archivedAt) throw new JamError("archived", "Already archived");
    if (reason !== undefined && (!reason.trim() || reason.length > 4000))
      throw new JamError("validation", "Use at most 4000 characters", "reason");
    if (reason?.trim()) {
      task.comments.push({
        id: crypto.randomUUID(),
        taskId: task.id,
        authorId: actor.id,
        bodyMd: reason.trim(),
        createdAt: new Date().toISOString(),
      });
      task.commentCount++;
    }
    task.archivedAt = new Date().toISOString();
    this.touch(task, actor);
    this.event("task.archived", actor, task, { reason: reason ?? null });
    return clone(task);
  }
  async unarchiveTask(key: string) {
    await this.call("unarchive_task", key);
    const actor = this.human();
    const task = this.find(key);
    task.archivedAt = null;
    this.touch(task, actor);
    this.event("task.updated", actor, task, { archivedAt: ["archived", null] });
    return clone(task);
  }
  async addComment(input: { key: string; bodyMd: string }) {
    await this.call("add_comment", input);
    const actor = this.human();
    const task = this.find(input.key);
    if (task.archivedAt)
      throw new JamError("archived", "Unarchive this task first");
    if (!input.bodyMd.trim() || input.bodyMd.length > 4000)
      throw new JamError("validation", "Use 1–4000 characters", "bodyMd");
    const comment = {
      id: crypto.randomUUID(),
      taskId: task.id,
      authorId: actor.id,
      bodyMd: input.bodyMd.trim(),
      createdAt: new Date().toISOString(),
    };
    task.comments.push(comment);
    task.commentCount++;
    this.touch(task, actor);
    this.event("comment.added", actor, task);
    return clone(comment);
  }
  async listTasks(input: TaskQuery) {
    await this.call("list_tasks", input);
    this.planning.sync();
    const selectedTags = (input.tags ?? [])
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    if (input.status?.some((s) => !statuses.includes(s as Status)))
      throw new JamError("validation", "Unknown task status", "status");
    if (input.tags?.some((t) => t.trim().length > 24))
      throw new JamError(
        "validation",
        "Tags use at most 24 characters",
        "tags",
      );
    if (
      input.sort &&
      (![
        "key",
        "title",
        "status",
        "priority",
        "assignee",
        "estimate",
        "updatedAt",
      ].includes(input.sort.field) ||
        !["asc", "desc"].includes(input.sort.dir))
    )
      throw new JamError("validation", "Unknown sort", "sort");
    const tasks = this.tasks.filter(
      (t) =>
        (!input.epic || t.epicKey === input.epic || t.epicId === input.epic) &&
        (!input.story ||
          t.storyKey === input.story ||
          t.storyId === input.story) &&
        (input.ready == null || t.ready === input.ready) &&
        (input.changesRequested == null ||
          t.changesRequested === input.changesRequested) &&
        (input.needsInfo == null || t.needsInfo === input.needsInfo) &&
        (input.includeArchived || !t.archivedAt) &&
        (!input.status?.length || input.status.includes(t.status)) &&
        (!selectedTags.length ||
          selectedTags.some((tag) => t.tags.includes(tag))) &&
        (!input.text ||
          `${t.key} ${t.title} ${t.descriptionMd}`
            .toLowerCase()
            .includes(input.text.toLowerCase())) &&
        (!input.assignee ||
          (input.assignee === "unassigned"
            ? !t.assigneeId
            : input.assignee === "agents" || input.assignee === "humans"
              ? this.members.find((m) => m.id === t.assigneeId)?.kind ===
                (input.assignee === "agents" ? "agent" : "human")
              : t.assigneeId === input.assignee)),
    );
    const field = input.sort?.field ?? "key";
    const dir = input.sort?.dir === "desc" ? -1 : 1;
    const value = (t: TaskDetail): string | number =>
      field === "key"
        ? Number(t.key.split("-").at(-1))
        : field === "status"
          ? statuses.indexOf(t.status as Status)
          : field === "priority"
            ? ["low", "medium", "high", "critical"].indexOf(t.priority)
            : field === "assignee"
              ? (this.members
                  .find((m) => m.id === t.assigneeId)
                  ?.name.toLowerCase() ?? "")
              : field === "estimate"
                ? (t.estimate ?? -1)
                : field === "title"
                  ? t.title.toLowerCase()
                  : `${t.updatedAt.slice(0, 19)}.${(t.updatedAt.includes(".") ? t.updatedAt.slice(20, -1) : "").padEnd(9, "0")}`;
    tasks.sort((a, b) => {
      const av = value(a),
        bv = value(b);
      return (
        (av < bv ? -1 : av > bv ? 1 : 0) * dir ||
        Number(a.key.split("-").at(-1)) - Number(b.key.split("-").at(-1))
      );
    });
    if (tasks.length > 5000)
      throw new JamError("validation", "Refine filters to at most 5000 tasks");
    return { tasks: clone(tasks), total: tasks.length };
  }
  async listTags() {
    await this.call("list_tags");
    const counts = new Map<string, number>();
    for (const task of this.tasks.filter((t) => !t.archivedAt))
      for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, count]) => ({ tag, count }));
  }
  async runtimeInfo() {
    return {
      dataDir: ".dev-data",
      sidecarPath: "C:\\Jam Board\\jam-board-mcp.exe",
    };
  }
  async seedWorkingPresence(count = 50, taskScoped = false) {
    if (
      !(import.meta.env.DEV || import.meta.env.VITE_MOCK_BRIDGE === "1") ||
      count < 1 ||
      !Number.isInteger(count) ||
      count > (taskScoped ? 5000 : 50) ||
      (taskScoped && count > this.tasks.length)
    )
      throw new JamError(
        "validation",
        "Working fixture needs valid agents and one existing task per scoped agent",
      );
    await this.call("seed_working_presence", { count, taskScoped });
    const base = this.members.find((m) => m.kind === "agent");
    if (!base) throw new JamError("validation", "Seed bulk tasks first");
    const now = new Date().toISOString();
    const workers: Member[] = Array.from({ length: count }, (_, i) => ({
      ...base,
      id: crypto.randomUUID(),
      name: `Worker ${i + 1}`,
      handle: `perf-worker-${i + 1}`,
      lastSeenAt: now,
      statusAt: now,
      statusText: "Synthetic QA activity — no real worker session",
      statusScope: taskScoped
        ? { type: "task", id: this.tasks[i]?.id ?? "" }
        : null,
    }));
    this.members.push(...workers);
    // Explicit benchmark-only historical presence, never a grant of new work.
    // A scoped actor reports activity on exactly one task, not every assignment.
    const targets = taskScoped ? this.tasks.slice(0, count) : this.tasks;
    for (const [i, task] of targets.entries()) {
      task.assigneeId = workers[i % workers.length]?.id ?? null;
      task.status = "in_progress";
    }
    this.checkpoint();
  }

  async seedBulk(n: number) {
    await this.call("seed_bulk", n);
    if (
      !(import.meta.env.DEV || import.meta.env.VITE_MOCK_BRIDGE === "1") ||
      !Number.isInteger(n) ||
      n < 0 ||
      n > 5000
    )
      throw new JamError("validation", "Debug seed limit is 5000");
    const listeners = this.listeners;
    const persist = this.persist;
    this.listeners = new Set();
    this.persist = false;
    try {
      for (const member of fixture.members) {
        if (
          !this.members.some((existing) => existing.handle === member.handle)
        ) {
          const added = {
            ...member,
            lastSeenAt:
              member.kind === "agent"
                ? new Date().toISOString()
                : member.lastSeenAt,
          } as Member;
          this.members.push(added);
          this.event("member.joined", added);
        }
      }
      while (this.planData.epics.length < 5) {
        await this.createEpic({
          title: `Bulk epic ${this.planData.epics.length + 1}`,
          goalMd: "A coherent lantern route",
          doneWhenMd: "Playtest passes",
        });
      }
      for (const e of this.planData.epics.slice(0, 5)) {
        e.status = "active";
        while (
          this.planData.stories.filter((s) => s.epicId === e.id).length < 4
        ) {
          const s = await this.createStory({
            epicKey: e.key,
            title: "Bulk story",
            outcomeMd: "A readable route",
            acceptance: [
              {
                id: "1",
                criterion: "Readable",
                mandatory: true,
                check: "Playtest",
              },
            ],
          });
          this.planning.story(s.key).status = "active";
        }
      }
      const bulkStories = this.planData.stories
        .filter((s) => s.status === "active")
        .slice(0, 20);
      for (let i = 0; i < n; i++) {
        const created = this.create(
          {
            title: `Bulk task ${i + 1}: polish the lantern village`,
            storyKey: bulkStories[i % bulkStories.length]?.key,
            tags: ["gameplay", i % 2 ? "polish" : "ui"],
            estimate: [1, 2, 3, 5, 8][i % 5],
            status: "backlog",
            priority: ["low", "medium", "high", "critical"][i % 4],
          },
          this.human(),
          true,
        );
        // Synthetic historical benchmark data, not a grant of future work.
        this.find(created.key).status = statuses[i % 5] ?? "ready";
        const task = this.tasks.at(-1);
        if (task)
          task.assigneeId =
            i % 4 === 0
              ? null
              : (this.members[i % this.members.length]?.id ?? null);
      }
    } finally {
      this.listeners = listeners;
      this.persist = persist;
    }
    this.checkpoint();
    this.emit(this.activity.slice(-n));
  }
}
export const mockApi = new MockBridge(import.meta.env.VITE_MOCK_BRIDGE === "1");
declare global {
  interface Window {
    __jamMock: MockBridge;
  }
}
if (import.meta.env.VITE_MOCK_BRIDGE === "1") window.__jamMock = mockApi;
