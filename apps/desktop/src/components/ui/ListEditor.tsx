import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Button, IconButton } from "./index";
export function reorder<T>(items: T[], from: number, to: number) {
  const next = [...items];
  if (from < 0 || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
function ListRow({
  id,
  index,
  label,
  move,
  remove,
  disabled,
  children,
}: {
  id: string;
  index: number;
  label: string;
  move(to: number): void;
  remove(): void;
  disabled: boolean;
  children: ReactNode;
}) {
  const sortable = useSortable({ id, disabled });
  return (
    <fieldset
      ref={sortable.setNodeRef}
      className="list-editor-row"
      aria-label={`${label} ${index + 1}`}
      style={{
        opacity: sortable.isDragging ? 0.5 : 1,
        transform: sortable.transform
          ? `translate3d(${sortable.transform.x}px,${sortable.transform.y}px,0)`
          : undefined,
      }}
      onKeyDown={(e) => {
        if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          move(index + (e.key === "ArrowUp" ? -1 : 1));
        }
      }}
    >
      <div className="list-editor-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Drag ${label} ${index + 1}`}
          disabled={disabled}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={16} />
        </button>
        <span className="mono muted">{index + 1}</span>
        <IconButton
          label={`Move ${label} ${index + 1} up`}
          disabled={disabled || index === 0}
          onClick={() => move(index - 1)}
        >
          <ArrowUp size={14} />
        </IconButton>
        <IconButton
          label={`Move ${label} ${index + 1} down`}
          disabled={disabled}
          onClick={() => move(index + 1)}
        >
          <ArrowDown size={14} />
        </IconButton>
        <IconButton
          label={`Remove ${label} ${index + 1}`}
          disabled={disabled}
          onClick={remove}
        >
          <X size={14} />
        </IconButton>
      </div>
      {children}
    </fieldset>
  );
}
export function ListEditor<T>({
  label,
  value,
  onChange,
  create,
  children,
  disabled = false,
}: {
  label: string;
  value: T[];
  onChange(v: T[]): void;
  create(): T;
  children(row: T, index: number, patch: (p: Partial<T>) => void): ReactNode;
  disabled?: boolean;
}) {
  const ids = useRef<string[]>([]);
  while (ids.current.length < value.length)
    ids.current.push(crypto.randomUUID());
  ids.current.length = value.length;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const move = (from: number, to: number) => {
    ids.current = reorder(ids.current, from, to);
    onChange(reorder(value, from, to));
  };
  return (
    <section className="list-editor" aria-label={`${label} list`}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over)
            move(
              ids.current.indexOf(String(active.id)),
              ids.current.indexOf(String(over.id)),
            );
        }}
      >
        <SortableContext
          items={ids.current}
          strategy={verticalListSortingStrategy}
        >
          {value.map((row, index) => (
            <ListRow
              key={ids.current[index]}
              id={ids.current[index] ?? String(index)}
              index={index}
              label={label}
              disabled={disabled}
              move={(to) => move(index, to)}
              remove={() => {
                ids.current.splice(index, 1);
                onChange(value.filter((_, i) => i !== index));
              }}
            >
              {children(row, index, (patch) =>
                onChange(
                  value.map((r, i) => (i === index ? { ...r, ...patch } : r)),
                ),
              )}
            </ListRow>
          ))}
        </SortableContext>
      </DndContext>
      <Button
        disabled={disabled}
        onClick={() => onChange([...value, create()])}
      >
        <Plus size={15} />
        Add {label.toLowerCase()}
      </Button>
    </section>
  );
}
