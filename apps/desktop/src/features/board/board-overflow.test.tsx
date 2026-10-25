import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardOverflow } from "./BoardOverflow";

let width = 500,
  content = 1400;
const observers: ResizeObserverCallback[] = [];
beforeEach(() => {
  width = 500;
  content = 1400;
  observers.length = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("board-scroll") ? width : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("board-scroll") ? content : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options === "object")
      this.scrollLeft = options.left ?? this.scrollLeft;
    this.dispatchEvent(new Event("scroll"));
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = () =>
  render(
    <BoardOverflow>
      <div className="board-columns">
        <button type="button">Open fictional task</button>
      </div>
    </BoardOverflow>,
  );
it("overflow has visible direction cues and controls that stop at both real bounds", async () => {
  mount();
  const user = userEvent.setup();
  const region = screen.getByRole("region", { name: "Board columns" });
  expect(region).toHaveAttribute("tabindex", "0");
  expect(region).toHaveAccessibleDescription(/Left\/Right or Home\/End/);
  expect(
    screen.queryByRole("button", { name: "Scroll columns left" }),
  ).toBeNull();
  const right = screen.getByRole("button", { name: "Scroll columns right" });
  expect(right).toHaveTextContent("");
  await user.hover(right);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Left/Right or Home/End",
  );
  await user.click(
    screen.getByRole("button", { name: "Scroll columns right" }),
  );
  expect(region.scrollLeft).toBe(400);
  expect(region).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Scroll columns left" }),
  ).toBeEnabled();
  region.focus();
  await user.keyboard("{End}");
  expect(region.scrollLeft).toBe(900);
  expect(
    screen.queryByRole("button", { name: "Scroll columns right" }),
  ).toBeNull();
  await user.keyboard("{Home}");
  expect(region.scrollLeft).toBe(0);
  expect(
    screen.queryByRole("button", { name: "Scroll columns left" }),
  ).toBeNull();
});
it("resize and content changes show only genuine overflow, including at a new zoom-width", () => {
  width = 1400;
  mount();
  const region = screen.getByRole("region", { name: "Board columns" });
  expect(
    screen.queryByRole("button", { name: "Scroll columns right" }),
  ).toBeNull();
  expect(region).not.toHaveAttribute("aria-describedby");
  act(() => {
    width = 700;
    window.dispatchEvent(new Event("resize"));
  });
  expect(
    screen.getByRole("button", { name: "Scroll columns right" }),
  ).toBeEnabled();
  act(() => {
    content = 600;
    for (const callback of observers) callback([], {} as ResizeObserver);
  });
  expect(screen.queryByText(/More columns/)).toBeNull();
  expect(region).not.toHaveAttribute("aria-describedby");
});
it("only the region's own horizontal keys scroll; task drag/open keys and modifiers remain untouched", () => {
  mount();
  const region = screen.getByRole("region", { name: "Board columns" }),
    card = screen.getByRole("button", { name: "Open fictional task" });
  for (const key of [
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "Enter",
    " ",
    "Escape",
  ]) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(card, event);
    expect(event.defaultPrevented, key).toBe(false);
  }
  expect(region.scrollLeft).toBe(0);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", " ", "Escape"]) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(region, event);
    expect(event.defaultPrevented, key).toBe(false);
  }
  fireEvent.keyDown(region, { key: "ArrowRight", ctrlKey: true });
  expect(region.scrollLeft).toBe(0);
  fireEvent.keyDown(region, { key: "ArrowRight" });
  expect(region.scrollLeft).toBe(400);
  fireEvent.keyDown(region, { key: "ArrowLeft" });
  expect(region.scrollLeft).toBe(0);
});
it.each([false, true])(
  "scrolling is immediate with reduced-motion preference %s and preserves vertical position",
  async (reduced) => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: reduced,
    } as MediaQueryList);
    mount();
    const region = screen.getByRole("region", { name: "Board columns" });
    region.scrollTop = 280;
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Scroll columns right" }));
    expect(region.scrollTo).toHaveBeenLastCalledWith({
      left: 400,
      behavior: "instant",
    });
    expect(region.scrollTop).toBe(280);
  },
);
