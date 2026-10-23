import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { CustomSelect } from "../components/ui/CustomSelect";
import { Switch } from "../components/ui/m5";
import { mockApi } from "../lib/mock-bridge";
import { AssetsPage } from "./assets/AssetsPage";
import { TaskCard } from "./board/TaskCard";
import { TaskTable } from "./table/TaskTable";

vi.mock("@tanstack/react-router", () => ({ useBlocker: () => undefined }));

beforeEach(async () => {
  await mockApi.resetDemo();
  await mockApi.setSettings({ estimatesEnabled: false, colorBy: "none" });
});
it("loading a new mock demo uses fresh per-jam board preferences", async () => {
  const before = (await mockApi.appState()).jam?.id;
  await mockApi.setSettings({
    colorBy: "assignee",
    estimatesEnabled: true,
    wipLimit: 9,
  });
  await mockApi.resetDemo();
  expect((await mockApi.appState()).jam?.id).not.toBe(before);
  expect(await mockApi.getSettings()).toMatchObject({
    colorBy: "epic",
    estimatesEnabled: false,
    wipLimit: 6,
  });
  const board = await mockApi.listBoardTasks();
  expect(board.ready.every((t) => t.jamId !== before)).toBe(true);
});
function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}
it("cards are flat paper by default and estimates are opt-in", async () => {
  const members = await mockApi.listMembers(),
    board = await mockApi.listBoardTasks();
  const task = board.in_progress.find(
    (t) => t.assigneeId === members.find((m) => m.handle === "codex")?.id,
  );
  if (!task) throw new Error("Missing agent fixture");
  const view = render(
    <TaskCard task={{ ...task, estimate: 3 }} members={members} />,
  );
  expect(screen.getByTestId("task-card")).not.toHaveAttribute("data-tilt");
  expect(document.querySelector(".tape,.sticker-fold")).toBeNull();
  expect(screen.queryByLabelText("3 story points")).toBeNull();
  expect(
    screen.getByTestId("task-card").style.getPropertyValue("--card-fill"),
  ).toBe("var(--card)");
  view.rerender(
    <TaskCard
      task={{ ...task, estimate: 3 }}
      members={members}
      colorBy="assignee"
      estimatesEnabled
    />,
  );
  expect(screen.getByLabelText("3 story points")).toBeVisible();
  expect(
    screen.getByTestId("task-card").style.getPropertyValue("--card-fill"),
  ).toContain(members.find((m) => m.id === task.assigneeId)?.color);
  await waitFor(() =>
    expect(screen.getByTestId("task-card").style.transform).toMatch(
      /^(none)?$/,
    ),
  );
});
it("custom select exposes a combobox and supports arrows, Enter and Escape", async () => {
  const user = userEvent.setup();
  function Demo() {
    const [value, set] = useState("ready");
    return (
      <CustomSelect
        label="Status"
        value={value}
        onChange={set}
        options={[
          { value: "ready", label: "Ready" },
          { value: "review", label: "Review" },
        ]}
      />
    );
  }
  render(<Demo />);
  const select = screen.getByRole("combobox", { name: "Status" });
  select.focus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(select).toHaveTextContent("Review");
  expect(select).toHaveAttribute("aria-expanded", "false");
  await user.click(select);
  expect(screen.getByRole("listbox")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(select).toHaveFocus();
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("switch toggles with the keyboard and announces its state", async () => {
  function Demo() {
    const [on, set] = useState(false);
    return <Switch label="Estimates" checked={on} onChange={set} />;
  }
  render(<Demo />);
  screen.getByRole("switch").focus();
  await userEvent.setup().keyboard(" ");
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
});
it("attachment registers and links in one mutation, failure leaves no asset", async () => {
  const before = await mockApi.listAssets();
  mockApi.failNext("attach_file");
  await expect(
    mockApi.attachFile("JB-1", "C:/JamBoard/player.png"),
  ).rejects.toThrow();
  expect(await mockApi.listAssets()).toHaveLength(before.length);
  const a = await mockApi.attachFile("JB-1", "C:/JamBoard/player.png");
  expect(
    (await mockApi.getTask("JB-1")).assets.some((v) => v.id === a.id),
  ).toBe(true);
  expect(
    (await mockApi.listAssets()).find((v) => v.id === a.id)?.tasks[0]?.key,
  ).toBe("JB-1");
});
it("table inline creation supports Enter, Escape and pinned filtered-out tasks", async () => {
  wrap(
    <TaskTable search={{ status: "done" }} change={() => {}} open={() => {}} />,
  );
  await screen.findByText("Task table");
  await userEvent
    .setup()
    .click(
      screen
        .getAllByRole("button", { name: /New task/ })
        .at(0) as HTMLButtonElement,
    );
  await userEvent
    .setup()
    .click(screen.getByRole("combobox", { name: "New task story" }));
  await userEvent
    .setup()
    .click(await screen.findByRole("option", { name: /JB-S1/ }));
  const input = screen.getByRole("textbox", { name: "New task title" });
  fireEvent.change(input, { target: { value: "Inline lantern" } });
  input.focus();
  await userEvent.setup().keyboard("{Enter}");
  await waitFor(() =>
    expect(
      mockApi.calls.some(
        (c) =>
          c.command === "create_task" &&
          (c.input as { title?: string })?.title === "Inline lantern",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "New task title" }),
    ).toBeNull(),
  );
  await userEvent
    .setup()
    .click(
      screen
        .getAllByRole("button", { name: /New task/ })
        .at(0) as HTMLButtonElement,
    );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "New task title" }), {
    key: "Escape",
  });
  expect(screen.queryByRole("textbox", { name: "New task title" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Est." })).toBeNull();
});
it("asset groups can collapse and persist their state", async () => {
  wrap(<AssetsPage openTask={() => {}} />);
  const group = await screen.findByRole("button", { name: /Sprites/ });
  await userEvent.setup().click(group);
  await waitFor(() => expect(group).toHaveAttribute("aria-expanded", "false"));
  expect((await mockApi.getSettings()).collapsedAssetKinds).toContain("sprite");
  await userEvent
    .setup()
    .click(screen.getByRole("radio", { name: "List view" }));
  await waitFor(() =>
    expect(screen.getByTestId("asset-list")).toBeInTheDocument(),
  );
  expect((await mockApi.getSettings()).assetsView).toBe("list");
});
