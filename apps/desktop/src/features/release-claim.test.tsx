import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { ReleaseClaim } from "./task/ReleaseClaim";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
function view(unsaved = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  function Task() {
    const task = useQuery({
      queryKey: ["task", "JB-12"],
      queryFn: () => mockApi.getTask("JB-12"),
    });
    return (
      task.data && <ReleaseClaim task={task.data} hasUnsavedEdits={unsaved} />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Task />
    </QueryClientProvider>,
  );
  return client;
}
async function open() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Release claim…" }),
  );
  return { user, dialog: screen.getByRole("dialog") };
}
it("cancel and Escape never release the current claim", async () => {
  const before = await mockApi.getTask("JB-12");
  view();
  const { user, dialog } = await open();
  expect(dialog).toHaveTextContent(before.key);
  expect(dialog).toHaveTextContent(before.title);
  expect(dialog).toHaveTextContent("does not stop an agent session");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((await mockApi.getTask(before.key)).assigneeId).toBe(
    before.assigneeId,
  );
  expect(mockApi.calls.some((call) => call.command === "release_task")).toBe(
    false,
  );
});
it("releasing an archived active claim preserves evidence, archive and paused scope", async () => {
  await mockApi.archiveTask("JB-12");
  const before = await mockApi.getTask("JB-12");
  view();
  const { user, dialog } = await open();
  expect(dialog).toHaveTextContent("stays archived");
  await user.click(
    within(dialog).getByRole("button", { name: "Return to Backlog" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent(
    "No worker process was stopped",
  );
  expect(screen.getByRole("region", { name: "Claim recovery" })).toHaveFocus();
  expect(await mockApi.getTask(before.key)).toMatchObject({
    status: "backlog",
    assigneeId: null,
    archivedAt: before.archivedAt,
    reports: before.reports,
    reviews: before.reviews,
    reviewRound: before.reviewRound,
  });
  expect(
    (await mockApi.getExecution({ type: "story", id: before.story.id }))
      .effectiveState,
  ).toBe("paused");
  await expect(
    mockApi.simulateAgent({ action: "report.submitted", key: before.key }),
  ).rejects.toThrow();
});
it("save failure keeps the exact confirmation and retries without losing context", async () => {
  view();
  const { user, dialog } = await open();
  mockApi.failNext("release_task");
  await user.click(
    within(dialog).getByRole("button", { name: "Return to Backlog" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect((await mockApi.getTask("JB-12")).status).toBe("in_progress");
  await user.click(
    within(dialog).getByRole("button", { name: "Return to Backlog" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("a changed task disables stale confirmation and CAS also rejects unseen changes", async () => {
  const client = view();
  const { dialog } = await open();
  const before = await mockApi.getTask("JB-12");
  await act(async () => {
    await mockApi.updateTask({
      key: before.key,
      expectedUpdatedAt: before.updatedAt,
      title: "Changed while confirming",
    });
    await client.invalidateQueries({ queryKey: ["task", before.key] });
  });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Return to Backlog" }),
    ).toBeDisabled(),
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "task or selected project changed",
  );
  await expect(
    mockApi.releaseTask({
      key: before.key,
      expectedUpdatedAt: before.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect((await mockApi.getTask(before.key)).assigneeId).toBe(
    before.assigneeId,
  );
});
it("a pending release is single-submit and cannot be dismissed", async () => {
  view();
  const { user, dialog } = await open();
  let finish: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const original = mockApi.releaseTask.bind(mockApi);
  const spy = vi
    .spyOn(mockApi, "releaseTask")
    .mockImplementation(async (input) => {
      await gate;
      return original(input);
    });
  // Mutation hooks capture their function at render; refresh the confirmation after spying.
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Release claim…" }));
  const current = screen.getByRole("dialog");
  await user.dblClick(
    within(current).getByRole("button", { name: "Return to Backlog" }),
  );
  expect(spy).toHaveBeenCalledOnce();
  expect(
    within(current).getByRole("button", { name: "Returning…" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () => finish?.());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(dialog).not.toBeInTheDocument();
});
it("unsaved edits must be resolved before releasing work", async () => {
  view(true);
  expect(
    await screen.findByRole("button", { name: "Release claim…" }),
  ).toBeDisabled();
  expect(screen.getByText(/Save or discard your edits/)).toBeVisible();
});
it("unassigned In progress work can be returned without pretending a worker was stopped", async () => {
  const before = await mockApi.getTask("JB-12");
  await mockApi.updateTask({
    key: before.key,
    expectedUpdatedAt: before.updatedAt,
    assigneeId: null,
  });
  view();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Return to Backlog…" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("No assignee is recorded");
  await user.click(
    within(dialog).getByRole("button", { name: "Return to Backlog" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((await mockApi.getTask(before.key)).status).toBe("backlog");
});
it("switching the current project disables the captured release confirmation", async () => {
  const client = view(),
    { dialog } = await open();
  await act(async () => {
    const state = await mockApi.createJam({
      name: "Other project",
      yourName: "Human",
      theme: null,
      template: "custom",
      startsAt: "",
      endsAt: "",
      timezone: "UTC",
      milestoneAt: null,
    });
    client.setQueryData(["app"], state);
  });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Return to Backlog" }),
    ).toBeDisabled(),
  );
  expect(mockApi.calls.some((call) => call.command === "release_task")).toBe(
    false,
  );
});
