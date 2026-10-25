import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutosizeTextarea } from "./AutosizeTextarea";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("native content sizing never reads scrollHeight on mount, typing, or a saved-value reset", () => {
  vi.stubGlobal("CSS", { supports: () => true });
  const height = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(() => {
      throw new Error("Forced layout read");
    });
  const change = vi.fn();
  const view = render(
    <AutosizeTextarea aria-label="Title" value="A title" onChange={change} />,
  );
  const input = screen.getByRole("textbox");
  fireEvent.input(input, { target: { value: "A much longer\ntitle" } });
  view.rerender(
    <AutosizeTextarea
      aria-label="Title"
      value="Remote saved title"
      onChange={change}
    />,
  );
  expect(height).not.toHaveBeenCalled();
  expect(input.style.height).toBe("");
  expect(input).toHaveValue("Remote saved title");
});

it("unsupported engines resize on input/reset, but only while the drawer is open", async () => {
  vi.stubGlobal("CSS", { supports: () => false });
  const height = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockReturnValue(200);
  const tree = (phase: string, value: string) => (
    <div className={`drawer ${phase}`}>
      <AutosizeTextarea
        aria-label="Description"
        value={value}
        onChange={() => {}}
      />
    </div>
  );
  const view = render(tree("entering", "Initial"));
  expect(height).not.toHaveBeenCalled();
  view.rerender(tree("open", "Initial"));
  await waitFor(() => expect(height).toHaveBeenCalled());
  const input = screen.getByRole("textbox");
  expect(input.style.height).toContain("200px");
  height.mockClear();
  fireEvent.input(input, { target: { value: "Typing" } });
  expect(height).toHaveBeenCalledOnce();
  height.mockClear();
  await act(() => view.rerender(tree("closing", "Saved reset")));
  expect(height).not.toHaveBeenCalled();
  await act(() => view.rerender(tree("closed", "Saved reset")));
  expect(height).not.toHaveBeenCalled();
});

it("autosizing fields have native sizing, bounded overflow and no manual resize grips", () => {
  const app = readFileSync("src/styles/app.css", "utf8");
  const field =
    app.match(/textarea\.autosize-textarea\s*\{([^}]+)\}/)?.[1] ?? "";
  expect(field).toContain("field-sizing: content");
  expect(field).toContain("resize: none");
  expect(field).toContain("max-height:");
  expect(field).toContain("overflow-y: auto");
  expect(
    readFileSync("src/styles/v22.css", "utf8").match(
      /\.markdown-field textarea\s*\{([^}]+)\}/,
    )?.[1],
  ).toContain("resize: none");
});
