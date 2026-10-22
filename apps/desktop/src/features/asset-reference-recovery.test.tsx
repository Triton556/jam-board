import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { AssetLinkDialog } from "./assets/AssetLinkDialog";
import { AssetDialog } from "./assets/AssetsPage";
import {
  AddReferenceDialog,
  EditReferenceDialog,
  FrameDialog,
} from "./references/dialogs";
import { ReferencesSection } from "./references/ReferencesSection";
import { ProjectSettings } from "./settings/ProjectSettings";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
function must<T>(value: T | null | undefined): T {
  if (value == null) throw Error("Missing test element");
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  return {
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
    client,
  };
}
beforeEach(async () => {
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());

it.each(["asset", "note", "frame", "caption"] as const)(
  "%s captures one submission, locks same-event dismissal, and retains failed drafts for explicit retry",
  async (kind) => {
    const first = deferred<void>(),
      second = deferred<void>(),
      save = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      close = vi.fn(),
      user = userEvent.setup();
    const item = await mockApi.addReference({
      kind: "note",
      text: "Fictional evidence",
    });
    const asset = (await mockApi.listAssets())[0];
    if (!asset) throw Error("Missing demo asset");
    let node: React.ReactNode, title: string, button: string;
    if (kind === "asset") {
      vi.spyOn(api, "updateAsset").mockImplementation(save);
      node = <AssetDialog asset={asset} close={close} />;
      title = "Name";
      button = "Save asset";
    } else if (kind === "note") {
      node = <AddReferenceDialog kind="note" close={close} save={save} />;
      title = "Title";
      button = "Add note";
    } else if (kind === "frame") {
      node = <FrameDialog epics={[]} close={close} save={save} />;
      title = "Title";
      button = "Create frame";
    } else {
      node = (
        <EditReferenceDialog
          item={item}
          mode="caption"
          targets={[]}
          close={close}
          save={save}
          link={async () => {}}
        />
      );
      title = "Title";
      button = "Save";
    }
    await mount(node);
    const input = screen.getByLabelText(title);
    await user.clear(input);
    await user.type(input, "Captured fictional title");
    if (kind === "note")
      await user.type(screen.getByLabelText("Note"), "Retain this rough idea.");
    const submit = screen.getByRole("button", { name: button }),
      form = submit.closest("form");
    if (!form) throw Error("Missing form");
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.mouseDown(must(screen.getByRole("dialog").parentElement));
    });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
    expect(submit).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Wait for the result");
    await user.click(submit);
    await user.keyboard("{Escape}");
    expect(save).toHaveBeenCalledOnce();
    await act(async () =>
      first.reject(new Error("Known fictional save failure")),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Known fictional save failure",
    );
    expect(input).toHaveValue("Captured fictional title");
    expect(input).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
    await user.click(submit);
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve());
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  },
);

it("asset validates synchronously before accepting a write and sends the captured trimmed values", async () => {
  const save = vi.spyOn(api, "createAsset"),
    user = userEvent.setup();
  await mount(<AssetDialog close={() => {}} />);
  await user.click(screen.getByRole("tab", { name: "URL" }));
  await user.click(screen.getByRole("button", { name: "Save asset" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText("Give the asset a name")).toBeVisible();
  await user.type(screen.getByLabelText("Name"), "  Fictional config  ");
  await user.type(
    screen.getByLabelText("Asset location"),
    "https://example.invalid/config.txt",
  );
  await user.click(screen.getByRole("button", { name: "Save asset" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0].name).toBe("Fictional config");
});

it.each(["asset", "note", "caption", "link"] as const)(
  "late %s completion cannot close an externally remounted newer draft",
  async (kind) => {
    const gate = deferred<void>(),
      close = vi.fn(),
      save = vi.fn(() => gate.promise),
      user = userEvent.setup();
    const asset = (await mockApi.listAssets())[0],
      item = await mockApi.addReference({
        kind: "note",
        text: "Fictional note",
      });
    if (!asset) throw Error("Missing asset");
    vi.spyOn(api, "updateAsset").mockImplementation(save);
    vi.spyOn(api, "linkAsset").mockImplementation(save);
    function Host() {
      const [revision, setRevision] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            External remount
          </button>
          <div key={revision}>
            {kind === "asset" ? (
              <AssetDialog asset={asset} close={close} />
            ) : kind === "note" ? (
              <AddReferenceDialog kind="note" close={close} save={save} />
            ) : kind === "caption" ? (
              <EditReferenceDialog
                item={item}
                mode="caption"
                targets={[]}
                close={close}
                save={save}
                link={async () => {}}
              />
            ) : (
              <AssetLinkDialog taskKey="JB-1" close={close} />
            )}
          </div>
        </>
      );
    }
    await mount(<Host />);
    if (kind === "note")
      await user.type(screen.getByLabelText("Note"), "First note");
    if (kind === "link")
      await user.click(must((await screen.findAllByRole("option"))[0]));
    await user.click(
      screen.getByRole("button", {
        name:
          kind === "asset"
            ? "Save asset"
            : kind === "note"
              ? "Add note"
              : kind === "caption"
                ? "Save"
                : "Link",
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    // Models external teardown, not an allowed pending dialog dismissal.
    fireEvent.click(screen.getByRole("button", { name: "External remount" }));
    const fresh =
      kind === "link"
        ? screen.getByRole("combobox")
        : screen.getByLabelText(
            kind === "asset"
              ? "Notes"
              : kind === "note"
                ? "Note"
                : "Reference caption",
          );
    await user.type(fresh, "New unsaved draft");
    await act(async () => gate.resolve());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect((fresh as HTMLInputElement).value).toContain("New unsaved draft");
  },
);

it("project A→B→A before dispatch refuses the original frame write without replay", async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  const { client } = await mount(
    <FrameDialog epics={[]} close={close} save={save} />,
  );
  const app = await mockApi.appState();
  if (!app.jam) throw Error("Missing project");
  act(() => {
    fireEvent.submit(
      must(
        screen.getByRole("button", { name: "Create frame" }).closest("form"),
      ),
    );
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "fictional-other-project" },
    });
    client.setQueryData(["app"], app);
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create frame" })).toBeDisabled(),
  );
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(
    screen
      .getAllByRole("alert")
      .some((node) => node.textContent?.includes("changed")),
  ).toBe(true);
});

it("existing-reference picker locks duplicate links and recovers failure without losing its search", async () => {
  const item = await mockApi.addReference({
    kind: "note",
    title: "Fictional reference choice",
    text: "No implementation work",
  });
  const first = deferred<typeof item>(),
    link = vi
      .spyOn(api, "linkReference")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(item),
    user = userEvent.setup();
  await mount(<ReferencesSection targetKey="JB-1" epicKey="JB-E1" />);
  await user.click(screen.getByRole("button", { name: "Add reference" }));
  await user.type(
    screen.getByLabelText("Search canvas"),
    "Fictional reference choice",
  );
  const choice = await screen.findByRole("button", {
    name: "Fictional reference choice",
  });
  act(() => {
    fireEvent.click(choice);
    fireEvent.click(choice);
    fireEvent.keyDown(window, { key: "Escape" });
  });
  await waitFor(() => expect(link).toHaveBeenCalledOnce());
  expect(choice).toBeDisabled();
  expect(screen.getByRole("status")).toHaveFocus();
  await act(async () => first.reject(new Error("Known link failure")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Known link failure",
  );
  expect(screen.getByLabelText("Search canvas")).toHaveFocus();
  expect(screen.getByLabelText("Search canvas")).toHaveValue(
    "Fictional reference choice",
  );
  await user.click(choice);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(link).toHaveBeenCalledTimes(2);
});

it.each(["assets", "tasks"] as const)(
  "failed %s source is not empty; Retry retains search and makes a valid selection linkable",
  async (source) => {
    const user = userEvent.setup(),
      method = source === "assets" ? "listAssets" : "listBoardTasks";
    const original = api[method].bind(api),
      read = vi
        .spyOn(api, method)
        .mockRejectedValueOnce(new Error("Fictional list unavailable"));
    const link = vi.spyOn(api, "linkAsset");
    await mount(
      <AssetLinkDialog
        {...(source === "assets"
          ? { taskKey: "JB-1" }
          : { assetId: "fictional-asset" })}
        close={() => {}}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fictional list unavailable",
    );
    expect(screen.queryByText(/No (assets|tasks) yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
    await user.type(
      screen.getByRole("combobox"),
      "nonmatching retained search",
    );
    read.mockImplementation(original as never);
    await user.click(screen.getByRole("button", { name: "Retry list" }));
    expect(
      await screen.findByText("No matches. Try another search."),
    ).toBeVisible();
    expect(screen.getByRole("combobox")).toHaveValue(
      "nonmatching retained search",
    );
    await user.clear(screen.getByRole("combobox"));
    await user.click(must((await screen.findAllByRole("option"))[0]));
    expect(screen.getByRole("button", { name: "Link" })).toBeEnabled();
    expect(link).not.toHaveBeenCalled();
  },
);

it.each([
  [
    "Project name",
    "name",
    "game_jam",
    "First saved title",
    "Newer unsaved title",
  ],
  [
    "Project start",
    "startsAt",
    "game_jam",
    "2026-11-01T13:00",
    "2026-11-02T13:00",
  ],
  ["Project end", "endsAt", "game_jam", "2026-11-03T13:00", "2026-11-04T13:00"],
  ["Project timezone", "timezone", "game_jam", "Europe/Berlin", "Europe/Paris"],
  [
    "Project milestone",
    "milestoneAt",
    "webapp",
    "2026-11-01T13:00",
    "2026-11-02T13:00",
  ],
] as const)(
  "%s newer typing and blur remain visibly unsaved after the old completion, until explicit Save",
  async (label, field, template, first, later) => {
    let project = await mockApi.getProject();
    project = { ...project, jam: { ...project.jam, template } };
    vi.spyOn(api, "getProject").mockResolvedValue(project);
    const gate = deferred<typeof project>(),
      update = vi.spyOn(api, "updateProject").mockReturnValueOnce(gate.promise),
      user = userEvent.setup();
    await mount(<ProjectSettings />);
    const input = await screen.findByLabelText(label);
    fireEvent.change(input, { target: { value: first } });
    fireEvent.blur(input);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    fireEvent.change(input, { target: { value: later } });
    fireEvent.blur(input);
    expect(input).toHaveValue(later);
    expect(update).toHaveBeenCalledOnce();
    const normalized = (value: string) =>
      field.endsWith("At") ? new Date(value).toISOString() : value;
    await act(async () =>
      gate.resolve({
        ...project,
        jam: { ...project.jam, [field]: normalized(first) },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `Save ${label.toLowerCase()}` }),
      ).toBeEnabled(),
    );
    expect(input).toHaveValue(later);
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(update).toHaveBeenCalledOnce();
    update.mockResolvedValueOnce({
      ...project,
      jam: { ...project.jam, [field]: normalized(later) },
    });
    await user.click(
      screen.getByRole("button", { name: `Save ${label.toLowerCase()}` }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[0]).toMatchObject({
      [field]: normalized(later),
    });
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
    expect(input).toHaveValue(later);
  },
);

it("reverting a newer name draft to its old baseline still preserves that newer intent", async () => {
  const project = await mockApi.getProject(),
    gate = deferred<typeof project>(),
    update = vi.spyOn(api, "updateProject").mockReturnValueOnce(gate.promise);
  await mount(<ProjectSettings />);
  const input = await screen.findByLabelText("Project name");
  fireEvent.change(input, { target: { value: "First submitted name" } });
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  fireEvent.change(input, { target: { value: project.jam.name } });
  fireEvent.blur(input);
  await act(async () =>
    gate.resolve({
      ...project,
      jam: { ...project.jam, name: "First submitted name" },
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save project name" }),
    ).toBeEnabled(),
  );
  expect(input).toHaveValue(project.jam.name);
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(update).toHaveBeenCalledOnce();
});
it("known field-save and later background-read failures retain the newer draft with explicit recovery", async () => {
  const project = await mockApi.getProject(),
    gate = deferred<typeof project>(),
    update = vi.spyOn(api, "updateProject").mockReturnValueOnce(gate.promise),
    read = vi.spyOn(api, "getProject").mockResolvedValueOnce(project),
    user = userEvent.setup();
  const { client } = await mount(<ProjectSettings />);
  const input = await screen.findByLabelText("Project name");
  fireEvent.change(input, { target: { value: "First attempted name" } });
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  fireEvent.change(input, { target: { value: "Retain newer name" } });
  fireEvent.blur(input);
  await act(async () => gate.reject(new Error("Known update failure")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Known update failure",
  );
  expect(input).toHaveValue("Retain newer name");
  read.mockRejectedValueOnce(new Error("Read unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["project"] });
  });
  expect(await screen.findByText("Read unavailable")).toBeVisible();
  expect(screen.getByLabelText("Project name")).toBe(input);
  expect(input).toHaveValue("Retain newer name");
  read.mockResolvedValueOnce(project);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByText("Read unavailable")).not.toBeInTheDocument(),
  );
  expect(input).toHaveValue("Retain newer name");
  expect(update).toHaveBeenCalledOnce();
  update.mockResolvedValueOnce({
    ...project,
    jam: { ...project.jam, name: "Retain newer name" },
  });
  await user.click(screen.getByRole("button", { name: "Save project name" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
  );
});

it("already sent frame work is not replayed or allowed to close a changed project context on completion", async () => {
  const gate = deferred<void>(),
    save = vi.fn(() => gate.promise),
    close = vi.fn(),
    user = userEvent.setup();
  const { client } = await mount(
    <FrameDialog epics={[]} close={close} save={save} />,
  );
  await user.type(screen.getByLabelText("Title"), " captured context");
  await user.click(screen.getByRole("button", { name: "Create frame" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const app = await mockApi.appState();
  if (!app.jam) throw Error("Missing project");
  act(() => {
    client.setQueryData(["app"], {
      ...app,
      jam: { ...app.jam, id: "fictional-other-project" },
    });
    client.setQueryData(["app"], app);
  });
  await act(async () => gate.resolve());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Close New frame" }),
    ).toBeEnabled(),
  );
  expect(close).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Create frame" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "already submitted write is not cancelled",
  );
  expect(screen.getByLabelText("Title")).toHaveValue(
    "Reference board captured context",
  );
});

it("a reference section changed to another work item gets a fresh guarded picker, not a permanently disabled old scope", async () => {
  await mockApi.addReference({
    kind: "note",
    title: "Fictional target switch",
    text: "No real work",
  });
  const user = userEvent.setup(),
    link = vi.spyOn(api, "linkReference");
  function Host() {
    const [target, setTarget] = useState("JB-1");
    return (
      <>
        <button type="button" onClick={() => setTarget("JB-2")}>
          Different target
        </button>
        <ReferencesSection targetKey={target} epicKey="JB-E1" />
      </>
    );
  }
  await mount(<Host />);
  await user.click(screen.getByRole("button", { name: "Different target" }));
  await user.click(screen.getByRole("button", { name: "Add reference" }));
  const choice = await screen.findByRole("button", {
    name: "Fictional target switch",
  });
  expect(choice).toBeEnabled();
  await user.click(choice);
  await waitFor(() => expect(link).toHaveBeenCalledOnce());
  expect(link.mock.calls[0]?.[1]).toBe("JB-2");
});

it("project template save keeps its pending dialog, focuses retry after failure, and restores its opener after success", async () => {
  const first = deferred<Awaited<ReturnType<typeof api.updateProject>>>(),
    update = vi.spyOn(api, "updateProject").mockReturnValueOnce(first.promise),
    user = userEvent.setup();
  const project = await mockApi.getProject();
  await mount(<ProjectSettings />);
  const selector = await screen.findByRole("combobox", {
    name: "Project template",
  });
  await user.click(selector);
  await user.click(screen.getByRole("option", { name: "Custom" }));
  const confirm = screen.getByRole("button", { name: "Switch template" });
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.keyDown(window, { key: "Escape" });
  });
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  await act(async () => first.reject(new Error("Known template failure")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Known template failure",
  );
  expect(confirm).toHaveFocus();
  update.mockResolvedValueOnce({
    ...project,
    jam: { ...project.jam, template: "custom" },
    tagSuggestions: [],
  });
  await user.click(confirm);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveFocus();
  expect(update).toHaveBeenCalledTimes(2);
});
