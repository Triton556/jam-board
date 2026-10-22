import {
  Handle,
  type Node,
  type NodeProps,
  NodeResizer,
  Position,
  useStore,
} from "@xyflow/react";
import {
  AudioLines,
  File,
  GripHorizontal,
  Image,
  Link,
  MoreHorizontal,
  StickyNote,
  Type,
  Video,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { RefFrame, RefItem } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { api } from "../../lib/api";
import { useUiStore } from "../../lib/ui-store";
import { LocalMedia } from "./Media";
import { palette, referenceKind } from "./model";
import { roughFramePaths } from "./rough";
import { useCanvas } from "./runtime";
export type TargetChip = { key: string; viaFrame: boolean; color?: string };
export type ItemData = {
  item: RefItem;
  path: string;
  links: TargetChip[];
  color: string;
  dim: boolean;
  highlight?: string;
  connect: boolean;
  expanded?: boolean;
  fitContent?: boolean;
};
export type FrameData = { frame: RefFrame; dim: boolean };
export type ItemNode = Node<ItemData, "reference">;
export type FrameNode = Node<FrameData, "frame">;
const icons = {
  image: Image,
  audio: AudioLines,
  video: Video,
  font: Type,
  file: File,
  link: Link,
  note: StickyNote,
};
export const ReferenceNode = memo(function ReferenceNode({
  data,
  selected,
}: NodeProps<ItemNode>) {
  const { item, path, links } = data,
    runtime = useCanvas(),
    kind = referenceKind(item, path),
    Icon = icons[kind];
  const overview = useStore((s) => s.transform[2] < 0.4);
  if (overview && !selected && !data.connect && !data.expanded)
    return (
      <article
        className="reference-overview-hit"
        data-reference-id={item.id}
        data-highlighted={!!data.highlight}
        aria-label={
          kind +
          " reference: " +
          item.title +
          ", linked to " +
          links.map((l) => l.key).join(", ")
        }
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </article>
    );
  let preview: { title?: string; image?: string } | null = null;
  try {
    preview = item.linkPreview ? JSON.parse(item.linkPreview) : null;
  } catch {
    /* Preserve a malformed legacy preview as an ordinary link. */
  }
  return (
    <article
      className={`reference-card kind-${kind} ${selected ? "selected" : ""} ${data.connect ? "connecting" : ""}`}
      data-reference-id={item.id}
      data-highlighted={!!data.highlight}
      aria-label={`${kind} reference: ${item.title}, linked to ${links.map((l) => l.key).join(", ") || "nothing"}`}
      style={
        {
          opacity: data.dim ? 0.15 : 1,
          "--reference-color": data.color,
          "--reference-highlight": data.highlight ?? "transparent",
        } as React.CSSProperties
      }
    >
      <NodeResizer
        isVisible={selected}
        minWidth={kind === "link" ? 240 : 180}
        minHeight={kind === "link" ? 160 : 130}
        keepAspectRatio={kind === "image"}
        onResizeEnd={(_, p) => runtime.resize(item, p.width, p.height)}
      />
      <Handle type="target" position={Position.Left} isConnectable />
      <header className="reference-card-header">
        <Icon size={15} />
        <strong>{item.title}</strong>
        <details className="reference-menu nodrag nopan">
          <summary aria-label={`Actions for ${item.title}`}>
            <MoreHorizontal size={18} />
          </summary>
          <fieldset
            className="reference-action-list"
            aria-label="Reference actions"
          >
            <button
              type="button"
              onClick={() => runtime.edit(item.id, "caption")}
            >
              Edit caption
            </button>
            <button type="button" onClick={() => runtime.edit(item.id, "tags")}>
              Tags
            </button>
            <button type="button" onClick={() => runtime.edit(item.id, "link")}>
              Link to…
            </button>
            {links.map((l) => (
              <button
                type="button"
                key={l.key}
                onClick={() => runtime.open(l.key)}
              >
                Open {l.key}
              </button>
            ))}
            <button
              type="button"
              onClick={() => runtime.archive("item", item.id)}
            >
              Archive
            </button>
          </fieldset>
        </details>
      </header>
      <div className="reference-content">
        {item.kind === "asset" ? (
          <LocalMedia item={item} path={path} />
        ) : kind === "link" ? (
          <div className="reference-link nodrag">
            <small className="mono">
              {(() => {
                try {
                  return new URL(item.url ?? "").hostname;
                } catch {
                  return item.url;
                }
              })()}
            </small>
            <button
              type="button"
              className="reference-link-title"
              onClick={() => void api.openUrl(item.url ?? "")}
            >
              {preview?.title || item.title}
            </button>
            {preview?.image && (
              <small className="muted">
                Page image metadata saved · no automatic download
              </small>
            )}
            <button
              type="button"
              className="button ghost"
              onClick={() =>
                void (
                  preview
                    ? api.clearReferencePreview(item.id)
                    : api.fetchReferencePreview(item.id)
                ).catch((e) => useUiStore.getState().error(String(e)))
              }
            >
              {preview ? "Remove preview" : "Fetch preview"}
            </button>
          </div>
        ) : null}
        {kind === "note" ? (
          <NoteContent item={item} />
        ) : (
          <div className="reference-caption">
            <Markdown>{item.captionMd || ""}</Markdown>
          </div>
        )}
      </div>
      {!!item.tags.length && (
        <div className="reference-tags">
          {item.tags.map((t) => (
            <small key={t}>#{t}</small>
          ))}
        </div>
      )}
      <footer className="reference-chips nodrag">
        {links.map((link) => (
          <button
            type="button"
            key={link.key}
            title={link.viaFrame ? "Linked via frame" : "Linked reference"}
            onClick={() => runtime.open(link.key)}
          >
            {link.key}
            {link.viaFrame && <small> via frame</small>}
          </button>
        ))}
      </footer>
      <Handle type="source" position={Position.Right} isConnectable />
    </article>
  );
});
function NoteContent({ item }: { item: RefItem }) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(item.captionMd),
    [error, setError] = useState("");
  const runtime = useCanvas();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const save = () =>
    void runtime
      .caption(item, value)
      .then(() => setEditing(false))
      .catch((e) => setError(String(e)));
  if (editing)
    return (
      <div className="nodrag nowheel">
        <textarea
          aria-label="Note text"
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setValue(item.captionMd);
              setEditing(false);
            }
            if (e.ctrlKey && e.key === "s") {
              e.preventDefault();
              save();
            }
          }}
        />
        <button type="button" className="button secondary" onClick={save}>
          Save note
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  return (
    <button
      type="button"
      className="reference-note-text reference-caption nodrag"
      onDoubleClick={() => {
        setValue(item.captionMd);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setValue(item.captionMd);
          setEditing(true);
        }
      }}
      aria-label={`Edit note ${item.title}`}
    >
      <Markdown>{item.captionMd}</Markdown>
    </button>
  );
}
export const ReferenceFrame = memo(function ReferenceFrame({
  data,
  selected,
}: NodeProps<FrameNode>) {
  const { frame } = data,
    c = useCanvas();
  const zoom = useStore((s) => s.transform[2]);
  const overview = zoom < 0.4;
  const headerScale = Math.max(1, 0.75 / zoom);
  return (
    <div
      className={`reference-frame ${overview && !selected ? "reference-frame-overview" : ""} ${selected ? "selected" : ""} ${frame.collapsed ? "collapsed" : ""}`}
      style={
        {
          "--reference-color": frame.epicId
            ? palette(frame.color)
            : "var(--line)",
          opacity: data.dim ? 0.15 : 1,
        } as React.CSSProperties
      }
    >
      <NodeResizer
        isVisible={selected && !frame.collapsed}
        minWidth={280}
        minHeight={160}
        onResizeEnd={(_, p) => c.resizeFrame(frame, p.width, p.height)}
      />
      {!frame.collapsed && (
        <svg
          className="reference-frame-outline"
          viewBox={`0 0 ${frame.w} ${frame.h}`}
          aria-hidden="true"
        >
          {roughFramePaths(frame.w ?? 800, frame.h ?? 600).map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      )}
      <div
        className="reference-frame-tab"
        style={{
          transform: `scale(${headerScale})`,
          width: `${100 / headerScale}%`,
        }}
        title="Drag this header to move the frame; select it to resize"
      >
        <GripHorizontal
          className="reference-frame-grip"
          size={20}
          aria-hidden="true"
        />
        <button
          type="button"
          className="nodrag"
          aria-label={`${frame.collapsed ? "Expand" : "Collapse"} ${frame.title}`}
          onClick={() => c.collapse(frame)}
        >
          {frame.collapsed ? "▸" : "▾"}
        </button>
        <span>{frame.title}</span>
        <button
          type="button"
          className="nodrag"
          aria-label={`Edit frame ${frame.title}`}
          onClick={() => c.editFrame(frame)}
        >
          <MoreHorizontal size={15} />
        </button>
        <button
          type="button"
          className="nodrag"
          aria-label={`Archive frame ${frame.title}`}
          onClick={() => c.archive("frame", frame.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
});
