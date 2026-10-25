import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IconButton, Tooltip } from "./index";

it("shared icon tooltips wait 500 ms on focus and cancel on blur or unmount", () => {
  vi.useFakeTimers();
  const view = render(<IconButton label="Close task / Esc">×</IconButton>);
  const trigger = screen.getByRole("button");
  fireEvent.focus(trigger);
  act(() => vi.advanceTimersByTime(499));
  expect(screen.queryByRole("tooltip")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Close task / Esc");
  fireEvent.blur(trigger);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
  view.unmount();
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it.each(["compact", "expanded"])(
  "%s labelled navigation never opens a name tooltip over the next item",
  (mode) => {
    vi.useFakeTimers();
    render(
      <nav className={mode}>
        <Tooltip text="Plan">
          <a href="/plan" className="nav-link">
            <span className="nav-label">Plan</span>
          </a>
        </Tooltip>
        <a href="/board">Board</a>
      </nav>,
    );
    const link = screen.getByRole("link", { name: "Plan" });
    fireEvent.mouseEnter(link.parentElement as HTMLElement);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(link);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("link", { name: "Board" })).toBeVisible();
  },
);

it("an icon-only navigation item keeps its accessible tooltip", () => {
  vi.useFakeTimers();
  render(
    <Tooltip text="Plan">
      <a href="/plan" className="nav-link" aria-label="Plan">
        <span className="nav-label" style={{ display: "none" }}>
          Plan
        </span>
      </a>
    </Tooltip>,
  );
  fireEvent.focus(screen.getByRole("link"));
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Plan");
});
