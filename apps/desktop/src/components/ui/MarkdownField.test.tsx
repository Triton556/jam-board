import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownField } from "./MarkdownField";

const runtime = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  openUrl: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: runtime.isTauri }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: runtime.openUrl }));

const initial =
  "Read [guide](https://example.invalid/guide) before changing.\n\n## Heading\n\n- First\n- Second";
const saves = vi.fn();
function Harness({
  disabled = false,
  start = initial,
}: {
  disabled?: boolean;
  start?: string;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <MarkdownField
        label="Context"
        value={value}
        onChange={setValue}
        onSave={() => saves(value)}
        disabled={disabled}
      />
      <button type="button">Outside</button>
      <output aria-label="Draft value">{value}</output>
    </>
  );
}

beforeEach(() => {
  runtime.isTauri.mockReturnValue(true);
  runtime.openUrl.mockClear();
  saves.mockClear();
});

describe("semantic MarkdownField interaction; actual lazy Markdown", () => {
  it("renders links and block content outside the explicit edit button", async () => {
    render(<Harness />);
    const link = await screen.findByRole("link", { name: "guide" });
    const button = screen.getByRole("button", { name: "Edit Context" });
    expect(button).not.toContainElement(link);
    expect(link.closest("button")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Heading" }).closest("button"),
    ).toBeNull();
    expect(screen.getByRole("list").closest("button")).toBeNull();
    expect(screen.getByRole("list")).toHaveTextContent("First Second");
    expect(button).toHaveAccessibleName("Edit Context");
    expect(button).not.toHaveAccessibleName(/Read|guide|Heading/);
  });

  it.each(["pointer", "keyboard"])(
    "%s link activation opens only the URL, never the editor",
    async (mode) => {
      const user = userEvent.setup();
      render(<Harness />);
      const link = await screen.findByRole("link", { name: "guide" });
      if (mode === "pointer") await user.click(link);
      else {
        await user.tab();
        expect(
          screen.getByRole("button", { name: "Edit Context" }),
        ).toHaveFocus();
        await user.tab();
        expect(link).toHaveFocus();
        await user.keyboard("{Enter}");
      }
      expect(runtime.openUrl).toHaveBeenCalledExactlyOnceWith(
        "https://example.invalid/guide",
      );
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(link).toBeInTheDocument();
      expect(saves).not.toHaveBeenCalled();
    },
  );

  it.each(["pointer", "keyboard"])(
    "disabled editing still permits %s reference reading",
    async (mode) => {
      const user = userEvent.setup();
      render(<Harness disabled />);
      const link = await screen.findByRole("link", { name: "guide" });
      expect(
        screen.getByRole("button", { name: "Edit Context" }),
      ).toBeDisabled();
      if (mode === "pointer") await user.click(link);
      else {
        await user.tab();
        expect(link).toHaveFocus();
        await user.keyboard("{Enter}");
      }
      expect(runtime.openUrl).toHaveBeenCalledExactlyOnceWith(
        "https://example.invalid/guide",
      );
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(link).toBeInTheDocument();
      expect(saves).not.toHaveBeenCalled();
    },
  );

  it("direct reference event remains independent of disabled editing (not native simulation)", async () => {
    render(<Harness disabled />);
    const link = await screen.findByRole("link", { name: "guide" });
    fireEvent.click(link);
    expect(runtime.openUrl).toHaveBeenCalledExactlyOnceWith(
      "https://example.invalid/guide",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("browser-path link retains semantic navigation without opening editor; harness cancels navigation", async () => {
    runtime.isTauri.mockReturnValue(false);
    const user = userEvent.setup();
    render(<Harness />);
    const link = await screen.findByRole("link", { name: "guide" });
    // The capture guard is only a safety stub; it does not stop propagation.
    const preventNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", preventNavigation, true);
    try {
      await user.click(link);
    } finally {
      document.removeEventListener("click", preventNavigation, true);
    }
    expect(runtime.openUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("normal blur saves the current draft exactly once", async () => {
    const user = userEvent.setup();
    render(<Harness start="Original" />);
    await user.click(screen.getByRole("button", { name: "Edit Context" }));
    const editor = screen.getByRole("textbox", { name: "Context" });
    expect(editor).toHaveFocus();
    await user.clear(editor);
    await user.type(editor, "Changed");
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(saves).toHaveBeenCalledExactlyOnceWith("Changed");
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Escape restores entry value, makes no save, and does not suppress the next blur save", async () => {
    const user = userEvent.setup();
    render(<Harness start="Original" />);
    await user.click(screen.getByRole("button", { name: "Edit Context" }));
    await user.type(screen.getByRole("textbox", { name: "Context" }), " draft");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Draft value")).toHaveTextContent("Original");
    expect(saves).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit Context" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Edit Context" }));
    await user.type(screen.getByRole("textbox", { name: "Context" }), " later");
    await user.tab();
    expect(saves).toHaveBeenCalledExactlyOnceWith("Original later");
  });

  it.each(["Control", "Meta"])(
    "%s+s saves once with the latest value and no later blur duplicate",
    async (modifier) => {
      const user = userEvent.setup();
      render(<Harness start="Original" />);
      await user.click(screen.getByRole("button", { name: "Edit Context" }));
      await user.type(
        screen.getByRole("textbox", { name: "Context" }),
        " draft",
      );
      await user.keyboard(`{${modifier}>}s{/${modifier}}`);
      expect(saves).toHaveBeenCalledExactlyOnceWith("Original draft");
      expect(
        screen.getByRole("button", { name: "Edit Context" }),
      ).toHaveFocus();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Outside" }));
      expect(saves).toHaveBeenCalledTimes(1);
    },
  );

  it("plain Enter remains a newline rather than saving", async () => {
    const user = userEvent.setup();
    render(<Harness start="Original" />);
    await user.click(screen.getByRole("button", { name: "Edit Context" }));
    await user.keyboard("{End}{Enter}Next");
    expect(screen.getByRole("textbox", { name: "Context" })).toHaveValue(
      "Original\nNext",
    );
    expect(saves).not.toHaveBeenCalled();
  });

  it("native-path link prevents default without causing an editing action", async () => {
    render(<Harness />);
    const link = await screen.findByRole("link", { name: "guide" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(fireEvent(link, event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("read-only empty content is neutral, not an invitation to click", () => {
    render(<Harness disabled start="" />);
    expect(screen.getByText("Not provided")).toBeVisible();
    expect(screen.queryByText(/Click to add/i)).not.toBeInTheDocument();
    expect(saves).not.toHaveBeenCalled();
  });

  it("clicking ordinary prose does not edit; explicit keyboard Edit does", async () => {
    const user = userEvent.setup();
    render(<Harness start="Selectable context" />);
    await user.click(
      await screen.findByText("Selectable context", { selector: "p" }),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const edit = screen.getByRole("button", { name: "Edit Context" });
    edit.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Context" })).toHaveFocus();
    expect(saves).not.toHaveBeenCalled();
  });
});
