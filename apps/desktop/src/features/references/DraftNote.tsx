import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RefItem } from "../../bindings";
import { Button } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
import { useProjectWrite } from "../../lib/use-project-write";

/** A local paper, never a blank persisted reference or an idempotency promise. */
export function DraftNote({
  projectId,
  x,
  y,
  close,
  saved,
  refresh,
}: {
  projectId: string;
  x: number;
  y: number;
  close(): void;
  saved(item: RefItem): void;
  refresh(): Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [discard, setDiscard] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const sent = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInput.current?.focus();
  }, []);
  const write = useProjectWrite("inline-reference-note", projectId);
  const dirty = !!(title || text);
  useBlocker({
    shouldBlockFn: () =>
      write.isLocked() ||
      (dirty &&
        !window.confirm(
          "Leave this unsaved note? Copy any text you need first. An already submitted note may still have been created.",
        )),
    enableBeforeUnload: dirty,
  });
  const cancel = () => {
    if (write.isLocked()) return;
    if (dirty || uncertain) setDiscard(true);
    else close();
  };
  const save = () => {
    if (!text.trim() || sent.current) return;
    write.run(async () => {
      // Set before dispatch: a transport rejection cannot prove non-commit.
      sent.current = true;
      try {
        return await api.addReference({
          kind: "note",
          title: title.trim() || undefined,
          text,
          x,
          y,
        });
      } catch (error) {
        setUncertain(true);
        throw error;
      }
    }, saved);
  };
  return (
    <form
      ref={form}
      aria-label="New note draft"
      className="reference-note-draft m5-form nodrag nopan nowheel"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          save();
        }
      }}
      onPaste={(event) => event.stopPropagation()}
    >
      <header>
        <strong>New note</strong>
        <small>
          {uncertain
            ? "Creation unconfirmed · text retained"
            : write.pending
              ? "Creating note…"
              : "Local draft · not saved yet"}
        </small>
      </header>
      <label className="field">
        Title
        <input
          ref={titleInput}
          maxLength={140}
          value={title}
          readOnly={!write.ready || uncertain}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Note"
        />
      </label>
      <label className="field">
        Note
        <textarea
          required
          value={text}
          readOnly={!write.ready || uncertain}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write your note here…"
        />
      </label>
      <ProjectWriteFeedback write={write} action="Creating note" form={form} />
      {uncertain && (
        <div role="alert">
          <p>
            Creation is unconfirmed. Your text is kept here for copying. Refresh
            references and check the board before discarding this draft; saving
            again is disabled to avoid duplicates.
          </p>
          <Button
            disabled={reading || write.changed}
            onClick={() => {
              setReading(true);
              setReadError("");
              void refresh()
                .catch((error) => setReadError(String(error)))
                .finally(() => setReading(false));
            }}
          >
            {reading ? "Checking references…" : "Refresh references"}
          </Button>
          {readError && <p>{readError}</p>}
        </div>
      )}
      {discard ? (
        <fieldset className="m5-form" aria-label="Discard local draft?">
          <p>
            Discard this local text? This does not delete a note already
            submitted.
          </p>
          <div className="button-row">
            <Button onClick={() => setDiscard(false)}>Keep editing</Button>
            <Button variant="danger" onClick={close}>
              Discard draft
            </Button>
          </div>
        </fieldset>
      ) : (
        <div className="button-row">
          <Button
            variant="primary"
            type="submit"
            disabled={!write.ready || uncertain || !text.trim()}
          >
            Save note
          </Button>
          <Button disabled={write.pending} onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
