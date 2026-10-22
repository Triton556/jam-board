import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { QuestionList } from "./inbox/InboxPage";
import { Rounds } from "./task/Rounds";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
function view(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, staleTime: Infinity },
            mutations: { retry: false },
          },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
it("answering leaves a live receipt and focus after the open question disappears", async () => {
  const q = await mockApi.askUser({
    scope: { type: "task", id: "JB-7" },
    title: "Choose a verification step",
    bodyMd: "A planning decision, not a launch command.",
    options: [{ label: "Check both", description: "Cover both paths" }],
    recommendedIndex: 0,
    allowFreeText: true,
    roundLabel: null,
  });
  view(<QuestionList />);
  const user = userEvent.setup();
  const card = await screen.findByRole("article", {
    name: `Question: ${q.title}`,
  });
  await user.click(within(card).getByRole("button", { name: /Check both/ }));
  await user.click(within(card).getByRole("button", { name: "Answer" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: `Question: ${q.title}` }),
    ).toBeNull(),
  );
  expect(
    screen.getByText(/Answer saved/, { selector: '[role="status"]' }),
  ).toHaveTextContent("Answer saved");
  expect(
    screen.getByText(/Answer saved/, { selector: '[role="status"]' }),
  ).toHaveTextContent("does not start work");
  expect(
    screen.getByRole("heading", { name: "Questions", level: 2 }),
  ).toHaveFocus();
});
it("failed Request changes stays inside the dialog with draft preserved and usable retry", async () => {
  const task = await mockApi.getTask("JB-9");
  view(<Rounds task={task} members={await mockApi.listMembers()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Request changes…" }));
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByRole("textbox"),
    "Verify the empty-state case.",
  );
  mockApi.failNext("review_task");
  await user.click(
    within(dialog).getByRole("button", { name: "Request changes" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(within(dialog).getByRole("textbox")).toHaveValue(
    "Verify the empty-state case.",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Request changes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent(
    "task returned to Ready for another round",
  );
  expect(
    screen.getByRole("heading", { name: "Reports & review" }),
  ).toHaveFocus();
});
it("a pending review cannot be submitted twice or dismissed before its outcome", async () => {
  const task = await mockApi.getTask("JB-9");
  view(<Rounds task={task} members={await mockApi.listMembers()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Request changes…" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByRole("textbox"), "Repeat this check.");
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mockApi.reviewTask.bind(mockApi);
  const spy = vi
    .spyOn(mockApi, "reviewTask")
    .mockImplementation(async (input) => {
      await gate;
      return original(input);
    });
  await user.dblClick(
    within(dialog).getByRole("button", { name: "Request changes" }),
  );
  expect(spy).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: "Saving review…" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(within(dialog).getByRole("textbox")).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () => release?.());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("latest report appears first and earlier rounds are collapsed without losing evidence", async () => {
  const task = await mockApi.getTask("JB-9"),
    report = task.reports.at(-1);
  if (!report) throw new Error("Missing report");
  const latest = {
    ...report,
    id: "newest-report",
    round: report.round + 1,
    summaryMd: "Latest evidence to inspect",
  };
  view(
    <Rounds
      task={{ ...task, reviewRound: latest.round, reports: [report, latest] }}
      members={await mockApi.listMembers()}
    />,
  );
  const details = Array.from(
    document.querySelectorAll<HTMLDetailsElement>(".round"),
  );
  expect(details[0]?.open).toBe(true);
  expect(details[0]?.querySelector("summary")).toHaveTextContent(
    `Round ${latest.round} · Latest`,
  );
  expect(details[1]?.open).toBe(false);
  expect(
    screen.getByRole("region", { name: "Latest report" }),
  ).toHaveTextContent("Latest evidence");
  expect(
    within(details[0] as HTMLElement).getByRole("button", {
      name: "Accept result",
    }),
  ).toBeVisible();
});
