import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, expect, it } from "vitest";
import { TagInput } from "../../components/ui";
import { mockApi } from "../../lib/mock-bridge";
import { shortcutAction } from "../../lib/shortcuts";
import { useUiStore } from "../../lib/ui-store";
import { CommandPalette, rankTasks } from "../command/CommandPalette";
import {
  nextSort,
  serializeTableSearch,
  tableQuery,
  validateTableSearch,
} from "../table/search";
import { TaskDrawer } from "./TaskDrawer";
import { taskPatch, taskSchema, taskValues } from "./task-form";

beforeEach(async () => {
  await mockApi.loadDemoJam();
  mockApi.setLatency(0);
  mockApi.calls.length = 0;
  useUiStore.setState({ taskChanges: {}, highlights: {}, toasts: [] });
});
function harness(palette = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const root = createRootRoute({
    component: function Root() {
      useEffect(
        () =>
          mockApi.onBoardChanged((events) => {
            useUiStore.getState().receive(events);
            void client.invalidateQueries();
          }),
        [],
      );
      return <Outlet />;
    },
  });
  const route = createRoute({
    getParentRoute: () => root,
    path: "/board",
    validateSearch: (s: Record<string, unknown>) => ({
      task: typeof s.task === "string" ? s.task : undefined,
    }),
    component: function Page() {
      const search = route.useSearch() as { task?: string };
      const navigate = useNavigate();
      const [show, setShow] = useState(palette);
      return (
        <>
          {show && (
            <CommandPalette
              close={() => setShow(false)}
              newTask={() => {}}
              toggleTheme={() => {}}
            />
          )}
          {search.task && (
            <TaskDrawer
              taskKey={search.task}
              close={() => {
                void navigate({ to: "/board", search: {} });
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              void navigate({ to: "/board", search: { task: "JB-8" } });
            }}
          >
            Other task
          </button>
        </>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [palette ? "/board" : "/board?task=JB-7"],
    }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}
it("validates URL garbage per field and serializes all filters", () => {
  const value = validateTableSearch({
    q: "lantern",
    status: "ready,wrong,review",
    assignee: "agents",
    tags: " UI ,bug,UI",
    archived: "1",
    sort: "priority:desc",
    task: 55,
    extra: true,
  });
  expect(value).toEqual({
    q: "lantern",
    status: "ready,review",
    assignee: "agents",
    tags: "ui,bug",
    archived: "1",
    sort: "priority:desc",
  });
  expect(
    validateTableSearch({
      q: 1,
      status: [],
      archived: "garbage",
      sort: "DROP TABLE",
      tags: {},
    }),
  ).toEqual({ sort: "updatedAt:desc" });
  expect(
    validateTableSearch(
      Object.fromEntries(new URLSearchParams(serializeTableSearch(value))),
    ),
  ).toEqual(value);
  expect(tableQuery(value).sort).toEqual({ field: "priority", dir: "desc" });
});
it("three header clicks cycle asc, desc, none with explicit default reset", () => {
  let sort: string | undefined;
  sort = nextSort(sort, "priority");
  expect(sort).toBe("priority:asc");
  sort = nextSort(sort, "priority");
  expect(sort).toBe("priority:desc");
  sort = nextSort(sort, "priority");
  expect(sort).toBe("none");
  expect(tableQuery({ sort }).sort).toBeNull();
  expect(tableQuery({}).sort).toEqual({ field: "updatedAt", dir: "desc" });
});
it("tag input normalizes, deduplicates and handles Enter comma Backspace", async () => {
  function Tags() {
    const [tags, setTags] = useState<string[]>([]);
    return (
      <>
        <TagInput value={tags} onChange={setTags} />
        <output>{tags.join("|")}</output>
      </>
    );
  }
  render(<Tags />);
  const user = userEvent.setup();
  const input = screen.getByRole("combobox", { name: "Tags" });
  await user.type(input, "  UI {Enter}bug,");
  expect(screen.getByRole("status")).toHaveTextContent("ui|bug");
  await user.type(input, "UI{Enter}");
  expect(screen.getByRole("status")).toHaveTextContent("ui|bug");
  await user.keyboard("{Backspace}");
  expect(screen.getByRole("status")).toHaveTextContent(/^ui$/);
  await user.type(input, `${"x".repeat(25)}{Enter}`);
  expect(screen.getByRole("alert")).toHaveTextContent("24");
});
it("task schema rejects invalid fields and patches only changed fields including null", async () => {
  const task = await mockApi.getTask("JB-7");
  const base = taskValues(task);
  expect(taskSchema.safeParse({ ...base, title: " " }).success).toBe(false);
  expect(taskSchema.safeParse({ ...base, estimate: 4 }).success).toBe(false);
  expect(
    taskSchema.safeParse({ ...base, tags: ["x".repeat(25)] }).success,
  ).toBe(false);
  expect(
    taskPatch(
      { ...base, estimate: 3 },
      { ...base, estimate: null, title: "New title" },
    ),
  ).toEqual({ estimate: null, title: "New title" });
});
it("form dirty validation and Ctrl S send only the edited field", async () => {
  harness();
  const input = await screen.findByRole("textbox", { name: "Task title" });
  const save = screen.getByRole("button", { name: /^Save/ });
  expect(save).toBeDisabled();
  fireEvent.change(input, { target: { value: "" } });
  await waitFor(() =>
    expect(screen.getByText("Use 1–140 characters")).toBeVisible(),
  );
  expect(save).toBeDisabled();
  fireEvent.change(input, { target: { value: "Updated jump buffer" } });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(save).toBeDisabled());
  const call = mockApi.calls.find((c) => c.command === "update_task");
  expect(call?.input).toEqual({
    key: "JB-7",
    expectedUpdatedAt: expect.any(String),
    title: "Updated jump buffer",
  });
  expect((await mockApi.getTask("JB-7")).title).toBe("Updated jump buffer");
});
it("saving whitespace-only title edits restores a clean form without a mutation", async () => {
  harness();
  const input = await screen.findByRole("textbox", { name: "Task title" });
  const original = (input as HTMLTextAreaElement).value;
  fireEvent.change(input, { target: { value: `${original} ` } });
  const save = screen.getByRole("button", { name: /^Save/ });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(save).toBeDisabled());
  expect(input).toHaveValue(original);
  expect(mockApi.calls.some((call) => call.command === "update_task")).toBe(
    false,
  );
});
it("dirty close offers Keep editing and Discard and protects task navigation", async () => {
  const { router } = harness();
  const input = await screen.findByRole("textbox", { name: "Task title" });
  fireEvent.change(input, { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Close task" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Discard changes?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(input).toHaveValue("Unsaved");
  act(() => {
    void router.navigate({ to: "/board", search: { task: "JB-8" } });
  });
  const again = await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(within(again).getByRole("button", { name: "Discard" }));
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ task: "JB-8" }),
  );
});
it.each(["Take theirs", "Keep mine"])(
  "conflict comparison supports %s without dropping another field",
  async (action) => {
    harness();
    const input = await screen.findByRole("textbox", { name: "Task title" });
    fireEvent.change(input, { target: { value: "Human title" } });
    await act(() =>
      mockApi.simulateAgent({
        action: "task.updated",
        key: "JB-7",
        patch: { title: "Agent title", priority: "critical" },
      }),
    );
    expect(
      await screen.findByText(/Codex updated this task while you were editing/),
    ).toBeVisible();
    expect(input).toHaveValue("Human title");
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Review changes",
    });
    expect(dialog).toHaveTextContent("Agent title");
    fireEvent.click(within(dialog).getByRole("button", { name: action }));
    const expected = action === "Take theirs" ? "Agent title" : "Human title";
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled(),
    );
    expect(input).toHaveValue(expected);
    expect((await mockApi.getTask("JB-7")).priority).toBe("critical");
    expect((await mockApi.getTask("JB-7")).title).toBe(expected);
  },
);
it("mock rejects a stale version and archived edits, history contains comments", async () => {
  const old = await mockApi.getTask("JB-7");
  await mockApi.simulateAgent({
    action: "task.updated",
    key: old.key,
    title: "Agent change",
  });
  await expect(
    mockApi.updateTask({
      key: old.key,
      expectedUpdatedAt: old.updatedAt,
      title: "Stale",
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    mockApi.addComment({ key: old.key, bodyMd: " " }),
  ).rejects.toMatchObject({ code: "validation" });
  await mockApi.addComment({ key: old.key, bodyMd: "A note" });
  expect((await mockApi.getTask(old.key)).history.at(-1)?.action).toBe(
    "comment.added",
  );
  await mockApi.archiveTask(old.key, "Finished");
  await expect(
    mockApi.updateTask({
      key: old.key,
      expectedUpdatedAt: old.updatedAt,
      title: "No",
    }),
  ).rejects.toMatchObject({ code: "archived" });
  await mockApi.unarchiveTask(old.key);
  expect((await mockApi.getTask(old.key)).archivedAt).toBeNull();
});
it("palette puts exact case-insensitive key and number first", async () => {
  const tasks = Object.values(await mockApi.listBoardTasks()).flat();
  expect(rankTasks(tasks, "jb-5")[0]?.key).toBe("JB-5");
  expect(rankTasks(tasks, "5")[0]?.key).toBe("JB-5");
  expect(rankTasks(tasks, "lntn").length).toBeGreaterThan(0);
});
it("palette arrow navigation and Escape close the dialog", async () => {
  harness(true);
  const input = await screen.findByRole("combobox", {
    name: "Search commands",
  });
  await waitFor(() =>
    expect(screen.getAllByRole("option").length).toBeGreaterThan(8),
  );
  const first = input.getAttribute("aria-activedescendant");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.getAttribute("aria-activedescendant")).toBe(first);
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("global shortcuts ignore all text and select controls", () => {
  for (const tag of ["input", "textarea", "select"]) {
    const target = document.createElement(tag);
    for (const key of ["n", "k", "?", "b"])
      expect(
        shortcutAction(
          { key, ctrlKey: key === "k", metaKey: false, altKey: false, target },
          100,
          200,
        ),
      ).toBeNull();
  }
  expect(
    shortcutAction(
      {
        key: "t",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: document.body,
      },
      100,
      200,
    ),
  ).toBe("/table");
});
