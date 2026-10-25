import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RefItem } from "../../bindings";
import type { VerdictItem } from "../../lib/api";
import { mockApi } from "../../lib/mock-bridge";
import { ReferenceNode } from "./Nodes";
import { CanvasContext, type CanvasRuntime } from "./runtime";

// Geometry is not under test. Keep the actual note, editor and action menu.
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  useStore: () => false,
  Handle: () => null,
  NodeResizer: () => null,
}));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({}) }));
beforeEach(async () => {
  await mockApi.resetDemo();
});
afterEach(() => {
  document.head.querySelector("[data-note-resting-test]")?.remove();
  delete document.documentElement.dataset.theme;
});
async function mount(title = "") {
  const style = document.createElement("style");
  style.dataset.noteRestingTest = "";
  style.textContent = readFileSync(
    "src/features/references/references.css",
    "utf8",
  );
  document.head.append(style);
  const app = await mockApi.appState();
  const item = await mockApi.addReference(
    {
      kind: "note",
      title,
      text: "Идея без пустой полосы",
    },
    !title,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], app);
  const runtime: CanvasRuntime = {
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
  const view = (selected = false, reference: RefItem = item) => (
    <QueryClientProvider client={client}>
      <CanvasContext.Provider value={runtime}>
        <ReferenceNode
          {...({
            id: reference.id,
            selected,
            data: {
              item: reference,
              path: "",
              links: [{ key: "JB-12", viaFrame: false }],
              color: "var(--butter)",
              dim: false,
              connect: false,
            },
          } as ComponentProps<typeof ReferenceNode>)}
        />
      </CanvasContext.Provider>
    </QueryClientProvider>
  );
  return { ...render(view()), view, item, runtime };
}
it.each(["light", "dark"])(
  "%s headingless note has a compact controls strip, reveals actions on selection/focus and retains bottom links",
  async (theme) => {
    document.documentElement.dataset.theme = theme;
    const { rerender, view, runtime } = await mount();
    const paper = screen.getByRole("article");
    expect(paper).toHaveClass("note-without-heading");
    expect(getComputedStyle(paper).position).toBe("relative");
    expect(paper.querySelector("header")).not.toBeNull();
    expect(paper.querySelector("header strong")).toBeNull();
    expect(
      await screen.findByText("Идея без пустой полосы", { selector: "p" }),
    ).toBeVisible();
    const menu = paper.querySelector(".reference-menu") as HTMLElement;
    const summary = menu.querySelector("summary") as HTMLElement;
    expect(menu.parentElement).toBe(paper.querySelector("header"));
    expect(getComputedStyle(menu).position).toBe("relative");
    expect(getComputedStyle(menu).opacity).toBe("0");
    rerender(view(true));
    expect(getComputedStyle(menu).opacity).toBe("1");
    rerender(view(false));
    summary.focus();
    expect(summary).toHaveFocus();
    expect(getComputedStyle(menu).opacity).toBe("1");
    const footer = paper.querySelector("footer") as HTMLElement;
    expect(paper.lastElementChild).toBe(footer);
    await userEvent.click(screen.getByRole("button", { name: "JB-12" }));
    expect(runtime.open).toHaveBeenCalledExactlyOnceWith("JB-12");
    summary.focus();
    await userEvent.click(summary);
    await userEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveFocus();
  },
);
it("a note heading occupies its header row once; media/link headers stay intact", async () => {
  const { rerender, view, item } = await mount("Фонарь");
  const paper = screen.getByRole("article");
  expect(paper.querySelector("header")).toHaveTextContent("Фонарь");
  expect(paper.querySelectorAll(".sticky-note-title")).toHaveLength(1);
  expect(paper).not.toHaveClass("note-without-heading");
  rerender(
    view(false, {
      ...item,
      kind: "link",
      title: "Media source",
      url: "https://example.invalid",
    }),
  );
  expect(paper.querySelector("header")).toHaveTextContent("Media source");
  expect(paper.querySelector("header .reference-menu")).toBeInTheDocument();
});
it("feedback lives left of the actions menu in the header and badges persist without hover", async () => {
  const { rerender, view, item } = await mount("Candidate");
  const paper = screen.getByRole("article");
  const header = paper.querySelector("header") as HTMLElement;
  const toolbar = screen.getByRole("group", { name: "Reference feedback" });
  expect(toolbar.parentElement).toBe(header);
  expect(toolbar.nextElementSibling).toHaveClass("reference-menu");
  expect(getComputedStyle(toolbar).position).toBe("static");
  expect(getComputedStyle(toolbar).opacity).toBe("0");
  const keep = screen.getByRole("button", { name: "Keep" });
  expect(getComputedStyle(keep).width).toBe("28px");
  expect(getComputedStyle(keep).height).toBe("28px");
  const slot = getComputedStyle(keep.parentElement as HTMLElement);
  expect(slot.width).toBe("24px");
  expect(slot.height).toBe("24px");
  const face = getComputedStyle(
    keep.querySelector(".reference-verdict-face") as HTMLElement,
  );
  expect(face.width).toBe("24px");
  expect(face.height).toBe("24px");
  rerender(view(true));
  expect(getComputedStyle(toolbar).opacity).toBe("1");
  rerender(view(false, { ...item, verdict: "keep" } as VerdictItem));
  const badge = screen.getByRole("img", { name: "Keep" });
  expect(badge.parentElement).toBe(header);
  expect(getComputedStyle(toolbar).opacity).toBe("0");
  expect(getComputedStyle(badge).position).not.toBe("absolute");
  expect(badge).toBeVisible();
  rerender(view(false, { ...item, verdict: "reject" } as VerdictItem));
  expect(screen.getByRole("img", { name: "Not this" })).toBeVisible();
  expect(paper).toHaveStyle({ opacity: "0.45" });
  expect(paper.querySelector("footer .reference-verdict-toolbar")).toBeNull();
});
it("Actions and note finish controls show one tooltip on focus and finish has a 28 px target", async () => {
  await mount("Tooltip note");
  const summary = screen.getByLabelText("Actions for Tooltip note");
  summary.focus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Actions for Tooltip note",
  );
  await userEvent.click(summary);
  await userEvent.click(screen.getByRole("button", { name: "Edit note" }));
  const finish = screen.getByRole("button", { name: "Finish editing note" });
  finish.focus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Finish editing note",
  );
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  expect(getComputedStyle(finish).minWidth).toBe("28px");
  expect(getComputedStyle(finish).minHeight).toBe("28px");
});
