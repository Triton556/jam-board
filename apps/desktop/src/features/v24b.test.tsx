import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { templates } from "../lib/project-template";
import { skillCommands } from "../lib/skill-setup";
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
it("preview uses exact profiles and clients with escaped PowerShell arguments", () => {
  for (const profile of ["jam-board", "full"])
    for (const client of ["codex", "claude"]) {
      expect(
        skillCommands({
          profile,
          client,
          target: "C:\\My project's folder",
          playbook: "C:\\Playbook clone",
        }),
      ).toBe(
        ["plan", "install"]
          .map(
            (step) =>
              `& py -3 -B 'C:\\Playbook clone/harness.py' ${step} --client ${client} --target 'C:\\My project''s folder' --profile ${profile}`,
          )
          .join("\n"),
      );
    }
});
it.each([
  "Choose a local agent-playbook folder",
  "The playbook folder must contain harness.py and manifest.json",
  "Python 3.12 or newer is required",
])("install stays disabled: %s", async (message) => {
  const user = userEvent.setup();
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue({
    version: null,
    python: null,
    pythonVersion: null,
    errors: [message],
  });
  wrap(<SkillSetup />);
  await user.click(screen.getByRole("button", { name: "Check setup" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("button", { name: "Run install" })).toBeDisabled();
});
it("copies commands and runs plan, explicit install, then verify", async () => {
  const user = userEvent.setup();
  vi.spyOn(mockApi, "pickFolder")
    .mockResolvedValueOnce("C:/project")
    .mockResolvedValueOnce("C:/playbook");
  vi.spyOn(mockApi, "skillCheck").mockResolvedValue({
    version: "1.3.0",
    python: "py -3",
    pythonVersion: "Python 3.14.5",
    errors: [],
  });
  wrap(<SkillSetup />);
  await user.click(
    screen.getByRole("button", { name: "Choose project folder…" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Choose playbook folder…" }),
  );
  await user.click(screen.getByRole("button", { name: "Check setup" }));
  await screen.findByText("Playbook 1.3.0");
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toBe(
    skillCommands({
      playbook: "C:/playbook",
      target: "C:/project",
      client: "codex",
      profile: "jam-board",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Run install" }));
  const dialog = await screen.findByRole("dialog");
  expect(mockApi.calls.filter((c) => c.command === "run_skill")).toHaveLength(
    1,
  );
  await user.click(within(dialog).getByRole("button", { name: "Install" }));
  await screen.findByText("Installed · verified");
  expect(
    mockApi.calls
      .filter((c) => c.command === "run_skill")
      .map((c) => (c.input as { step: string }).step),
  ).toEqual(["plan", "install", "verify"]);
});
it("Claude Code UI maps to claude in generated and copied commands for both profiles", async () => {
  const user = userEvent.setup();
  vi.spyOn(mockApi, "pickFolder")
    .mockResolvedValueOnce("C:/target")
    .mockResolvedValueOnce("C:/playbook");
  wrap(<SkillSetup />);
  await user.click(
    screen.getByRole("button", { name: "Choose project folder…" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Choose playbook folder…" }),
  );
  expect(
    screen.getByText(
      "Installing records a receipt in this playbook folder (.harness-state).",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "Skill client" }));
  await user.click(screen.getByRole("option", { name: "Claude Code" }));
  for (const label of ["Jam Board skill", "Whole agent-playbook"]) {
    await user.click(screen.getByRole("radio", { name: label }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    const copied = await navigator.clipboard.readText();
    expect(copied.match(/--client claude(?=\s|$)/g)).toHaveLength(2);
    expect(copied).not.toContain("claude-code");
    expect(copied).toContain(
      label === "Jam Board skill" ? "--profile jam-board" : "--profile full",
    );
  }
});
