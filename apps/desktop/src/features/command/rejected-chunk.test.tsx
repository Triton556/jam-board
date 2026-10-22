import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { expect, it, vi } from "vitest";

vi.mock("./CommandPalette", async () => {
  throw new Error("Synthetic palette chunk unavailable");
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { CommandCenter } from "./CommandCenter";

class AncestorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">Ancestor caught palette chunk failure</p>
    ) : (
      this.props.children
    );
  }
}
it("F11: chunk rejection stays local, Close works, reopening cached failure remains recoverable", async () => {
  const noise = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <AncestorBoundary>
        <CommandCenter newTask={vi.fn()} toggleTheme={vi.fn()} />
      </AncestorBoundary>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Search and commands" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unsaved drafts",
    );
    expect(screen.getByRole("button", { name: "Reload app" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Search and commands" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Could not load search and commands",
      }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Search and commands" }),
    ).toBeVisible();
  } finally {
    noise.mockRestore();
  }
});
