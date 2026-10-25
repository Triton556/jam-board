import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import { mockApi } from "../../lib/mock-bridge";
import { appQuery } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";
import {
  BrainButton,
  BrainDock,
  BrainDockController,
  useDockLayout,
} from "./BrainDockShell";
import { useBrainDock, useBrainState } from "./brain-store";

const loading = vi.hoisted(() => ({
  promise: Promise.resolve(),
  resolve: () => {},
  reject: (_reason: Error) => {},
  calls: 0,
}));
function delayChunk() {
  loading.promise = new Promise<void>((resolve, reject) => {
    loading.resolve = resolve;
    loading.reject = reject;
  });
}
vi.mock("./brain-panel-loader", async (original) => {
  const actual = await original<typeof import("./brain-panel-loader")>();
  return {
    loadDockPanel: async () => {
      loading.calls++;
      await loading.promise;
      return actual.loadDockPanel();
    },
  };
});
vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
function Harness() {
  const layout = useDockLayout();
  const app = useQuery(appQuery);
  const brain = useBrainDock();
  return (
    <div style={layout.style}>
      <BrainButton />
      {app.data?.jam && <BrainDockController projectId={app.data.jam.id} />}
      <button
        type="button"
        onClick={() =>
          brain.compose({
            text: "Prepared on a cold load",
            context: [
              {
                type: "board_ref",
                uri: "jam://task/JB-12",
                label: "JB-12",
                text: "Selected task",
              },
            ],
          })
        }
      >
        Compose
      </button>
      {layout.open && <BrainDock overlay={layout.overlay} />}
    </div>
  );
}
async function mount() {
  const root = createRootRoute({ component: Harness });
  const board = createRoute({ getParentRoute: () => root, path: "/board" });
  const router = createRouter({
    routeTree: root.addChildren([board]),
    history: createMemoryHistory({ initialEntries: ["/board"] }),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Brain chat · Ctrl+J" });
  await waitFor(() => expect(useBrainState.getState().projectId).toBeTruthy());
}
beforeEach(async () => {
  resetMockDock();
  await mockApi.resetDemo();
  useUiStore.setState({ brainDockOpen: false, brainDockWidth: 480 });
  useBrainState.setState({
    projectId: null,
    sessions: [],
    events: {},
    selected: { chat: null, terminal: null },
    tab: "chat",
    drafts: {},
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
    writable: true,
  });
  loading.calls = 0;
  delayChunk();
});
it("Ctrl+J opens and closes the reserved dock while its chunk is still pending", async () => {
  await mount();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(await screen.findByText("Loading brain dock…")).toBeVisible();
  expect(document.querySelector(".brain-dock-slot")).toHaveStyle({
    width: "480px",
  });
  expect(document.documentElement.style.getPropertyValue("--dock-width")).toBe(
    "480px",
  );
  expect(screen.queryByRole("button", { name: "Start chat" })).toBeNull();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(screen.queryByLabelText("Brain dock")).toBeNull();
  await act(async () => loading.resolve());
});
it("compose opens a pending dock and retains its draft and context until chat loads", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Compose" }));
  expect(await screen.findByText("Loading brain dock…")).toBeVisible();
  expect(document.querySelector(".brain-dock-slot")).toHaveStyle({
    width: "480px",
  });
  await act(async () => loading.resolve());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
  expect(
    await screen.findByRole(
      "textbox",
      { name: "Message the brain" },
      { timeout: 3000 },
    ),
  ).toHaveValue("Prepared on a cold load");
  expect(screen.getByRole("button", { name: "Remove JB-12" })).toBeVisible();
  const [session] = await mockDockApi.sessions();
  expect(session).toBeDefined();
  if (!session) throw new Error("Expected a chat session");
  expect(
    (await mockDockApi.history(session.id)).some(
      (e) => e.kind === "user_message",
    ),
  ).toBe(false);
});
it("a rejected dock chunk shows inline retry without losing reserved width or compose", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Compose" }));
    await screen.findByText("Loading brain dock…");
    await act(async () => loading.reject(new Error("Chunk unavailable")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load brain dock.",
    );
    expect(document.querySelector(".brain-dock-slot")).toHaveStyle({
      width: "480px",
    });
    delayChunk();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Loading brain dock…");
    await act(async () => loading.resolve());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(
      await screen.findByRole(
        "textbox",
        { name: "Message the brain" },
        { timeout: 3000 },
      ),
    ).toHaveValue("Prepared on a cold load");
    expect(loading.calls).toBe(2);
  } finally {
    error.mockRestore();
  }
});
