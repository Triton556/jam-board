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
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { ReadinessDialog } from "./Readiness";
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
  mockApi.calls.length = 0;
  useUiStore.setState({ readyRequest: null, toasts: [], taskChanges: {} });
});
async function fixture(existingKey?: string) {
  const task = existingKey
    ? await mockApi.getTask(existingKey)
    : await mockApi.createTask({
        title: "Rough task before refinement",
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
      <TaskDrawer taskKey={task.key} close={() => {}} />
      <ReadinessDialog />
    </QueryClientProvider>,
  );
  await screen.findByRole("textbox", { name: "Task title" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeEnabled(),
  );
  return { task, client, user: userEvent.setup() };
}
it("Mark ready saves dirty draft fields first and opens an override bound to that exact saved version", async () => {
  const { task } = await fixture();
  fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
    target: { value: "Refined but incomplete task" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
  const dialog = await screen.findByRole("dialog", {
    name: `Not ready · ${task.key}`,
  });
  const saved = await mockApi.getTask(task.key);
  expect(saved.title).toBe("Refined but incomplete task");
  expect(saved.status).toBe("backlog");
  expect(useUiStore.getState().readyRequest?.expectedUpdatedAt).toBe(
    saved.updatedAt,
  );
  expect(saved.updatedAt).not.toBe(task.updatedAt);
  expect(
    await within(dialog).findByRole("heading", {
      name: `${task.key} · Refined but incomplete task`,
    }),
  ).toBeVisible();
  expect(
    mockApi.calls.filter((call) => call.command === "update_task"),
  ).toHaveLength(1);
});
it("a failed combined Ready save retains other dirty fields instead of overriding a different saved brief", async () => {
  const { task, user } = await fixture();
  fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
    target: { value: "Still unsaved local intent" },
  });
  await user.click(screen.getByRole("combobox", { name: "Status" }));
  await user.click(screen.getByRole("option", { name: "Ready" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: /^Save/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your edits remain unsaved",
  );
  expect(useUiStore.getState().readyRequest).toBeNull();
  expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Still unsaved local intent",
  );
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
    "Backlog",
  );
  expect(await mockApi.getTask(task.key)).toMatchObject({
    title: task.title,
    status: "backlog",
    updatedAt: task.updatedAt,
  });
  await user.click(screen.getByRole("button", { name: /^Save/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled(),
  );
  expect((await mockApi.getTask(task.key)).title).toBe(
    "Still unsaved local intent",
  );
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  await screen.findByRole("dialog", { name: `Not ready · ${task.key}` });
  expect(useUiStore.getState().readyRequest?.expectedUpdatedAt).toBe(
    (await mockApi.getTask(task.key)).updatedAt,
  );
});
it("Mark ready locks the decision while reading and never refills its version from a concurrent task edit", async () => {
  const { task, user } = await fixture();
  const original = mockApi.checkReady.bind(mockApi);
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const check = vi
    .spyOn(mockApi, "checkReady")
    .mockImplementationOnce(async (key) => {
      await gate;
      return original(key);
    });
  await user.dblClick(screen.getByRole("button", { name: "Mark ready" }));
  expect(check).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Checking brief…" }),
  ).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Task title" })).toBeDisabled();
  await mockApi.updateTask({
    key: task.key,
    expectedUpdatedAt: task.updatedAt,
    descriptionMd: "Edited while checking readiness",
  });
  await act(async () => release());
  const dialog = await screen.findByRole("dialog", {
    name: `Task changed · ${task.key}`,
  });
  expect(useUiStore.getState().readyRequest?.expectedUpdatedAt).toBe(
    task.updatedAt,
  );
  expect(
    within(dialog).getByRole("button", { name: "Mark ready anyway…" }),
  ).toBeDisabled();
  expect(
    mockApi.calls.filter(
      (call) => call.command === "move_task" || call.command === "mark_ready",
    ),
  ).toHaveLength(0);
});

it("a complete brief uses the captured native Ready version and leaves stable focus and an honest receipt", async () => {
  const ready = await mockApi.getTask("JB-7");
  await mockApi.moveTask({
    key: ready.key,
    expectedUpdatedAt: ready.updatedAt,
    status: "backlog",
  });
  const { task, user } = await fixture(ready.key);
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Mark ready" })).toBeNull(),
  );
  expect(
    mockApi.calls.find((call) => call.command === "mark_ready")?.input,
  ).toEqual({ key: task.key, expectedUpdatedAt: task.updatedAt });
  expect(screen.getByRole("dialog", { name: task.key })).toHaveFocus();
  expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
    "Scope permission is unchanged; no agent session was launched",
  );
});
it("a complete-brief Ready conflict opens retained old intent rather than automatically replaying with the newer version", async () => {
  const ready = await mockApi.getTask("JB-7");
  await mockApi.moveTask({
    key: ready.key,
    expectedUpdatedAt: ready.updatedAt,
    status: "backlog",
  });
  const { task, user } = await fixture(ready.key);
  const original = mockApi.markReady.bind(mockApi);
  const mark = vi
    .spyOn(mockApi, "markReady")
    .mockImplementationOnce(async (input) => {
      await mockApi.updateTask({
        key: task.key,
        expectedUpdatedAt: task.updatedAt,
        descriptionMd: "New instruction before the Ready write",
      });
      return original(input);
    });
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  const dialog = await screen.findByRole("dialog", {
    name: `Task changed · ${task.key}`,
  });
  expect(mark).toHaveBeenCalledTimes(1);
  expect(useUiStore.getState().readyRequest?.expectedUpdatedAt).toBe(
    task.updatedAt,
  );
  expect(
    within(dialog).getByRole("button", { name: "Mark ready" }),
  ).toBeDisabled();
  expect((await mockApi.getTask(task.key)).status).toBe("backlog");
});
