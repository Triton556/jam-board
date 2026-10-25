// DOM controller/real edge-button probe; ReactFlow geometry is substituted, not browser gesture evidence.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Edge, EdgeTypes } from "@xyflow/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => undefined,
  useBlocker: () => ({}),
}));
vi.mock("@xyflow/react", async (original) => {
  const real = await original<typeof import("@xyflow/react")>();
  return {
    ...real,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => children,
    ReactFlow: ({
      edges,
      edgeTypes,
    }: {
      edges: Edge[];
      edgeTypes: EdgeTypes;
    }) => (
      <div>
        {edges.map((edge) => {
          const Edge = edgeTypes.reference;
          if (!Edge) throw new Error("Missing edge renderer");
          return (
            <Edge
              key={edge.id}
              type="reference"
              id={edge.id}
              source={edge.source}
              target={edge.target}
              label={edge.label}
              data={edge.data}
              selectable={true}
              deletable={true}
              sourceX={0}
              sourceY={0}
              targetX={100}
              targetY={100}
              sourcePosition={real.Position.Right}
              targetPosition={real.Position.Left}
            />
          );
        })}
      </div>
    ),
  };
});

import { ReferencesPage } from "./ReferencesPage";

beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ toasts: [] });
});
it("F08 edge: real label button opens editor; repeated Enter writes once; Escape retains rejection and draft", async () => {
  const a = await mockApi.addReference({
    kind: "note",
    title: "A",
    text: "a",
    x: 0,
    y: 0,
  });
  const b = await mockApi.addReference({
    kind: "note",
    title: "B",
    text: "b",
    x: 200,
    y: 200,
  });
  const edge = await mockApi.createRefEdge(a.id, b.id, "Probe edge");
  let reject!: (e: Error) => void;
  const gate = new Promise<never>((_, r) => (reject = r));
  const call = vi
    .spyOn(mockApi, "updateRefEdge")
    .mockImplementation(() => gate);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReferencesPage />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Probe edge" }));
  await user.type(
    screen.getByRole("textbox", { name: "Label" }),
    " changed{Enter}{Enter}",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenLastCalledWith(edge.id, "Probe edge changed");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Edge label" })).toBeVisible();
  await act(async () =>
    reject(new Error("Synthetic unconfirmed edge outcome")),
  );
  await screen.findByText(/Could not confirm whether the label was saved/);
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue(
    "Probe edge changed",
  );
  expect(screen.getByRole("button", { name: "Save label" })).toBeDisabled();
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveAttribute(
    "readonly",
  );
});
it("F08 page keeps a confirmed label after a real query refresh fails; retry refresh never rewrites", async () => {
  const a = await mockApi.addReference({ kind: "note", text: "A" });
  const b = await mockApi.addReference({ kind: "note", text: "B" });
  await mockApi.createRefEdge(a.id, b.id, "Original label");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <ReferencesPage />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Original label" }),
  );
  const write = vi.spyOn(mockApi, "updateRefEdge");
  vi.spyOn(mockApi, "referenceCanvas").mockRejectedValueOnce(
    Error("read failed"),
  );
  await userEvent.clear(screen.getByRole("textbox", { name: "Label" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Label" }),
    "Saved label",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save label" }));
  await screen.findByText(/Saved, but the canvas could not refresh/);
  expect(screen.getByRole("dialog", { name: "Edge label" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue(
    "Saved label",
  );
  expect(screen.getByRole("button", { name: "Save label" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Edge label" })).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "Saved label" })).toBeVisible();
  expect(write).toHaveBeenCalledTimes(1);
});
