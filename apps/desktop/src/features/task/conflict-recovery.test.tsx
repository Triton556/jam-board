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
import { useEffect } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { TaskConflictDialog } from "./TaskConflictDialog";
import { TaskDrawer } from "./TaskDrawer";
import { taskPatch, taskValues } from "./task-form";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
  useUiStore.setState({
    taskChanges: {},
    highlights: {},
    toasts: [],
    readyRequest: null,
  });
});
async function fixture() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  function View() {
    useEffect(
      () =>
        mockApi.onBoardChanged((events) => {
          useUiStore.getState().receive(events);
          void client.invalidateQueries();
        }),
      [],
    );
    return <TaskDrawer taskKey="JB-7" close={() => {}} />;
  }
  render(
    <QueryClientProvider client={client}>
      <View />
    </QueryClientProvider>,
  );
  const input = await screen.findByRole("textbox", { name: "Task title" });
  fireEvent.change(input, { target: { value: "My retained title" } });
  await act(async () => {
    await mockApi.simulateAgent({
      action: "task.updated",
      key: "JB-7",
      patch: { title: "First remote title", priority: "critical" },
    });
  });
  await screen.findByText(/updated this task while you were editing/);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  const dialog = await screen.findByRole("dialog", { name: "Review changes" });
  return { dialog, user, input, client };
}
it("an open conflict comparison freezes the inspected remote version until deliberate rereading", async () => {
  const { dialog } = await fixture();
  expect(dialog).toHaveTextContent("First remote title");
  await act(async () => {
    await mockApi.simulateAgent({
      action: "task.updated",
      key: "JB-7",
      patch: { title: "Second remote title", priority: "low" },
    });
  });
  await waitFor(() =>
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /changed again/i,
    ),
  );
  expect(dialog).toHaveTextContent("First remote title");
  expect(dialog).not.toHaveTextContent("Second remote title");
  expect(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  ).toBeDisabled();
});
it("failed conflict resolution keeps its error inside the active modal and preserves edits", async () => {
  const { dialog, user, input } = await fixture();
  mockApi.failNext("update_task");
  await user.click(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(input).toHaveValue("My retained title");
  expect(dialog).toBeVisible();
});
it("explicit comparison reread preserves the draft, focuses evidence and saves only edited fields with the exact inspected revision", async () => {
  const { dialog, user, input } = await fixture();
  await act(async () => {
    await mockApi.simulateAgent({
      action: "task.updated",
      key: "JB-7",
      patch: {
        title: "New inspected title",
        priority: "low",
        descriptionMd: "Keep this unrelated newer note.",
      },
    });
  });
  const reread = await within(dialog).findByRole("button", {
    name: "Read latest comparison",
  });
  mockApi.failNext("get_task");
  await user.click(reread);
  await within(dialog).findByText(/Simulated failure.*Your draft is kept/);
  expect(input).toHaveValue("My retained title");
  expect(dialog).toHaveTextContent("First remote title");
  await user.click(reread);
  await waitFor(() =>
    expect(
      within(dialog).getByRole("heading", { name: "Compared task · JB-7" }),
    ).toHaveFocus(),
  );
  expect(dialog).toHaveTextContent("New inspected title");
  expect(dialog).toHaveTextContent("Keep this unrelated newer note.");
  const inspected = await mockApi.getTask("JB-7");
  mockApi.calls.length = 0;
  await user.click(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull(),
  );
  expect(
    mockApi.calls.find((call) => call.command === "update_task")?.input,
  ).toEqual({
    key: "JB-7",
    expectedUpdatedAt: inspected.updatedAt,
    title: "My retained title",
  });
  expect(await mockApi.getTask("JB-7")).toMatchObject({
    title: "My retained title",
    priority: "low",
    descriptionMd: "Keep this unrelated newer note.",
  });
  expect(screen.getByRole("dialog", { name: "JB-7" })).toHaveFocus();
  expect(useUiStore.getState().toasts.at(-1)?.text).toBe(
    "Edits saved against the reviewed version.",
  );
});
it("pending comparison save locks duplicate submission, dismissal and hidden editor shortcuts; failure remains retryable", async () => {
  const { dialog, user, input } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const original = mockApi.updateTask.bind(mockApi);
  const save = vi
    .spyOn(mockApi, "updateTask")
    .mockImplementationOnce(async (payload) => {
      await gate;
      return original(payload);
    });
  mockApi.failNext("update_task");
  await user.dblClick(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: "Saving my edits…" }),
  ).toBeDisabled();
  expect(
    within(dialog).getByRole("button", { name: "Keep editing" }),
  ).toBeDisabled();
  expect(
    within(dialog).getByRole("button", {
      name: "Discard my edits and use latest",
    }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  fireEvent.mouseDown(dialog.parentElement as HTMLElement);
  expect(dialog).toBeVisible();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(input).toHaveValue("My retained title");
  await user.click(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull(),
  );
  expect(save).toHaveBeenCalledTimes(2);
});
it("closing a comparison keeps the local draft and reopening does not silently save it", async () => {
  const { dialog, user, input } = await fixture();
  mockApi.calls.length = 0;
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(
    mockApi.calls.filter((call) => call.command === "update_task"),
  ).toHaveLength(0);
  await user.click(
    within(dialog).getByRole("button", { name: "Keep editing" }),
  );
  expect(input).toHaveValue("My retained title");
  expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  const reopened = await screen.findByRole("dialog", {
    name: "Review changes",
  });
  expect(reopened).toHaveTextContent("My retained title");
  expect(
    mockApi.calls.filter((call) => call.command === "update_task"),
  ).toHaveLength(0);
});

it("friendly brief comparison names whole-list replacement and preserves untouched remote brief fields", async () => {
  const base = await mockApi.getTask("JB-7");
  const remote = structuredClone(base);
  remote.updatedAt = "remote-inspected";
  remote.brief.boundariesMd = "Keep the newer remote boundary.";
  remote.brief.changes = [
    { title: "Remote entry", required: "Remote required detail" },
  ];
  const yours = taskValues(base);
  yours.brief.goalMd = "A readable local goal";
  yours.brief.changes = [
    {
      title: "Local entry",
      required: "Local required detail",
      now: "Current state",
      cause: "Reason",
      where: "Local module",
      follow: "Existing style",
      keep: "Preserve files",
    },
  ];
  const save = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskConflictDialog
        base={base}
        latest={remote}
        yours={yours}
        live={remote}
        members={await mockApi.listMembers()}
        actor="A teammate"
        pending={false}
        error={null}
        close={vi.fn()}
        read={vi.fn()}
        discard={vi.fn()}
        save={save}
      />
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole("dialog", { name: "Review changes" });
  expect(dialog).toHaveTextContent(
    "Your Changes list replaces the whole saved list",
  );
  expect(dialog).toHaveTextContent("Entries are not merged individually");
  expect(
    within(dialog).getByRole("region", { name: "Goal" }),
  ).toHaveTextContent("A readable local goal");
  const changes = within(dialog).getByRole("region", { name: "Changes" });
  expect(changes).toHaveTextContent("Current behavior");
  expect(changes).toHaveTextContent("Remote required detail");
  expect(changes).toHaveTextContent("Local required detail");
  expect(dialog).not.toHaveTextContent("goalMd");
  expect(dialog).not.toHaveTextContent('"required":');
  await userEvent.setup().click(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  );
  const compared = save.mock.calls[0]?.[0];
  expect(compared.remote.updatedAt).toBe("remote-inspected");
  const patch = taskPatch(
    taskValues(compared.base),
    compared.yours,
    taskValues(compared.remote),
  );
  expect(patch.brief).toMatchObject({
    boundariesMd: "Keep the newer remote boundary.",
    changes: yours.brief.changes,
    goalMd: "A readable local goal",
  });
  expect(patch.brief?.changes).toHaveLength(1);
});
it("a server conflict during resolution never replays the draft and keeps the previous comparison until reread", async () => {
  const { dialog, user } = await fixture();
  const inspected = await mockApi.getTask("JB-7");
  const original = mockApi.updateTask.bind(mockApi);
  const save = vi
    .spyOn(mockApi, "updateTask")
    .mockImplementationOnce(async (payload) => {
      await original({
        key: inspected.key,
        expectedUpdatedAt: inspected.updatedAt,
        title: "A racing saved version",
      });
      return original(payload);
    });
  await user.click(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  );
  await within(dialog).findByText(/This task changed again/);
  expect(dialog).toHaveTextContent("First remote title");
  expect(dialog).not.toHaveTextContent("A racing saved version");
  expect(
    within(dialog).getByRole("button", {
      name: "Save my edits against latest",
    }),
  ).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[0].expectedUpdatedAt).toBe(inspected.updatedAt);
  expect((await mockApi.getTask("JB-7")).title).toBe("A racing saved version");
  await user.click(
    within(dialog).getByRole("button", { name: "Read latest comparison" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", {
        name: "Save my edits against latest",
      }),
    ).toBeEnabled(),
  );
  expect(dialog).toHaveTextContent("A racing saved version");
  expect(save).toHaveBeenCalledTimes(1);
});
it("a first conflict read failure keeps unsaved fields with an explicit read retry, not a write retry", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskDrawer taskKey="JB-7" close={() => {}} />
    </QueryClientProvider>,
  );
  const input = await screen.findByRole("textbox", { name: "Task title" });
  const old = await mockApi.getTask("JB-7");
  fireEvent.change(input, {
    target: { value: "Local draft after failed comparison read" },
  });
  await mockApi.updateTask({
    key: old.key,
    expectedUpdatedAt: old.updatedAt,
    title: "Newer saved title",
  });
  mockApi.calls.length = 0;
  mockApi.failNext("get_task");
  await userEvent.setup().click(screen.getByRole("button", { name: /^Save/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "latest version could not be read",
  );
  expect(input).toHaveValue("Local draft after failed comparison read");
  expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull();
  expect(
    mockApi.calls.filter((call) => call.command === "update_task"),
  ).toHaveLength(1);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Read latest version" }));
  const dialog = await screen.findByRole("dialog", { name: "Review changes" });
  expect(dialog).toHaveTextContent("Newer saved title");
  expect(dialog).toHaveTextContent("Local draft after failed comparison read");
  expect(
    mockApi.calls.filter((call) => call.command === "update_task"),
  ).toHaveLength(1);
});
