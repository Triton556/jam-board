// NT01: mocked persisted reads, not native/visual evidence.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppState, Question, TaskDetail } from "../../bindings";
import { api } from "../../lib/api";
import type { ActivityEvent } from "../../lib/types";
import {
  destinationFor,
  loadNotificationPage,
  NOTIFICATION_PAGE_SIZE,
  notificationEvents,
  resolveNotificationDestination,
  StaleNotificationScopeError,
} from "./model";

const project = "project-a";
function event(seq = 1, patch: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    seq,
    action: "comment.added",
    actor: {
      id: "agent",
      kind: "agent",
      name: "Agent",
      handle: "agent",
      color: "#123456",
    },
    taskKey: "JB-1",
    payload: {},
    createdAt: "2026-10-22T08:00:00Z",
    epicId: null,
    sentence: "Agent commented on JB-1",
    ...patch,
  };
}
const appState = { hasJam: true, jam: { id: project } } as AppState;
beforeEach(() => {
  vi.spyOn(api, "appState").mockResolvedValue(appState);
});
afterEach(() => vi.restoreAllMocks());
it("NT01 reconstructs persisted notifications on fresh loads without toast memory", async () => {
  const read = vi
    .spyOn(api, "listActivity")
    .mockResolvedValue([
      event(3),
      event(2, { action: "agent.status" }),
      event(1),
    ]);
  expect(
    (await loadNotificationPage(project)).events.map((e) => e.seq),
  ).toEqual([3, 1]);
  expect(
    (await loadNotificationPage(project)).events.map((e) => e.seq),
  ).toEqual([3, 1]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledWith({
    actorKind: "agent",
    limit: 100,
    beforeSeq: undefined,
  });
});
it("NT01 deduplicates and excludes human, irrelevant, and unactionable events", () => {
  const human = event(4);
  human.actor = { ...human.actor, kind: "human" };
  expect(
    notificationEvents([
      event(1),
      event(2),
      event(1),
      human,
      event(5, { action: "reference.added" }),
      event(6, { taskKey: null }),
      event(7, { action: "question.asked", payload: {} }),
    ]).map((e) => e.seq),
  ).toEqual([2, 1]);
});
it("NT01 question destination uses immutable ID, never generic Inbox fallback", () => {
  expect(
    destinationFor(
      event(1, { action: "question.asked", payload: { questionId: "q-1" } }),
    ),
  ).toEqual({ kind: "question", id: "q-1" });
  expect(
    destinationFor(
      event(1, { action: "question.asked", payload: { questionId: "" } }),
    ),
  ).toBeNull();
});
it("NT01 paginates a full raw page containing no matching notification kinds", async () => {
  const raw = Array.from({ length: NOTIFICATION_PAGE_SIZE }, (_, i) =>
    event(200 - i, { action: "agent.status" }),
  );
  const read = vi
    .spyOn(api, "listActivity")
    .mockResolvedValueOnce(raw)
    .mockResolvedValueOnce([event(100)]);
  const first = await loadNotificationPage(project);
  expect(first).toEqual({ events: [], beforeSeq: 101 });
  expect(await loadNotificationPage(project, first.beforeSeq)).toEqual({
    events: [event(100)],
    beforeSeq: undefined,
  });
  expect(read).toHaveBeenLastCalledWith({
    actorKind: "agent",
    limit: 100,
    beforeSeq: 101,
  });
});
it("NT01 failed fetch is distinct from empty history and explicit retry succeeds", async () => {
  const read = vi
    .spyOn(api, "listActivity")
    .mockRejectedValueOnce(new Error("Service unavailable"))
    .mockResolvedValueOnce([]);
  await expect(loadNotificationPage(project)).rejects.toThrow(
    "Service unavailable",
  );
  expect(read).toHaveBeenCalledTimes(1);
  await expect(loadNotificationPage(project)).resolves.toEqual({
    events: [],
    beforeSeq: undefined,
  });
});
it("NT01 rejects late A→B→A even though the selected ID is A again", async () => {
  let epoch = 1;
  const captured = epoch;
  let finish!: (events: ActivityEvent[]) => void;
  const read = vi.spyOn(api, "listActivity").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = loadNotificationPage(
    project,
    undefined,
    () => epoch === captured,
  );
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  epoch += 2;
  finish([event()]);
  await expect(pending).rejects.toBeInstanceOf(StaleNotificationScopeError);
});
it("NT01 refuses dispatch when the project already changed", async () => {
  vi.mocked(api.appState).mockResolvedValue({
    hasJam: true,
    jam: { id: "project-b" },
  } as AppState);
  const read = vi.spyOn(api, "listActivity");
  await expect(loadNotificationPage(project)).rejects.toBeInstanceOf(
    StaleNotificationScopeError,
  );
  expect(read).not.toHaveBeenCalled();
});
it("NT01 rejects a page if app state changes before completion", async () => {
  vi.mocked(api.appState)
    .mockResolvedValueOnce(appState)
    .mockResolvedValueOnce({
      hasJam: true,
      jam: { id: "project-b" },
    } as AppState);
  vi.spyOn(api, "listActivity").mockResolvedValue([event()]);
  await expect(loadNotificationPage(project)).rejects.toBeInstanceOf(
    StaleNotificationScopeError,
  );
});
it("NT01 View validates task project, original key and archive state", async () => {
  const read = vi.spyOn(api, "getTask").mockResolvedValue({
    jamId: project,
    key: "JB-1",
    archivedAt: null,
  } as TaskDetail);
  await expect(
    resolveNotificationDestination(project, event()),
  ).resolves.toEqual({ kind: "task", key: "JB-1" });
  for (const patch of [
    { jamId: "project-b" },
    { key: "JB-2" },
    { archivedAt: "2026-10-21" },
  ]) {
    read.mockResolvedValueOnce({
      jamId: project,
      key: "JB-1",
      archivedAt: null,
      ...patch,
    } as TaskDetail);
    await expect(
      resolveNotificationDestination(project, event()),
    ).rejects.toThrow(/not available|archived/);
  }
});
it("NT01 missing task is explicit without misreporting service failure as deletion", async () => {
  vi.spyOn(api, "getTask")
    .mockRejectedValueOnce({ code: "not_found", message: "missing" })
    .mockRejectedValueOnce(new Error("offline"));
  await expect(
    resolveNotificationDestination(project, event()),
  ).rejects.toThrow("no longer available");
  await expect(
    resolveNotificationDestination(project, event()),
  ).rejects.toThrow("offline");
});
it("NT01 exact question View resolves answered/withdrawn states and rejects missing/wrong-project IDs", async () => {
  const q = event(1, {
    action: "question.asked",
    payload: { questionId: "q-1" },
  });
  const read = vi.spyOn(api, "listQuestions");
  for (const status of ["answered", "withdrawn"]) {
    read.mockResolvedValueOnce([
      { id: "q-1", jamId: project, status } as Question,
    ]);
    await expect(resolveNotificationDestination(project, q)).resolves.toEqual({
      kind: "question",
      id: "q-1",
      status,
    });
  }
  read
    .mockResolvedValueOnce([
      { id: "q-1", jamId: "project-b", status: "open" } as Question,
    ])
    .mockResolvedValueOnce([]);
  await expect(resolveNotificationDestination(project, q)).rejects.toThrow(
    "no longer available",
  );
  await expect(resolveNotificationDestination(project, q)).rejects.toThrow(
    "no longer available",
  );
});
it("NT01 late View result is rejected after its selection epoch expires", async () => {
  let current = true;
  vi.spyOn(api, "getTask").mockImplementation(async () => {
    current = false;
    return { jamId: project, key: "JB-1", archivedAt: null } as TaskDetail;
  });
  await expect(
    resolveNotificationDestination(project, event(), () => current),
  ).rejects.toBeInstanceOf(StaleNotificationScopeError);
});
