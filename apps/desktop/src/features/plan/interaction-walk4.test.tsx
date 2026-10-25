import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { NewPlanningDialog } from "./NewPlanningDialog";
import { PlanPage } from "./PlanPage";
import { StoryDrawer } from "./StoryDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/plan/JB-E1",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());
async function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  return { ...render(wrap(node)), client, wrap };
}
it("F01 cached project failure retains the creation field, disables dispatch and offers inline Retry", async () => {
  const create = vi.spyOn(mockApi, "createEpic");
  const { client } = await mount(
    <NewPlanningDialog
      target={{ kind: "epic" }}
      close={vi.fn()}
      created={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Epic name" });
  expect(input).toHaveFocus();
  await user.type(input, "Retained creation draft");
  vi.spyOn(mockApi, "appState").mockRejectedValueOnce(
    new Error("Background project read failed"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["app"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Background project read failed",
  );
  expect(screen.getByRole("textbox", { name: "Epic name" })).toBe(input);
  expect(input).toHaveValue("Retained creation draft");
  expect(screen.getByRole("button", { name: "Create epic" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry project check" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(input).toHaveValue("Retained creation draft");
  expect(create).not.toHaveBeenCalled();
});
it("F01 scoped creation draft survives a root-style unmount; another parent/project cannot inherit it", async () => {
  const dialog = (
    <NewPlanningDialog
      target={{ kind: "story", epicKey: "JB-E1" }}
      close={vi.fn()}
      created={vi.fn()}
    />
  );
  const { rerender, wrap, client } = await mount(dialog);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Story name" }),
    "Retained scoped story",
  );
  rerender(wrap(<p>Root read failure</p>));
  rerender(wrap(dialog));
  expect(screen.getByRole("textbox", { name: "Story name" })).toHaveValue(
    "Retained scoped story",
  );
  rerender(wrap(<p>Navigate</p>));
  rerender(
    wrap(
      <NewPlanningDialog
        target={{ kind: "story", epicKey: "JB-E2" }}
        close={vi.fn()}
        created={vi.fn()}
      />,
    ),
  );
  expect(screen.getByRole("textbox", { name: "Story name" })).toHaveValue("");
  rerender(wrap(<p>Switch project</p>));
  const app = await mockApi.appState();
  client.setQueryData(["app"], {
    ...app,
    jam: { ...app.jam, id: "other-project" },
  });
  rerender(wrap(dialog));
  expect(screen.getByRole("textbox", { name: "Story name" })).toHaveValue("");
});
it("F01 successful creation clears only the acknowledged scoped draft", async () => {
  const close = vi.fn();
  const dialog = (
    <NewPlanningDialog
      target={{ kind: "epic" }}
      close={close}
      created={vi.fn()}
    />
  );
  const { rerender, wrap } = await mount(dialog);
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Epic name" }),
    "Created draft",
  );
  await user.click(screen.getByRole("button", { name: "Create epic" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  rerender(wrap(<p>Closed</p>));
  rerender(wrap(dialog));
  expect(screen.getByRole("textbox", { name: "Epic name" })).toHaveValue("");
});
it("F02 repeated acceptance Save is single-flight and a newer draft survives acknowledgement", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const original = mockApi.updateStory.bind(mockApi);
  const update = vi
    .spyOn(mockApi, "updateStory")
    .mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });
  await mount(
    <StoryDrawer storyKey="JB-S2" close={vi.fn()} openTask={vi.fn()} />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("Agent plan"));
  const criterion = await screen.findByRole("textbox", { name: "Criterion 1" });
  fireEvent.change(criterion, { target: { value: "Submitted criterion" } });
  const save = screen.getByRole("button", { name: "Save acceptance" });
  act(() => {
    fireEvent.click(save);
    fireEvent.click(save);
  });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(save).toBeDisabled();
  expect(save).toHaveAttribute("aria-busy", "true");
  fireEvent.change(criterion, {
    target: { value: "Newer retained criterion" },
  });
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(save).toBeEnabled());
  expect(criterion).toHaveValue("Newer retained criterion");
  await user.click(save);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
});
it("F02 a failed acceptance save unlocks only for a deliberate retry", async () => {
  const update = vi
    .spyOn(mockApi, "updateStory")
    .mockRejectedValueOnce(new Error("Acceptance failed"));
  await mount(
    <StoryDrawer storyKey="JB-S2" close={vi.fn()} openTask={vi.fn()} />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("Agent plan"));
  const criterion = await screen.findByRole("textbox", { name: "Criterion 1" });
  fireEvent.change(criterion, { target: { value: "Retry criterion" } });
  const save = screen.getByRole("button", { name: "Save acceptance" });
  await user.click(save);
  await waitFor(() => expect(save).toBeEnabled());
  expect(criterion).toHaveValue("Retry criterion");
  expect(update).toHaveBeenCalledTimes(1);
  await user.click(save);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
});
it("F04 anchored epic menu navigates by arrows/Home/End, dismisses on Escape/outside and restores focus", async () => {
  await mount(
    <PlanPage
      epicKey="JB-E1"
      search={{}}
      openTask={vi.fn()}
      openStory={vi.fn()}
    />,
  );
  const trigger = await screen.findByRole("button", { name: "Epic menu" });
  const user = userEvent.setup();
  await user.click(trigger);
  const archive = screen.getByRole("menuitem", { name: "Archive" });
  const copy = screen.getByRole("menuitem", { name: "Copy MCP reference" });
  expect(archive).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(copy).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(archive).toHaveFocus();
  await user.keyboard("{End}");
  expect(copy).toHaveFocus();
  await user.keyboard("{Home}{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(
    screen.getByRole("menuitem", { name: "Copy MCP reference" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("heading", { name: "Plan" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it("F04 activating Copy dismisses the epic menu and restores its trigger", async () => {
  await mount(
    <PlanPage
      epicKey="JB-E1"
      search={{}}
      openTask={vi.fn()}
      openStory={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const trigger = await screen.findByRole("button", { name: "Epic menu" });
  await user.click(trigger);
  await user.click(
    screen.getByRole("menuitem", { name: "Copy MCP reference" }),
  );
  expect(copy).toHaveBeenCalledWith("jam://epic/JB-E1");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
