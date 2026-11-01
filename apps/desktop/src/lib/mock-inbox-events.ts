import type { MemberRef } from "../bindings";
import type {
  InboxEvent,
  InboxEventsPage,
  InboxEventsQuery,
} from "./inbox-events-api";
import { currentMockBridge } from "./mock-adapter";

export interface MockInboxActivity {
  seq: number;
  action: string;
  actor: MemberRef;
  epicId: string | null;
  createdAt: string;
  sentence: string;
  taskKey?: string;
  epicKey?: string;
  storyKey?: string;
  frameId?: string;
  frameTitle?: string;
  requestId?: string;
}
const viewer: MemberRef = {
  id: "inbox-human",
  name: "Danil",
  handle: "danil",
  kind: "human",
  color: "m1",
};
const claude: MemberRef = {
  id: "inbox-claude",
  name: "Claude",
  handle: "claude",
  kind: "agent",
  color: "m3",
};
const codex: MemberRef = {
  id: "inbox-codex",
  name: "Codex",
  handle: "codex",
  kind: "agent",
  color: "m2",
};
const needsAction = new Set(["report.submitted", "execution.requested"]);
const updates = new Set([
  "review.recorded",
  "task.claimed",
  "task.released",
  "task.created",
  "story.created",
  "epic.created",
  "task.moved",
  "story_moved",
  "task_moved_to_story",
  "reference.added",
  "comment.added",
  "question.withdrawn",
  "jam.imported",
  "reference.review_sent",
]);

function seed(): MockInboxActivity[] {
  const rows: MockInboxActivity[] = [];
  const now = Date.now();
  function add(
    action: string,
    minutes: number,
    extra: Partial<MockInboxActivity> = {},
  ) {
    rows.push({
      seq: rows.length + 1,
      action,
      actor: codex,
      epicId: "epic-1",
      epicKey: "JB-E1",
      createdAt: new Date(now - minutes * 60000).toISOString(),
      sentence: `${codex.name} ${action}`,
      ...extra,
    });
  }
  // The brief's 30-raw-event ceiling conflicts with its required 40-event burst.
  // Keep all required scenarios as actual source events (see R12-I/report.md).
  for (let i = 0; i < 12; i++)
    add("comment.added", 2900 - i * 15, {
      taskKey: "JB-2",
      sentence: "Codex commented on JB-2",
    });
  add("report.submitted", 1500, {
    taskKey: "JB-2",
    sentence: "Codex submitted a report for JB-2",
  });
  add("review.recorded", 1490, {
    taskKey: "JB-2",
    sentence: "Codex reviewed JB-2",
  });
  add("task.created", 90, { taskKey: "JB-3", sentence: "Codex created JB-3" });
  add("task.created", 89, { taskKey: "JB-4", sentence: "Codex created JB-4" });
  add("task.created", 78, { taskKey: "JB-5", sentence: "Codex created JB-5" });
  for (let i = 0; i < 40; i++)
    add("reference.added", 30 - i / 20, {
      actor: claude,
      frameId: "inbox-sky",
      frameTitle: "Moodboard — Sky",
      sentence: "Claude added a reference",
    });
  add("task.updated", 20);
  add("question.asked", 19);
  add("task.claimed", 18, { actor: viewer });
  add("comment.added", 17, { actor: viewer });
  add("story.created", 16, { actor: viewer });
  add("reference.review_sent", 12, {
    actor: viewer,
    frameId: "inbox-sky",
    frameTitle: "Moodboard — Sky",
    sentence:
      "You sent the review of Moodboard — Sky: 12 keep, 8 not this, 3 reasons",
  });
  add("report.submitted", 8, {
    taskKey: "JB-1",
    sentence: "Codex submitted a report for JB-1",
  });
  add("execution.requested", 4, {
    requestId: "inbox-request-1",
    storyKey: "JB-S1",
    sentence: "Claude requested execution for JB-S1",
    actor: claude,
  });
  add("task.released", 2, { taskKey: "JB-3", sentence: "Codex released JB-3" });
  return rows;
}
export const seedMockInboxActivity = seed;
let activity = seed();
const defaultActivity = () => activity;
const defaultViewer = () => viewer;
const defaultSeen = () => seenSeq;
let seenSeq = 0;
export function resetMockInboxEvents(rows?: MockInboxActivity[]) {
  activity = rows ? structuredClone(rows) : seed();
  seenSeq = 0;
  try {
    currentMockBridge().resetInboxActivity(activity);
  } catch {
    /* Standalone rule tests have no shared bridge. */
  }
}
export async function markMockInboxEventsSeen(seq: number): Promise<number> {
  if (!Number.isSafeInteger(seq) || seq < 0)
    throw new Error("seq must be a non-negative integer");
  seenSeq = Math.max(seenSeq, seq);
  return seenSeq;
}
function shown(row: MockInboxActivity) {
  return (
    needsAction.has(row.action) ||
    (updates.has(row.action) &&
      (row.actor.id !== viewer.id || row.action === "reference.review_sent"))
  );
}
function resolved(row: MockInboxActivity) {
  return activity.some(
    (later) =>
      later.seq > row.seq &&
      ((row.action === "report.submitted" &&
        later.action === "review.recorded" &&
        !!row.taskKey &&
        later.taskKey === row.taskKey) ||
        (row.action === "execution.requested" &&
          later.action === "execution.request_resolved" &&
          !!row.requestId &&
          later.requestId === row.requestId)),
  );
}
function groupedSentence(row: MockInboxActivity, count: number) {
  if (count === 1) return row.sentence;
  const verbs: Record<string, string> = {
    "reference.added": "added",
    "task.created": "created",
    "story.created": "created",
    "epic.created": "created",
    "task.claimed": "claimed",
    "task.released": "released",
    "task.moved": "moved",
    story_moved: "moved",
    task_moved_to_story: "moved",
    "review.recorded": "reviewed",
    "comment.added": "added",
    "question.withdrawn": "withdrew",
    "jam.imported": "imported",
    "reference.review_sent": "sent",
  };
  const nouns: Record<string, string> = {
    reference: "references",
    task: "tasks",
    story: "stories",
    epic: "epics",
    review: "tasks",
    comment: "comments",
    question: "questions",
    jam: "projects",
  };
  const kind = row.action.split(/[._]/)[0] ?? "";
  const noun = row.action === "reference.review_sent" ? "reviews" : nouns[kind];
  return `${row.actor.id === viewer.id ? "You" : row.actor.name} ${verbs[row.action]} ${count} ${noun}${kind !== "reference" && row.epicKey ? ` in ${row.epicKey}` : ""}`;
}
export async function listMockInboxEvents(
  query: InboxEventsQuery = {},
  shared?: {
    activity: MockInboxActivity[];
    viewer: MemberRef;
    seenSeq: number;
  },
): Promise<InboxEventsPage> {
  const activity = shared?.activity ?? defaultActivity();
  const viewer = shared?.viewer ?? defaultViewer();
  const seenSeq = shared?.seenSeq ?? defaultSeen();
  const shown = (row: MockInboxActivity) =>
    needsAction.has(row.action) ||
    (updates.has(row.action) &&
      (row.actor.id !== viewer.id || row.action === "reference.review_sent"));
  const resolved = (row: MockInboxActivity) =>
    activity.some(
      (later) =>
        later.seq > row.seq &&
        ((row.action === "report.submitted" &&
          later.action === "review.recorded" &&
          !!row.taskKey &&
          later.taskKey === row.taskKey) ||
          (row.action === "execution.requested" &&
            later.action === "execution.request_resolved" &&
            !!row.requestId &&
            later.requestId === row.requestId)),
    );
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("limit must be between 1 and 200");
  const visible = activity.filter(shown).sort((a, b) => b.seq - a.seq);
  const eligible = visible.filter(
    (row) =>
      (query.beforeSeq == null || row.seq < query.beforeSeq) &&
      (query.filter == null ||
        query.filter === "all" ||
        (needsAction.has(row.action) ? "needs_action" : "updates") ===
          query.filter),
  );
  const source = eligible.slice(0, limit);
  const groups: [MockInboxActivity, ...MockInboxActivity[]][] = [];
  for (const row of source) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (
      previous &&
      !needsAction.has(row.action) &&
      previous.actor.id === row.actor.id &&
      previous.action === row.action &&
      previous.epicId === row.epicId &&
      Math.abs(Date.parse(previous.createdAt) - Date.parse(row.createdAt)) <=
        600000
    )
      group?.push(row);
    else groups.push([row]);
  }
  const events: InboxEvent[] = groups.map((group) => {
    const row = group[0];
    return {
      seq: row.seq,
      firstSeq: group.at(-1)?.seq ?? row.seq,
      action: row.action,
      group: needsAction.has(row.action) ? "needs_action" : "updates",
      actor: row.actor,
      sentence: groupedSentence(row, group.length),
      count: group.length,
      taskKey: row.taskKey ?? null,
      epicKey: row.epicKey ?? null,
      storyKey: row.storyKey ?? null,
      frameId: row.frameId ?? null,
      frameTitle: row.frameTitle ?? null,
      requestId: row.requestId ?? null,
      resolved: needsAction.has(row.action) && resolved(row),
      unread: row.seq > seenSeq,
      createdAt: row.createdAt,
    };
  });
  return {
    events,
    unread: Math.min(
      99,
      visible.filter(
        (row) =>
          row.seq > seenSeq &&
          (row.actor.id !== viewer.id ||
            row.action === "reference.review_sent"),
      ).length,
    ),
    openActions: visible.filter(
      (row) => needsAction.has(row.action) && !resolved(row),
    ).length,
    seenSeq,
    nextBeforeSeq:
      eligible.length > source.length ? (source.at(-1)?.seq ?? null) : null,
  };
}
