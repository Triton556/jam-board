import { useQueryClient } from "@tanstack/react-query";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ReferenceCanvas,
  ReferenceVerdictInput,
  RefFrame,
  RefItem,
} from "../../bindings";
import { api } from "../../lib/api";
import { rowMajor } from "../../lib/mock-moodboard";
import { moodboardApi } from "../../lib/moodboard-api";
import type { FrameNode, ItemNode } from "./Nodes";

type CanvasNode = FrameNode | ItemNode;
export type ReviewFilter = "all" | "unrated" | "keep" | "reject";
export const reviewMatches = (item: RefItem, filter: ReviewFilter) =>
  filter === "all" ||
  (filter === "unrated" ? !item.verdict : item.verdict === filter);
export function useMoodboard(
  data: ReferenceCanvas | undefined,
  flow: ReactFlowInstance<CanvasNode>,
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>,
  refresh: () => Promise<unknown>,
  error: (reason: unknown) => void,
  announce: (message: string) => void,
  lightbox: (value: { url: string; title: string }) => void,
) {
  const client = useQueryClient();
  const [reviewId, setReviewId] = useState<string | null>(null),
    [filter, setFilter] = useState<ReviewFilter>("all"),
    [currentId, setCurrentId] = useState<string | null>(null),
    [reasonId, setReasonId] = useState<string | null>(null),
    [variationId, setVariationId] = useState<string | null>(null),
    [collectFrames, setCollectFrames] = useState<RefFrame[] | null>(null),
    [pending, setPending] = useState(false);
  const oldViewport = useRef<Viewport | null>(null),
    locks = useRef(new Set<string>());
  const queuedRatings = useRef<("keep" | "reject")[]>([]),
    ratingBusy = useRef(false);
  const [, setRatingTick] = useState(0);
  const projectId = data?.items[0]?.jamId ?? data?.frames[0]?.jamId;
  const project = useRef(projectId);
  const frame = data?.frames.find((f) => f.id === reviewId && !f.archivedAt);
  const items = rowMajor(
      data?.items.filter(
        (i) => i.frameId === reviewId && !i.archivedAt && i.kind !== "note",
      ) ?? [],
    ),
    matching = items.filter((i) => reviewMatches(i, filter)),
    current = items.find((i) => i.id === currentId);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const exit = useCallback(() => {
    queuedRatings.current = [];
    setReviewId(null);
    setCurrentId(null);
    setReasonId(null);
    if (oldViewport.current)
      void flow.setViewport(oldViewport.current, {
        duration: reduced ? 0 : 180,
      });
    oldViewport.current = null;
  }, [flow, reduced]);
  const start = useCallback(
    (frame: RefFrame) => {
      const rows = rowMajor(
        data?.items.filter(
          (i) => i.frameId === frame.id && !i.archivedAt && i.kind !== "note",
        ) ?? [],
      );
      if (!rows.length) return;
      oldViewport.current ??= flow.getViewport();
      const initial = rows.some((i) => !i.verdict) ? "unrated" : "all";
      setFilter(initial);
      setCurrentId(rows.find((i) => reviewMatches(i, initial))?.id ?? null);
      setReviewId(frame.id);
    },
    [data, flow],
  );
  useEffect(() => {
    if (!reviewId || !currentId) return;
    setNodes((nodes) =>
      nodes.map((n) => ({ ...n, selected: n.id === currentId })),
    );
    void flow.fitView({
      nodes: [{ id: currentId }],
      maxZoom: 1.5,
      duration: reduced ? 0 : 180,
    });
  }, [reviewId, currentId, flow, setNodes, reduced]);
  useEffect(() => {
    if (reviewId && !frame) exit();
  }, [frame, reviewId, exit]);
  useEffect(() => {
    if (project.current === projectId) return;
    project.current = projectId;
    setReviewId(null);
    setReasonId(null);
    setVariationId(null);
    setCollectFrames(null);
    oldViewport.current = null;
  }, [projectId]);
  const feedback = useCallback(
    async (input: ReferenceVerdictInput) => {
      const before = data?.items.find((i) => i.id === input.itemId);
      if (!before || locks.current.has(before.id)) return;
      locks.current.add(before.id);
      setPending(true);
      await client.cancelQueries({ queryKey: ["references"] });
      const patch = {
        ...(Object.hasOwn(input, "verdict")
          ? { verdict: input.verdict ?? null }
          : {}),
        ...(Object.hasOwn(input, "verdictNote")
          ? { verdictNote: input.verdictNote?.trim() || null }
          : {}),
      };
      const apply = (value: Partial<RefItem>) =>
        client.setQueryData<ReferenceCanvas>(
          ["references"],
          (cache) =>
            cache && {
              ...cache,
              items: cache.items.map((i) =>
                i.id === before.id && i.jamId === before.jamId
                  ? { ...i, ...value }
                  : i,
              ),
            },
        );
      apply(patch);
      try {
        const saved = await moodboardApi.feedback(input);
        apply(saved);
        await refresh();
      } catch (reason) {
        apply({ verdict: before.verdict, verdictNote: before.verdictNote });
        throw reason;
      } finally {
        locks.current.delete(before.id);
        setPending(false);
      }
    },
    [client, data, refresh],
  );
  const move = (direction: number) => {
    const index = matching.findIndex((i) => i.id === currentId);
    setCurrentId(
      matching[(index + direction + matching.length) % matching.length]?.id ??
        null,
    );
  };
  const choose = async (verdict: "keep" | "reject") => {
    if (!current || ratingBusy.current) return;
    ratingBusy.current = true;
    const nextVerdict = current.verdict === verdict ? null : verdict;
    const index = matching.findIndex((i) => i.id === current.id),
      next = nextVerdict
        ? filter === "unrated"
          ? matching[(index + 1) % matching.length]?.id === current.id
            ? null
            : matching[(index + 1) % matching.length]?.id
          : matching[(index + 1) % matching.length]?.id
        : current.id;
    try {
      await feedback({ itemId: current.id, verdict: nextVerdict });
      if (nextVerdict) setCurrentId(next ?? null);
    } catch (reason) {
      queuedRatings.current = [];
      error(reason);
    } finally {
      ratingBusy.current = false;
      setRatingTick((value) => value + 1);
    }
  };
  // Preserve fast keyboard intent while a prior rating commits; never replay a failed write.
  useEffect(() => {
    if (reviewId && current && !pending && !ratingBusy.current) {
      const next = queuedRatings.current.shift();
      if (next) void choose(next);
    }
  });
  const send = async (selected: RefFrame) => {
    if (pending) return;
    setPending(true);
    try {
      const sent = await moodboardApi.send(selected.id);
      const review = sent.review;
      const rated = (review?.keep ?? 0) + (review?.reject ?? 0);
      const reasons = review?.comments ?? 0;
      announce(
        `Review sent. The brain will see ${rated} rated ${rated === 1 ? "item" : "items"} and ${reasons} ${reasons === 1 ? "reason" : "reasons"}.`,
      );
      await refresh();
      exit();
    } catch (reason) {
      error(reason);
    } finally {
      setPending(false);
    }
  };
  const key = (event: React.KeyboardEvent) => {
    if (variationId && event.key === "Escape") {
      setVariationId(null);
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (!reviewId || event.ctrlKey || event.metaKey || event.altKey)
      return false;
    const key = event.key.toLowerCase();
    if (
      ![
        "arrowright",
        "arrowdown",
        "j",
        "arrowleft",
        "arrowup",
        "k",
        "1",
        "2",
        "c",
        "escape",
        "enter",
      ].includes(key)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    if (key === "escape") {
      if (reasonId) setReasonId(null);
      else exit();
    } else if (key === "c" && current) setReasonId(current.id);
    else if (key === "1" || key === "2") {
      const verdict = key === "1" ? "keep" : "reject";
      if (pending || ratingBusy.current) queuedRatings.current.push(verdict);
      else void choose(verdict);
    } else if (key === "enter" && current)
      void api
        .referenceMedia(current.id)
        .then((url) => {
          if (url) lightbox({ url, title: current.title });
        })
        .catch(error);
    else move(["arrowright", "arrowdown", "j"].includes(key) ? 1 : -1);
    return true;
  };
  const clicked = (id: string) => {
    if (variationId) {
      void moodboardApi
        .update(variationId, { derivedFrom: id })
        .then(refresh)
        .then(() => setVariationId(null))
        .catch(error);
      return;
    }
    if (items.some((i) => i.id === id)) setCurrentId(id);
  };
  const dim = useCallback(
    (item: RefItem) =>
      !!reviewId && (item.frameId !== reviewId || !reviewMatches(item, filter)),
    [reviewId, filter],
  );
  return {
    reviewId,
    frame,
    items,
    matching,
    current,
    filter,
    setFilter: (value: ReviewFilter) => {
      setFilter(value);
      setCurrentId(items.find((i) => reviewMatches(i, value))?.id ?? null);
    },
    start,
    exit,
    key,
    clicked,
    move,
    send,
    pending,
    reasonId,
    setReasonId,
    feedback,
    variationId,
    setVariationId,
    collectFrames,
    setCollectFrames,
    dim,
  };
}
