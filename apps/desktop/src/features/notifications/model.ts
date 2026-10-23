import { api } from "../../lib/api";
import type { ActivityEvent } from "../../lib/types";

export const NOTIFICATION_PAGE_SIZE = 100;
const actions = new Set([
  "task.created",
  "task.moved",
  "task.claimed",
  "comment.added",
  "report.submitted",
  "review.recorded",
  "question.asked",
]);
export type NotificationDestination =
  | { kind: "task"; key: string }
  | { kind: "question"; id: string };
export type ResolvedNotificationDestination =
  | { kind: "task"; key: string }
  | { kind: "question"; id: string; status: string };

export class StaleNotificationScopeError extends Error {
  constructor() {
    super("The project changed. Reopen notifications for the current project.");
    this.name = "StaleNotificationScopeError";
  }
}

export function destinationFor(
  event: ActivityEvent,
): NotificationDestination | null {
  if (event.action === "question.asked") {
    const payload = event.payload;
    return payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof payload.questionId === "string" &&
      payload.questionId.trim()
      ? { kind: "question", id: payload.questionId }
      : null;
  }
  return event.taskKey?.trim() ? { kind: "task", key: event.taskKey } : null;
}

/** This is the actionable notification subset, not the complete activity feed. */
export function notificationEvents(events: ActivityEvent[]): ActivityEvent[] {
  return [
    ...new Map(
      events
        .filter(
          (event) =>
            event.actor.kind === "agent" &&
            actions.has(event.action) &&
            destinationFor(event) !== null,
        )
        .map((event) => [event.seq, event]),
    ).values(),
  ].sort((a, b) => b.seq - a.seq);
}

function assertCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) throw new StaleNotificationScopeError();
}
async function assertProject(projectId: string, isCurrent: () => boolean) {
  assertCurrent(isCurrent);
  const state = await api.appState();
  assertCurrent(isCurrent);
  if (!state.hasJam || state.jam?.id !== projectId)
    throw new StaleNotificationScopeError();
}

/** Read persisted events afresh; neither receipts nor event payloads are stored. */
export async function loadNotificationPage(
  projectId: string,
  beforeSeq?: number,
  isCurrent: () => boolean = () => true,
) {
  await assertProject(projectId, isCurrent);
  assertCurrent(isCurrent);
  const events = await api.listActivity({
    actorKind: "agent",
    limit: NOTIFICATION_PAGE_SIZE,
    beforeSeq,
  });
  assertCurrent(isCurrent);
  await assertProject(projectId, isCurrent);
  return {
    events: notificationEvents(events),
    // Advance using the raw page, including pages with no actionable events.
    beforeSeq:
      events.length === NOTIFICATION_PAGE_SIZE ? events.at(-1)?.seq : undefined,
  };
}

/** A View is read-only and must never fall back to another project's entity. */
export async function resolveNotificationDestination(
  projectId: string,
  event: ActivityEvent,
  isCurrent: () => boolean = () => true,
): Promise<ResolvedNotificationDestination> {
  const destination = destinationFor(event);
  if (!destination)
    throw new Error("This notification has no available destination.");
  await assertProject(projectId, isCurrent);
  assertCurrent(isCurrent);
  if (destination.kind === "task") {
    let task: Awaited<ReturnType<typeof api.getTask>>;
    try {
      task = await api.getTask(destination.key);
    } catch (error) {
      assertCurrent(isCurrent);
      // Preserve service failures for retry rather than claiming deletion.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "not_found" || error.code === "archived")
      )
        throw new Error("This task is no longer available in this project.");
      throw error;
    }
    assertCurrent(isCurrent);
    await assertProject(projectId, isCurrent);
    if (task.jamId !== projectId || task.key !== destination.key)
      throw new Error("This task is not available in this project.");
    if (task.archivedAt)
      throw new Error(
        "This task was archived and cannot be opened from notifications.",
      );
    return destination;
  }
  const questions = await api.listQuestions();
  assertCurrent(isCurrent);
  await assertProject(projectId, isCurrent);
  const question = questions.find(
    (candidate) =>
      candidate.id === destination.id && candidate.jamId === projectId,
  );
  if (!question)
    throw new Error("This question is no longer available in this project.");
  return { ...destination, status: question.status };
}
