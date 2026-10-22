import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { brainHandoff, connectionPrompt } from "../lib/brain-handoff";
import { mockApi } from "../lib/mock-bridge";
import { BrainHandoff, WorkflowGuide } from "./plan/BrainHandoff";

beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});

it("connection checking is read-only and never tells a worker to take Ready work", () => {
  expect(connectionPrompt).toContain("get_project and get_board");
  expect(connectionPrompt).toContain("read-only connection check");
  expect(connectionPrompt).not.toContain("highest-priority");
});

it.each(["project", "epic", "story", "task"] as const)(
  "%s handoff is project-pinned and separates planning from execution",
  (type) => {
    const prompt = brainHandoff(
      type === "project" ? { type } : { type, id: "scope-id", key: "JB2-S3" },
      { id: "exact-project", name: "Fictional project", keyPrefix: "JB2" },
    );
    expect(prompt).toContain("project ID is exact-project");
    expect(prompt).toContain("key prefix is JB2");
    expect(prompt).toContain("a matching name or prefix is not enough");
    expect(prompt).toContain(
      type === "project"
        ? "this project"
        : `${type} JB2-S3 (scope ID scope-id)`,
    );
    expect(prompt).toContain("stop and ask me to connect the right project");
    expect(prompt).toContain("comments and linked references/assets");
    expect(prompt).toContain("Reconcile my edits");
    expect(prompt).toContain("Planning only: do not claim tasks");
    expect(prompt).toContain(
      "Ready describes the brief, not permission to work",
    );
    expect(prompt).toContain(
      "without asking me to launch each worker separately",
    );
  },
);

it("handoff previews a scoped prompt without writing the board, and can be dismissed and reopened", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrainHandoff scope={{ type: "epic", id: "id-JB-E1", key: "JB-E1" }} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Refine with brain" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  const preview = await screen.findByRole("textbox", {
    name: "Planning prompt",
  });
  expect(preview).toHaveValue(
    brainHandoff(
      { type: "epic", id: "id-JB-E1", key: "JB-E1" },
      (await mockApi.appState()).jam ?? undefined,
    ),
  );
  expect(preview).toHaveAttribute("readonly");
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(write).toHaveBeenCalledOnce();
  expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Refine with brain" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(mockApi.calls.every((call) => call.command === "app_state")).toBe(
    true,
  );
});

it("clipboard failure leaves a selectable prompt and truthful recovery message", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
    new Error("denied"),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrainHandoff scope={{ type: "task", id: "id-JB-1", key: "JB-1" }} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Refine with brain" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Clipboard unavailable",
  );
  expect(
    screen.getByRole("textbox", { name: "Planning prompt" }),
  ).toBeVisible();
});

it("the workflow guide explains stories as the feature-sized intermediate level", async () => {
  const user = userEvent.setup();
  render(<WorkflowGuide />);
  await user.click(screen.getByText("How the board and brain work together"));
  expect(screen.getByText(/is a feature or outcome/)).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(
    screen.getByText(/Authorize the scope, not each worker/),
  ).toBeVisible();
});

it("an unknown project asks for its exact identity before any board read", () => {
  const prompt = brainHandoff({ type: "project" });
  expect(prompt).toContain(
    "confirm the intended project ID before reading its board",
  );
  expect(prompt).not.toContain("First call get_project");
});
it("an open handoff keeps the inspected project and scope across background selection or rename", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const original = await mockApi.appState();
  client.setQueryData(["app"], original);
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "story", id: "id-JB-S1", key: "JB-S1" }} />
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: "Refine with brain" }),
  );
  const captured =
    screen
      .getByRole("textbox", { name: "Planning prompt" })
      .getAttribute("value") ??
    (
      screen.getByRole("textbox", {
        name: "Planning prompt",
      }) as HTMLTextAreaElement
    ).value;
  expect(captured).toContain(original.jam?.id);
  act(() =>
    client.setQueryData(["app"], {
      ...original,
      jam: { ...original.jam, name: "Renamed same project" },
    }),
  );
  expect(screen.getByRole("textbox", { name: "Planning prompt" })).toHaveValue(
    captured,
  );
  act(() =>
    client.setQueryData(["app"], {
      ...original,
      jam: {
        ...original.jam,
        id: "different-database-same-prefix",
        name: "Different board with same key prefix",
      },
    }),
  );
  rerender(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "story", id: "id-JB-S2", key: "JB-S2" }} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("textbox", { name: "Planning prompt" })).toHaveValue(
    captured,
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "preview still targets",
  );
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(await navigator.clipboard.readText()).toBe(captured);
  await user.click(screen.getByRole("button", { name: /^Close$/ }));
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(screen.getByRole("textbox", { name: "Planning prompt" })).toHaveValue(
    brainHandoff(
      { type: "story", id: "id-JB-S2", key: "JB-S2" },
      {
        id: "different-database-same-prefix",
        name: "Different board with same key prefix",
        keyPrefix: original.jam?.keyPrefix ?? "",
      },
    ),
  );
});
it("a pending handoff copy cannot post an old receipt into a reopened scope", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const client = new QueryClient();
  client.setQueryData(["app"], await mockApi.appState());
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "story", id: "id-JB-S1", key: "JB-S1" }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(screen.getByRole("button", { name: "Copying…" })).toBeDisabled();
  await user.keyboard("{Escape}");
  rerender(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "story", id: "id-JB-S2", key: "JB-S2" }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(screen.getByRole("button", { name: "Copying…" })).toBeDisabled();
  await act(async () => finish());
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  ).toBeEnabled();
  expect(write).toHaveBeenCalledOnce();
});

it("project refinement explicitly inventories rough unassigned Backlog, not only the board summary", () => {
  const prompt = brainHandoff({ type: "project" });
  expect(prompt).toContain("Page list_tasks through nextCursor");
  expect(prompt).toContain("non-archived tasks, including unassigned Backlog");
  expect(prompt).toContain(
    "get_board is only a summary, not a complete task inventory",
  );
  expect(prompt).toContain(
    "get_task notes, assets, questions and linked sources",
  );
  expect(prompt).toContain("Planning only");
});
it.each(["epic", "story", "task"] as const)(
  "%s refinement does not broaden into a full project inventory",
  (type) => {
    const prompt = brainHandoff({ type, id: "fixture-id", key: "FIXTURE-1" });
    expect(prompt).toContain(`Review ${type} FIXTURE-1`);
    expect(prompt).not.toContain("Page list_tasks through nextCursor");
  },
);

it("AG02 continuation is smaller without dropping identity, stale intent or planning boundaries", () => {
  const scope = { type: "task", id: "task-id", key: "JB-1" } as const;
  const project = { id: "project-id", name: "Project", keyPrefix: "JB" };
  const setup = brainHandoff(scope, project);
  const short = brainHandoff(scope, project, { mode: "continue" });
  expect(short.length).toBeLessThan(setup.length * 0.7);
  for (const text of [
    "project-id",
    "scope ID task-id",
    "get_session_context",
    "current tool schemas",
    "exact task/report context inspected",
    "never refresh tokens just to replay",
    "ask for the full setup prompt",
    "even if a scope is running",
    "no claims",
    "do not replace it",
    "EMPTY task Description",
    "preserve existing human text",
    "my language",
    "can remain in chat",
  ])
    expect(short).toContain(text);
  expect(short).not.toContain("Page list_tasks");
  expect(setup).toContain("Never replace an unprocessed saved checkpoint");
  expect(setup).toContain("does not wake a chat");
});

it("H-P04 remembers an explicitly chosen mode and local request across modes and Close without a board write", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "task", id: "t1", key: "JB-1" }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(
    screen.getByRole("radio", { name: "First / new chat" }),
  ).toHaveAttribute("aria-checked", "true");
  const request = screen.getByRole("textbox", { name: "What should change?" });
  await user.type(request, "Keep the simple outcome; explain the empty state.");
  await user.click(
    screen.getByRole("radio", { name: "Continue in this chat" }),
  );
  const short = (
    screen.getByRole("textbox", {
      name: "Planning prompt",
    }) as HTMLTextAreaElement
  ).value;
  expect(short).toContain(
    '"Keep the simple outcome; explain the empty state."',
  );
  await user.click(screen.getByRole("radio", { name: "First / new chat" }));
  expect(request).toHaveValue(
    "Keep the simple outcome; explain the empty state.",
  );
  await user.click(
    screen.getByRole("radio", { name: "Continue in this chat" }),
  );
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue("Keep the simple outcome; explain the empty state.");
  expect(screen.getByRole("textbox", { name: "Planning prompt" })).toHaveValue(
    short,
  );
  expect(screen.getByText(/Local draft, not saved to the board/)).toBeVisible();
  expect(mockApi.calls.every((call) => call.command === "app_state")).toBe(
    true,
  );
});

it("H-P04 local request survives project return but never leaks to another project with the same key", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const original = await mockApi.appState();
  client.setQueryData(["app"], original);
  const view = () => (
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "story", id: "s1", key: "JB-S1" }} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  await user.type(
    screen.getByRole("textbox", { name: "What should change?" }),
    "Only in project A",
  );
  await user.click(screen.getByRole("button", { name: /^Close$/ }));
  act(() =>
    client.setQueryData(["app"], {
      ...original,
      jam: { ...original.jam, id: "other-project" },
    }),
  );
  rendered.rerender(view());
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue("");
  await user.type(
    screen.getByRole("textbox", { name: "What should change?" }),
    "Only in project B",
  );
  await user.keyboard("{Escape}");
  act(() => client.setQueryData(["app"], original));
  rendered.rerender(view());
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue("Only in project A");
  expect(
    screen.getByRole("textbox", { name: "Planning prompt" }),
  ).not.toHaveValue(expect.stringContaining("Only in project B"));
});

it("H-P04 mode and request changes never rebind an open captured entity after a scope/project rerender", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const original = await mockApi.appState();
  client.setQueryData(["app"], original);
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <BrainHandoff
        scope={{ type: "story", id: "original-story", key: "JB-S1" }}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  act(() =>
    client.setQueryData(["app"], {
      ...original,
      jam: { ...original.jam, id: "other-project" },
    }),
  );
  rerender(
    <QueryClientProvider client={client}>
      <BrainHandoff
        scope={{ type: "story", id: "other-story", key: "JB-S1" }}
      />
    </QueryClientProvider>,
  );
  await user.click(
    screen.getByRole("radio", { name: "Continue in this chat" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "What should change?" }),
    "Captured request",
  );
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  const text = await navigator.clipboard.readText();
  expect(text).toContain(`project ${original.jam?.id}`);
  expect(text).toContain("scope ID original-story");
  expect(text).not.toContain("other-project");
  expect(text).not.toContain("other-story");
});

it("H-P04 copy single-flight locks accepted input and mode, then retains them on known clipboard failure", async () => {
  const user = userEvent.setup();
  let reject!: (reason: Error) => void;
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    );
  const client = new QueryClient();
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={{ type: "project" }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  await user.type(
    screen.getByRole("textbox", { name: "What should change?" }),
    "Keep this request",
  );
  await user.click(
    screen.getByRole("radio", { name: "Continue in this chat" }),
  );
  await user.dblClick(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(write).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("radio", { name: "First / new chat" }),
  ).toBeDisabled();
  await act(async () => reject(new Error("denied")));
  expect(screen.getByRole("status")).toHaveTextContent("Clipboard unavailable");
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue("Keep this request");
  expect(
    screen.getByRole("radio", { name: "Continue in this chat" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    screen.getByRole("textbox", { name: "Planning prompt" }),
  ).toHaveAttribute("readonly");
});
