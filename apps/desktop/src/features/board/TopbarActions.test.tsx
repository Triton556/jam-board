import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { TopbarActions } from "./TopbarActions";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
async function mount() {
  await mockApi.resetDemo();
  const agents = (await mockApi.listMembers()).filter(
    (member) => member.kind === "agent",
  );
  const actions = { newTask: vi.fn(), openInbox: vi.fn(), openSearch: vi.fn() };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TopbarActions {...actions} inboxCount={3} agents={agents} pulse={{}}>
        <span>Desktop controls</span>
      </TopbarActions>
      <button type="button">Outside</button>
    </QueryClientProvider>,
  );
  return {
    ...actions,
    agents,
    user: userEvent.setup(),
    trigger: screen.getByRole("button", { name: "More board actions" }),
  };
}
it("labels menu actions and agent statuses, navigates by arrows, and restores focus on Escape", async () => {
  const { user, trigger, agents } = await mount();
  await user.click(trigger);
  const menu = screen.getByRole("menu", { name: "Board actions" });
  const rows = within(menu).getAllByRole("menuitem");
  expect(rows[0]).toHaveTextContent("New task");
  expect(rows[1]).toHaveAccessibleName("Inbox 3 open inbox items");
  expect(rows[2]).toHaveTextContent("SearchCtrl K");
  expect(rows).toHaveLength(3 + agents.length);
  for (const agent of agents) {
    expect(within(menu).getByText(agent.name)).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: new RegExp(agent.name) }),
    ).toHaveTextContent(agent.statusText || "No activity message reported");
  }
  expect(rows[0]).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(rows[1]).toHaveFocus();
  await user.keyboard("{End}");
  expect(rows.at(-1)).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(rows[0]).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(rows.at(-1)).toHaveFocus();
  await user.keyboard("{Home}");
  expect(rows[0]).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(
    within(screen.getByRole("menu")).getAllByRole("menuitem").at(-1),
  ).toHaveFocus();
});
it("dismisses agent details before the menu and keeps arrow navigation free of hover popovers", async () => {
  const { user, trigger, agents } = await mount();
  await user.click(trigger);
  await user.keyboard("{End}");
  expect(
    screen.queryByRole("region", { name: /activity$/ }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("region", { name: `${agents.at(-1)?.name} activity` }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("region", { name: /activity$/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("menu")).toBeVisible();
  expect(
    within(screen.getByRole("menu")).getAllByRole("menuitem").at(-1),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});
it.each(["New task", "Inbox 3 open inbox items", "Search Ctrl K"])(
  "activates %s and closes the menu",
  async (name) => {
    const { user, trigger, newTask, openInbox, openSearch } = await mount();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      name === "New task"
        ? newTask
        : name.startsWith("Inbox")
          ? openInbox
          : openSearch,
    ).toHaveBeenCalledOnce();
  },
);
it("closes on an outside click and lets Tab leave the menu", async () => {
  const { user, trigger } = await mount();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
  await user.click(trigger);
  await user.tab();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
});
