import { GripHorizontal, StickyNote } from "lucide-react";
import { useRef, useState } from "react";
import type { RefItem } from "../../bindings";
import { StickyEditor } from "./StickyEditor";

/** A real local paper, not a create dialog. The first nonempty body autosaves. */
export function DraftNote({
  projectId,
  x,
  y,
  zoom = 1,
  maxHeight,
  close,
  saved,
  confirmed,
  item,
}: {
  item?: RefItem;
  projectId: string;
  x: number;
  y: number;
  zoom?: number;
  maxHeight?: number;
  close(restoreFocus?: boolean): void;
  saved(item: RefItem, restoreFocus?: boolean): void;
  confirmed?(item: RefItem, previous?: RefItem): void;
}) {
  const busy = useRef<(() => boolean) | null>(null);
  const [point, setPoint] = useState({ x, y });
  const [created, setCreated] = useState<RefItem>();
  const drag = useRef<{
    x: number;
    y: number;
    origin: { x: number; y: number };
  } | null>(null);
  return (
    <article
      className="reference-note-draft reference-sticky-paper nodrag nopan nowheel"
      aria-label="New note paper"
      style={{
        transform: `translate(${point.x}px, ${point.y}px)`,
        maxHeight,
        minHeight: Math.min(180, maxHeight ?? 180),
      }}
    >
      <header
        className={`sticky-paper-grip${created ? " sticky-paper-grip-saved" : ""}`}
        onPointerDown={(event) => {
          if (created || busy.current?.() || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, origin: point };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPoint({
            x: drag.current.origin.x + (event.clientX - drag.current.x) / zoom,
            y: drag.current.origin.y + (event.clientY - drag.current.y) / zoom,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        title={
          created ? "Finish editing to move this saved note" : "Move this paper"
        }
      >
        <StickyNote size={14} aria-hidden="true" />
        <span className="sr-only">Note</span>
        {!created && <GripHorizontal size={15} aria-hidden="true" />}
      </header>
      <StickyEditor
        busyRef={busy}
        item={item ?? created}
        local
        projectId={projectId}
        position={point}
        confirmed={(item, previous) => {
          setCreated(item);
          confirmed?.(item, previous);
        }}
        finished={(item, restoreFocus) =>
          item ? saved(item, restoreFocus) : close(restoreFocus)
        }
      />
    </article>
  );
}
