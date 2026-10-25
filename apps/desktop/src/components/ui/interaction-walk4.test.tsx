import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog, Drawer } from "./index";
import { ListEditor } from "./ListEditor";
import { ColorSwatches, memberColorNames, memberColors } from "./m5";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("F03 Escape cancels a real pointer list drag without closing its enclosing drawer or changing rows", async () => {
  const close = vi.fn(),
    changed = vi.fn();
  const rect = (top: number) => ({
    x: 0,
    y: top,
    left: 0,
    top,
    right: 300,
    bottom: top + 100,
    width: 300,
    height: 100,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return rect(this.getAttribute("aria-label") === "Test 2" ? 120 : 0);
    },
  );
  render(
    <Drawer title="Drag editor" onClose={close}>
      <ListEditor
        label="Test"
        value={[{ title: "First" }, { title: "Second" }]}
        onChange={changed}
        create={() => ({ title: "New" })}
      >
        {(row) => <input aria-label={row.title} defaultValue={row.title} />}
      </ListEditor>
    </Drawer>,
  );
  const grip = screen.getByRole("button", { name: "Drag Test 1" });
  fireEvent.pointerDown(grip, {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 20,
    clientY: 20,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 95 });
  const list = screen.getByRole("region", { name: "Test list" });
  await waitFor(() =>
    expect(list).toHaveAttribute("data-list-dragging", "true"),
  );
  const outside = vi.fn();
  window.addEventListener("keydown", outside);
  try {
    fireEvent.keyDown(grip, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(list).not.toHaveAttribute("data-list-dragging"));
    expect(close).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "First" })).toHaveValue("First");
    await act(async () => {});
    fireEvent.keyDown(grip, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  } finally {
    window.removeEventListener("keydown", outside);
  }
});
it("F05 Dialog focuses the first usable field, skipping disabled/hidden fields and the close icon", () => {
  render(
    <Dialog title="Create" onClose={vi.fn()}>
      <input aria-label="Disabled" disabled />
      <input aria-label="Hidden" hidden />
      <label>
        Title
        <input />
      </label>
      <textarea aria-label="Later" />
    </Dialog>,
  );
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
});
it.each(["effect", "autofocus", "marker"])(
  "F05 explicit %s field focus wins over default focus",
  (mode) => {
    function Form() {
      const chosen = useRef<HTMLInputElement>(null);
      useEffect(() => {
        if (mode === "effect") chosen.current?.focus();
      }, []);
      return (
        <>
          <input aria-label="First" />
          <input
            aria-label="Chosen"
            ref={chosen}
            // biome-ignore lint/a11y/noAutofocus: Regression fixture verifies that explicit dialog focus is preserved.
            autoFocus={mode === "autofocus"}
            data-autofocus={mode === "marker" ? true : undefined}
          />
        </>
      );
    }
    render(
      <Dialog title="Custom focus" onClose={vi.fn()}>
        <Form />
      </Dialog>,
    );
    expect(screen.getByRole("textbox", { name: "Chosen" })).toHaveFocus();
  },
);
it("F05 nested dialogs focus their own fields and return to the parent field after dismissal", async () => {
  function Example() {
    const [child, setChild] = useState(false);
    return (
      <Dialog title="Parent" onClose={vi.fn()}>
        <input aria-label="Parent title" />
        <button type="button" onClick={() => setChild(true)}>
          New task
        </button>
        {child && (
          <Dialog title="Child" onClose={() => setChild(false)}>
            <input aria-label="Task title" />
          </Dialog>
        )}
      </Dialog>
    );
  }
  render(<Example />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "New task" });
  await user.click(trigger);
  expect(screen.getByRole("textbox", { name: "Task title" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});
it("F06 all shared swatches expose named tooltips on hover/focus", () => {
  vi.useFakeTimers();
  render(<ColorSwatches value={memberColors[0] ?? ""} onChange={vi.fn()} />);
  for (let index = 0; index < memberColorNames.length; index++) {
    const swatch = screen.getByRole("button", { name: `Color ${index + 1}` });
    const wrapper = swatch.parentElement;
    if (!wrapper) throw new Error("Missing swatch tooltip wrapper");
    fireEvent.mouseEnter(wrapper);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      memberColorNames[index] ?? "",
    );
    fireEvent.mouseLeave(wrapper);
    fireEvent.focus(swatch);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      memberColorNames[index] ?? "",
    );
    fireEvent.blur(swatch);
  }
});
it("F07 disabled boundary moves explain Already first/last and never reorder", async () => {
  const changed = vi.fn();
  render(
    <ListEditor
      label="Criterion"
      value={[{ title: "Only" }]}
      onChange={changed}
      create={() => ({ title: "New" })}
    >
      {() => <p>Only row</p>}
    </ListEditor>,
  );
  const user = userEvent.setup();
  for (const [direction, reason] of [
    ["up", "Already first"],
    ["down", "Already last"],
  ]) {
    const move = screen.getByRole("button", {
      name: `Move Criterion 1 ${direction}`,
    });
    expect(move).toBeDisabled();
    const wrapper = move.parentElement;
    if (!wrapper) throw new Error("Missing tooltip wrapper");
    await user.hover(wrapper);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(reason ?? "");
    await user.unhover(wrapper);
  }
  expect(changed).not.toHaveBeenCalled();
});
