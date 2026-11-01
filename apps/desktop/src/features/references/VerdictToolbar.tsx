import { useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReferenceCanvas, RefItem } from "../../bindings";
import { Tooltip } from "../../components/ui";
import { api, type ReferenceVerdict, type VerdictItem } from "../../lib/api";
import { moodboardApi } from "../../lib/moodboard-api";
import { useUiStore } from "../../lib/ui-store";
import { CanvasContext } from "./runtime";

export function VerdictToolbar({ item }: { item: RefItem }) {
  const client = useQueryClient();
  const runtime = useContext(CanvasContext);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [localReason, setLocalReason] = useState(false),
    [draft, setDraft] = useState("");
  const reasonOpen = localReason || runtime?.reasonItemId === item.id;
  useEffect(() => {
    if (reasonOpen) setDraft(item.verdictNote ?? "");
  }, [reasonOpen, item.verdictNote]);
  const reasonButton = useRef<HTMLButtonElement>(null);
  const reasonPopover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!reasonOpen) return;
    let animation = 0;
    const position = () => {
      const anchor = reasonButton.current?.getBoundingClientRect(),
        popover = reasonPopover.current;
      if (anchor && popover) {
        const pane = reasonButton.current
          ?.closest(".references-page")
          ?.getBoundingClientRect();
        const left = pane?.left ?? 0,
          right = pane?.right ?? innerWidth,
          top = pane?.top ?? 0,
          bottom = pane?.bottom ?? innerHeight;
        const width = Math.min(280, right - left - 16);
        popover.style.width = `${width}px`;
        popover.style.left = `${Math.max(left + 8, Math.min(anchor.right - width, right - width - 8))}px`;
        popover.style.top = `${Math.max(top + 8, Math.min(anchor.bottom + 8, bottom - popover.offsetHeight - 8))}px`;
      }
      animation = requestAnimationFrame(position);
    };
    position();
    return () => cancelAnimationFrame(animation);
  }, [reasonOpen]);
  const closeReason = () => {
    setLocalReason(false);
    runtime?.reason?.(null);
    reasonButton.current?.focus();
  };
  const openReason = () => {
    setDraft(item.verdictNote ?? "");
    if (runtime?.reason) runtime.reason(item);
    else setLocalReason(true);
  };
  const saveReason = async () => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    const input = { itemId: item.id, verdictNote: draft.trim() || null };
    try {
      if (runtime?.feedback) await runtime.feedback(input);
      else {
        await moodboardApi.feedback(input);
        await client.invalidateQueries({ queryKey: ["references"] });
      }
      closeReason();
    } catch (reason) {
      useUiStore.getState().error(String(reason));
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  const current = (item as VerdictItem).verdict ?? null;
  const choose = async (value: ReferenceVerdict) => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    if (runtime?.verdict) {
      try {
        await runtime.verdict(item, current === value ? null : value);
      } catch (reason) {
        useUiStore.getState().error(String(reason));
      } finally {
        locked.current = false;
        setPending(false);
      }
      return;
    }
    await client.cancelQueries({ queryKey: ["references"] });
    if (
      client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
        ?.jam?.id !== item.jamId
    ) {
      locked.current = false;
      setPending(false);
      return;
    }
    const verdict = current === value ? null : value;
    const update = (next: ReferenceVerdict) =>
      client.setQueryData<ReferenceCanvas>(
        ["references"],
        (data) =>
          data && {
            ...data,
            items: data.items.map((row) =>
              row.id === item.id && row.jamId === item.jamId
                ? { ...row, verdict: next }
                : row,
            ),
          },
      );
    update(verdict);
    try {
      await api.setReferenceVerdict(item.id, verdict);
    } catch (reason) {
      update(current);
      useUiStore.getState().error(String(reason));
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  if (item.kind === "note") return null;
  return (
    <fieldset
      className="reference-verdict-toolbar nodrag nopan"
      aria-label="Reference feedback"
    >
      {(
        [
          ["keep", "Keep", ThumbsUp],
          ["reject", "Not this", ThumbsDown],
        ] as const
      ).map(([value, label, Icon]) => (
        <Tooltip key={value} text={pending ? "Saving feedback…" : label}>
          <button
            type="button"
            aria-label={label}
            aria-pressed={current === value}
            disabled={pending}
            onClick={() => void choose(value)}
          >
            <span className="reference-verdict-face">
              <Icon size={16} />
            </span>
          </button>
        </Tooltip>
      ))}
      <Tooltip text={item.verdictNote ? "Edit reason" : "Add a reason"}>
        <button
          ref={reasonButton}
          type="button"
          aria-label={item.verdictNote ? "Edit reason" : "Add a reason"}
          aria-pressed={!!item.verdictNote}
          onClick={openReason}
        >
          <MessageSquareText size={16} />
        </button>
      </Tooltip>
      {reasonOpen &&
        createPortal(
          <div
            ref={reasonPopover}
            className="reference-reason-popover nodrag nopan"
            role="dialog"
            aria-label="Reference reason"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeReason();
              }
            }}
          >
            <textarea
              key={item.id}
              ref={(element) => {
                if (element && document.activeElement?.tagName !== "TEXTAREA")
                  element.focus();
              }}
              rows={3}
              maxLength={500}
              value={draft}
              placeholder="Why keep or reject this?"
              aria-label="Why keep or reject this?"
              disabled={pending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeReason();
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void saveReason();
                }
              }}
            />
            {draft.length >= 400 && <small>{draft.length}/500</small>}
            <div>
              <button
                type="button"
                disabled={pending}
                onClick={() => void saveReason()}
              >
                Save
              </button>
              <button type="button" disabled={pending} onClick={closeReason}>
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </fieldset>
  );
}
export function ReasonChip({ item }: { item: RefItem }) {
  return item.verdictNote ? (
    <div className="reference-reason-chip" title={item.verdictNote}>
      <MessageSquareText size={13} />
      <span>{item.verdictNote}</span>
    </div>
  ) : null;
}
export function VerdictBadge({ item }: { item: RefItem }) {
  const verdict = (item as VerdictItem).verdict;
  return verdict ? (
    <small
      className="reference-verdict-badge"
      role="img"
      aria-label={verdict === "keep" ? "Keep" : "Not this"}
      title={verdict === "keep" ? "Keep" : "Not this"}
    >
      {verdict === "keep" ? <Check size={14} aria-hidden="true" /> : "Not this"}
    </small>
  ) : null;
}
