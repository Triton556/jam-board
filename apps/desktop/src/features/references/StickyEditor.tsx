import { Check, Plus, X } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefItem } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { referenceLabel } from "./model";
import { useStickyNote } from "./use-sticky-note";

export function StickyEditor({
  item,
  projectId,
  position,
  confirmed,
  finished,
  local = false,
  busyRef,
  beginRef,
  editingChanged,
  unavailable = false,
}: {
  item?: RefItem;
  projectId: string;
  position?: { x: number; y: number };
  confirmed(item: RefItem, previous?: RefItem): void;
  finished?(item?: RefItem, restoreFocus?: boolean): void;
  local?: boolean;
  busyRef?: RefObject<(() => boolean) | null>;
  beginRef?: RefObject<(() => void) | null>;
  editingChanged?(active: boolean): void;
  unavailable?: boolean;
}) {
  const [editing, setEditing] = useState(local);
  const note = useStickyNote({
    item,
    projectId,
    position,
    confirmed,
    editing,
    unavailable,
  });
  if (busyRef) busyRef.current = note.isSaving;
  useLayoutEffect(() => {
    editingChanged?.(editing);
    return () => editingChanged?.(false);
  }, [editing, editingChanged]);
  const [heading, setHeading] = useState(!!item?.title);
  const root = useRef<HTMLFieldSetElement>(null),
    body = useRef<HTMLTextAreaElement>(null),
    title = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const ending = useRef(false),
    endRequested = useRef(false),
    restoreRequested = useRef(false),
    finishEpoch = useRef(0);
  useEffect(() => {
    if (editing) body.current?.focus({ preventScroll: true });
  }, [editing]);
  const finish = useCallback(
    async (restoreFocus = false) => {
      endRequested.current = true;
      restoreRequested.current ||= restoreFocus;
      if (ending.current) return;
      ending.current = true;
      const epoch = finishEpoch.current;
      const clean = await note.flush();
      ending.current = false;
      if (
        !clean ||
        !note.owns() ||
        !endRequested.current ||
        finishEpoch.current !== epoch
      )
        return;
      endRequested.current = false;
      const restore =
        restoreRequested.current &&
        !!root.current?.contains(document.activeElement) &&
        !document.querySelector('[role="dialog"]');
      restoreRequested.current = false;
      if (local) finished?.(note.current(), restore);
      else {
        setEditing(false);
        if (restore)
          requestAnimationFrame(() => {
            if (
              note.owns() &&
              opener.current?.isConnected &&
              document.activeElement === document.body &&
              !document.querySelector('[role="dialog"]')
            )
              opener.current.focus({ preventScroll: true });
          });
      }
    },
    [note.flush, note.owns, note.current, finished, local],
  );
  useEffect(() => {
    if (endRequested.current && !note.pending && !note.dirty && !note.blocked)
      void finish();
  }, [note.pending, note.dirty, note.blocked, finish]);
  const resume = () => {
    finishEpoch.current += 1;
    endRequested.current = false;
    restoreRequested.current = false;
  };
  const start = () => {
    resume();
    setHeading(note.value.title.length > 0);
    setEditing(true);
  };
  if (beginRef) beginRef.current = start;
  if (!editing)
    return (
      <div className="reference-note-text reference-caption nodrag nopan">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Optional pointer shortcut; the adjacent native Edit button provides keyboard activation without nesting Markdown links. */}
        <div
          onDoubleClick={(event) => {
            if (!(event.target as HTMLElement).closest("a, button")) start();
          }}
        >
          {note.value.title && (
            <strong className="sticky-note-title">{note.value.title}</strong>
          )}
          {note.value.body ? (
            <Markdown>{note.value.body}</Markdown>
          ) : (
            <span className="muted">Write a note…</span>
          )}
        </div>
        <button
          type="button"
          ref={opener}
          className="ghost small sticky-edit-button"
          aria-label={`Edit note ${referenceLabel({ kind: "note", title: note.value.title, captionMd: note.value.body })}`}
          onClick={start}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ")
              event.stopPropagation();
          }}
        >
          Edit note
        </button>
      </div>
    );
  const status = note.pending
    ? "Saving…"
    : note.phase === "unconfirmed"
      ? "Save unconfirmed · text retained"
      : note.phase === "conflict"
        ? "Changed elsewhere · text retained"
        : note.phase === "not-sent"
          ? "Not sent · text retained"
          : note.dirty
            ? "Unsaved text"
            : note.current()
              ? "Saved"
              : "Empty paper · not saved";
  return (
    <fieldset
      ref={root}
      aria-label="Note editor"
      className="sticky-editor nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onBlurCapture={(event) => {
        // Internal buttons/heading are part of the same editing session.
        if (
          event.relatedTarget &&
          root.current?.contains(event.relatedTarget as Node)
        )
          return;
        void finish();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          void finish(true);
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void note.flush();
        }
      }}
    >
      <div className="sticky-editor-tools">
        {!heading ? (
          <button
            type="button"
            className="sticky-add-heading"
            onClick={() => {
              setHeading(true);
              requestAnimationFrame(() => title.current?.focus());
            }}
          >
            <Plus size={13} aria-hidden="true" /> Add heading
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="sticky-finish"
          aria-label={
            note.current() || note.value.body || note.value.title
              ? "Finish editing note"
              : "Remove empty paper"
          }
          onClick={() => void finish(true)}
          disabled={note.pending}
        >
          {note.current() || note.value.body || note.value.title ? (
            <Check size={15} />
          ) : (
            <X size={15} />
          )}
        </button>
      </div>
      {heading && (
        <input
          ref={title}
          onFocus={resume}
          className="sticky-heading-input"
          aria-label="Optional note heading"
          placeholder="Heading (optional)"
          maxLength={140}
          value={note.value.title}
          onChange={(event) => note.change({ title: event.target.value })}
          readOnly={!note.canEdit || unavailable}
        />
      )}
      <textarea
        ref={body}
        onFocus={resume}
        className="sticky-body-input"
        aria-label="Note text"
        placeholder="Write a note…"
        value={note.value.body}
        onChange={(event) => note.change({ body: event.target.value })}
        readOnly={!note.canEdit || unavailable}
      />
      <div className="sticky-save-state" role="status" aria-live="polite">
        {status}
      </div>
      {note.detail && (
        <p
          className="sticky-save-detail"
          role={note.blocked ? "alert" : undefined}
        >
          {note.detail}
        </p>
      )}
      {note.blocked && note.canEdit && (
        <div className="sticky-recovery">
          <button
            type="button"
            className="button ghost"
            disabled={note.reading || note.pending}
            onClick={() => void note.checkLatest()}
          >
            {note.reading ? "Checking…" : "Check latest"}
          </button>
          {note.latest && (
            <>
              <div className="sticky-latest">
                <strong>Latest saved note</strong>
                <p>{note.latest.title}</p>
                <pre>{note.latest.captionMd}</pre>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={note.pending}
                onClick={() => void note.keepMine()}
              >
                Save my retained text
              </button>
              <button
                type="button"
                className="button ghost"
                disabled={note.pending}
                onClick={note.useLatest}
              >
                Use latest text
              </button>
            </>
          )}
        </div>
      )}

      {note.current() && note.blocked && !note.pending && (
        <button
          type="button"
          className="sticky-add-heading"
          disabled={note.reading}
          onClick={() => {
            if (!note.abandon()) return;
            endRequested.current = false;
            if (local) finished?.(note.current(), true);
            else setEditing(false);
          }}
        >
          Discard my edits
        </button>
      )}

      {local && !note.current() && !note.pending && note.blocked && (
        <button
          type="button"
          className="sticky-add-heading"
          onClick={() => {
            if (note.isSaving()) return;
            if (
              window.confirm(
                note.phase === "unconfirmed"
                  ? "Discard only this local paper? The original create may have succeeded. Check the board and keep a copy of your text first."
                  : "Discard this local text? This will not delete any saved note.",
              )
            )
              finished?.(undefined, true);
          }}
        >
          Discard local paper
        </button>
      )}
    </fieldset>
  );
}
