import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { acceptProjectSelection } from "../../lib/project-selection";
import { type TableSearch, tableQuery } from "./search";
import { TaskTable } from "./TaskTable";

vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({}) }));
beforeEach(async () => {
  await mockApi.resetDemo();
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
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-scroll")
        ? Number.parseFloat(this.querySelector("table")?.style.height ?? "0")
        : 0;
    },
  );
  // Happy DOM has no layout. Match native scrolling's offset + scroll event for
  // the real virtualizer; this does not measure geometry or frame time.
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    options: ScrollToOptions | number,
    y?: number,
  ) {
    const top = typeof options === "number" ? y : options.top;
    if (top !== undefined) this.scrollTop = top;
    queueMicrotask(() => act(() => fireEvent.scroll(this)));
  });
});
afterEach(() => vi.restoreAllMocks());
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
function mount(search: TableSearch = { sort: "key:asc" }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const open = vi.fn(),
    change = vi.fn();
  const node = (value: TableSearch) => (
    <QueryClientProvider client={client}>
      <TaskTable search={value} change={change} open={open} />
    </QueryClientProvider>
  );
  const view = render(node(search));
  return {
    ...view,
    client,
    open,
    change,
    search: (value: TableSearch) => view.rerender(node(value)),
  };
}
const entry = () =>
  document.querySelector<HTMLElement>('[data-task-key][tabindex="0"]');
function moveScroll(top: number) {
  act(() => {
    const scroll = screen.getByTestId("table-scroll");
    scroll.scrollTop = top;
    fireEvent.scroll(scroll);
  });
}

it("a scrolled 2000-row window has one keyboard entry and Enter opens its exact task", async () => {
  await mockApi.createJam(blank("Keyboard volume"));
  await mockApi.seedBulk(2000);
  const h = mount();
  await screen.findByText("2000 tasks", { exact: true });
  moveScroll(44000);
  expect(screen.getAllByTestId("table-row").length).toBeLessThanOrEqual(60);
  expect(
    document.querySelectorAll('[data-task-key][tabindex="0"]'),
  ).toHaveLength(1);
  expect(entry()?.dataset.taskKey).toMatch(/-1001$/);
  const user = userEvent.setup();
  const before = screen.getByRole("button", { name: "+ New task" });
  before.focus();
  await user.tab();
  expect(entry()).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(h.open).toHaveBeenCalledExactlyOnceWith(entry()?.dataset.taskKey);
});
it.each([true, false])(
  "a remembered off-screen overscan row is not the Tab entry (row owns focus: %s)",
  async (ownsFocus) => {
    await mockApi.createJam(blank("Overscan entry"));
    await mockApi.seedBulk(2000);
    mount();
    await screen.findByText("2000 tasks", { exact: true });
    const remembered = entry();
    act(() => remembered?.focus());
    const input = screen.getByRole("textbox", { name: "Search tasks" });
    if (!ownsFocus) act(() => input.focus());
    // Still inside one 50-row render block: remembered row remains mounted, but
    // is ten rows above the synthetic viewport. Overscan is not visibility.
    moveScroll(440);
    expect(remembered?.isConnected).toBe(true);
    expect(remembered).toHaveAttribute("tabindex", "-1");
    expect(entry()?.dataset.taskKey).toMatch(/-11$/);
    expect(screen.getByTestId("table-scroll").scrollTop).toBe(440);
    if (ownsFocus) expect(entry()).toHaveFocus();
    else expect(input).toHaveFocus();
    expect(screen.getAllByTestId("table-row").length).toBeLessThanOrEqual(60);
  },
);
it("bottom overscan behind the sticky header's viewport allowance is not a remembered entry", async () => {
  const project = await mockApi.createJam(blank("Bottom overscan"));
  await mockApi.seedBulk(2000);
  mount();
  await screen.findByText("2000 tasks", { exact: true });
  moveScroll(440);
  const row = document.querySelector<HTMLElement>(
    `[data-task-key="${project.jam?.keyPrefix}-14"]`,
  );
  act(() => row?.focus());
  moveScroll(0);
  expect(row?.isConnected).toBe(true);
  expect(row).toHaveAttribute("tabindex", "-1");
  expect(entry()?.dataset.taskKey).toMatch(/-1$/);
  expect(entry()).toHaveFocus();
  expect(screen.getByTestId("table-scroll").scrollTop).toBe(0);
});
it("arrows and Home/End cross virtual windows without mounting the whole table", async () => {
  const project = await mockApi.createJam(blank("Keyboard boundaries"));
  await mockApi.seedBulk(2000);
  mount();
  await screen.findByText("2000 tasks", { exact: true });
  const prefix = project.jam?.keyPrefix;
  const reveal = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  act(() => entry()?.focus());
  fireEvent.keyDown(document.activeElement as Element, { key: "End" });
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute(
      "data-task-key",
      `${prefix}-2000`,
    ),
  );
  expect(screen.getAllByTestId("table-row").length).toBeLessThanOrEqual(60);
  expect(reveal).toHaveBeenLastCalledWith({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
  expect(document.activeElement).toHaveAttribute(
    "data-task-key",
    `${prefix}-2000`,
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute(
      "data-task-key",
      `${prefix}-1999`,
    ),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute(
      "data-task-key",
      `${prefix}-1`,
    ),
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
  expect(document.activeElement).toHaveAttribute(
    "data-task-key",
    `${prefix}-1`,
  );
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute(
      "data-task-key",
      `${prefix}-2`,
    ),
  );
});
it("removing the genuinely focused row restores an available row, but never steals filter input focus", async () => {
  const h = mount();
  const rows = await screen.findAllByTestId("table-row");
  act(() => rows[0]?.focus());
  const key = rows[0]?.dataset.taskKey;
  const query = tableQuery({ sort: "key:asc" }),
    original = await mockApi.listTasks(query);
  await act(async () => {
    h.client.setQueryData(["tableTasks", query], {
      ...original,
      total: original.total - 1,
      tasks: original.tasks.filter((t) => t.key !== key),
    });
  });
  await waitFor(() => expect(entry()).toHaveFocus());
  expect(entry()?.dataset.taskKey).not.toBe(key);
  const removed = entry()?.dataset.taskKey;
  const input = screen.getByRole("textbox", { name: "Search tasks" });
  input.focus();
  await act(async () => {
    h.client.setQueryData(["tableTasks", query], {
      ...original,
      total: original.total - 2,
      tasks: original.tasks.filter((t) => t.key !== key && t.key !== removed),
    });
  });
  expect(input).toHaveFocus();
  expect(
    document.querySelectorAll('[data-task-key][tabindex="0"]'),
  ).toHaveLength(1);
});
it("a background reordering preserves task identity and restores it even outside the prior window", async () => {
  const project = await mockApi.createJam(blank("Sorted focused fixture"));
  await mockApi.seedBulk(2000);
  const h = mount();
  await screen.findByText("2000 tasks", { exact: true });
  act(() => entry()?.focus());
  const key = entry()?.dataset.taskKey;
  const query = tableQuery({ sort: "key:asc" }),
    page = await mockApi.listTasks(query);
  await act(async () => {
    h.client.setQueryData(["tableTasks", query], {
      ...page,
      tasks: [...page.tasks].reverse(),
    });
  });
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute("data-task-key", key),
  );
  expect(key).toBe(`${project.jam?.keyPrefix}-1`);
  expect(screen.getAllByTestId("table-row").length).toBeLessThanOrEqual(60);
});
it("sort and filter controls retain their own focus and each resulting window has an entry", async () => {
  const h = mount();
  await screen.findAllByTestId("table-row");
  act(() => entry()?.focus());
  const sort = screen.getByRole("button", { name: "Title" });
  sort.focus();
  h.search({ sort: "title:desc" });
  await waitFor(() => expect(h.client.isFetching()).toBe(0));
  expect(screen.getByRole("button", { name: "Title" })).toHaveFocus();
  expect(entry()).not.toBeNull();
  const input = screen.getByRole("textbox", { name: "Search tasks" });
  input.focus();
  h.search({ sort: "title:desc", q: "Jam Board" });
  await waitFor(() => expect(h.client.isFetching()).toBe(0));
  expect(input).toHaveFocus();
  if (screen.queryAllByTestId("table-row").length)
    expect(entry()).not.toBeNull();
});
it("project selection cannot retain a foreign row entry or steal focus from search", async () => {
  const a = await mockApi.createJam(blank("Keyboard A"));
  await mockApi.seedBulk(40);
  const b = await mockApi.createJam(blank("Keyboard B"));
  await mockApi.seedBulk(20);
  await mockApi.selectProject(a.jam?.id ?? "");
  const h = mount();
  await screen.findByText("40 tasks", { exact: true });
  act(() => entry()?.focus());
  const input = screen.getByRole("textbox", { name: "Search tasks" });
  input.focus();
  await act(async () =>
    acceptProjectSelection(
      h.client,
      await mockApi.selectProject(b.jam?.id ?? ""),
    ),
  );
  await screen.findByText("20 tasks", { exact: true });
  expect(input).toHaveFocus();
  expect(entry()?.dataset.taskKey).toMatch(new RegExp(`^${b.jam?.keyPrefix}-`));
  expect(
    screen
      .getAllByTestId("table-row")
      .every((r) => r.dataset.taskKey?.startsWith(`${b.jam?.keyPrefix}-`)),
  ).toBe(true);
});
it("Retry task list retains filters and distinguishes failed reads from an empty result", async () => {
  const read = vi
    .spyOn(mockApi, "listTasks")
    .mockRejectedValueOnce(new Error("Known read failure"));
  const search = { status: "ready", q: "task", sort: "key:asc" } as const;
  mount(search);
  await screen.findByText("Count unavailable");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Retry task list" }));
  await waitFor(() =>
    expect(screen.queryByText("Count unavailable")).toBeNull(),
  );
  expect(
    read.mock.calls.every(
      ([q]) => q?.text === "task" && q?.status?.[0] === "ready",
    ),
  ).toBe(true);
  expect(screen.getByRole("textbox", { name: "Search tasks" })).toHaveValue(
    "task",
  );
});
