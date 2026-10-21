import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
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
import type { Member, TaskSummary } from "../../lib/types";
import { labels, statuses } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { StoryPicker } from "../plan/PlanningControls";
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
const focusNewInput = (node: HTMLInputElement | null) => {
  node?.focus();
};

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
  const [newStory, setNewStory] = useState(() => {
    try {
      return localStorage.getItem("jam.lastStory") ?? "";
    } catch {
      return "";
    }
  });
  const validStory = !!stories.data?.some((s) => s.key === newStory);
  const estimatesEnabled = settings?.estimatesEnabled ?? false;
  const query = tableQuery(search);
  if (!estimatesEnabled && query.sort?.field === "estimate")
    query.sort = undefined;
  const client = useQueryClient();
  const [creating, setCreating] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [newStatus, setNewStatus] = useState("backlog"),
    [newPriority, setNewPriority] = useState("medium");
  const [pinned, setPinned] = useState<TaskSummary[]>([]);
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
    const handler = () => setCreating(true);
    window.addEventListener("table-new-task", handler);
    return () => window.removeEventListener("table-new-task", handler);
  }, []);
  const create = useMutation({
    mutationFn: () =>
      api.createTask({
        title: newTitle.trim(),
        storyKey: newStory,
        status: newStatus as "backlog",
        priority: newPriority,
      }),
    onSuccess: (task) => {
      setPinned((p) => [task, ...p]);
      setNewTitle("");
      setCreating(false);
      useUiStore.setState((s) => ({
        highlights: {
          ...s.highlights,
          [task.key]: {
            color: "var(--coral)",
            until: Date.now() + 2000,
            action: "task.created",
          },
        },
      }));
      void client.invalidateQueries({ queryKey: ["tableTasks"] });
      void client.invalidateQueries({ queryKey: ["boardTasks"] });
      document.querySelector(".table-scroll")?.scrollTo({ top: 0 });
    },
    onError: (e) => useUiStore.getState().error(e.message),
  });
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
    <main className="table-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">A LITTLE ORDER FOR BIG IDEAS</span>
          <h1>Task table</h1>
        </div>
        <div className="button-row">
          <span className="muted task-count">
            {tasks.data?.total ?? 0} tasks
          </span>
          <NewTaskButton onClick={() => setCreating(true)} />
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
      {tasks.error ? (
        <p role="alert">{tasks.error.message}</p>
      ) : tasks.isPending ? (
        <p className="loading">Opening the task list…</p>
      ) : (
        <VirtualTaskTable
          rows={rows}
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
                    const [sorted, dir] = (
                      search.sort ?? "updatedAt:desc"
                    ).split(":");
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
                  {creating ? (
                    // biome-ignore lint/a11y/noStaticElementInteractions: Enter/Escape are delegated from the inline creation controls.
                    <div
                      className="inline-task-form"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setCreating(false);
                          setNewTitle("");
                        }
                        if (
                          e.key === "Enter" &&
                          !(e.target as HTMLElement).closest(
                            '[role="combobox"],.custom-select',
                          )
                        ) {
                          e.preventDefault();
                          if (
                            newTitle.trim() &&
                            validStory &&
                            !create.isPending
                          )
                            create.mutate();
                        }
                      }}
                    >
                      <input
                        ref={focusNewInput}
                        aria-label="New task title"
                        placeholder="What needs making?"
                        maxLength={140}
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                      />
                      <StoryPicker
                        label="New task story"
                        value={newStory}
                        onChange={setNewStory}
                        remember
                      />
                      <Select
                        aria-label="New task status"
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value)}
                      >
                        {statuses.map((s) => (
                          <option key={s} value={s}>
                            {labels[s]}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label="New task priority"
                        value={newPriority}
                        onChange={(e) => setNewPriority(e.target.value)}
                      >
                        {["low", "medium", "high", "critical"].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Select>
                      <Button
                        disabled={
                          !newTitle.trim() || !validStory || create.isPending
                        }
                        onClick={() => create.mutate()}
                      >
                        Create
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-create-trigger"
                      onClick={() => setCreating(true)}
                    >
                      + New task
                    </button>
                  )}
                </td>
              </tr>
            </thead>
          }
        />
      )}
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
  members,
  highlights,
  open,
  header,
  estimatesEnabled,
  hiddenKeys,
}: {
  rows: TaskSummary[];
  members: Member[];
  highlights: Record<string, Highlight>;
  open(key: string): void;
  header: ReactNode;
  estimatesEnabled: boolean;
  hiddenKeys: Set<string>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
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
  const focusRow = useCallback(
    (index: number) => {
      const task = rows[index];
      if (!task) return;
      setFocused(task.key);
      virtual.scrollToIndex(index);
      requestAnimationFrame(() =>
        scroll.current
          ?.querySelector<HTMLElement>(`[data-task-key="${task.key}"]`)
          ?.focus(),
      );
    },
    [rows, virtual],
  );
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
    [],
  );
  const onFocusRow = useCallback(
    (event: React.FocusEvent<HTMLTableSectionElement>) => {
      const key = rowAt(event.target);
      if (key) setFocused(key);
    },
    [],
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
      } else if (event.key === "Enter") {
        event.preventDefault();
        openRef.current(key);
      }
    },
    [rows, focusRow],
  );
  return (
    <div className="table-scroll" ref={scroll} data-testid="table-scroll">
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
                tabStop={focused === task.key || (!focused && item.index === 0)}
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
    </div>
  );
}
