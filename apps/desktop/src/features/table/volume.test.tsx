import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agentWorking } from "../../lib/agent-working";
import { MockBridge, mockApi } from "../../lib/mock-bridge";
import { acceptProjectSelection } from "../../lib/project-selection";

type MockTaskPage = Awaited<ReturnType<typeof mockApi.listTasks>>;

import type { TableSearch } from "./search";
import { TaskTable } from "./TaskTable";

const blank = (name: string) => ({
  name,
  yourName: "QA human",
  theme: null,
  startsAt: "",
  endsAt: "",
  timezone: "UTC",
  template: "custom",
  milestoneAt: null,
});
const query = { sort: { field: "key", dir: "asc" } };
beforeEach(async () => {
  await mockApi.resetDemo();
  // Explicit synthetic viewport for deterministic virtual-window tests. This is
  // not a native layout/frame-time measurement.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-scroll") ? 623 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-scroll") ? 1200 : 0;
    },
  );
});
afterEach(() => vi.restoreAllMocks());
function mount(
  search: TableSearch = { sort: "key:asc" },
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  }),
) {
  const open = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <TaskTable search={search} change={() => {}} open={open} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    open,
    change: (next: TableSearch) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <TaskTable search={next} change={() => {}} open={open} />
        </QueryClientProvider>,
      ),
  };
}
it("2000 tasks retain a bounded real virtual window while scrolling and opening an exact row", async () => {
  const project = await mockApi.createJam(blank("Large table fixture"));
  await mockApi.seedBulk(2000);
  const { open } = mount();
  await screen.findByText("2000 tasks", { exact: true });
  const prefix = project.jam?.keyPrefix;
  const initial = await screen.findAllByTestId("table-row");
  expect(initial.length).toBeGreaterThan(0);
  expect(initial.length).toBeLessThanOrEqual(60);
  expect(initial[0]).toHaveAttribute("data-task-key", `${prefix}-1`);
  const scroll = screen.getByTestId("table-scroll");
  act(() => {
    scroll.scrollTop = 44000;
    fireEvent.scroll(scroll);
  });
  const middle = screen.getAllByTestId("table-row");
  expect(middle.length).toBeLessThanOrEqual(60);
  expect(middle.some((row) => row.dataset.taskKey === `${prefix}-1001`)).toBe(
    true,
  );
  expect(middle.some((row) => row.dataset.taskKey === `${prefix}-1`)).toBe(
    false,
  );
  const row = middle[5];
  if (!row) throw Error("Missing visible virtual row");
  row.focus();
  fireEvent.keyDown(row, { key: "Enter" });
  expect(open).toHaveBeenCalledExactlyOnceWith(row.dataset.taskKey);
});
it("large-table status, hierarchy, tags, text and numeric order keep exact counts", async () => {
  const project = await mockApi.createJam(blank("Filter fixture"));
  await mockApi.seedBulk(2000);
  const { change } = mount();
  await screen.findByText("2000 tasks", { exact: true });
  const epics = await mockApi.listEpics(),
    stories = await mockApi.listStories();
  const cases: [TableSearch, number][] = [
    [{ status: "in_progress", sort: "key:asc" }, 400],
    [{ epic: epics[0]?.key, sort: "key:asc" }, 400],
    [{ story: stories[0]?.key, sort: "key:asc" }, 100],
    [{ tags: "ui", sort: "key:asc" }, 1000],
    [{ q: "Bulk task 1000:", sort: "key:asc" }, 1],
    [{ q: "does not exist", sort: "key:asc" }, 0],
  ];
  for (const [filter, count] of cases) {
    change(filter);
    await screen.findByText(`${count} ${count === 1 ? "task" : "tasks"}`, {
      exact: true,
    });
    expect(screen.queryAllByTestId("table-row").length).toBeLessThanOrEqual(60);
  }
  expect(await screen.findByText("No tasks match these filters")).toBeVisible();
  change({ sort: "key:desc" });
  await screen.findByText("2000 tasks", { exact: true });
  expect(screen.getAllByTestId("table-row")[0]).toHaveAttribute(
    "data-task-key",
    `${project.jam?.keyPrefix}-2000`,
  );
});
it("an unreadable table never claims there are zero tasks", async () => {
  vi.spyOn(mockApi, "listTasks").mockRejectedValueOnce(
    new Error("Fictional read failure"),
  );
  mount();
  expect(await screen.findByText("Count unavailable")).toBeVisible();
  expect(screen.queryByText("0 tasks", { exact: true })).toBeNull();
  expect(screen.queryByText("No tasks match these filters")).toBeNull();
  expect(screen.getByText("Fictional read failure")).toBeVisible();
});
it("a pending 2000-row old-project response cannot replace a selected 1000-row project", async () => {
  const a = await mockApi.createJam(blank("Large A"));
  await mockApi.seedBulk(2000);
  const old = await mockApi.listTasks(query);
  const b = await mockApi.createJam(blank("Large B"));
  await mockApi.seedBulk(1000);
  const c = await mockApi.createJam(blank("Small C"));
  await mockApi.seedBulk(40);
  const selectedA = await mockApi.selectProject(a.jam?.id ?? "");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], selectedA);
  client.setQueryData(["planning-draft", a.jam?.id], {
    dirty: true,
    value: "Preserve unsaved A plan",
  });
  let resolve!: (page: MockTaskPage) => void;
  const pending = new Promise<MockTaskPage>((r) => {
    resolve = r;
  });
  const slow = vi
    .spyOn(mockApi, "listTasks")
    .mockImplementationOnce(() => pending);
  mount({ sort: "key:asc" }, client);
  await waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Reading tasks…", { exact: true })).toBeVisible();
  expect(screen.queryByText("0 tasks", { exact: true })).toBeNull();
  await act(async () =>
    acceptProjectSelection(
      client,
      await mockApi.selectProject(b.jam?.id ?? ""),
    ),
  );
  await screen.findByText("1000 tasks", { exact: true });
  await act(async () => {
    resolve(old);
    await pending;
  });
  expect(screen.getByText("1000 tasks", { exact: true })).toBeVisible();
  expect(
    screen
      .getAllByTestId("table-row")
      .every((row) => row.dataset.taskKey?.startsWith(`${b.jam?.keyPrefix}-`)),
  ).toBe(true);
  await act(async () =>
    acceptProjectSelection(
      client,
      await mockApi.selectProject(c.jam?.id ?? ""),
    ),
  );
  await screen.findByText("40 tasks", { exact: true });
  expect(
    screen
      .getAllByTestId("table-row")
      .every((row) => row.dataset.taskKey?.startsWith(`${c.jam?.keyPrefix}-`)),
  ).toBe(true);
  expect(client.getQueryData(["planning-draft", a.jam?.id])).toEqual({
    dirty: true,
    value: "Preserve unsaved A plan",
  });
  expect((await mockApi.listProjects()).map((p) => p.taskCount)).toEqual(
    expect.arrayContaining([2000, 1000, 40]),
  );
});
it("practical 50 task-scoped actors establish exactly 50 active tasks, never every assignment", async () => {
  const bridge = new MockBridge();
  await bridge.createJam(blank("Scoped practical fixture"));
  await bridge.seedBulk(2000);
  await bridge.seedWorkingPresence(50, true);
  const members = new Map((await bridge.listMembers()).map((m) => [m.id, m]));
  const tasks = (await bridge.listTasks(query)).tasks;
  const active = tasks.filter(
    (t) =>
      agentWorking(t, members.get(t.assigneeId ?? ""), Date.now())?.mode ===
      "active",
  );
  expect(active).toHaveLength(50);
  expect(new Set(active.map((t) => t.assigneeId)).size).toBe(50);
  expect(
    new Set(
      [...members.values()]
        .filter(
          (m) =>
            m.handle.startsWith("perf-worker-") &&
            m.statusScope?.type === "task",
        )
        .map((m) => m.statusScope?.id),
    ).size,
  ).toBe(50);
});
it("50 unscoped actors stay quiet across 2000 tasks rather than falsely animating work", async () => {
  const bridge = new MockBridge();
  await bridge.createJam(blank("Quiet presence fixture"));
  await bridge.seedBulk(2000);
  await bridge.seedWorkingPresence(50);
  const members = new Map((await bridge.listMembers()).map((m) => [m.id, m]));
  const states = (await bridge.listTasks(query)).tasks.map((t) =>
    agentWorking(t, members.get(t.assigneeId ?? ""), Date.now()),
  );
  expect(states.every((s) => s?.mode === "quiet")).toBe(true);
  expect(
    states.every((s) => s?.text.includes("task activity unconfirmed")),
  ).toBe(true);
});
it("the separately labelled 2000-actor stress fixture uses unique task scopes and survives mock reload", async () => {
  sessionStorage.removeItem("jam.mock");
  const bridge = new MockBridge(true);
  await bridge.createJam(blank("Scoped stress fixture — not typical usage"));
  await bridge.seedBulk(2000);
  await bridge.seedWorkingPresence(2000, true);
  const reloaded = new MockBridge(true);
  const members = new Map((await reloaded.listMembers()).map((m) => [m.id, m]));
  const tasks = (await reloaded.listTasks(query)).tasks;
  expect(tasks).toHaveLength(2000);
  expect(
    tasks.every(
      (t) =>
        agentWorking(t, members.get(t.assigneeId ?? ""), Date.now())?.mode ===
        "active",
    ),
  ).toBe(true);
  expect(new Set(tasks.map((t) => t.assigneeId)).size).toBe(2000);
  expect(sessionStorage.getItem("jam.mock")?.length).toBeLessThan(4_000_000);
  sessionStorage.removeItem("jam.mock");
});
