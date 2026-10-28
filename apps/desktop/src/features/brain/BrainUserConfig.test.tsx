import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentLaunchOptions,
  UserConfigChoice,
} from "../../lib/agent-dock-api";
import { BrainLaunchLogs, launchSteps } from "./BrainLaunchLogs";
import { BrainLaunchWarnings } from "./BrainLaunchWarnings";
import { BrainProviderError } from "./BrainProviderError";
import { useUserConfigLaunch } from "./BrainUserConfig";
import { usageResetTime } from "./brain-retry";
import { useBrainState } from "./brain-store";

const description =
  "Exact backend description: global instructions can remain; authentication is preserved.";
const options: AgentLaunchOptions = {
  userConfigDefault: "ask",
  excludeSupported: true,
  excludeDescription: description,
};
const at = "2026-10-28T06:00:00Z";
function Harness({
  launch,
  kind = "acp",
}: {
  launch(choice?: UserConfigChoice): Promise<void>;
  kind?: string;
}) {
  const config = useUserConfigLaunch();
  return (
    <>
      <button
        type="button"
        onClick={() => void config.request("fixture", kind, launch)}
      >
        Launch
      </button>
      {config.view}
    </>
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  useBrainState.setState({ projectId: "project", launchWarnings: {} });
  vi.spyOn(agentDockApi, "launchOptions").mockResolvedValue(options);
});
it("O1 Ask displays the backend description; Cancel and Escape launch nothing and return focus", async () => {
  const launch = vi.fn().mockResolvedValue(undefined);
  render(<Harness launch={launch} />);
  screen.getByText("Launch").focus();
  fireEvent.click(screen.getByText("Launch"));
  expect(await screen.findByText(description)).toBeVisible();
  expect(launch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel"));
  await waitFor(() => expect(screen.getByText("Launch")).toHaveFocus());
  fireEvent.click(screen.getByText("Launch"));
  fireEvent.keyDown(await screen.findByText(description), { key: "Escape" });
  expect(screen.queryByText(description)).toBeNull();
  expect(launch).not.toHaveBeenCalled();
});
it.each(["include", "exclude"] as const)(
  "O1 Ask dispatches %s exactly once",
  async (choice) => {
    const launch = vi.fn().mockResolvedValue(undefined);
    render(<Harness launch={launch} kind="terminal" />);
    fireEvent.click(screen.getByText("Launch"));
    const button = await screen.findByRole("button", {
      name: choice === "include" ? "Use global config" : "Don't use",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(launch).toHaveBeenCalledExactlyOnceWith(choice));
  },
);
it.each(["include", "exclude"] as const)(
  "O1 saved %s skips the question but still needs Launch",
  async (choice) => {
    vi.mocked(agentDockApi.launchOptions).mockResolvedValue({
      ...options,
      userConfigDefault: choice,
    });
    const launch = vi.fn().mockResolvedValue(undefined);
    render(<Harness launch={launch} />);
    expect(launch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Launch"));
    await waitFor(() => expect(launch).toHaveBeenCalledExactlyOnceWith(choice));
    expect(screen.queryByText(description)).toBeNull();
  },
);
it("O1 a project A/B/A switch discards a pending config read", async () => {
  let resolve!: (value: AgentLaunchOptions) => void;
  vi.mocked(agentDockApi.launchOptions).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const launch = vi.fn();
  render(<Harness launch={launch} />);
  fireEvent.click(screen.getByText("Launch"));
  act(() => useBrainState.setState({ projectId: "other" }));
  act(() => useBrainState.setState({ projectId: "project" }));
  await act(async () => resolve({ ...options, userConfigDefault: "include" }));
  expect(launch).not.toHaveBeenCalled();
  expect(screen.queryByText(description)).toBeNull();
});
it("B7 the latest state replaces a running step and skipped remains skipped", () => {
  const events = (["running", "ok", "skipped"] as const).map((state, seq) => ({
    kind: "launch_step" as const,
    sessionId: "one",
    seq,
    at,
    step: seq < 2 ? "process" : "mcp",
    state,
    message: state,
    startedAt: at,
    endedAt: at,
  }));
  expect(launchSteps(events).map((s) => s.state)).toEqual(["ok", "skipped"]);
});
it("B7 Logs reads retained backend diagnostics even when the frontend event buffer is empty", async () => {
  const fetch = vi.spyOn(agentDockApi, "launchLogs").mockResolvedValue([
    {
      kind: "launch_log",
      sessionId: "one",
      seq: 1,
      at,
      message: "retained adapter diagnostic",
    },
  ]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrainLaunchLogs
        sessionId="one"
        title="Fixture"
        events={[]}
        close={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("log", { name: "Launch timeline" }),
    ).toHaveTextContent("retained adapter diagnostic"),
  );
  expect(fetch).toHaveBeenCalledWith("one");
});
it("B8 warning is non-blocking, retained, dismissible and copy-path copies only the path", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const warning = {
    configPath: "C:/fixture/config.toml",
    suggestedFix: "Disable the stale entry after review.",
    serverName: "jam-board",
    injectedServerName: "jam-board-fixture",
  };
  render(
    <BrainLaunchWarnings
      sessionId="one"
      events={[
        {
          kind: "status",
          status: "ready",
          sessionId: "one",
          seq: 1,
          at,
          message: `Launch warning: ${JSON.stringify(warning)}`,
        },
      ]}
    />,
  );
  expect(screen.getByText(warning.suggestedFix)).toBeVisible();
  fireEvent.click(screen.getByText("Copy path"));
  await screen.findByText("Path copied");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(warning.configPath);
  fireEvent.click(screen.getByText("Dismiss"));
  expect(screen.queryByLabelText("Agent launch warning")).toBeNull();
});

it("Q1 BD23/BC12 unsupported exclusion explains itself on keyboard focus without launching", async () => {
  vi.mocked(agentDockApi.launchOptions).mockResolvedValue({
    ...options,
    excludeSupported: false,
  });
  const launch = vi.fn();
  render(<Harness launch={launch} />);
  fireEvent.click(screen.getByText("Launch"));
  const reason = await screen.findByRole("group", { name: "Don't use" });
  reason.focus();
  expect(reason).toHaveAccessibleDescription(
    "This agent does not support excluding global config",
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "This agent does not support excluding global config",
  );
  expect(screen.getByRole("button", { name: "Don't use" })).toBeDisabled();
  expect(launch).not.toHaveBeenCalled();
});

it("Q1 BD22/BC12 warning dismissal focuses the next Dismiss, then the composer", async () => {
  const events = ["first", "second"].map((name, seq) => ({
    kind: "status" as const,
    status: "ready" as const,
    sessionId: "one",
    seq,
    at,
    message: `Launch warning: ${JSON.stringify({ configPath: `C:/fixture/${name}.toml`, suggestedFix: "Review this entry." })}`,
  }));
  render(
    <div className="brain-dock">
      <BrainLaunchWarnings sessionId="one" events={events} />
      <div className="brain-composer">
        <textarea aria-label="Message the brain" />
      </div>
    </div>,
  );
  screen.getAllByText("Dismiss")[0]?.focus();
  fireEvent.click(screen.getAllByText("Dismiss")[0] as HTMLElement);
  await waitFor(() => expect(screen.getByText("Dismiss")).toHaveFocus());
  fireEvent.click(screen.getByText("Dismiss"));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Message the brain" }),
    ).toHaveFocus(),
  );
});
it("B9 uses resetsAt, omits an absent date and never offers Retry", () => {
  const event = {
    kind: "error" as const,
    sessionId: "one",
    seq: 1,
    at,
    code: "usage_limit" as const,
    retryable: true,
    message: "Quota exhausted",
    resetsAt: "2026-11-02T16:27:00",
  };
  const view = render(
    <BrainProviderError
      event={event}
      active
      ready
      failedTurn
      connections={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    `Usage limit reached — resets ${usageResetTime(new Date(event.resetsAt))}`,
  );
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByText("Switch connection")).toBeEnabled();
  view.rerender(
    <BrainProviderError
      event={{ ...event, resetsAt: null }}
      active
      connections={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveAccessibleName("Usage limit reached");
});
