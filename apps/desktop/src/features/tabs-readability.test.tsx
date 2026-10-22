import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";

const workflowCss = readFileSync("src/styles/workflow.css", "utf8");

import { AssetDialog } from "./assets/AssetsPage";
import { SettingsPage } from "./settings/SettingsPage";
import { ReviewDialog } from "./task/Rounds";
import { TaskDrawer } from "./task/TaskDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
it("configuration tabs use manual arrow focus rather than changing the chosen transport", async () => {
  const user = userEvent.setup();
  wrap(<SettingsPage initialSection="Agents" />);
  const current = await screen.findByRole("tab", { name: "Codex · stdio" });
  const next = screen.getByRole("tab", { name: "Codex · HTTP" });
  current.focus();
  await user.keyboard("{ArrowRight}");
  expect(next).toHaveFocus();
  expect(current).toHaveAttribute("aria-selected", "true");
  expect(next).toHaveAttribute("tabindex", "0");
  expect(current).toHaveAttribute("tabindex", "-1");
});
it("every configuration tab names an existing associated panel and only the selected panel is exposed", async () => {
  wrap(<SettingsPage initialSection="Agents" />);
  const current = await screen.findByRole("tab", { name: "Codex · stdio" });
  const tabs = within(
    current.closest('[role="tablist"]') as HTMLElement,
  ).getAllByRole("tab");
  for (const tab of tabs) {
    const panelId = tab.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId ?? "");
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  }
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
});

it("tabs wrap with arrows/Home/End, leave vertical scrolling alone and activate only with Enter/Space", async () => {
  const user = userEvent.setup();
  wrap(<SettingsPage initialSection="Agents" />);
  const start = await screen.findByRole("tab", { name: "Codex · stdio" });
  start.focus();
  await user.keyboard("{ArrowLeft}");
  const last = screen.getByRole("tab", { name: "Claude Code · HTTP" });
  expect(last).toHaveFocus();
  expect(start).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Home}{End}{Enter}");
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("tabpanel", { name: "Claude Code · HTTP" }),
  ).toBeVisible();
  const down = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true,
    cancelable: true,
  });
  fireEvent(last, down);
  expect(down.defaultPrevented).toBe(false);
  await user.keyboard("{Home} ");
  expect(start).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{ArrowRight}{Tab}");
  expect(screen.getByRole("tabpanel", { name: "Codex · stdio" })).toHaveFocus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(start).toHaveFocus();
});
it("Description mode arrows never erase unsaved text, and explicit Preview/Write round-trip preserves it without saving", async () => {
  const user = userEvent.setup();
  wrap(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  const notes = await screen.findByRole("textbox", {
    name: "Description",
  });
  await user.clear(notes);
  await user.type(notes, "Unsaved **careful plan**");
  const write = screen.getByRole("tab", { name: "Write" });
  write.focus();
  await user.keyboard("{ArrowRight}");
  expect(notes).toHaveValue("Unsaved **careful plan**");
  expect(write).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("tabpanel", { name: "Preview" }),
  ).toHaveTextContent("careful plan");
  await user.keyboard("{ArrowLeft} ");
  expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Unsaved **careful plan**",
  );
  expect(mockApi.calls.some((call) => call.command === "update_task")).toBe(
    false,
  );
});
it("asset source switching keeps unsaved fields and never opens a file picker on arrow exploration", async () => {
  const user = userEvent.setup();
  wrap(<AssetDialog close={() => {}} />);
  const file = screen.getByRole("tab", { name: "File" });
  await waitFor(() => expect(file).toBeEnabled());
  file.focus();
  await user.keyboard("{ArrowRight}");
  expect(
    screen.getByRole("textbox", { name: "Asset location" }),
  ).toBeDisabled();
  await user.keyboard("{Enter}");
  await user.type(
    screen.getByRole("textbox", { name: "Asset location" }),
    "https://example.invalid/rough.png",
  );
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Rough idea");
  await user.click(file);
  await user.click(screen.getByRole("tab", { name: "URL" }));
  expect(screen.getByRole("textbox", { name: "Asset location" })).toHaveValue(
    "https://example.invalid/rough.png",
  );
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Rough idea",
  );
  expect(
    mockApi.calls.some((call) =>
      ["pick_file", "create_asset"].includes(call.command),
    ),
  ).toBe(false);
});
it("report navigation keeps comments and test choices intact in one vertical reader", async () => {
  const user = userEvent.setup();
  const report = (await mockApi.getTask("JB-9")).reports.at(-1);
  if (!report) throw Error("Missing report");
  const onReview = vi.fn();
  render(<ReviewDialog report={report} close={() => {}} onReview={onReview} />);
  const comments = screen.getByRole("textbox", { name: "Review comments" });
  const commentsScroll = vi.spyOn(comments, "scrollIntoView");
  const heading = screen.getByRole("heading", { name: "Captured report" });
  const headingScroll = vi.spyOn(heading, "scrollIntoView");
  await user.click(screen.getByRole("button", { name: "Go to comments" }));
  expect(comments).toHaveFocus();
  expect(commentsScroll).toHaveBeenLastCalledWith({
    block: "center",
    behavior: "instant",
  });
  await user.type(comments, "Keep this draft while reading the full report.");
  const checkbox = screen.getAllByRole("checkbox")[0];
  if (!checkbox) throw Error("Missing report check");
  await user.click(checkbox);
  await user.click(
    screen.getByRole("button", { name: "Back to captured report" }),
  );
  expect(heading).toHaveFocus();
  expect(headingScroll).toHaveBeenLastCalledWith({
    block: "start",
    behavior: "instant",
  });
  await user.click(screen.getByRole("button", { name: "Go to comments" }));
  expect(comments).toHaveValue(
    "Keep this draft while reading the full report.",
  );
  expect(checkbox).toBeChecked();
  expect(onReview).not.toHaveBeenCalled();
  const readerRule = workflowCss.match(
    /\.review-captured-report\s*\{([^}]+)\}/,
  )?.[1];
  expect(readerRule).toBeTruthy();
  expect(readerRule).not.toMatch(/max-height|overflow-y/);
});
