import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PlanningInput } from "./plan/PlanningInput";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function mount(save: (value: string) => Promise<unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["app"], { jam: { id: "project-a" } });
  const view = (identity = "epic-a:title", value = "Original") => (
    <QueryClientProvider client={client}>
      <PlanningInput
        identity={identity}
        label="Epic title"
        value={value}
        save={save}
      />
      <button type="button">Next field</button>
    </QueryClientProvider>
  );
  const rendered = render(view());
  return {
    ...rendered,
    client,
    scope: (id: string, value?: string) => rendered.rerender(view(id, value)),
  };
}
async function edit(value: string) {
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Epic title" });
  await user.clear(input);
  await user.type(input, value);
  await user.tab();
  return { user, input };
}
it("P02: blur save announces pending, then acknowledgement without focus theft", async () => {
  const gate = deferred(),
    save = vi.fn(() => gate.promise);
  mount(save);
  const { input } = await edit("New title");
  expect(save).toHaveBeenCalledExactlyOnceWith("New title");
  expect(screen.getByRole("status")).toHaveTextContent("Saving Epic title…");
  expect(input).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("Epic title saved.")).toBeNull();
  await act(async () => gate.resolve());
  expect(await screen.findByText("Epic title saved.")).toHaveAttribute(
    "role",
    "status",
  );
  expect(screen.getByRole("button", { name: "Next field" })).toHaveFocus();
  expect(input).toHaveAttribute("aria-busy", "false");
});
it("P02: acknowledgement of an earlier value does not claim newer typing was saved", async () => {
  const gate = deferred(),
    save = vi.fn(() => gate.promise);
  mount(save);
  const { user, input } = await edit("First title");
  await user.click(input);
  await user.clear(input);
  await user.type(input, "Newer unsaved title");
  await act(async () => gate.resolve());
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Earlier change saved; newer changes are not saved yet.",
  );
  expect(input).toHaveValue("Newer unsaved title");
  expect(input).toHaveFocus();
  expect(save).toHaveBeenCalledTimes(1);
});
it("P02: dispatched failure is unconfirmed, retains the draft, and does not claim success", async () => {
  const gate = deferred(),
    save = vi.fn(() => gate.promise);
  mount(save);
  const { input } = await edit("Retained title");
  await act(async () => gate.reject(new Error("Fictional lost response")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Save outcome is unconfirmed. Your draft is kept.",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Fictional lost response",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Draft kept; save not confirmed.",
  );
  expect(input).toHaveValue("Retained title");
  expect(screen.queryByText("Epic title saved.")).toBeNull();
  expect(save).toHaveBeenCalledTimes(1);
});
it("P02/AS03: project ABA suppresses a late save receipt", async () => {
  const gate = deferred();
  const h = mount(vi.fn(() => gate.promise));
  await edit("Project A title");
  act(() => {
    h.client.setQueryData(["app"], { jam: { id: "project-b" } });
    h.client.setQueryData(["app"], { jam: { id: "project-a" } });
  });
  await act(async () => gate.resolve());
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(screen.queryByText("Epic title saved.")).toBeNull();
});
it("P02/AS03: field ABA cannot publish an old completion into the reopened field", async () => {
  const gate = deferred();
  const h = mount(vi.fn(() => gate.promise));
  await edit("Old field draft");
  h.scope("epic-b:title");
  h.scope("epic-a:title");
  await act(async () => gate.resolve());
  expect(screen.queryByText("Epic title saved.")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Epic title" })).toHaveValue(
    "Old field draft",
  );
});
it("P02/AS03: unmount acknowledges unchanged retained text without publishing a late saved receipt", async () => {
  const gate = deferred();
  const h = mount(vi.fn(() => gate.promise));
  await edit("Unmounted draft");
  h.unmount();
  await act(async () => gate.resolve());
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    h.client.getQueryData(["planning-draft", "epic-a:title"]),
  ).toMatchObject({ draft: "Unmounted draft", dirty: false });
});
it("P02/AS03: a queued save invalidated before dispatch is not sent or described as uncertain", async () => {
  const gate = deferred(),
    save = vi.fn(() => gate.promise);
  const h = mount(save);
  const { user, input } = await edit("First");
  await user.click(input);
  await user.clear(input);
  await user.type(input, "Queued");
  await user.tab();
  expect(save).toHaveBeenCalledTimes(1);
  act(() => {
    h.client.setQueryData(["app"], { jam: { id: "project-b" } });
    h.client.setQueryData(["app"], { jam: { id: "project-a" } });
  });
  await act(async () => gate.resolve());
  await waitFor(() => expect(h.client.isMutating()).toBe(0));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(input).toHaveValue("Queued");
});

it("P02: missing project at dispatch refuses save and keeps the draft with not-sent feedback", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { client } = mount(save);
  act(() => client.removeQueries({ queryKey: ["app"] }));
  const { input } = await edit("Local draft without project");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Save was not sent."),
  );
  expect(save).not.toHaveBeenCalled();
  expect(input).toHaveValue("Local draft without project");
  expect(screen.queryByText("Epic title saved.")).toBeNull();
});

it("P02: confirmed departed field advances only its baseline so newer retained typing can be intentionally saved", async () => {
  const gate = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(gate.promise)
    .mockResolvedValue(undefined);
  const h = mount(save);
  const { user, input } = await edit("First acknowledged");
  await user.click(input);
  await user.clear(input);
  await user.type(input, "Newer retained typing");
  h.scope("epic-b:title");
  await act(async () => gate.resolve());
  expect(
    h.client.getQueryData(["planning-draft", "epic-a:title"]),
  ).toMatchObject({
    baseline: "First acknowledged",
    draft: "Newer retained typing",
    dirty: true,
  });
  expect(screen.queryByText("Epic title saved.")).toBeNull();
  h.scope("epic-a:title", "First acknowledged");
  const returned = screen.getByRole("textbox", { name: "Epic title" });
  expect(returned).toHaveValue("Newer retained typing");
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(returned);
  await user.tab();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith("Newer retained typing");
});
it.each([
  "project ABA",
  "unmounted project ABA",
  "recreated cache",
  "new remote source",
] as const)(
  "P02/AS03: departed completion cannot acknowledge %s",
  async (reason) => {
    const gate = deferred();
    const h = mount(vi.fn(() => gate.promise));
    const { user, input } = await edit("First acknowledged");
    await user.click(input);
    await user.clear(input);
    await user.type(input, "Newer kept");
    if (reason === "unmounted project ABA") h.unmount();
    else h.scope("epic-b:title");
    const key = ["planning-draft", "epic-a:title"];
    const retained = h.client.getQueryData<{
      source: string;
      baseline: string;
      draft: string;
      dirty: boolean;
    }>(key);
    if (!retained) throw new Error("Missing retained fixture draft");
    act(() => {
      if (reason === "project ABA" || reason === "unmounted project ABA") {
        h.client.setQueryData(["app"], { jam: { id: "project-b" } });
        h.client.setQueryData(["app"], { jam: { id: "project-a" } });
      } else if (reason === "recreated cache") {
        h.client.removeQueries({ queryKey: key, exact: true });
        h.client.setQueryData(key, { ...retained, draft: "Recreated draft" });
      } else
        h.client.setQueryData(key, {
          ...retained,
          source: "Other author's saved value",
        });
    });
    const before = h.client.getQueryData(key);
    await act(async () => gate.resolve());
    expect(h.client.getQueryData(key)).toEqual(before);
    expect(screen.queryByText("Epic title saved.")).toBeNull();
  },
);

it.each(["success", "failure", "not sent"] as const)(
  "P02: attempt project watcher is released after %s",
  async (outcome) => {
    const gate = deferred();
    const h = mount(vi.fn(() => gate.promise));
    const cache = h.client.getQueryCache();
    const originalSubscribe = cache.subscribe.bind(cache);
    let active = 0;
    const spy = vi.spyOn(cache, "subscribe").mockImplementation((listener) => {
      active++;
      const stop = originalSubscribe(listener);
      return () => {
        active--;
        stop();
      };
    });
    if (outcome === "not sent")
      act(() => h.client.removeQueries({ queryKey: ["app"] }));
    await edit("Watcher cleanup draft");
    if (outcome !== "not sent") {
      expect(active).toBe(1);
      await act(async () => {
        if (outcome === "success") gate.resolve();
        else gate.reject(new Error("Fictional failure"));
      });
    }
    await waitFor(() => expect(h.client.isMutating()).toBe(0));
    expect(active).toBe(0);
    spy.mockRestore();
  },
);

it("P02: departed confirmed value without newer typing returns clean and does not save again on blur", async () => {
  const gate = deferred();
  const save = vi.fn(() => gate.promise);
  const h = mount(save);
  await edit("Confirmed value");
  h.scope("epic-b:title");
  await act(async () => gate.resolve());
  h.scope("epic-a:title", "Confirmed value");
  const input = screen.getByRole("textbox", { name: "Epic title" });
  expect(input).toHaveValue("Confirmed value");
  expect(
    h.client.getQueryData(["planning-draft", "epic-a:title"]),
  ).toMatchObject({
    baseline: "Confirmed value",
    draft: "Confirmed value",
    dirty: false,
  });
  expect(screen.queryByText("Unsaved changes")).toBeNull();
  expect(screen.queryByText("Epic title saved.")).toBeNull();
  const user = userEvent.setup();
  await user.click(input);
  await user.tab();
  expect(save).toHaveBeenCalledTimes(1);
});
