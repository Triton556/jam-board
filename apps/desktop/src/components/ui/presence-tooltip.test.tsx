import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { WorkingState } from "../../lib/agent-working";
import { Tooltip } from ".";
import { WorkingLine } from "./AgentWorking";

const quiet: NonNullable<WorkingState> = {
  mode: "quiet",
  color: "var(--ink-3)",
  text: "Worker · task activity unconfirmed",
  tooltip: "Worker · no current task-specific activity was reported",
  name: "Worker",
  status: "",
};
const active: NonNullable<WorkingState> = {
  ...quiet,
  mode: "active",
  text: "Worker · checking the fictional scene",
  tooltip: "Worker · checking the fictional scene · reported just now",
  status: "checking the fictional scene",
};

it("keeps an already open card tooltip current through heartbeat and expiry", async () => {
  const user = userEvent.setup();
  const view = render(<WorkingLine state={quiet} />);
  const line = screen.getByTestId("working-line");
  await user.hover(line.querySelector(".tooltip-wrap") as HTMLElement);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent(quiet.tooltip);
  expect(line).not.toHaveAttribute("title");

  view.rerender(<WorkingLine state={active} />);
  expect(screen.getByTestId("working-line")).toBe(line);
  expect(await screen.findByRole("tooltip")).toBe(tooltip);
  expect(tooltip).toHaveTextContent(active.tooltip);
  expect(line).toHaveTextContent(active.text);

  view.rerender(<WorkingLine state={quiet} />);
  expect(await screen.findByRole("tooltip")).toBe(tooltip);
  expect(tooltip).toHaveTextContent(quiet.tooltip);
  expect(tooltip).not.toHaveTextContent(active.status);
  expect(line).toHaveTextContent(quiet.text);
  await user.unhover(line.querySelector(".tooltip-wrap") as HTMLElement);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

it("does not replace or activate the focused card as presence changes", async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  const card = (state: WorkingState) => (
    <button type="button" onClick={open}>
      Fictional task
      <WorkingLine state={state} />
    </button>
  );
  const view = render(card(quiet));
  await user.tab();
  const button = screen.getByRole("button");
  expect(button).toHaveFocus();
  view.rerender(card(active));
  expect(screen.getByRole("button")).toBe(button);
  expect(button).toHaveFocus();
  expect(open).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(open).toHaveBeenCalledTimes(1);
});

it("removes the old tooltip when its card or presence disappears", async () => {
  const user = userEvent.setup();
  const view = render(<WorkingLine state={active} />);
  await user.hover(
    screen
      .getByTestId("working-line")
      .querySelector(".tooltip-wrap") as HTMLElement,
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(active.tooltip);
  view.rerender(<WorkingLine state={null} />);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  view.rerender(<WorkingLine state={quiet} />);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

it("repositions a longer live tooltip using synthetic viewport coordinates", async () => {
  const user = userEvent.setup();
  const view = render(
    <Tooltip text="Short">
      <span>Presence</span>
    </Tooltip>,
  );
  const wrapper = screen.getByText("Presence").parentElement as HTMLElement;
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
    left: window.innerWidth - 80,
    right: window.innerWidth - 20,
    top: 100,
    bottom: 120,
    width: 60,
    height: 20,
    x: window.innerWidth - 80,
    y: 100,
    toJSON: () => ({}),
  });
  await user.hover(wrapper);
  const tooltip = await screen.findByRole("tooltip");
  const initialLeft = Number.parseFloat(tooltip.style.left);
  view.rerender(
    <Tooltip text="A much longer and newly reported task-specific activity description">
      <span>Presence</span>
    </Tooltip>,
  );
  expect(await screen.findByRole("tooltip")).toBe(tooltip);
  expect(Number.parseFloat(tooltip.style.left)).toBeLessThan(initialLeft);
  expect(Number.parseFloat(tooltip.style.left)).toBe(window.innerWidth - 288);
});
