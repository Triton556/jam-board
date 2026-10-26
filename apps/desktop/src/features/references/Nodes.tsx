import { useQuery } from "@tanstack/react-query";
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
  ArrowUpRight,
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
  Unlink,
  Video,
  X,
} from "lucide-react";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { RefFrame, RefItem } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { Tooltip } from "../../components/ui";
import type { VerdictItem } from "../../lib/api";
import { api } from "../../lib/api";
import { useUiStore } from "../../lib/ui-store";
import { frameHeaderLayout } from "./frame-layout";
import { frameTargets } from "./linking";
import { LocalMedia } from "./Media";
import { palette, referenceKind, referenceLabel } from "./model";
import { ReferencePopover } from "./ReferencePopover";
import { useCanvas } from "./runtime";
import { StickyEditor } from "./StickyEditor";
import { useSummaryTooltip } from "./use-summary-tooltip";
import { VerdictBadge, VerdictToolbar } from "./VerdictToolbar";
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
  missing?: boolean;
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
  editNote,
  noteEditing = false,
}: {
  item: RefItem;
  links: TargetChip[];
  editNote?: () => void;
  noteEditing?: boolean;
}) {
  const runtime = useCanvas();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const tooltip = useSummaryTooltip(
    summary,
    open,
    `Actions for ${referenceLabel(item)}`,
  );
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
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (menu.current) menu.current.open = true;
          setOpen(true);
          const buttons = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length
          ]?.focus();
          return;
        }
        if (event.key !== "Escape" || !menu.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        summary.current?.focus();
      }}
    >
      <summary
        ref={summary}
        aria-label={`Actions for ${referenceLabel(item)}`}
        aria-describedby={tooltip.id}
      >
        <MoreHorizontal size={18} />
      </summary>
      {tooltip.tip}
      <fieldset
        className="reference-action-list"
        aria-label="Reference actions"
      >
        <button
          type="button"
          onClick={() =>
            activate(() =>
              item.kind === "note"
                ? editNote?.()
                : runtime.edit(item.id, "caption"),
            )
          }
        >
          {item.kind === "note" ? "Edit note" : "Edit caption"}
        </button>
        {item.kind === "note" && (
          <button
            type="button"
            disabled={noteEditing}
            title={
              noteEditing
                ? "Finish editing this note before creating a task"
                : undefined
            }
            onClick={() => activate(() => runtime.createTask?.(item))}
          >
            Create task from note…
          </button>
        )}
        {item.kind === "note" && (
          <Tooltip
            text={
              noteEditing
                ? "Finish editing this note before asking brain"
                : "Ask brain about this"
            }
          >
            <button
              type="button"
              disabled={noteEditing}
              title={
                noteEditing
                  ? "Finish editing this note before asking brain"
                  : undefined
              }
              onClick={() =>
                activate(() =>
                  runtime.askBrain?.(
                    item,
                    links.map((link) => link.key),
                  ),
                )
              }
            >
              Ask brain about this
            </button>
          </Tooltip>
        )}
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
        {links
          .filter((link) => !link.viaFrame)
          .map((link) => (
            <button
              type="button"
              key={`unlink:${link.key}`}
              onClick={() =>
                activate(() => runtime.unlinkItem?.(item, link.key))
              }
            >
              Remove link to {link.key}
            </button>
          ))}
        <button
          type="button"
          disabled={noteEditing}
          title={
            noteEditing
              ? "Finish editing this note before archiving it"
              : undefined
          }
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
  const editNote = useRef<(() => void) | null>(null);
  const media = useQuery({
    queryKey: [
      kind === "image" ? "assetPreview" : "referenceMedia",
      item.assetId,
    ],
    queryFn: () =>
      item.assetId
        ? kind === "image"
          ? api.assetPreview(item.assetId)
          : api.referenceMedia(item.assetId)
        : Promise.resolve(null),
    enabled: item.kind === "asset" && (kind === "image" || kind === "video"),
    staleTime: Infinity,
  });
  const [noteEditing, setNoteEditing] = useState(false);
  const editingChanged = useCallback(
    (active: boolean) => {
      setNoteEditing(active);
      runtime.noteEditing?.(item.id, active);
    },
    [item.id, runtime.noteEditing],
  );
  const overview = useStore((s) => s.transform[2] < 0.4);
  const hasNoteHeading = kind === "note" && !!item.title.trim();
  const headingless = kind === "note" && !hasNoteHeading;
  const actions = (
    <ReferenceActions
      item={item}
      links={links}
      editNote={() => editNote.current?.()}
      noteEditing={noteEditing}
    />
  );
  if (overview && !selected && !data.connect && !data.expanded && !noteEditing)
    return (
      <article
        className="reference-overview-hit"
        data-reference-id={item.id}
        data-highlighted={!!data.highlight}
        aria-label={
          kind +
          " reference: " +
          referenceLabel(item) +
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
      className={`reference-card kind-${kind} ${headingless ? "note-without-heading" : ""} ${selected ? "selected" : ""} ${data.connect ? "connecting" : ""}`}
      onDoubleClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button, summary, input, textarea, a, .nodrag",
          )
        )
          return;
        if (kind === "note") editNote.current?.();
        else if (kind === "link") void api.openUrl(item.url ?? "");
        else if ((kind === "image" || kind === "video") && media.data)
          runtime.lightbox(
            media.data,
            item.title,
            kind === "video" ? "video" : undefined,
          );
        else if (kind !== "audio") void api.openReferenceFile(path);
      }}
      data-reference-id={item.id}
      data-highlighted={!!data.highlight}
      aria-label={`${kind} reference: ${referenceLabel(item)}, linked to ${links.map((l) => l.key).join(", ") || "nothing"}`}
      style={
        {
          opacity: data.dim
            ? 0.15
            : (item as VerdictItem).verdict === "reject"
              ? 0.45
              : 1,
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
      {
        // biome-ignore lint/a11y/noStaticElementInteractions: Note titles keep the body double-click shortcut; the Actions menu supplies keyboard Edit.
        <header
          className="reference-card-header"
          onDoubleClick={(event) => {
            if (
              kind === "note" &&
              !(event.target as HTMLElement).closest("button, summary, details")
            )
              editNote.current?.();
          }}
        >
          {kind === "note" ? (
            hasNoteHeading && !noteEditing ? (
              <strong className="sticky-note-title">{item.title}</strong>
            ) : (
              <span className="sticky-kind-label" />
            )
          ) : (
            <>
              <Icon size={15} />
              <strong>{item.title}</strong>
            </>
          )}
          <VerdictBadge item={item} />
          <VerdictToolbar item={item} />
          {actions}
        </header>
      }
      <div className="reference-content">
        {item.kind === "asset" ? (
          <LocalMedia item={item} path={path} />
        ) : kind === "link" ? (
          <div className="reference-link">
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
              className="reference-link-title nodrag"
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
              className="button ghost reference-text-action nodrag"
              onClick={() =>
                void (
                  preview
                    ? api.clearReferencePreview(item.id)
                    : api.fetchReferencePreview(item.id)
                ).catch((e) => useUiStore.getState().error(String(e)))
              }
            >
              {preview ? <X size={14} /> : <Image size={14} />}
              {preview ? "Remove preview" : "Fetch preview"}
            </button>
          </div>
        ) : null}
        {kind === "note" ? (
          <NoteContent
            item={item}
            beginRef={editNote}
            editingChanged={editingChanged}
            unavailable={data.missing}
          />
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
        {links
          .filter((link) => !link.viaFrame)
          .map((link) => (
            <button
              type="button"
              key={link.key}
              title={`Open ${link.key}`}
              onClick={() => runtime.open(link.key)}
            >
              {link.key}
            </button>
          ))}
      </footer>
      <Handle type="source" position={Position.Right} isConnectable />
    </article>
  );
});
function NoteContent({
  item,
  beginRef,
  editingChanged,
  unavailable,
}: {
  item: RefItem;
  beginRef: RefObject<(() => void) | null>;
  editingChanged(active: boolean): void;
  unavailable?: boolean;
}) {
  const runtime = useCanvas();
  return (
    <StickyEditor
      key={item.id}
      beginRef={beginRef}
      editingChanged={editingChanged}
      unavailable={unavailable}
      headingInHeader
      item={item}
      projectId={item.jamId}
      confirmed={(saved, previous) => runtime.noteSaved?.(saved, previous)}
    />
  );
}
export const ReferenceFrame = memo(function ReferenceFrame({
  data,
  selected,
  width,
}: NodeProps<FrameNode>) {
  const { frame } = data,
    c = useCanvas();
  const frameWidth = width ?? frame.w ?? 800;
  const zoom = useStore((s) => s.transform[2]);
  const overview = zoom < 0.4;
  const links = frameTargets(frame);
  const header = frameHeaderLayout(frameWidth, zoom, links.length > 0);
  const visibleLinks = header.compact ? 1 : 2;
  return (
    <div
      className={`reference-frame ${overview && !selected ? "reference-frame-overview" : ""} ${selected ? "selected" : ""} ${frame.collapsed ? "collapsed" : ""}`}
      style={
        {
          "--reference-color": frame.epicId
            ? palette(frame.color)
            : "var(--line)",
          opacity: data.dim ? 0.15 : 1,
          "--frame-control-size": `${header.controlSize}px`,
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
        className={`reference-frame-tab ${header.compact ? "compact" : ""} ${links.length ? "has-links" : ""}`}
        style={{
          transform: `scale(${header.scale})`,
          width: `${header.cssWidth}px`,
        }}
        title="Drag the tab or empty background to move the frame; Shift+drag to select"
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
          {header.overflow ? (
            <ReferencePopover
              label={`Frame actions for ${frame.title}`}
              trigger={<MoreHorizontal size={16} />}
            >
              {(close) => (
                <>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      close();
                      c.linkFrame?.(frame);
                    }}
                  >
                    Link frame to work
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      close();
                      c.collapse(frame);
                    }}
                  >
                    {frame.collapsed ? "Expand" : "Collapse"} {frame.title}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      close();
                      c.editFrame(frame);
                    }}
                  >
                    Edit frame {frame.title}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      close();
                      c.archive("frame", frame.id);
                    }}
                  >
                    Archive frame {frame.title}
                  </button>
                  {links.map((link) => (
                    <div key={link.targetKey}>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          close();
                          c.open(link.targetKey);
                        }}
                      >
                        Open {link.targetKey} · {link.title}
                      </button>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          close();
                          c.unlinkFrame?.(frame, link.targetKey);
                        }}
                      >
                        Remove link to {link.targetKey}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </ReferencePopover>
          ) : (
            <>
              <Tooltip text="Link frame to work">
                <button
                  type="button"
                  className="nodrag"
                  aria-label="Link frame to work"
                  onClick={() => c.linkFrame?.(frame)}
                >
                  <Link size={16} />
                </button>
              </Tooltip>
              <Tooltip
                text={`${frame.collapsed ? "Expand" : "Collapse"} ${frame.title}`}
              >
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
              </Tooltip>
              <Tooltip text={`Edit frame ${frame.title}`}>
                <button
                  type="button"
                  className="nodrag"
                  aria-label={`Edit frame ${frame.title}`}
                  onClick={() => c.editFrame(frame)}
                >
                  <MoreHorizontal size={15} />
                </button>
              </Tooltip>
              <Tooltip text={`Archive frame ${frame.title}`}>
                <button
                  type="button"
                  className="nodrag"
                  aria-label={`Archive frame ${frame.title}`}
                  onClick={() => c.archive("frame", frame.id)}
                >
                  <Archive size={15} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
        {!!links.length && !header.overflow && (
          <div className="reference-frame-links nodrag">
            {links.slice(0, visibleLinks).map((link) => (
              <ReferencePopover
                className="reference-link-pill"
                key={link.targetKey}
                label={link.targetKey}
                tooltip={`${link.targetKey} · ${link.title}`}
                trigger={
                  <>
                    <Link size={12} aria-hidden="true" />
                    {link.targetKey}
                  </>
                }
              >
                {(close) => (
                  <>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        close();
                        c.open(link.targetKey);
                      }}
                    >
                      <ArrowUpRight size={14} aria-hidden="true" /> Open
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        close();
                        c.unlinkFrame?.(frame, link.targetKey);
                      }}
                    >
                      <Unlink size={14} aria-hidden="true" /> Remove link
                    </button>
                  </>
                )}
              </ReferencePopover>
            ))}
            {links.length > visibleLinks && (
              <ReferencePopover
                className="reference-link-pill reference-frame-more"
                label="More linked work"
                trigger={<>+{links.length - visibleLinks}</>}
              >
                {(close) => (
                  <>
                    {links.map((link) => (
                      <div key={link.targetKey}>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            close();
                            c.open(link.targetKey);
                          }}
                        >
                          {link.targetKey} · {link.title}
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            close();
                            c.unlinkFrame?.(frame, link.targetKey);
                          }}
                        >
                          Remove link to {link.targetKey}
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </ReferencePopover>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
