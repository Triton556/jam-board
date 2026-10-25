import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { ReferencesSection } from "./ReferencesSection";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/board?task=JB-1",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => vi.restoreAllMocks());

async function openPicker() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  render(
    <QueryClientProvider client={client}>
      <ReferencesSection targetKey="JB-1" epicKey="JB-E1" />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("menuitem", { name: "From canvas…" }));
  const dialog = screen.getByRole("dialog", { name: "From canvas" });
  await user.click(within(dialog).getByRole("tab", { name: "Items" }));
  return {
    user,
    dialog,
    search: within(dialog).getByLabelText("Search canvas"),
  };
}

it("RF04 untitled note choices use distinct body labels, search body text and link only the selected ID", async () => {
  const amber = await mockApi.addReference(
    { kind: "note", text: "Amber lanterns on fresh snow." },
    true,
  );
  const blue = await mockApi.addReference(
    { kind: "note", text: "Blue shadows in the ice cave." },
    true,
  );
  const legacy = await mockApi.addReference({
    kind: "note",
    title: "Note",
    text: "Keep the original literal heading.",
  });
  expect(amber.title).toBe("");
  expect(blue.title).toBe("");
  expect(legacy.title).toBe("Note");
  const before = await mockApi.referenceCanvas();
  const target = (await mockApi.getTask("JB-1")).id;
  const create = vi.spyOn(mockApi, "addReference");
  const update = vi.spyOn(mockApi, "updateReference");
  const link = vi.spyOn(mockApi, "linkReference");
  const { user, dialog, search } = await openPicker();
  await within(dialog).findByRole("checkbox", {
    name: "Amber lanterns on fresh snow.",
  });
  expect(
    within(dialog).getByRole("checkbox", {
      name: "Blue shadows in the ice cave.",
    }),
  ).toBeVisible();
  expect(within(dialog).getByRole("checkbox", { name: "Note" })).toBeVisible();
  await user.type(search, "ICE CAVE");
  const choice = within(dialog).getByRole("checkbox", {
    name: "Blue shadows in the ice cave.",
  });
  expect(
    within(dialog).queryByRole("checkbox", {
      name: "Amber lanterns on fresh snow.",
    }),
  ).toBeNull();
  expect(within(dialog).queryByRole("checkbox", { name: "Note" })).toBeNull();
  await user.click(choice);
  await user.click(within(dialog).getByRole("button", { name: "Link 1" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(link).toHaveBeenCalledExactlyOnceWith(blue.id, "JB-1");
  const after = await mockApi.referenceCanvas();
  expect(after.items).toEqual(before.items);
  expect(after.links).toEqual([
    ...before.links,
    { itemId: blue.id, targetId: target, targetType: "task", archivedAt: null },
  ]);
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("button", {
      name: "Blue shadows in the ice cave.",
    }),
  ).toBeVisible();
});

it("RF04 media and links retain title-only search and labels without content writes", async () => {
  await mockApi.addReference({
    kind: "asset",
    filePath: "/synthetic/style-guide.pdf",
    title: "Style guide",
    caption: "not-a-title-only-marker",
  });
  await mockApi.addReference({
    kind: "link",
    url: "https://example.test/palette",
    title: "Palette reference",
    caption: "not-a-title-only-marker",
  });
  const before = await mockApi.referenceCanvas();
  const create = vi.spyOn(mockApi, "addReference");
  const update = vi.spyOn(mockApi, "updateReference");
  const link = vi.spyOn(mockApi, "linkReference");
  const { user, dialog, search } = await openPicker();
  await within(dialog).findByRole("checkbox", { name: "Style guide" });
  expect(
    within(dialog).getByRole("checkbox", { name: "Palette reference" }),
  ).toBeVisible();
  await user.type(search, "not-a-title-only-marker");
  expect(
    within(dialog).queryByRole("checkbox", { name: "Style guide" }),
  ).toBeNull();
  expect(
    within(dialog).queryByRole("checkbox", { name: "Palette reference" }),
  ).toBeNull();
  await user.clear(search);
  await user.type(search, "STYLE");
  expect(
    within(dialog).getByRole("checkbox", { name: "Style guide" }),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("checkbox", { name: "Palette reference" }),
  ).toBeNull();
  await user.clear(search);
  await user.type(search, "PALETTE");
  expect(
    within(dialog).getByRole("checkbox", { name: "Palette reference" }),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("checkbox", { name: "Style guide" }),
  ).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await mockApi.referenceCanvas()).toEqual(before);
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(link).not.toHaveBeenCalled();
});
