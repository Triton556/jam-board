import { useRef, useState } from "react";
import type { RefItem } from "../../bindings";
import { Button, Dialog, Select, TagInput } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import type { ReferenceInput } from "../../lib/references-api";
import { useProjectWrite } from "../../lib/use-project-write";
export function AddReferenceDialog({
  kind,
  close,
  save,
  onSaved,
}: {
  kind: "link" | "note";
  close(): void;
  save(input: ReferenceInput): Promise<unknown>;
  onSaved?(): void;
}) {
  const [title, setTitle] = useState(""),
    [text, setText] = useState("");
  const write = useProjectWrite(`add-reference:${kind}`),
    form = useRef<HTMLFormElement>(null);
  return (
    <Dialog
      title={kind === "link" ? "Add link" : "Add note"}
      busy={write.pending}
      onClose={() => write.dismiss(close)}
    >
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          const input: ReferenceInput = {
            kind,
            title: title.trim() || undefined,
            ...(kind === "link" ? { url: text } : { text }),
          };
          write.run(
            () => save(input),
            () => {
              onSaved?.();
              close();
            },
          );
        }}
      >
        <label className="field">
          Title
          <input
            disabled={!write.ready}
            autoFocus
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          {kind === "link" ? "URL" : "Note"}
          <textarea
            disabled={!write.ready}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <ProjectWriteFeedback
          write={write}
          action={`Adding ${kind}`}
          form={form}
        />
        <Button type="submit" variant="primary" disabled={!write.ready}>
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
  initial?: { id?: string; title: string; epicId: string | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? "Reference board"),
    [epic, setEpic] = useState(initial?.epicId ?? "");
  const write = useProjectWrite(
      `frame:${initial?.id ?? (initial ? "edit" : "new")}`,
    ),
    form = useRef<HTMLFormElement>(null);
  return (
    <Dialog
      title={initial ? "Edit frame" : "New frame"}
      busy={write.pending}
      onClose={() => write.dismiss(close)}
    >
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          write.run(() => save(title, epic || null), close);
        }}
      >
        <label className="field">
          Title
          <input
            disabled={!write.ready}
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Epic</span>
          <Select
            disabled={!write.ready}
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
        <ProjectWriteFeedback
          write={write}
          action={initial ? "Saving frame" : "Creating frame"}
          form={form}
        />
        <Button type="submit" variant="primary" disabled={!write.ready}>
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
    [key, setKey] = useState("");
  const write = useProjectWrite(`reference:${item.id}:${mode}`),
    form = useRef<HTMLFormElement>(null);
  return (
    <Dialog
      title={
        mode === "link"
          ? "Link reference"
          : mode === "tags"
            ? "Reference tags"
            : "Edit reference"
      }
      busy={write.pending}
      onClose={() => write.dismiss(close)}
    >
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          write.run(
            () =>
              mode === "link"
                ? link(key)
                : save(mode === "tags" ? { tags } : { title, caption }),
            close,
          );
        }}
      >
        {mode === "link" ? (
          <CustomSelect
            disabled={!write.ready}
            searchable
            label="Link to work"
            value={key}
            onChange={(value) => {
              if (write.ready) setKey(value);
            }}
            options={targets.map((t) => ({
              value: t.key,
              label: `${t.key} · ${t.title}`,
              group: t.kind,
            }))}
          />
        ) : mode === "tags" ? (
          <TagInput disabled={!write.ready} value={tags} onChange={setTags} />
        ) : (
          <>
            <label className="field">
              Title
              <input
                disabled={!write.ready}
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
                disabled={!write.ready}
                aria-label="Reference caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={6}
              />
            </label>
          </>
        )}
        <ProjectWriteFeedback
          write={write}
          action="Saving reference"
          form={form}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!write.ready || (mode === "link" && !key)}
        >
          Save
        </Button>
      </form>
    </Dialog>
  );
}
