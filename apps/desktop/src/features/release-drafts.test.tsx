import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { PlanPage } from "./plan/PlanPage";
import { StoryDrawer } from "./plan/StoryDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/plan/JB-E1",
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  await mockApi.loadDemoJam();
});
function fixture(kind: "epic" | "story") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function View() {
    const [key, setKey] = useState(kind === "epic" ? "JB-E1" : "JB-S1");
    return (
      <>
        <button type="button" onClick={() => setKey("")}>
          Navigate away
        </button>
        <button
          type="button"
          onClick={() => setKey(kind === "epic" ? "JB-E1" : "JB-S1")}
        >
          Return
        </button>
        <button
          type="button"
          onClick={() => setKey(kind === "epic" ? "JB-E2" : "JB-S2")}
        >
          Other entity
        </button>
        {key &&
          (kind === "epic" ? (
            <PlanPage
              epicKey={key}
              search={{}}
              openTask={vi.fn()}
              openStory={vi.fn()}
            />
          ) : (
            <StoryDrawer
              storyKey={key}
              close={() => setKey("")}
              openTask={() => setKey("")}
            />
          ))}
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <View />
    </QueryClientProvider>,
  );
  return client;
}
it.each([
  ["epic", "Epic title", "title"],
  ["epic", "Worker model", "workerModel"],
  ["story", "Story title", "title"],
] as const)(
  "%s %s retains focused drafts, exposes conflicts, saves and follows clean data",
  async (kind, label, field) => {
    const client = fixture(kind);
    const key = kind === "epic" ? "JB-E1" : "JB-S1";
    const remote = async (patch: Record<string, string>) => {
      await act(async () => {
        if (kind === "epic") await mockApi.updateEpic(key, patch);
        else await mockApi.updateStory(key, patch);
        await client.invalidateQueries();
      });
    };
    const input = await screen.findByLabelText(label, {
      exact: true,
      selector: "input",
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Local unsaved draft" } });
    await remote(
      kind === "epic"
        ? { decidedMd: "Unrelated remote edit" }
        : { outcomeMd: "Unrelated remote edit" },
    );
    expect(screen.getByLabelText(label)).toBe(input);
    expect(input).toHaveValue("Local unsaved draft");
    await remote({ [field]: "Conflicting remote value" });
    expect(input).toHaveValue("Local unsaved draft");
    expect(await screen.findByText(/changed remotely/i)).toBeVisible();
    fireEvent.blur(input);
    const persisted = async () =>
      field === "workerModel"
        ? (await mockApi.getEpic(key)).epic.workerModel
        : kind === "epic"
          ? (await mockApi.getEpic(key)).epic.title
          : (await mockApi.getStory(key)).story.title;
    expect(await persisted()).toBe("Conflicting remote value");
    fireEvent.click(screen.getByRole("button", { name: `Save my ${label}` }));
    await waitFor(async () =>
      expect(await persisted()).toBe("Local unsaved draft"),
    );
    await remote({ [field]: "Clean authoritative value" });
    await waitFor(() =>
      expect(screen.getByLabelText(label)).toHaveValue(
        "Clean authoritative value",
      ),
    );
  },
);
it.each(["Close task", "Escape", "backdrop", "Navigate away", "Other entity"])(
  "acceptance draft survives %s and stays bound to its story",
  async (action) => {
    const other = (await mockApi.getStory("JB-S2")).story;
    fixture("story");
    const input = await screen.findByRole("textbox", { name: "Criterion 1" });
    fireEvent.change(input, {
      target: { value: "Story 1 retained acceptance" },
    });
    if (action === "Escape") fireEvent.keyDown(input, { key: "Escape" });
    else if (action === "backdrop") {
      const backdrop = document.querySelector(".drawer-backdrop");
      if (!backdrop) throw new Error("Drawer backdrop missing");
      fireEvent.click(backdrop);
    } else fireEvent.click(screen.getByRole("button", { name: action }));
    if (action === "Other entity") {
      await waitFor(() =>
        expect(
          screen.getByRole("textbox", { name: "Story title" }),
        ).toHaveValue(other.title),
      );
      expect(
        screen.getByRole("textbox", { name: "Criterion 1" }),
      ).not.toHaveValue("Story 1 retained acceptance");
    }
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Criterion 1" })).toHaveValue(
        "Story 1 retained acceptance",
      ),
    );
  },
);
it.each([
  ["epic", "Epic title", "title"],
  ["epic", "Worker model", "workerModel"],
  ["story", "Story title", "title"],
  ["story", "Criterion 1", "acceptance"],
] as const)(
  "%s %s keeps dirty and pending edits on their original entity",
  async (kind, label, field) => {
    fixture(kind);
    const key = kind === "epic" ? "JB-E1" : "JB-S1";
    const otherKey = kind === "epic" ? "JB-E2" : "JB-S2";
    const otherBefore =
      kind === "epic"
        ? await mockApi.getEpic(otherKey)
        : await mockApi.getStory(otherKey);
    let resolve!: () => void;
    const gate = new Promise<void>((yes) => {
      resolve = yes;
    });
    const originalEpic = mockApi.updateEpic.bind(mockApi);
    const originalStory = mockApi.updateStory.bind(mockApi);
    if (kind === "epic")
      vi.spyOn(mockApi, "updateEpic").mockImplementation(async (...args) => {
        await gate;
        return originalEpic(...args);
      });
    else
      vi.spyOn(mockApi, "updateStory").mockImplementation(async (...args) => {
        await gate;
        return originalStory(...args);
      });
    const input = await screen.findByLabelText(label, {
      exact: true,
      selector: "input",
    });
    fireEvent.change(input, { target: { value: "First submitted value" } });
    if (field === "acceptance")
      fireEvent.click(screen.getByRole("button", { name: "Save acceptance" }));
    else fireEvent.blur(input);
    await waitFor(() =>
      expect(
        kind === "epic" ? mockApi.updateEpic : mockApi.updateStory,
      ).toHaveBeenCalledTimes(1),
    );
    fireEvent.change(input, { target: { value: "Newer unsaved correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Other entity" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(label, { exact: true, selector: "input" }),
      ).not.toHaveValue("Newer unsaved correction"),
    );
    await act(async () => {
      resolve();
      await gate;
    });
    await waitFor(async () => {
      const first =
        kind === "epic"
          ? (await mockApi.getEpic(key)).epic
          : (await mockApi.getStory(key)).story;
      expect(
        field === "acceptance" && "acceptance" in first
          ? first.acceptance[0]?.criterion
          : field === "workerModel" && "workerModel" in first
            ? first.workerModel
            : first.title,
      ).toBe("First submitted value");
    });
    const otherAfter =
      kind === "epic"
        ? await mockApi.getEpic(otherKey)
        : await mockApi.getStory(otherKey);
    expect(otherAfter).toEqual(otherBefore);
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(label, { exact: true, selector: "input" }),
      ).toHaveValue("Newer unsaved correction"),
    );
    await waitFor(() =>
      expect(screen.queryByText(/changed remotely/i)).not.toBeInTheDocument(),
    );
    if (field === "acceptance")
      fireEvent.click(screen.getByRole("button", { name: "Save acceptance" }));
    else
      fireEvent.blur(
        screen.getByLabelText(label, { exact: true, selector: "input" }),
      );
    await waitFor(() =>
      expect(
        kind === "epic" ? mockApi.updateEpic : mockApi.updateStory,
      ).toHaveBeenCalledTimes(2),
    );
  },
);
