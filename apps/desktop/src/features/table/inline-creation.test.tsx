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
import { useUiStore } from "../../lib/ui-store";
import { InlineTaskCreate } from "./InlineTaskCreate";
import { TaskTable } from "./TaskTable";

const route = vi.hoisted(() => ({
  blocker: undefined as
    | undefined
    | { shouldBlockFn(): boolean; enableBeforeUnload: boolean },
}));
vi.mock("@tanstack/react-router", () => ({
  useBlocker: (options: typeof route.blocker) => {
    route.blocker = options;
  },
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  localStorage.setItem("jam.lastStory", "JB-S1");
  useUiStore.setState({ toasts: [], highlights: {} });
});
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  }),
) {
  client.setQueryData(["app"], await mockApi.appState());
  const view = render(
    <QueryClientProvider client={client}>
      <TaskTable search={{ sort: "key:asc" }} change={vi.fn()} open={vi.fn()} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return { ...view, client, user: userEvent.setup() };
}
async function draft(
  user: ReturnType<typeof userEvent.setup>,
  title = "Captured table task",
) {
  await user.click(screen.getByRole("button", { name: "+ New task" }));
  await user.type(
    screen.getByRole("textbox", { name: "New task title" }),
    title,
  );
  await user.click(screen.getByRole("combobox", { name: "New task priority" }));
  await user.click(screen.getByRole("option", { name: "critical" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled(),
  );
}
it("inline submission captures values, blocks same-event duplicates and dismissal, and reports focused success", async () => {
  const gate = deferred<void>(),
    original = mockApi.createTask.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "createTask")
    .mockImplementation(async (input) => {
      const task = await original(input);
      await gate.promise;
      return task;
    });
  const h = await mount();
  await draft(h.user);
  const form = screen.getByRole("form", { name: "New table task" });
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(form, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({
    title: "Captured table task",
    storyKey: "JB-S1",
    status: "backlog",
    priority: "critical",
  });
  expect(route.blocker?.shouldBlockFn()).toBe(true);
  expect(route.blocker?.enableBeforeUnload).toBe(true);
  for (const name of [
    "New task title",
    "New task story",
    "New task status",
    "New task priority",
  ])
    expect(screen.getByLabelText(name)).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Cancel new task" }),
  ).toBeDisabled();
  expect(screen.getByRole("status")).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Wait for the result");
  await h.user.keyboard("{Escape}{Enter}");
  act(() => window.dispatchEvent(new Event("table-new-task")));
  expect(screen.getByRole("textbox", { name: "New task title" })).toHaveValue(
    "Captured table task",
  );
  await act(async () => gate.resolve());
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New table task" })).toBeNull(),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    /Created JB-\d+ in Backlog/,
  );
  expect(screen.getByRole("status")).toHaveFocus();
  expect(create).toHaveBeenCalledTimes(1);
});
it("known failure retains the whole draft, restores title focus and allows exactly one explicit retry", async () => {
  const gate = deferred<void>(),
    original = mockApi.createTask.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "createTask")
    .mockImplementationOnce(async () => {
      await gate.promise;
      throw Error("Known save failure");
    })
    .mockImplementation(original);
  const h = await mount();
  await draft(h.user, "Keep this table brief");
  await h.user.click(screen.getByRole("button", { name: "Create" }));
  await act(async () => gate.resolve());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Known save failure",
  );
  expect(screen.getByRole("textbox", { name: "New task title" })).toHaveValue(
    "Keep this table brief",
  );
  expect(screen.getByRole("textbox", { name: "New task title" })).toHaveFocus();
  expect(
    screen.getByRole("combobox", { name: "New task priority" }),
  ).toHaveTextContent("critical");
  expect(route.blocker?.shouldBlockFn()).toBe(false);
  expect(screen.getByRole("button", { name: "Cancel new task" })).toBeEnabled();
  expect(create).toHaveBeenCalledTimes(1);
  await h.user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New table task" })).toBeNull(),
  );
  expect(create).toHaveBeenCalledTimes(2);
  expect(
    (await mockApi.listTasks({ text: "Keep this table brief" })).tasks,
  ).toHaveLength(1);
});
it("settled Escape discards only this draft and restores the table entry point", async () => {
  const h = await mount();
  await draft(h.user, "Discard explicitly");
  const create = vi.spyOn(mockApi, "createTask");
  screen.getByRole("textbox", { name: "New task title" }).focus();
  await h.user.keyboard("{Escape}");
  expect(screen.queryByRole("form", { name: "New table task" })).toBeNull();
  expect(screen.getByRole("button", { name: "+ New task" })).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});
it.each(["success", "failure"] as const)(
  "late %s from an unmounted inline editor cannot erase a newer draft or emit stale UI effects",
  async (outcome) => {
    const gate = deferred<void>(),
      original = mockApi.createTask.bind(mockApi);
    const create = vi
      .spyOn(mockApi, "createTask")
      .mockImplementationOnce(async (input) => {
        await gate.promise;
        if (outcome === "failure") throw Error("Old failure");
        return original(input);
      });
    const old = await mount();
    await draft(old.user, "Old submitted task");
    await old.user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    old.unmount();
    const fresh = await mount(old.client);
    await draft(fresh.user, "Newer unsaved task");
    await act(async () => gate.resolve());
    await waitFor(() => expect(old.client.isMutating()).toBe(0));
    expect(screen.getByRole("textbox", { name: "New task title" })).toHaveValue(
      "Newer unsaved task",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(useUiStore.getState().highlights).toEqual({});
    expect(useUiStore.getState().toasts).toEqual([]);
  },
);
it.each([false, true])(
  "project A→B→A is remembered %s before dispatch; it never retargets or applies old completion UI",
  async (beforeDispatch) => {
    const gate = deferred<void>(),
      original = mockApi.createTask.bind(mockApi);
    const create = vi
      .spyOn(mockApi, "createTask")
      .mockImplementation(async (input) => {
        const task = await original(input);
        await gate.promise;
        return task;
      });
    const h = await mount(),
      a = await mockApi.appState();
    await draft(h.user);
    const changeProject = () => {
      h.client.setQueryData(["app"], {
        ...a,
        jam: { ...a.jam, id: "fictional-other-project" },
      });
      h.client.setQueryData(["app"], a);
    };
    if (beforeDispatch)
      act(() => {
        fireEvent.submit(screen.getByRole("form", { name: "New table task" }));
        changeProject();
      });
    else {
      await h.user.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      act(changeProject);
    }
    await act(async () => gate.resolve());
    await waitFor(() => expect(h.client.isMutating()).toBe(0));
    expect(create).toHaveBeenCalledTimes(beforeDispatch ? 0 : 1);
    expect(screen.getByRole("textbox", { name: "New task title" })).toHaveValue(
      "Captured table task",
    );
    expect(
      screen
        .getAllByRole("alert")
        .some((e) => e.textContent?.includes("The project changed")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(useUiStore.getState().highlights).toEqual({});
    expect(screen.queryByRole("status")).toBeNull();
    await h.user.click(screen.getByRole("button", { name: "Cancel new task" }));
    await draft(h.user, "Fresh deliberate draft");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  },
);
it("same-ID rename does not invalidate a captured project or duplicate creation", async () => {
  const gate = deferred<void>(),
    original = mockApi.createTask.bind(mockApi);
  const create = vi
    .spyOn(mockApi, "createTask")
    .mockImplementation(async (input) => {
      const task = await original(input);
      await gate.promise;
      return task;
    });
  const h = await mount();
  await draft(h.user);
  await h.user.click(screen.getByRole("button", { name: "Create" }));
  const a = await mockApi.appState();
  act(() =>
    h.client.setQueryData(["app"], {
      ...a,
      jam: { ...a.jam, name: "Renamed same identity" },
    }),
  );
  await act(async () => gate.resolve());
  expect(await screen.findByText(/Created JB-\d+ in Backlog/)).toHaveFocus();
  expect(create).toHaveBeenCalledTimes(1);
});

it.each(["project", "stories"] as const)(
  "failed %s read is explicit, retriable, and does not discard the inline draft",
  async (source) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    if (source !== "project")
      client.setQueryData(["app"], await mockApi.appState());
    if (source !== "stories")
      client.setQueryData(["stories"], await mockApi.listStories());
    const read =
      source === "project"
        ? vi
            .spyOn(mockApi, "appState")
            .mockRejectedValue(Error("Source read failed"))
        : vi
            .spyOn(mockApi, "listStories")
            .mockRejectedValue(Error("Source read failed"));
    const create = vi.spyOn(mockApi, "createTask");
    render(
      <QueryClientProvider client={client}>
        <InlineTaskCreate busy={vi.fn()} close={vi.fn()} created={vi.fn()} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "New task title" }),
      "Keep while reading context",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Source read failed",
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    read.mockRestore();
    await user.click(
      screen.getByRole("button", {
        name: source === "project" ? "Retry project check" : "Retry stories",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled(),
    );
    expect(screen.getByRole("textbox", { name: "New task title" })).toHaveValue(
      "Keep while reading context",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  },
);
