import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { RefItem } from "../../bindings";
import { Dialog } from "../../components/ui";
import { ReferenceActions } from "./Nodes";
import { CanvasContext, type CanvasRuntime } from "./runtime";

const item: RefItem = {
  id: "reference1",
  jamId: "j",
  kind: "note",
  title: "Agent findings",
  captionMd: "Keep this content",
  x: 0,
  y: 0,
  w: 240,
  h: 180,
  archivedAt: null,
  createdBy: "human",
  updatedBy: "human",
  createdAt: "now",
  updatedAt: "now",
  position: 0,
  tags: [],
  z: 0,
  frameId: null,
  assetId: null,
  url: null,
  linkPreview: null,
  metadata: null,
};
function actions(): CanvasRuntime {
  return {
    edit: vi.fn(),
    archive: vi.fn(),
    resize: vi.fn(),
    resizeFrame: vi.fn(),
    collapse: vi.fn(),
    editFrame: vi.fn(),
    open: vi.fn(),
    lightbox: vi.fn(),
    edgeLabel: vi.fn(),
    caption: vi.fn(),
  };
}
function Harness({
  runtime = actions(),
  outerEscape = vi.fn(),
}: {
  runtime?: CanvasRuntime;
  outerEscape?: () => void;
}) {
  return (
    <CanvasContext.Provider value={runtime}>
      <section
        onKeyDown={(event) => {
          if (event.key === "Escape") outerEscape();
        }}
        aria-label="Synthetic canvas"
      >
        <ReferenceActions
          item={item}
          links={[{ key: "JB-1", viaFrame: false, color: "red" }]}
        />
        <button type="button">Outside target</button>
      </section>
    </CanvasContext.Provider>
  );
}
it("RF04 first Escape closes only the item menu and returns its summary focus", async () => {
  const outerEscape = vi.fn(),
    runtime = actions();
  render(<Harness runtime={runtime} outerEscape={outerEscape} />);
  const summary = screen.getByLabelText("Actions for Agent findings");
  await userEvent.click(summary);
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Edit caption" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(summary).toHaveFocus();
  expect(outerEscape).not.toHaveBeenCalled();
  expect(runtime.edit).not.toHaveBeenCalled();
  expect(runtime.archive).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  expect(outerEscape).toHaveBeenCalledOnce();
});
it("RF04 outside pointer dismissal preserves the clicked target and never invokes actions", async () => {
  const runtime = actions();
  render(<Harness runtime={runtime} />);
  const summary = screen.getByLabelText("Actions for Agent findings");
  await userEvent.click(summary);
  await userEvent.click(screen.getByRole("button", { name: "Outside target" }));
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "Outside target" })).toHaveFocus();
  expect(runtime.edit).not.toHaveBeenCalled();
  expect(runtime.archive).not.toHaveBeenCalled();
  expect(runtime.open).not.toHaveBeenCalled();
  expect(runtime.resize).not.toHaveBeenCalled();
});
it("RF04 action handoff closes the menu and a real dialog restores its visible summary", async () => {
  const edit = vi.fn();
  function WithDialog() {
    const [open, setOpen] = useState(false);
    const runtime = {
      ...actions(),
      edit: (id: string, mode: "caption" | "tags" | "link") => {
        edit(id, mode);
        setOpen(true);
      },
    };
    return (
      <>
        <Harness runtime={runtime} />
        {open && (
          <Dialog title="Edit reference" onClose={() => setOpen(false)}>
            <button type="button">Dialog action</button>
          </Dialog>
        )}
      </>
    );
  }
  render(<WithDialog />);
  const summary = screen.getByLabelText("Actions for Agent findings");
  await userEvent.click(summary);
  await userEvent.click(screen.getByRole("button", { name: "Edit caption" }));
  expect(edit).toHaveBeenCalledExactlyOnceWith(item.id, "caption");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("dialog", { name: "Edit reference" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(summary).toHaveFocus();
});
it("RF04 repeated keyboard-style click events keep native summary semantics", async () => {
  render(<Harness />);
  const summary = screen.getByLabelText("Actions for Agent findings");
  summary.focus();
  expect(summary.tagName).toBe("SUMMARY");
  // Happy DOM does not implement the summary Enter default action.
  // Browser scenarios exercise the actual key; this models its click event only.
  fireEvent.click(summary, { detail: 0 });
  expect(summary.closest("details")).toHaveAttribute("open");
  fireEvent.click(summary, { detail: 0 });
  expect(summary.closest("details")).not.toHaveAttribute("open");
});
