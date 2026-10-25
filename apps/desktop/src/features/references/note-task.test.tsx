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
import { mockApi } from "../../lib/mock-bridge";
import { NoteTaskDialog } from "./NoteTaskDialog";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());
async function mount(
  title = "Lantern idea",
  body = "Amber light\nKeep the snow blue",
) {
  const item = await mockApi.addReference(
    {
      kind: "note",
      title: title || undefined,
      text: body,
      x: 10,
      y: 20,
    },
    !title,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const close = vi.fn(),
    created = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NoteTaskDialog item={item} close={close} created={created} />
    </QueryClientProvider>,
  );
  return { item, client, close, created };
}
it("H-R03 note → task prefills an editable heading and full body; Cancel sends no mutations", async () => {
  const create = vi.spyOn(mockApi, "createTask"),
    link = vi.spyOn(mockApi, "linkReference");
  const { close } = await mount();
  expect(
    screen.getByRole("textbox", { name: "New planned task title" }),
  ).toHaveValue("Lantern idea");
  expect(
    screen.getByRole("textbox", { name: "New task description" }),
  ).toHaveValue("Amber light\nKeep the snow blue");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(link).not.toHaveBeenCalled();
});
it("H-R03 heading-free prefill takes only the first 80 characters of the first line", async () => {
  await mount("", `${"x".repeat(90)}\nSecond line`);
  expect(
    screen.getByRole("textbox", { name: "New planned task title" }),
  ).toHaveValue("x".repeat(80));
  expect(
    screen.getByRole("textbox", { name: "New task description" }),
  ).toHaveValue(`${"x".repeat(90)}\nSecond line`);
});
it("H-R03 edited task creates once then links the note to the returned task key", async () => {
  const { item, created } = await mount();
  const create = vi.spyOn(mockApi, "createTask"),
    link = vi.spyOn(mockApi, "linkReference");
  fireEvent.change(
    screen.getByRole("textbox", { name: "New planned task title" }),
    { target: { value: "Build lantern" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "New task description" }),
    { target: { value: "Edited description" } },
  );
  await userEvent.dblClick(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledExactlyOnceWith({
    title: "Build lantern",
    description: "Edited description",
    status: "backlog",
    storyKey: undefined,
  });
  const key = created.mock.calls[0]?.[0];
  expect(link).toHaveBeenCalledExactlyOnceWith(item.id, key);
  expect((await mockApi.getTask(key)).descriptionMd).toBe("Edited description");
  expect((await mockApi.referenceCanvas()).links).toContainEqual(
    expect.objectContaining({ itemId: item.id, targetType: "task" }),
  );
});
it("H-R03 link failure preserves the confirmed key; retry links without a duplicate task", async () => {
  const { item, created } = await mount();
  const create = vi.spyOn(mockApi, "createTask");
  const originalLink = mockApi.linkReference.bind(mockApi);
  const link = vi
    .spyOn(mockApi, "linkReference")
    .mockRejectedValueOnce(new Error("Synthetic link failure"))
    .mockImplementation(originalLink);
  await userEvent.click(screen.getByRole("button", { name: "Create task" }));
  const alert = await screen.findByRole("alert");
  const task = await create.mock.results[0]?.value;
  expect(alert).toHaveTextContent(
    `Task ${task.key} created; linking the note failed`,
  );
  expect(created).not.toHaveBeenCalled();
  await userEvent.dblClick(
    screen.getByRole("button", { name: "Retry linking note" }),
  );
  await waitFor(() =>
    expect(created).toHaveBeenCalledExactlyOnceWith(task.key),
  );
  expect(create).toHaveBeenCalledOnce();
  expect(link).toHaveBeenNthCalledWith(2, item.id, task.key);
});
it("H-R03 an unknown create response cannot be replayed from this dialog", async () => {
  const create = vi
    .spyOn(mockApi, "createTask")
    .mockRejectedValue(new Error("Response lost"));
  const link = vi.spyOn(mockApi, "linkReference");
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "Create task" }));
  await screen.findByText(/result is unconfirmed/);
  expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
  expect(create).toHaveBeenCalledOnce();
  expect(link).not.toHaveBeenCalled();
});
it("H-R03 project A → B → A while create is pending cannot link or publish in a new epoch", async () => {
  const { client, created } = await mount();
  const app = await mockApi.appState();
  const task = await mockApi.createTask({
    title: "Confirmed response",
    status: "backlog",
  });
  let resolve!: (value: typeof task) => void;
  vi.spyOn(mockApi, "createTask").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const link = vi.spyOn(mockApi, "linkReference");
  await userEvent.click(screen.getByRole("button", { name: "Create task" }));
  await act(async () => {
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "project-b" },
    });
    client.setQueryData(["app"], app);
    resolve(task);
  });
  await screen.findByText(/project changed before linking/);
  expect(link).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});
