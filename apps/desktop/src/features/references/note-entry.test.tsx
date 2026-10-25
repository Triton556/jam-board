import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { ReferencesPage } from "./ReferencesPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => undefined,
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <ReferencesPage />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Add" });
  return screen.getByRole("region", { name: "References canvas" });
}
it("H-R01 empty canvas offers New note first and Add file as a separate action", async () => {
  vi.spyOn(mockApi, "referenceCanvas").mockResolvedValue({
    items: [],
    frames: [],
    edges: [],
    links: [],
  });
  const pick = vi.spyOn(mockApi, "pickFiles").mockResolvedValue([]);
  const create = vi.spyOn(mockApi, "addReference");
  await mount();
  expect(
    screen.getByText("Double-click anywhere to jot an idea"),
  ).toBeVisible();
  expect(
    screen.getByText("or drop images, sounds, videos and links"),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Add file…" }));
  expect(pick).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "New note" }));
  await screen.findByText(/Click the canvas to place a note/);
  expect(create).not.toHaveBeenCalled();
});
it("H-R01 toolbar Note precedes Add; N arms placement and is ignored inside editable text and dialogs", async () => {
  const canvas = await mount();
  const toolbar = screen.getByRole("toolbar", { name: "Canvas tools" });
  const controls = within(toolbar).getAllByRole("button");
  expect(controls[0]).toHaveAccessibleName("Note · N");
  expect(controls[1]).toHaveAccessibleName("Add");
  expect(toolbar.querySelectorAll("button.primary")).toHaveLength(1);
  expect(controls[0]).toHaveClass("primary");
  expect(controls[1]).toHaveClass("ghost");
  expect(controls[1]).toHaveAttribute("aria-expanded", "false");
  const globalShortcut = vi.fn();
  window.addEventListener("keydown", globalShortcut);
  fireEvent.keyDown(canvas, { key: "n" });
  expect(globalShortcut).not.toHaveBeenCalled();
  window.removeEventListener("keydown", globalShortcut);
  expect(screen.getByText(/Click the canvas to place a note/)).toBeVisible();
  fireEvent.keyDown(canvas, { key: "Escape" });
  for (const element of [
    document.createElement("textarea"),
    document.createElement("input"),
    document.createElement("div"),
    document.createElement("dialog"),
  ]) {
    if (element.tagName === "DIV")
      element.setAttribute("contenteditable", "true");
    canvas.append(element);
    fireEvent.keyDown(element, { key: "n" });
    expect(
      screen.queryByText(/Click the canvas to place a note/),
    ).not.toBeInTheDocument();
    element.remove();
  }
});
it("H-R01/H-R04 double-click empty pane places a local paper at the pointer and focuses writing", async () => {
  vi.spyOn(mockApi, "referenceCanvas").mockResolvedValue({
    items: [],
    frames: [],
    edges: [],
    links: [],
  });
  const create = vi.spyOn(mockApi, "addReference");
  const canvas = await mount();
  const pane = canvas.querySelector(".react-flow__pane");
  expect(pane).toBeTruthy();
  fireEvent.doubleClick(pane as HTMLElement, { clientX: 450, clientY: 350 });
  const paper = await screen.findByRole("article", { name: "New note paper" });
  expect(paper.style.transform).toBe("translate(330px, 260px)");
  expect(screen.getByRole("textbox", { name: "Note text" })).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), {
    target: { value: "Pointer idea" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Note text" }), {
    key: "s",
    ctrlKey: true,
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledWith(
    { kind: "note", text: "Pointer idea", x: 330, y: 260 },
    true,
  );
});
