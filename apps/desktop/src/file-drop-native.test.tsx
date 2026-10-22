// Actual App/router/api/bindings; only native transport, events and grain are modeled.
// No SQLite writes, local file reads, native GUI or remote activity.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

vi.unmock("./lib/api");
type Project = "A" | "B";
type Payload = Record<string, unknown>;
type NativeEvent = { payload: unknown };
type DropEvent = {
  payload: {
    type: string;
    paths: string[];
    position: { x: number; y: number };
  };
};
type NativeCall = { command: string; scope: Project; args: Payload };
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, Set<(event: NativeEvent) => void>>(),
  drops: new Set<(event: DropEvent) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => false,
  convertFileSrc: (s: string) => s,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (event: NativeEvent) => void) => {
    const set = native.listeners.get(name) ?? new Set();
    set.add(cb);
    native.listeners.set(name, set);
    return () => set.delete(cb);
  },
  once: vi.fn(),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: (event: DropEvent) => void) => {
      native.drops.add(cb);
      return () => native.drops.delete(cb);
    },
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.mock("./lib/grain", () => ({ preparePaperGrain: async () => {} }));

import { App, router } from "./app";
import { AssetsPage } from "./features/assets/AssetsPage";
import { api } from "./lib/api";
import fixture from "./lib/demo-fixture.json";
import { tauriApi } from "./lib/tauri-bridge";
import { useUiStore } from "./lib/ui-store";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const emptyText = "No assets yet — add a file or URL for your project";
const settings = {
  colorBy: "epic",
  estimatesEnabled: true,
  wipLimit: 3,
  assetsView: "grid",
  collapsedAssetKinds: [] as string[],
  theme: "light",
  soundEnabled: false,
};
let referenceStores: Record<Project, Payload[]> = { A: [], B: [] };
let selected: Project = "A",
  stores: Record<Project, ReturnType<typeof asset>[]> = { A: [], B: [] },
  calls: NativeCall[] = [],
  serial = 0,
  gate: ReturnType<typeof deferred> | null = null,
  failAt = 0,
  emitWrites = true,
  readOverride:
    | ((scope: Project) => Promise<ReturnType<typeof asset>[]>)
    | null = null;

const appState = () => ({
  ...fixture.app,
  jam: {
    ...fixture.app.jam,
    id: selected,
    name: `Audit ${selected}`,
    keyPrefix: selected,
    template: "general",
  },
  theme: "light",
});
function emit(action = "asset.created") {
  for (const cb of native.listeners.get("board-changed") ?? [])
    cb({
      payload: {
        events: [
          {
            seq: ++serial,
            action,
            actor: fixture.app.currentMember,
            createdAt: new Date().toISOString(),
            payload: {},
            taskKey: null,
          },
        ],
      },
    });
}
function asset(name: string, kind = "other", project = selected) {
  return {
    id: `asset-${++serial}`,
    jamId: project,
    name,
    kind,
    location: `/synthetic/${name}`,
    notes: null,
    createdBy: "synthetic-human",
    createdAt: new Date().toISOString(),
    role: "asset",
    tasks: [],
  };
}
function drop(paths: string[]) {
  for (const cb of native.drops)
    cb({ payload: { type: "drop", paths, position: { x: 20, y: 20 } } });
}
function installTransport() {
  native.invoke.mockImplementation(
    async (command: string, args: Payload = {}) => {
      const scope = selected;
      calls.push({ command, scope, args });
      const input = (args.input ?? {}) as Payload;
      switch (command) {
        case "app_state":
          return appState();
        case "get_settings":
          return structuredClone(settings);
        case "set_settings":
          Object.assign(
            settings,
            Object.fromEntries(
              Object.entries(input).filter(([, v]) => v !== null),
            ),
          );
          return structuredClone(settings);
        case "runtime_info":
          return {
            dataDir: "/synthetic",
            sidecarPath: "/synthetic/no-executable",
          };
        case "list_members":
          return [
            {
              ...fixture.app.currentMember,
              counts: {},
              online: false,
              workingOn: [],
              statusStale: false,
            },
          ];
        case "list_board_tasks":
          return {
            backlog: [],
            ready: [],
            in_progress: [],
            review: [],
            done: [],
          };
        case "get_board":
          return {
            ...fixture.board,
            jam: {
              ...fixture.board.jam,
              name: `Audit ${selected}`,
              template: "general",
            },
            inProgress: [],
            myTasks: [],
            onlineAgents: [],
          };
        case "list_projects":
          return ["A", "B"].map((id) => ({
            ...fixture.app.jam,
            id,
            name: `Audit ${id}`,
            keyPrefix: id,
            template: "general",
            selected: id === selected,
            archived: false,
            taskCount: 0,
            inProgressCount: 0,
          }));
        case "select_project":
          selected = args.projectId as Project;
          return appState();
        case "list_questions":
        case "list_execution_requests":
        case "list_plan_epics":
        case "list_plan_stories":
        case "list_activity":
        case "list_tags":
          return [];
        case "list_assets":
          return readOverride
            ? await readOverride(scope)
            : structuredClone(stores[scope]);
        case "asset_preview":
          return null;
        case "reference_canvas":
          return {
            items: structuredClone(referenceStores[scope]),
            frames: [],
            edges: [],
            links: [],
          };
        case "canvas_viewport":
          return null;
        case "add_reference": {
          if (gate) {
            const captured = gate;
            gate = null;
            await captured.promise;
          }
          const row = {
            id: `ref-${++serial}`,
            jamId: scope,
            kind: input.kind,
            assetId: null,
            url: null,
            title: input.filePath,
            captionMd: "",
            tags: [],
            x: input.x,
            y: input.y,
            w: 260,
            h: 200,
            z: 0,
            frameId: null,
            linkPreview: null,
            metadata: null,
            position: 0,
            createdBy: "synthetic-human",
            updatedBy: "synthetic-human",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            archivedAt: null,
          };
          referenceStores[scope].push(row);
          if (emitWrites && scope === selected) emit("reference.added");
          return structuredClone(row);
        }
        case "create_asset": {
          const number = calls.filter(
            (c) => c.command === "create_asset",
          ).length;
          // Match Rust execute(): snapshot selection BEFORE waiting/work, each invocation separately.
          if (gate) {
            const captured = gate;
            gate = null;
            await captured.promise;
          }
          if (number === failAt)
            throw {
              code: "validation",
              message: "Synthetic second asset rejected",
              field: "name",
            };
          const row = {
            ...asset(String(input.name), String(input.kind), scope),
            ...input,
          };
          stores[scope].push(row);
          // Match execute_with_store selected_events: off-selected project successes are not emitted.
          if (emitWrites && scope === selected) emit();
          return structuredClone(row);
        }
        default:
          throw Error(`UNEXPECTED NATIVE COMMAND ${command}`);
      }
    },
  );
}
async function route(to: "/assets" | "/projects" | "/plan" | "/references") {
  act(() => {
    void router.navigate({ to });
  });
  await waitFor(() => expect(router.state.location.pathname).toBe(to));
}
async function switchTo(id: Project, user: ReturnType<typeof userEvent.setup>) {
  await route("/projects");
  await screen.findByRole("heading", { name: "Your projects" });
  const button = await screen.findByRole("button", {
    name: `Open project Audit ${id}`,
  });
  expect(button).toBeEnabled();
  await user.click(button);
  await waitFor(() => expect(selected).toBe(id));
  await waitFor(() => expect(router.state.location.pathname).toBe("/plan"));
  await screen.findByRole("heading", { name: "Plan" });
}
async function startAssets() {
  await route("/assets");
  await screen.findByRole("heading", { name: "Assets" });
  await waitFor(() => expect(native.drops.size).toBe(1));
}
function creates() {
  return calls.filter((c) => c.command === "create_asset");
}

it("distinguishes asset reading, failures, genuine empty, no matches and retained category preferences", async () => {
  expect(api).toBe(tauriApi);
  installTransport();
  const hold = deferred<ReturnType<typeof asset>[]>();
  readOverride = () => hold.promise;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const ui = render(
    <QueryClientProvider client={client}>
      <AssetsPage openTask={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(calls.some((c) => c.command === "list_assets")).toBe(true),
  );
  expect(screen.queryByText(emptyText)).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Reading assets");
  await act(async () =>
    hold.reject({ code: "internal", message: "Synthetic initial read failed" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Synthetic initial read failed",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(screen.queryByText(emptyText)).toBeNull();
  readOverride = null;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText(emptyText)).toBeVisible();
  stores.A = [asset("one.txt"), asset("two.txt")];
  await act(async () => client.invalidateQueries({ queryKey: ["assets"] }));
  expect(await screen.findByRole("heading", { name: "one.txt" })).toBeVisible();
  readOverride = async () => {
    throw { code: "internal", message: "Synthetic refresh failed" };
  };
  await act(async () => client.refetchQueries({ queryKey: ["assets"] }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Synthetic refresh failed",
  );
  expect(screen.getByRole("heading", { name: "one.txt" })).toBeVisible();
  readOverride = null;
  await act(async () => client.refetchQueries({ queryKey: ["assets"] }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(document.querySelectorAll(".asset-group")).toHaveLength(1);
  expect(
    [...document.querySelectorAll(".asset-group")].map(
      (el) => el.querySelectorAll(".asset-card").length,
    ),
  ).toEqual([2]);
  fireEvent.change(screen.getByRole("textbox", { name: "Search assets" }), {
    target: { value: "no-match" },
  });
  expect(screen.getByText("No assets match these filters")).toBeVisible();
  expect(screen.queryByText(emptyText)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear asset filters" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search assets" }), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Other 2" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Other 2" })).toHaveAttribute(
      "aria-expanded",
      "false",
    ),
  );
  expect(screen.queryByRole("heading", { name: "one.txt" })).toBeNull();
  expect(settings.collapsedAssetKinds).toEqual(["other"]);
  fireEvent.click(screen.getByRole("button", { name: "other 2" }));
  expect(await screen.findByRole("heading", { name: "one.txt" })).toBeVisible();
  expect(settings.collapsedAssetKinds).toEqual(["other"]);
  fireEvent.click(screen.getByRole("button", { name: "all 2" }));
  expect(screen.queryByRole("heading", { name: "one.txt" })).toBeNull();
  ui.unmount();
  client.clear();
  settings.collapsedAssetKinds = [];
  stores = { A: [], B: [] };
  calls = [];
  useUiStore.setState({ toasts: [] });
});

it("fences Assets and References continuation across project switching, ABA and page departure with scoped receipts", async () => {
  installTransport();
  selected = "A";
  stores = { A: [], B: [] };
  calls = [];
  readOverride = null;
  const user = userEvent.setup();
  render(<App />);
  await startAssets();
  // A->B while first command is waiting. Actual ProjectsPage sees no pending mutation.
  gate = deferred();
  const first = gate;
  act(() =>
    drop([
      "/synthetic/a-first.txt",
      "/synthetic/a-second.txt",
      "/synthetic/a-third.txt",
    ]),
  );
  await waitFor(() => expect(creates()).toHaveLength(1));
  await switchTo("B", user);
  expect(native.drops.size).toBe(0); // Listener cleanup and the continuation fence both apply.
  const projectLink = screen.getByRole("link", {
    name: "Switch project · Audit B",
  });
  projectLink.focus();
  const foreignReads = calls.filter(
    (call) => call.command === "list_assets" && call.scope === "B",
  ).length;
  await act(async () => first.resolve(undefined));
  await waitFor(() => expect(stores.A).toHaveLength(1));
  expect(creates().map((c) => c.scope)).toEqual(["A"]);
  await waitFor(() =>
    expect(
      useUiStore
        .getState()
        .toasts.some(
          (t) =>
            t.text.includes("Audit A [A]") &&
            t.text.includes("1 confirmed") &&
            t.text.includes("2 not attempted"),
        ),
    ).toBe(true),
  );
  expect(stores.A.map((a) => a.name)).toEqual(["a-first"]);
  expect(stores.B).toHaveLength(0);
  expect(
    calls.filter(
      (call) => call.command === "list_assets" && call.scope === "B",
    ),
  ).toHaveLength(foreignReads);
  expect(document.activeElement).toBe(projectLink);
  const notification = screen.getByRole("region", { name: "Notifications" });
  expect(
    within(notification)
      .getAllByRole("status")
      .map((status) => status.textContent)
      .join(" "),
  ).not.toContain("/synthetic/");
  const summary = within(notification).getByText("File details (3)");
  summary.focus();
  // Native summary semantics are retained; user-event does not synthesize its Enter default.
  await user.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(summary.closest("details")).toHaveAttribute("aria-live", "off");
  expect(
    within(notification).getByText("/synthetic/a-third.txt"),
  ).toBeVisible();
  act(() => useUiStore.getState().tick(Date.now() + 60_000));
  expect(document.activeElement).toBe(summary);
  await user.tab();
  expect(document.activeElement).toBe(
    within(notification).getByRole("button", { name: "Dismiss receipt" }),
  );
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(projectLink);
  expect(within(notification).queryByText("File details (3)")).toBeNull();
  // A->B->A: returning to same ID must not revive the abandoned intent.
  await switchTo("A", user);
  await startAssets();
  calls = [];
  gate = deferred();
  const roundtrip = gate;
  act(() =>
    drop(["/synthetic/roundtrip-first.txt", "/synthetic/roundtrip-second.txt"]),
  );
  await waitFor(() => expect(creates()).toHaveLength(1));
  await switchTo("B", user);
  await switchTo("A", user);
  await act(async () => roundtrip.resolve(undefined));
  await waitFor(() =>
    expect(stores.A.some((a) => a.name === "roundtrip-first")).toBe(true),
  );
  expect(creates().map((c) => c.scope)).toEqual(["A"]);
  expect(stores.A.some((a) => a.name === "roundtrip-second")).toBe(false);
  // Ordinary same-project route exit stops unsent files, not the dispatched request.
  await startAssets();
  calls = [];
  gate = deferred();
  const unmountGate = gate;
  act(() =>
    drop(["/synthetic/unmount-first.txt", "/synthetic/unmount-second.txt"]),
  );
  await waitFor(() => expect(creates()).toHaveLength(1));
  await route("/plan");
  await screen.findByRole("heading", { name: "Plan" });
  expect(native.drops.size).toBe(0);
  await act(async () => unmountGate.resolve(undefined));
  await waitFor(() =>
    expect(stores.A.some((a) => a.name === "unmount-first")).toBe(true),
  );
  expect(creates().map((c) => c.scope)).toEqual(["A"]);
  expect(stores.A.some((a) => a.name === "unmount-second")).toBe(false);
  // Partial known failure WITH native board-changed event: Root refetch preserves visibility.
  await startAssets();
  calls = [];
  failAt = 2;
  useUiStore.setState({ toasts: [] });
  act(() =>
    drop([
      "/synthetic/partial-first.txt",
      "/synthetic/partial-failed.txt",
      "/synthetic/partial-unsent.txt",
    ]),
  );
  await waitFor(() => expect(creates()).toHaveLength(2));
  expect(
    await screen.findByRole("heading", { name: "partial-first" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      useUiStore
        .getState()
        .toasts.some((t) => t.text.includes("1 unconfirmed request")),
    ).toBe(true),
  );
  expect(stores.A.some((a) => a.name === "partial-failed")).toBe(false);
  expect(stores.A.some((a) => a.name === "partial-unsent")).toBe(false);
  expect(useUiStore.getState().toasts.at(-1)?.text).toMatch(
    /1 confirmed; 1 unconfirmed request; 1 not attempted/,
  );
  expect(
    calls.filter((c) => c.command === "list_assets").length,
  ).toBeGreaterThan(0);
  // Bounded lost-event diagnostic: the drop handler provides no settlement invalidation on error.
  calls = [];
  emitWrites = false;
  useUiStore.setState({ toasts: [] });
  act(() =>
    drop([
      "/synthetic/silent-first.txt",
      "/synthetic/silent-failed.txt",
      "/synthetic/silent-unsent.txt",
    ]),
  );
  await waitFor(() =>
    expect(
      useUiStore
        .getState()
        .toasts.some((t) => t.text.includes("1 unconfirmed request")),
    ).toBe(true),
  );
  expect(creates()).toHaveLength(2);
  expect(stores.A.some((a) => a.name === "silent-first")).toBe(true);
  expect(
    await screen.findByRole("heading", { name: "silent-first" }),
  ).toBeVisible();
  expect(
    calls.filter((c) => c.command === "list_assets").length,
  ).toBeGreaterThan(0);
  act(() => emit());
  expect(
    await screen.findByRole("heading", { name: "silent-first" }),
  ).toBeVisible();
  emitWrites = true;
  failAt = 0;
  expect(
    calls.some((c) =>
      ["open_url", "show_in_folder", "pick_files"].includes(c.command),
    ),
  ).toBe(false);
  // One adjacent check: real unframed ReferencesPage also keeps its queued write alive.
  calls = [];
  referenceStores = { A: [], B: [] };
  await route("/references");
  await waitFor(() => expect(native.drops.size).toBe(1));
  await waitFor(() =>
    expect(calls.some((c) => c.command === "reference_canvas")).toBe(true),
  );
  gate = deferred();
  const referenceGate = gate;
  act(() =>
    drop(["/synthetic/reference-first.txt", "/synthetic/reference-second.txt"]),
  );
  await waitFor(() =>
    expect(calls.filter((c) => c.command === "add_reference")).toHaveLength(1),
  );
  await switchTo("B", user);
  expect(native.drops.size).toBe(0);
  await act(async () => referenceGate.resolve(undefined));
  await waitFor(() => expect(referenceStores.A).toHaveLength(1));
  const referenceCalls = calls.filter((c) => c.command === "add_reference");
  expect(referenceCalls.map((c) => c.scope)).toEqual(["A"]);
  expect(referenceCalls.map((c) => (c.args.input as Payload).frameId)).toEqual([
    undefined,
  ]);
  expect(referenceStores.A).toHaveLength(1);
  expect(referenceStores.B).toHaveLength(0);
}, 20000);
