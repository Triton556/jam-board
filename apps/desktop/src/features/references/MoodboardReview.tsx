import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import type { RefFrame } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { moodboardApi } from "../../lib/moodboard-api";
import type { ReviewFilter, useMoodboard } from "./use-moodboard";
export function ReviewBar({
  review,
}: {
  review: ReturnType<typeof useMoodboard>;
}) {
  const frame = review.frame;
  if (!frame) return null;
  const keep = review.items.filter((i) => i.verdict === "keep").length,
    reject = review.items.filter((i) => i.verdict === "reject").length,
    unrated = review.items.length - keep - reject;
  return (
    <div
      className="moodboard-review-bar nodrag nopan"
      role="toolbar"
      aria-label="Moodboard review"
    >
      <strong>
        {frame.title} · {keep + reject} of {review.items.length} rated
      </strong>
      <fieldset aria-label="Review filter">
        {(
          [
            ["all", `All ${review.items.length}`],
            ["unrated", `Unrated ${unrated}`],
            ["keep", `Keep ${keep}`],
            ["reject", `Not this ${reject}`],
          ] as [ReviewFilter, string][]
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={review.filter === value}
            onClick={() => review.setFilter(value)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <button
        type="button"
        className="moodboard-review-nav"
        aria-label="Previous item"
        onClick={() => review.move(-1)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="moodboard-review-nav"
        aria-label="Next item"
        onClick={() => review.move(1)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {!review.matching.length ? (
        <strong>All rated</strong>
      ) : (
        <small className="moodboard-review-hint">
          1 Keep · 2 Not this · C Reason · Esc Exit
        </small>
      )}
      <Button
        variant="primary"
        disabled={review.pending}
        onClick={() => void review.send(frame)}
      >
        {frame.review?.changedSinceSent ? "Send again" : "Done, send to brain"}
      </Button>
      <Button variant="ghost" onClick={review.exit}>
        Exit
      </Button>
    </div>
  );
}
export function CollectKeepDialog({
  frames,
  targets,
  close,
  saved,
}: {
  frames: RefFrame[];
  targets: { key: string; title: string; kind: string }[];
  close(): void;
  saved(frame: RefFrame): Promise<void>;
}) {
  const [order, setOrder] = useState(frames),
    [title, setTitle] = useState("Moodboard — kept"),
    [link, setLink] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID()),
    drag = useRef<number | null>(null);
  const count = order.reduce((n, f) => n + (f.review?.keep ?? 0), 0);
  function reorder(from: number, to: number) {
    setOrder((rows) => {
      const next = [...rows];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
    requestId.current = crypto.randomUUID();
  }
  return (
    <Dialog
      title="Collect Keep into new frame"
      busy={pending}
      onClose={() => {
        if (!pending) close();
      }}
    >
      <form
        className="m5-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          try {
            const result = await moodboardApi.collect({
              requestId: requestId.current,
              sourceFrameIds: order.map((f) => f.id),
              title,
              linkTo: link || null,
            });
            await saved(result.frame);
            close();
          } catch (reason) {
            setError(String(reason));
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="field">
          Title
          <input
            value={title}
            maxLength={140}
            disabled={pending}
            onChange={(e) => {
              setTitle(e.target.value);
              requestId.current = crypto.randomUUID();
            }}
          />
        </label>
        <ol className="moodboard-collect-order">
          {order.map((f, i) => (
            <li
              key={f.id}
              draggable={!pending}
              onDragStart={() => {
                drag.current = i;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (drag.current != null) reorder(drag.current, i);
              }}
            >
              <span>
                {f.title} · {f.review?.keep ?? 0} Keep
              </span>
              <button
                type="button"
                aria-label={`Move ${f.title} up`}
                disabled={pending || i === 0}
                onClick={() => reorder(i, i - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${f.title} down`}
                disabled={pending || i === order.length - 1}
                onClick={() => reorder(i, i + 1)}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        <CustomSelect
          searchable
          label="Link to…"
          value={link}
          onChange={(value) => {
            setLink(value);
            requestId.current = crypto.randomUUID();
          }}
          options={[
            { value: "", label: "No link" },
            ...targets.map((t) => ({
              value: t.key,
              label: `${t.key} · ${t.title}`,
              group: t.kind,
            })),
          ]}
        />
        {error && <p role="alert">{error}</p>}
        {count === 0 && <p>No Keep items yet</p>}
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !count || !title.trim()}
        >
          Create
        </Button>
      </form>
    </Dialog>
  );
}
