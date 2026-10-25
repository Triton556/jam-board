import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SegmentedControl } from "../components/ui";

const css = ["app", "m5", "v22", "v24b", "workflow", "type-fit"]
  .map((name) => readFileSync(`src/styles/${name}.css`, "utf8"))
  .join("\n");
afterEach(() => {
  document.head.querySelector("[data-typography-test]")?.remove();
  delete document.documentElement.dataset.theme;
});

it.each(["light", "dark"])(
  "%s shared controls keep regular values and inactive navigation, with bold selected hierarchy",
  (theme) => {
    document.documentElement.dataset.theme = theme;
    const style = document.createElement("style");
    style.dataset.typographyTest = "";
    style.textContent = css;
    document.head.append(style);
    render(
      <>
        <form>
          <label>
            Endpoint
            <input defaultValue="https://api.z.ai/api/paas/v4" />
          </label>
          <label>
            Description
            <textarea defaultValue="Keep free-form playtest notes here…" />
          </label>
        </form>
        <nav>
          <a className="nav-link" href="/plan">
            Plan
          </a>
          <a className="nav-link selected" href="/board" aria-current="page">
            Board
          </a>
        </nav>
        <button type="button" className="button ghost">
          Refresh
        </button>
        <button type="button" className="button primary">
          New task
        </button>
        <SegmentedControl
          label="Color by"
          value="epic"
          onChange={() => {}}
          options={[
            { value: "none", label: "None" },
            { value: "epic", label: "Epic" },
          ]}
        />
        <div className="settings-row-label">
          Setting label <small className="small">Helper text</small>
        </div>
        <div className="tabs">
          <button type="button" role="tab" aria-selected="false">
            Preview
          </button>
          <button type="button" role="tab" aria-selected="true">
            Write
          </button>
        </div>
      </>,
    );
    for (const element of [
      screen.getByRole("textbox", { name: "Endpoint" }),
      screen.getByRole("textbox", { name: "Description" }),
      screen.getByRole("link", { name: "Plan" }),
      screen.getByRole("button", { name: "Refresh" }),
      screen.getByRole("tab", { name: "Preview" }),
      screen.getByRole("radio", { name: "None" }),
      screen.getByText("Helper text"),
    ])
      expect(getComputedStyle(element).fontWeight).toBe("400");
    for (const element of [
      screen.getByRole("link", { name: "Board" }),
      screen.getByRole("button", { name: "New task" }),
      screen.getByRole("tab", { name: "Write" }),
      screen.getByRole("radio", { name: "Epic" }),
    ])
      expect(getComputedStyle(element).fontWeight).toBe("700");
  },
);
