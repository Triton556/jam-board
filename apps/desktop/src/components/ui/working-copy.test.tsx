import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { fitWorkingText, WorkingLine } from "./AgentWorking";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head.querySelector("[data-working-copy-test]")?.remove();
});
it("fits complete Latin/Cyrillic words, including an oversized single word, without cutting letters", () => {
  const measure = (text: string) => text.length;
  expect(fitWorkingText("Codex · implementing JB-12", 22, measure)).toBe(
    "Codex · implementing…",
  );
  expect(fitWorkingText("Проверяет кириллицу задачи", 20, measure)).toBe(
    "Проверяет кириллицу…",
  );
  expect(fitWorkingText("Неразрывноеслово", 8, measure)).toBe("…");
  expect(fitWorkingText("Assigned to Danil", 30, measure)).toBe(
    "Assigned to Danil",
  );
});
it("resizes the secondary handwritten line while keeping pencil, underline and full live tooltip", async () => {
  let width = 155;
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("working-copy") ? width : 0;
    },
  );
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("working-measure")
        ? new DOMRect(0, 0, (this.textContent?.length ?? 0) * 7, 18)
        : original.call(this);
    },
  );
  const style = document.createElement("style");
  style.dataset.workingCopyTest = "";
  style.textContent = readFileSync("src/styles/agent-working.css", "utf8");
  document.head.append(style);
  const state = {
    mode: "active" as const,
    name: "Codex",
    status: "implementing JB-12",
    color: "purple",
    text: "Codex · implementing JB-12",
    tooltip: "Reported just now",
  };
  const view = render(<WorkingLine state={state} />);
  const line = screen.getByTestId("working-line");
  const copy = line.querySelector(".working-copy") as HTMLElement;
  expect(copy).toHaveTextContent("Codex · implementing…");
  expect(getComputedStyle(copy).fontSize).toBe("13px");
  expect(getComputedStyle(copy).fontWeight).toBe("400");
  expect(line.querySelector(".working-pencil")).toBeInTheDocument();
  expect(copy.querySelector(".working-underline")).toBeInTheDocument();
  await userEvent.hover(line.querySelector(".tooltip-wrap") as HTMLElement);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(state.text);
  act(() => {
    width = 600;
    for (const callback of callbacks) callback([], {} as ResizeObserver);
  });
  expect(copy).toHaveTextContent(state.text);
  view.rerender(
    <WorkingLine
      state={{
        ...state,
        text: "Assigned to Danil",
        tooltip: "Assignment is not execution.",
      }}
    />,
  );
  expect(copy).toHaveTextContent("Assigned to Danil");
  expect(screen.getByRole("tooltip")).toHaveTextContent("Assigned to Danil");
});
