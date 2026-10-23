import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { MemberDialog } from "../team/TeamPage";
import { TaskDrawer } from "./TaskDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ readyRequest: null, toasts: [], taskChanges: {} });
});
function mount(node: React.ReactNode) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
function deferred() {
  let reject!: (e: Error) => void;
  const promise = new Promise<never>((_, r) => {
    reject = r;
  });
  return { promise, reject };
}
async function task() {
  const t = await mockApi.createTask({ title: "Probe", status: "backlog" });
  const close = vi.fn();
  mount(<TaskDrawer taskKey={t.key} close={close} />);
  await screen.findByRole("textbox", { name: "Task title" });
  return { close, user: userEvent.setup() };
}
it("F07: Escape closes actions first and returns focus; second Escape closes drawer", async () => {
  const { close, user } = await task();
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(screen.getByRole("button", { name: "Task actions" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
});
it("F08 archive: double click sends one pending write; Escape retains reason and unconfirmed failure", async () => {
  const { user } = await task();
  const gate = deferred();
  const call = vi
    .spyOn(mockApi, "archiveTask")
    .mockImplementation(() => gate.promise);
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  const dialog = screen.getByRole("dialog", { name: "Archive task" });
  await user.type(within(dialog).getByRole("textbox"), "Retain reason");
  await user.dblClick(within(dialog).getByRole("button", { name: "Archive" }));
  expect(call).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Archive task" })).toBeVisible();
  await act(async () =>
    gate.reject(new Error("Synthetic unresolved archive outcome")),
  );
  await screen.findByText(
    /Could not confirm whether the archive change was saved/,
  );
  expect(screen.getByRole("textbox", { name: "Archive reason" })).toHaveValue(
    "Retain reason",
  );
  expect(
    within(dialog).getByRole("button", { name: "Archive" }),
  ).toBeDisabled();
  expect(call).toHaveBeenCalledTimes(1);
});
it("F08 member: repeated Enter and pending Escape retain one request, draft and late error", async () => {
  const gate = deferred();
  const call = vi
    .spyOn(mockApi, "createMember")
    .mockImplementation(() => gate.promise);
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? <MemberDialog close={() => setOpen(false)} /> : <p>Closed</p>;
  }
  mount(<Host />);
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled(),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Test human{Enter}{Enter}",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Save teammate" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () =>
    gate.reject(new Error("Synthetic unresolved member outcome")),
  );
  await screen.findByText(/Could not confirm whether the teammate was saved/);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Test human",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute(
    "readonly",
  );
});
it("F08 member project ABA invalidates old completion without closing retained editor", async () => {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const original = mockApi.createMember.bind(mockApi);
  const call = vi
    .spyOn(mockApi, "createMember")
    .mockImplementationOnce(async (input) => {
      await gate;
      return original(input);
    });
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemberDialog close={close} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Retained member{Enter}",
  );
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => {
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "other-project" },
    });
    client.setQueryData(["app"], app);
  });
  await act(async () => release());
  await screen.findByText(/project or form target changed/);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Retained member",
  );
  expect(screen.getByRole("button", { name: "Save teammate" })).toBeDisabled();
});
it("F08 archive confirmed write plus failed read is not offered as an unconfirmed repeat", async () => {
  const { user } = await task();
  const original = mockApi.getTask.bind(mockApi);
  const archive = vi.spyOn(mockApi, "archiveTask");
  vi.spyOn(mockApi, "getTask").mockRejectedValueOnce(
    new Error("Synthetic refresh unavailable"),
  );
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await screen.findByText(/Saved, but could not refresh/);
  expect(
    screen.queryByText(
      /Could not confirm whether the archive change was saved/,
    ),
  ).toBeNull();
  expect(
    within(screen.getByRole("dialog", { name: "Archive task" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  ).toHaveFocus();
  expect(archive).toHaveBeenCalledTimes(1);
  const key = archive.mock.calls[0]?.[0];
  if (!key) throw new Error("Missing archive request");
  expect((await original(key)).archivedAt).toBeTruthy();
  expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
});
it("F08 pending archive blocks parent Ctrl S without saving underlying dirty title", async () => {
  const { user } = await task();
  await user.clear(screen.getByRole("textbox", { name: "Task title" }));
  await user.type(
    screen.getByRole("textbox", { name: "Task title" }),
    "Dirty underlying title",
  );
  const gate = deferred();
  vi.spyOn(mockApi, "archiveTask").mockImplementation(() => gate.promise);
  const update = vi.spyOn(mockApi, "updateTask");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.keyboard("{Control>}s{/Control}");
  expect(update).not.toHaveBeenCalled();
  await act(async () => gate.reject(new Error("Synthetic unresolved archive")));
  await screen.findByText(
    /Could not confirm whether the archive change was saved/,
  );
  expect(update).not.toHaveBeenCalled();
});
it("F08 archive project ABA prevents late follow-up read and cache writes", async () => {
  const app = await mockApi.appState();
  const task = await mockApi.createTask({
    title: "Origin task",
    status: "backlog",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TaskDrawer taskKey={task.key} close={close} />
    </QueryClientProvider>,
  );
  await screen.findByRole("textbox", { name: "Task title" });
  const cached = client.getQueryData(["task", task.key]);
  const read = vi.spyOn(mockApi, "getTask");
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => (release = resolve));
  vi.spyOn(mockApi, "archiveTask").mockImplementation(
    () => pending as ReturnType<typeof mockApi.archiveTask>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await act(async () => {
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "other-project" },
    });
    client.setQueryData(["app"], app);
  });
  await act(async () => release(task));
  await screen.findByText(/project or form target changed/);
  expect(read).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(client.getQueryData(["task", task.key])).toEqual(cached);
});
it("F08 member lost response after persistence retains copyable draft without duplicate replay", async () => {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const original = mockApi.createMember.bind(mockApi);
  const call = vi
    .spyOn(mockApi, "createMember")
    .mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error("Synthetic response lost after persistence");
    });
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemberDialog close={close} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Already persisted{Enter}",
  );
  await screen.findByText(/Could not confirm whether the teammate was saved/);
  expect(
    (await mockApi.listMembers()).filter((m) => m.name === "Already persisted"),
  ).toHaveLength(1);
  await user.keyboard("{Enter}");
  expect(call).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute(
    "readonly",
  );
});
it("F08 archive and explicit unarchive complete once and refresh the same task", async () => {
  const { user } = await task();
  const archive = vi.spyOn(mockApi, "archiveTask"),
    unarchive = vi.spyOn(mockApi, "unarchiveTask"),
    execution = vi.spyOn(mockApi, "setExecution");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Archive task" })).toBeNull(),
  );
  expect(archive).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Unarchive" }));
  const dialog = screen.getByRole("dialog", { name: "Unarchive task" });
  await user.click(within(dialog).getByRole("button", { name: "Unarchive" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Unarchive task" })).toBeNull(),
  );
  expect(unarchive).toHaveBeenCalledTimes(1);
  const key = archive.mock.calls[0]?.[0];
  if (!key) throw Error("Missing archived key");
  expect((await mockApi.getTask(key)).archivedAt).toBeNull();
  expect(execution).not.toHaveBeenCalled();
});
