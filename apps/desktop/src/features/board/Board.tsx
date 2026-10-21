import type {
  Announcements,
  DragEndEvent,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { LayoutGroup } from "motion/react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, IconButton } from "../../components/ui";
import { RoughLine } from "../../components/ui/RoughLine";
import { api } from "../../lib/api";
import {
  membersQuery,
  moveInput,
  relocate,
  tasksQuery,
  useBoardSettings,
  useMoveTask,
} from "../../lib/queries";
import type { ColorBy, Member, Status, TaskSummary } from "../../lib/types";
import { emptyBoard, labels, statuses } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { TaskCard } from "./TaskCard";

function QuickCreate({ status }: { status: Status }) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.createTask({ title: title.trim(), status }),
    onSuccess: () => {
      setTitle("");
      void client.invalidateQueries({ queryKey: ["boardTasks"] });
      ref.current?.focus();
    },
    onError: (error) => useUiStore.getState().error(error.message),
  });
  function keydown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      useUiStore.getState().setQuickColumn(null);
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (title.trim() && !create.isPending) create.mutate();
    }
  }
  return (
    <div className="quick-create">
      <textarea
        aria-label={`New task in ${labels[status]}`}
        placeholder="What needs making?"
        maxLength={140}
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={keydown}
      />
      <div>
        <span>Enter to add · Esc to close</span>
        <Button
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          Add
        </Button>
        <IconButton
          label="Cancel new task"
          onClick={() => useUiStore.getState().setQuickColumn(null)}
        >
          <X size={16} />
        </IconButton>
      </div>
    </div>
  );
}
function SortableCard({
  task,
  members,
  open,
}: {
  task: TaskSummary;
  members: Member[];
  open(key: string): void;
}) {
  const { settings } = useBoardSettings();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    isOver,
    transform,
    transition,
  } = useSortable({ id: task.key, data: { status: task.status } });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`card-button ${isDragging ? "dragging" : ""}`}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
      aria-label={`Open ${task.key}: ${task.title}`}
      onClick={(event) => {
        event.currentTarget.focus();
        open(task.key);
      }}
    >
      <TaskCard
        task={task}
        members={members}
        colorBy={settings?.colorBy as ColorBy}
        estimatesEnabled={settings?.estimatesEnabled}
      />
      {isOver && <RoughLine frame />}
    </button>
  );
}
function Column({
  status,
  tasks,
  totalCount,
  members,
  open,
}: {
  status: Status;
  tasks: TaskSummary[];
  totalCount: number;
  members: Member[];
  open(key: string): void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { status, column: true },
  });
  const { settings } = useBoardSettings();
  const quick = useUiStore((s) => s.quickColumn === status);
  return (
    <section
      className={`board-column ${isOver ? "drop-over" : ""}`}
      ref={setNodeRef}
      data-column={status}
      aria-label={`${labels[status]} column`}
    >
      <header className="column-heading">
        <h2>{labels[status]}</h2>
        <span
          className={`column-count ${status === "in_progress" && totalCount > (settings?.wipLimit ?? 6) ? "over-wip" : ""}`}
        >
          {tasks.length}
        </span>
        <IconButton
          label={`Add task to ${labels[status]}`}
          onClick={() => useUiStore.getState().setQuickColumn(status)}
        >
          <Plus size={17} />
        </IconButton>
        <RoughLine color={`var(--st-${status})`} />
      </header>
      {status === "in_progress" && (
        <p
          className={`column-policy ${totalCount > (settings?.wipLimit ?? 6) ? "over-wip" : ""}`}
        >
          {totalCount} / {settings?.wipLimit ?? 6} Doing across board
          {tasks.length !== totalCount && ` · ${tasks.length} shown`}
        </p>
      )}
      <div className="column-cards">
        <SortableContext
          items={tasks.map((t) => t.key)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableCard
              key={task.key}
              task={task}
              members={members}
              open={open}
            />
          ))}
        </SortableContext>
        {quick && <QuickCreate status={status} />}
        {tasks.length === 0 && !quick && <EmptyState />}
        {isOver && <RoughLine frame />}
      </div>
      <button
        type="button"
        className="column-add"
        onClick={() => useUiStore.getState().setQuickColumn(status)}
      >
        <Plus size={15} /> Add task
      </button>
    </section>
  );
}
export function Board({
  open,
  epicKeys = [],
}: {
  open(key: string): void;
  epicKeys?: string[];
}) {
  const { settings } = useBoardSettings();
  const tasks = useQuery(tasksQuery);
  const members = useQuery(membersQuery);
  const move = useMoveTask();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const source = tasks.data ?? emptyBoard();
  const board = epicKeys.length
    ? (Object.fromEntries(
        statuses.map((s) => [
          s,
          source[s].filter((t) => epicKeys.includes(t.epicKey ?? "")),
        ]),
      ) as typeof source)
    : source;
  const boardRef = useRef(board);
  boardRef.current = board;
  const destination = useRef<{ status: Status; index: number } | null>(null);
  // Horizontal keyboard movement explicitly selects the adjacent column. Vertical
  // movement keeps dnd-kit's sortable coordinate behavior and announcements.
  const coordinates: KeyboardCoordinateGetter = (event, args) => {
    const slotCoordinates = (status: Status, index: number) => {
      const items = boardRef.current[status];
      const next = items[index];
      const previous = items[index - 1];
      const nextRect = next
        ? args.context.droppableRects.get(next.key)
        : undefined;
      if (nextRect) return { x: nextRect.left, y: nextRect.top };
      const previousRect = previous
        ? args.context.droppableRects.get(previous.key)
        : undefined;
      if (previousRect)
        return { x: previousRect.left, y: previousRect.bottom + 15 };
      const columnRect = args.context.droppableRects.get(status);
      return columnRect
        ? { x: columnRect.left + 3, y: columnRect.top + 66 }
        : undefined;
    };
    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      const current =
        destination.current?.status ??
        (args.context.active?.data.current?.status as Status);
      const next =
        statuses[
          statuses.indexOf(current) + (event.code === "ArrowRight" ? 1 : -1)
        ];
      if (next) {
        event.preventDefault();
        destination.current = {
          status: next,
          index: boardRef.current[next].length,
        };
        return slotCoordinates(next, destination.current.index);
      }
    }
    if (
      destination.current &&
      (event.code === "ArrowUp" || event.code === "ArrowDown")
    ) {
      event.preventDefault();
      const dest = destination.current;
      dest.index = Math.max(
        0,
        Math.min(
          boardRef.current[dest.status].length,
          dest.index + (event.code === "ArrowDown" ? 1 : -1),
        ),
      );
      return slotCoordinates(dest.status, dest.index);
    }
    return sortableKeyboardCoordinates(event, args);
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: coordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  );
  const active = statuses
    .flatMap((s) => board[s])
    .find((t) => t.key === activeKey);
  function locate(id: string) {
    const status = statuses.includes(id as Status)
      ? (id as Status)
      : statuses.find((s) => board[s].some((t) => t.key === id));
    return status
      ? { status, index: board[status].findIndex((t) => t.key === id) }
      : null;
  }
  function finish(event: DragEndEvent) {
    const keyboard = event.activatorEvent.type === "keydown";
    const target =
      keyboard && destination.current
        ? destination.current
        : event.over
          ? locate(String(event.over.id))
          : null;
    if (target) {
      const key = String(event.active.id);
      const items = board[target.status].filter((t) => t.key !== key);
      const index =
        target.index < 0 ? items.length : Math.min(target.index, items.length);
      // Translate the visible insertion slot into the full column; hidden epics
      // may have tasks between the two visible neighbors.
      const full = source[target.status].filter((t) => t.key !== key);
      const before = items[index];
      const after = items[index - 1];
      const fullIndex = before
        ? full.findIndex((t) => t.key === before.key)
        : after
          ? full.findIndex((t) => t.key === after.key) + 1
          : full.length;
      const next = relocate(source, key, target.status, fullIndex);
      move.mutate(moveInput(next, key, target.status));
    }
    setActiveKey(null);
    destination.current = null;
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const pos = locate(String(active.id));
      return pos
        ? `Picked up ${active.id}. Column ${labels[pos.status]}, position ${pos.index + 1} of ${board[pos.status].length}.`
        : undefined;
    },
    onDragOver: ({ active, over }) => {
      const pos =
        destination.current ?? (over ? locate(String(over.id)) : null);
      return pos
        ? `${active.id}. Column ${labels[pos.status]}, position ${Math.max(0, pos.index) + 1}.`
        : undefined;
    },
    onDragEnd: ({ active, over }) =>
      `Dropped ${active.id}${over ? ` in ${labels[destination.current?.status ?? locate(String(over.id))?.status ?? "ready"]}` : ""}.`,
    onDragCancel: ({ active }) => `Cancelled dragging ${active.id}.`,
  };
  if (tasks.isPending || members.isPending)
    return <div className="loading">Opening your sketchbook…</div>;
  if (tasks.error || members.error)
    return (
      <div role="alert" className="page-error">
        {(tasks.error ?? members.error)?.message}
        <Button
          onClick={() => {
            void tasks.refetch();
            void members.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  return (
    <LayoutGroup>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press Enter to open a task. Press Space to pick it up. Use arrow keys to move, Space to drop, or Escape to cancel.",
          },
        }}
        onDragStart={({ active }) => {
          setActiveKey(String(active.id));
          destination.current = null;
        }}
        onDragEnd={finish}
        onDragCancel={() => {
          setActiveKey(null);
          destination.current = null;
        }}
      >
        <div className="board-scroll">
          <div className="board-columns">
            {statuses.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={board[status]}
                totalCount={source[status].length}
                members={members.data ?? []}
                open={open}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="drag-overlay">
              <TaskCard
                task={active}
                members={members.data ?? []}
                overlay
                colorBy={settings?.colorBy as ColorBy}
                estimatesEnabled={settings?.estimatesEnabled}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </LayoutGroup>
  );
}
