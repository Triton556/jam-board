import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { mockApi } from "./mock-bridge";
import { acceptProjectSelection } from "./project-selection";
import { relocate, tasksQuery, useMoveTask } from "./queries";
import type { BoardTasks } from "./types";
import { useUiStore } from "./ui-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
let a: BoardTasks, b: BoardTasks;
let state: Awaited<ReturnType<typeof api.appState>>;
let secondState: Awaited<ReturnType<typeof api.appState>>;
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  state = await api.appState();
  a = await mockApi.listBoardTasks();
  b = structuredClone(a);
  for (const tasks of Object.values(b))
    for (const task of tasks) {
      task.key = `B-${task.key}`;
      task.title = `B ${task.title}`;
    }
  secondState = await mockApi.createJam({
    name: "Move fixture B",
    yourName: "Human",
    theme: null,
    startsAt: "",
    endsAt: "",
    timezone: "UTC",
    template: "custom",
  });
  if (!state.jam) throw new Error("Missing A fixture");
  await mockApi.selectProject(state.jam.id);
  useUiStore.setState({ toasts: [], readyRequest: null });
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], state);
  client.setQueryData(["boardTasks"], a);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => ({ move: useMoveTask(), query: useQuery(tasksQuery) }),
    { wrapper },
  );
  const source = a.ready[0];
  if (!source) throw new Error("Missing Ready fixture task");
  const input = {
    key: source.key,
    expectedUpdatedAt: source.updatedAt,
    status: "review" as const,
  };
  const select = async (project: "A" | "B") =>
    act(async () => {
      const target = project === "A" ? state : secondState;
      if (!target.jam) throw new Error("Missing selected fixture");
      const selected = await mockApi.selectProject(target.jam.id);
      await acceptProjectSelection(client, selected);
    });
  return { client, hook, source, input, select };
}
it("keeps last-read positions while pending; success reconciles without speculative movement", async () => {
  let server = a;
  const pending = deferred<never>();
  vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
  const read = vi
    .spyOn(api, "listBoardTasks")
    .mockImplementation(async () => server);
  const s = setup();
  act(() => s.hook.result.current.move.mutate(s.input));
  await waitFor(() => expect(api.moveTask).toHaveBeenCalledTimes(1));
  expect(s.client.getQueryData(["boardTasks"])).toEqual(a);
  expect(s.hook.result.current.move.isPending).toBe(true);
  server = relocate(a, s.source.key, "review", 0);
  await act(async () => pending.resolve(undefined as never));
  await waitFor(() => expect(s.hook.result.current.query.data).toEqual(server));
  expect(read).toHaveBeenCalledTimes(1);
  expect(useUiStore.getState().toasts).toHaveLength(0);
});
it.each(["conflict", "not_ready", "execution_required"])(
  "known %s refusal preserves newer events and readiness policy",
  async (code) => {
    const read = deferred<BoardTasks>();
    vi.spyOn(api, "listBoardTasks").mockReturnValue(read.promise);
    const pending = deferred<never>();
    vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
    const s = setup();
    act(() => s.hook.result.current.move.mutate(s.input));
    await waitFor(() => expect(api.moveTask).toHaveBeenCalled());
    const newer = relocate(a, s.source.key, "done", 0);
    act(() => s.client.setQueryData(["boardTasks"], newer));
    await act(async () =>
      pending.reject(Object.assign(new Error("refused"), { code })),
    );
    expect(s.client.getQueryData(["boardTasks"])).toEqual(newer);
    expect(useUiStore.getState().toasts[0]?.text).toContain("Couldn't move");
    expect(useUiStore.getState().readyRequest).toEqual(
      code === "not_ready" ? s.input : null,
    );
    await act(async () => read.resolve(newer));
  },
);
it.each([false, true])(
  "generic rejection after modeled persistence never rolls back; failed read=%s",
  async (fails) => {
    const pending = deferred<never>(),
      read = deferred<BoardTasks>();
    vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
    vi.spyOn(api, "listBoardTasks").mockReturnValue(read.promise);
    const s = setup();
    act(() => s.hook.result.current.move.mutate(s.input));
    await waitFor(() => expect(api.moveTask).toHaveBeenCalled());
    const committed = relocate(a, s.source.key, "review", 0);
    act(() => s.client.setQueryData(["boardTasks"], committed));
    await act(async () =>
      pending.reject(new Error("notification failed after modeled commit")),
    );
    expect(s.client.getQueryData(["boardTasks"])).toEqual(committed);
    expect(useUiStore.getState().toasts[0]?.text).toContain(
      "Move result unconfirmed",
    );
    expect(useUiStore.getState().toasts[0]?.hint).toContain(
      "Nothing was automatically retried or rolled back",
    );
    await act(async () => {
      if (fails) read.reject(new Error("read unavailable"));
      else read.resolve(committed);
    });
    await waitFor(() =>
      expect(s.hook.result.current.move.isPending).toBe(false),
    );
    expect(s.client.getQueryData(["boardTasks"])).toEqual(committed);
    expect(api.moveTask).toHaveBeenCalledTimes(1);
  },
);
it("unknown rejection without an event and failed read keeps last-read positions, not a speculative destination", async () => {
  const pending = deferred<never>();
  vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
  vi.spyOn(api, "listBoardTasks").mockRejectedValue(
    new Error("read unavailable"),
  );
  const s = setup();
  act(() => s.hook.result.current.move.mutate(s.input));
  await waitFor(() => expect(api.moveTask).toHaveBeenCalled());
  await act(async () => pending.reject(new Error("unknown outcome")));
  await waitFor(() => expect(s.hook.result.current.query.isError).toBe(true));
  expect(s.client.getQueryData(["boardTasks"])).toEqual(a);
  expect(api.moveTask).toHaveBeenCalledTimes(1);
});
it.each(["reject", "success", "not_ready"] as const)(
  "late A %s after A→B neither refills, announces nor refetches B",
  async (outcome) => {
    let server = a;
    const read = vi
      .spyOn(api, "listBoardTasks")
      .mockImplementation(async () => server);
    const pending = deferred<never>();
    vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
    const s = setup();
    act(() => s.hook.result.current.move.mutate(s.input));
    await waitFor(() => expect(api.moveTask).toHaveBeenCalled());
    server = b;
    await s.select("B");
    await waitFor(() => expect(s.hook.result.current.query.data).toEqual(b));
    const reads = read.mock.calls.length;
    expect(s.hook.result.current.move.isPending).toBe(false);
    await act(async () => {
      if (outcome === "success") pending.resolve(undefined as never);
      else
        pending.reject(
          Object.assign(new Error("late A error"), { code: outcome }),
        );
    });
    expect(s.client.getQueryData(["boardTasks"])).toEqual(b);
    expect(read).toHaveBeenCalledTimes(reads);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(useUiStore.getState().readyRequest).toBeNull();
  },
);
it("ABA cannot revive a prior generation or erase newer A data", async () => {
  let server = a;
  const read = vi
    .spyOn(api, "listBoardTasks")
    .mockImplementation(async () => server);
  const pending = deferred<never>();
  vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
  const s = setup();
  act(() => s.hook.result.current.move.mutate(s.input));
  await waitFor(() => expect(api.moveTask).toHaveBeenCalled());
  server = b;
  await s.select("B");
  server = relocate(a, s.source.key, "done", 0);
  await s.select("A");
  const reads = read.mock.calls.length;
  await act(async () => pending.reject(new Error("late failure")));
  expect(s.client.getQueryData(["boardTasks"])).toEqual(server);
  expect(read).toHaveBeenCalledTimes(reads);
  expect(useUiStore.getState().toasts).toHaveLength(0);
});
it("unmounted completion cannot refill a removed cache or announce", async () => {
  const pending = deferred<never>();
  vi.spyOn(api, "moveTask").mockReturnValue(pending.promise);
  const read = vi.spyOn(api, "listBoardTasks").mockResolvedValue(a);
  const s = setup();
  act(() => s.hook.result.current.move.mutate(s.input));
  await waitFor(() => expect(api.moveTask).toHaveBeenCalled());
  s.hook.unmount();
  await acceptProjectSelection(s.client, state);
  expect(s.client.getQueryData(["boardTasks"])).toBeUndefined();
  const reads = read.mock.calls.length;
  await act(async () => pending.reject(new Error("late failure")));
  expect(s.client.getQueryData(["boardTasks"])).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(reads);
  expect(useUiStore.getState().toasts).toHaveLength(0);
});
it.each(["switch", "aba", "unmount"] as const)(
  "selection/lifetime changes before deferred dispatch: %s",
  async (change) => {
    vi.spyOn(api, "moveTask");
    const s = setup();
    act(() => {
      s.hook.result.current.move.mutate(s.input);
      if (change === "unmount") s.hook.unmount();
      else {
        s.client.setQueryData(["app"], {
          ...state,
          jam: state.jam ? { ...state.jam, id: "B" } : null,
        });
        if (change === "aba") s.client.setQueryData(["app"], state);
      }
    });
    await act(async () => {});
    expect(api.moveTask).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  },
);
it("different-task moves settling out of order cannot erase another result", async () => {
  const first = deferred<never>(),
    second = deferred<never>();
  const s = setup();
  const other = a.ready[1];
  if (!other) throw new Error("Missing second Ready fixture task");
  let server = a;
  vi.spyOn(api, "listBoardTasks").mockImplementation(async () => server);
  vi.spyOn(api, "moveTask").mockImplementation((input) =>
    input.key === s.source.key ? first.promise : second.promise,
  );
  act(() => {
    s.hook.result.current.move.mutate(s.input);
    s.hook.result.current.move.mutate({
      key: other.key,
      expectedUpdatedAt: other.updatedAt,
      status: "review",
    });
  });
  await waitFor(() => expect(api.moveTask).toHaveBeenCalledTimes(2));
  server = relocate(a, other.key, "review", 0);
  await act(async () => second.resolve(undefined as never));
  await waitFor(() =>
    expect(s.client.getQueryData(["boardTasks"])).toEqual(server),
  );
  expect(s.hook.result.current.move.isPending).toBe(true);
  await act(async () => first.reject(new Error("first result uncertain")));
  expect(s.client.getQueryData(["boardTasks"])).toEqual(server);
  expect(api.moveTask).toHaveBeenCalledTimes(2);
});
it("captures request values synchronously and fails closed without project identity", async () => {
  const s = setup();
  const move = vi
    .spyOn(api, "moveTask")
    .mockRejectedValue(new Error("modeled rejection"));
  vi.spyOn(api, "listBoardTasks").mockResolvedValue(a);
  const input = { ...s.input };
  act(() => {
    s.hook.result.current.move.mutate(input);
    input.key = "changed later";
  });
  await waitFor(() => expect(move).toHaveBeenCalledWith(s.input));
  await waitFor(() => expect(s.hook.result.current.move.isPending).toBe(false));
  act(() => {
    s.client.removeQueries({ queryKey: ["app"] });
    s.hook.result.current.move.mutate(s.input);
  });
  await act(async () => {});
  expect(move).toHaveBeenCalledTimes(1);
});
