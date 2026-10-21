import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { SavedMarkdown } from "./plan/PlanningControls";
import { StoryDrawer } from "./plan/StoryDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  await mockApi.resetDemo();
});
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function markdown(saveGate = deferred()) {
  let persisted = "Original text";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const save = vi.fn(async (value: string) => {
    if (save.mock.calls.length === 1) await saveGate.promise;
    persisted = value;
  });
  function Field() {
    const query = useQuery({
      queryKey: ["epic", "draft-test"],
      queryFn: async () => ({ text: persisted }),
    });
    return (
      query.data && (
        <SavedMarkdown label="Goal" value={query.data.text} save={save} />
      )
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Field />
    </QueryClientProvider>,
  );
  return {
    save,
    saveGate,
    persisted: () => persisted,
    remote: async (text: string) => {
      persisted = text;
      await client.invalidateQueries({ queryKey: ["epic"] });
    },
  };
}
it("a deferred Markdown save preserves newer typing, which can then be saved", async () => {
  const h = markdown(),
    user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "First saved text" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "s",
    ctrlKey: true,
  });
  await waitFor(() => expect(h.save).toHaveBeenCalledWith("First saved text"));
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "New text typed while first save is pending" },
  });
  await act(async () => {
    h.saveGate.resolve();
    await h.saveGate.promise;
  });
  await waitFor(() => expect(h.persisted()).toBe("First saved text"));
  expect(screen.getByRole("textbox", { name: "Goal" })).toHaveValue(
    "New text typed while first save is pending",
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "s",
    metaKey: true,
  });
  await waitFor(() =>
    expect(h.persisted()).toBe("New text typed while first save is pending"),
  );
  await act(() => h.remote("A legitimate remote refresh"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit Goal" })).toHaveTextContent(
      "A legitimate remote refresh",
    ),
  );
});

it("two saves made while the first is pending persist the newer Markdown value", async () => {
  const h = markdown(),
    user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "First pending save" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "s",
    ctrlKey: true,
  });
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "Second pending save" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "s",
    ctrlKey: true,
  });
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  await act(async () => {
    h.saveGate.resolve();
    await h.saveGate.promise;
  });
  await waitFor(() => expect(h.persisted()).toBe("Second pending save"));
  expect(screen.getByRole("textbox", { name: "Goal" })).toHaveValue(
    "Second pending save",
  );
});
it("Markdown errors preserve newer typing; Escape cancels only the open edit and blur retries", async () => {
  const h = markdown(),
    user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "Canceled edit" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "Escape",
  });
  expect(h.save).not.toHaveBeenCalled();
  await act(() => h.remote("Remote before edit"));
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "Failed save" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "s",
    ctrlKey: true,
  });
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), {
    target: { value: "Newer correction" },
  });
  await act(async () => {
    h.saveGate.reject(new Error("Save rejected"));
    await h.saveGate.promise.catch(() => {});
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Save rejected");
  expect(screen.getByRole("textbox", { name: "Goal" })).toHaveValue(
    "Newer correction",
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Goal" }), {
    key: "Escape",
  });
  expect(screen.getByRole("button", { name: "Edit Goal" })).toHaveTextContent(
    "Failed save",
  );
  await user.click(screen.getByRole("button", { name: "Edit Goal" }));
  fireEvent.blur(screen.getByRole("textbox", { name: "Goal" }));
  await waitFor(() => expect(h.persisted()).toBe("Failed save"));
});
function storyView(key = "JB-S1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const node = (storyKey: string) => (
    <QueryClientProvider client={client}>
      <StoryDrawer storyKey={storyKey} close={vi.fn()} openTask={vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(node(key));
  return {
    client,
    view,
    switchTo: (next: string) => view.rerender(node(next)),
  };
}
it.each(["acceptance", "outcomeMd"] as const)(
  "queued Story %s saves retain their submitted target after navigation",
  async (field) => {
    const original = mockApi.updateStory.bind(mockApi);
    const gates = [deferred(), deferred()];
    const update = vi
      .spyOn(mockApi, "updateStory")
      .mockImplementation(async (key, patch) => {
        await gates[update.mock.calls.length - 1]?.promise;
        return original(key, patch);
      });
    const otherBefore = (await mockApi.getStory("JB-S2")).story;
    const { switchTo } = storyView();
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "Criterion 1" });
    const submit = async (value: string) => {
      if (field === "acceptance") {
        fireEvent.change(screen.getByRole("textbox", { name: "Criterion 1" }), {
          target: { value },
        });
        await user.click(
          screen.getByRole("button", { name: "Save acceptance" }),
        );
      } else {
        await user.click(screen.getByRole("button", { name: "Edit Outcome" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Outcome" }), {
          target: { value },
        });
        fireEvent.keyDown(screen.getByRole("textbox", { name: "Outcome" }), {
          key: "s",
          ctrlKey: true,
        });
      }
    };
    await submit("First save for Story 1");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await submit("Second save for Story 1");
    // The second save is queued, rather than concurrently hitting the API.
    expect(update).toHaveBeenCalledTimes(1);
    switchTo("JB-S2");
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Story title" })).toHaveValue(
        otherBefore.title,
      ),
    );
    await act(async () => gates[0]?.resolve());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await act(async () => gates[1]?.resolve());
    await waitFor(async () => {
      const first = (await mockApi.getStory("JB-S1")).story;
      expect(
        field === "acceptance"
          ? first.acceptance[0]?.criterion
          : first.outcomeMd,
      ).toBe("Second save for Story 1");
    });
    expect(update.mock.calls.map(([key]) => key)).toEqual(["JB-S1", "JB-S1"]);
    const otherAfter = (await mockApi.getStory("JB-S2")).story;
    expect(otherAfter.acceptance).toEqual(otherBefore.acceptance);
    expect(otherAfter.outcomeMd).toBe(otherBefore.outcomeMd);
    switchTo("JB-S1");
    await waitFor(() =>
      field === "acceptance"
        ? expect(
            screen.getByRole("textbox", { name: "Criterion 1" }),
          ).toHaveValue("Second save for Story 1")
        : expect(
            screen.getByRole("button", { name: "Edit Outcome" }),
          ).toHaveTextContent("Second save for Story 1"),
    );
  },
);
it("saving Outcome and background refresh preserve unsaved acceptance and newer intent", async () => {
  const { client } = storyView(),
    user = userEvent.setup();
  const field = await screen.findByRole("textbox", {
    name: "Criterion 1",
  });
  fireEvent.change(field, {
    target: { value: "New user criterion that is not saved yet" },
  });
  await user.click(screen.getByRole("button", { name: "Edit Outcome" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Outcome" }), {
    target: { value: "An unrelated saved outcome for the same story" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "Outcome" }));
  await waitFor(async () =>
    expect((await mockApi.getStory("JB-S1")).story.outcomeMd).toBe(
      "An unrelated saved outcome for the same story",
    ),
  );
  expect(screen.getByRole("textbox", { name: "Criterion 1" })).toHaveValue(
    "New user criterion that is not saved yet",
  );
  const latest = (await mockApi.getStory("JB-S1")).story;
  await act(async () => {
    await mockApi.updateStory("JB-S1", {
      outcomeMd: "Newer remote intent",
      acceptance: latest.acceptance.map((a, i) =>
        i ? a : { ...a, criterion: "Remote criterion" },
      ),
    });
    await client.invalidateQueries({ queryKey: ["story"] });
  });
  expect(screen.getByRole("textbox", { name: "Criterion 1" })).toHaveValue(
    "New user criterion that is not saved yet",
  );
  await user.click(screen.getByRole("button", { name: "Save acceptance" }));
  await waitFor(async () =>
    expect(
      (await mockApi.getStory("JB-S1")).story.acceptance[0]?.criterion,
    ).toBe("New user criterion that is not saved yet"),
  );
  expect((await mockApi.getStory("JB-S1")).story.outcomeMd).toBe(
    "Newer remote intent",
  );
});
it("clean acceptance follows remote data, validates saves and retains dirty values on Story switch", async () => {
  const { client, switchTo, view } = storyView();
  await screen.findByRole("textbox", { name: "Criterion 1" });
  const current = (await mockApi.getStory("JB-S1")).story;
  await act(async () => {
    await mockApi.updateStory("JB-S1", {
      acceptance: current.acceptance.map((a, i) =>
        i ? a : { ...a, criterion: "Clean remote acceptance" },
      ),
    });
    await client.invalidateQueries({ queryKey: ["story"] });
  });
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Criterion 1" })).toHaveValue(
      "Clean remote acceptance",
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Criterion 1" }), {
    target: { value: "" },
  });
  expect(
    screen.getByRole("button", { name: "Save acceptance" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Criterion 1" }), {
    target: { value: "Unsaved first Story" },
  });
  const other = (await mockApi.getStory("JB-S2")).story;
  switchTo("JB-S2");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Criterion 1" })).toHaveValue(
      other.acceptance[0]?.criterion ?? "",
    ),
  );
  switchTo("JB-S1");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Criterion 1" })).toHaveValue(
      "Unsaved first Story",
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Criterion 1" }), {
    target: { value: "Discard by closing" },
  });
  view.unmount();
  storyView();
  expect(
    await screen.findByRole("textbox", { name: "Criterion 1" }),
  ).toHaveValue("Clean remote acceptance");
});

it("an acceptance save error retains the draft for correction and retry", async () => {
  const original = mockApi.updateStory.bind(mockApi);
  let rejectAcceptance = true;
  vi.spyOn(mockApi, "updateStory").mockImplementation(async (key, patch) => {
    if (patch.acceptance && rejectAcceptance) {
      rejectAcceptance = false;
      throw new Error("Acceptance save rejected");
    }
    return original(key, patch);
  });
  storyView();
  const user = userEvent.setup();
  const field = await screen.findByRole("textbox", {
    name: "Criterion 1",
  });
  fireEvent.change(field, { target: { value: "Criteria to retry" } });
  await user.click(screen.getByRole("button", { name: "Save acceptance" }));
  expect(await screen.findByText("Acceptance save rejected")).toBeVisible();
  expect(field).toHaveValue("Criteria to retry");
  fireEvent.change(field, { target: { value: "Corrected retry" } });
  await user.click(screen.getByRole("button", { name: "Save acceptance" }));
  await waitFor(async () =>
    expect(
      (await mockApi.getStory("JB-S1")).story.acceptance[0]?.criterion,
    ).toBe("Corrected retry"),
  );
});
