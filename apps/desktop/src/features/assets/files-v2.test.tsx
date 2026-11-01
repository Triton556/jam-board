import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scopeInput } from "../../lib/file-viewer-api";
import { mockApi } from "../../lib/mock-bridge";
import { mockFilesV2 } from "../../lib/mock-files-v2";
import { mockTaskFiles } from "../../lib/mock-task-files";
import { registration, taskFilesApi } from "../../lib/task-files-api";
import { ProjectDocuments } from "../plan/ProjectDocuments";
import { AssetsPage } from "./AssetsPage";
import { assetKind } from "./model";

vi.hoisted(() => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
});
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
  useNavigate: () => navigate,
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockTaskFiles.reset();
  mockTaskFiles.copyDelay = 0;
  mockFilesV2.reset();
  navigate.mockReset();
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const app = await mockApi.appState(),
    context = await taskFilesApi.capture(app.jam?.id ?? "");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], app);
  const register = async (name: string) => {
    const asset = (
      await taskFilesApi.register(
        context,
        registration("board_file", `C:/source/${name}`, crypto.randomUUID()),
      )
    ).asset;
    if (!asset) throw new Error("Fixture file missing");
    return asset;
  };
  return {
    context,
    client,
    register,
    mount(node: React.ReactNode) {
      return render(
        <QueryClientProvider client={client}>{node}</QueryClientProvider>,
      );
    },
  };
}
it.each(["mp4", "webm", "mov", "mkv", "avi", "m4v"])(
  "classifies .%s as video",
  (ext) => {
    expect(assetKind(`C:/cut.${ext.toUpperCase()}`)).toBe("video");
  },
);
it("Assets Linked to filters project/story/nothing and Show archived exposes the badge", async () => {
  const f = await fixture(),
    project = await f.register("Project-plan.md"),
    story = await f.register("Story-plan.md"),
    unlinked = await f.register("Unlinked.md");
  await mockFilesV2.link(
    f.context,
    scopeInput({ type: "project", key: null }, project.id),
  );
  await mockFilesV2.link(
    f.context,
    scopeInput({ type: "story", key: "JB-S1" }, story.id),
  );
  await mockFilesV2.archive(
    f.context,
    { assetId: story.id, requestId: "archive-story" },
    true,
  );
  f.mount(<AssetsPage openTask={vi.fn()} />);
  await screen.findByRole("button", { name: "Project-plan.md" });
  async function choose(value: string) {
    await userEvent.click(screen.getByRole("combobox", { name: "Linked to" }));
    await userEvent.click(await screen.findByRole("option", { name: value }));
  }
  await choose("Project");
  expect(screen.getByRole("button", { name: "Project-plan.md" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Unlinked.md" }),
  ).not.toBeInTheDocument();
  await choose("Nothing");
  screen.getByRole("button", { name: "Unlinked.md" });
  expect(
    screen.queryByRole("button", { name: "Project-plan.md" }),
  ).not.toBeInTheDocument();
  await choose("Stories");
  expect(
    screen.queryByRole("button", { name: "Story-plan.md" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Show archived" }),
  );
  await screen.findByRole("button", { name: "Story-plan.md" });
  screen.getByText("Archived");
  screen.getByText("Used in 1");
  await userEvent.click(
    screen.getByRole("button", { name: "Menu for Story-plan.md" }),
  );
  for (const label of [
    "Open in app",
    "Show in folder",
    "Rename",
    "Replace…",
    "Unarchive",
    "Delete…",
  ])
    screen.getByRole("button", { name: label });
  expect(
    (await mockFilesV2.list(f.context)).some((a) => a.id === unlinked.id),
  ).toBe(true);
});
it("Project strip caps at six, opens file routes and links All documents to project filter", async () => {
  const f = await fixture();
  for (let i = 0; i < 7; i++) {
    const asset = await f.register(`Document-${i}.md`);
    await mockFilesV2.link(
      f.context,
      scopeInput({ type: "project", key: null }, asset.id),
    );
  }
  f.mount(<ProjectDocuments />);
  const strip = await screen.findByRole("region", {
    name: "Project documents",
  });
  await waitFor(() =>
    expect(
      within(strip).getAllByRole("button", { name: /^Document-/ }),
    ).toHaveLength(6),
  );
  const firstChip = within(strip).getAllByRole("button", {
    name: /^Document-/,
  })[0];
  if (!firstChip) throw new Error("Expected a document chip");
  await userEvent.click(firstChip);
  const route = navigate.mock.calls.at(-1)?.[0];
  expect(route.search({ task: "JB-7" })).toMatchObject({
    task: "JB-7",
    file: expect.any(String),
  });
  await userEvent.click(screen.getByRole("button", { name: "All documents" }));
  expect(navigate.mock.calls.at(-1)?.[0].search({})).toEqual({
    linkedTo: "project",
  });
});
it("empty project copy and Add document registers with project scope through a fake picker", async () => {
  const f = await fixture();
  vi.spyOn(mockApi, "pickFiles").mockResolvedValue(["C:/source/Decisions.md"]);
  f.mount(<ProjectDocuments />);
  await screen.findByText("Keep the plan, decisions and design docs here.");
  await userEvent.click(screen.getByRole("button", { name: "+ Add document" }));
  await userEvent.click(screen.getByRole("button", { name: "Choose file…" }));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Document source path" }),
    ).toHaveValue("C:/source/Decisions.md"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Add document" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  screen.getByRole("button", { name: "Decisions.md" });
  expect(
    (
      await mockFilesV2.list(f.context, {
        scope: { type: "project", key: null },
      })
    ).some((a) => a.name === "Decisions.md"),
  ).toBe(true);
});
