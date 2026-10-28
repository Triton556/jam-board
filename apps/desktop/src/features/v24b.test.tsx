import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { templates } from "../lib/project-template";
import { skillDestination } from "../lib/skill-setup";
import { BoardHeader } from "./board/BoardHeader";
import { ProjectTiming } from "./onboarding/ProjectTiming";
import { Welcome } from "./onboarding/Welcome";
import { ProjectSettings } from "./settings/ProjectSettings";
import { SkillSetup } from "./settings/SkillSetup";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("four template cards lead to the right fields and placeholders", async () => {
  const user = userEvent.setup();
  for (const t of templates) {
    wrap(<Welcome />);
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.className === "template-card"),
    ).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: t.label }));
    expect(screen.getByPlaceholderText(t.placeholder)).toBeVisible();
    for (const label of ["Start", "End", "Timezone"])
      expect(!!screen.queryByLabelText(label)).toBe(t.value === "game_jam");
    expect(!!screen.queryByLabelText("Milestone (optional)")).toBe(
      t.value === "gamedev" || t.value === "webapp",
    );
    expect(screen.getByLabelText("Your name")).toBeVisible();
    cleanup();
  }
});
it("timer, milestone and board copy follow the template", async () => {
  for (const t of templates) {
    const { unmount } = render(
      <ProjectTiming
        template={t.value}
        endsAt="2027-10-21T12:00:00Z"
        milestoneAt="2026-11-30T12:00:00Z"
      />,
    );
    expect(!!screen.queryByRole("timer")).toBe(t.value === "game_jam");
    expect(!!screen.queryByText("Milestone · Nov 30")).toBe(
      t.value === "gamedev" || t.value === "webapp",
    );
    unmount();
    await mockApi.updateProject({
      template: t.value,
      startsAt: "2026-10-20T00:00:00Z",
      endsAt: "2026-10-22T00:00:00Z",
    });
    wrap(<BoardHeader />);
    await screen.findByRole("heading", { name: new RegExp(t.heading) });
    expect(screen.getByText(t.note)).toBeVisible();
    cleanup();
  }
  render(<ProjectTiming template="webapp" endsAt={null} milestoneAt={null} />);
  expect(screen.queryByText(/Milestone/)).not.toBeInTheDocument();
});
it("template switching confirms first and preserves used tags", async () => {
  const user = userEvent.setup();
  const tags = await mockApi.listTags();
  wrap(<ProjectSettings />);
  await user.click(
    await screen.findByRole("combobox", { name: "Project template" }),
  );
  await user.click(screen.getByRole("option", { name: "Web app" }));
  const d = screen.getByRole("dialog");
  expect(
    within(d).getByText(
      "Tags already used stay; suggestions and the timer change.",
    ),
  ).toBeVisible();
  expect((await mockApi.getProject()).jam.template).toBe("game_jam");
  await user.click(within(d).getByRole("button", { name: "Switch template" }));
  await screen.findByText("frontend");
  expect((await mockApi.getProject()).jam.template).toBe("webapp");
  expect(await mockApi.listTags()).toEqual(tags);
});

it("destination preview is project-scoped and client-specific", () => {
  expect(skillDestination({ target: "C:/My project/", client: "codex" })).toBe(
    "C:/My project/.agents/skills/jam-board",
  );
  expect(skillDestination({ target: "C:/My project", client: "claude" })).toBe(
    "C:/My project/.claude/skills/jam-board",
  );
  expect(skillDestination({ target: "", client: "codex" })).toBeNull();
});
const validCheck = {
  version: "0.3.0-alpha.44",
  destination: "C:/project/.agents/skills/jam-board",
  status: "new",
  errors: [],
};
async function chooseProject() {
  const user = userEvent.setup();
  vi.spyOn(mockApi, "pickFolder").mockResolvedValue("C:/project");
  wrap(<SkillSetup />);
  await user.click(
    screen.getByRole("button", { name: "Choose project folder…" }),
  );
  return user;
}
it.each([
  "Existing files have no ownership receipt; migrate them separately",
  "An installed skill file was edited; preserve it before updating",
  "Choose an existing project folder",
])("blocked installation preserves the project: %s", async (message) => {
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue({
    ...validCheck,
    status: "blocked",
    errors: [message],
  });
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mockApi.calls.some((c) => c.command === "run_skill")).toBe(false);
});
it("reviews the exact destination, then explicitly installs and verifies only Jam Board", async () => {
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue(validCheck);
  const user = await chooseProject();
  expect(
    screen.queryByRole("button", { name: "Choose playbook folder…" }),
  ).toBeNull();
  expect(
    screen.queryByRole("radio", { name: "Whole agent-playbook" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(validCheck.destination)).toBeVisible();
  expect(within(dialog).getByText(/only the board skill/)).toBeVisible();
  expect(mockApi.calls.filter((c) => c.command === "run_skill")).toHaveLength(
    1,
  );
  await user.click(within(dialog).getByRole("button", { name: "Install" }));
  await screen.findByText("Jam Board skill installed · files verified");
  expect(
    mockApi.calls.filter((c) => c.command === "run_skill").map((c) => c.input),
  ).toEqual(
    ["plan", "install", "verify"].map((step) => ({
      input: { target: "C:/project", client: "codex" },
      step,
    })),
  );
});
it("cancelling the review writes nothing and permits changing the client", async () => {
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue(validCheck);
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  expect(mockApi.calls.filter((c) => c.command === "run_skill")).toHaveLength(
    1,
  );
  await user.click(screen.getByRole("combobox", { name: "Skill client" }));
  await user.click(screen.getByRole("option", { name: "Claude Code" }));
  expect(screen.getByText("C:/project/.claude/skills/jam-board")).toBeVisible();
  expect(screen.queryByText(/Bundled skill/)).toBeNull();
});
it("checking is visibly pending, prevents repeated requests and recovers after failure", async () => {
  let reject!: (e: Error) => void;
  const check = vi
    .spyOn(mockApi, "skillCheck")
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(validCheck);
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  const pending = screen.getByRole("button", {
    name: "Checking installation…",
  });
  expect(pending).toBeDisabled();
  expect(pending).toHaveAttribute("aria-busy", "true");
  await user.click(pending);
  expect(check).toHaveBeenCalledTimes(1);
  reject(Error("Folder unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Folder unavailable",
  );
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
});
it("a failed install does not run verification or claim success", async () => {
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue(validCheck);
  const run = vi
    .spyOn(mockApi, "runSkill")
    .mockResolvedValueOnce({ exitCode: 0, cancelled: false, timedOut: false })
    .mockResolvedValueOnce({ exitCode: 1, cancelled: false, timedOut: false });
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Install",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("install failed");
  expect(run.mock.calls.map((call) => call[1])).toEqual(["plan", "install"]);
  expect(
    screen.queryByText("Jam Board skill installed · files verified"),
  ).toBeNull();
});
it("upgrade review explains backup, while current installation offers verification", async () => {
  const check = vi
    .spyOn(mockApi, "skillCheck")
    .mockResolvedValue({ ...validCheck, status: "upgrade" });
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  expect(
    within(await screen.findByRole("dialog")).getByText(
      /backed up in the project/,
    ),
  ).toBeVisible();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
  );
  check.mockResolvedValue({ ...validCheck, status: "current" });
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  expect(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Verify",
    }),
  ).toBeVisible();
});
it("cancelling a pending review never opens confirmation or writes files", async () => {
  let finish!: (value: typeof validCheck) => void;
  vi.spyOn(mockApi, "skillCheck").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  finish(validCheck);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Installation review cancelled",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mockApi.calls.some((c) => c.command === "run_skill")).toBe(false);
  expect(
    screen.getByRole("button", { name: "Review installation" }),
  ).toBeEnabled();
});
it("verification failure is not presented as an installed success", async () => {
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue(validCheck);
  vi.spyOn(mockApi, "runSkill")
    .mockResolvedValueOnce({ exitCode: 0, cancelled: false, timedOut: false })
    .mockResolvedValueOnce({ exitCode: 0, cancelled: false, timedOut: false })
    .mockResolvedValueOnce({ exitCode: 1, cancelled: false, timedOut: false });
  const user = await chooseProject();
  await user.click(screen.getByRole("button", { name: "Review installation" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Install",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("verify failed");
  expect(
    screen.queryByText("Jam Board skill installed · files verified"),
  ).toBeNull();
});
