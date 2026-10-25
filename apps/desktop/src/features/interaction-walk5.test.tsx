import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WhoAreYou } from "../app";
import { mockApi } from "../lib/mock-bridge";
import { QuestionCard } from "./inbox/InboxPage";
import { SettingsPage } from "./settings/SettingsPage";
import { AgentStatus } from "./team/AgentStatus";
import { MemberDialog, TeamPage } from "./team/TeamPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/board",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());
async function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  return {
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
    client,
  };
}
it("F01 repeated submits dispatch one add_self before render, while pending and after success", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const original = mockApi.addSelf.bind(mockApi);
  const add = vi.spyOn(mockApi, "addSelf").mockImplementation(async (name) => {
    await gate;
    return original(name);
  });
  await mount(<WhoAreYou />);
  const input = screen.getByRole("textbox", { name: "Your name" });
  fireEvent.change(input, { target: { value: "Single identity" } });
  const form = input.closest("form");
  if (!form) throw new Error("Missing identity form");
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: /^Adding myself/ })).toBeDisabled();
  fireEvent.submit(form);
  await act(async () => {
    finish();
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add myself" })).toBeDisabled(),
  );
  fireEvent.submit(form);
  expect(add).toHaveBeenCalledTimes(1);
  expect(
    (await mockApi.listMembers()).filter((m) => m.name === "Single identity"),
  ).toHaveLength(1);
});
it("F01 failed identity request keeps the name and permits a deliberate retry", async () => {
  vi.spyOn(mockApi, "addSelf").mockRejectedValueOnce(
    new Error("Identity failed"),
  );
  await mount(<WhoAreYou />);
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Your name" });
  await user.type(input, "Retained identity");
  await user.click(screen.getByRole("button", { name: "Add myself" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Identity failed");
  expect(input).toHaveValue("Retained identity");
  await user.click(screen.getByRole("button", { name: "Add myself" }));
  await waitFor(() => expect(mockApi.addSelf).toHaveBeenCalledTimes(2));
});
it("F02 a failed team read is unknown, not empty; Retry recovers the populated team", async () => {
  vi.spyOn(mockApi, "listMembers").mockRejectedValueOnce(
    new Error("Team read failed"),
  );
  await mount(<TeamPage openTask={vi.fn()} connect={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Team read failed",
  );
  expect(
    screen.queryByText("Every jam starts with a teammate"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Your AI teammates will join here"),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Codex" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("F02 cached team cards survive a refresh failure and retry does not write", async () => {
  const { client } = await mount(
    <TeamPage openTask={vi.fn()} connect={vi.fn()} />,
  );
  await screen.findByRole("heading", { name: "Codex" });
  const create = vi.spyOn(mockApi, "createMember");
  vi.spyOn(mockApi, "listMembers").mockRejectedValueOnce(
    new Error("Refresh failed"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["members"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Showing the last loaded team",
  );
  expect(screen.getByRole("heading", { name: "Codex" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(create).not.toHaveBeenCalled();
});
it("F03 hovered activity closes on Escape and outside click, returning trigger focus", async () => {
  const member = (await mockApi.listMembers()).find((m) => m.kind === "agent");
  if (!member) throw new Error("Missing agent fixture");
  await mount(
    <>
      <AgentStatus member={member} />
      <button type="button">Outside</button>
    </>,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: `${member.name} status` });
  await user.hover(trigger);
  expect(
    screen.getByRole("region", { name: `${member.name} activity` }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(trigger).toHaveFocus();
  expect(
    screen.queryByRole("region", { name: `${member.name} activity` }),
  ).not.toBeInTheDocument();
  await user.click(trigger);
  const outside = screen.getByRole("button", { name: "Outside" });
  for (let step = 0; step < 4 && document.activeElement !== outside; step++)
    await user.tab();
  expect(outside).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).not.toHaveFocus();
});
it("F04 question menu exposes expanded state and dismisses on Escape/outside without withdrawing", async () => {
  const q = await mockApi.askUser({
    scope: { type: "task", id: "JB-7" },
    title: "Menu probe",
    bodyMd: "",
    options: [],
    recommendedIndex: null,
    allowFreeText: true,
    roundLabel: null,
  });
  const withdraw = vi.spyOn(mockApi, "withdrawQuestion");
  await mount(
    <>
      <QuestionCard question={q} />
      <h1>Outside heading</h1>
    </>,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", {
    name: "Question menu: Menu probe",
  });
  for (const mode of ["escape", "outside"]) {
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeVisible();
    if (mode === "escape") await user.keyboard("{Escape}");
    else
      await user.click(
        screen.getByRole("heading", { name: "Outside heading" }),
      );
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Withdraw" }),
    ).not.toBeInTheDocument();
  }
  expect(withdraw).not.toHaveBeenCalled();
});
it("F03 outside dismissal lets a newly opened member dialog keep its first-field focus", async () => {
  const member = (await mockApi.listMembers()).find((m) => m.kind === "agent");
  if (!member) throw new Error("Missing agent fixture");
  const agent = member;
  function Example() {
    const [edit, setEdit] = useState(false);
    return (
      <>
        <AgentStatus member={agent} />
        <button type="button" onClick={() => setEdit(true)}>
          Open member form
        </button>
        {edit && <MemberDialog close={() => setEdit(false)} />}
      </>
    );
  }
  await mount(<Example />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: `${member.name} status` });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Open member form" }));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
});
it.each([false, true])(
  "F05 member form focuses Name immediately (edit=%s)",
  async (edit) => {
    const member = edit
      ? (await mockApi.listMembers()).find((m) => m.kind === "human")
      : undefined;
    await mount(<MemberDialog member={member} close={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  },
);
it("F05 archive form focuses Project name when opened", async () => {
  await mount(<SettingsPage initialSection="Data" />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Archive this project" }),
  );
  expect(screen.getByRole("textbox", { name: "Project name" })).toHaveFocus();
});
it("F08 disabled Save explains the missing name in the shared tooltip", async () => {
  await mount(<MemberDialog close={vi.fn()} />);
  const save = screen.getByRole("button", { name: "Save teammate" });
  expect(save).toBeDisabled();
  const user = userEvent.setup();
  const wrapper = save.parentElement;
  if (!wrapper) throw new Error("Missing tooltip wrapper");
  await user.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Enter a name to save this teammate.",
  );
  await user.unhover(wrapper);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "New human");
  expect(save).toBeEnabled();
});
it("F08 pending and uncertain saves explain why resubmission is disabled", async () => {
  let fail!: (error: Error) => void;
  vi.spyOn(mockApi, "createMember").mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  await mount(<MemberDialog close={vi.fn()} />);
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Pending human",
  );
  const save = screen.getByRole("button", { name: "Save teammate" });
  const wrapper = save.parentElement;
  if (!wrapper) throw new Error("Missing tooltip wrapper");
  await user.click(save);
  await screen.findByRole("status");
  expect(save).toBeDisabled();
  await user.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Wait for the result",
  );
  await user.unhover(wrapper);
  await act(async () => {
    fail(new Error("Unconfirmed save"));
  });
  await waitFor(() =>
    expect(screen.getByText(/Could not confirm whether/)).toBeVisible(),
  );
  expect(save).toBeDisabled();
  await user.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Close and check the team before trying again.",
  );
  expect(mockApi.createMember).toHaveBeenCalledTimes(1);
});
