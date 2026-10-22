import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { CommandPalette } from "./CommandPalette";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
beforeEach(async () => {
  await mockApi.resetDemo();
  navigate.mockClear();
});
afterEach(() => vi.restoreAllMocks());
it.each(["mcp", "config", "agent", "codex"])(
  "routes %s searches to guarded Agents setup without building/copying a config",
  async (query) => {
    const user = userEvent.setup(),
      close = vi.fn();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText");
    const runtime = vi
      .spyOn(mockApi, "runtimeInfo")
      .mockRejectedValue(new Error("Synthetic runtime unavailable"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <CommandPalette close={close} newTask={vi.fn()} toggleTheme={vi.fn()} />
      </QueryClientProvider>,
    );
    await user.type(
      screen.getByRole("combobox", { name: "Search commands" }),
      query,
    );
    const action = await screen.findByRole("option", {
      name: "Set up agent connection (MCP)…",
    });
    await user.click(action);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/settings",
        search: { section: "Agents" },
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(clipboard).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
  },
);
