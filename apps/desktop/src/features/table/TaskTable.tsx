import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  EmptyState,
  Select,
  Stamp,
  TagInput,
} from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { Switch } from "../../components/ui/m5";
import { NewTaskButton } from "../../components/ui/NewTaskButton";
import { agentWorking, useWorkingClock } from "../../lib/agent-working";
import { api } from "../../lib/api";
import { avatarInitials } from "../../lib/avatar-initials";
import { epicsQuery, storiesQuery } from "../../lib/planning-queries";
import { membersQuery, useBoardSettings } from "../../lib/queries";
import type { Member, Status, TaskSummary } from "../../lib/types";
import { labels, statuses } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { InlineTaskCreate } from "./InlineTaskCreate";
import type { TableSearch } from "./search";
import { nextSort, tableQuery } from "./search";
import { TableRow } from "./TableRow";
import { tableTime, useTableClock } from "./table-time";
import { useTableVirtualizer } from "./use-table-virtualizer";
import { WorkingLayer } from "./WorkingLayer";

type Highlight = ReturnType<typeof useUiStore.getState>["highlights"][string];

const rowAt = (target: EventTarget) =>
  target instanceof Element
    ? target.closest<HTMLElement>("[data-task-key]")?.dataset.taskKey
    : undefined;

const columns = [
  ["key", "Key"],
  ["epic", "Epic"],
  ["story", "Story"],
  ["title", "Title"],
  ["status", "Status"],
  ["priority", "Priority"],
  ["assignee", "Assignee"],
  ["tags", "Tags"],
  ["estimate", "Est."],
  ["ready", "Ready"],
  ["flags", "Flags"],
  ["updatedAt", "Updated"],
] as const;
export function TaskTable({
  search,
  change,
  open,
}: {
  search: TableSearch;
  change(value: TableSearch): void;
  open(key: string): void;
}) {
  const { settings } = useBoardSettings();
  const epics = useQuery(epicsQuery),
    stories = useQuery(storiesQuery);
  const estimatesEnabled = settings?.estimatesEnabled ?? false;
  const query = tableQuery(search);
  if (!estimatesEnabled && query.sort?.field === "estimate")
    query.sort = undefined;
  const [creating, setCreating] = useState(false),
    [creationBusy, setCreationBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
  const receiptRef = useRef<HTMLParagraphElement>(null),
    root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (receipt) receiptRef.current?.focus();
  }, [receipt]);
  const beginCreate = useCallback(() => {
    if (!creating) setReceipt("");
    setCreating(true);
    root.current
      ?.querySelector<HTMLInputElement>('input[aria-label="New task title"]')
      ?.focus();
  }, [creating]);
  const [pinned, setPinned] = useState<TaskSummary[]>([]);
  const [focusedTask, setFocusedTask] = useState<string | null>(null);
  const rowFocusOwner = useRef<HTMLElement | null>(null);
  const filterKey = JSON.stringify([
    search.q,
    search.status,
    search.assignee,
    search.tags,
    search.archived,
    search.sort,
    search.epic,
    search.story,
    search.ready,
    search.changes,
    search.info,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A filter transition releases pinned newly created rows.
  useEffect(() => {
    setPinned([]);
  }, [filterKey]);
  useEffect(() => {
    const handler = () => beginCreate();
    window.addEventListener("table-new-task", handler);
    return () => window.removeEventListener("table-new-task", handler);
  }, [beginCreate]);
  const tasks = useQuery({
    queryKey: ["tableTasks", query],
    queryFn: () => api.listTasks(query),
  });
  const members = useQuery(membersQuery);
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  const [text, setText] = useState(search.q ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const highlights = useUiStore((s) => s.highlights);
  const changeRef = useRef(change);
  changeRef.current = change;
  const searchState = useRef(search);
  searchState.current = search;
  const openedTask = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (search.task) {
      openedTask.current = search.task;
      return;
    }
    const key = openedTask.current;
    openedTask.current = undefined;
    if (!key) return;
    // A cold detail request can replace the loading Drawer with the editor.
    // Restore the logical row after both modal cleanups, not a detached node
    // captured by an intermediate modal's focus trap.
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-task-key="${CSS.escape(key)}"]`)
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [search.task]);
  useEffect(() => setText(search.q ?? ""), [search.q]);
  useEffect(() => {
    if (text === (searchState.current.q ?? "")) return;
    const timer = setTimeout(
      () => changeRef.current({ ...searchState.current, q: text || undefined }),
      200,
    );
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest('input,textarea,select,[contenteditable="true"]')
        )
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const matches = tasks.data?.tasks ?? [];
  const total = tasks.data?.total ?? 0;
  const hiddenKeys = new Set(
    pinned
      .filter((t) => !matches.some((m) => m.key === t.key))
      .map((t) => t.key),
  );
  const rows = [
    ...pinned,
    ...matches.filter((t) => !pinned.some((p) => p.key === t.key)),
  ];
  const filtered = !!(
    search.q ||
    search.status ||
    search.assignee ||
    search.tags ||
    search.archived ||
    search.epic ||
    search.story ||
    search.ready ||
    search.changes ||
    search.info
  );
  const clear = () => change({ sort: search.sort, task: search.task });
  return (
    <main className="table-page" ref={root}>
      <div className="page-title">
        <div>
          <span className="eyebrow">A LITTLE ORDER FOR BIG IDEAS</span>
          <h1>Task table</h1>
        </div>
        <div className="button-row">
          <span className="muted task-count" aria-live="polite">
            {tasks.isPending
              ? "Reading tasks…"
              : tasks.error
                ? "Count unavailable"
                : `${total} ${total === 1 ? "task" : "tasks"}`}
          </span>
          <NewTaskButton onClick={beginCreate} disabled={creationBusy} />
        </div>
      </div>
      <div className="table-filters">
        <label className="table-search">
          <Search size={16} />
          <input
            ref={searchRef}
            aria-label="Search tasks"
            placeholder="Search tasks…  /"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <fieldset className="status-filters" aria-label="Filter statuses">
          {statuses.map((status) => {
            const selected = search.status?.split(",") ?? [];
            return (
              <button
                type="button"
                key={status}
                aria-pressed={selected.includes(status)}
                onClick={() =>
                  change({
                    ...search,
                    status:
                      (selected.includes(status)
                        ? selected.filter((s) => s !== status)
                        : [...selected, status]
                      ).join(",") || undefined,
                  })
                }
              >
                <Stamp style={{ background: `var(--st-${status})` }}>
                  {labels[status]}
                </Stamp>
              </button>
            );
          })}
        </fieldset>
        <Select
          aria-label="Filter assignee"
          value={search.assignee ?? ""}
          onChange={(e) =>
            change({ ...search, assignee: e.target.value || undefined })
          }
        >
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          <option value="agents">Agents</option>
          <option value="humans">Humans</option>
          {members.data?.map((m) => (
            <option value={m.id} key={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <TagInput
          label="Filter tags"
          value={search.tags?.split(",") ?? []}
          suggestions={tags.data?.map((t) => t.tag)}
          onChange={(v) =>
            change({ ...search, tags: v.join(",") || undefined })
          }
        />
        <CustomSelect
          label="Filter epic"
          value={search.epic ?? ""}
          onChange={(epic) =>
            change({ ...search, epic: epic || undefined, story: undefined })
          }
          options={[
            { value: "", label: "All epics" },
            ...(epics.data ?? [])
              .filter((e) => !e.archivedAt)
              .map((e) => ({
                value: e.key,
                label: `${e.key} · ${e.title}`,
                color: `var(--${e.color})`,
              })),
          ]}
        />
        <CustomSelect
          label="Filter story"
          value={search.story ?? ""}
          onChange={(story) => change({ ...search, story: story || undefined })}
          options={[
            { value: "", label: "All stories" },
            ...(stories.data ?? [])
              .filter(
                (s) =>
                  !search.epic ||
                  epics.data?.find((e) => e.key === search.epic)?.id ===
                    s.epicId,
              )
              .map((s) => ({ value: s.key, label: `${s.key} · ${s.title}` })),
          ]}
        />
        <Select
          aria-label="Filter readiness"
          value={search.ready ?? ""}
          onChange={(e) =>
            change({
              ...search,
              ready: (e.target.value as "1" | "0") || undefined,
            })
          }
        >
          <option value="">Any readiness</option>
          <option value="1">Ready brief</option>
          <option value="0">Incomplete brief</option>
        </Select>
        <Switch
          label="Changes requested"
          checked={search.changes === "1"}
          onChange={(v) => change({ ...search, changes: v ? "1" : undefined })}
        />
        <Switch
          label="Needs info"
          checked={search.info === "1"}
          onChange={(v) => change({ ...search, info: v ? "1" : undefined })}
        />
        <Switch
          label="Show archived"
          checked={search.archived === "1"}
          onChange={(v) => change({ ...search, archived: v ? "1" : undefined })}
        />
        <Button
          variant="ghost"
          onClick={clear}
          disabled={!filtered}
          aria-hidden={!filtered}
          style={{ visibility: filtered ? "visible" : "hidden" }}
        >
          Clear filters
        </Button>
      </div>
      {receipt && (
        <p ref={receiptRef} role="status" tabIndex={-1}>
          {receipt}
        </p>
      )}
      {creating && (
        <InlineTaskCreate
          busy={setCreationBusy}
          close={() => {
            setCreating(false);
            root.current
              ?.querySelector<HTMLButtonElement>(".inline-create-trigger")
              ?.focus();
          }}
          created={(task) => {
            setPinned((previous) => [task, ...previous]);
            setCreating(false);
            setReceipt(
              `Created ${task.key} in ${labels[task.status as Status]}.`,
            );
            useUiStore.setState((state) => ({
              highlights: {
                ...state.highlights,
                [task.key]: {
                  color: "var(--coral)",
                  until: Date.now() + 2000,
                  action: "task.created",
                },
              },
            }));
            root.current?.querySelector(".table-scroll")?.scrollTo({ top: 0 });
          }}
        />
      )}
      {tasks.error && (
        <div className="table-read-error">
          <p role="alert">{tasks.error.message}</p>
          <Button
            onClick={() => void tasks.refetch()}
            disabled={tasks.isFetching}
          >
            {tasks.isFetching ? "Retrying…" : "Retry task list"}
          </Button>
        </div>
      )}
      {tasks.isPending && <p className="loading">Opening the task list…</p>}
      <VirtualTaskTable
        rows={tasks.isPending || tasks.error ? [] : rows}
        loading={tasks.isPending}
        focused={focusedTask}
        setFocused={setFocusedTask}
        focusOwner={rowFocusOwner}
        estimatesEnabled={estimatesEnabled}
        hiddenKeys={hiddenKeys}
        members={members.data ?? []}
        highlights={highlights}
        open={open}
        header={
          <thead>
            <tr>
              {columns
                .filter(([field]) => field !== "estimate" || estimatesEnabled)
                .map(([field, label]) => {
                  const [sorted, dir] = (search.sort ?? "updatedAt:desc").split(
                    ":",
                  );
                  return (
                    <th
                      key={field}
                      scope="col"
                      aria-sort={
                        sorted === field
                          ? dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      {["tags", "epic", "story", "ready", "flags"].includes(
                        field,
                      ) ? (
                        label
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            change({
                              ...search,
                              sort: nextSort(
                                search.sort ?? "updatedAt:desc",
                                field,
                              ),
                            })
                          }
                        >
                          {label}
                          {sorted === field &&
                            (dir === "asc" ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            ))}
                        </button>
                      )}
                    </th>
                  );
                })}
            </tr>
            <tr className="inline-create">
              <td>
                <button
                  type="button"
                  className="inline-create-trigger"
                  disabled={creationBusy}
                  onClick={beginCreate}
                >
                  + New task
                </button>
              </td>
            </tr>
          </thead>
        }
      />
      {!tasks.isPending && !tasks.error && !rows.length && (
        <EmptyState text="No tasks match these filters">
          <Button onClick={clear}>Clear filters</Button>
        </EmptyState>
      )}
    </main>
  );
}

function VirtualTaskTable({
  rows,
  loading,
  focused,
  setFocused,
  focusOwner,
  members,
  highlights,
  open,
  header,
  estimatesEnabled,
  hiddenKeys,
}: {
  rows: TaskSummary[];
  loading: boolean;
  focused: string | null;
  setFocused(key: string): void;
  focusOwner: RefObject<HTMLElement | null>;
  members: Member[];
  highlights: Record<string, Highlight>;
  open(key: string): void;
  header: ReactNode;
  estimatesEnabled: boolean;
  hiddenKeys: Set<string>;
}) {
  const scroll = useRef<HTMLElement>(null);
  const itemKey = useCallback(
    (index: number) => rows[index]?.key ?? index,
    [rows],
  );
  const virtual = useTableVirtualizer(scroll, rows.length, itemKey);
  const tick = useTableClock();
  const workingNow = useWorkingClock();
  const display = useMemo(
    () =>
      new Map(rows.map((task) => [task.key, tableTime(task.updatedAt, tick)])),
    [rows, tick],
  );
  const people = useMemo(
    () =>
      new Map(
        members.map((member) => [
          member.id,
          { member, initials: avatarInitials(member, members) },
        ]),
      ),
    [members],
  );
  const virtualItems = virtual.getVirtualItems();
  const remembered = useRef(focused);
  remembered.current = focused;
  const indexes = useMemo(
    () => new Map(rows.map((task, index) => [task.key, index])),
    [rows],
  );
  const visibleEntry = (offset: number, height: number) => {
    if (!rows.length) return undefined;
    // An intersecting sliver is not a readable entry: prefer complete rows below
    // the sticky 84px header. Overscan presence alone says nothing about visibility.
    const top = Math.max(0, offset);
    const usableHeight = Math.max(0, height - 84);
    let first = Math.ceil(top / 44);
    let last = Math.min(
      rows.length - 1,
      Math.floor((top + usableHeight) / 44) - 1,
    );
    if (first > last) {
      // A very short viewport can fit no full row. Choose the row at its centre
      // (the greatest available overlap), bounded during data/viewport changes.
      first = Math.min(
        rows.length - 1,
        Math.floor((top + usableHeight / 2) / 44),
      );
      last = first;
    }
    const prior = indexes.get(remembered.current ?? "") ?? -1;
    return prior >= first && prior <= last
      ? remembered.current
      : rows[first]?.key;
  };
  const entryKey = visibleEntry(
    virtual.scrollOffset ?? 0,
    virtual.scrollRect?.height ?? 0,
  );
  const pendingFocus = useRef<{ key: string; reveal: boolean } | null>(null);
  const focusRow = useCallback(
    (index: number, reveal = true) => {
      const task = rows[index];
      if (!task) return;
      pendingFocus.current = { key: task.key, reveal };
      setFocused(task.key);
      if (reveal) virtual.scrollToIndex(index);
    },
    [rows, virtual, setFocused],
  );
  const onScroll = (event: React.UIEvent<HTMLElement>) => {
    const container = event.currentTarget;
    const key = visibleEntry(
      container.scrollTop,
      virtual.scrollRect?.height ?? container.clientHeight,
    );
    let entry: HTMLElement | undefined;
    // Update only the at-most-60 mounted rows' tab stops when scrolling inside
    // one render block. Do not rerender the table on every scroll pixel.
    for (const row of container.querySelectorAll<HTMLElement>(
      "[data-task-key]",
    )) {
      const next = row.dataset.taskKey === key ? 0 : -1;
      if (row.tabIndex !== next) row.tabIndex = next;
      if (next === 0) entry = row;
    }
    const owner = focusOwner.current;
    if (entry && owner && document.activeElement === owner && owner !== entry) {
      // Only relocate focus that already belongs to an off-screen row. Pointer
      // scrolling must not snap back or steal focus from an input/filter.
      entry.focus({ preventScroll: true });
    }
  };
  const order = useMemo(() => rows.map((task) => task.key).join("\0"), [rows]);
  const previousOrder = useRef<string | null>(null);
  useLayoutEffect(() => {
    const changed = previousOrder.current !== order;
    previousOrder.current = order;
    const owner = focusOwner.current;
    if (
      !loading &&
      !pendingFocus.current &&
      owner &&
      ((!owner.isConnected && document.activeElement === document.body) ||
        (document.activeElement === owner &&
          owner.dataset.taskKey !== entryKey))
    ) {
      // Only recover focus that belonged to a removed row. An input/filter or
      // another live control keeps its focus; scrolling never forces an old row
      // back into view. Reordered data can still preserve the same task identity.
      const preserved = changed
        ? rows.findIndex((task) => task.key === focused)
        : -1;
      const fallback = rows.findIndex((task) => task.key === entryKey);
      if (preserved >= 0 || fallback >= 0)
        focusRow(preserved >= 0 ? preserved : fallback, preserved >= 0);
      else {
        scroll.current?.focus({ preventScroll: true });
        focusOwner.current = scroll.current;
      }
    }
    const target = pendingFocus.current;
    if (!target) return;
    const node = scroll.current?.querySelector<HTMLElement>(
      `[data-task-key="${CSS.escape(target.key)}"]`,
    );
    if (node) {
      pendingFocus.current = null;
      node.focus({ preventScroll: true });
      // The sticky 84px header must not cover an Arrow/Home/End destination.
      if (target.reveal)
        node.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "instant",
        });
    }
  });
  const openRef = useRef(open);
  openRef.current = open;
  const onClickRow = useCallback(
    (event: React.MouseEvent<HTMLTableSectionElement>) => {
      const key = rowAt(event.target);
      if (key) {
        setFocused(key);
        openRef.current(key);
      }
    },
    [setFocused],
  );
  const onFocusRow = useCallback(
    (event: React.FocusEvent<HTMLTableSectionElement>) => {
      const key = rowAt(event.target);
      if (key) {
        remembered.current = key;
        setFocused(key);
        focusOwner.current =
          event.target.closest<HTMLElement>("[data-task-key]");
      }
    },
    [setFocused, focusOwner],
  );
  const onKeyRow = useCallback(
    (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
      const key = rowAt(event.target);
      if (!key) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusRow(
          rows.findIndex((task) => task.key === key) +
            (event.key === "ArrowDown" ? 1 : -1),
        );
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusRow(event.key === "Home" ? 0 : rows.length - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        openRef.current(key);
      }
    },
    [rows, focusRow],
  );
  return (
    <section
      className="table-scroll"
      ref={scroll}
      data-testid="table-scroll"
      onScroll={onScroll}
      tabIndex={-1}
      aria-label="Task rows"
      aria-busy={loading || undefined}
    >
      <table
        className={`task-table ${estimatesEnabled ? "" : "no-estimates"}`}
        aria-label="Tasks"
        style={{ height: virtual.getTotalSize() + 84 }}
      >
        {header}
        <tbody
          style={{
            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
            height: virtualItems.length * 44,
          }}
          onClick={onClickRow}
          onFocus={onFocusRow}
          onBlur={(event) => {
            if (
              event.target.isConnected &&
              !event.currentTarget.contains(event.relatedTarget)
            )
              focusOwner.current = null;
          }}
          onKeyDown={onKeyRow}
        >
          {virtualItems.map((item) => {
            const task = rows[item.index];
            if (!task) return null;
            const person = people.get(task.assigneeId ?? "");
            const time = display.get(task.key);
            const glow = highlights[task.key];
            return (
              <TableRow
                key={task.key}
                task={task}
                estimatesEnabled={estimatesEnabled}
                hiddenByFilters={hiddenKeys.has(task.key)}
                assignee={person?.member}
                working={agentWorking(task, person?.member, workingNow)}
                initials={person?.initials ?? ""}
                highlightUntil={glow?.until ?? 0}
                highlightColor={glow?.color}
                selected={focused === task.key}
                tabStop={entryKey === task.key}
                timeLabel={time?.label ?? ""}
                exactTime={time?.exact ?? ""}
              />
            );
          })}
          <WorkingLayer
            rows={virtualItems.map((item) => {
              const task = rows[item.index];
              return {
                key: task?.key ?? String(item.index),
                state: task
                  ? agentWorking(
                      task,
                      people.get(task.assigneeId ?? "")?.member,
                      workingNow,
                    )
                  : null,
              };
            })}
          />
        </tbody>
      </table>
    </section>
  );
}
