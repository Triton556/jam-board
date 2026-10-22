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
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { useUiStore } from "../lib/ui-store";
import { ReadinessDialog } from "./task/Readiness";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
  useUiStore.setState({ toasts: [], readyRequest: null });
});
async function mount() {
  const task = await mockApi.createTask({
    title: "A rough draft",
    status: "backlog",
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <div
        className="drawer"
        role="dialog"
        aria-labelledby="task-title"
        tabIndex={-1}
      >
        <span id="task-title">{task.key}</span>
        <button
          type="button"
          onClick={() =>
            useUiStore.setState({
              readyRequest: {
                key: task.key,
                status: "ready",
                expectedUpdatedAt: task.updatedAt,
              },
            })
          }
        >
          Mark ready
        </button>
      </div>
      <ReadinessDialog />
    </QueryClientProvider>,
  );
  return { task, client, user: userEvent.setup() };
}
async function open(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  const dialog = await screen.findByRole("dialog", {
    name: `Not ready · ${key}`,
  });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
    ).toBeEnabled(),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
  );
  expect(
    within(dialog).getByRole("textbox", { name: "Override reason" }),
  ).toHaveFocus();
  await user.type(
    within(dialog).getByRole("textbox", { name: "Override reason" }),
    "Explore first; a bounded planning exception.",
  );
  return dialog;
}
it("a failed readiness override keeps its reason and error inside the modal, then retries without starting work", async () => {
  const { task, user } = await mount();
  const dialog = await open(user, task.key);
  mockApi.failNext("move_task");
  await user.click(
    within(dialog).getByRole("button", {
      name: "Mark ready anyway",
    }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(within(dialog).getByRole("textbox")).toHaveValue(
    "Explore first; a bounded planning exception.",
  );
  expect(useUiStore.getState().toasts).toHaveLength(0);
  await user.click(
    within(dialog).getByRole("button", {
      name: "Mark ready anyway",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: `Not ready · ${task.key}` }),
    ).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: task.key })).toHaveFocus();
  expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
    "no agent session was launched",
  );
  const saved = await mockApi.getTask(task.key);
  expect(saved.status).toBe("ready");
  expect(
    (await mockApi.getExecution({ type: "story", id: saved.story.id }))
      .effectiveState,
  ).toBe("paused");
});
it("pending readiness cannot be double-submitted, edited, canceled or dismissed", async () => {
  const { task, user } = await mount();
  const dialog = await open(user, task.key);
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const original = mockApi.moveTask.bind(mockApi);
  const save = vi
    .spyOn(mockApi, "moveTask")
    .mockImplementation(async (input) => {
      await gate;
      return original(input);
    });
  await user.dblClick(
    within(dialog).getByRole("button", {
      name: "Mark ready anyway",
    }),
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: "Moving to Ready…" }),
  ).toBeDisabled();
  expect(
    within(dialog).getByRole("button", { name: "Keep in Backlog" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("textbox")).toBeDisabled();
  for (const button of within(dialog).getAllByRole("button", { name: /^Fix / }))
    expect(button).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(
    within(dialog).getByRole("button", {
      name: `Close Not ready · ${task.key}`,
    }),
  );
  fireEvent.mouseDown(dialog.parentElement as HTMLElement);
  expect(dialog).toBeVisible();
  await act(async () => resolve());
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: `Not ready · ${task.key}` }),
    ).toBeNull(),
  );
});
it("a failed readiness read is retryable and cannot be overridden without seeing the saved brief", async () => {
  const { task, user } = await mount();
  mockApi.failNext("check_ready");
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  const dialog = screen.getByRole("dialog", {
    name: `Not ready · ${task.key}`,
  });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(
    within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
  ).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Check again" }));
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
    ).toBeEnabled(),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Keep in Backlog" }),
  );
  expect(screen.getByRole("button", { name: "Mark ready" })).toHaveFocus();
  expect((await mockApi.getTask(task.key)).status).toBe("backlog");
});

it("a readiness decision retains its reason but never replaces its captured version after a background edit", async () => {
  const { task, user, client } = await mount();
  const dialog = await open(user, task.key);
  const changed = await mockApi.updateTask({
    key: task.key,
    expectedUpdatedAt: task.updatedAt,
    descriptionMd: "New acceptance: preserve the local files.",
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["task", task.key] });
  });
  expect(
    await within(dialog).findByText(/This task changed after the action began/),
  ).toBeVisible();
  const confirm = within(dialog).getByRole("button", {
    name: "Mark ready anyway",
  });
  expect(confirm).toBeDisabled();
  expect(within(dialog).getByRole("textbox")).toHaveValue(
    "Explore first; a bounded planning exception.",
  );
  expect(
    mockApi.calls.filter((call) => call.command === "move_task"),
  ).toHaveLength(0);
  await user.click(
    within(dialog).getByRole("button", { name: "Read latest task" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("heading", {
        name: `${task.key} · ${task.title}`,
      }),
    ).toHaveFocus(),
  );
  expect(
    within(dialog).getByText("New acceptance: preserve the local files."),
  ).toBeVisible();
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(useUiStore.getState().readyRequest).toBeNull());
  expect(
    mockApi.calls.find((call) => call.command === "move_task")?.input,
  ).toMatchObject({
    expectedUpdatedAt: changed.updatedAt,
    overrideReason: "Explore first; a bounded planning exception.",
  });
});
it("a conflict returned before live refetch locks readiness until an intentional reread, without replaying the override", async () => {
  const { task, user } = await mount();
  const dialog = await open(user, task.key);
  const newer = await mockApi.updateTask({
    key: task.key,
    expectedUpdatedAt: task.updatedAt,
    descriptionMd: "An unseen concurrent edit.",
  });
  const history = (await mockApi.getTask(task.key)).history.length;
  await user.click(
    within(dialog).getByRole("button", { name: "Mark ready anyway" }),
  );
  await within(dialog).findByText(/This task changed after the action began/);
  expect(
    within(dialog).getByRole("button", { name: "Mark ready anyway" }),
  ).toBeDisabled();
  expect(
    mockApi.calls.filter((call) => call.command === "move_task"),
  ).toHaveLength(1);
  expect(
    mockApi.calls.find((call) => call.command === "move_task")?.input,
  ).toMatchObject({ expectedUpdatedAt: task.updatedAt });
  expect(await mockApi.getTask(task.key)).toMatchObject({
    status: "backlog",
    updatedAt: newer.updatedAt,
  });
  expect((await mockApi.getTask(task.key)).history).toHaveLength(history);
  await user.click(
    within(dialog).getByRole("button", { name: "Read latest task" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Mark ready anyway" }),
    ).toBeEnabled(),
  );
  expect(
    mockApi.calls.filter((call) => call.command === "move_task"),
  ).toHaveLength(1);
});
it("a task changed during its readiness read is not presented as a coherent snapshot", async () => {
  const { task, user } = await mount();
  const check = mockApi.checkReady.bind(mockApi);
  vi.spyOn(mockApi, "checkReady").mockImplementationOnce(async (key) => {
    const readiness = await check(key);
    await mockApi.updateTask({
      key,
      expectedUpdatedAt: task.updatedAt,
      descriptionMd: "Changed midway through the read.",
    });
    return readiness;
  });
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  const dialog = screen.getByRole("dialog", {
    name: `Not ready · ${task.key}`,
  });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "changed while its brief was being read",
  );
  expect(
    within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
  ).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Check again" }));
  await within(dialog).findByText(/This task changed after the action began/);
  expect(
    within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Read latest task" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
    ).toBeEnabled(),
  );
});
