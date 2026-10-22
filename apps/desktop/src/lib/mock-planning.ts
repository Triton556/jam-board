import type {
  AnswerQuestion,
  AskUser,
  BriefPatch_Serialize,
  Epic,
  EpicPatch_Serialize,
  EpicTree,
  Question,
  Readiness,
  ReviewTask,
  Scope,
  Story,
  StoryPatch_Serialize,
  StoryTree,
  SubmitReport,
  TaskBrief,
} from "../bindings";
import type { EpicInput, ReadyTaskInput, StoryInput } from "./planning-api";
import {
  type ActivityEvent,
  JamError,
  type Member,
  type TaskDetail,
} from "./types";
export type PlanData = {
  epics: Epic[];
  stories: Story[];
  questions: Question[];
};
export const emptyBrief = (): Required<TaskBrief> => ({
  goalMd: "",
  contextMd: "",
  whereMd: "",
  changes: [],
  tests: [],
  boundariesMd: "",
  resultMd: "",
  userQuotesMd: "",
});
export function mockReadiness(
  t: Pick<TaskDetail, "brief" | "story">,
): Readiness {
  const b = { ...emptyBrief(), ...t.brief };
  const missing = [
    ["goal", "Goal is empty", !b.goalMd.trim()],
    ["where", "Where is empty", !b.whereMd.trim()],
    [
      "change",
      "At least one change with a Required text",
      !(b.changes ?? []).some((c) => c.title.trim() && c.required.trim()),
    ],
    [
      "test",
      "At least one test with setup and expected result",
      !(b.tests ?? []).some((c) => c.setup.trim() && c.expected.trim()),
    ],
    ["result", "Result (report format) is empty", !b.resultMd.trim()],
    ["story_active", "The story is still draft", t.story.status !== "active"],
  ]
    .filter((c) => c[2])
    .map((c) => ({ code: String(c[0]), message: String(c[1]) }));
  return { ready: missing.length === 0, missing };
}
export function validateBrief(b: TaskBrief) {
  if ((b.changes ?? []).some((c) => !c.title.trim() || !c.required.trim()))
    throw new JamError(
      "validation",
      "Each change needs title and required text",
      "changes",
    );
  if ((b.tests ?? []).some((t) => !t.setup.trim() || !t.expected.trim()))
    throw new JamError(
      "validation",
      "Each test needs setup and expected result",
      "tests",
    );
}
type Host = {
  data(): PlanData;
  tasks(): TaskDetail[];
  members(): Member[];
  jam(): { id: string; keyPrefix: string } | null;
  human(): Member;
  call(command: string, input?: unknown): Promise<void>;
  checkpoint(): void;
  emit(
    action: string,
    actor: Member,
    task?: TaskDetail,
    payload?: ActivityEvent["payload"],
    epicId?: string,
    sentence?: string,
  ): void;
  move(input: ReadyTaskInput): Promise<unknown>;
};
const copy = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();
export class MockPlanning {
  private claims = new Map<string, string>();
  private reviewContexts = new Map<string, string>();
  constructor(private h: Host) {}
  epic(key: string) {
    const e = this.h.data().epics.find((e) => e.key === key || e.id === key);
    if (!e) throw new JamError("not_found", "Epic not found");
    return e;
  }
  story(key: string) {
    const s = this.h.data().stories.find((s) => s.key === key || s.id === key);
    if (!s) throw new JamError("not_found", "Story not found");
    return s;
  }
  task(key: string) {
    const t = this.h.tasks().find((t) => t.key === key || t.id === key);
    if (!t) throw new JamError("not_found", "Task not found");
    return t;
  }
  sync(only?: TaskDetail) {
    for (const t of only ? [only] : this.h.tasks()) {
      const claim = JSON.stringify([t.assigneeId, t.status, t.reviewRound]);
      const previous = this.claims.get(t.id);
      if (!t.claimGeneration || (previous !== undefined && previous !== claim))
        t.claimGeneration = crypto.randomUUID();
      this.claims.set(t.id, claim);
      const story = this.h.data().stories.find((s) => s.id === t.storyId);
      if (story) t.story = copy(story);
      const epic = this.h.data().epics.find((e) => e.id === t.story.epicId);
      if (epic) t.epic = copy(epic);
      t.epicId = t.epic.id;
      t.epicKey = t.epic.key;
      t.epicColor = t.epic.color;
      t.storyKey = t.story.key;
      t.needsInfo = this.h
        .data()
        .questions.some(
          (q) =>
            q.status === "open" && q.scopeType === "task" && q.scopeId === t.id,
        );
      t.ancestorQuestions = copy(
        this.h
          .data()
          .questions.filter(
            (q) =>
              q.status === "open" &&
              ((q.scopeType === "story" && q.scopeId === t.storyId) ||
                (q.scopeType === "epic" && q.scopeId === t.epicId)),
          ),
      );
      t.ready = mockReadiness(t).ready;
      const report = t.reports.find((item) => item.round === t.reviewRound);
      if (t.status === "review" && report) {
        const context = JSON.stringify([
          t.id,
          t.updatedAt,
          report.id,
          t.brief,
          t.story,
          t.epic,
        ]);
        const previousContext = this.reviewContexts.get(t.id);
        if (
          !t.reviewContextRevision ||
          (previousContext !== undefined && previousContext !== context)
        )
          t.reviewContextRevision = crypto.randomUUID();
        this.reviewContexts.set(t.id, context);
      } else {
        t.reviewContextRevision = null;
        this.reviewContexts.delete(t.id);
      }
    }
  }
  private audit() {
    const j = this.h.jam(),
      a = this.h.human(),
      stamp = now();
    if (!j) throw new JamError("not_found", "No active jam");
    return {
      id: crypto.randomUUID(),
      jamId: j.id,
      position: 1024,
      createdBy: a.id,
      updatedBy: a.id,
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: null,
    };
  }
  private event(
    action: string,
    key: string,
    eid: string,
    payload: Record<string, unknown> = {},
  ) {
    this.sync();
    this.h.emit(
      action,
      this.h.human(),
      undefined,
      { key, ...payload } as ActivityEvent["payload"],
      eid,
      this.h.human().name +
        " " +
        ({
          "epic.created": "created epic ",
          "epic.updated": "updated epic ",
          "story.created": "created story ",
          "story.updated": "updated story ",
          "epic.status": "changed epic ",
          "story.status": "changed story ",
        }[action] ?? "updated ") +
        key,
    );
  }
  private editable(e: { archivedAt: string | null }) {
    if (e.archivedAt) throw new JamError("archived", "This item is archived");
  }
  async listEpics() {
    await this.h.call("list_plan_epics");
    return copy(
      this.h
        .data()
        .epics.slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    );
  }
  async getEpic(key: string): Promise<EpicTree> {
    await this.h.call("get_epic", key);
    this.sync();
    const e = this.epic(key);
    return copy({
      epic: e,
      stories: this.h
        .data()
        .stories.filter((s) => s.epicId === e.id && !s.archivedAt)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((s) => this.tree(s)),
      journal: [],
      openQuestions: this.h
        .data()
        .questions.filter((q) => q.epicId === e.id && q.status === "open"),
    });
  }
  private tree(s: Story): StoryTree {
    return {
      story: s,
      tasks: this.h
        .tasks()
        .filter((t) => t.storyId === s.id && !t.archivedAt)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((t) => ({ task: t, readiness: mockReadiness(t) })),
    };
  }
  async getStory(key: string) {
    await this.h.call("get_story", key);
    this.sync();
    return copy(this.tree(this.story(key)));
  }
  async createEpic(input: EpicInput) {
    await this.h.call("create_epic", input);
    if (!input.title.trim() || input.title.length > 140)
      throw new JamError("validation", "Use 1–140 characters", "title");
    const data = this.h.data(),
      n = data.epics.length + 1;
    const e: Epic = {
      ...this.audit(),
      key: `${this.h.jam()?.keyPrefix}-E${n}`,
      title: input.title,
      color: input.color ?? `m${((n - 1) % 6) + 1}`,
      status: "draft",
      goalMd: input.goalMd ?? "",
      doneWhenMd: input.doneWhenMd ?? "",
      notIncludedMd: input.notIncludedMd ?? "",
      decidedMd: input.decidedMd ?? "",
      openQuestionsMd: input.openQuestionsMd ?? "",
      participation: input.participation ?? "first_sketch",
      reviewer: input.reviewer ?? "none",
      workerModel: input.workerModel ?? null,
      brainMemberId: null,
    };
    e.position = n * 1024;
    data.epics.push(e);
    this.event("epic.created", e.key, e.id, { title: e.title });
    return copy(e);
  }
  async updateEpic(key: string, patch: EpicPatch_Serialize) {
    await this.h.call("update_epic", { key, ...patch });
    const e = this.epic(key);
    this.editable(e);
    const next = { ...e, ...patch };
    if (!next.title?.trim() || next.title.length > 140)
      throw new JamError("validation", "Use 1–140 characters", "title");
    if (
      e.status === "active" &&
      (!next.goalMd?.trim() || !next.doneWhenMd?.trim())
    )
      throw new JamError(
        "validation",
        "Active epics need goalMd and doneWhenMd",
      );
    Object.assign(e, patch, { updatedAt: now() });
    this.event("epic.updated", key, e.id, { fields: Object.keys(patch) });
    return copy(e);
  }
  async setEpicStatus(key: string, status: string, reason?: string) {
    await this.h.call("set_epic_status", { key, status });
    const e = this.epic(key);
    if (status === "active" && (!e.goalMd.trim() || !e.doneWhenMd.trim()))
      throw new JamError(
        "validation",
        "Missing fields: " +
          [
            !e.goalMd.trim() ? "goalMd" : "",
            !e.doneWhenMd.trim() ? "doneWhenMd" : "",
          ]
            .filter(Boolean)
            .join(", "),
      );
    if (
      status === "done" &&
      this.h
        .data()
        .stories.some(
          (s) => s.epicId === e.id && !s.archivedAt && s.status !== "done",
        ) &&
      !reason?.trim()
    )
      throw new JamError(
        "validation",
        "Finish every story or provide overrideReason",
      );
    const wasClosed = !!e.archivedAt || ["done", "archived"].includes(e.status);
    e.status = status;
    e.archivedAt = status === "archived" ? now() : null;
    e.updatedAt = now();
    this.event("epic.status", key, e.id, { status, wasClosed });
    return copy(e);
  }
  async setBrain(key: string, handle: string | null) {
    await this.h.call("set_brain", { key, handle });
    const e = this.epic(key);
    const m =
      handle === null
        ? null
        : this.h
            .members()
            .find((m) => m.handle === handle && m.kind === "agent");
    if (handle && !m)
      throw new JamError("validation", "Choose an agent as brain");
    e.brainMemberId = m?.id ?? null;
    this.event("epic.updated", key, e.id, { fields: ["brainMemberId"] });
    return copy(e);
  }
  async createStory(input: StoryInput) {
    await this.h.call("create_story", input);
    const e = this.epic(input.epicKey);
    this.editable(e);
    if (!input.title.trim() || input.title.length > 140)
      throw new JamError("validation", "Use 1–140 characters", "title");
    const n = this.h.data().stories.length + 1;
    const s: Story = {
      ...this.audit(),
      key: `${this.h.jam()?.keyPrefix}-S${n}`,
      epicId: e.id,
      title: input.title,
      status: "draft",
      outcomeMd: input.outcomeMd ?? "",
      basisMd: input.basisMd ?? "",
      preserveMd: input.preserveMd ?? "",
      scaleMd: input.scaleMd ?? "",
      rejectionRisksMd: input.rejectionRisksMd ?? "",
      openDecisionsMd: input.openDecisionsMd ?? "",
      acceptance: input.acceptance ?? [],
    };
    s.position = n * 1024;
    this.h.data().stories.push(s);
    this.event("story.created", s.key, e.id, { title: s.title });
    return copy(s);
  }
  async updateStory(key: string, patch: StoryPatch_Serialize) {
    await this.h.call("update_story", { key, ...patch });
    const s = this.story(key);
    this.editable(s);
    const next = { ...s, ...patch };
    if (!next.title?.trim() || next.title.length > 140)
      throw new JamError("validation", "Use 1–140 characters");
    if (next.acceptance?.some((a) => !a.criterion.trim() || !a.check.trim()))
      throw new JamError("validation", "Acceptance needs criterion and check");
    if (
      s.status === "active" &&
      (!next.outcomeMd?.trim() || !next.acceptance?.some((a) => a.mandatory))
    )
      throw new JamError(
        "validation",
        "Active story needs outcomeMd and mandatory acceptance",
      );
    Object.assign(s, patch, { updatedAt: now() });
    this.event("story.updated", key, s.epicId, { fields: Object.keys(patch) });
    return copy(s);
  }
  async setStoryStatus(key: string, status: string, reason?: string) {
    await this.h.call("set_story_status", { key, status });
    const s = this.story(key);
    if (
      status === "active" &&
      (!s.outcomeMd.trim() || !s.acceptance.some((a) => a.mandatory))
    )
      throw new JamError(
        "validation",
        "Missing outcomeMd or mandatory acceptance",
      );
    if (
      status === "done" &&
      this.h
        .tasks()
        .some(
          (t) => t.storyId === s.id && !t.archivedAt && t.status !== "done",
        ) &&
      !reason?.trim()
    )
      throw new JamError(
        "validation",
        "Finish every task or provide overrideReason",
      );
    const wasClosed = !!s.archivedAt || ["done", "archived"].includes(s.status);
    s.status = status;
    s.archivedAt = status === "archived" ? now() : null;
    s.updatedAt = now();
    this.event("story.status", key, s.epicId, { status, wasClosed });
    return copy(s);
  }
  async reorderStory(key: string, beforeKey?: string) {
    await this.h.call("reorder_story", { key, beforeKey });
    const s = this.story(key),
      rows = this.h
        .data()
        .stories.filter((x) => x.epicId === s.epicId && x.key !== key)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const index = beforeKey
      ? rows.findIndex((s) => s.key === beforeKey)
      : rows.length;
    if (index < 0)
      throw new JamError("validation", "Choose a story in this epic");
    rows.splice(index, 0, s);
    rows.forEach((s, i) => {
      s.position = (i + 1) * 1024;
    });
    this.event("story.updated", key, s.epicId, { fields: ["position"] });
    return copy(s);
  }
  async checkReady(key: string) {
    await this.h.call("check_ready", key);
    this.sync();
    return mockReadiness(this.task(key));
  }
  async markReady(input: ReadyTaskInput) {
    await this.h.call("mark_ready", input);
    await this.h.move(input);
    return copy(this.task(input.key));
  }
  async updateTaskBrief(key: string, patch: BriefPatch_Serialize) {
    await this.h.call("update_task_brief", { key, ...patch });
    const t = this.task(key);
    const b = { ...t.brief, ...patch } as TaskBrief;
    validateBrief(b);
    t.brief = b;
    t.updatedAt = now();
    this.sync();
    this.h.emit("task.brief_updated", this.h.human(), t, {
      fields: Object.keys(patch),
    });
    return copy(t);
  }
  async listQuestions(status?: string, scope?: Scope) {
    await this.h.call("list_questions", { status, scope });
    return copy(
      this.h
        .data()
        .questions.filter(
          (q) =>
            (!status || q.status === status) &&
            (!scope ||
              (q.scopeType === scope.type &&
                q.scopeId === this.resolve(scope).id)),
        ),
    );
  }
  private resolve(scope: Scope) {
    if (scope.type === "task") {
      const t = this.task(scope.id);
      return { id: t.id, epicId: t.epicId, task: t };
    }
    if (scope.type === "story") {
      const s = this.story(scope.id);
      return { id: s.id, epicId: s.epicId };
    }
    if (scope.type === "epic") {
      const e = this.epic(scope.id);
      return { id: e.id, epicId: e.id };
    }
    return { id: this.h.jam()?.id ?? "", epicId: null };
  }
  async askUser(input: AskUser, actor = this.h.human()) {
    await this.h.call("ask_user", input);
    const scope = this.resolve(input.scope);
    if (!input.title.trim() || (input.options?.length ?? 0) > 6)
      throw new JamError("validation", "Check the question title and options");
    const q: Question = {
      id: crypto.randomUUID(),
      jamId: this.h.jam()?.id ?? "",
      epicId: scope.epicId ?? null,
      scopeType: input.scope.type,
      scopeId: scope.id,
      askedBy: actor.id,
      roundLabel: input.roundLabel ?? null,
      title: input.title,
      bodyMd: input.bodyMd ?? "",
      options: input.options ?? [],
      recommendedIndex: input.recommendedIndex ?? null,
      allowFreeText: input.allowFreeText ?? true,
      status: "open",
      answerIndex: null,
      answerText: null,
      answeredBy: null,
      answeredAt: null,
      createdAt: now(),
    };
    this.h.data().questions.push(q);
    this.sync();
    this.h.emit(
      "question.asked",
      actor,
      "task" in scope ? scope.task : undefined,
      { questionId: q.id, title: q.title },
      scope.epicId ?? undefined,
      `${actor.name} asked: ${q.title}`,
    );
    return copy(q);
  }
  async answerQuestion(input: AnswerQuestion) {
    await this.h.call("answer_question", input);
    const q = this.h.data().questions.find((q) => q.id === input.id);
    if (!q) throw new JamError("not_found", "Question not found");
    if (q.status !== "open")
      throw new JamError("validation", "This question is closed");
    if (input.answerIndex !== null && !q.options[input.answerIndex])
      throw new JamError("validation", "Choose an option");
    if (
      input.answerIndex === null &&
      (!q.allowFreeText || !input.answerText?.trim())
    )
      throw new JamError("validation", "Choose an option or write an answer");
    if (input.answerText?.trim() && !q.allowFreeText)
      throw new JamError("validation", "Free text is not allowed");
    Object.assign(q, {
      status: "answered",
      answerIndex: input.answerIndex,
      answerText: input.answerText,
      answeredBy: this.h.human().id,
      answeredAt: now(),
    });
    this.sync();
    this.h.emit(
      "question.answered",
      this.h.human(),
      q.scopeType === "task" ? this.task(q.scopeId) : undefined,
      { questionId: q.id },
      q.epicId ?? undefined,
      `${this.h.human().name} answered: ${q.title}`,
    );
    return copy(q);
  }
  async withdrawQuestion(id: string) {
    await this.h.call("withdraw_question", id);
    const q = this.h.data().questions.find((q) => q.id === id);
    if (!q) throw new JamError("not_found", "Question not found");
    q.status = "withdrawn";
    this.sync();
    this.h.emit(
      "question.withdrawn",
      this.h.human(),
      undefined,
      { questionId: id },
      q.epicId ?? undefined,
    );
    return copy(q);
  }
  async submitReport(input: SubmitReport, actor: Member) {
    this.sync();
    const t = this.task(input.key);
    if (input.expectedClaimGeneration !== t.claimGeneration)
      throw new JamError(
        "stale_claim",
        "This claim changed. Read the task and reconcile this report before submitting again.",
      );
    if (t.assigneeId !== actor.id)
      throw new JamError("forbidden", "Only the assignee may submit a report");
    if (t.status !== "in_progress")
      throw new JamError("wrong_status", "Expected in_progress");
    const r = {
      id: crypto.randomUUID(),
      taskId: t.id,
      round: t.reviewRound ?? 0,
      authorId: actor.id,
      summaryMd: input.summaryMd,
      changedFiles: input.changedFiles,
      tests: input.tests,
      deviationsMd: input.deviationsMd ?? "",
      notVerifiedMd: input.notVerifiedMd ?? "",
      createdAt: now(),
    };
    t.reports.push(r);
    t.status = "review";
    t.changesRequested = false;
    t.updatedAt = now();
    this.h.emit(
      "report.submitted",
      actor,
      t,
      { round: r.round },
      t.epicId,
      `${actor.name} submitted a report for ${t.key}`,
    );
    return copy(r);
  }
  async reviewTask(input: ReviewTask) {
    await this.h.call("review_task", input);
    this.sync();
    const t = this.task(input.key),
      actor = this.h.human(),
      report = t.reports.find((r) => r.round === t.reviewRound);
    if (
      !input.expectedReportId ||
      input.expectedReportId !== report?.id ||
      !input.expectedReviewContextRevision ||
      input.expectedReviewContextRevision !== t.reviewContextRevision
    )
      throw new JamError(
        "conflict",
        "The report or task/story/epic context changed. Read the latest evidence and reconcile your review.",
      );
    if (!report)
      throw new JamError("validation", `No report for round ${t.reviewRound}`);
    if (t.assigneeId === actor.id || report.authorId === actor.id)
      throw new JamError("forbidden", "A worker can never review its own task");
    if (t.status !== "review")
      throw new JamError("wrong_status", "Expected review");
    if (input.failedTests?.some((n) => !report.tests.some((t) => t.name === n)))
      throw new JamError("validation", "Unknown report test");
    const r = {
      id: crypto.randomUUID(),
      taskId: t.id,
      round: t.reviewRound ?? 0,
      reviewerId: actor.id,
      verdict: input.verdict,
      commentsMd: input.commentsMd,
      failedTests: input.failedTests ?? [],
      createdAt: now(),
    };
    t.reviews.push(r);
    t.status = input.verdict === "accept" ? "done" : "ready";
    t.changesRequested = input.verdict === "changes_requested";
    if (t.changesRequested) t.reviewRound = (t.reviewRound ?? 0) + 1;
    t.updatedAt = now();
    this.h.emit(
      "review.recorded",
      actor,
      t,
      { verdict: r.verdict, failedTests: r.failedTests },
      t.epicId,
      actor.name + (t.changesRequested ? " returned " : " accepted ") + t.key,
    );
    return copy(r);
  }
}
