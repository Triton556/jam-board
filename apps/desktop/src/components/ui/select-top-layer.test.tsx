import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomSelect } from "./CustomSelect";
import { Dialog } from "./controls";

const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "showPopover",
);
const hideDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "hidePopover",
);
afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, descriptor] of [
    ["showPopover", showDescriptor],
    ["hidePopover", hideDescriptor],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});
function geometry() {
  let top = 290;
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("role") === "dialog")
        return rect(100, 180, 380, 180);
      if (
        this.classList.contains("custom-select") ||
        this.getAttribute("role") === "combobox"
      )
        return rect(120, top, 340, 36);
      return rect(0, 0, 800, 600);
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(260);
  return {
    move: (value: number) => {
      top = value;
    },
  };
}
function popover(throws = false) {
  const show = vi.fn(() => {
    if (throws) throw new DOMException("Unsupported context");
  });
  const hide = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "showPopover", {
    configurable: true,
    value: show,
  });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", {
    configurable: true,
    value: hide,
  });
  return { show, hide };
}
function Example({
  change,
  closed,
  newer = false,
}: {
  change: (value: string) => void;
  closed: () => void;
  newer?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {open && (
        <Dialog
          title="Link reference"
          onClose={() => {
            setOpen(false);
            closed();
          }}
        >
          <p>Choose a target; no link is saved yet.</p>
          <CustomSelect
            label="Target"
            value="a"
            searchable
            onChange={change}
            options={[
              {
                value: "a",
                label: "Epic A with a descriptive name",
                group: "Epic",
              },
              { value: "b", label: "Story B", group: "Story" },
              { value: "c", label: "Task C", group: "Task" },
            ]}
          />
        </Dialog>
      )}
      {newer && (
        <Dialog title="Newer dialog" onClose={() => {}}>
          <button type="button">Keep here</button>
        </Dialog>
      )}
    </>
  );
}
function clipDialog() {
  screen.getByRole("dialog").style.overflowY = "auto";
}

it("escapes the compact modal clip without leaving its DOM/focus ownership; Escape closes only this layer", async () => {
  geometry();
  const native = popover();
  const user = userEvent.setup(),
    change = vi.fn(),
    closed = vi.fn();
  render(<Example change={change} closed={closed} />);
  clipDialog();
  await user.click(screen.getByRole("combobox", { name: "Target" }));
  const popup = screen.getByRole("listbox").parentElement as HTMLElement;
  expect(native.show).toHaveBeenCalledTimes(1);
  expect(popup).toHaveAttribute("popover", "manual");
  expect(popup).toHaveAttribute("data-presentation", "top-layer");
  expect(Number.parseFloat(popup.style.maxHeight)).toBeGreaterThan(180);
  expect(screen.getByRole("dialog")).toContainElement(popup);
  expect(screen.getByRole("textbox", { name: "Search target" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("option", { name: "Task C" })).toHaveClass(
    "active-option",
  );
  expect(
    screen.getByRole("option", { name: "Epic A with a descriptive name" }),
  ).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Escape}");
  expect(native.hide).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(closed).toHaveBeenCalledTimes(1);
});

it.each(["unsupported", "throws"])(
  "%s Popover falls back to usable in-flow options and retains search/selection semantics",
  async (mode) => {
    geometry();
    const native = mode === "throws" ? popover(true) : undefined;
    const user = userEvent.setup(),
      change = vi.fn(),
      closed = vi.fn();
    render(<Example change={change} closed={closed} />);
    clipDialog();
    await user.click(screen.getByRole("combobox"));
    const popup = screen.getByRole("listbox").parentElement;
    expect(popup).toHaveAttribute("data-presentation", "inline");
    expect(popup).not.toHaveAttribute("popover");
    await user.type(
      screen.getByRole("textbox", { name: "Search target" }),
      "Task C",
    );
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(change).toHaveBeenCalledExactlyOnceWith("c");
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(native?.hide ?? vi.fn()).not.toHaveBeenCalled();
  },
);

it("top-layer popup closes on clipped trigger, survives resize while visible, and never changes selection", async () => {
  const layout = geometry(),
    native = popover();
  const user = userEvent.setup(),
    change = vi.fn();
  render(<Example change={change} closed={vi.fn()} />);
  clipDialog();
  await user.click(screen.getByRole("combobox"));
  act(() => fireEvent.resize(window));
  expect(screen.getByRole("listbox")).toBeVisible();
  layout.move(80);
  act(() => fireEvent.scroll(document));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(native.hide).toHaveBeenCalledTimes(1);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox")).not.toHaveFocus();
});

it("outside pointer closes the popup without selection; newer modal focus dismisses the old top layer", async () => {
  geometry();
  const native = popover(),
    user = userEvent.setup(),
    change = vi.fn(),
    closed = vi.fn();
  const view = render(<Example change={change} closed={closed} />);
  clipDialog();
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByText("Choose a target; no link is saved yet."));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(closed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox"));
  view.rerender(<Example change={change} closed={closed} newer />);
  expect(screen.getByRole("dialog", { name: "Newer dialog" })).toHaveFocus();
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(native.hide).toHaveBeenCalledTimes(2);
  expect(change).not.toHaveBeenCalled();
});

it("backdrop dismissal does not activate the canvas below the modal", async () => {
  geometry();
  popover();
  const user = userEvent.setup(),
    canvas = vi.fn(),
    closed = vi.fn();
  render(
    <>
      <button type="button" onClick={canvas}>
        Canvas action
      </button>
      <Example change={vi.fn()} closed={closed} />
    </>,
  );
  clipDialog();
  await user.click(screen.getByRole("combobox"));
  const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
  await user.click(overlay);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(canvas).not.toHaveBeenCalled();
});

it("removes its top-layer entry and measurement listeners when the owning modal unmounts", async () => {
  geometry();
  const native = popover(),
    user = userEvent.setup();
  render(<button type="button">Original opener</button>);
  screen.getByRole("button", { name: "Original opener" }).focus();
  const view = render(<Example change={vi.fn()} closed={vi.fn()} />);
  clipDialog();
  await user.click(screen.getByRole("combobox"));
  view.unmount();
  expect(native.hide).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Original opener" })).toHaveFocus();
  act(() => {
    fireEvent.resize(window);
    fireEvent.scroll(document);
  });
  expect(native.show).toHaveBeenCalledTimes(1);
  expect(native.hide).toHaveBeenCalledTimes(1);
});
