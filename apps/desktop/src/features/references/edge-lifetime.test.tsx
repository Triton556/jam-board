import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { EdgeLabelDialog } from "./EdgeLabelDialog";

vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({}) }));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
it("F08 edge old successful completion cannot close replacement editor or erase its draft", async () => {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  let release!: (value: never) => void;
  const gate = new Promise<never>((r) => (release = r));
  vi.spyOn(mockApi, "updateRefEdge").mockImplementationOnce(() => gate);
  const close = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined),
    archived = vi.fn();
  const tree = (id: string, label: string) => (
    <QueryClientProvider client={client}>
      <EdgeLabelDialog
        key={id}
        edge={{ id, label }}
        close={close}
        refresh={refresh}
        archived={archived}
      />
    </QueryClientProvider>
  );
  const view = render(tree("first", "First label"));
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Label" }),
    " changed{Enter}",
  );
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  view.rerender(tree("second", "Second label"));
  await user.type(screen.getByRole("textbox", { name: "Label" }), " retained");
  await act(async () => release({} as never));
  expect(close).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue(
    "Second label retained",
  );
});
it("F08 edge project ABA prevents late canvas refresh and completion", async () => {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  let release!: (value: never) => void;
  const gate = new Promise<never>((r) => (release = r));
  vi.spyOn(mockApi, "updateRefEdge").mockImplementationOnce(() => gate);
  const close = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={client}>
      <EdgeLabelDialog
        edge={{ id: "edge", label: "Draft" }}
        close={close}
        refresh={refresh}
        archived={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Label" }),
    " retained{Enter}",
  );
  await act(async () => {
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "other-project" },
    });
    client.setQueryData(["app"], app);
  });
  await act(async () => release({} as never));
  await screen.findByText(/project or form target changed/);
  expect(refresh).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue(
    "Draft retained",
  );
});
it("F08 confirmed edge save with failed refresh retains a copyable label and focused recovery, no replay", async () => {
  const app = await mockApi.appState();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const call = vi
    .spyOn(mockApi, "updateRefEdge")
    .mockResolvedValue({} as never);
  const close = vi.fn(),
    refresh = vi.fn().mockRejectedValue(new Error("Synthetic read failed"));
  render(
    <QueryClientProvider client={client}>
      <EdgeLabelDialog
        edge={{ id: "edge", label: "Draft" }}
        close={close}
        refresh={refresh}
        archived={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Label" }),
    " retained{Enter}",
  );
  await screen.findByText(/Saved, but the canvas could not refresh/);
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Label" })).toHaveAttribute(
    "readonly",
  );
  expect(screen.getByRole("textbox", { name: "Label" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save label" })).toBeDisabled();
  expect(call).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});
