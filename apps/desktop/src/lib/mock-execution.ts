import type { Epic, Story } from "../bindings";
import type {
  ExecutionRequest,
  ExecutionScope,
  ExecutionState,
  ResolveExecutionRequest,
  SetExecution,
} from "./execution-api";
import type { PlanData } from "./mock-planning";
import { JamError, type Member, type TaskDetail } from "./types";

type Grant = {
  state: "inherit" | "running" | "paused";
  revision: string;
  changedBy: string;
  changedAt: string;
};
export type MockExecutionData = {
  grants: Record<string, Grant>;
  requests: ExecutionRequest[];
};
export const emptyExecution = (): MockExecutionData => ({
  grants: {},
  requests: [],
});
type Host = {
  data(): MockExecutionData;
  plan(): PlanData;
  tasks(): TaskDetail[];
  project(): { id: string } | null;
  human(): Member;
  call(name: string, input?: unknown): Promise<void>;
  changed(action: string, actor: Member, scope: ExecutionScope): void;
};
const clone = <T>(value: T): T => structuredClone(value);
const slot = (scope: ExecutionScope) => `${scope.type}:${scope.id}`;
const closed = (value: Epic | Story) =>
  !!value.archivedAt || ["archived", "done"].includes(value.status);

/** Deliberately isolated UI simulator. Rust tests, not this model, establish authorization. */
export class MockExecution {
  constructor(private host: Host) {}
  private target(scope: ExecutionScope) {
    const project = this.host.project();
    if (!project) throw new JamError("not_found", "No active project");
    const list =
      scope.type === "epic" ? this.host.plan().epics : this.host.plan().stories;
    const entity = list.find(
      (item) => item.id === scope.id || item.key === scope.id,
    );
    if (!entity || entity.jamId !== project.id)
      throw new JamError(
        "not_found",
        "Execution scope not found in this project",
      );
    const epic =
      scope.type === "epic"
        ? (entity as Epic)
        : this.host
            .plan()
            .epics.find((item) => item.id === (entity as Story).epicId);
    if (!epic) throw new JamError("not_found", "Parent epic not found");
    return {
      project,
      entity,
      epic,
      scope: { type: scope.type, id: entity.id },
    };
  }
  state(scope: ExecutionScope): ExecutionState {
    const target = this.target(scope);
    const grant = this.host.data().grants[slot(target.scope)];
    const parent = this.host.data().grants[`epic:${target.epic.id}`];
    const ownState =
      grant?.state ?? (scope.type === "story" ? "inherit" : "paused");
    const blockedReason =
      closed(target.entity) || closed(target.epic)
        ? "Reopen this scope and its parent before starting new work."
        : null;
    const inherited = scope.type === "story" && ownState === "inherit";
    const effectiveState =
      !blockedReason &&
      (ownState === "running" || (inherited && parent?.state === "running"))
        ? "running"
        : "paused";
    const tasks = this.host
      .tasks()
      .filter((task) =>
        scope.type === "epic"
          ? task.epicId === target.entity.id
          : task.storyId === target.entity.id,
      );
    return {
      projectId: target.project.id,
      scope: target.scope,
      scopeKey: target.entity.key,
      scopeTitle: target.entity.title,
      ownState,
      effectiveState,
      source: inherited ? "epic" : grant ? "scope" : "none",
      revision: `${target.project.id}/${parent?.revision ?? "0"}/${grant?.revision ?? "0"}/${
        scope.type === "epic"
          ? this.host
              .plan()
              .stories.filter((story) => story.epicId === target.entity.id)
              .map(
                (story) =>
                  this.host.data().grants[`story:${story.id}`]?.revision ?? "0",
              )
              .join(":")
          : ""
      }`,
      canStart: !blockedReason,
      blockedReason,
      inProgressCount: tasks.filter((task) => task.status === "in_progress")
        .length,
      readyCount: tasks.filter(
        (task) => !task.archivedAt && task.status === "ready",
      ).length,
      runningStoryCount:
        scope.type === "epic"
          ? this.host
              .plan()
              .stories.filter(
                (story) =>
                  story.epicId === target.entity.id &&
                  this.state({ type: "story", id: story.id }).effectiveState ===
                    "running",
              ).length
          : 0,
      changedBy: grant?.changedBy ?? null,
      changedAt: grant?.changedAt ?? null,
    };
  }
  async get(scope: ExecutionScope) {
    await this.host.call("get_execution", scope);
    return clone(this.state(scope));
  }
  async list() {
    await this.host.call("list_execution");
    return [
      ...this.host
        .plan()
        .epics.map((entity) => this.state({ type: "epic", id: entity.id })),
      ...this.host
        .plan()
        .stories.map((entity) => this.state({ type: "story", id: entity.id })),
    ];
  }
  private grant(scope: ExecutionScope, state: Grant["state"], actor: Member) {
    this.host.data().grants[slot(scope)] = {
      state,
      revision: crypto.randomUUID(),
      changedBy: actor.id,
      changedAt: new Date().toISOString(),
    };
  }
  private supersede() {
    for (const request of this.host.data().requests) {
      if (
        request.status === "pending" &&
        request.revision !== this.state(request.scope).revision
      ) {
        request.status = "superseded";
        request.resolvedAt = new Date().toISOString();
      }
    }
  }
  private change(input: SetExecution, actor: Member) {
    if (actor.kind !== "human")
      throw new JamError(
        "forbidden",
        "Only a human can start or pause a scope",
      );
    const state = this.state(input.scope);
    if (input.expectedRevision !== state.revision)
      throw new JamError(
        "conflict",
        "The scope changed. Review its latest state before deciding.",
      );
    if (input.action === "start" && !state.canStart)
      throw new JamError(
        "execution_required",
        state.blockedReason ?? "Cannot start this scope",
      );
    this.grant(
      state.scope,
      input.action === "start" ? "running" : "paused",
      actor,
    );
    if (state.scope.type === "epic" && input.action === "pause") {
      for (const story of this.host
        .plan()
        .stories.filter((story) => story.epicId === state.scope.id)) {
        const child: ExecutionScope = { type: "story", id: story.id };
        if (this.host.data().grants[slot(child)]?.state === "running")
          this.grant(child, "inherit", actor);
      }
    }
    this.supersede();
    this.host.changed(
      input.action === "start" ? "execution.started" : "execution.paused",
      actor,
      state.scope,
    );
    return clone(this.state(state.scope));
  }
  async set(input: SetExecution) {
    await this.host.call("set_execution", input);
    return this.change(input, this.host.human());
  }
  async requests(status?: string) {
    await this.host.call("list_execution_requests", { status });
    return clone(
      this.host
        .data()
        .requests.filter((request) => !status || request.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  request(scope: ExecutionScope, reason: string, actor: Member) {
    const target = this.target(scope);
    if (actor.kind !== "agent" || target.epic.brainMemberId !== actor.id)
      throw new JamError(
        "forbidden",
        "Only the appointed brain can request a start",
      );
    const state = this.state(scope);
    if (!state.canStart)
      throw new JamError(
        "execution_required",
        state.blockedReason ?? "Cannot start this scope",
      );
    if (state.effectiveState === "running")
      throw new JamError(
        "validation",
        "This scope is already running",
        "scope",
      );
    if (!reason.trim() || reason.length > 4000)
      throw new JamError(
        "validation",
        "Explain the requested work in 1–4000 characters",
        "reason",
      );
    const existing = this.host
      .data()
      .requests.find(
        (request) =>
          request.status === "pending" &&
          slot(request.scope) === slot(state.scope) &&
          request.revision === state.revision,
      );
    if (existing) return clone(existing);
    const request: ExecutionRequest = {
      id: crypto.randomUUID(),
      projectId: state.projectId,
      scope: state.scope,
      scopeKey: state.scopeKey,
      scopeTitle: state.scopeTitle,
      requestedBy: actor.id,
      reason: reason.trim(),
      status: "pending",
      revision: state.revision,
      createdAt: new Date().toISOString(),
      resolvedBy: null,
      resolvedAt: null,
    };
    this.host.data().requests.push(request);
    this.host.changed("execution.requested", actor, state.scope);
    return clone(request);
  }
  async resolve(input: ResolveExecutionRequest) {
    await this.host.call("resolve_execution_request", input);
    const request = this.host
      .data()
      .requests.find((request) => request.id === input.id);
    if (!request)
      throw new JamError(
        "not_found",
        "Start request not found in this project",
      );
    if (
      request.status !== "pending" ||
      request.revision !== input.expectedRevision ||
      this.state(request.scope).revision !== request.revision
    )
      throw new JamError(
        "conflict",
        "This start request is no longer current. Review the latest scope.",
      );
    if (input.decision === "approve" && !this.state(request.scope).canStart)
      throw new JamError(
        "execution_required",
        "This scope cannot be started now",
      );
    const actor = this.host.human();
    if (actor.kind !== "human")
      throw new JamError(
        "forbidden",
        "Only a human can decide a start request",
      );
    // Mark this request before the scope change supersedes other pending requests.
    request.status = input.decision === "approve" ? "approved" : "declined";
    request.resolvedBy = actor.id;
    request.resolvedAt = new Date().toISOString();
    if (input.decision === "approve")
      this.change(
        {
          scope: request.scope,
          action: "start",
          expectedRevision: request.revision,
        },
        actor,
      );
    this.host.changed("execution.resolved", actor, request.scope);
    return clone(request);
  }
  requireTaskStart(task: TaskDetail) {
    const state = this.state({
      type: "story",
      id: task.storyId ?? task.story.id,
    });
    if (state.effectiveState !== "running")
      throw new JamError(
        "execution_required",
        `New work is paused for ${state.scopeKey}. Start its story or epic in Plan, or approve the brain's start request in Inbox. Ready alone is not permission to work.`,
      );
    if (this.target(state.scope).entity.status !== "active")
      throw new JamError(
        "not_ready",
        "Activate this story before taking new work; permission does not replace planning readiness.",
      );
  }
  revokeClosed(actor: Member, project = false, restored?: ExecutionScope) {
    for (const epic of this.host.plan().epics) {
      const epicClosed =
        project ||
        closed(epic) ||
        (restored?.type === "epic" && restored.id === epic.id);
      const scope: ExecutionScope = { type: "epic", id: epic.id };
      if (
        epicClosed &&
        this.host.data().grants[slot(scope)]?.state !== "paused"
      )
        this.grant(scope, "paused", actor);
      for (const story of this.host
        .plan()
        .stories.filter((story) => story.epicId === epic.id)) {
        const child: ExecutionScope = { type: "story", id: story.id };
        if (
          (epicClosed ||
            closed(story) ||
            (restored?.type === "story" && restored.id === story.id)) &&
          this.host.data().grants[slot(child)]?.state !== "paused"
        )
          this.grant(child, "paused", actor);
      }
    }
    this.supersede();
  }
}
