import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import type { ActivityEvent } from "../../lib/types";
import { NotificationBell } from "./NotificationBell";
import { readBaseline } from "./read-state";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
let signal: (events: ActivityEvent[]) => void;
let projectId: string;
let rows: ActivityEvent[];
function event(seq: number): ActivityEvent {
  return {
    seq,
    action: "task.created",
    taskKey: "JB-1",
    payload: {},
    createdAt: "2026-10-22T08:00:00Z",
    actor: {
      id: "agent",
      kind: "agent",
      name: "Test agent",
      handle: "test",
      color: "blue",
    },
    sentence: `Update ${seq}`,
    epicId: null,
  };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate.mockReset();
  localStorage.clear();
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  projectId = (await mockApi.appState()).jam?.id ?? "missing";
  rows = [event(10)];
  vi.spyOn(mockApi, "listActivity").mockImplementation(async () => rows);
  vi.spyOn(mockApi, "onBoardChanged").mockImplementation((cb) => {
    signal = cb;
    return () => {};
  });
});
async function mount(firstText = "Update 10") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const result = render(
    <QueryClientProvider client={client}>
      <NotificationBell
        projectId={projectId}
        projectName="Test project"
        memberId="human"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Project notifications" }),
  );
  await screen.findByText(firstText);
  return { client, ...result };
}
it("NT01 opens keyboard dialog, reconstructs history, marks older updates too, leaves arrivals unread and reader stable", async () => {
  await mount();
  expect(readBaseline(projectId, "human")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(readBaseline(projectId, "human")).toBe(10);
  rows = [event(11), event(10)];
  act(() => signal([event(999)]));
  await screen.findByRole("button", { name: "Show 1 new notifications" });
  expect(screen.queryByText("Update 11")).toBeNull();
  expect(screen.queryByText("Update 999")).toBeNull();
  expect(readBaseline(projectId, "human")).toBe(10);
  fireEvent.click(
    screen.getByRole("button", { name: "Show 1 new notifications" }),
  );
  expect(screen.getByText("Update 11")).toBeInTheDocument();
  expect(screen.getByText("New", { selector: "span" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("NT01 local read metadata failures do not break history", async () => {
  await mount();
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: () => {
      throw new Error("blocked");
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(
    screen.getByText(/Read position could not be saved/),
  ).toBeInTheDocument();
  expect(screen.getByText("Update 10")).toBeInTheDocument();
});
it("NT01 missing task stays in history with explicit error and no navigation", async () => {
  await mount();
  vi.spyOn(mockApi, "getTask").mockRejectedValue({
    code: "not_found",
    message: "missing",
  });
  fireEvent.click(screen.getByRole("button", { name: "View: Update 10" }));
  await screen.findByText("This task is no longer available in this project.");
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("NT01 close while View resolves cancels late navigation", async () => {
  await mount();
  let resolve!: (value: Awaited<ReturnType<typeof mockApi.getTask>>) => void;
  const real = await mockApi.getTask("JB-1");
  vi.spyOn(mockApi, "getTask").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "View: Update 10" }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(
    screen.getByRole("button", { name: "Close Project notifications" }),
  );
  await act(async () => resolve(real));
  expect(navigate).not.toHaveBeenCalled();
});
it("NT01 actual cache selection A→B→A suppresses a late page even when ID matches again", async () => {
  const { client } = await mount();
  let resolve!: (value: ActivityEvent[]) => void;
  vi.spyOn(mockApi, "listActivity")
    .mockResolvedValue(rows)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(resolve).toBeDefined());
  const state = await mockApi.appState();
  act(() => {
    client.setQueryData(["app"], {
      ...state,
      jam: { ...state.jam, id: "other" },
    });
    client.setQueryData(["app"], state);
  });
  await act(async () => resolve([event(999)]));
  fireEvent.click(
    screen.getByRole("button", { name: "Project notifications" }),
  );
  await screen.findByText("Update 10");
  expect(screen.queryByText("Update 999")).toBeNull();
});
it("NT01 bulk read watermark covers older pages but not new arrivals withheld from the reader", async () => {
  rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
  const client = new QueryClient();
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <NotificationBell
        projectId={projectId}
        projectName="Test"
        memberId="human"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Project notifications" }),
  );
  await screen.findByText("Update 200");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Mark current updates as read" }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(readBaseline(projectId, "human")).toBe(200);
  rows = [event(100)];
  fireEvent.click(screen.getByRole("button", { name: "Load older updates" }));
  await screen.findByText("Update 100");
  expect(screen.queryByText("New", { selector: "span" })).toBeNull();
  rows = [event(201), event(200)];
  act(() => signal([]));
  await screen.findByRole("button", { name: "Show 1 new notifications" });
  fireEvent.click(
    screen.getByRole("button", { name: "Mark current updates as read" }),
  );
  expect(readBaseline(projectId, "human")).toBe(200);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
for (const first of ["latest", "older"]) {
  it(`NT01 N1 older paging survives coalesced event storm (${first} finishes first)`, async () => {
    rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
    await mount("Update 200");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    const older = deferred<ActivityEvent[]>(),
      latest = deferred<ActivityEvent[]>();
    let latestCalls = 0;
    const read = vi
      .spyOn(mockApi, "listActivity")
      .mockImplementation(async (input) => {
        if (input?.beforeSeq !== undefined) return older.promise;
        latestCalls++;
        return latestCalls === 1 ? latest.promise : rows;
      });
    const load = screen.getByRole("button", { name: "Load older updates" });
    await userEvent.click(load);
    fireEvent.click(load);
    await waitFor(() =>
      expect(
        read.mock.calls.filter(([q]) => q?.beforeSeq === 101),
      ).toHaveLength(1),
    );
    act(() => {
      signal([]);
      signal([]);
      signal([]);
    });
    await waitFor(() => expect(latestCalls).toBe(1));
    expect(screen.getByText("Loading older updates…")).toBeInTheDocument();
    if (first === "latest") {
      await act(async () => latest.resolve(rows));
      await waitFor(() => expect(latestCalls).toBe(2));
      expect(load).toBeDisabled();
      expect(screen.getByText("Loading older updates…")).toBeInTheDocument();
      await act(async () => older.resolve([event(100)]));
    } else {
      await act(async () => older.resolve([event(100)]));
      await screen.findByText("Update 100");
      expect(screen.getByText("Loading notifications…")).toBeInTheDocument();
      await act(async () => latest.resolve(rows));
    }
    await screen.findByText("Update 100");
    await waitFor(() =>
      expect(screen.queryByText("Loading notifications…")).toBeNull(),
    );
    expect(latestCalls).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
}
it("NT01 N1 reveal during older read preserves reachable arrival gap and deduplicates overlaps", async () => {
  rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
  await mount("Update 200");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  const older = deferred<ActivityEvent[]>();
  const read = vi
    .spyOn(mockApi, "listActivity")
    .mockImplementation(async (input) =>
      input?.beforeSeq === 101
        ? older.promise
        : input?.beforeSeq === 301
          ? [event(300), event(200)]
          : Array.from({ length: 100 }, (_, i) => event(400 - i)),
    );
  fireEvent.click(screen.getByRole("button", { name: "Load older updates" }));
  await waitFor(() =>
    expect(read.mock.calls.some(([q]) => q?.beforeSeq === 101)).toBe(true),
  );
  act(() => signal([]));
  fireEvent.click(
    await screen.findByRole("button", { name: "Show 100 new notifications" }),
  );
  await act(async () => older.resolve([event(100)]));
  await screen.findByText("Update 100");
  fireEvent.click(screen.getByRole("button", { name: "Load older updates" }));
  await screen.findByText("Update 300");
  expect(read.mock.calls.some(([q]) => q?.beforeSeq === 301)).toBe(true);
  expect(screen.getAllByText("Update 200")).toHaveLength(1);
});
it("NT01 N1 older failure remains visible across successful latest refresh and can retry", async () => {
  rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
  await mount("Update 200");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  let fail = true;
  vi.spyOn(mockApi, "listActivity").mockImplementation(async (input) => {
    if (input?.beforeSeq !== undefined) {
      if (fail) throw new Error("read failure");
      return [event(100)];
    }
    return rows;
  });
  fireEvent.click(screen.getByRole("button", { name: "Load older updates" }));
  await screen.findByText(/Could not load older updates/);
  act(() => signal([]));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  expect(screen.getByText(/Could not load older updates/)).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Load older updates" }));
  await screen.findByText("Update 100");
  expect(screen.queryByText(/Could not load older updates/)).toBeNull();
});
it("NT01 N2 navigation rejection stays scoped and visible, reopening permits an explicit retry", async () => {
  await mount();
  navigate.mockRejectedValueOnce(new Error("Synthetic router failure"));
  await userEvent.click(
    screen.getByRole("button", { name: "View: Update 10" }),
  );
  await screen.findByText("Synthetic router failure");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reopen notifications" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  navigate.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "View: Update 10" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  expect(navigate).toHaveBeenLastCalledWith({
    to: "/board",
    search: { task: "JB-1" },
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
});
it("NT01 N2 navigation rejection after project ABA never reopens old history or leaks its error", async () => {
  const { client } = await mount();
  const route = deferred<void>();
  navigate.mockReturnValueOnce(route.promise);
  fireEvent.click(screen.getByRole("button", { name: "View: Update 10" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  const state = await mockApi.appState();
  act(() => {
    client.setQueryData(["app"], {
      ...state,
      jam: { ...state.jam, id: "other" },
    });
    client.setQueryData(["app"], state);
  });
  await act(async () =>
    route.reject(new Error("Old project navigation failure")),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
for (const interruption of ["ABA", "unmount"]) {
  it(`NT01 N1 pending older page is discarded after ${interruption}`, async () => {
    rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
    const mounted = await mount("Update 200");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    const older = deferred<ActivityEvent[]>();
    const read = vi
      .spyOn(mockApi, "listActivity")
      .mockImplementation(async (input) =>
        input?.beforeSeq !== undefined ? older.promise : rows,
      );
    await userEvent.click(
      screen.getByRole("button", { name: "Load older updates" }),
    );
    await waitFor(() =>
      expect(read.mock.calls.some(([q]) => q?.beforeSeq === 101)).toBe(true),
    );
    if (interruption === "ABA") {
      const state = await mockApi.appState();
      act(() => {
        mounted.client.setQueryData(["app"], {
          ...state,
          jam: { ...state.jam, id: "other" },
        });
        mounted.client.setQueryData(["app"], state);
      });
      await userEvent.click(
        screen.getByRole("button", { name: "Project notifications" }),
      );
    } else {
      mounted.unmount();
      await mount("Update 200");
    }
    await act(async () => older.resolve([event(100)]));
    await screen.findByText("Update 200");
    expect(screen.queryByText("Update 100")).toBeNull();
    expect(screen.queryByText("Loading older updates…")).toBeNull();
  });
}
it("NT01 raw latest page of excluded events offers one bounded check of newer unscanned history", async () => {
  rows = Array.from({ length: 100 }, (_, i) => event(200 - i));
  await mount("Update 200");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  const excluded = Array.from({ length: 100 }, (_, i) => ({
    ...event(400 - i),
    action: "agent.status",
  }));
  const read = vi
    .spyOn(mockApi, "listActivity")
    .mockImplementation(async (input) =>
      input?.beforeSeq === 301 ? [event(300), event(200)] : excluded,
    );
  read.mockClear();
  act(() => signal([]));
  const check = await screen.findByRole("button", {
    name: "Check newer updates",
  });
  expect(screen.queryByText("Update 300")).toBeNull();
  expect(read.mock.calls).toHaveLength(1);
  await userEvent.click(check);
  await screen.findByText("Update 300");
  expect(read.mock.calls).toHaveLength(2);
  expect(read.mock.calls[1]?.[0]?.beforeSeq).toBe(301);
  expect(screen.queryByText("Update 400")).toBeNull();
  expect(screen.getAllByText("Update 200")).toHaveLength(1);
});

it("NT01 explicit Refresh has pending, unchanged timestamped completion and failure without persisted history changes", async () => {
  const mounted = await mount();
  const button = screen.getByRole("button", { name: "Refresh" });
  await waitFor(() => expect(button).toBeEnabled());
  const d = deferred<ActivityEvent[]>();
  const read = vi.spyOn(mockApi, "listActivity").mockReturnValueOnce(d.promise);
  read.mockClear();
  const user = userEvent.setup();
  await user.dblClick(button);
  expect(read).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(
    screen.getByText("Checking notifications…", { selector: "p" }),
  ).toBeInTheDocument();
  await act(async () => d.resolve(rows));
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getByText(/Checked notifications\./)).toHaveTextContent(
    "Last checked:",
  );
  expect(screen.getAllByText("Update 10")).toHaveLength(1);
  expect(readBaseline(projectId, "human")).toBeNull();
  read.mockRejectedValueOnce(new Error("Fictional read failure"));
  await user.click(button);
  await screen.findByText(
    "Could not check notifications. Try again when ready.",
  );
  expect(screen.queryByText(/Checked notifications\./)).toBeNull();
  expect(screen.getByText("Update 10")).toBeInTheDocument();
  expect(readBaseline(projectId, "human")).toBeNull();
  mounted.unmount();
});
it("NT01 background arrivals never announce explicit success; close/reopen suppresses an old receipt", async () => {
  await mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  act(() => signal([]));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  expect(screen.queryByText(/Checked notifications\./)).toBeNull();
  const d = deferred<ActivityEvent[]>();
  vi.spyOn(mockApi, "listActivity").mockReturnValueOnce(d.promise);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: /Project notifications/ }),
  );
  await act(async () => d.resolve(rows));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  expect(screen.queryByText(/Checked notifications\./)).toBeNull();
  expect(screen.getByText("Update 10")).toBeInTheDocument();
});
