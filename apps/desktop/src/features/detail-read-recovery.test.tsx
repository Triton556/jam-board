import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { PlanPage } from "./plan/PlanPage";
import { StoryDrawer } from "./plan/StoryDrawer";
import { TaskDrawer } from "./task/TaskDrawer";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/plan/JB-E1",
  useBlocker: () => ({ status: "idle" }),
}));
type Kind = "epic" | "story";
const descriptor = (kind: Kind, index = 1) => ({
  label: kind === "epic" ? "Goal and audience" : "Outcome",
  key: `JB-${kind === "epic" ? "E" : "S"}${index}`,
  method: kind === "epic" ? ("getEpic" as const) : ("getStory" as const),
});
const page = (kind: Kind, key: string) =>
  kind === "epic" ? (
    <PlanPage
      epicKey={key}
      search={{}}
      openTask={() => {}}
      openStory={() => {}}
    />
  ) : (
    <StoryDrawer storyKey={key} close={() => {}} openTask={() => {}} />
  );
async function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const wrap = (node: React.ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  return { ...render(wrap(node)), client, wrap };
}
function noWrites() {
  expect(api.updateEpic).not.toHaveBeenCalled();
  expect(api.updateStory).not.toHaveBeenCalled();
  expect(api.updateTask).not.toHaveBeenCalled();
}
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  mockApi.calls.length = 0;
  vi.spyOn(api, "updateEpic").mockRejectedValue(new Error("Unexpected write"));
  vi.spyOn(api, "updateStory").mockRejectedValue(new Error("Unexpected write"));
  vi.spyOn(api, "updateTask").mockRejectedValue(new Error("Unexpected write"));
});
afterEach(() => vi.restoreAllMocks());

it.each(["epic", "story"] as const)(
  "cached %s failures and background recovery retain the exact Markdown draft and focus without blur or writes",
  async (kind) => {
    const u = userEvent.setup(),
      { label, key, method } = descriptor(kind);
    const { client } = await mount(page(kind, key));
    await u.click(await screen.findByRole("button", { name: `Edit ${label}` }));
    const input = screen.getByRole("textbox", { name: label });
    fireEvent.change(input, {
      target: { value: "Fictional unsaved detail draft" },
    });
    const cached = client.getQueryData([kind, key]);
    const read = vi.spyOn(api, method);
    for (let attempt = 0; attempt < 2; attempt++) {
      read.mockRejectedValueOnce(
        new Error(`Fictional ${kind} detail read failure`),
      );
      await act(async () => {
        await client.invalidateQueries({ queryKey: [kind, key] });
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        `Fictional ${kind} detail read failure`,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Showing the last loaded view",
      );
      expect(client.getQueryData([kind, key])).toEqual(cached);
      expect(screen.getByRole("textbox", { name: label })).toBe(input);
      expect(input).toHaveValue("Fictional unsaved detail draft");
      expect(input).toHaveFocus();
      noWrites();
    }
    // No click/blur: read recovery itself must not invoke the separate autosave contract.
    await act(async () => {
      await client.refetchQueries({ queryKey: [kind, key] });
    });
    await waitFor(() =>
      expect(client.getQueryState([kind, key])?.status).toBe("success"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: label })).toBe(input);
    expect(input).toHaveValue("Fictional unsaved detail draft");
    expect(input).toHaveFocus();
    noWrites();
  },
);

it.each(["epic", "story"] as const)(
  "%s initial no-data failure blocks the unavailable editor and exposes a real read retry",
  async (kind) => {
    const u = userEvent.setup(),
      { label, key, method } = descriptor(kind);
    vi.spyOn(api, method).mockRejectedValueOnce(
      new Error("Initial detail read failed"),
    );
    await mount(page(kind, key));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Initial detail read failed",
    );
    expect(
      screen.queryByRole("button", { name: `Edit ${label}` }),
    ).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: `Edit ${label}` }),
    ).toBeVisible();
    noWrites();
  },
);

it.each([
  ["epic", "success"],
  ["epic", "error"],
  ["story", "success"],
  ["story", "error"],
] as const)(
  "%s late %s from a former source cannot replace the new source's editor or draft",
  async (kind, outcome) => {
    const u = userEvent.setup(),
      first = descriptor(kind),
      next = descriptor(kind, 2);
    const { client, rerender, wrap } = await mount(page(kind, first.key));
    await screen.findByRole("button", { name: `Edit ${first.label}` });
    let settle = () => {};
    function hold<T>(saved: T) {
      return new Promise<T>((resolve, reject) => {
        settle = () =>
          outcome === "success"
            ? resolve(saved)
            : reject(new Error("Old source read failed"));
      });
    }
    if (kind === "epic") {
      const saved = await api.getEpic(first.key);
      vi.spyOn(api, "getEpic").mockReturnValueOnce(hold(saved));
    } else {
      const saved = await api.getStory(first.key);
      vi.spyOn(api, "getStory").mockReturnValueOnce(hold(saved));
    }
    let pending: Promise<void>;
    await act(async () => {
      pending = client.refetchQueries({ queryKey: [kind, first.key] });
    });
    rerender(wrap(page(kind, next.key)));
    await u.click(
      await screen.findByRole("button", { name: `Edit ${next.label}` }),
    );
    const input = screen.getByRole("textbox", { name: next.label });
    fireEvent.change(input, {
      target: { value: "New source draft, do not replace" },
    });
    await act(async () => {
      settle();
      await pending;
    });
    expect(screen.getByRole("textbox", { name: next.label })).toBe(input);
    expect(input).toHaveValue("New source draft, do not replace");
    expect(input).toHaveFocus();
    expect(
      screen.queryByText("Old source read failed"),
    ).not.toBeInTheDocument();
    noWrites();
  },
);

it.each(["epic", "story"] as const)(
  "%s still saves once on an ordinary user blur after cached-error recovery",
  async (kind) => {
    const u = userEvent.setup(),
      { label, key, method } = descriptor(kind);
    const writer = kind === "epic" ? "updateEpic" : "updateStory";
    vi.mocked(api[writer]).mockRestore();
    const write = vi.spyOn(api, writer);
    const { client } = await mount(page(kind, key));
    await u.click(await screen.findByRole("button", { name: `Edit ${label}` }));
    const input = screen.getByRole("textbox", { name: label });
    fireEvent.change(input, {
      target: { value: "Explicit ordinary blur save" },
    });
    vi.spyOn(api, method).mockRejectedValueOnce(
      new Error("Temporary detail failure"),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: [kind, key] });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary detail failure",
    );
    expect(input).toBeInTheDocument();
    await act(async () => {
      await client.refetchQueries({ queryKey: [kind, key] });
    });
    expect(input).toHaveFocus();
    expect(write).not.toHaveBeenCalled();
    await u.tab();
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(key, {
      [kind === "epic" ? "goalMd" : "outcomeMd"]: "Explicit ordinary blur save",
    });
  },
);

it("TaskDrawer data-first negative control retains its title across a cached failure and recovery", async () => {
  const { client } = await mount(
    <TaskDrawer taskKey="JB-7" close={() => {}} />,
  );
  const input = await screen.findByRole("textbox", { name: "Task title" });
  input.focus();
  fireEvent.change(input, {
    target: { value: "Fictional unsaved task title" },
  });
  vi.spyOn(api, "getTask").mockRejectedValueOnce(
    new Error("Temporary task failure"),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["task", "JB-7"] });
  });
  expect(client.getQueryState(["task", "JB-7"])?.status).toBe("error");
  expect(screen.getByRole("textbox", { name: "Task title" })).toBe(input);
  expect(input).toHaveFocus();
  await act(async () => {
    await client.refetchQueries({ queryKey: ["task", "JB-7"] });
  });
  expect(input).toHaveValue("Fictional unsaved task title");
  expect(input).toHaveFocus();
  noWrites();
});
