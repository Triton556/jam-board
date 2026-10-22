import {
  Handle,
  type Node,
  type NodeProps,
  NodeResizer,
  Position,
  useStore,
} from "@xyflow/react";
import {
  Archive,
  AudioLines,
  ChevronDown,
  ChevronRight,
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
import { frameHeaderLayout } from "./frame-layout";
import { LocalMedia } from "./Media";
import { palette, referenceKind } from "./model";
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

/** Native disclosure semantics, with explicit nested dismissal and dialog opener ownership. */
export function ReferenceActions({
  item,
  links,
}: {
  item: RefItem;
  links: TargetChip[];
}) {
  const runtime = useCanvas();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as globalThis.Node)) {
        if (menu.current) menu.current.open = false;
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);
  const close = () => {
    if (menu.current) menu.current.open = false;
    setOpen(false);
  };
  const activate = (action: () => void) => {
    close();
    // Dialogs capture this visible opener, not the button about to become hidden.
    summary.current?.focus();
    action();
  };
  return (
    <details
      ref={menu}
      className="reference-menu nodrag nopan"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDownCapture={(event) => {
        // ReactFlow's document Space handler does not recognize SUMMARY as
        // interactive. Keep its native disclosure default, not canvas panning.
        if (event.key === " " && event.target === summary.current) {
          event.stopPropagation();
          return;
        }
        if (event.key !== "Escape" || !menu.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        summary.current?.focus();
      }}
    >
      <summary ref={summary} aria-label={`Actions for ${item.title}`}>
        <MoreHorizontal size={18} />
      </summary>
      <fieldset
        className="reference-action-list"
        aria-label="Reference actions"
      >
        <button
          type="button"
          onClick={() => activate(() => runtime.edit(item.id, "caption"))}
        >
          Edit caption
        </button>
        <button
          type="button"
          onClick={() => activate(() => runtime.edit(item.id, "tags"))}
        >
          Tags
        </button>
        <button
          type="button"
          onClick={() => activate(() => runtime.edit(item.id, "link"))}
        >
          Link to…
        </button>
        {links.map((l) => (
          <button
            type="button"
            key={l.key}
            onClick={() => activate(() => runtime.open(l.key))}
          >
            Open {l.key}
          </button>
        ))}
        <button
          type="button"
          onClick={() => activate(() => runtime.archive("item", item.id))}
        >
          Archive
        </button>
      </fieldset>
    </details>
  );
}
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
        <ReferenceActions item={item} links={links} />
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
  width,
}: NodeProps<FrameNode>) {
  const { frame } = data,
    c = useCanvas();
  const zoom = useStore((s) => s.transform[2]);
  const overview = zoom < 0.4;
  const header = frameHeaderLayout(width ?? frame.w ?? 800, zoom);
  return (
    <div
      className={`reference-frame ${overview && !selected ? "reference-frame-overview" : ""} ${selected ? "selected" : ""} ${frame.collapsed ? "collapsed" : ""}`}
      style={
        {
          "--reference-color": frame.epicId
            ? palette(frame.color)
            : "var(--line)",
          opacity: data.dim ? 0.15 : 1,
          minHeight: frame.collapsed ? header.height * header.scale : undefined,
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
          <rect
            x={0.5}
            y={0.5}
            width={Math.max(0, (frame.w ?? 800) - 1)}
            height={Math.max(0, (frame.h ?? 600) - 1)}
            rx={12}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <div
        className={`reference-frame-tab ${header.compact ? "compact" : ""}`}
        style={{
          transform: `scale(${header.scale})`,
          width: `${header.cssWidth}px`,
        }}
        title="Drag this header to move the frame; select it to resize"
      >
        <div className="reference-frame-heading">
          <GripHorizontal
            className="reference-frame-grip"
            size={20}
            aria-hidden="true"
          />
          <span className="reference-frame-title" title={frame.title}>
            {frame.title}
          </span>
        </div>
        <div className="reference-frame-actions">
          <button
            type="button"
            className="nodrag"
            aria-label={`${frame.collapsed ? "Expand" : "Collapse"} ${frame.title}`}
            onClick={() => c.collapse(frame)}
          >
            {frame.collapsed ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>
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
            <Archive size={15} />
          </button>
        </div>
      </div>
    </div>
  );
});
