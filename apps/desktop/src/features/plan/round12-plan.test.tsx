import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as imports from "../../lib/import-plan-api";
import { mockApi } from "../../lib/mock-bridge";
import { MockImport } from "../../lib/mock-import";
import { JamError } from "../../lib/types";
import { EpicPalette } from "./EpicPalette";
import { ImportPlanDialog } from "./ImportPlanDialog";
import { importFieldLabel, importFieldLabels } from "./import-field-labels";
import {
  MovePlanDialog,
  storyMoveBlockedReason,
  TaskMoveEntry,
  taskMoveBlockedReason,
} from "./MovePlanDialog";
import { NewPlanningDialog } from "./NewPlanningDialog";
import { StoryDrawer } from "./StoryDrawer";

afterEach(() => vi.restoreAllMocks());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/plan/JB-E1",
  useBlocker: () => ({}),
}));
vi.mock("../../lib/import-plan-api", async (original) => ({
  ...(await original<typeof import("../../lib/import-plan-api")>()),
  capturePlanContext: vi.fn(),
  assertPlanContext: vi.fn(),
  importPlan: vi.fn(),
  undoImport: vi.fn(),
  listImportBatches: vi.fn(),
  importBatchesQuery: vi.fn(),
  planMoves: { story: vi.fn(), task: vi.fn() },
}));
const context: imports.PlanContext = { projectId: "test", folder: null };
let engine: MockImport;
beforeEach(async () => {
  vi.resetAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  engine = new MockImport();
  vi.mocked(imports.capturePlanContext).mockResolvedValue(context);
  vi.mocked(imports.assertPlanContext).mockResolvedValue(undefined);
  vi.mocked(imports.importPlan).mockImplementation((input) =>
    engine.importPlan(input),
  );
  vi.mocked(imports.undoImport).mockImplementation((id) =>
    engine.undoImport(id),
  );
  vi.mocked(imports.listImportBatches).mockImplementation(() =>
    engine.listImportBatches(),
  );
  const batchQueryKey: (string | imports.PlanContext["folder"])[] = [
    "imports",
    context.projectId,
    context.folder,
  ];
  vi.mocked(imports.importBatchesQuery).mockReturnValue(
    queryOptions({
      queryKey: batchQueryKey,
      queryFn: () => engine.listImportBatches(),
    }),
  );
});
function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}
async function chooseFile(
  source = "# Demo plan {#demo}\n## Demo story {#demo/story}\n- File wording {#demo/conflict}",
) {
  const field = await screen.findByLabelText("Plan file");
  await waitFor(() => expect(field).toBeEnabled());
  const file = new File([source], "plan.md", { type: "text/markdown" });
  Object.defineProperty(file, "text", { value: async () => source });
  fireEvent.change(field, { target: { files: [file] } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled(),
  );
}
it("walks Choose → Preview, defaults conflicts to Keep board, applies Use file and undoes", async () => {
  const user = userEvent.setup();
  mount(<ImportPlanDialog close={vi.fn()} />);
  await chooseFile();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  const conflict = await screen.findByText("Conflicts (1)");
  expect(conflict.closest("details")).toHaveAttribute("open");
  expect(screen.getByRole("radio", { name: "Keep board" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await user.click(screen.getByRole("radio", { name: "Use file" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText(/Imported:/)).toBeInTheDocument();
  expect(imports.importPlan).toHaveBeenLastCalledWith(
    expect.objectContaining({ dryRun: false, overwrite: ["demo/conflict"] }),
    context,
  );
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    await screen.findByText(/Import undone\. \d+ undone, 0 kept\./),
  ).toBeInTheDocument();
});
it("Keep board sends no overwrite approvals; preview Back preserves the chosen file", async () => {
  const user = userEvent.setup();
  mount(<ImportPlanDialog close={vi.fn()} />);
  await chooseFile();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await user.click(await screen.findByRole("button", { name: "Back" }));
  expect(screen.getByText("plan.md")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await user.click(await screen.findByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(imports.importPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ overwrite: [] }),
      context,
    ),
  );
});
it("shows a relative conflict date with an absolute tooltip and a readable Title label", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-31T02:00:00Z"));
  const user = userEvent.setup();
  mount(<ImportPlanDialog close={vi.fn()} />);
  await chooseFile();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText(/changed by Board owner/)).toHaveTextContent(
    "changed by Board owner · 2h ago",
  );
  const date = screen.getByText("2h ago", { selector: "time" });
  expect(date).toHaveAttribute("datetime", "2026-10-31T00:00:00Z");
  expect(date).toHaveAttribute(
    "title",
    new Date("2026-10-31T00:00:00Z").toLocaleString("en"),
  );
  expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "title" }),
  ).not.toBeInTheDocument();
});
it("labels imported fields consistently without exposing storage keys", () => {
  expect(
    [
      "title",
      "goalMd",
      "doneWhenMd",
      "outcomeMd",
      "description",
      "priority",
      "tags",
      "estimate",
      "dueAt",
    ].map(importFieldLabel),
  ).toEqual([
    "Title",
    "Goal",
    "Done when",
    "Outcome",
    "Description",
    "Priority",
    "Tags",
    "Estimate",
    "Due date",
  ]);
  for (const label of Object.values(importFieldLabels))
    expect(label).not.toMatch(/Md$|_/u);
  expect(importFieldLabel("storyKey")).toBe("Story key");
});
it("shows generated-ref warning and errors for malformed Markdown without losing the file chooser", async () => {
  mount(<ImportPlanDialog close={vi.fn()} />);
  await chooseFile("# New epic\n## Story\n- Task");
  expect(
    screen.getByText("Add {#ref} ids to keep updates stable if titles change."),
  ).toBeInTheDocument();
  const file = new File(["Preface"], "bad.md");
  Object.defineProperty(file, "text", { value: async () => "Preface" });
  fireEvent.change(screen.getByLabelText("Plan file"), {
    target: { files: [file] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Line 1:");
  expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
});
it("uses the noChanges message and omits Undo for a no-op", async () => {
  engine = new MockImport([]);
  await engine.importPlan({ epics: [{ externalRef: "new", title: "New" }] });
  const user = userEvent.setup();
  mount(<ImportPlanDialog close={vi.fn()} />);
  await chooseFile("# New {#new}");
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await user.click(await screen.findByRole("button", { name: "Apply" }));
  expect(
    await screen.findByText(
      "Nothing to import — the board already matches the file.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});
it("lists history and disables a second Undo after success", async () => {
  await engine.importPlan({ epics: [{ title: "New", externalRef: "new" }] });
  const user = userEvent.setup();
  mount(<ImportPlanDialog history close={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Undone")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});
it("retains the preview after an apply failure and retries the same request", async () => {
  const user = userEvent.setup();
  mount(<ImportPlanDialog close={vi.fn()} />);
  await chooseFile();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByText("Conflicts (1)");
  vi.mocked(imports.importPlan).mockRejectedValueOnce(
    new Error("Write uncertain"),
  );
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Write uncertain");
  const request = vi
    .mocked(imports.importPlan)
    .mock.calls.at(-1)?.[0].requestId;
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(imports.importPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: request }),
      context,
    ),
  );
});
it("guards duplicate apply and dismissal until a dispatched import settles", async () => {
  const close = vi.fn(),
    user = userEvent.setup();
  mount(<ImportPlanDialog close={close} />);
  await chooseFile();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByText("Conflicts (1)");
  let finish!: (report: imports.ImportReport) => void;
  vi.mocked(imports.importPlan).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  finish(
    await engine.importPlan({ epics: [{ title: "New", externalRef: "new" }] }),
  );
  await screen.findByText(/Imported:/);
});
it("renders six palette labels, exact tooltips and the neutral helper", async () => {
  const choose = vi.fn(),
    user = userEvent.setup();
  mount(<EpicPalette value="m2" choose={choose} />);
  for (let i = 1; i <= 6; i++)
    expect(screen.getByRole("button", { name: `Color ${i}` })).toHaveAttribute(
      "title",
      `Palette color ${i}`,
    );
  expect(
    screen.getByText(
      "Only helps tell epics apart. Doesn't mean anything else.",
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Color 6" }));
  expect(choose).toHaveBeenCalledWith("m6");
});
it("retains the new epic's color through an interrupted form mount", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const form = () => (
    <QueryClientProvider client={client}>
      <NewPlanningDialog
        target={{ kind: "epic" }}
        close={vi.fn()}
        created={vi.fn()}
      />
    </QueryClientProvider>
  );
  const user = userEvent.setup(),
    first = render(form());
  await user.click(screen.getByRole("button", { name: "Color 5" }));
  first.unmount();
  render(form());
  expect(screen.getByRole("button", { name: "Color 5" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("story picker searches epics, disables current, dispatches the actual move contract", async () => {
  const story = (await mockApi.listStories())[0];
  if (!story) throw new Error("Need story");
  const destination = (await mockApi.listEpics()).find(
    (e) => e.id !== story.epicId,
  );
  if (!destination) throw new Error("Need second epic");
  vi.mocked(imports.planMoves.story).mockResolvedValue(
    story as Awaited<ReturnType<typeof imports.planMoves.story>>,
  );
  const moved = vi.fn(),
    user = userEvent.setup();
  mount(
    <MovePlanDialog
      target={{ type: "story", story }}
      close={vi.fn()}
      moved={moved}
    />,
  );
  expect(
    await screen.findByRole("button", { name: /Current epic/ }),
  ).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: "Search epics" }),
    destination.title,
  );
  await user.click(
    screen.getByRole("button", { name: new RegExp(destination.key) }),
  );
  await waitFor(() =>
    expect(imports.planMoves.story).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        key: story.key,
        toEpicKey: destination.key,
        beforeKey: null,
        afterKey: null,
      }),
    ),
  );
  expect(moved).toHaveBeenCalledWith(
    expect.objectContaining({ to: destination.key }),
  );
});
it("blocks StoryDrawer moves while a child is in progress", async () => {
  const all = Object.values(await mockApi.listBoardTasks()).flat(),
    blocked = all.find((t) => t.status === "in_progress");
  if (!blocked) throw new Error("Need working task");
  const task = await mockApi.getTask(blocked.key);
  mount(
    <StoryDrawer
      storyKey={task.story.key}
      close={vi.fn()}
      openTask={vi.fn()}
    />,
  );
  const button = await screen.findByRole("button", {
    name: "Move to epic…",
    hidden: true,
  });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", storyMoveBlockedReason);
});
async function moveFreshStory() {
  const story = await mockApi.createStory({
    epicKey: "JB-E1",
    title: "Undo fixture",
  });
  const destination = (await mockApi.listEpics()).find(
    (epic) => epic.key === "JB-E2",
  );
  if (!destination) throw new Error("Need second epic");
  const result = {
    ...story,
    epicId: destination.id,
    updatedAt: "2026-11-01T03:00:00Z",
  };
  vi.mocked(imports.planMoves.story).mockResolvedValueOnce(
    result as Awaited<ReturnType<typeof imports.planMoves.story>>,
  );
  const user = userEvent.setup();
  mount(
    <StoryDrawer storyKey={story.key} close={vi.fn()} openTask={vi.fn()} />,
  );
  await user.click(await screen.findByLabelText("Story menu"));
  await user.click(screen.getByRole("button", { name: "Move to epic…" }));
  const dialog = await screen.findByRole("dialog", { name: "Move to epic" });
  await user.click(
    await within(dialog).findByRole("button", { name: /JB-E2/ }),
  );
  await screen.findByText("Moved to JB-E2");
  return { user, story, result };
}
it("StoryDrawer Undo uses the returned story version and a stable retry request ID", async () => {
  const { user, story, result } = await moveFreshStory();
  expect(imports.planMoves.story).toHaveBeenLastCalledWith(
    context,
    expect.objectContaining({ expectedUpdatedAt: story.updatedAt }),
  );
  vi.mocked(imports.planMoves.story).mockRejectedValueOnce(
    new Error("Connection lost"),
  );
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Can't undo: Connection lost",
  );
  const attempted = vi.mocked(imports.planMoves.story).mock.calls.at(-1)?.[1];
  expect(attempted).toMatchObject({
    key: story.key,
    toEpicKey: "JB-E1",
    expectedUpdatedAt: result.updatedAt,
    beforeKey: null,
    afterKey: null,
    requestId: expect.any(String),
  });
  vi.mocked(imports.planMoves.story).mockResolvedValueOnce(
    story as Awaited<ReturnType<typeof imports.planMoves.story>>,
  );
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Move undone.")).toBeInTheDocument();
  expect(imports.planMoves.story).toHaveBeenLastCalledWith(context, attempted);
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});
it("StoryDrawer stale Undo explains the conflict and retains the captured version", async () => {
  const { user, story, result } = await moveFreshStory();
  const newer = await mockApi.updateStory(story.key, {
    title: "Changed after moving",
  });
  expect(newer.updatedAt).not.toBe(result.updatedAt);
  vi.mocked(imports.planMoves.story).mockRejectedValueOnce(
    new JamError("conflict", "Generic backend conflict"),
  );
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Can't undo: the story changed after the move.",
  );
  expect(imports.planMoves.story).toHaveBeenLastCalledWith(
    context,
    expect.objectContaining({
      key: story.key,
      expectedUpdatedAt: result.updatedAt,
    }),
  );
  expect(screen.queryByText("Move undone.")).not.toBeInTheDocument();
});
it("task picker groups stories by epic and Undo uses the move result validators", async () => {
  const task = await mockApi.getTask("JB-2"),
    stories = await mockApi.listStories(),
    destination = stories.find((s) => s.id !== task.storyId);
  if (!destination) throw new Error("Need another story");
  task.status = "backlog";
  const movedTask = {
    ...task,
    updatedAt: "move-result-version",
    claimGeneration: "move-result-generation",
  };
  vi.mocked(imports.planMoves.task).mockResolvedValue(
    movedTask as Awaited<ReturnType<typeof imports.planMoves.task>>,
  );
  const user = userEvent.setup();
  mount(<TaskMoveEntry task={task} />);
  await user.click(screen.getByRole("button", { name: "Move to story…" }));
  const dialog = await screen.findByRole("dialog", { name: "Move to story" });
  await user.click(
    await within(dialog).findByRole("button", {
      name: new RegExp(destination.key),
    }),
  );
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(imports.planMoves.task).toHaveBeenLastCalledWith(
      context,
      expect.objectContaining({
        toStoryKey: task.story.key,
        expectedUpdatedAt: "move-result-version",
        expectedClaimGeneration: "move-result-generation",
      }),
    ),
  );
});
it.each(["in_progress", "review", "done"])(
  "disables task moves in %s with the reason",
  async (status) => {
    const task = await mockApi.getTask("JB-2");
    task.status = status;
    mount(<TaskMoveEntry task={task} />);
    expect(
      screen.getByRole("button", { name: "Move to story…" }),
    ).toBeDisabled();
    expect(screen.getByText(taskMoveBlockedReason)).toBeInTheDocument();
  },
);
