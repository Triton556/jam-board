import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { NewPlanningDialog } from "./plan/NewPlanningDialog";
import { PlanPage } from "./plan/PlanPage";
import { StoryDrawer } from "./plan/StoryDrawer";

const router = vi.hoisted(() => ({ navigate: vi.fn(), blocker: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useRouterState: () => "/plan/JB-E1",
  useBlocker: (options: unknown) => {
    router.blocker(options);
    return {};
  },
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  router.navigate.mockClear();
  router.blocker.mockClear();
  await mockApi.resetDemo();
});
const targets = {
  epic: { kind: "epic" },
  story: { kind: "story", epicKey: "JB-E1" },
  task: { kind: "task", storyKey: "JB-S1" },
} as const;
type Kind = keyof typeof targets;
const kinds = Object.keys(targets) as Kind[];
const labels = {
  epic: "Epic name",
  story: "Story name",
  task: "New planned task title",
};
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function delayed(kind: Kind, gate = deferred()) {
  // The response is delayed after a successful real mock-store write. Closing
  // a UI cannot undo that write; a rejection case below writes nothing instead.
  if (kind === "epic") {
    const create = mockApi.createEpic.bind(mockApi);
    return {
      gate,
      spy: vi.spyOn(mockApi, "createEpic").mockImplementation(async (input) => {
        const result = await create(input);
        await gate.promise;
        return result;
      }),
    };
  }
  if (kind === "story") {
    const create = mockApi.createStory.bind(mockApi);
    return {
      gate,
      spy: vi
        .spyOn(mockApi, "createStory")
        .mockImplementation(async (input) => {
          const result = await create(input);
          await gate.promise;
          return result;
        }),
    };
  }
  const create = mockApi.createTask.bind(mockApi);
  return {
    gate,
    spy: vi.spyOn(mockApi, "createTask").mockImplementation(async (input) => {
      const result = await create(input);
      await gate.promise;
      return result;
    }),
  };
}
async function view(kind: Kind, integrated = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const created = vi.fn();
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <NewPlanningDialog
        target={targets[kind]}
        close={() => {
          close();
          setOpen(false);
        }}
        created={created}
      />
    ) : (
      <p>Created</p>
    );
  }
  const rendered = render(
    <QueryClientProvider client={client}>
      {integrated && kind !== "task" ? (
        <PlanPage
          epicKey="JB-E1"
          search={{ create: kind }}
          openTask={created}
          openStory={created}
        />
      ) : (
        <Harness />
      )}
    </QueryClientProvider>,
  );
  const input = await screen.findByRole("textbox", { name: labels[kind] });
  const user = userEvent.setup();
  await user.type(input, "Fictional captured title");
  return { client, created, close, input, user, ...rendered };
}

it.each(kinds)(
  "pending %s creation resists Escape, backdrop, Cancel, close, Enter and click without duplicate sends",
  async (kind) => {
    const pending = delayed(kind);
    const h = await view(kind);
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(pending.spy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(`Creating ${kind}`);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveFocus();
    expect(h.input).toBeDisabled();
    if (kind === "task")
      expect(
        screen.getByRole("combobox", { name: "Task story" }),
      ).toBeDisabled();
    expect(router.blocker.mock.lastCall?.[0].shouldBlockFn()).toBe(true);
    expect(router.blocker.mock.lastCall?.[0].enableBeforeUnload).toBe(true);
    await h.user.keyboard("{Escape}{Enter}");
    await h.user.click(screen.getByRole("button", { name: "Cancel" }));
    await h.user.click(
      screen.getByRole("button", { name: `Close New ${kind}` }),
    );
    await h.user.click(screen.getByRole("button", { name: `Create ${kind}` }));
    fireEvent.mouseDown(document.querySelector(".dialog-backdrop") as Element);
    // Defensive handler coverage as well as ordinary user controls above.
    fireEvent.submit(h.input.closest("form") as HTMLFormElement);
    fireEvent.change(h.input, { target: { value: "Not the submitted title" } });
    expect(h.close).not.toHaveBeenCalled();
    expect(h.created).not.toHaveBeenCalled();
    expect(pending.spy).toHaveBeenCalledTimes(1);
    expect(pending.spy.mock.calls[0]?.[0]).toMatchObject({
      title: "Fictional captured title",
    });
    await act(async () => {
      pending.gate.resolve();
      await pending.gate.promise;
    });
    await waitFor(() => expect(h.created).toHaveBeenCalledTimes(1));
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.blocker.mock.lastCall?.[0].shouldBlockFn()).toBe(false);
  },
);

it.each(kinds)(
  "failed %s creation preserves its draft, shows the error and allows one explicit retry",
  async (kind) => {
    const gate = deferred();
    const method =
      kind === "epic"
        ? "createEpic"
        : kind === "story"
          ? "createStory"
          : "createTask";
    const save = vi.spyOn(mockApi, method).mockImplementationOnce(async () => {
      await gate.promise;
      throw new Error("Creation unavailable");
    });
    const h = await view(kind);
    await h.user.click(screen.getByRole("button", { name: `Create ${kind}` }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Creation unavailable",
    );
    expect(h.input).toHaveValue("Fictional captured title");
    expect(h.input).toBeEnabled();
    expect(h.input).toHaveFocus();
    expect(h.created).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(router.blocker.mock.lastCall?.[0].shouldBlockFn()).toBe(false);
    await h.user.clear(h.input);
    await h.user.type(h.input, "Intentional retry title");
    await h.user.click(screen.getByRole("button", { name: `Create ${kind}` }));
    await waitFor(() => expect(h.created).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      title: "Intentional retry title",
    });
  },
);

it.each(kinds)(
  "%s creation does not navigate after forced unmount, though the already submitted write remains",
  async (kind) => {
    const pending = delayed(kind);
    const h = await view(kind);
    await h.user.click(screen.getByRole("button", { name: `Create ${kind}` }));
    await waitFor(() => expect(pending.spy).toHaveBeenCalledTimes(1));
    h.unmount();
    await act(async () => {
      pending.gate.resolve();
      await pending.gate.promise;
    });
    await waitFor(() => expect(h.client.isMutating()).toBe(0));
    expect(h.close).not.toHaveBeenCalled();
    expect(h.created).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "project transition invalidates pending creation navigation, including return to the same project (%s)",
  async (returnToOriginal) => {
    const pending = delayed("task");
    const h = await view("task");
    await h.user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(pending.spy).toHaveBeenCalledTimes(1));
    const original = await mockApi.appState();
    await act(async () => {
      h.client.setQueryData(["app"], {
        ...original,
        jam: { ...original.jam, id: "different-fictional-project" },
      });
      if (returnToOriginal) h.client.setQueryData(["app"], original);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already submitted creation is not cancelled",
    );
    await act(async () => {
      pending.gate.resolve();
      await pending.gate.promise;
    });
    await waitFor(() => expect(h.client.isMutating()).toBe(0));
    expect(h.created).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
    await h.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.close).toHaveBeenCalledOnce();
  },
);

it.each(["epic", "story"] as const)(
  "Plan page %s creation keeps the actual modal until success and opens the created destination once",
  async (kind) => {
    const pending = delayed(kind);
    const h = await view(kind, true);
    await h.user.click(screen.getByRole("button", { name: `Create ${kind}` }));
    await waitFor(() => expect(pending.spy).toHaveBeenCalledTimes(1));
    await h.user.click(screen.getByRole("button", { name: "Cancel" }));
    await h.user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    const destination = kind === "epic" ? router.navigate : h.created;
    expect(destination).not.toHaveBeenCalled();
    await act(async () => {
      pending.gate.resolve();
      await pending.gate.promise;
    });
    await waitFor(() => expect(destination).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it.each(kinds)(
  "ordinary Escape dismissal returns after a known %s rejection",
  async (kind) => {
    const method =
      kind === "epic"
        ? "createEpic"
        : kind === "story"
          ? "createStory"
          : "createTask";
    const save = vi
      .spyOn(mockApi, method)
      .mockRejectedValueOnce(new Error("Rejected before writing"));
    const h = await view(kind);
    await h.user.click(screen.getByRole("button", { name: `Create ${kind}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Rejected before writing",
    );
    await h.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.created).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  },
);

it("missing project context fails closed and a failed read can be explicitly retried without losing the title", async () => {
  const user = userEvent.setup();
  const app = vi
    .spyOn(mockApi, "appState")
    .mockRejectedValueOnce(new Error("Project read unavailable"));
  const create = vi.spyOn(mockApi, "createEpic");
  const created = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NewPlanningDialog
        target={targets.epic}
        close={vi.fn()}
        created={created}
      />
    </QueryClientProvider>,
  );
  await user.type(
    screen.getByRole("textbox", { name: "Epic name" }),
    "Retained project-read draft",
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not check the current project",
  );
  expect(screen.getByRole("button", { name: "Create epic" })).toBeDisabled();
  expect(create).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry project check" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create epic" })).toBeEnabled(),
  );
  expect(screen.getByRole("textbox", { name: "Epic name" })).toHaveValue(
    "Retained project-read draft",
  );
  await user.click(screen.getByRole("button", { name: "Create epic" }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  expect(app).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledWith({ title: "Retained project-read draft" });
});

it("a project transition before submission disables the old form without sending a create", async () => {
  const create = vi.spyOn(mockApi, "createTask");
  const h = await view("task");
  const original = await mockApi.appState();
  await act(async () => {
    h.client.setQueryData(["app"], {
      ...original,
      jam: { ...original.jam, id: "another-project" },
    });
    h.client.setQueryData(["app"], original);
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The project changed",
  );
  await h.user.click(screen.getByRole("button", { name: "Create task" }));
  expect(create).not.toHaveBeenCalled();
  await h.user.keyboard("{Escape}");
  expect(h.close).toHaveBeenCalledOnce();
});

it("renaming the same project does not invalidate its pending creation", async () => {
  const pending = delayed("story");
  const h = await view("story");
  await h.user.click(screen.getByRole("button", { name: "Create story" }));
  await waitFor(() => expect(pending.spy).toHaveBeenCalledOnce());
  const original = await mockApi.appState();
  await act(async () => {
    h.client.setQueryData(["app"], {
      ...original,
      jam: { ...original.jam, name: "Renamed fictional project" },
    });
  });
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => {
    pending.gate.resolve();
    await pending.gate.promise;
  });
  await waitFor(() => expect(h.created).toHaveBeenCalledOnce());
});

it("a task create inside the Story drawer keeps both modal layers until the write completes", async () => {
  const pending = delayed("task");
  const closeStory = vi.fn(),
    openTask = vi.fn();
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <StoryDrawer storyKey="JB-S1" close={closeStory} openTask={openTask} />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "+ Task" }));
  await user.type(
    screen.getByRole("textbox", { name: "New planned task title" }),
    "Nested fictional task",
  );
  await user.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(pending.spy).toHaveBeenCalledOnce());
  await user.keyboard("{Escape}{Escape}");
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  expect(closeStory).not.toHaveBeenCalled();
  expect(openTask).not.toHaveBeenCalled();
  await act(async () => {
    pending.gate.resolve();
    await pending.gate.promise;
  });
  await waitFor(() => expect(openTask).toHaveBeenCalledOnce());
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(closeStory).not.toHaveBeenCalled();
});
