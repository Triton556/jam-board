import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomSelect } from "./CustomSelect";
import { Dialog } from "./controls";
import { selectClip, selectPlacement } from "./select-placement";

afterEach(() => vi.restoreAllMocks());
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
});
it("places a lower-edge menu above without enlarging beyond its scroll clip", () => {
  const anchor = rect(550, 718, 180, 40);
  const placement = selectPlacement(
    anchor,
    anchor,
    rect(500, 0, 300, 812),
    280,
  );
  expect(placement.side).toBe("above");
  expect(anchor.top + placement.top).toBe(434);
  expect(anchor.top + placement.top + 280).toBeLessThan(anchor.top);
  expect(anchor.left + placement.left + placement.width).toBeLessThanOrEqual(
    792,
  );
});
it.each([180, 320, 800])(
  "narrow %spx viewport and long menu stay bounded",
  (width) => {
    const anchor = rect(width - 100, 100, 90, 40);
    const position = selectPlacement(
      anchor,
      anchor,
      rect(0, 0, width, 240),
      500,
    );
    expect(position.width).toBeLessThanOrEqual(width - 16);
    expect(position.maxHeight).toBeLessThanOrEqual(96);
    expect(position.left + anchor.left).toBeGreaterThanOrEqual(8);
    expect(position.left + anchor.left + position.width).toBeLessThanOrEqual(
      width - 8,
    );
  },
);
it("scrollable ancestor clips are intersected with the viewport", () => {
  const view = render(
    <div style={{ overflowY: "auto", overflowX: "hidden" }} data-testid="clip">
      <div data-testid="root" />
    </div>,
  );
  vi.spyOn(view.getByTestId("clip"), "getBoundingClientRect").mockReturnValue(
    rect(100, 80, 500, 380),
  );
  expect(selectClip(view.getByTestId("root"))).toEqual({
    left: 100,
    top: 80,
    right: 600,
    bottom: 460,
  });
});
it("nested popup keeps keyboard Escape at select depth, supports End and returns trigger focus", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  function Example() {
    const [open, setOpen] = useState(true);
    return open ? (
      <Dialog title="Task" onClose={() => setOpen(false)}>
        <CustomSelect
          value="ready"
          onChange={change}
          label="Status"
          options={[
            { value: "backlog", label: "Backlog" },
            { value: "ready", label: "Ready" },
            { value: "done", label: "Done" },
          ]}
        />
      </Dialog>
    ) : null;
  }
  render(<Example />);
  const trigger = screen.getByRole("combobox", { name: "Status" });
  await user.click(trigger);
  await user.keyboard("{End}");
  expect(screen.getByRole("option", { name: "Done" })).toHaveClass(
    "active-option",
  );
  expect(screen.getByRole("option", { name: "Ready" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(trigger).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("mounted popup remeasures nested scroll and resize, without changing selection", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  let top = 700;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (
        this.classList.contains("custom-select") ||
        this.getAttribute("role") === "combobox"
      )
        return rect(500, top, 180, 40);
      return rect(0, 0, 800, 812);
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
  render(
    <CustomSelect
      value="a"
      label="Choice"
      onChange={change}
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
    />,
  );
  await user.click(screen.getByRole("combobox"));
  const popup = screen.getByRole("listbox").parentElement;
  expect(popup).toHaveAttribute("data-placement", "above");
  top = 100;
  act(() => fireEvent.scroll(document));
  expect(popup).toHaveAttribute("data-placement", "below");
  top = 700;
  act(() => fireEvent.resize(window));
  expect(popup).toHaveAttribute("data-placement", "above");
  expect(change).not.toHaveBeenCalled();
  top = -100;
  act(() => fireEvent.scroll(document));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("combobox")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(change).not.toHaveBeenCalled();
});
it("searchable long options remain in the same modal scope and empty filtering is truthful", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <Dialog title="Choose brain" onClose={() => {}}>
      <CustomSelect
        value="a"
        label="Brain"
        onChange={change}
        searchable
        options={Array.from({ length: 30 }, (_, i) => ({
          value: `${i}`,
          label: `Agent ${i} with a long descriptive name`,
        }))}
      />
    </Dialog>,
  );
  await user.click(screen.getByRole("combobox"));
  const search = screen.getByRole("textbox", { name: "Search brain" });
  expect(search).toHaveFocus();
  await user.type(search, "unavailable name");
  expect(screen.getByText("No matches")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
});
