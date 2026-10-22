import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { EdgeLabelDialog } from "./references/EdgeLabelDialog";
import { TaskDrawer } from "./task/TaskDrawer";
import { MemberDialog } from "./team/TeamPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
afterEach(() => vi.restoreAllMocks());

it.each(
  (["archive", "member", "edge"] as const).flatMap((kind) =>
    (["switch", "no-project"] as const).map((change) => ({ kind, change })),
  ),
)(
  "AS01 $kind: $change before dispatch is known not sent, not an uncertain write",
  async ({ kind, change }) => {
    mockApi.setLatency(0);
    await mockApi.resetDemo();
    const app = await mockApi.appState();
    const task = await mockApi.createTask({
      title: "Dispatch probe",
      status: "backlog",
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["app"], app);
    const call =
      kind === "archive"
        ? vi.spyOn(mockApi, "archiveTask")
        : kind === "member"
          ? vi.spyOn(mockApi, "createMember")
          : vi.spyOn(mockApi, "updateRefEdge");
    const close = vi.fn();
    render(
      <QueryClientProvider client={client}>
        {kind === "archive" ? (
          <TaskDrawer taskKey={task.key} close={close} />
        ) : kind === "member" ? (
          <MemberDialog close={close} />
        ) : (
          <EdgeLabelDialog
            edge={{ id: "captured", label: "Original" }}
            close={close}
            refresh={async () => {}}
            archived={() => {}}
          />
        )}
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    if (kind === "archive") {
      await screen.findByRole("textbox", { name: "Task title" });
      await user.click(screen.getByRole("button", { name: "Task actions" }));
      await user.click(screen.getByRole("button", { name: "Archive" }));
    }
    const dialog = screen.getByRole("dialog", {
      name:
        kind === "archive"
          ? "Archive task"
          : kind === "member"
            ? "Add human"
            : "Edge label",
    });
    const input = within(dialog).getByRole("textbox", {
      name:
        kind === "archive"
          ? "Archive reason"
          : kind === "member"
            ? "Name"
            : "Label",
    });
    await user.clear(input);
    await user.type(input, "Retained intent");
    let scheduled = false;
    const stop = client.getMutationCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.action.type === "pending" &&
        !scheduled
      ) {
        scheduled = true;
        // A real asynchronous cache change between intent and mutation dispatch.
        queueMicrotask(() =>
          client.setQueryData(["app"], {
            ...app,
            jam:
              change === "switch" ? { ...app.jam, id: "other-project" } : null,
          }),
        );
      }
    });
    await user.click(
      within(dialog).getByRole("button", {
        name:
          kind === "archive"
            ? "Archive"
            : kind === "member"
              ? "Save teammate"
              : "Save label",
      }),
    );
    await within(dialog).findByText(/before this write was sent/);
    expect(within(dialog).queryByText(/outcome is unconfirmed/)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(input).toHaveValue("Retained intent");
    expect(input).toHaveAttribute("readonly");
    stop();
    client.clear();
  },
);
