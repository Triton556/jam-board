import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefItem } from "../../bindings";
import { api } from "../../lib/api";

type Text = { title: string; body: string };
type Phase =
  | "local"
  | "saved"
  | "saving"
  | "conflict"
  | "unconfirmed"
  | "not-sent";
const text = (item: RefItem): Text => ({
  title: item.title,
  body: item.captionMd,
});
const meaningfulTitle = (value: string) => (value.trim() ? value : "");
const same = (a: Text, b: Text) =>
  meaningfulTitle(a.title) === meaningfulTitle(b.title) && a.body === b.body;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** One paper / one scoped serial stream. The server compares content atomically;
 * transport failure is NOT evidence of rollback and never triggers replay. */
export function useStickyNote({
  projectId,
  item,
  position,
  confirmed,
  editing,
  unavailable = false,
}: {
  projectId: string;
  editing: boolean;
  unavailable?: boolean;
  item?: RefItem;
  position?: { x: number; y: number };
  confirmed(item: RefItem, previous?: RefItem): void;
}) {
  const client = useQueryClient();
  const initial = useRef({ projectId, id: item?.id });
  const baseline = useRef(item);
  const draft = useRef<Text>(item ? text(item) : { title: "", body: "" });
  const [value, setValue] = useState(draft.current);
  const [phase, setPhase] = useState<Phase>(item ? "saved" : "local");
  const [detail, setDetail] = useState("");
  const [reading, setReading] = useState(false);
  const [latest, setLatest] = useState<RefItem | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true),
    valid = useRef(true),
    invalidated = useRef(false),
    stopped = useRef(false);
  const flight = useRef<Promise<boolean> | null>(null);
  const sent = useRef<Text | null>(null);
  const readFlight = useRef(false);
  const dispatched = useRef(false);
  const abandoned = useRef(false);
  const entityId = useRef(item?.id);
  entityId.current = item?.id;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const callback = useRef(confirmed);
  callback.current = confirmed;
  const dirty = !baseline.current
    ? !!value.body.trim() || !!value.title.trim()
    : !same(value, text(baseline.current));
  const owned = useCallback(
    () =>
      mounted.current &&
      valid.current &&
      initial.current.projectId === projectId &&
      (initial.current.id
        ? entityId.current === initial.current.id
        : !entityId.current || entityId.current === baseline.current?.id) &&
      client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
        ?.jam?.id === projectId,
    [client, projectId],
  );
  const isDirty = useCallback(
    () =>
      !baseline.current
        ? !!draft.current.body.trim() || !!draft.current.title.trim()
        : !same(draft.current, text(baseline.current)),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    valid.current = !invalidated.current;
    const check = () => {
      if (
        client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
          ?.jam?.id !== initial.current.projectId
      ) {
        valid.current = false;
        invalidated.current = true;
        stopped.current = true;
        if (mounted.current) {
          setPhase(
            flight.current && dispatched.current ? "unconfirmed" : "not-sent",
          );
          setDetail(
            flight.current && dispatched.current
              ? "The project changed after the save was sent. Check the original project; this view will not apply its late result."
              : "The project changed. More edits will not be sent; keep a copy of any unsaved text.",
          );
        }
      }
    };
    check();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      mounted.current = false;
      valid.current = false;
      unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (item && baseline.current && item.id !== baseline.current.id) {
      valid.current = false;
      invalidated.current = true;
      stopped.current = true;
      setPhase(dispatched.current ? "unconfirmed" : "not-sent");
      setDetail(
        "The note changed. This editor will not apply its result or send more text to a different note.",
      );
    }
  }, [item]);

  useEffect(() => {
    if (!unavailable) return;
    stopped.current = true;
    setPhase("conflict");
    setDetail(
      "This note is missing from the latest board. Your text is retained. Check latest or keep a copy before discarding your local edits; no note will be recreated.",
    );
  }, [unavailable]);

  // Geometry/tag updates do not affect the editor. A remote text change does.
  useEffect(() => {
    if (
      !item ||
      !baseline.current ||
      item.id !== baseline.current.id ||
      !owned()
    )
      return;
    const remote = text(item);
    if (
      same(remote, text(baseline.current)) ||
      (sent.current && same(remote, sent.current))
    )
      return;
    if (editingRef.current || isDirty() || flight.current) {
      stopped.current = true;
      setLatest(item);
      setPhase("conflict");
      setDetail(
        "This note changed elsewhere. Your text is retained; inspect the latest note before saving it.",
      );
    } else {
      baseline.current = item;
      draft.current = remote;
      setValue(remote);
    }
  }, [item, owned, isDirty]);

  const change = (patch: Partial<Text>) => {
    abandoned.current = false;
    draft.current = { ...draft.current, ...patch };
    setValue(draft.current);
  };
  const flush = useCallback(async (): Promise<boolean> => {
    if (flight.current) return flight.current;
    if (stopped.current || !owned()) return false;
    if (!isDirty()) return true;
    const previous = baseline.current;
    const submitted = { ...draft.current };
    const storedTitle = submitted.title.trim() ? submitted.title : "";
    if (storedTitle.length > 140) {
      setDetail(
        "Keep the optional heading to 140 characters. Your text is still here.",
      );
      return false;
    }
    setDetail("");
    setPending(true);
    setPhase("saving");
    sent.current = submitted;
    // This check immediately precedes the side effect: no preparation await.
    const operation = previous
      ? () =>
          api.updateReference(
            previous.id,
            { title: storedTitle, caption: submitted.body },
            { title: previous.title, caption: previous.captionMd },
          )
      : () => {
          const input = {
            kind: "note",
            text: submitted.body,
            ...(storedTitle ? { title: storedTitle } : {}),
            x: position?.x ?? 0,
            y: position?.y ?? 0,
          };
          return storedTitle
            ? api.addReference(input)
            : api.addReference(input, true);
        };
    const promise = Promise.resolve().then(async () => {
      try {
        if (!owned()) return false;
        dispatched.current = true;
        const saved = await operation();
        if (!owned()) return false;
        baseline.current = saved;
        // Do not replace newer typing with the submitted/server value.
        // The server preserves explicit empty titles. Never replace newer typing
        // or infer intent from a default-looking title.
        try {
          callback.current(saved, previous);
        } catch (error) {
          setDetail(`Saved. The board could not refresh: ${message(error)}`);
        }
        if (!stopped.current) setPhase("saved");
        return !stopped.current && !isDirty();
      } catch (error) {
        if (!owned()) return false;
        stopped.current = true;
        const conflict = (error as { code?: string })?.code === "conflict";
        setPhase(conflict ? "conflict" : "unconfirmed");
        setDetail(
          conflict
            ? "This note changed before this edit could be saved. Your text is retained."
            : `The save outcome is unconfirmed. No automatic retry. Your text is retained. ${message(error)}`,
        );
        return false;
      } finally {
        dispatched.current = false;
        flight.current = null;
        sent.current = null;
        if (mounted.current) setPending(false);
      }
    });
    flight.current = promise;
    return promise;
  }, [owned, isDirty, position]);
  useEffect(() => {
    if (!dirty || pending || stopped.current || !valid.current) return;
    const scheduled = value;
    const timer = window.setTimeout(() => {
      if (same(scheduled, draft.current)) void flush();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [value, dirty, pending, flush]);

  useBlocker({
    shouldBlockFn: async () => {
      if (abandoned.current) return false;
      if (flight.current) await flight.current;
      if (!owned()) return true;
      if (!isDirty() && !stopped.current) return false;
      // A normal route departure intentionally flushes. Failure retains the
      // mounted paper, instead of quietly abandoning an uncertain write.
      return !(await flush());
    },
    enableBeforeUnload:
      !abandoned.current && (dirty || pending || phase === "unconfirmed"),
  });
  const checkLatest = async () => {
    if (readFlight.current || flight.current || !owned()) return;
    readFlight.current = true;
    setReading(true);
    try {
      const canvas = await api.referenceCanvas();
      if (!owned()) return;
      const found =
        baseline.current &&
        canvas.items.find((candidate) => candidate.id === baseline.current?.id);
      if (!found) {
        setDetail(
          baseline.current
            ? "The latest board no longer contains this note. Your text is retained; nothing was resent."
            : "Board checked. Inspect its notes before discarding this local paper. The original create may have succeeded; it will not be retried.",
        );
        return;
      }
      setLatest(found);
      if (same(draft.current, text(found))) {
        baseline.current = found;
        stopped.current = false;
        abandoned.current = false;
        setPhase("saved");
        setDetail("Latest read confirms this text is saved.");
      } else
        setDetail(
          "Latest note loaded below. Nothing was resent. Review it before choosing which text to keep.",
        );
    } catch (error) {
      if (owned())
        setDetail(
          `Could not check the latest note. Your text is retained. ${message(error)}`,
        );
    } finally {
      readFlight.current = false;
      if (owned()) setReading(false);
    }
  };
  const keepMine = async () => {
    if (!latest || pending || !owned()) return false;
    baseline.current = latest;
    abandoned.current = false;
    stopped.current = false;
    setLatest(null);
    return flush();
  };
  const useLatest = () => {
    if (
      !latest ||
      pending ||
      !owned() ||
      !window.confirm("Replace your unsaved text with the latest saved note?")
    )
      return;
    baseline.current = latest;
    abandoned.current = false;
    draft.current = text(latest);
    setValue(draft.current);
    setLatest(null);
    stopped.current = false;
    setDetail("");
    setPhase("saved");
  };
  const abandon = () => {
    if (
      flight.current ||
      readFlight.current ||
      !baseline.current ||
      !window.confirm(
        "Discard only your local edits? Keep a copy first. This does not undo any save, delete the note or retry a failed request.",
      )
    )
      return false;
    abandoned.current = true;
    draft.current = text(baseline.current);
    setValue(draft.current);
    setDetail(
      "Local edits discarded. Check latest before editing again; this does not undo any save.",
    );
    return true;
  };
  const current = useCallback(() => baseline.current, []);
  const isSaving = useCallback(() => !!flight.current, []);
  return {
    value,
    change,
    phase,
    detail,
    pending,
    dirty,
    flush,
    checkLatest,
    reading,
    latest,
    keepMine,
    abandon,
    useLatest,
    current,
    owns: owned,
    isSaving,
    canEdit: valid.current,
    blocked: stopped.current,
  };
}
