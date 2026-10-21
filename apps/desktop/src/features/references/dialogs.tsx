import { useState } from "react";
import type { RefItem } from "../../bindings";
import { Button, Dialog, Select, TagInput } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import type { ReferenceInput } from "../../lib/references-api";
export function AddReferenceDialog({
  kind,
  close,
  save,
}: {
  kind: "link" | "note";
  close(): void;
  save(input: ReferenceInput): Promise<unknown>;
}) {
  const [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={kind === "link" ? "Add link" : "Add note"} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void save({
            kind,
            title: title.trim() || undefined,
            ...(kind === "link" ? { url: text } : { text }),
          })
            .then(close)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          Title
          <input
            autoFocus
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          {kind === "link" ? "URL" : "Note"}
          <textarea
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          Add {kind}
        </Button>
      </form>
    </Dialog>
  );
}
export function FrameDialog({
  epics,
  close,
  save,
  initial,
}: {
  epics: { id: string; title: string }[];
  close(): void;
  save(title: string, epicId: string | null): Promise<unknown>;
  initial?: { title: string; epicId: string | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? "Reference board"),
    [epic, setEpic] = useState(initial?.epicId ?? ""),
    [error, setError] = useState("");
  return (
    <Dialog title={initial ? "Edit frame" : "New frame"} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(title, epic || null)
            .then(close)
            .catch((e) => setError(String(e)));
        }}
      >
        <label className="field">
          Title
          <input
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Epic</span>
          <Select
            aria-label="Frame epic"
            value={epic}
            onChange={(e) => setEpic(e.target.value)}
          >
            <option value="">Unbound</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </Select>
        </div>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" variant="primary">
          {initial ? "Save frame" : "Create frame"}
        </Button>
      </form>
    </Dialog>
  );
}
export function EditReferenceDialog({
  item,
  mode,
  targets,
  close,
  save,
  link,
}: {
  item: RefItem;
  mode: "caption" | "tags" | "link";
  targets: { key: string; title: string; kind: string }[];
  close(): void;
  save(p: {
    title?: string;
    caption?: string;
    tags?: string[];
  }): Promise<unknown>;
  link(key: string): Promise<unknown>;
}) {
  const [title, setTitle] = useState(item.title),
    [caption, setCaption] = useState(item.captionMd),
    [tags, setTags] = useState(item.tags),
    [key, setKey] = useState(""),
    [error, setError] = useState("");
  return (
    <Dialog
      title={
        mode === "link"
          ? "Link reference"
          : mode === "tags"
            ? "Reference tags"
            : "Edit reference"
      }
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (
            mode === "link"
              ? link(key)
              : save(mode === "tags" ? { tags } : { title, caption })
          )
            .then(close)
            .catch((e) => setError(String(e)));
        }}
      >
        {mode === "link" ? (
          <CustomSelect
            searchable
            label="Link to work"
            value={key}
            onChange={setKey}
            options={targets.map((t) => ({
              value: t.key,
              label: `${t.key} · ${t.title}`,
              group: t.kind,
            }))}
          />
        ) : mode === "tags" ? (
          <TagInput value={tags} onChange={setTags} />
        ) : (
          <>
            <label className="field">
              Title
              <input
                autoFocus
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Caption
              <textarea
                aria-label="Reference caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={6}
              />
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          disabled={mode === "link" && !key}
        >
          Save
        </Button>
      </form>
    </Dialog>
  );
}
