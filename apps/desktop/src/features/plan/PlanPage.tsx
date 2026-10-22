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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import duo from "../../assets/chibi/duo-board-256.webp";
import type { EpicTree, StoryTree } from "../../bindings";
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  Select,
  Stamp,
} from "../../components/ui";
import {
  PaperSkeleton,
  QueryError,
  QueryRefreshNotice,
} from "../../components/ui/AsyncState";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { memberColors, WorkloadBar } from "../../components/ui/m5";
import { api } from "../../lib/api";
import { brainHandoff } from "../../lib/brain-handoff";
import {
  epicsQuery,
  invalidatePlanning,
  questionsQuery,
} from "../../lib/planning-queries";
import { membersQuery, tasksQuery } from "../../lib/queries";
import { statuses } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { ExecutionControls } from "../execution/ExecutionControls";
import { QuestionList } from "../inbox/InboxPage";
import { ReferencesSection } from "../references/ReferencesSection";
import { BrainHandoff, WorkflowGuide } from "./BrainHandoff";
import { Journal } from "./Journal";
import { epicProgress } from "./journal-model";
import { NewPlanningDialog } from "./NewPlanningDialog";
import {
  PlanningStatus,
  participationText,
  SavedMarkdown,
} from "./PlanningControls";
import { PlanningInput } from "./PlanningInput";
import { intentFields } from "./StoryDrawer";
import { TaskRows } from "./TaskRows";
export const brainPrompt = brainHandoff({ type: "project" });
const overviewFields = [
  ["goalMd", "Goal and audience", "Who is this for, and what should change?"],
  ["doneWhenMd", "Done when", "What will you look at to call it done?"],
  ["notIncludedMd", "Not included", "What should stay outside this epic?"],
  ["decidedMd", "Decided", "Keep the decisions we have already agreed on."],
  ["openQuestionsMd", "Open questions", "What do we still need to decide?"],
] as const;
export type PlanSearch = {
  tab?: string;
  story?: string;
  task?: string;
  create?: string;
};
export function PlanPage({
  epicKey,
  search,
  openTask,
  openStory,
}: {
  epicKey?: string;
  search: PlanSearch;
  openTask(key: string): void;
  openStory(key: string): void;
}) {
  const epics = useQuery(epicsQuery),
    tasks = useQuery(tasksQuery),
    members = useQuery(membersQuery),
    questions = useQuery(questionsQuery);
  const navigate = useNavigate();
  const [filter, setFilter] = useState("active"),
    [creating, setCreating] = useState(false);
  const selected = useQuery({
    queryKey: ["epic", epicKey],
    queryFn: () => api.getEpic(epicKey ?? ""),
    enabled: !!epicKey,
  });
  const rail = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const choose = useCallback(
    (key: string) =>
      void navigate({
        to: "/plan/$epicKey",
        params: { epicKey: key },
        search: {},
      }),
    [navigate],
  );
  useEffect(() => {
    if (!epicKey && epics.data?.length && pathname === "/plan")
      choose(
        (epics.data.find((e) => e.status === "active") ?? epics.data[0])?.key ??
          "",
      );
  }, [epicKey, epics.data, choose, pathname]);
  useEffect(() => {
    if (search.create === "epic") setCreating(true);
  }, [search.create]);
  const visible = (epics.data ?? []).filter(
    (e) => filter === "all" || e.status === filter || e.key === epicKey,
  );
  if (epics.isPending)
    return (
      <main className="feature-page">
        <PaperSkeleton label="Loading plan" />
      </main>
    );
  if (epics.error && !epics.data)
    return (
      <main className="feature-page">
        <QueryError error={epics.error} retry={() => void epics.refetch()} />
      </main>
    );
  return (
    <main className="plan-page">
      <aside className="epic-rail">
        <div className="epic-rail-heading">
          <h1>Plan</h1>
          <Button
            aria-label="New epic"
            variant="primary"
            onClick={() => setCreating(true)}
          >
            <Plus size={15} />
            <span>New epic</span>
          </Button>
        </div>
        <div className="epic-filter">
          <span className="small muted">Show epics</span>
          <Select
            aria-label="Epic filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["active", "draft", "done", "all"].map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegated arrow navigation keeps epic buttons as the actual focus targets. */}
        <div
          className="epic-list"
          ref={rail}
          onKeyDown={(e) => {
            const nodes = Array.from(
                rail.current?.querySelectorAll<HTMLButtonElement>(
                  ".epic-card",
                ) ?? [],
              ),
              index = nodes.indexOf(
                document.activeElement as HTMLButtonElement,
              );
            if (["ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              nodes[
                (index + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) %
                  nodes.length
              ]?.focus();
            }
          }}
        >
          {visible.map((e) => {
            const rows = Object.values(tasks.data ?? {})
              .flat()
              .filter((t) => t.epicId === e.id);
            const progress = epicProgress(rows),
              brain = members.data?.find((m) => m.id === e.brainMemberId),
              count =
                questions.data?.filter(
                  (q) =>
                    q.status === "open" &&
                    q.scopeType === "epic" &&
                    q.scopeId === e.id,
                ).length ?? 0;
            return (
              <button
                type="button"
                key={e.key}
                className={`epic-card ${e.key === epicKey ? "selected" : ""}`}
                aria-label={`Open epic ${e.key}: ${e.title}`}
                title={`${e.key} · ${e.title}`}
                style={
                  { "--epic-color": `var(--${e.color})` } as React.CSSProperties
                }
                onClick={() => choose(e.key)}
              >
                <span
                  className="epic-color-dot"
                  style={{ background: `var(--${e.color})` }}
                />
                <div className="epic-card-content">
                  <span className="mono muted small">{e.key}</span>
                  <h2>{e.title}</h2>
                  <Stamp>{e.status}</Stamp>
                  <WorkloadBar
                    counts={Object.fromEntries(
                      statuses.map((s) => [
                        s,
                        rows.filter((t) => t.status === s).length,
                      ]),
                    )}
                  />
                  <p className="small muted">
                    {progress.done} / {progress.total}{" "}
                    {progress.total === 1 ? "task" : "tasks"} done
                  </p>
                  <div className="epic-card-meta">
                    {brain && (
                      <span title={`Brain: ${brain.name}`}>
                        <Avatar member={brain} size={24} />
                      </span>
                    )}
                    {e.workerModel && (
                      <code className="model-chip">{e.workerModel}</code>
                    )}
                    {count > 0 && (
                      <span className="small">
                        {count} {count === 1 ? "question" : "questions"}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <div className="plan-detail">
        {epics.error && (
          <QueryRefreshNotice
            error={epics.error}
            resource="epics"
            busy={epics.isFetching}
            retry={() => void epics.refetch()}
          />
        )}
        {selected.error && selected.data && (
          <QueryRefreshNotice
            error={selected.error}
            resource={`epic ${selected.data.epic.key}`}
            busy={selected.isFetching}
            retry={() => void selected.refetch()}
          />
        )}
        <WorkflowGuide />
        {!epics.data?.length ? (
          <EmptyState image={duo} size={180} text="No epics yet">
            <p>
              Start with a goal. Add stories for its features or outcomes, then
              tasks for the work.
            </p>
            <div className="button-row">
              <Button variant="primary" onClick={() => setCreating(true)}>
                New epic
              </Button>
              <BrainHandoff
                scope={{ type: "project" }}
                label="Plan with brain"
              />
            </div>
          </EmptyState>
        ) : selected.isPending ? (
          <PaperSkeleton label="Loading epic" />
        ) : selected.error && !selected.data ? (
          <QueryError
            error={selected.error}
            retry={() => void selected.refetch()}
          />
        ) : selected.data ? (
          <EpicDetail
            tree={selected.data}
            tab={search.tab ?? "Overview"}
            setTab={(tab) =>
              void navigate({
                to: "/plan/$epicKey",
                params: { epicKey: selected.data.epic.key },
                search: { ...search, tab },
              })
            }
            openTask={openTask}
            openStory={openStory}
            createStory={search.create === "story"}
          />
        ) : null}
      </div>
      {creating && (
        <NewPlanningDialog
          target={{ kind: "epic" }}
          close={() => setCreating(false)}
          created={(key) => {
            setFilter("all");
            choose(key);
          }}
        />
      )}
    </main>
  );
}
function EpicDetail({
  tree,
  tab,
  setTab,
  openTask,
  openStory,
  createStory,
}: {
  tree: EpicTree;
  tab: string;
  setTab(tab: string): void;
  openTask(key: string): void;
  openStory(key: string): void;
  createStory: boolean;
}) {
  const e = tree.epic;
  const taskCount = tree.stories.reduce(
    (total, row) => total + row.tasks.length,
    0,
  );
  const members = useQuery(membersQuery),
    epics = useQuery(epicsQuery);
  const client = useQueryClient();
  const [menu, setMenu] = useState(false),
    [newStory, setNewStory] = useState(createStory),
    [taskStory, setTaskStory] = useState<string | null>(null);
  useEffect(() => {
    if (createStory) setNewStory(true);
  }, [createStory]);
  const patch = useMutation({
    mutationFn: (input: Parameters<typeof api.updateEpic>[1]) =>
      api.updateEpic(e.key, input),
    onSuccess: () => invalidatePlanning(client),
  });
  const brain = useMutation({
    mutationFn: (handle: string | null) => api.setBrain(e.key, handle),
    onSuccess: () => invalidatePlanning(client),
  });
  const archived = e.status === "archived";
  return (
    <>
      <header className="epic-detail-heading">
        <div className="section-heading">
          <span className="mono muted">{e.key}</span>
          <span className="muted small">
            {
              tree.openQuestions.filter(
                (q) => q.scopeType === "epic" && q.scopeId === e.id,
              ).length
            }{" "}
            open questions
          </span>
          <IconButton label="Epic menu" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={18} />
          </IconButton>
        </div>
        <PlanningInput
          key={`${e.id}:title`}
          label="Epic title"
          identity={`${e.id}:title`}
          className="planning-title"
          value={e.title}
          disabled={archived}
          maxLength={140}
          save={(title) => api.updateEpic(e.key, { title })}
        />
        <div className="epic-header-controls">
          <PlanningStatus level="Epic" entityKey={e.key} value={e.status} />
          <fieldset className="epic-swatches" aria-label="Epic color">
            {memberColors.map((color, i) => (
              <button
                type="button"
                key={color}
                aria-label={`Epic color ${i + 1}`}
                aria-pressed={e.color === `m${i + 1}`}
                disabled={archived}
                style={{ background: color }}
                onClick={() => patch.mutate({ color: `m${i + 1}` })}
              />
            ))}
          </fieldset>
          <div className="epic-brain-control">
            <span className="small muted">Brain</span>
            <CustomSelect
              label="Epic brain"
              value={
                members.data?.find((m) => m.id === e.brainMemberId)?.handle ??
                ""
              }
              onChange={(value) => brain.mutate(value || null)}
              disabled={archived}
              options={[
                { value: "", label: "Unassigned" },
                ...(members.data ?? [])
                  .slice()
                  .sort((a, b) =>
                    a.kind === b.kind ? 0 : a.kind === "agent" ? -1 : 1,
                  )
                  .map((m) => ({
                    value: m.handle,
                    label:
                      m.kind === "agent"
                        ? m.name
                        : `${m.name} (brain must be an agent)`,
                    disabled: m.kind !== "agent",
                    group: m.kind === "agent" ? "Agents" : "Humans",
                  })),
              ]}
            />
          </div>
          <BrainHandoff
            scope={{ type: "epic", key: e.key }}
            disabled={archived}
          />
        </div>
        <nav className="scope-hierarchy" aria-label="Epic hierarchy">
          <span>
            Epic <strong>{e.key}</strong>
          </span>
          <span aria-hidden="true">→</span>
          <Button onClick={() => setTab("Stories")}>
            {tree.stories.length}{" "}
            {tree.stories.length === 1 ? "story" : "stories"} · features &
            outcomes
          </Button>
          <span aria-hidden="true">→</span>
          <span>
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
          </span>
        </nav>
        <ExecutionControls
          key={`execution:${e.id}`}
          scope={{ type: "epic", id: e.id }}
        />
        {menu && (
          <div className="button-row">
            <Button
              onClick={() =>
                void api
                  .setEpicStatus(e.key, "archived")
                  .then(() => invalidatePlanning(client))
                  .catch((err) => useUiStore.getState().error(String(err)))
              }
            >
              Archive
            </Button>
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(`jam://epic/${e.key}`)
              }
            >
              Copy MCP reference
            </Button>
          </div>
        )}
        {(patch.error || brain.error) && (
          <p role="alert">{(patch.error ?? brain.error)?.message}</p>
        )}
      </header>
      <SegmentedControl
        label="Epic tabs"
        value={tab}
        onChange={setTab}
        options={["Overview", "Stories", "Journal", "Questions"].map(
          (value) => ({ value, label: value }),
        )}
      />
      <div className="epic-tab-content">
        {tab === "Overview" ? (
          <div className="epic-overview">
            <div>
              {overviewFields.map(([field, label, hint]) => (
                <SavedMarkdown
                  key={`${e.id}:${field}`}
                  label={label}
                  value={e[field]}
                  hint={hint}
                  disabled={archived}
                  save={(value) => api.updateEpic(e.key, { [field]: value })}
                />
              ))}
              <ReferencesSection
                targetKey={e.key}
                epicKey={e.key}
                disabled={archived}
              />
            </div>
            <aside className="epic-process">
              <div className="epic-process-choice">
                <label htmlFor="participation">Participation</label>
                <Select
                  id="participation"
                  aria-label="Participation"
                  value={e.participation}
                  disabled={archived}
                  onChange={(v) =>
                    patch.mutate({ participation: v.target.value })
                  }
                >
                  {Object.keys(participationText).map((v) => (
                    <option key={v} value={v}>
                      {v.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
                <small>
                  {
                    participationText[
                      e.participation as keyof typeof participationText
                    ]
                  }
                </small>
              </div>
              <div className="epic-process-choice">
                <label htmlFor="separate-reviewer">Separate reviewer</label>
                <Select
                  id="separate-reviewer"
                  aria-label="Separate reviewer"
                  value={e.reviewer}
                  disabled={archived}
                  onChange={(v) => patch.mutate({ reviewer: v.target.value })}
                >
                  {["none", "final", "stages"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="field">
                Worker model
                <PlanningInput
                  key={`${e.id}:workerModel`}
                  label="Worker model"
                  identity={`${e.id}:workerModel`}
                  list="worker-models"
                  value={e.workerModel ?? ""}
                  disabled={archived}
                  save={(workerModel) =>
                    api.updateEpic(e.key, { workerModel: workerModel || null })
                  }
                />
                <datalist id="worker-models">
                  {[
                    ...new Set(
                      epics.data?.flatMap((e) =>
                        e.workerModel ? [e.workerModel] : [],
                      ) ?? [],
                    ),
                  ].map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </div>
            </aside>
          </div>
        ) : tab === "Stories" ? (
          <>
            <p className="muted">
              A story describes a feature or outcome. Its tasks carry the
              implementation briefs.
            </p>
            <div className="section-heading">
              <h2>Stories</h2>
              <Button
                variant="primary"
                className="planning-add-button"
                onClick={() => setNewStory(true)}
                disabled={archived}
              >
                <Plus size={15} />
                New story
              </Button>
            </div>
            <Stories
              rows={tree.stories}
              openStory={openStory}
              openTask={openTask}
              addTask={setTaskStory}
            />
          </>
        ) : tab === "Journal" ? (
          <Journal epicKey={e.key} openTask={openTask} />
        ) : (
          <QuestionList epicId={e.id} />
        )}
      </div>
      {newStory && (
        <NewPlanningDialog
          target={{ kind: "story", epicKey: e.key }}
          close={() => setNewStory(false)}
          created={openStory}
        />
      )}
      {taskStory && (
        <NewPlanningDialog
          target={{ kind: "task", storyKey: taskStory }}
          close={() => setTaskStory(null)}
          created={openTask}
        />
      )}
    </>
  );
}
function Stories({
  rows,
  openStory,
  openTask,
  addTask,
}: {
  rows: StoryTree[];
  openStory(key: string): void;
  openTask(key: string): void;
  addTask(key: string): void;
}) {
  const client = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const order = [...rows];
    const [item] = order.splice(from, 1);
    if (item) {
      order.splice(Math.min(to, order.length), 0, item);
      void api
        .reorderStory(item.story.key, order[to + 1]?.story.key)
        .then(() => invalidatePlanning(client))
        .catch((e) => useUiStore.getState().error(String(e)));
    }
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over)
          move(
            rows.findIndex((r) => r.story.key === active.id),
            rows.findIndex((r) => r.story.key === over.id),
          );
      }}
    >
      <SortableContext
        items={rows.map((r) => r.story.key)}
        strategy={verticalListSortingStrategy}
      >
        {!rows.length && (
          <EmptyState text="One outcome at a time — add a story" />
        )}
        {rows.map((row, index) => (
          <StoryCard
            key={row.story.key}
            row={row}
            index={index}
            move={move}
            openStory={openStory}
            openTask={openTask}
            addTask={addTask}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
function StoryCard({
  row,
  index,
  move,
  openStory,
  openTask,
  addTask,
}: {
  row: StoryTree;
  index: number;
  move(from: number, to: number): void;
  openStory(key: string): void;
  openTask(key: string): void;
  addTask(key: string): void;
}) {
  const s = row.story,
    sortable = useSortable({ id: s.key }),
    questions = useQuery(questionsQuery);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegates Alt+arrows from the story controls.
    <section
      ref={sortable.setNodeRef}
      className="story-card"
      style={{
        transform: sortable.transform
          ? `translateY(${sortable.transform.y}px)`
          : undefined,
      }}
      onKeyDown={(e) => {
        if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          move(index, index + (e.key === "ArrowUp" ? -1 : 1));
        }
      }}
    >
      <header>
        <button
          type="button"
          className="icon-button"
          aria-label={`Reorder ${s.key}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={16} />
        </button>
        <Button
          variant="ghost"
          className="story-open"
          onClick={() => openStory(s.key)}
        >
          <span className="mono">{s.key}</span>
          <b>{s.title}</b>
        </Button>
        <Stamp>{s.status}</Stamp>
        {questions.data?.some(
          (q) =>
            q.status === "open" &&
            q.scopeType === "story" &&
            q.scopeId === s.id,
        ) && <Stamp className="needs-info">Needs info</Stamp>}
        <Button onClick={() => addTask(s.key)}>+ Task</Button>
      </header>
      <div className="story-completeness">
        <span
          className="intent-dots"
          role="img"
          aria-label="Intent card completeness"
        >
          {intentFields.map(([key, label]) => (
            <i
              key={key}
              title={label}
              className={s[key].trim() ? "complete" : ""}
            />
          ))}
        </span>
        <span className="muted small">
          {s.acceptance.filter((a) => a.mandatory).length} of{" "}
          {s.acceptance.length} criteria mandatory
        </span>
      </div>
      <TaskRows rows={row.tasks} openTask={openTask} />
    </section>
  );
}
