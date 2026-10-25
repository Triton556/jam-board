// Round-five DOM/mock evidence; pointer geometry is covered by shoot.cjs.
import { readFileSync } from "node:fs";
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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReferenceCanvas, RefFrame } from "../../bindings";
import type { VerdictItem } from "../../lib/api";
import { mockApi } from "../../lib/mock-bridge";
import { LinkTargetDialog } from "./LinkTargetDialog";
import {
  canvasPick,
  choiceRefs,
  dispatchBoardDrop,
  dropChoices,
  frameTargets,
  linkChoices,
} from "./linking";
import { linkedTargets } from "./model";
import { ReferenceFrame } from "./Nodes";
import {
  FrameMosaic,
  ReferencesSection,
  ReferenceThumb,
} from "./ReferencesSection";
import { CanvasContext, type CanvasRuntime } from "./runtime";
import { VerdictToolbar } from "./VerdictToolbar";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouterState: () => "/board?task=JB-1",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
  navigate.mockClear();
  canvasPick.set(null);
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const app = await mockApi.appState();
  const frame = await mockApi.createRefFrame({
    title: "Moodboard",
    x: 0,
    y: 0,
  });
  const item = await mockApi.addReference({
    kind: "note",
    title: "Candidate",
    text: "Warm light",
    frameId: frame.id,
  });
  const loose = await mockApi.addReference({
    kind: "link",
    title: "Source",
    url: "https://example.test",
  });
  const targets = [
    ...(await mockApi.listEpics()).map((t) => ({ ...t, kind: "epic" })),
    ...(await mockApi.listStories()).map((t) => ({ ...t, kind: "story" })),
    ...Object.values(await mockApi.listBoardTasks())
      .flat()
      .map((t) => ({ ...t, kind: "task" })),
  ];
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], app);
  client.setQueryData(["references"], await mockApi.referenceCanvas());
  return { app, frame, item, loose, targets, client };
}
it("drawer drop state reveals its target hint inside a rounded padded zone below the heading", async () => {
  const f = await fixture();
  const { container } = render(
    <QueryClientProvider client={f.client}>
      <style>
        {readFileSync("src/features/references/references.css", "utf8") +
          readFileSync("src/features/references/section.css", "utf8")}
      </style>
      <ReferencesSection targetKey="JB-1" epicKey="" />
    </QueryClientProvider>,
  );
  const section = container.querySelector(".references-section") as HTMLElement;
  const zone = section.querySelector(".reference-drop-zone") as HTMLElement;
  const hint = screen.getByText("Drop to link to JB-1");
  expect(hint).not.toBeVisible();
  expect(
    zone.contains(screen.getByRole("heading", { name: "References" })),
  ).toBe(false);
  expect(zone.contains(hint)).toBe(true);
  act(() => section.classList.add("board-ref-drag-over"));
  expect(hint).toBeVisible();
  expect(getComputedStyle(zone).borderTopStyle).toBe("dashed");
  expect(getComputedStyle(zone).paddingTop).toBe("12px");
  expect(getComputedStyle(section).outlineStyle).toBe("none");
  act(() => section.classList.remove("board-ref-drag-over"));
  expect(hint).not.toBeVisible();
});
it.each(["epic", "story", "task"])(
  "links/unlinks frame and item to %s without deleting, including future frame children",
  async (kind) => {
    const f = await fixture(),
      target = f.targets.find((t) => t.kind === kind);
    if (!target) throw Error("Missing target");
    await linkChoices(
      [
        { kind: "frame", id: f.frame.id },
        { kind: "item", id: f.loose.id },
      ],
      target.key,
    );
    await mockApi.linkRefFrame(f.frame.id, target.key);
    const added = await mockApi.addReference({
      kind: "note",
      text: "Future child",
      frameId: f.frame.id,
    });
    let data = await mockApi.referenceCanvas();
    expect(
      frameTargets(data.frames.find((row) => row.id === f.frame.id) ?? f.frame),
    ).toHaveLength(1);
    expect(linkedTargets(added, data, f.targets)).toMatchObject([
      { key: target.key, viaFrame: true },
    ]);
    if (kind === "task")
      expect((await mockApi.getTask(target.key)).references).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: added.id,
            via: "frame",
            frameId: f.frame.id,
            frameTitle: "Moodboard",
          }),
        ]),
      );
    await mockApi.unlinkRefFrame(f.frame.id, target.key);
    await mockApi.unlinkReference(f.loose.id, target.key);
    data = await mockApi.referenceCanvas();
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: f.loose.id }),
        expect.objectContaining({ id: added.id }),
      ]),
    );
    expect(linkedTargets(added, data, f.targets)).toEqual([]);
  },
);
it("drawer picker selects frames and items across tabs, links them and removes links only", async () => {
  const f = await fixture(),
    target = f.targets.find((t) => t.kind === "task");
  if (!target) throw Error("Missing task");
  render(
    <QueryClientProvider client={f.client}>
      <ReferencesSection targetKey={target.key} epicKey="" />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "From canvas…" }));
  const dialog = screen.getByRole("dialog", { name: "From canvas" });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("textbox", { name: "Search canvas" }),
    ).toHaveFocus(),
  );
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: /Moodboard/ }),
  );
  await userEvent.click(within(dialog).getByRole("tab", { name: "Items" }));
  await userEvent.type(within(dialog).getByRole("textbox"), "Source");
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: "Source" }),
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Link 2" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(
      screen.getByText("Moodboard", { selector: "strong" }),
    ).toBeInTheDocument(),
  );
  expect(screen.getAllByRole("button", { name: "Remove link" })).toHaveLength(
    2,
  );
  const frameCard = screen.getByText("Moodboard").closest("article");
  if (!frameCard) throw Error("No frame card");
  await userEvent.click(
    within(frameCard).getByRole("button", { name: "Remove link" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Moodboard", { selector: "strong" })).toBeNull(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove link" }));
  await waitFor(() =>
    expect(screen.getByText("No linked references yet.")).toBeVisible(),
  );
  expect(
    (await mockApi.referenceCanvas()).items.some(
      (row) => row.id === f.loose.id,
    ),
  ).toBe(true);
});
it("drawer pick mode captures the exact return location and project without linking", async () => {
  const f = await fixture();
  render(
    <QueryClientProvider client={f.client}>
      <ReferencesSection targetKey="JB-1" epicKey="" />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Pick on canvas" }),
  );
  expect(canvasPick.get()).toEqual({
    projectId: f.app.jam?.id,
    targetKey: "JB-1",
    returnTo: "/board?task=JB-1",
  });
  expect(navigate).toHaveBeenCalledWith({ to: "/references" });
  expect(
    mockApi.calls.filter((row) => row.command === "link_ref_frame"),
  ).toHaveLength(0);
});
it("canvas target picker searches by key, groups work and links mixed selection", async () => {
  const f = await fixture(),
    target = f.targets.find((t) => t.kind === "story");
  if (!target) throw Error("Missing story");
  const close = vi.fn();
  render(
    <QueryClientProvider client={f.client}>
      <LinkTargetDialog
        choices={[
          { kind: "frame", id: f.frame.id },
          { kind: "item", id: f.loose.id },
        ]}
        targets={f.targets}
        projectId={f.app.jam?.id ?? ""}
        close={close}
        saved={async () => {}}
      />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.type(screen.getByRole("textbox"), target.key);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Link 2" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(
    frameTargets((await mockApi.referenceCanvas()).frames[0] ?? f.frame),
  ).toMatchObject([{ targetKey: target.key }]);
});
it("board-ref-drop emits exact URIs and links drawer references without geometry writes", async () => {
  const f = await fixture(),
    target = f.targets.find((t) => t.kind === "task");
  if (!target) throw Error("Missing task");
  render(
    <QueryClientProvider client={f.client}>
      <ReferencesSection targetKey={target.key} epicKey="" />
    </QueryClientProvider>,
  );
  const section = document.querySelector<HTMLElement>(
    '[data-board-ref-drop="drawer-references"]',
  );
  if (!section) throw Error("Missing drop target");
  const refs = choiceRefs(
    [
      { id: f.frame.id, kind: "frame" },
      { id: f.loose.id, kind: "item" },
    ],
    await mockApi.referenceCanvas(),
  );
  expect(refs).toEqual([
    { uri: `jam://frame/${f.frame.id}`, label: "Moodboard", text: "Moodboard" },
    { uri: `jam://reference/${f.loose.id}`, label: "Source", text: "" },
  ]);
  const receive = vi.fn();
  window.addEventListener("jam:board-ref-drop", receive, { once: true });
  act(() => dispatchBoardDrop(section, refs));
  expect(receive.mock.calls[0]?.[0].detail).toEqual({
    target: "drawer-references",
    refs,
  });
  await waitFor(() =>
    expect(
      screen.getByText("Moodboard", { selector: "strong" }),
    ).toBeInTheDocument(),
  );
  expect(mockApi.calls.some((row) => row.command === "canvas_geometry")).toBe(
    false,
  );
  expect(
    dropChoices([{ uri: "https://example.test", label: "bad", text: "" }]),
  ).toEqual([]);
});
function VerdictHarness({ id }: { id: string }) {
  const data = useQuery({
    queryKey: ["references"],
    queryFn: () => mockApi.referenceCanvas(),
  });
  const item = data.data?.items.find((row) => row.id === id);
  return item ? <VerdictToolbar item={item} /> : null;
}
it("verdict buttons have 28px computed hit areas in unchanged 24px layout slots", async () => {
  const f = await fixture();
  render(
    <QueryClientProvider client={f.client}>
      <style>
        {readFileSync("src/features/references/references.css", "utf8")}
      </style>
      <VerdictToolbar item={f.item} />
    </QueryClientProvider>,
  );
  for (const name of ["Keep", "Not this"]) {
    const button = screen.getByRole("button", { name });
    const hit = getComputedStyle(button);
    expect(hit.width).toBe("28px");
    expect(hit.height).toBe("28px");
    expect(hit.minHeight).toBe("28px");
    expect(hit.boxSizing).toBe("border-box");
    expect(hit.marginTop).toBe("-2px");
    expect(hit.marginLeft).toBe("-2px");
    const slot = getComputedStyle(button.parentElement as HTMLElement);
    expect(slot.width).toBe("24px");
    expect(slot.height).toBe("24px");
    const face = getComputedStyle(
      button.querySelector(".reference-verdict-face") as HTMLElement,
    );
    expect(face.width).toBe("24px");
    expect(face.height).toBe("24px");
    expect(face.boxSizing).toBe("border-box");
  }
});
it("verdict toggles are mutually exclusive and clear on second click", async () => {
  const f = await fixture();
  render(
    <QueryClientProvider client={f.client}>
      <VerdictHarness id={f.item.id} />
    </QueryClientProvider>,
  );
  const keep = screen.getByRole("button", { name: "Keep" }),
    reject = screen.getByRole("button", { name: "Not this" });
  await userEvent.click(keep);
  await waitFor(() => expect(keep).toBeEnabled());
  expect(keep).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(reject);
  await waitFor(() => expect(reject).toBeEnabled());
  expect(keep).toHaveAttribute("aria-pressed", "false");
  expect(reject).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(reject);
  await waitFor(() => expect(reject).toBeEnabled());
  expect(reject).toHaveAttribute("aria-pressed", "false");
  expect(
    (await mockApi.referenceCanvas()).items.find((row) => row.id === f.item.id),
  ).toMatchObject({ verdict: null });
});
it("verdict is optimistic and restores only its own field when the command fails", async () => {
  const f = await fixture();
  let reject!: (reason: Error) => void;
  vi.spyOn(mockApi, "setReferenceVerdict").mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  render(
    <QueryClientProvider client={f.client}>
      <VerdictHarness id={f.item.id} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Not this" }));
  await waitFor(() =>
    expect(
      (
        f.client
          .getQueryData<ReferenceCanvas>(["references"])
          ?.items.find((row) => row.id === f.item.id) as VerdictItem | undefined
      )?.verdict,
    ).toBe("reject"),
  );
  act(() =>
    f.client.setQueryData<ReferenceCanvas>(
      ["references"],
      (data) =>
        data && {
          ...data,
          items: data.items.map((row) =>
            row.id === f.item.id
              ? { ...row, title: "Concurrent caption" }
              : row,
          ),
        },
    ),
  );
  await act(async () => reject(Error("offline")));
  expect(
    f.client
      .getQueryData<ReferenceCanvas>(["references"])
      ?.items.find((row) => row.id === f.item.id),
  ).toMatchObject({ verdict: null, title: "Concurrent caption" });
});
it("frame tab shows at most two target chips, opens targets, and unlinks from its keyboard menu", async () => {
  const f = await fixture();
  const runtime = {
    open: vi.fn(),
    unlinkFrame: vi.fn(),
    linkFrame: vi.fn(),
  } as unknown as CanvasRuntime;
  const frame: RefFrame = {
    ...f.frame,
    links: [
      { targetKey: "JB-1", title: "Task one", kind: "task" },
      { targetKey: "JB-S1", title: "Story one", kind: "story" },
      { targetKey: "JB-E1", title: "Epic one", kind: "epic" },
    ],
  };
  render(
    <ReactFlowProvider>
      <CanvasContext.Provider value={runtime}>
        <ReferenceFrame
          id={frame.id}
          data={{ frame, dim: false }}
          type="frame"
          width={800}
          selected
          dragging={false}
          zIndex={-1}
          isConnectable={false}
          selectable
          draggable
          deletable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </CanvasContext.Provider>
    </ReactFlowProvider>,
  );
  expect(screen.getByRole("button", { name: "JB-1" })).toBeVisible();
  expect(screen.getByRole("button", { name: "JB-S1" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "JB-E1" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "JB-1" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Open" }));
  expect(runtime.open).toHaveBeenCalledWith("JB-1");
  await userEvent.click(screen.getByRole("button", { name: "JB-1" }));
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(runtime.unlinkFrame).toHaveBeenCalledWith(frame, "JB-1");
  await userEvent.click(
    screen.getByRole("button", { name: "More linked work" }),
  );
  expect(
    screen.getByRole("menuitem", { name: "JB-E1 · Epic one" }),
  ).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "JB-1 · Task one" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Link options for JB-1" }),
  ).toBeNull();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
});
it("a batch stops before a write when the selected project changes", async () => {
  const f = await fixture();
  vi.spyOn(mockApi, "appState").mockResolvedValue({
    ...f.app,
    jam: f.app.jam ? { ...f.app.jam, id: "different-project" } : null,
  });
  await expect(
    linkChoices([{ id: f.frame.id, kind: "frame" }], "JB-1", f.app.jam?.id),
  ).rejects.toThrow("project changed");
  expect(mockApi.calls.some((call) => call.command === "link_ref_frame")).toBe(
    false,
  );
});
it("drawer groups frame children once, expands them, and preserves a child's direct association", async () => {
  const f = await fixture();
  await mockApi.linkRefFrame(f.frame.id, "JB-1");
  await mockApi.linkReference(f.item.id, "JB-1");
  await mockApi.linkReference(f.loose.id, "JB-1");
  f.client.setQueryData(["references"], await mockApi.referenceCanvas());
  render(
    <QueryClientProvider client={f.client}>
      <ReferencesSection targetKey="JB-1" epicKey="" />
    </QueryClientProvider>,
  );
  const title = await screen.findByText("Moodboard", { selector: "strong" });
  const card = title.closest("article") as HTMLElement;
  const disclosure = within(card).getByText("1 item", { selector: "summary" });
  const details = disclosure.closest("details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(card.querySelectorAll(".linked-frame-child")).toHaveLength(1);
  expect(
    document.querySelectorAll(
      ".linked-references > .linked-reference:not(.linked-frame)",
    ),
  ).toHaveLength(1);
  expect(screen.getAllByText("Candidate", { selector: "button" })).toHaveLength(
    1,
  );
  await userEvent.click(disclosure);
  expect(details.open).toBe(true);
  expect(within(card).getByRole("button", { name: "Candidate" })).toBeVisible();
  expect(within(card).getByText("Direct")).toBeVisible();
  const child = card.querySelector(".linked-frame-child") as HTMLElement;
  await userEvent.click(
    within(child).getByRole("button", { name: "Remove link" }),
  );
  await waitFor(() =>
    expect(within(child).getByText("via frame")).toBeVisible(),
  );
  expect(screen.getAllByText("Candidate", { selector: "button" })).toHaveLength(
    1,
  );
  expect(
    (await mockApi.referenceCanvas()).items.some(
      (item) => item.id === f.item.id,
    ),
  ).toBe(true);
});
it("drawer type previews distinguish sticky notes, links, files and image thumbnails; mosaics use real tiles", async () => {
  const f = await fixture();
  const file = await mockApi.addReference({
    kind: "asset",
    filePath: "C:/mock/brief.pdf",
    title: "Brief",
    frameId: f.frame.id,
  });
  const image = await mockApi.addReference({
    kind: "asset",
    filePath: "C:/mock/image.png",
    title: "Image",
    frameId: f.frame.id,
  });
  const link = { ...f.loose, frameId: f.frame.id };
  vi.spyOn(mockApi, "assetPreview").mockResolvedValue(
    "data:image/png;base64,AAAA",
  );
  const paths = new Map([
    [file.assetId ?? "", "C:/mock/brief.pdf"],
    [image.assetId ?? "", "C:/mock/image.png"],
  ]);
  const view = (mosaic = false, items = [f.item, link, file, image]) => (
    <QueryClientProvider client={f.client}>
      {mosaic ? (
        <FrameMosaic frame={f.frame} items={items} paths={paths} />
      ) : (
        items.map((item) => (
          <ReferenceThumb
            key={item.id}
            item={item}
            path={paths.get(item.assetId ?? "")}
          />
        ))
      )}
    </QueryClientProvider>
  );
  const { container, rerender } = render(view());
  expect(
    screen
      .getByRole("img", { name: "note reference" })
      .querySelector(".lucide-sticky-note"),
  ).not.toBeNull();
  expect(
    screen
      .getByRole("img", { name: "link reference" })
      .querySelector(".lucide-link"),
  ).not.toBeNull();
  expect(
    screen
      .getByRole("img", { name: "file reference" })
      .querySelector(".lucide-file"),
  ).not.toBeNull();
  expect(await screen.findByRole("img", { name: "Image" })).toHaveAttribute(
    "src",
    "data:image/png;base64,AAAA",
  );
  expect(mockApi.assetPreview).toHaveBeenCalledTimes(1);
  rerender(view(true));
  expect(
    container.querySelectorAll(".reference-frame-mosaic > span"),
  ).toHaveLength(4);
  expect(
    container.querySelectorAll(".reference-frame-mosaic [data-reference-kind]"),
  ).toHaveLength(3);
  rerender(view(true, [f.item]));
  expect(container.querySelector(".reference-frame-mosaic")).toHaveClass(
    "is-single",
  );
  expect(
    container.querySelectorAll(".reference-frame-mosaic > span"),
  ).toHaveLength(1);
});
it("picker shows populated/empty counts and first images in canvas order, including additions before and during opening", async () => {
  const f = await fixture();
  const empty = await mockApi.createRefFrame({
    title: "Empty board",
    x: 0,
    y: 0,
  });
  for (let i = 0; i < 3; i++)
    await mockApi.addReference({
      kind: "note",
      text: `Paper ${i}`,
      frameId: f.frame.id,
    });
  f.client.setQueryData(["references"], await mockApi.referenceCanvas());
  const late = await mockApi.addReference({
    kind: "asset",
    title: "Later position",
    filePath: "C:/mock/later.png",
    frameId: f.frame.id,
    x: 500,
    y: 300,
  });
  const first = await mockApi.addReference({
    kind: "asset",
    title: "First position",
    filePath: "C:/mock/first.png",
    frameId: f.frame.id,
    x: 100,
    y: 100,
  });
  vi.spyOn(mockApi, "assetPreview").mockResolvedValue(
    "data:image/png;base64,AAAA",
  );
  render(
    <QueryClientProvider client={f.client}>
      <ReferencesSection targetKey="JB-1" epicKey="" />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "From canvas…" }));
  const dialog = screen.getByRole("dialog", { name: "From canvas" });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("textbox", { name: "Search canvas" }),
    ).toHaveFocus(),
  );
  const row = within(dialog)
    .getByRole("checkbox", { name: f.frame.title })
    .closest("label") as HTMLElement;
  await waitFor(() => expect(within(row).getByText("6 items")).toBeVisible());
  expect(
    within(dialog)
      .getByRole("checkbox", { name: empty.title })
      .closest("label"),
  ).toHaveTextContent("0 items");
  await waitFor(() =>
    expect(
      Array.from(row.querySelectorAll("img")).map((image) => image.alt),
    ).toEqual([first.title, late.title]),
  );
  const newest = await mockApi.addReference({
    kind: "asset",
    title: "Newest image first",
    filePath: "C:/mock/newest.png",
    frameId: f.frame.id,
    x: 40,
    y: 40,
  });
  await act(async () => {
    await f.client.invalidateQueries({ queryKey: ["references"] });
    await f.client.invalidateQueries({ queryKey: ["assets"] });
  });
  await waitFor(() => expect(within(row).getByText("7 items")).toBeVisible());
  await waitFor(() =>
    expect(
      Array.from(row.querySelectorAll("img")).map((image) => image.alt),
    ).toEqual([newest.title, first.title, late.title]),
  );
});
