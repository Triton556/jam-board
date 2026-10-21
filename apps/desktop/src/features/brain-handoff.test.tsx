import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { brainHandoff, connectionPrompt } from "../lib/brain-handoff";
import { mockApi } from "../lib/mock-bridge";
import { BrainHandoff, WorkflowGuide } from "./plan/BrainHandoff";

beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});

it("connection checking is read-only and never tells a worker to take Ready work", () => {
  expect(connectionPrompt).toContain("get_project and get_board");
  expect(connectionPrompt).toContain("read-only connection check");
  expect(connectionPrompt).not.toContain("highest-priority");
});

it.each(["project", "epic", "story", "task"] as const)(
  "%s handoff is project-pinned and separates planning from execution",
  (type) => {
    const prompt = brainHandoff({ type, key: "JB2-S3" }, "JB2");
    expect(prompt).toContain("verify its key prefix is JB2");
    expect(prompt).toContain(`${type} JB2-S3`);
    expect(prompt).toContain("stop and ask me to connect the right project");
    expect(prompt).toContain("comments and linked references/assets");
    expect(prompt).toContain("Reconcile my edits");
    expect(prompt).toContain("Planning only: do not claim tasks");
    expect(prompt).toContain(
      "Ready describes the brief, not permission to work",
    );
    expect(prompt).toContain(
      "without asking me to launch each worker separately",
    );
  },
);

it("handoff previews a scoped prompt without writing the board, and can be dismissed and reopened", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrainHandoff scope={{ type: "epic", key: "JB-E1" }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  const preview = await screen.findByRole("textbox", {
    name: "Planning prompt",
  });
  expect(preview).toHaveValue(
    brainHandoff({ type: "epic", key: "JB-E1" }, "JB"),
  );
  expect(preview).toHaveAttribute("readonly");
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(write).toHaveBeenCalledOnce();
  expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(mockApi.calls.every((call) => call.command === "app_state")).toBe(
    true,
  );
});

it("clipboard failure leaves a selectable prompt and truthful recovery message", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
    new Error("denied"),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrainHandoff scope={{ type: "task", key: "JB-1" }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Refine with brain" }));
  await user.click(
    screen.getByRole("button", { name: "Copy planning prompt" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Clipboard unavailable",
  );
  expect(
    screen.getByRole("textbox", { name: "Planning prompt" }),
  ).toBeVisible();
});

it("the workflow guide explains stories as the feature-sized intermediate level", async () => {
  const user = userEvent.setup();
  render(<WorkflowGuide />);
  await user.click(screen.getByText("How the board and brain work together"));
  expect(screen.getByText(/is a feature or outcome/)).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(
    screen.getByText(/Authorize the scope, not each worker/),
  ).toBeVisible();
});
