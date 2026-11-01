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
import type { ReferenceCanvas, RefFrame } from "../../bindings";
import { mockApi } from "../../lib/mock-bridge";
import {
  mockMoodboardApi,
  moodboardHash,
  rowMajor,
} from "../../lib/mock-moodboard";
import { CollectKeepDialog, ReviewBar } from "./MoodboardReview";
import { CanvasContext, type CanvasRuntime } from "./runtime";
import { useMoodboard } from "./use-moodboard";
import { VerdictToolbar } from "./VerdictToolbar";

vi.mock("../../lib/moodboard-api", async () => ({
  moodboardApi: (await import("../../lib/mock-moodboard")).mockMoodboardApi,
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  vi.restoreAllMocks();
});
let active: ReturnType<typeof useMoodboard>;
const announce = vi.fn();
const flow = {
  fitView: vi.fn(async () => true),
  getViewport: () => ({ x: 10, y: 20, zoom: 0.5 }),
  setViewport: vi.fn(async () => true),
};
async function mount() {
  const frame = await mockApi.createRefFrame({ title: "Sky", x: 0, y: 0 });
  for (let i = 0; i < 4; i++)
    await mockApi.addReference({
      kind: "link",
      url: `https://example.test/${i}`,
      title: `Image ${i}`,
      frameId: frame.id,
    });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  client.setQueryData(["references"], await mockApi.referenceCanvas());
  function Harness() {
    const { data } = useQuery<ReferenceCanvas>({
      queryKey: ["references"],
      queryFn: () => mockApi.referenceCanvas(),
    });
    active = useMoodboard(
      data,
      flow as unknown as Parameters<typeof useMoodboard>[1],
      vi.fn(),
      () => client.invalidateQueries({ queryKey: ["references"] }),
      vi.fn(),
      announce,
      vi.fn(),
    );
    const runtime = {
      reasonItemId: active.reasonId,
      reason: (item) => active.setReasonId(item?.id ?? null),
      feedback: active.feedback,
    } as CanvasRuntime;
    return (
      <CanvasContext.Provider value={runtime}>
        <section
          aria-label="Review test"
          tabIndex={-1}
          onKeyDownCapture={(event) => {
            if (!(event.target as HTMLElement).closest("textarea,input"))
              active.key(event);
          }}
        >
          <ReviewBar review={active} />
          {active.current && <VerdictToolbar item={active.current} />}
        </section>
      </CanvasContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  act(() => active.start(frame));
  await screen.findByLabelText("Moodboard review");
  return { frame, client };
}
it("M3 keys navigate, toggle and auto-advance without moving geometry, filters count and Exit restores viewport", async () => {
  const { frame } = await mount();
  const before = (await mockApi.referenceCanvas()).items
    .filter((i) => i.frameId === frame.id)
    .map((i) => [i.id, i.x, i.y]);
  const canvas = screen.getByLabelText("Review test");
  const initial = active.current?.id;
  fireEvent.keyDown(canvas, { key: "ArrowRight" });
  expect(active.current?.id).not.toBe(initial);
  fireEvent.keyDown(canvas, { key: "k" });
  expect(active.current?.id).toBe(initial);
  for (let i = 0; i < 4; i++) {
    fireEvent.keyDown(canvas, { key: i % 2 === 0 ? "1" : "2" });
    await waitFor(() => expect(active.pending).toBe(false));
  }
  expect(screen.getByText("All rated")).toBeVisible();
  expect(screen.getByText("Sky · 4 of 4 rated")).toBeVisible();
  expect(
    (await mockApi.referenceCanvas()).items
      .filter((i) => i.frameId === frame.id)
      .map((i) => [i.id, i.x, i.y]),
  ).toEqual(before);
  await userEvent.click(screen.getByRole("button", { name: "Keep 2" }));
  expect(active.matching).toHaveLength(2);
  fireEvent.keyDown(canvas, { key: "1" });
  await waitFor(() => expect(active.pending).toBe(false));
  expect(active.current?.id).toBeTruthy();
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(screen.queryByLabelText("Moodboard review")).toBeNull();
  expect(flow.setViewport).toHaveBeenCalledWith(
    { x: 10, y: 20, zoom: 0.5 },
    { duration: 180 },
  );
});
it("M1 C opens the reason, Shift+Enter keeps a newline, Enter saves, empty clears, Esc closes before review exits", async () => {
  await mount();
  const canvas = screen.getByLabelText("Review test"),
    id = active.current!.id;
  fireEvent.keyDown(canvas, { key: "c" });
  let textarea = await screen.findByPlaceholderText("Why keep or reject this?");
  fireEvent.change(textarea, { target: { value: "Light\nShape" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  expect(
    screen.getByRole("dialog", { name: "Reference reason" }),
  ).toBeVisible();
  fireEvent.keyDown(textarea, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    (await mockApi.referenceCanvas()).items.find((i) => i.id === id)
      ?.verdictNote,
  ).toBe("Light\nShape");
  fireEvent.keyDown(canvas, { key: "c" });
  textarea = await screen.findByPlaceholderText("Why keep or reject this?");
  fireEvent.change(textarea, { target: { value: "x".repeat(500) } });
  expect(textarea).toHaveAttribute("maxlength", "500");
  expect(screen.getByText("500/500")).toBeVisible();
  fireEvent.keyDown(textarea, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Moodboard review")).toBeVisible();
  fireEvent.keyDown(canvas, { key: "c" });
  textarea = await screen.findByPlaceholderText("Why keep or reject this?");
  fireEvent.change(textarea, { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    (await mockApi.referenceCanvas()).items.find((i) => i.id === id)
      ?.verdictNote,
  ).toBeNull();
});
it("M3 fast keyboard ratings queue across pending saves without dropping intent", async () => {
  const { frame } = await mount();
  const canvas = screen.getByLabelText("Review test");
  for (const key of ["1", "2", "1", "2"]) fireEvent.keyDown(canvas, { key });
  await waitFor(() =>
    expect(screen.getByText("Sky · 4 of 4 rated")).toBeVisible(),
  );
  const items = (await mockApi.referenceCanvas()).items.filter(
    (i) => i.frameId === frame.id,
  );
  expect(items.filter((i) => i.verdict === "keep")).toHaveLength(2);
  expect(items.filter((i) => i.verdict === "reject")).toHaveLength(2);
});
it("M1 failed reason keeps the draft and rolls back feedback", async () => {
  const { client } = await mount();
  const id = active.current!.id;
  vi.spyOn(mockMoodboardApi, "feedback").mockRejectedValueOnce(
    new Error("offline"),
  );
  fireEvent.keyDown(screen.getByLabelText("Review test"), { key: "c" });
  const textarea = await screen.findByPlaceholderText(
    "Why keep or reject this?",
  );
  fireEvent.change(textarea, { target: { value: "Retained draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
  );
  expect(textarea).toHaveValue("Retained draft");
  expect(
    client
      .getQueryData<ReferenceCanvas>(["references"])
      ?.items.find((i) => i.id === id)?.verdictNote,
  ).toBeNull();
});
it("M5 Send computes a hash and changed-since-sent clears only on resend", async () => {
  const { frame } = await mount();
  const id = active.current!.id;
  await act(async () => {
    await active.feedback({ itemId: id, verdict: "keep" });
    await active.send(frame);
  });
  expect(screen.queryByLabelText("Moodboard review")).toBeNull();
  let sent = (await mockApi.referenceCanvas()).frames.find(
    (f) => f.id === frame.id,
  )!;
  expect(sent.review?.sentAt).toBeTruthy();
  expect(sent.review?.changedSinceSent).toBe(false);
  await mockMoodboardApi.feedback({ itemId: id, verdict: "reject" });
  sent = (await mockApi.referenceCanvas()).frames.find(
    (f) => f.id === frame.id,
  )!;
  expect(sent.review?.changedSinceSent).toBe(true);
  await mockMoodboardApi.send(frame.id);
  expect(
    (await mockApi.referenceCanvas()).frames.find((f) => f.id === frame.id)
      ?.review?.changedSinceSent,
  ).toBe(false);
});
it.each([
  [0, 0, "0 rated items and 0 reasons"],
  [1, 1, "1 rated item and 1 reason"],
  [3, 2, "3 rated items and 2 reasons"],
])(
  "Fix 1 Send pluralizes %s ratings and %s reasons",
  async (rated, reasons, words) => {
    const { frame } = await mount();
    const items = active.items;
    for (let i = 0; i < Math.max(Number(rated), Number(reasons)); i++) {
      await act(async () => {
        await active.feedback({
          itemId: items[i]!.id,
          verdict: i < Number(rated) ? "keep" : null,
          verdictNote: i < Number(reasons) ? "Soft light" : null,
        });
      });
    }
    await act(async () => active.send(frame));
    expect(announce).toHaveBeenLastCalledWith(
      `Review sent. The brain will see ${words}.`,
    );
  },
);
it("M6 ancestry rejects loops and M7 collects sections, shares assets, resets feedback and replays", async () => {
  const { frame } = await mount();
  const canvas = await mockApi.referenceCanvas(),
    items = canvas.items.filter((i) => i.frameId === frame.id);
  const first = items[0]!,
    second = items[1]!;
  act(() => active.setVariationId(second.id));
  fireEvent.keyDown(screen.getByLabelText("Review test"), { key: "Escape" });
  expect(active.variationId).toBeNull();
  expect(screen.getByLabelText("Moodboard review")).toBeVisible();
  act(() => active.setVariationId(second.id));
  act(() => active.clicked(first.id));
  await waitFor(() => expect(active.variationId).toBeNull());
  expect(
    (await mockApi.referenceCanvas()).items.find((row) => row.id === second.id)
      ?.derivedFrom,
  ).toBe(first.id);
  await mockMoodboardApi.update(second.id, {
    origin: "generated",
    sourceUrl: "https://example.test/source",
  });
  await expect(
    mockMoodboardApi.update(first.id, { derivedFrom: second.id }),
  ).rejects.toThrow("loop");
  await expect(
    mockMoodboardApi.update(first.id, {
      sourceUrl: "https://user:pass@example.test",
    }),
  ).rejects.toThrow("credentials");
  await mockMoodboardApi.feedback({
    itemId: first.id,
    verdict: "keep",
    verdictNote: "Light",
  });
  const input = {
    requestId: crypto.randomUUID(),
    sourceFrameIds: [frame.id],
    title: null,
    linkTo: null,
  };
  const result = await mockMoodboardApi.collect(input);
  expect(result.sections).toEqual([
    { sourceFrameId: frame.id, title: "Sky", count: 1 },
  ]);
  const copy = (await mockApi.referenceCanvas()).items.find(
    (i) => i.id === result.itemIds[0],
  )!;
  expect(copy).toMatchObject({
    copiedFrom: first.id,
    verdict: null,
    verdictNote: null,
    assetId: first.assetId,
  });
  expect((await mockMoodboardApi.collect(input)).frame.id).toBe(
    result.frame.id,
  );
  expect(await moodboardHash([first])).toMatch(/^[a-f0-9]{64}$/);
  expect(
    await moodboardHash([
      { ...first, id: "a", verdict: "keep", verdictNote: "light" },
      { ...first, id: "A", verdict: null, verdictNote: null },
    ]),
  ).toBe("3e495a67316fee993d533889ab672e7ac02f84833d04ea2c83e06b709fddc495");
  expect(
    rowMajor([
      { id: "a", x: 20, y: 5 },
      { id: "b", x: 0, y: 10 },
      { id: "c", x: 0, y: 40 },
    ]).map((i) => i.id),
  ).toEqual(["b", "a", "c"]);
});
it("M7 collection dialog disables empty creation and supports keyboard section ordering", async () => {
  const first = { id: "a", title: "First", review: { keep: 0 } } as RefFrame,
    second = { id: "b", title: "Second", review: { keep: 0 } } as RefFrame;
  render(
    <CollectKeepDialog
      frames={[first, second]}
      targets={[]}
      close={vi.fn()}
      saved={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  expect(screen.getByText("No Keep items yet")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Move Second up" }));
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second");
});
