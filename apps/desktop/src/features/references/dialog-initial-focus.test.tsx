import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { AddReferenceDialog, FrameDialog } from "./dialogs";

vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({}) }));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
it.each(["link", "note", "frame"] as const)(
  "initial %s dialog focus lands on Title after readiness",
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Deliberately start without cached app data to exercise a field initially disabled.
    render(
      <QueryClientProvider client={client}>
        {kind === "frame" ? (
          <FrameDialog epics={[]} close={vi.fn()} save={vi.fn()} />
        ) : (
          <AddReferenceDialog kind={kind} close={vi.fn()} save={vi.fn()} />
        )}
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus(),
    );
  },
);
