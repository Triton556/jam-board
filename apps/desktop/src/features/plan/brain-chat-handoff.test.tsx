import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HandoffScope } from "../../lib/brain-handoff";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { draftKey, useBrainState } from "../brain/brain-store";
import { BrainHandoff } from "./BrainHandoff";

beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useBrainState.setState({
    sessions: [],
    selected: { chat: null, terminal: null },
    drafts: {},
    events: {},
    tab: "chat",
  });
  useUiStore.setState({ brainDockOpen: false });
});
afterEach(() => vi.restoreAllMocks());
async function mount(scope: HandoffScope) {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  useBrainState.setState({ projectId: app.jam?.id ?? null });
  render(
    <QueryClientProvider client={client}>
      <BrainHandoff scope={scope} />
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Refine with brain" }),
  );
  return { app, client };
}
it.each(["epic", "story", "task"] as const)(
  "H-P07 Open in brain chat stages the exact %s prompt and scope chip, then closes",
  async (type) => {
    const entity =
      type === "epic"
        ? (await mockApi.listEpics())[0]
        : type === "story"
          ? (await mockApi.listStories())[0]
          : await mockApi.getTask("JB-7");
    if (!entity) throw new Error("Missing scope fixture");
    await mount({ type, id: entity.id, key: entity.key });
    await userEvent.type(
      screen.getByRole("textbox", { name: "What should change?" }),
      "Keep the snow blue",
    );
    const prompt = (
      screen.getByRole("textbox", {
        name: "Planning prompt",
      }) as HTMLTextAreaElement
    ).value;
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    expect(
      screen.getByRole("button", { name: "Copy planning prompt" }),
    ).toHaveClass("secondary");
    await userEvent.click(
      screen.getByRole("button", { name: "Open in brain chat" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useUiStore.getState().brainDockOpen).toBe(true);
    expect(useBrainState.getState().drafts[draftKey()]).toEqual({
      text: prompt,
      context: [
        {
          type: "board_ref",
          uri: `jam://${type}/${entity.key}`,
          label: `${entity.key} · ${entity.title}`,
          text: `${type}: ${entity.title}`,
        },
      ],
    });
    expect(copy).not.toHaveBeenCalled();
    expect(
      mockApi.calls.filter((call) =>
        /^(create|update|set_|claim|request_execution)/.test(call.command),
      ),
    ).toEqual([]);
  },
);
it("H-P07 project ABA during a scope read cannot stage an old preview in chat", async () => {
  const task = await mockApi.getTask("JB-7");
  const { app, client } = await mount({
    type: "task",
    id: task.id,
    key: task.key,
  });
  let resolve!: (value: typeof task) => void;
  vi.spyOn(mockApi, "getTask").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open in brain chat" }),
  );
  await act(async () => {
    client.setQueryData(["app"], { ...app, jam: { ...app.jam, id: "other" } });
    client.setQueryData(["app"], app);
    resolve(task);
  });
  expect(useBrainState.getState().drafts).toEqual({});
  expect(useUiStore.getState().brainDockOpen).toBe(false);
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("H-P07 a failed scope read retains the preview and copy fallback", async () => {
  const task = await mockApi.getTask("JB-7");
  await mount({ type: "task", id: task.id, key: task.key });
  vi.spyOn(mockApi, "getTask").mockRejectedValue(
    new Error("Scope unavailable"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open in brain chat" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Scope unavailable",
  );
  expect(
    screen.getByRole("textbox", { name: "Planning prompt" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  ).toBeEnabled();
  expect(useBrainState.getState().drafts).toEqual({});
});
