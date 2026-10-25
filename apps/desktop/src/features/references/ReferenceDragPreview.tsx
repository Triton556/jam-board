import {
  AudioLines,
  File,
  Frame,
  Image,
  Link,
  StickyNote,
  Type,
  Video,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { referenceKind } from "./model";

export type ReferenceDragPreviewData = {
  x: number;
  y: number;
  title: string;
  kind: ReturnType<typeof referenceKind> | "frame";
  count: number;
};
const icons = {
  frame: Frame,
  note: StickyNote,
  image: Image,
  link: Link,
  file: File,
  audio: AudioLines,
  video: Video,
  font: Type,
};

/** The top layer keeps the drag cue visible over drawers without intercepting the drop. */
export function ReferenceDragPreview({
  preview,
}: {
  preview: ReferenceDragPreviewData;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = element.current;
    if (!host) return;
    try {
      if (typeof host.showPopover === "function") host.showPopover();
      else host.removeAttribute("popover");
    } catch {
      host.removeAttribute("popover");
    }
    return () => {
      try {
        host.hidePopover?.();
      } catch {
        /* Already removed. */
      }
    };
  }, []);
  const Icon = icons[preview.kind];
  return createPortal(
    <div
      ref={element}
      popover="manual"
      className="reference-drag-preview"
      aria-hidden="true"
      style={{
        left: Math.max(8, Math.min(preview.x + 16, window.innerWidth - 272)),
        top: Math.max(8, Math.min(preview.y + 16, window.innerHeight - 48)),
      }}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{preview.title}</span>
      {preview.count > 1 && <small>+{preview.count - 1}</small>}
    </div>,
    document.body,
  );
}
