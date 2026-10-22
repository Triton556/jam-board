import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { EditReferenceDialog } from "./dialogs";
import { ReferenceActions } from "./Nodes";
import { CanvasContext, type CanvasRuntime } from "./runtime";

it.each([
  ["caption", "Edit caption", "Edit reference"],
  ["tags", "Tags", "Reference tags"],
  ["link", "Link to…", "Link reference"],
] as const)(
  "RF04 actual %s dialog returns to its visible Actions opener",
  async (mode, action, title) => {
    await mockApi.resetDemo();
    mockApi.setLatency(0);
    const item = await mockApi.addReference({
      kind: "link",
      url: "https://example.test/focus",
      title: "Focus fixture",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["app"], await mockApi.appState());
    const save = vi.fn().mockResolvedValue(undefined);
    const link = vi.fn().mockResolvedValue(undefined);
    function View() {
      const [open, setOpen] = useState(false);
      const runtime: CanvasRuntime = {
        edit: () => setOpen(true),
        archive: vi.fn(),
        resize: vi.fn(),
        resizeFrame: vi.fn(),
        collapse: vi.fn(),
        editFrame: vi.fn(),
        open: vi.fn(),
        lightbox: vi.fn(),
        edgeLabel: vi.fn(),
        caption: vi.fn(),
      };
      return (
        <CanvasContext.Provider value={runtime}>
          <ReferenceActions item={item} links={[]} />
          {open && (
            <EditReferenceDialog
              item={item}
              mode={mode}
              targets={[]}
              close={() => setOpen(false)}
              save={save}
              link={link}
            />
          )}
        </CanvasContext.Provider>
      );
    }
    const router = createRouter({
      routeTree: createRootRoute({ component: View }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const summary = await screen.findByLabelText("Actions for Focus fixture");
    await userEvent.click(summary);
    await userEvent.click(
      screen.getByRole("button", { name: action, exact: true }),
    );
    // The modal owns initial focus. Child React autoFocus must not replace its
    // captured return target with an input that disappears on close.
    expect(screen.getByRole("dialog", { name: title })).toHaveFocus();
    if (mode === "caption")
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
        item.title,
      );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(summary).toHaveFocus();
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(save).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  },
);
