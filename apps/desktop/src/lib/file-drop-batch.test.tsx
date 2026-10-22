import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  FileDropProgress,
  FileDropSessionProvider,
  useFileDropBatch,
} from "./file-drop-batch";
import { MockBridge } from "./mock-bridge";
import { useUiStore } from "./ui-store";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ toasts: [] });
});
async function setup() {
  const bridge = new MockBridge();
  await bridge.createJam({
    name: "Captured project",
    yourName: "Human",
    theme: null,
    startsAt: "",
    endsAt: "",
    timezone: "UTC",
    template: "custom",
    milestoneAt: null,
  });
  const state = await bridge.appState();
  const project = state.jam;
  if (!project) throw new Error("Missing test project");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["app"], state);
  client.setQueryData(["assets"], []);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let batch!: ReturnType<typeof useFileDropBatch>;
  function Page() {
    batch = useFileDropBatch("assets");
    return <FileDropProgress progress={batch.progress} />;
  }
  function Shell({ show = true }: { show?: boolean }) {
    return (
      <QueryClientProvider client={client}>
        <FileDropSessionProvider>
          <input aria-label="Unrelated draft" />
          {show && <Page />}
        </FileDropSessionProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<Shell />);
  return {
    state,
    project,
    client,
    invalidate,
    get batch() {
      return batch;
    },
    view,
    hide() {
      view.rerender(<Shell show={false} />);
    },
  };
}
const notices = () => useUiStore.getState().toasts;
function firstNotice() {
  const notice = notices()[0];
  if (!notice) throw new Error("Missing receipt");
  return notice;
}

it("captures the selection and project label; fully confirmed success stays transient", async () => {
  const s = await setup(),
    gate = deferred();
  const perform = vi
    .fn()
    .mockImplementationOnce(() => gate.promise)
    .mockResolvedValue(undefined);
  const paths = ["first.txt", "second.txt"];
  let pending!: Promise<void>;
  act(() => {
    pending = s.batch.run(paths, perform, [["assets"]]);
  });
  paths[1] = "not-the-captured-selection.txt";
  act(() =>
    s.client.setQueryData(["app"], {
      ...s.state,
      jam: { ...s.project, name: "Renamed while pending" },
    }),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Sending file 1 of 2 to Captured project",
  );
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(perform.mock.calls.map(([path]) => path)).toEqual([
    "first.txt",
    "second.txt",
  ]);
  expect(firstNotice().text).toContain("Captured project");
  expect(firstNotice().text).toContain("2 confirmed");
  expect(firstNotice().persistent).toBe(false);
  expect(firstNotice().until).toBeLessThan(Infinity);
  expect(s.invalidate).toHaveBeenCalledWith(
    { queryKey: ["assets"], refetchType: "active" },
    { throwOnError: true },
  );
});

it("does not queue or dispatch an overlapping drop and keeps the active progress", async () => {
  const s = await setup(),
    gate = deferred(),
    first = vi.fn(() => gate.promise),
    overlap = vi.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = s.batch.run(["active.txt"], first, [["assets"]]);
  });
  await act(() => s.batch.run(["not-queued.txt"], overlap, [["assets"]]));
  expect(overlap).not.toHaveBeenCalled();
  expect(firstNotice().text).toContain("1 not attempted");
  expect(firstNotice().persistent).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "Sending file 1 of 1",
  );
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(overlap).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("stops on page exit, retains a scoped receipt, marks origin stale without refetching, and does not steal focus", async () => {
  const s = await setup(),
    gate = deferred(),
    perform = vi.fn(() => gate.promise);
  let pending!: Promise<void>;
  act(() => {
    pending = s.batch.run(["sent.txt", "unsent.txt"], perform, [["assets"]]);
  });
  s.hide();
  const draft = screen.getByRole("textbox");
  draft.focus();
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(perform).toHaveBeenCalledTimes(1);
  expect(firstNotice().text).toContain(
    "1 confirmed; 0 unconfirmed requests; 1 not attempted",
  );
  expect(firstNotice().hint).toContain(s.project.id);
  expect(s.invalidate).toHaveBeenCalledWith(
    { queryKey: ["assets"], refetchType: "none" },
    { throwOnError: true },
  );
  expect(document.activeElement).toBe(draft);
});

it.each([false, true])(
  "latches project changes, including ABA=%s, without dispatching remaining files",
  async (aba) => {
    const s = await setup(),
      gate = deferred(),
      perform = vi.fn(() => gate.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = s.batch.run(["sent.txt", "unsent.txt"], perform, [["assets"]]);
    });
    act(() => {
      s.client.setQueryData(["app"], {
        ...s.state,
        jam: { ...s.project, id: "other-project" },
      });
      if (aba) s.client.setQueryData(["app"], s.state);
    });
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(firstNotice().text).toContain("1 not attempted");
    if (!aba) expect(s.invalidate).not.toHaveBeenCalled();
    const later = vi.fn();
    await act(() =>
      s.batch.run(["late-picker-result.txt"], later, [["assets"]]),
    );
    expect(later).not.toHaveBeenCalled();
  },
);

it("does not continue or promise delivery after the whole app session ends", async () => {
  const s = await setup(),
    gate = deferred(),
    perform = vi.fn(() => gate.promise);
  let pending!: Promise<void>;
  act(() => {
    pending = s.batch.run(["sent.txt", "unsent.txt"], perform, [["assets"]]);
  });
  s.view.unmount();
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(perform).toHaveBeenCalledTimes(1);
  expect(notices()).toHaveLength(0);
  expect(s.invalidate).not.toHaveBeenCalled();
});

it("treats rejection after persistence as unconfirmed, refreshes, and never retries", async () => {
  const s = await setup(),
    saved: string[] = [];
  const perform = vi.fn(async (path: string) => {
    saved.push(path);
    if (saved.length === 2)
      throw new Error("Synthetic post-write receipt failure");
  });
  await act(() =>
    s.batch.run(
      ["confirmed.txt", "possibly-saved.txt", "unsent.txt"],
      perform,
      [["assets"]],
    ),
  );
  expect(saved).toEqual(["confirmed.txt", "possibly-saved.txt"]);
  expect(firstNotice().text).toContain(
    "1 confirmed; 1 unconfirmed request; 1 not attempted",
  );
  expect(firstNotice().text).toContain("may already have been saved");
  expect(firstNotice().details?.map((detail) => detail.label)).toEqual([
    "Confirmed",
    "Unconfirmed request",
    "Not attempted",
  ]);
  expect(s.invalidate).toHaveBeenCalledTimes(1);
  expect(perform).toHaveBeenCalledTimes(2);
});

it("does not turn a refresh failure into a failed write or replay", async () => {
  const s = await setup(),
    perform = vi.fn().mockResolvedValue(undefined);
  s.invalidate.mockRejectedValueOnce(new Error("Synthetic read failure"));
  await act(() => s.batch.run(["saved.txt"], perform, [["assets"]]));
  expect(firstNotice().text).toContain(
    "1 confirmed; 0 unconfirmed requests; 0 not attempted",
  );
  expect(firstNotice().details?.at(-1)?.label).toBe("Refresh not confirmed");
  expect(perform).toHaveBeenCalledTimes(1);
});

it("keeps problematic receipts within the existing three-notice memory bound and supports explicit dismissal", () => {
  const ui = useUiStore.getState();
  for (let i = 0; i < 4; i++)
    ui.notify(`Persistent ${i}`, {
      persistent: true,
      details: [{ label: "Not attempted", text: `file-${i}.txt` }],
    });
  expect(notices().map((notice) => notice.text)).toEqual([
    "Persistent 1",
    "Persistent 2",
    "Persistent 3",
  ]);
  const stable = notices()[1];
  if (!stable) throw new Error("Missing retained receipt");
  ui.tick(Date.now() + 60_000);
  expect(notices()[1]).toBe(stable);
  ui.dismissToast(stable.id);
  expect(notices().map((notice) => notice.text)).toEqual([
    "Persistent 1",
    "Persistent 3",
  ]);
  ui.notify("Ordinary success");
  ui.tick(Date.now() + 60_000);
  expect(notices()).toHaveLength(2);
});
