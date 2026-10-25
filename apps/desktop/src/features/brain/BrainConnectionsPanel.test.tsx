import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import { useUiStore } from "../../lib/ui-store";
import { ConnectionEditor } from "./BrainConnectionsPanel";

vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
beforeEach(() => {
  vi.restoreAllMocks();
  resetMockDock();
  useUiStore.setState({ brainPreferences: {} });
});
async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}
it.each([
  ["OpenRouter", "High", "openrouter", "high"],
  ["OpenAI-style", "Medium", "openai", "medium"],
  ["z.ai", "Thinking on", "zai", "enabled"],
])(
  "API default model/effort and %s style persist when saved and reopened",
  async (style, effort, value, effortValue) => {
    const profile = (await mockDockApi.profiles()).find(
      (p) => p.id === "api-openrouter",
    );
    if (!profile) throw Error("Missing profile");
    const close = vi.fn();
    const view = render(
      <ConnectionEditor
        profile={{ ...profile, model: "fixture-model", effort: "auto" }}
        close={close}
        refresh={async () => {}}
      />,
    );
    await choose("Effort style", style);
    await choose("Default effort", effort);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    const saved = (await mockDockApi.profiles()).find(
      (p) => p.id === profile.id,
    );
    expect(saved).toMatchObject({
      model: "fixture-model",
      effortStyle: value,
      effort: effortValue,
    });
    view.unmount();
    render(
      <ConnectionEditor
        profile={saved ?? null}
        close={vi.fn()}
        refresh={async () => {}}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Default effort" }),
    ).toHaveTextContent(effort);
    expect(
      screen.getByRole("combobox", { name: "Effort style" }),
    ).toHaveTextContent(style);
  },
);
it("None hides API effort and ACP uses only cached values from that connection", async () => {
  const profiles = await mockDockApi.profiles();
  const api = profiles.find((p) => p.id === "api-openrouter"),
    acp = profiles.find((p) => p.id === "codex");
  if (!api || !acp) throw Error("Missing profiles");
  const view = render(
    <ConnectionEditor profile={api} close={vi.fn()} refresh={async () => {}} />,
  );
  await choose("Effort style", "None");
  expect(screen.queryByRole("combobox", { name: "Default effort" })).toBeNull();
  view.unmount();
  useUiStore.setState({
    brainPreferences: {
      [acp.id]: {
        options: [
          {
            id: "effort",
            category: "thought_level",
            name: "Effort",
            value: "high",
            values: [
              { value: "low", name: "Quick" },
              { value: "high", name: "Thorough" },
            ],
          },
        ],
      },
    },
  });
  const close = vi.fn();
  render(
    <ConnectionEditor
      profile={{ ...acp, effort: "high" }}
      close={close}
      refresh={async () => {}}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "Default effort" }),
  ).toHaveTextContent("Thorough");
  await choose("Default effort", "Quick");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(
    (await mockDockApi.profiles()).find((p) => p.id === acp.id)?.effort,
  ).toBe("low");
});
it("ACP without cached options explains the unavailable default effort instead of inventing choices", async () => {
  const profile = (await mockDockApi.profiles()).find((p) => p.id === "codex");
  render(
    <ConnectionEditor
      profile={profile ?? null}
      close={vi.fn()}
      refresh={async () => {}}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "Default effort" }),
  ).toBeDisabled();
  expect(
    screen.getByText(
      "Start a chat with this connection to load its effort options.",
    ),
  ).toBeVisible();
});
it.each(["not-json", "{}", '["ok",1]'])(
  "Arguments %s produces a plain field error with collapsed technical details and retains the draft",
  async (args) => {
    const close = vi.fn(),
      save = vi.spyOn(mockDockApi, "saveProfile");
    render(
      <ConnectionEditor
        profile={null}
        close={close}
        refresh={async () => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Fixture" },
    });
    fireEvent.change(screen.getByLabelText("Command"), {
      target: { value: "fixture-cli" },
    });
    const input = screen.getByLabelText("Arguments (JSON array)");
    fireEvent.change(input, { target: { value: args } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Arguments must be a JSON array of strings."),
    ).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Arguments must be a JSON array of strings.",
    );
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue(args);
    expect(save).not.toHaveBeenCalled();
    const details = alert.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("pre")).not.toBeVisible();
    fireEvent.click(within(alert).getByText("Details"));
    expect(details.querySelector("pre")).toBeVisible();
    fireEvent.change(input, { target: { value: '["--help"]' } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--help"],
        command: "fixture-cli",
        label: "Fixture",
      }),
    );
  },
);
it("Connection uses CustomSelect and environment errors name their field without losing text", async () => {
  render(
    <ConnectionEditor
      profile={null}
      close={vi.fn()}
      refresh={async () => {}}
    />,
  );
  expect(document.querySelector("select")).toBeNull();
  await choose("Connection", "Terminal command");
  expect(screen.queryByRole("combobox", { name: "Default effort" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Label"), {
    target: { value: "CLI" },
  });
  fireEvent.change(screen.getByLabelText("Command"), {
    target: { value: "cli" },
  });
  const env = screen.getByLabelText("Extra environment (non-secret)");
  fireEvent.change(env, { target: { value: "INVALID" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Use NAME=value for each environment line."),
  ).toBeVisible();
  expect(env).toHaveValue("INVALID");
  await waitFor(() => expect(env).toHaveFocus());
});
it("backend exceptions have a plain recovery sentence and collapsed technical Details", async () => {
  vi.spyOn(mockDockApi, "saveProfile").mockRejectedValueOnce(
    '{"code":"invalid","message":"fixture failure"}',
  );
  render(
    <ConnectionEditor
      profile={null}
      close={vi.fn()}
      refresh={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Label"), {
    target: { value: "CLI" },
  });
  fireEvent.change(screen.getByLabelText("Command"), {
    target: { value: "cli" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const error = await screen.findByRole("alert");
  expect(
    within(error).getByText(
      "Could not update the connection. Check the connection settings and try again.",
    ),
  ).toBeVisible();
  expect(error.querySelector("pre")).not.toBeVisible();
  fireEvent.click(within(error).getByText("Details"));
  expect(error.querySelector("pre")).toHaveTextContent('"code":"invalid"');
  expect(error.querySelector("pre")).toBeVisible();
});
