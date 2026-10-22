import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { BriefTest, Change } from "../bindings";
import { mockApi } from "../lib/mock-bridge";
import { useUiStore } from "../lib/ui-store";
import { QuestionCard } from "./inbox/InboxPage";
import {
  epicProgress,
  journalSessions,
  milestoneClass,
} from "./plan/journal-model";
import { ChangesEditor, TestsEditor } from "./task/BriefEditor";
import {
  ReadinessDialog,
  ReadinessStrip,
  validOverride,
} from "./task/Readiness";
import { ReviewDialog } from "./task/Rounds";
import { taskPatch, taskValues } from "./task/task-form";
import { AgentStatusLine, statusStale } from "./team/AgentStatus";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
  useUiStore.setState({ toasts: [], highlights: {}, readyRequest: null });
});
it("Save my edits against latest merges only edited brief fields onto the latest version", async () => {
  const base = taskValues(await mockApi.getTask("JB-2"));
  const mine = structuredClone(base),
    theirs = structuredClone(base);
  const change = mine.brief.changes[0];
  if (!change) throw new Error("Missing change fixture");
  change.required = "The human's precise correction";
  theirs.brief.whereMd = "game/new-route.gd";
  const patch = taskPatch(base, mine, theirs);
  expect(patch.brief?.whereMd).toBe("game/new-route.gd");
  expect(patch.brief?.changes?.[0]?.required).toBe(
    "The human's precise correction",
  );
  expect(Object.keys(patch)).toEqual(["brief"]);
});
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
it("the readiness strip renders all six checks with exactly the missing fixture codes", () => {
  const view = render(
    <ReadinessStrip
      readiness={{
        ready: false,
        missing: [
          { code: "goal", message: "Goal is empty" },
          {
            code: "test",
            message: "At least one test with setup and expected result",
          },
        ],
      }}
      status="backlog"
      onMark={() => {}}
    />,
  );
  expect(view.container.querySelectorAll("[data-readiness]")).toHaveLength(6);
  expect(
    [...view.container.querySelectorAll('[data-missing="true"]')].map((e) =>
      e.getAttribute("data-readiness"),
    ),
  ).toEqual(["goal", "test"]);
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeVisible();
});
it("readiness override requires a trimmed reason of ten characters", async () => {
  const task = await mockApi.createTask({
    title: "Explore",
    status: "backlog",
  });
  useUiStore.setState({
    readyRequest: {
      key: task.key,
      status: "ready",
      expectedUpdatedAt: task.updatedAt,
    },
  });
  wrap(<ReadinessDialog />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Mark ready anyway…" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Override reason" }),
    " short ",
  );
  expect(
    screen.getByRole("button", { name: "Mark ready anyway" }),
  ).toBeDisabled();
  expect(validOverride("1234567890")).toBe(true);
  expect(validOverride("  123456789  ")).toBe(false);
});
it("Changes can be added, validated, moved with mouse and Alt arrows, and removed", async () => {
  function Example() {
    const [value, set] = useState<Change[]>([
      {
        title: "First",
        required: "One",
        now: "",
        cause: "",
        where: "",
        follow: "",
        keep: "",
      },
      {
        title: "Second",
        required: "Two",
        now: "",
        cause: "",
        where: "",
        follow: "",
        keep: "",
      },
    ]);
    return <ChangesEditor value={value} onChange={set} />;
  }
  render(<Example />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Move Change 1 down" }));
  expect(screen.getByRole("textbox", { name: "Change 1 title" })).toHaveValue(
    "Second",
  );
  const first = screen.getByRole("textbox", { name: "Change 1 title" });
  fireEvent.keyDown(first, { key: "ArrowDown", altKey: true });
  expect(screen.getByRole("textbox", { name: "Change 1 title" })).toHaveValue(
    "First",
  );
  await user.click(screen.getByRole("button", { name: "Add change" }));
  expect(
    screen.getByText("Each change needs Title and Required."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove Change 3" }));
  expect(
    screen.queryByText("Each change needs Title and Required."),
  ).toBeNull();
});
it("Tests preserve numbered pairs while adding, removing and reordering", async () => {
  function Example() {
    const [value, set] = useState<BriefTest[]>([
      { setup: "First", expected: "One" },
      { setup: "Second", expected: "Two" },
    ]);
    return <TestsEditor value={value} onChange={set} />;
  }
  render(<Example />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Move Test 1 down" }));
  expect(screen.getByRole("textbox", { name: "Test 1 setup" })).toHaveValue(
    "Second",
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Test 2 expected" }), {
    key: "ArrowUp",
    altKey: true,
  });
  expect(screen.getByRole("textbox", { name: "Test 1 expected" })).toHaveValue(
    "One",
  );
  await user.click(screen.getByRole("button", { name: "Add test" }));
  expect(
    screen.getByText("Each test needs setup and expected result."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove Test 3" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(4);
});
it("requesting changes requires comments and offers only this report's tests", async () => {
  const report = (await mockApi.getTask("JB-9")).reports.at(-1);
  if (!report) throw new Error("Missing report fixture");
  const submit = vi.fn();
  render(<ReviewDialog report={report} close={() => {}} onReview={submit} />);
  expect(
    screen.getByRole("button", { name: "Request changes" }),
  ).toBeDisabled();
  expect(screen.getAllByRole("checkbox")).toHaveLength(report.tests.length);
  await userEvent
    .setup()
    .type(
      screen.getByRole("textbox", { name: "Review comments" }),
      "Repeat the failed edge check.",
    );
  await userEvent
    .setup()
    .click(screen.getAllByRole("checkbox")[0] as HTMLElement);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Request changes" }));
  expect(submit).toHaveBeenCalledWith({
    commentsMd: "Repeat the failed edge check.",
    failedTests: [report.tests[0]?.name],
  });
});
it.each(["option", "text", "both"] as const)(
  "Inbox accepts %s and A selects the recommended option",
  async (mode) => {
    const q = await mockApi.askUser({
      scope: { type: "task", id: "JB-1" },
      title: "Which light?",
      bodyMd: "A small decision",
      options: [
        { label: "Amber", description: "Keep it warm" },
        { label: "Blue", description: "Make it cold" },
      ],
      recommendedIndex: 0,
      allowFreeText: true,
      roundLabel: "Round 1",
    });
    wrap(<QuestionCard question={q} />);
    const card = screen.getByRole("article", {
      name: "Question: Which light?",
    });
    expect(within(card).getByText("Recommended")).toBeVisible();
    const user = userEvent.setup();
    if (mode !== "text") {
      card.focus();
      await user.keyboard("a");
      expect(screen.getByRole("button", { name: /Amber/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    if (mode !== "option")
      await user.type(
        screen.getByRole("textbox", { name: "Or answer in your own words" }),
        "A steady warm outline",
      );
    await user.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() =>
      expect(mockApi.calls.some((c) => c.command === "answer_question")).toBe(
        true,
      ),
    );
    const answer = (await mockApi.listQuestions("answered")).find(
      (a) => a.id === q.id,
    );
    expect(answer?.answerIndex).toBe(mode === "text" ? null : 0);
    expect(answer?.answerText).toBe(
      mode === "option" ? null : "A steady warm outline",
    );
  },
);
it("journal groups consecutive actors below ten minutes, splits days and emphasizes milestones", async () => {
  const base = (await mockApi.listActivity())[0];
  if (!base) throw new Error("No activity fixture");
  const first = { ...base, seq: 1, createdAt: "2026-10-20T10:00:00Z" },
    second = { ...base, seq: 2, createdAt: "2026-10-20T10:09:59Z" },
    third = { ...base, seq: 3, createdAt: "2026-10-20T10:19:59Z" },
    fourth = { ...base, seq: 4, createdAt: "2026-10-21T10:20:00Z" };
  expect(
    journalSessions([fourth, third, second, first]).map((s) => s.events.length),
  ).toEqual([1, 1, 2]);
  expect(milestoneClass({ ...base, action: "epic.created" })).toBe("milestone");
  expect(
    milestoneClass({
      ...base,
      action: "review.recorded",
      payload: { verdict: "changes_requested" },
    }),
  ).toBe("milestone returned");
  expect(
    milestoneClass({
      ...base,
      action: "review.recorded",
      payload: { verdict: "accept" },
    }),
  ).toBe("milestone accepted");
  expect(milestoneClass({ ...base, action: "agent.status" })).toBe("");
});
it("epic progress counts done tasks without treating review as done", () => {
  expect(
    epicProgress([
      { status: "done" },
      { status: "review" },
      { status: "done" },
      { status: "backlog" },
    ]),
  ).toEqual({ done: 2, total: 4 });
  expect(epicProgress([])).toEqual({ done: 0, total: 0 });
});
it("stale status is grey and status events never create toasts", async () => {
  const member = (await mockApi.listMembers()).find((m) => m.kind === "agent");
  if (!member) throw new Error("No agent");
  const stale = {
    ...member,
    statusText: "Reviewing the bridge",
    statusAt: new Date(Date.now() - 31 * 60000).toISOString(),
  };
  expect(statusStale(stale)).toBe(true);
  render(<AgentStatusLine member={stale} />);
  expect(screen.getByText("Reviewing the bridge (stale)")).toHaveClass("stale");
  const event = (await mockApi.listActivity())[0];
  if (!event) throw new Error("No event");
  useUiStore
    .getState()
    .receive([
      { ...event, actor: member, action: "agent.status", taskKey: "JB-12" },
    ]);
  expect(useUiStore.getState().toasts).toHaveLength(0);
  expect(useUiStore.getState().highlights["JB-12"]).toBeUndefined();
});
it("mock snapshots preserve zero-task epics and remap question/journal hierarchy", async () => {
  await mockApi.createEpic({ title: "A future quiet route" });
  const old = (await mockApi.listEpics()).find((e) => e.key === "JB-E1");
  if (!old) throw new Error("Missing epic");
  const before = (await mockApi.epicJournal(old.key)).length;
  await mockApi.exportJamJson();
  await mockApi.importJamJson("mock://jam-export.json");
  const epics = await mockApi.listEpics();
  expect(epics.some((e) => e.title === "A future quiet route")).toBe(true);
  const imported = epics.find((e) => e.title === old.title);
  if (!imported) throw new Error("Missing imported epic");
  expect(imported.id).not.toBe(old.id);
  const journal = await mockApi.epicJournal(imported.key);
  expect(journal).toHaveLength(before);
  expect(journal.every((e) => e.epicId === imported.id)).toBe(true);
  const question = (await mockApi.listQuestions()).find(
    (q) => q.scopeType === "epic",
  );
  expect(question?.epicId).toBe(imported.id);
});
