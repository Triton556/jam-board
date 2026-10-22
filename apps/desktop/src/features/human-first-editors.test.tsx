// docs/agents acceptance HF01–HF06: behavioral subsets; no native pixel claim.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { StoryDrawer } from "./plan/StoryDrawer";
import { TaskComments } from "./task/TaskComments";
import { TaskDrawer } from "./task/TaskDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  mockApi.calls.length = 0;
});
function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
  };
}
function before(first: HTMLElement, second: HTMLElement) {
  expect(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}
it("task opens with human description and comments before its closed structured agent plan", async () => {
  mount(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  const description = await screen.findByRole("textbox", {
    name: "Description",
  });
  const comments = screen.getByRole("textbox", { name: "Write a comment" });
  const summary = planSummary();
  expect(summary.closest("details")).not.toHaveAttribute("open");
  before(description, comments);
  before(comments, summary);
  expect(
    screen.getByRole("button", { name: "Refine with brain" }),
  ).toBeVisible();
  expect(
    mockApi.calls.some((c) =>
      ["update_task", "add_comment"].includes(c.command),
    ),
  ).toBe(false);
});
it("story uses its existing outcome as the primary description without a migration or automatic write", async () => {
  const original = await mockApi.getStory("JB-S1");
  mount(<StoryDrawer storyKey="JB-S1" close={() => {}} openTask={() => {}} />);
  const description = await screen.findByRole("heading", {
    name: "Description",
  });
  const summary = planSummary();
  before(description, summary);
  expect(description.closest("section")).toHaveTextContent(
    original.story.outcomeMd,
  );
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(mockApi.calls.some((c) => c.command === "update_story")).toBe(false);
});

function planSummary() {
  const summary = screen.getByText("Agent plan").closest("summary");
  if (!summary) throw Error("Agent plan disclosure missing");
  return summary;
}
function writes() {
  return mockApi.calls.filter((c) =>
    ["update_task", "update_story", "add_comment"].includes(c.command),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("existing description and full agent plan retain their content on opening without any write", async () => {
  const original = await mockApi.getTask("JB-7");
  mount(<TaskDrawer taskKey={original.key} close={() => {}} />);
  const description = await screen.findByRole("textbox", {
    name: "Description",
  });
  expect(description).toHaveValue(original.descriptionMd);
  const plan = screen.getByTestId("task-brief");
  expect(plan).not.toBeVisible();
  await userEvent.click(planSummary());
  expect(plan).toBeVisible();
  const goal = original.brief.goalMd;
  if (!goal) throw Error("Fixture must include a populated goal");
  expect(within(plan).getByText(goal)).toBeVisible();
  expect(writes()).toEqual([]);
  expect(await mockApi.getTask(original.key)).toEqual(original);
});
it("an empty legacy description shows a distinctly labelled plan goal without copying or persisting it", async () => {
  const before = await mockApi.getTask("JB-7");
  await mockApi.updateTask({
    key: before.key,
    expectedUpdatedAt: before.updatedAt,
    descriptionMd: "",
  });
  mockApi.calls.length = 0;
  mount(<TaskDrawer taskKey={before.key} close={() => {}} />);
  expect(
    await screen.findByRole("textbox", { name: "Description" }),
  ).toHaveValue("");
  const fallback = screen.getByRole("region", {
    name: "Existing planned outcome",
  });
  expect(fallback).toHaveTextContent("From the agent plan");
  expect(fallback).toHaveTextContent(
    "It has not been copied into your description",
  );
  const goal = before.brief.goalMd;
  if (!goal) throw Error("Fixture must include a populated goal");
  expect(fallback).toHaveTextContent(goal);
  expect(writes()).toEqual([]);
  expect((await mockApi.getTask(before.key)).descriptionMd).toBe("");
});
it("a fresh draft has one obvious description input and does not invent a summary or ready plan", async () => {
  const task = await mockApi.createTask({
    title: "Fictional plain-language draft",
    status: "backlog",
  });
  mockApi.calls.length = 0;
  mount(<TaskDrawer taskKey={task.key} close={() => {}} />);
  expect(
    await screen.findByRole("textbox", { name: "Description" }),
  ).toHaveValue("");
  expect(
    screen.queryByRole("region", { name: "Existing planned outcome" }),
  ).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
  expect((await mockApi.getTask(task.key)).status).toBe("backlog");
});
it("saving a human description changes only descriptionMd, leaving structured plan and execution untouched", async () => {
  const original = await mockApi.getTask("JB-7");
  const save = vi.spyOn(mockApi, "updateTask");
  mount(<TaskDrawer taskKey={original.key} close={() => {}} />);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Description" }),
    {
      target: {
        value: "Please make the lantern larger, without changing the controls.",
      },
    },
  );
  await userEvent.click(screen.getByRole("button", { name: /^Save Ctrl/ }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]).toEqual({
    key: original.key,
    expectedUpdatedAt: original.updatedAt,
    descriptionMd:
      "Please make the lantern larger, without changing the controls.",
  });
  await waitFor(() =>
    expect(screen.getByText("All changes saved")).toBeVisible(),
  );
  const after = await mockApi.getTask(original.key);
  expect(after.brief).toEqual(original.brief);
  expect(after.status).toBe(original.status);
  expect(after.assigneeId).toBe(original.assigneeId);
  expect(after.story).toEqual(original.story);
});
it("description save failure keeps exact text and does not automatically retry", async () => {
  const save = vi
    .spyOn(mockApi, "updateTask")
    .mockRejectedValue(new Error("Synthetic write result unavailable"));
  mount(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  const description = await screen.findByRole("textbox", {
    name: "Description",
  });
  fireEvent.change(description, { target: { value: "Keep this human draft" } });
  await userEvent.click(screen.getByRole("button", { name: /^Save Ctrl/ }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(description).toHaveValue("Keep this human draft");
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  await userEvent.click(planSummary());
  await userEvent.click(planSummary());
  expect(description).toHaveValue("Keep this human draft");
  expect(save).toHaveBeenCalledTimes(1);
});
it("collapse and reopening keep the same unsaved technical input without saving or stealing focus", async () => {
  mount(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  await screen.findByRole("textbox", { name: "Description" });
  const summary = planSummary();
  await userEvent.click(summary);
  const change = screen.getByRole("textbox", { name: "Change 1 title" });
  fireEvent.change(change, {
    target: { value: "Unsaved technical correction" },
  });
  await userEvent.click(summary);
  expect(change).not.toBeVisible();
  expect(change.isConnected).toBe(true);
  await userEvent.click(summary);
  expect(screen.getByRole("textbox", { name: "Change 1 title" })).toBe(change);
  expect(change).toHaveValue("Unsaved technical correction");
  expect(writes()).toEqual([]);
});
it("a concurrent agent plan refresh does not erase the unsaved description or get overwritten by it", async () => {
  const original = await mockApi.getTask("JB-7");
  const { client } = mount(
    <TaskDrawer taskKey={original.key} close={() => {}} />,
  );
  const description = await screen.findByRole("textbox", {
    name: "Description",
  });
  fireEvent.change(description, {
    target: { value: "Human correction still under discussion" },
  });
  await act(async () => {
    await mockApi.updateTaskBrief(original.key, {
      ...original.brief,
      goalMd: "Agent refined the technical goal",
    });
    await client.invalidateQueries({ queryKey: ["task", original.key] });
  });
  expect(description).toHaveValue("Human correction still under discussion");
  await userEvent.click(screen.getByRole("button", { name: /^Save Ctrl/ }));
  await screen.findByRole("dialog", { name: "Review changes" });
  const current = await mockApi.getTask(original.key);
  expect(current.brief.goalMd).toBe("Agent refined the technical goal");
  expect(current.descriptionMd).toBe(original.descriptionMd);
  expect(description).toHaveValue("Human correction still under discussion");
});
it("a story description save updates the original outcome field and preserves every technical field", async () => {
  const original = (await mockApi.getStory("JB-S1")).story;
  const save = vi.spyOn(mockApi, "updateStory");
  mount(
    <StoryDrawer
      storyKey={original.key}
      close={() => {}}
      openTask={() => {}}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Description" }),
  );
  const description = screen.getByRole("textbox", { name: "Description" });
  fireEvent.change(description, {
    target: { value: "Let a newcomer see one clear next step." },
  });
  fireEvent.keyDown(description, { key: "s", ctrlKey: true });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]).toEqual([
    original.key,
    { outcomeMd: "Let a newcomer see one clear next step." },
  ]);
  await waitFor(async () =>
    expect((await mockApi.getStory(original.key)).story.outcomeMd).toBe(
      "Let a newcomer see one clear next step.",
    ),
  );
  const after = (await mockApi.getStory(original.key)).story;
  for (const field of [
    "basisMd",
    "preserveMd",
    "scaleMd",
    "rejectionRisksMd",
    "openDecisionsMd",
    "acceptance",
    "status",
  ] as const)
    expect(after[field]).toEqual(original[field]);
});
it("story descriptions retain an unsaved draft across entity switches and never bleed into the other story", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const node = (key: string) => (
    <QueryClientProvider client={client}>
      <StoryDrawer storyKey={key} close={() => {}} openTask={() => {}} />
    </QueryClientProvider>
  );
  const other = (await mockApi.getStory("JB-S2")).story;
  const view = render(node("JB-S1"));
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Description" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "Unsaved Story 1 wish" },
  });
  view.rerender(node("JB-S2"));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Story title" })).toHaveValue(
      other.title,
    ),
  );
  expect(screen.queryByText("Unsaved Story 1 wish")).not.toBeInTheDocument();
  view.rerender(node("JB-S1"));
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Description" }),
  );
  expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Unsaved Story 1 wish",
  );
  expect(writes()).toEqual([]);
});
it("comments capture the original body, single-flight duplicate sends, and retain an unconfirmed result as a draft", async () => {
  const gate = deferred<Awaited<ReturnType<typeof mockApi.addComment>>>();
  const add = vi
    .spyOn(mockApi, "addComment")
    .mockImplementation(() => gate.promise);
  mount(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  const input = await screen.findByRole("textbox", { name: "Write a comment" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, {
    target: { value: "Please keep keyboard navigation" },
  });
  const post = screen.getByRole("button", { name: /Add comment/ });
  act(() => {
    fireEvent.click(post);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.click(post);
  });
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  expect(input).toBeDisabled();
  expect(add.mock.calls[0]?.[0]).toEqual({
    key: "JB-7",
    bodyMd: "Please keep keyboard navigation",
  });
  await act(async () =>
    gate.reject(new Error("Synthetic response unavailable")),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "an error does not prove that nothing was added",
  );
  expect(input).toHaveValue("Please keep keyboard navigation");
  expect(input).toBeEnabled();
  expect(add).toHaveBeenCalledTimes(1);
});
it("comment drafts are scoped to task identity and survive reopening within this session", async () => {
  const first = await mockApi.getTask("JB-7"),
    other = await mockApi.getTask("JB-8");
  const members = await mockApi.listMembers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const node = (task: typeof first) => (
    <QueryClientProvider client={client}>
      <TaskComments
        key={task.id}
        task={task}
        members={members}
        changed={() => {}}
      />
    </QueryClientProvider>
  );
  const view = render(node(first));
  fireEvent.change(screen.getByRole("textbox", { name: "Write a comment" }), {
    target: { value: "Only for the first task" },
  });
  view.rerender(node(other));
  expect(screen.getByRole("textbox", { name: "Write a comment" })).toHaveValue(
    "",
  );
  view.rerender(node(first));
  expect(screen.getByRole("textbox", { name: "Write a comment" })).toHaveValue(
    "Only for the first task",
  );
  expect(writes()).toEqual([]);
});
it.each(["switch", "ABA", "unmount"] as const)(
  "a %s while a comment is pending prevents its late completion from resetting or notifying a new view",
  async (kind) => {
    const task = await mockApi.getTask("JB-7"),
      members = await mockApi.listMembers(),
      app = await mockApi.appState();
    const gate = deferred<Awaited<ReturnType<typeof mockApi.addComment>>>();
    vi.spyOn(mockApi, "addComment").mockImplementation(() => gate.promise);
    const changed = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["app"], app);
    const view = render(
      <QueryClientProvider client={client}>
        <TaskComments task={task} members={members} changed={changed} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Write a comment" }), {
      target: { value: "Captured in the original project" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add comment/ }));
    await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(1));
    if (kind === "unmount") view.unmount();
    else
      act(() => {
        client.setQueryData(["app"], {
          ...app,
          jam: { ...app.jam, id: "other-project" },
        });
        if (kind === "ABA") client.setQueryData(["app"], app);
      });
    await act(async () =>
      gate.resolve({
        id: crypto.randomUUID(),
        taskId: task.id,
        authorId: "human",
        bodyMd: "Captured in the original project",
        createdAt: new Date().toISOString(),
      }),
    );
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByText("Comment added.")).not.toBeInTheDocument();
    expect(
      client.getQueryData<{ draft: string }>([
        "planning-draft",
        `${task.id}:comment`,
      ])?.draft,
    ).toBe("Captured in the original project");
  },
);

it("posting a human-language comment preserves a separate unsaved description and the technical plan", async () => {
  const original = await mockApi.getTask("JB-7");
  mount(<TaskDrawer taskKey={original.key} close={() => {}} />);
  const description = await screen.findByRole("textbox", {
    name: "Description",
  });
  const comment = screen.getByRole("textbox", { name: "Write a comment" });
  await waitFor(() => expect(comment).toBeEnabled());
  fireEvent.change(description, {
    target: { value: "Хочу крупную кнопку запуска и спокойные цвета." },
  });
  fireEvent.change(comment, {
    target: { value: "Пожалуйста, не добавляй мигающую анимацию." },
  });
  await userEvent.click(screen.getByRole("button", { name: /Add comment/ }));
  await screen.findByText("Comment added.");
  expect(description).toHaveValue(
    "Хочу крупную кнопку запуска и спокойные цвета.",
  );
  expect(comment).toHaveValue("");
  const after = await mockApi.getTask(original.key);
  expect(after.comments.at(-1)?.bodyMd).toBe(
    "Пожалуйста, не добавляй мигающую анимацию.",
  );
  expect(after.descriptionMd).toBe(original.descriptionMd);
  expect(after.brief).toEqual(original.brief);
  expect(after.status).toBe(original.status);
  expect(writes().map((call) => call.command)).toEqual(["add_comment"]);
});
it("an archived task remains readable with a closed plan and cannot post or edit human text", async () => {
  await mockApi.archiveTask("JB-7");
  mockApi.calls.length = 0;
  mount(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  expect(
    await screen.findByRole("textbox", { name: "Description" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("textbox", { name: "Write a comment" }),
  ).not.toBeInTheDocument();
  await userEvent.click(planSummary());
  expect(screen.getByTestId("task-brief")).toBeVisible();
  expect(writes()).toEqual([]);
});
it("description and comments on active work preserve its holder and lifecycle while making the old task version stale", async () => {
  const item = (await mockApi.listBoardTasks()).in_progress.find(
    (task) => task.assigneeId,
  );
  if (!item) throw Error("Fixture needs an assigned task in progress");
  const original = await mockApi.getTask(item.key);
  mount(<TaskDrawer taskKey={original.key} close={() => {}} />);
  const description = await screen.findByRole("textbox", {
    name: "Description",
  });
  fireEvent.change(description, {
    target: { value: "Оставь текущую работу; добавь понятный текст ошибки." },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Save Ctrl/ }));
  await waitFor(() =>
    expect(screen.getByText("All changes saved")).toBeVisible(),
  );
  const input = screen.getByRole("textbox", { name: "Write a comment" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, {
    target: { value: "Это уточнение, не запуск нового исполнителя." },
  });
  await userEvent.click(screen.getByRole("button", { name: /Add comment/ }));
  await screen.findByText("Comment added.");
  const current = await mockApi.getTask(original.key);
  for (const field of [
    "status",
    "assigneeId",
    "claimGeneration",
    "reviewRound",
    "reports",
    "reviews",
    "brief",
  ] as const)
    expect(current[field]).toEqual(original[field]);
  expect(current.updatedAt).not.toBe(original.updatedAt);
  await expect(
    mockApi.updateTask({
      key: original.key,
      expectedUpdatedAt: original.updatedAt,
      title: "Stale overwrite must fail",
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect((await mockApi.getTask(original.key)).title).toBe(original.title);
});
