import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { SubmitReport } from "../bindings";
import { mockApi } from "../lib/mock-bridge";
import type { Member, TaskDetail } from "../lib/types";
import { Rounds } from "./task/Rounds";

beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
function mount(task: TaskDetail, members: Member[]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const tree = (value: TaskDetail) => (
    <QueryClientProvider client={client}>
      <Rounds task={value} members={members} />
    </QueryClientProvider>
  );
  const result = render(tree(task));
  return {
    ...result,
    update: (value: TaskDetail) => result.rerender(tree(value)),
  };
}
async function changedStory(task: TaskDetail) {
  await mockApi.updateStory(task.story.key, {
    acceptance: [
      {
        id: "new-acceptance",
        criterion: "Also works with a disconnected device",
        mandatory: true,
        check: "Disconnect, retry, and inspect the saved result.",
      },
    ],
  });
  return mockApi.getTask(task.key);
}
async function nextReport(
  task: TaskDetail,
  overrides: Partial<SubmitReport> = {},
) {
  const oldReport = task.reports.find(
    (report) => report.round === task.reviewRound,
  );
  if (!oldReport || !task.reviewContextRevision)
    throw new Error("Missing current report context");
  await mockApi.reviewTask({
    key: task.key,
    expectedReportId: oldReport.id,
    expectedReviewContextRevision: task.reviewContextRevision,
    verdict: "changes_requested",
    commentsMd: "Independent test review: repeat verification.",
    failedTests: [],
  });
  await mockApi.startAllDemoScopes();
  const worker = (await mockApi.listMembers()).find(
    (member) => member.id === oldReport.authorId,
  );
  if (!worker) throw new Error("Missing report author");
  await mockApi.simulateAgent({
    action: "task.claimed",
    key: task.key,
    agent: worker.handle,
  });
  const claimed = await mockApi.getTask(task.key);
  if (!claimed.claimGeneration) throw new Error("Missing claim generation");
  await mockApi.simulateAgent({
    action: "report.submitted",
    agent: worker.handle,
    report: {
      key: task.key,
      expectedClaimGeneration: claimed.claimGeneration,
      summaryMd: "A different report for the next round.",
      changedFiles: ["fictional-check.txt"],
      tests: [
        {
          name: "Replacement verification",
          command: "fictional test",
          expected: "New acceptance holds",
          actual: "Synthetic check only",
          result: "PASS",
        },
      ],
      deviationsMd: "",
      notVerifiedMd: "No real implementation was executed.",
      ...overrides,
    },
  });
  return mockApi.getTask(task.key);
}
it("a hidden ancestor change is rejected with the original context and cannot auto-authorize retry", async () => {
  const task = await mockApi.getTask("JB-9"),
    user = userEvent.setup();
  mount(task, await mockApi.listMembers());
  const fresh = await changedStory(task);
  await user.click(screen.getByRole("button", { name: "Accept result" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Accept result" }),
    ).toBeDisabled(),
  );
  const calls = mockApi.calls.filter((call) => call.command === "review_task");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input).toMatchObject({
    expectedReviewContextRevision: task.reviewContextRevision,
  });
  expect((await mockApi.getTask(task.key)).status).toBe("review");
  await user.click(
    screen.getByRole("button", { name: "Read latest evidence" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Accept result" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Accept result" }));
  await waitFor(() =>
    expect(
      screen.getByText("Result accepted. The task moved to Done."),
    ).toBeVisible(),
  );
  expect(
    mockApi.calls.filter((call) => call.command === "review_task").at(-1)
      ?.input,
  ).toMatchObject({
    expectedReviewContextRevision: fresh.reviewContextRevision,
  });
  expect(
    screen.queryByText(
      /Inspect this report and its captured criteria before accepting/,
    ),
  ).toBeNull();
});
it.each(["task", "story", "epic"] as const)(
  "a visible %s context change blocks acceptance until an explicit reread",
  async (scope) => {
    const task = await mockApi.getTask("JB-9"),
      user = userEvent.setup();
    const view = mount(task, await mockApi.listMembers());
    if (scope === "story") await changedStory(task);
    else if (scope === "epic")
      await mockApi.updateEpic(task.epic.key, {
        doneWhenMd:
          "Verify the changed acceptance, not just the earlier brief.",
      });
    else
      await mockApi.updateTask({
        key: task.key,
        expectedUpdatedAt: task.updatedAt,
        descriptionMd: "New human correction to inspect.",
      });
    view.update(await mockApi.getTask(task.key));
    expect(
      screen.getByRole("button", { name: "Accept result" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "snapshot has not been replaced",
    );
    expect(
      mockApi.calls.filter((call) => call.command === "review_task"),
    ).toHaveLength(0);
    await user.click(
      screen.getByRole("button", { name: "Read latest evidence" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept result" }),
      ).toBeEnabled(),
    );
    expect(
      document.querySelector<HTMLDetailsElement>(".review-context")?.open,
    ).toBe(true);
    expect(
      screen.getByRole("heading", { name: "Reports & review" }),
    ).toHaveFocus();
  },
);
it("a replaced report remains frozen until explicit reread, including its exact report ID", async () => {
  const task = await mockApi.getTask("JB-9"),
    user = userEvent.setup();
  const oldReport = task.reports.find(
    (report) => report.round === task.reviewRound,
  );
  if (!oldReport) throw new Error("Missing report");
  const view = mount(task, await mockApi.listMembers());
  const fresh = await nextReport(task);
  view.update(fresh);
  expect(screen.getByRole("button", { name: "Accept result" })).toBeDisabled();
  expect(
    screen.getByRole("region", { name: "Latest report" }),
  ).toHaveTextContent(oldReport.summaryMd);
  expect(
    screen.queryByText("A different report for the next round."),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Read latest evidence" }),
  );
  expect(
    await screen.findByText("A different report for the next round."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Accept result" }));
  await waitFor(() =>
    expect(
      screen.getByText("Result accepted. The task moved to Done."),
    ).toBeVisible(),
  );
  expect(
    mockApi.calls.filter((call) => call.command === "review_task").at(-1)
      ?.input,
  ).toMatchObject({
    expectedReportId: fresh.reports.find(
      (report) => report.round === fresh.reviewRound,
    )?.id,
  });
});
it("a pending review draft keeps comments and obsolete test choices across explicit reconciliation", async () => {
  const task = await mockApi.getTask("JB-9"),
    user = userEvent.setup();
  const view = mount(task, await mockApi.listMembers());
  await user.click(screen.getByRole("button", { name: "Request changes…" }));
  const dialog = screen.getByRole("dialog");
  // The fixture is prose; reconciliation, not individual key events, is under test.
  await user.click(within(dialog).getByRole("textbox"));
  await user.paste("Keep this concern in the review.");
  const first = within(dialog).getAllByRole("checkbox")[0];
  if (!first) throw new Error("Missing test checkbox");
  await user.click(first);
  let fresh: TaskDetail | undefined;
  await act(async () => {
    fresh = await nextReport(task);
  });
  if (!fresh) throw new Error("Missing next report");
  view.update(fresh);
  expect(
    within(dialog).getByRole("button", { name: "Request changes" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Read latest evidence" }),
  );
  await within(dialog).findByText("Earlier test choices to reconcile");
  expect(
    within(dialog).getByRole("heading", { name: "Captured report" }),
  ).toHaveFocus();
  expect(within(dialog).getByRole("textbox")).toHaveValue(
    "Keep this concern in the review.",
  );
  expect(
    within(dialog).getByRole("button", { name: "Request changes" }),
  ).toBeDisabled();
  const obsolete = within(dialog).getByRole("group", {
    name: "Earlier test choices to reconcile",
  });
  await user.click(within(obsolete).getByRole("checkbox"));
  await user.click(
    within(dialog).getByRole("button", { name: "Request changes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    mockApi.calls.filter((call) => call.command === "review_task").at(-1)
      ?.input,
  ).toMatchObject({
    commentsMd: "Keep this concern in the review.",
    expectedReviewContextRevision: fresh.reviewContextRevision,
    failedTests: [],
  });
});

it("unsaved task corrections cannot be skipped by accepting the saved report", async () => {
  const task = await mockApi.getTask("JB-9");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Rounds
        task={task}
        members={await mockApi.listMembers()}
        hasUnsavedEdits
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("button", { name: "Accept result" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Request changes…" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Review uses saved criteria, not unsaved changes/),
  ).toBeVisible();
});

it("rereading inside Request changes exposes the full replacement report without losing the draft", async () => {
  const task = await mockApi.getTask("JB-9"),
    user = userEvent.setup();
  const oldReport = task.reports.find(
    (report) => report.round === task.reviewRound,
  );
  if (!oldReport) throw new Error("Missing report");
  const view = mount(task, await mockApi.listMembers());
  await user.click(screen.getByRole("button", { name: "Request changes…" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("textbox"));
  await user.paste("Check the changed evidence, not just the summary.");
  const fresh = await nextReport(task, {
    summaryMd: oldReport.summaryMd,
    changedFiles: ["fictional/replacement-proof.txt"],
    tests: [
      {
        name: "Replacement check",
        command: "synthetic-check --offline",
        expected: "Cached result",
        actual: "Timeout in synthetic case",
        result: "FAIL",
      },
    ],
    deviationsMd: "The replacement report changed the retry assumption.",
    notVerifiedMd: "Physical device behavior remains unverified.",
  });
  view.update(fresh);
  expect(within(dialog).queryByText("Timeout in synthetic case")).toBeNull();
  await user.click(
    within(dialog).getByRole("button", { name: "Read latest evidence" }),
  );
  expect(
    await within(dialog).findByText("fictional/replacement-proof.txt"),
  ).toBeVisible();
  const evidence = within(dialog).getByRole("table", {
    name: "Reported tests",
  });
  for (const text of [
    "Replacement check",
    "synthetic-check --offline",
    "Cached result",
    "Timeout in synthetic case",
    "FAIL",
  ])
    expect(within(evidence).getByText(text, { exact: true })).toBeVisible();
  expect(
    within(dialog).getByText(
      "The replacement report changed the retry assumption.",
    ),
  ).toBeVisible();
  expect(
    within(dialog).getByText("Physical device behavior remains unverified."),
  ).toBeVisible();
  expect(within(dialog).getByRole("textbox")).toHaveValue(
    "Check the changed evidence, not just the summary.",
  );
  expect(
    within(dialog).getByRole("heading", { name: "Captured report" }),
  ).toHaveFocus();
  await user.click(
    within(dialog).getByRole("button", { name: "Request changes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    mockApi.calls.filter((call) => call.command === "review_task").at(-1)
      ?.input,
  ).toMatchObject({
    commentsMd: "Check the changed evidence, not just the summary.",
    expectedReportId: fresh.reports.find(
      (report) => report.round === fresh.reviewRound,
    )?.id,
    expectedReviewContextRevision: fresh.reviewContextRevision,
  });
});
