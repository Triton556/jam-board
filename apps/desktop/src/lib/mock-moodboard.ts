import type {
  CollectKeptResult,
  FrameReview,
  ReferenceCanvas,
  ReferenceCanvas_Deserialize,
  RefFrame,
  RefItem,
} from "../bindings";
import type { MockReferencesContext } from "./mock-references";
import type { MoodboardApi } from "./moodboard-api";
import { JamError } from "./types";

let attachedContext: MockReferencesContext;
export function attachMockMoodboard(value: MockReferencesContext) {
  attachedContext = value;
}
const clone = <T>(value: T): T => structuredClone(value);
const invalid = (message: string): never => {
  throw new JamError("validation", message);
};
function item(id: string, context = attachedContext) {
  const row = context
    .data()
    .items.find(
      (i) => i.id === id && i.jamId === context.jam() && !i.archivedAt,
    );
  if (!row) throw new JamError("not_found", "Reference not found");
  return row;
}
function frame(id: string, context = attachedContext) {
  const row = context
    .data()
    .frames.find(
      (f) => f.id === id && f.jamId === context.jam() && !f.archivedAt,
    );
  if (!row) throw new JamError("not_found", "Frame not found");
  return row;
}
export function rowMajor<
  T extends { x: number | null; y: number | null; id: string },
>(values: T[]): T[] {
  const items = [...values].sort(
    (a, b) =>
      (a.y ?? 0) - (b.y ?? 0) ||
      (a.x ?? 0) - (b.x ?? 0) ||
      a.id.localeCompare(b.id),
  );
  for (let start = 0; start < items.length; ) {
    let end = start + 1;
    while (
      end < items.length &&
      (items[end]!.y ?? 0) - (items[start]!.y ?? 0) < 24
    )
      end++;
    items.splice(
      start,
      end - start,
      ...items
        .slice(start, end)
        .sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || a.id.localeCompare(b.id)),
    );
    start = end;
  }
  return items;
}
export async function moodboardHash(items: RefItem[]) {
  const lines = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((i) => `${i.id}\t${i.verdict ?? "-"}\t${i.verdictNote ?? "-"}\n`)
    .join("");
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(lines),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function activeFrameItems(data: ReferenceCanvas, id: string) {
  return data.items.filter(
    (i) => i.frameId === id && !i.archivedAt && i.kind !== "note",
  );
}
function attached(note: RefItem, items: RefItem[]) {
  const nx = note.x ?? 0,
    ny = note.y ?? 0,
    nw = note.w ?? 240,
    nh = note.h ?? 180;
  return items.some((i) => {
    const x = i.x ?? 0,
      y = i.y ?? 0,
      w = i.w ?? 240,
      h = i.h ?? 180,
      cx = nx + nw / 2,
      cy = ny + nh / 2;
    const overlap =
      Math.max(0, Math.min(nx + nw, x + w) - Math.max(nx, x)) *
      Math.max(0, Math.min(ny + nh, y + h) - Math.max(ny, y));
    return (
      (cx >= x && cx <= x + w && cy >= y && cy <= y + h) ||
      overlap >= 0.3 * nw * nh
    );
  });
}
type StoredFrame = RefFrame & { reviewHash?: string };
export async function summarizeMockCanvas(
  data: ReferenceCanvas,
): Promise<ReferenceCanvas_Deserialize> {
  const frames = await Promise.all(
    data.frames.map(async (f) => {
      const items = activeFrameItems(data, f.id),
        keep = items.filter((i) => i.verdict === "keep").length,
        reject = items.filter((i) => i.verdict === "reject").length;
      const review: FrameReview | null = items.length
        ? {
            total: items.length,
            keep,
            reject,
            unrated: items.length - keep - reject,
            comments:
              items.filter((i) => i.verdictNote).length +
              data.items.filter(
                (i) =>
                  i.kind === "note" &&
                  !i.archivedAt &&
                  i.frameId === f.id &&
                  attached(i, items),
              ).length,
            sentAt: f.review?.sentAt ?? null,
            sentBy: f.review?.sentBy ?? null,
            changedSinceSent:
              !!f.review?.sentAt &&
              (f as StoredFrame).reviewHash !== (await moodboardHash(items)),
          }
        : null;
      return { ...f, review };
    }),
  );
  return { ...data, frames };
}
export function validateMoodboardFields(
  id: string | null,
  patch: {
    sourceUrl?: string | null;
    derivedFrom?: string | null;
    origin?: RefItem["origin"];
  },
  context = attachedContext,
) {
  if (
    patch.origin != null &&
    !["found", "generated", "own"].includes(patch.origin)
  )
    invalid("Choose found, generated or own");
  if (patch.sourceUrl != null) {
    let valid = false;
    try {
      const url = new URL(patch.sourceUrl);
      valid =
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !/\s/.test(patch.sourceUrl) &&
        [...patch.sourceUrl].length <= 2048;
    } catch {
      /* Report the shared validation message. */
    }
    if (!valid) invalid("Use an http(s) URL without credentials");
  }
  if (patch.derivedFrom != null) {
    if (id === patch.derivedFrom)
      invalid("A reference cannot derive from itself");
    const seen = new Set<string>();
    let next: string | null = patch.derivedFrom;
    for (let depth = 0; next; depth++) {
      if (depth >= 100 || next === id || seen.has(next))
        invalid("This would create a derivation loop");
      seen.add(next);
      const original = context
        .data()
        .items.find(
          (i) =>
            i.id === next &&
            (depth !== 0 || !i.archivedAt) &&
            i.jamId === context.jam(),
        );
      if (!original) invalid("Choose another reference in this project");
      next = original?.derivedFrom ?? null;
    }
  }
}
const fallbackReceipts = new Map<
  string,
  { payload: string; result: CollectKeptResult }
>();
export const mockMoodboardApi: MoodboardApi = {
  async feedback(input) {
    const context = attachedContext;
    await context.call("set_reference_verdict", { input });
    if (context.human().kind !== "human")
      throw new JamError("forbidden", "Only humans set reference verdicts");
    const row = item(input.itemId, context);
    if (row.kind === "note") invalid("Notes cannot be rated");
    if (
      !Object.hasOwn(input, "verdict") &&
      !Object.hasOwn(input, "verdictNote")
    )
      invalid("Send a verdict, a verdictNote or both");
    const patch: Partial<RefItem> = {};
    if (Object.hasOwn(input, "verdict")) patch.verdict = input.verdict ?? null;
    if (Object.hasOwn(input, "verdictNote")) {
      const note = input.verdictNote?.trim() || null;
      if (note && [...note].length > 500) invalid("Use at most 500 characters");
      patch.verdictNote = note;
    }
    if (Object.entries(patch).every(([k, v]) => row[k as keyof RefItem] === v))
      return clone(row);
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    context.changed("reference.updated", context.human(), { itemId: row.id });
    context.save();
    return clone(row);
  },
  async update(id, patch) {
    const context = attachedContext;
    await context.call("update_reference", { input: { itemId: id, ...patch } });
    const row = item(id, context);
    validateMoodboardFields(id, patch, context);
    for (const field of [
      "sourceUrl",
      "origin",
      "derivedFrom",
      "title",
      "tags",
    ] as const)
      if (Object.hasOwn(patch, field))
        Object.assign(row, { [field]: patch[field] });
    if (patch.caption != null) row.captionMd = patch.caption;
    row.updatedAt = new Date().toISOString();
    context.changed("reference.updated", context.human(), { itemId: id });
    context.save();
    return clone(row);
  },
  async send(id) {
    const context = attachedContext;
    await context.call("send_reference_review", { input: { frameId: id } });
    const row = frame(id, context) as StoredFrame;
    if (context.human().kind !== "human")
      throw new JamError("forbidden", "Only humans send a review");
    const summary = (await summarizeMockCanvas(context.data())).frames.find(
      (f) => f.id === id,
    )?.review;
    if (!summary) return invalid("This frame has nothing to review");
    row.reviewHash = await moodboardHash(activeFrameItems(context.data(), id));
    row.review = {
      ...summary,
      sentAt: new Date().toISOString(),
      sentBy: context.human().name,
      changedSinceSent: false,
    };
    context.changed("reference.review_sent", context.human(), {
      frameId: id,
      frameTitle: row.title,
      total: summary.total,
      keep: summary.keep,
      reject: summary.reject,
      unrated: summary.unrated,
      comments: summary.comments,
      itemIds: activeFrameItems(context.data(), id)
        .filter((item) => item.verdict)
        .slice(0, 200)
        .map((item) => item.id),
    });
    context.save();
    return clone(row);
  },
  async collect(input) {
    const context = attachedContext;
    await context.call("collect_kept_references", { input });
    if (!input.requestId?.trim() || [...input.requestId].length > 100)
      invalid("Use 1–100 nonblank characters");
    const receipts = context.receipts?.() ?? fallbackReceipts;
    const key = `${context.jam()}:${context.human().id}:${input.requestId}`,
      payload = JSON.stringify(input),
      receipt = receipts.get(key);
    if (receipt) {
      if (receipt.payload !== payload)
        throw new JamError("idempotency_conflict", "Use a new requestId");
      return clone(receipt.result);
    }
    if (!input.sourceFrameIds.length || input.sourceFrameIds.length > 20)
      invalid("Choose 1 to 20 frames");
    const title = input.title ?? "Moodboard — kept";
    if (!title.trim() || [...title].length > 140)
      invalid("Use 1–140 characters");
    const sources = input.sourceFrameIds
      .map((id) => ({
        frame: frame(id, context),
        items: rowMajor(
          activeFrameItems(context.data(), id).filter(
            (i) => i.verdict === "keep",
          ),
        ),
      }))
      .filter((s) => s.items.length);
    if (!sources.length) invalid("No Keep items in these frames");
    const target = input.linkTo
      ? context.targets().find((t) => t.key === input.linkTo)
      : null;
    if (input.linkTo && !target) invalid("Choose a target in this project");
    const data = context.data(),
      now = new Date().toISOString();
    const result: CollectKeptResult = {
      frame: {
        id: crypto.randomUUID(),
        jamId: context.jam(),
        epicId: null,
        title,
        x:
          Math.max(
            -80,
            ...data.frames
              .filter((f) => !f.archivedAt)
              .map((f) => (f.x ?? 0) + (f.w ?? 800)),
          ) + 80,
        y: 0,
        w: 1080,
        h: 600,
        color: "m4",
        archivedAt: null,
        collapsed: false,
        links: target
          ? [
              {
                targetKey: target.key,
                kind: target.kind as "epic" | "story" | "task",
                title: target.key,
              },
            ]
          : [],
        review: null,
      },
      sections: [],
      itemIds: [],
    };
    let cursor = 24,
      bottom = 0;
    for (const source of sources) {
      const base = source.items[0]!;
      data.items.push({
        ...clone(base),
        id: crypto.randomUUID(),
        kind: "note",
        title: source.frame.title,
        captionMd: "",
        assetId: null,
        url: null,
        frameId: result.frame.id,
        x: 24,
        y: cursor,
        w: 1032,
        h: 48,
        verdict: null,
        verdictNote: null,
        sourceUrl: null,
        origin: null,
        derivedFrom: null,
        copiedFrom: null,
        createdAt: now,
        updatedAt: now,
      });
      cursor += 72;
      result.sections.push({
        sourceFrameId: source.frame.id,
        title: source.frame.title,
        count: source.items.length,
      });
      source.items.forEach((original, index) => {
        const row = {
          ...clone(original),
          id: crypto.randomUUID(),
          frameId: result.frame.id,
          x: 24 + (index % 4) * 264,
          y: cursor + Math.floor(index / 4) * 230,
          w: 240,
          h: 180,
          verdict: null,
          verdictNote: null,
          copiedFrom: original.id,
          createdBy: context.human().id,
          updatedBy: context.human().id,
          createdAt: now,
          updatedAt: now,
        };
        bottom = row.y + 180;
        data.items.push(row);
        result.itemIds.push(row.id);
        context.changed("reference.added", context.human(), { itemId: row.id });
      });
      cursor = bottom + 32;
    }
    result.frame.h = bottom + 24;
    data.frames.push(result.frame);
    result.frame = (await summarizeMockCanvas(data)).frames.find(
      (f) => f.id === result.frame.id,
    )!;
    receipts.set(key, { payload, result: clone(result) });
    context.save();
    return clone(result);
  },
};
