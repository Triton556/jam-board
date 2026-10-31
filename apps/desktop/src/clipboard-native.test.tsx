// Adapted from the independent alpha23 clipboard-scope repro; source evidence retained.
// Actual App/router/api/bindings; only native transport, events and grain are modeled.
// No SQLite writes, local file reads, native GUI or remote activity.

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
vi.mock("@tauri-apps/plugin-opener", () => import("./test/mock-opener"));
vi.mock("./lib/grain", () => ({ preparePaperGrain: async () => {} }));

import { App, router } from "./app";
import { api } from "./lib/api";
import fixture from "./lib/demo-fixture.json";
import { tauriApi } from "./lib/tauri-bridge";
import { useUiStore } from "./lib/ui-store";
import { nativeFileFixture } from "./test/native-file-fixture";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

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
let clipboardGate: ReturnType<typeof deferred<void>> | null = null;
let clipboardRejectAfterPersist = false;
let selectionEpoch = 1;
let selected: Project = "A",
  stores: Record<Project, ReturnType<typeof asset>[]> = { A: [], B: [] },
  calls: NativeCall[] = [],
  serial = 0,
  gate: ReturnType<typeof deferred> | null = null,
  failAt = 0,
  postCommitFailAt = 0,
  referenceReadError = false,
  referenceFailAt = 0,
  referencePostCommitFailAt = 0,
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
function installTransport() {
  native.invoke.mockImplementation(
    async (command: string, args: Payload = {}) => {
      const scope = selected;
      calls.push({ command, scope, args });
      const input = (args.input ?? {}) as Payload;
      switch (command) {
        case "app_state":
          return appState();
        case "project_selection_context":
          return { instanceId: `legacy:synthetic:${selected}`, selectionEpoch };
        case "project_folder_info":
          throw { code: "not_found", message: "No folder project selected" };
        case "list_project_folders":
          return [];
        case "list_file_assets":
          return (readOverride ? await readOverride(scope) : stores[scope]).map(
            nativeFileFixture,
          );
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
          selectionEpoch++;
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
          if (referenceReadError)
            throw {
              code: "internal",
              message: "Synthetic background reference read failed",
            };
          return {
            items: structuredClone(referenceStores[scope]),
            frames: [],
            edges: [],
            links: [],
          };
        case "canvas_viewport":
          return null;
        case "clipboard_reference": {
          if (clipboardGate) await clipboardGate.promise;
          const row = {
            id: `clip-${++serial}`,
            jamId: scope,
            kind: "asset",
            assetId: null,
            url: null,
            title: "Synthetic clipboard image",
            captionMd: "",
            tags: [],
            x: args.x,
            y: args.y,
            w: 1,
            h: 1,
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
          if (clipboardRejectAfterPersist)
            throw Error("Synthetic response lost after modelled persistence");
          return structuredClone(row);
        }
        case "add_reference": {
          const referenceNumber = calls.filter(
            (c) => c.command === "add_reference",
          ).length;
          if (gate) {
            const captured = gate;
            gate = null;
            await captured.promise;
          }
          if (referenceNumber === referenceFailAt)
            throw {
              code: "validation",
              message: "Synthetic reference rejected",
            };
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
          if (referenceNumber === referencePostCommitFailAt)
            throw {
              code: "internal",
              message: "Synthetic reference error after persistence",
            };
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
          if (number === postCommitFailAt)
            throw {
              code: "internal",
              message: "Synthetic response error after persistence",
            };
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
async function referencesCanvas() {
  // Router location commits before the lazy page import and its canvas read.
  // The paste target must be the real mounted region, never a loading fallback.
  return screen.findByRole(
    "region",
    { name: "References canvas" },
    { timeout: 5000 },
  );
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
it("fences delayed clipboard preparation through actual project/page navigation and confirms current-context paste", async () => {
  expect(api).toBe(tauriApi);
  installTransport();
  selected = "A";
  stores = { A: [], B: [] };
  referenceStores = { A: [], B: [] };
  calls = [];
  const user = userEvent.setup();
  const imageBytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
    0, 0, 1,
  ]);
  const clipFile = new File([imageBytes], "synthetic-clipboard.png", {
    type: "image/png",
  });
  const pngBlob = new Blob([imageBytes], { type: "image/png" });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(pngBlob),
  );
  render(<App />);
  for (const navigation of [
    "A-to-B",
    "ABA",
    "same-project-departure",
  ] as const) {
    if (appState().jam.id === "B") await switchTo("A", user);
    await route("/references");
    const canvas = await referencesCanvas();
    calls = [];
    const decoded = deferred<ImageBitmap>();
    const close = vi.fn();
    const decode = vi.fn(() => decoded.promise);
    vi.stubGlobal("createImageBitmap", decode);
    fireEvent.paste(canvas, {
      clipboardData: { files: [clipFile], getData: () => "" },
    });
    expect(decode).toHaveBeenCalledWith(clipFile);
    expect(
      calls.filter((c) => c.command === "clipboard_reference"),
    ).toHaveLength(0);
    if (navigation === "same-project-departure") {
      await route("/plan");
      await screen.findByRole("heading", { name: "Plan" });
    } else {
      await switchTo("B", user);
      if (navigation === "ABA") await switchTo("A", user);
    }
    expect(
      screen.queryByRole("region", { name: "References canvas" }),
    ).toBeNull();
    await act(async () =>
      decoded.resolve({ width: 1, height: 1, close } as ImageBitmap),
    );
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(
      calls.filter((c) => c.command === "clipboard_reference"),
    ).toHaveLength(0);
    expect(referenceStores).toEqual({ A: [], B: [] });
    expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
      "Audit A [A] · clipboard image: not attempted",
    );
    expect(useUiStore.getState().toasts.at(-1)?.hint).toContain(
      "Project ID: A",
    );
  }
  await route("/references");
  const canvas = await referencesCanvas();
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 1, height: 1, close }),
  );
  calls = [];
  fireEvent.paste(canvas, {
    clipboardData: { files: [clipFile], getData: () => "" },
  });
  await waitFor(() =>
    expect(
      calls.filter((c) => c.command === "clipboard_reference"),
    ).toHaveLength(1),
  );
  const dispatch = calls.find((c) => c.command === "clipboard_reference");
  if (!dispatch) throw Error("Missing observed clipboard dispatch");
  expect(dispatch.scope).toBe("A");
  expect(dispatch.args.bytes).toEqual(Array.from(imageBytes));
  await waitFor(() =>
    expect(
      calls.some((c) => c.command === "reference_canvas" && c.scope === "A"),
    ).toBe(true),
  );
  expect(
    await within(canvas).findByText("Synthetic clipboard image", {
      selector: "strong",
    }),
  ).toBeVisible();
  expect(referenceStores.A).toHaveLength(1);
  expect(referenceStores.B).toHaveLength(0);
  expect(close).toHaveBeenCalledTimes(1);
  expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
    "Audit A [A] · clipboard image: confirmed",
  );
  // Native transport/persistence is modelled; the production App, binding and scope capture are real.
  for (const mode of [
    "different-project",
    "return-to-origin",
    "late-uncertain",
    "current-uncertain",
  ] as const) {
    if (appState().jam.id === "B") await switchTo("A", user);
    await route("/references");
    const originCanvas = await referencesCanvas();
    const previousReceipt = useUiStore.getState().toasts.at(-1)?.id;
    clipboardGate = deferred<void>();
    clipboardRejectAfterPersist = mode.includes("uncertain");
    calls = [];
    fireEvent.paste(originCanvas, {
      clipboardData: { files: [clipFile], getData: () => "" },
    });
    await waitFor(() =>
      expect(
        calls.filter((c) => c.command === "clipboard_reference"),
      ).toHaveLength(1),
    );
    expect(calls.find((c) => c.command === "clipboard_reference")?.scope).toBe(
      "A",
    );
    if (mode !== "current-uncertain") {
      await switchTo("B", user);
      if (mode === "return-to-origin") await switchTo("A", user);
      await route("/references");
      await screen.findByRole("region", { name: "References canvas" });
    }
    const readsBefore = calls.filter(
      (c) => c.command === "reference_canvas",
    ).length;
    await act(async () => clipboardGate?.resolve());
    await waitFor(() =>
      expect(useUiStore.getState().toasts.at(-1)?.id).not.toBe(previousReceipt),
    );
    const expectedOutcome = clipboardRejectAfterPersist
      ? "unconfirmed request"
      : "confirmed";
    await waitFor(() =>
      expect(useUiStore.getState().toasts.at(-1)?.text).toContain(
        `Audit A [A] · clipboard image: ${expectedOutcome}`,
      ),
    );
    expect(
      calls.filter((c) => c.command === "clipboard_reference"),
    ).toHaveLength(1);
    expect(referenceStores.B).toHaveLength(0);
    expect(useUiStore.getState().toasts.at(-1)?.persistent).toBe(true);
    expect(useUiStore.getState().toasts.at(-1)?.hint).toContain(
      "Project ID: A",
    );
    if (mode === "current-uncertain") {
      expect(
        calls.filter((c) => c.command === "reference_canvas").length,
      ).toBeGreaterThan(readsBefore);
    } else {
      expect(
        calls.filter((c) => c.command === "reference_canvas"),
      ).toHaveLength(readsBefore);
    }
    if (clipboardRejectAfterPersist)
      expect(useUiStore.getState().toasts.at(-1)?.hint).toContain(
        "may already have saved",
      );
    if (mode === "return-to-origin") {
      await user.click(
        screen.getByRole("button", { name: "Refresh references" }),
      );
      await waitFor(() =>
        expect(
          screen.getAllByText("Synthetic clipboard image", {
            selector: "strong",
          }),
        ).toHaveLength(referenceStores.A.length),
      );
      expect(
        calls.filter((c) => c.command === "clipboard_reference"),
      ).toHaveLength(1);
    }
    clipboardGate = null;
    clipboardRejectAfterPersist = false;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}, 15000);
