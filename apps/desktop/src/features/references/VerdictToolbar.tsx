import { useQueryClient } from "@tanstack/react-query";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useContext, useRef, useState } from "react";
import type { ReferenceCanvas, RefItem } from "../../bindings";
import { Tooltip } from "../../components/ui";
import { api, type ReferenceVerdict, type VerdictItem } from "../../lib/api";
import { useUiStore } from "../../lib/ui-store";
import { CanvasContext } from "./runtime";

export function VerdictToolbar({ item }: { item: RefItem }) {
  const client = useQueryClient();
  const runtime = useContext(CanvasContext);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
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
    </fieldset>
  );
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
