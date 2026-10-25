// AS01/F08: actual router blockers and dialog focus, not a mocked useBlocker.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { EdgeLabelDialog } from "./references/EdgeLabelDialog";
import { TaskDrawer } from "./task/TaskDrawer";
import { MemberDialog } from "./team/TeamPage";

afterEach(() => vi.restoreAllMocks());
it.each(["archive", "member", "edge"] as const)(
  "AS01/F08 %s: actual navigation stays put during a write; failure retains focus/text and restores deliberate dismissal",
  async (kind) => {
    await mockApi.resetDemo();
    mockApi.setLatency(0);
    const task = await mockApi.createTask({
      title: "Route probe",
      status: "backlog",
    });
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, no) => {
      reject = no;
    });
    const call =
      kind === "archive"
        ? vi.spyOn(mockApi, "archiveTask").mockReturnValue(pending)
        : kind === "member"
          ? vi.spyOn(mockApi, "createMember").mockReturnValue(pending)
          : vi.spyOn(mockApi, "updateRefEdge").mockReturnValue(pending);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["app"], await mockApi.appState());
    function Editor() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open editor
          </button>
          {open &&
            (kind === "archive" ? (
              <TaskDrawer taskKey={task.key} close={() => setOpen(false)} />
            ) : kind === "member" ? (
              <MemberDialog close={() => setOpen(false)} />
            ) : (
              <EdgeLabelDialog
                edge={{ id: "captured-edge", label: "Original" }}
                close={() => setOpen(false)}
                refresh={async () => {}}
                archived={() => {}}
              />
            ))}
        </>
      );
    }
    const root = createRootRoute({
      component: () => (
        <QueryClientProvider client={client}>
          <Outlet />
        </QueryClientProvider>
      ),
    });
    const editor = createRoute({
      getParentRoute: () => root,
      path: "/board",
      component: Editor,
    });
    const other = createRoute({
      getParentRoute: () => root,
      path: "/projects",
      component: () => <h1>Other route</h1>,
    });
    const router = createRouter({
      routeTree: root.addChildren([editor, other]),
      history: createMemoryHistory({ initialEntries: ["/board"] }),
    });
    render(<RouterProvider router={router} />);
    const user = userEvent.setup(),
      opener = await screen.findByRole("button", { name: "Open editor" });
    await user.click(opener);
    if (kind === "archive") {
      await screen.findByRole("textbox", { name: "Task title" });
      await user.click(screen.getByRole("button", { name: "Task actions" }));
      await user.click(screen.getByRole("button", { name: "Archive" }));
    }
    const title =
      kind === "archive"
        ? "Archive task"
        : kind === "member"
          ? "Add human"
          : "Edge label";
    const dialog = screen.getByRole("dialog", { name: title });
    const input = within(dialog).getByRole("textbox", {
      name:
        kind === "archive"
          ? "Archive reason"
          : kind === "member"
            ? "Name"
            : "Label",
    });
    await user.clear(input);
    await user.type(input, "Retained draft");
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
    await waitFor(() => expect(call).toHaveBeenCalledOnce());
    await act(async () => {
      void router.navigate({ to: "/projects" });
    });
    await user.keyboard("{Escape}");
    expect(router.state.location.pathname).toBe("/board");
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("status")).toHaveFocus();
    await act(async () => reject(new Error("Synthetic uncertain result")));
    await within(dialog).findByText(/Could not confirm whether/);
    expect(input).toHaveValue("Retained draft");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveFocus();
    expect(call).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    if (kind === "archive") {
      expect(screen.getByRole("textbox", { name: "Task title" })).toBeVisible();
      await user.keyboard("{Escape}");
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
    await act(async () => {
      await router.navigate({ to: "/projects" });
    });
    expect(
      await screen.findByRole("heading", { name: "Other route" }),
    ).toBeVisible();
    expect(call).toHaveBeenCalledOnce();
  },
);
