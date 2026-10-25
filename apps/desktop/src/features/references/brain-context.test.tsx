import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeChange } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { draftKey, useBrainContext, useBrainState } from "../brain/brain-store";
import { referenceBrainContext } from "./brain-context";
import { type ItemNode, ReferenceActions } from "./Nodes";
import { ReferencesPage } from "./ReferencesPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => undefined,
  useBlocker: () => ({}),
}));
// DOM contract probe: substitute only XYFlow's renderer/selection input, not the
// canvas state, reference menu, dock store, context publication or command APIs.
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  ReactFlow: ({
    nodes,
    onNodesChange,
    children,
  }: {
    nodes: ItemNode[];
    onNodesChange(changes: NodeChange[]): void;
    children: ReactNode;
  }) => (
    <div>
      {nodes
        .filter((node) => node.type === "reference")
        .map((node) => (
          <div key={node.id}>
            <button
              type="button"
              onClick={() =>
                onNodesChange([{ type: "select", id: node.id, selected: true }])
              }
            >
              Select {node.id}
            </button>
            <ReferenceActions item={node.data.item} links={node.data.links} />
          </div>
        ))}
      <button
        type="button"
        onClick={() =>
          onNodesChange(
            nodes.map((node) => ({
              type: "select",
              id: node.id,
              selected: false,
            })),
          )
        }
      >
        Clear selection
      </button>
      {children}
    </div>
  ),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useBrainContext.setState({ sources: {} });
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
async function mount() {
  const first = await mockApi.addReference({
    kind: "note",
    title: "Lighting",
    text: "Keep blue shadows",
    x: 0,
    y: 0,
  });
  const second = await mockApi.addReference(
    { kind: "note", text: "Second idea", x: 300, y: 0 },
    true,
  );
  await mockApi.linkReference(first.id, "JB-7");
  const canvas = await mockApi.referenceCanvas();
  vi.spyOn(mockApi, "referenceCanvas").mockResolvedValue({
    ...canvas,
    items: [first, second],
    frames: [],
  });
  const app = await mockApi.appState();
  useBrainState.setState({ projectId: app.jam?.id ?? null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const rendered = render(
    <QueryClientProvider client={client}>
      <ReferencesPage />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: `Select ${first.id}` });
  return { ...rendered, first, second, app, client };
}
it("H-R03 context keeps bounded note/media source text and linked keys", async () => {
  const note = await mockApi.addReference(
    {
      kind: "note",
      text: `${"💡".repeat(70)}\n${"x".repeat(700)}`,
      x: 0,
      y: 0,
    },
    true,
  );
  const context = referenceBrainContext(note, ["JB-7", "JB-7", "JB-S1"]);
  expect(Array.from(context.label)).toHaveLength(60);
  expect(context.label).toBe("💡".repeat(60));
  expect(context.text).toBe(
    `${Array.from(note.captionMd).slice(0, 600).join("")}\nLinked: JB-7, JB-S1`,
  );
  expect(
    referenceBrainContext({
      ...note,
      kind: "asset",
      title: "Snow texture",
      captionMd: "Texture caption",
    }),
  ).toMatchObject({ label: "Snow texture", text: "Texture caption" });
});
it("H-R03/R07 selection publishes canvas chips, Ask brain (2) stages them; deselection and unmount clear only canvas", async () => {
  const { first, second, unmount } = await mount();
  const other = {
    type: "board_ref" as const,
    uri: "jam://task/JB-7",
    label: "JB-7",
    text: "Task context",
  };
  useBrainContext.getState().publish("task", [other]);
  await userEvent.click(
    screen.getByRole("button", { name: `Select ${first.id}` }),
  );
  await waitFor(() =>
    expect(useBrainContext.getState().sources.canvas).toEqual([
      referenceBrainContext(first, ["JB-7"]),
    ]),
  );
  expect(screen.queryByRole("button", { name: "Ask brain (2)" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: `Select ${second.id}` }),
  );
  const ask = await screen.findByRole("button", { name: "Ask brain (2)" });
  expect(ask).toHaveClass("secondary");
  const toolbar = screen.getByRole("toolbar", { name: "Canvas tools" });
  expect(
    within(toolbar)
      .getByRole("button", { name: "Connect" })
      .compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await userEvent.click(ask);
  expect(useBrainState.getState().drafts[draftKey()]).toEqual({
    text: "",
    context: [
      referenceBrainContext(first, ["JB-7"]),
      referenceBrainContext(second),
    ],
  });
  expect(useUiStore.getState().brainDockOpen).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Clear selection" }),
  );
  await waitFor(() =>
    expect(useBrainContext.getState().sources.canvas).toEqual([]),
  );
  expect(screen.queryByRole("button", { name: "Ask brain (2)" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: `Select ${first.id}` }),
  );
  await waitFor(() =>
    expect(useBrainContext.getState().sources.canvas).toHaveLength(1),
  );
  unmount();
  expect(useBrainContext.getState().sources.canvas).toEqual([]);
  expect(useBrainContext.getState().sources.task).toEqual([other]);
});
it("H-R03 Ask brain about this stages the saved note and does not mutate the board", async () => {
  const { first } = await mount();
  const before = mockApi.calls.length;
  await userEvent.click(screen.getByLabelText("Actions for Lighting"));
  const menu = screen
    .getByLabelText("Actions for Lighting")
    .closest("details") as HTMLDetailsElement;
  await within(menu).findByRole("button", { name: "Open JB-7" });
  await userEvent.click(
    within(menu).getByRole("button", { name: "Ask brain about this" }),
  );
  expect(useBrainState.getState().drafts[draftKey()]).toEqual({
    text: "",
    context: [referenceBrainContext(first, ["JB-7"])],
  });
  expect(
    mockApi.calls
      .slice(before)
      .filter((call) =>
        /^(add_reference|update_reference|create_task|link_reference|canvas_archive|start_agent|prompt_agent)/.test(
          call.command,
        ),
      ),
  ).toEqual([]);
});
