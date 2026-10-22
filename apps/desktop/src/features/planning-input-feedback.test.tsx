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
  const view = (identity = "epic-a:title") => (
    <QueryClientProvider client={client}>
      <PlanningInput
        identity={identity}
        label="Epic title"
        value="Original"
        save={save}
      />
      <button type="button">Next field</button>
    </QueryClientProvider>
  );
  const rendered = render(view());
  return {
    ...rendered,
    client,
    scope: (id: string) => rendered.rerender(view(id)),
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
it("P02/AS03: unmount retains the draft without publishing a late saved receipt", async () => {
  const gate = deferred();
  const h = mount(vi.fn(() => gate.promise));
  await edit("Unmounted draft");
  h.unmount();
  await act(async () => gate.resolve());
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    h.client.getQueryData(["planning-draft", "epic-a:title"]),
  ).toMatchObject({ draft: "Unmounted draft", dirty: true });
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
