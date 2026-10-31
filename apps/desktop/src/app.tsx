import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CatchBoundary,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  ArrowLeftToLine,
  ArrowRightToLine,
  Bell,
  Boxes,
  ChevronDown,
  Images,
  Inbox,
  LayoutDashboard,
  ListTree,
  Moon,
  Plus,
  Settings,
  Sun,
  Table2,
  Users,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import hello from "./assets/chibi/duo-hello-256.webp";
import errorImage from "./assets/chibi/wife-paint-256.webp";
import {
  Avatar,
  AvatarMembersContext,
  Button,
  EmptyState,
  IconButton,
  type ModalFocusReturn,
  Stamp,
  Tooltip,
} from "./components/ui";
import { CustomSelect } from "./components/ui/CustomSelect";
import { scheduleIdle } from "./components/ui/idle";
import {
  LazyDrawerBoundary,
  LazyPageBoundary,
} from "./components/ui/LazyBoundary";
import { BoardHeader } from "./features/board/BoardHeader";
import { EpicFilters } from "./features/board/EpicFilters";
import { TopbarActions } from "./features/board/TopbarActions";
import { useBoardReturnFocus } from "./features/board/use-board-return-focus";
import {
  BrainButton,
  BrainDock,
  BrainDockController,
  useDockLayout,
} from "./features/brain/BrainDockShell";
import { createBrainSurface } from "./features/brain/BrainLazy";
import { ProjectTiming } from "./features/onboarding/ProjectTiming";
import type { PlanSearch } from "./features/plan/PlanPage";
import {
  LazyReadinessDialog,
  loadReadinessDialog,
} from "./features/task/LazyReadinessDialog";
import { TaskTitlePreview } from "./features/task/TaskTitle";
import {
  taskPresentation,
  taskViewSearch,
} from "./features/task/task-view-route";
import { executionRequestsQuery } from "./lib/execution-queries";
import { useMemberPresenceRefresh } from "./lib/use-member-presence-refresh";

const NotificationBell = createBrainSurface<{
  projectId: string;
  projectName: string;
  memberId: string;
}>(
  () =>
    import("./features/notifications/NotificationBell").then((module) => ({
      default: (props) => (
        <Tooltip text="Project notifications">
          <module.NotificationBell {...props} />
        </Tooltip>
      ),
    })),
  "project notifications",
  (_props, retry) => (
    <IconButton
      label={
        retry ? "Retry project notifications" : "Loading project notifications…"
      }
      disabled={!retry}
      onClick={retry}
    >
      <Bell size={18} />
    </IconButton>
  ),
);

const loadPlanPage = () =>
  import("./features/plan/PlanPage").then((m) => ({ default: m.PlanPage }));
const PlanPage = lazy(loadPlanPage);
const InboxPage = lazy(() =>
  import("./features/inbox/InboxPage").then((m) => ({ default: m.InboxPage })),
);
const StoryDrawer = lazy(() =>
  import("./features/plan/StoryDrawer").then((m) => ({
    default: m.StoryDrawer,
  })),
);

import { AgentStatus, InboxBadge } from "./features/team/AgentStatus";
import { questionsQuery } from "./lib/planning-queries";

const ActivityPage = lazy(() =>
  import("./features/activity/ActivityPage").then((m) => ({
    default: m.ActivityPage,
  })),
);
const AssetsPage = lazy(() =>
  import("./features/assets/AssetsPage").then((m) => ({
    default: m.AssetsPage,
  })),
);
const loadReferencesPage = () =>
  import("./features/references/ReferencesPage").then((m) => ({
    default: m.ReferencesPage,
  }));
const ReferencesPage = lazy(loadReferencesPage);

import { Board } from "./features/board/Board";
import { CommandCenter } from "./features/command/CommandCenter";

const WelcomeModule = lazy(() =>
  import("./features/onboarding/Welcome").then((module) => ({
    default: module.Welcome,
  })),
);

function WelcomeLoadError() {
  return (
    <main className="loading">
      <h1>Could not open project setup</h1>
      <p role="alert">
        Reload the app to retry loading this screen, or open Projects. Unsaved
        fields on this screen will be lost on reload.
      </p>
      <div className="button-row">
        <Button onClick={() => window.location.reload()}>Reload app</Button>
        <Link to="/projects" className="button secondary">
          Open Projects
        </Link>
      </div>
    </main>
  );
}

function Welcome() {
  return (
    <CatchBoundary
      getResetKey={() => "welcome-module"}
      errorComponent={WelcomeLoadError}
    >
      <Suspense
        fallback={
          <main className="loading">
            <p role="status">Loading project setup…</p>
          </main>
        }
      >
        <WelcomeModule />
      </Suspense>
    </CatchBoundary>
  );
}

const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const ProjectsPage = lazy(() =>
  import("./features/projects/ProjectsPage").then((m) => ({
    default: m.ProjectsPage,
  })),
);

import { validateTableSearch } from "./features/table/search";

const TaskTable = lazy(() =>
  import("./features/table/TaskTable").then((m) => ({ default: m.TaskTable })),
);
const TaskDrawerSurface = lazy(() =>
  import("./features/task/TaskDrawer").then((m) => ({ default: m.TaskDrawer })),
);
function TaskDrawer(props: {
  taskKey: string;
  close(): void;
  returnFocus?: ModalFocusReturn;
}) {
  const search = useRouterState({
    select: (state) => state.location.search,
  }) as { taskView?: string };
  const navigate = useNavigate();
  return (
    <LazyDrawerBoundary
      title={props.taskKey}
      preview={<TaskTitlePreview taskKey={props.taskKey} />}
      kind="task"
      close={props.close}
      returnFocus={props.returnFocus}
    >
      <TaskDrawerSurface
        {...props}
        presentation={taskPresentation(search.taskView)}
        onPresentationChange={(presentation) =>
          void navigate({
            to: ".",
            search: (previous) => ({
              ...previous,
              taskView: taskViewSearch(presentation),
            }),
            replace: true,
            resetScroll: false,
            ignoreBlocker: true,
          })
        }
      />
    </LazyDrawerBoundary>
  );
}
const TeamPage = lazy(() =>
  import("./features/team/TeamPage").then((m) => ({ default: m.TeamPage })),
);

import { GlobalBoardRecovery } from "./features/projects/GlobalBoardRecovery";
import { api } from "./lib/api";
import { FileDropSessionProvider } from "./lib/file-drop-batch";
import { preparePaperGrain } from "./lib/grain";
import {
  acceptProjectSelection,
  matchingSelection,
  selectedContext,
  selectionIdentity,
} from "./lib/project-selection";
import { appQuery, boardQuery, membersQuery, tasksQuery } from "./lib/queries";
import { paperRustle } from "./lib/sound";
import type { Theme } from "./lib/types";
import { useUiStore } from "./lib/ui-store";
import { showReadyWindow } from "./lib/window-ready";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
const navigation = [
  { path: "/plan", name: "Plan", icon: ListTree },
  { path: "/board", name: "Board", icon: LayoutDashboard },
  { path: "/table", name: "Table", icon: Table2 },
  { path: "/inbox", name: "Inbox", icon: Inbox },
  { path: "/assets", name: "Assets", icon: Boxes },
  { path: "/references", name: "References", icon: Images },
  { path: "/team", name: "Team", icon: Users },
  { path: "/activity", name: "Activity", icon: Activity },
  { path: "/settings", name: "Settings", icon: Settings },
] as const;
function applyTheme(theme: string) {
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.style.colorScheme =
    document.documentElement.dataset.theme;
}
function Root() {
  useMemberPresenceRefresh();
  const app = useQuery(appQuery);
  useEffect(() => {
    if (!app.data?.hasJam) return;
    return scheduleIdle(() => {
      void Promise.allSettled([
        loadPlanPage(),
        loadReferencesPage(),
        loadReadinessDialog(),
        import("./components/ui/WorkingUnderline"),
        import("./components/ui/RoughLine"),
      ]);
    });
  }, [app.data?.hasJam]);
  const allMembers = useQuery({ ...membersQuery, enabled: !!app.data?.hasJam });
  const boardTasks = useQuery({ ...tasksQuery, enabled: !!app.data?.hasJam });
  useQuery({
    queryKey: ["runtime"],
    queryFn: () => api.runtimeInfo(),
    enabled: !!app.data?.hasJam,
  });
  const savedSettings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
  });
  useEffect(() => {
    if (savedSettings.data)
      useUiStore.setState({ soundEnabled: savedSettings.data.soundEnabled });
  }, [savedSettings.data]);
  const queryClient = useQueryClient();
  const scope = useQuery({
    queryKey: ["selection-scope"],
    queryFn: async () => selectedContext(queryClient) ?? null,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (
      app.data &&
      app.data.jam?.id !== selectedContext(queryClient)?.projectId
    )
      void acceptProjectSelection(queryClient, app.data).catch((error) =>
        useUiStore.getState().error(error.message),
      );
  }, [app.data, queryClient]);
  const shown = useRef(false);
  useEffect(() => {
    void preparePaperGrain();
    const timer = setInterval(
      () => useUiStore.getState().tick(Date.now()),
      100,
    );
    const stop = api.onBoardChanged((events, context) => {
      if (context && !matchingSelection(queryClient, context)) return;
      if (
        !context &&
        selectedContext(queryClient) &&
        !selectedContext(queryClient)?.instanceId.includes("legacy")
      )
        return;
      for (const event of events) {
        if (
          event.action.startsWith("jam.") ||
          event.action === "project.updated"
        )
          void queryClient.invalidateQueries({ queryKey: ["app"] });
        if (event.taskKey)
          void queryClient.invalidateQueries({
            queryKey: ["task", event.taskKey],
          });
        if (event.action === "member.joined")
          void queryClient.invalidateQueries({ queryKey: ["members"] });
      }
      for (const queryKey of [
        ["project"],
        ["projects"],
        ["boardTasks"],
        ["board"],
        ["activity"],
        ["tableTasks"],
        ["tags"],
        ["assets"],
        ["file-assets"],
        ["folder-info"],
        ["project-folder"],
        ["project-folders"],
        ["settings"],
        ["board-snapshot"],
        ["references"],
        ["members"],
        ["execution"],
        ["executionRequests"],
        ["epics"],
        ["epic"],
        ["stories"],
        ["story"],
        ["questions"],
        ["journal"],
        ["readiness"],
      ])
        void queryClient.invalidateQueries({ queryKey });
      useUiStore.getState().receive(events);
      if (
        useUiStore.getState().soundEnabled &&
        events.some(
          (e) => e.actor.kind === "agent" && e.action !== "agent.status",
        )
      )
        paperRustle();
    });
    const stopMcp = api.onMcpChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["mcpStatus"] });
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    });
    return () => {
      stopMcp();
      clearInterval(timer);
      stop();
    };
  }, [queryClient]);
  useEffect(() => {
    if (!app.data && !app.error) return;
    if (app.data?.hasJam && !boardTasks.data && !boardTasks.error) return;
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(app.data?.theme ?? "system");
    apply();
    document.documentElement.dataset.ready = "true";
    if (!shown.current && isTauri()) {
      shown.current = true;
      void showReadyWindow({
        fontsReady: document.fonts.ready,
        show: () => getCurrentWindow().show(),
        ready: () => api.appReady(),
      }).catch((error) => {
        useUiStore
          .getState()
          .error(`Could not finish opening the window: ${String(error)}`);
      });
    }
    scheme.addEventListener("change", apply);
    return () => scheme.removeEventListener("change", apply);
  }, [app.data, app.error, boardTasks.data, boardTasks.error]);
  if (app.error && !app.data)
    return (
      <main className="center-page">
        <EmptyState image={errorImage} text="The sketchbook couldn't open">
          <p role="alert">{app.error.message}</p>
          <Button onClick={() => void app.refetch()}>Try again</Button>
        </EmptyState>
      </main>
    );
  if (!app.data) return null;
  if (app.data.hasJam && scope.data?.projectId !== app.data.jam?.id)
    return (
      <main className="center-page" role="status">
        Loading project…
      </main>
    );
  return (
    <AvatarMembersContext value={allMembers.data ?? []}>
      <Suspense
        key={`${selectionIdentity(scope.data ?? undefined)}:${scope.data?.selectionEpoch}`}
        fallback={<p className="muted">Loading…</p>}
      >
        {app.data.hasJam && <GlobalBoardRecovery />}
        <Outlet />
      </Suspense>
      <Toasts />
      <LazyReadinessDialog />
    </AvatarMembersContext>
  );
}
export function WhoAreYou() {
  const members = useQuery(membersQuery);
  const queryClient = useQueryClient();
  const adding = useRef(false);
  const select = useMutation({
    mutationFn: (id: string) => api.setCurrentMember(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app"] }),
  });
  const add = useMutation({
    mutationFn: (name: string) => api.addSelf(name),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["app"] }),
        queryClient.invalidateQueries({ queryKey: ["members"] }),
      ]);
    },
    onError: () => {
      adding.current = false;
    },
  });
  return (
    <main className="center-page">
      <div className="identity">
        <img src={hello} width={160} height={160} alt="" />
        <h1>Who are you?</h1>
        <p className="muted">Choose your place at the table.</p>
        {members.data
          ?.filter((m) => m.kind === "human")
          .map((m) => (
            <Button
              key={m.id}
              disabled={add.isPending || add.isSuccess || select.isPending}
              onClick={() => select.mutate(m.id)}
            >
              <Avatar member={m} />
              {m.name}
            </Button>
          ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.current || select.isPending) return;
            const data = new FormData(e.currentTarget);
            const name = String(data.get("name") ?? "").trim();
            if (!name) return;
            adding.current = true;
            add.mutate(name);
          }}
        >
          <label>
            Your name
            <input
              name="name"
              required
              maxLength={40}
              disabled={add.isPending || add.isSuccess || select.isPending}
            />
          </label>
          <Button
            type="submit"
            disabled={add.isPending || add.isSuccess || select.isPending}
            aria-busy={add.isPending}
          >
            {add.isPending ? "Adding myself…" : "Add myself"}
          </Button>
        </form>
        {(add.error || select.error) && (
          <p role="alert">{(add.error ?? select.error)?.message}</p>
        )}
      </div>
    </main>
  );
}
function Shell() {
  const dock = useDockLayout();
  const app = useQuery(appQuery);
  const board = useQuery({ ...boardQuery, enabled: !!app.data?.hasJam });
  const expanded = useUiStore((s) => s.sidebarExpanded);
  const pulse = useUiStore((s) => s.agentPulse);
  const now = useUiStore((s) => Math.floor(s.now / 1000));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useRouterState({
    select: (state) => state.location.pathname,
  });
  const theme = useMutation({
    mutationFn: (value: Theme) => api.setTheme(value),
    onSuccess: (_, value) => {
      applyTheme(value);
      void queryClient.invalidateQueries({ queryKey: ["app"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => useUiStore.getState().error(error.message),
  });
  const questions = useQuery(questionsQuery);
  const startRequests = useQuery(executionRequestsQuery);
  const questionCount =
    (questions.data?.filter((q) => q.status === "open").length ?? 0) +
    (startRequests.data?.filter((request) => request.status === "pending")
      .length ?? 0);
  const newTask = useCallback(() => {
    if (location === "/table") {
      window.dispatchEvent(new Event("table-new-task"));
      return;
    }
    useUiStore.getState().setQuickColumn("backlog");
    void navigate({ to: "/board" });
  }, [navigate, location]);
  if (!app.data?.hasJam) return <Welcome />;
  if (!app.data.currentMember) return <WhoAreYou />;
  return (
    <div
      className={`app-shell ${expanded ? "expanded" : ""}`}
      style={dock.style}
    >
      {app.data.jam && (
        <BrainDockController
          key={app.data.jam.id}
          projectId={app.data.jam.id}
        />
      )}
      <aside className="sidebar">
        <Link to="/board" className="brand" aria-label="Jam Board">
          <span className="brand-mark">
            J<span>✦</span>
          </span>
          {expanded && <span>Jam Board</span>}
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map(({ path, name, icon: Icon }) => (
            <Tooltip key={path} text={name}>
              <Link
                to={path}
                className={`nav-link ${location === path || location.startsWith(`${path}/`) ? "selected" : ""}`}
                aria-label={name}
              >
                <Icon size={20} />
                <span className="nav-label">{name}</span>
                {name === "Inbox" && <InboxBadge count={questionCount} />}
              </Link>
            </Tooltip>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Tooltip text="Theme">
            <div className="theme-control">
              <Sun size={18} />
              <CustomSelect
                label="Theme"
                value={app.data.theme}
                disabled={theme.isPending}
                onChange={(value) => theme.mutate(value as Theme)}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
              <Moon className="theme-moon" size={18} />
            </div>
          </Tooltip>
          <IconButton
            label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => useUiStore.getState().toggleSidebar()}
          >
            {expanded ? <ArrowLeftToLine /> : <ArrowRightToLine />}
          </IconButton>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link
            to="/projects"
            className="project-switcher"
            aria-label={`Switch project · ${app.data.jam?.name}`}
            title={app.data.jam?.name}
          >
            <span className="project-switcher-label">
              <small>Switch project</small>
              <strong className="project-switcher-title">
                {app.data.jam?.name}
              </strong>
            </span>
            <ChevronDown size={16} />
          </Link>
          {board.data?.jam.theme && (
            <Stamp className="theme-stamp">{board.data.jam.theme}</Stamp>
          )}
          <div className="topbar-space" />
          <BrainButton />
          {app.data.jam && (
            <NotificationBell
              key={`${app.data.jam.id}:${app.data.currentMember.id}`}
              projectId={app.data.jam.id}
              projectName={app.data.jam.name}
              memberId={app.data.currentMember.id}
            />
          )}
          <CommandCenter
            newTask={newTask}
            toggleTheme={() =>
              theme.mutate(
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark",
              )
            }
            renderTrigger={(searchTrigger, openSearch) => (
              <TopbarActions
                newTask={newTask}
                openInbox={() => void navigate({ to: "/inbox" })}
                openSearch={openSearch}
                inboxCount={questionCount}
                agents={
                  board.data?.onlineAgents.filter(
                    (agent) =>
                      now * 1000 - Date.parse(agent.lastSeenAt ?? "") < 120000,
                  ) ?? []
                }
                pulse={pulse}
              >
                <IconButton label="New task · N" onClick={newTask}>
                  <Plus size={17} />
                </IconButton>
                <IconButton
                  className="icon-button top-inbox"
                  label="Open inbox"
                  onClick={() => void navigate({ to: "/inbox" })}
                >
                  <Inbox size={18} />
                  <InboxBadge count={questionCount} />
                </IconButton>
                {searchTrigger}
                <ProjectTiming
                  template={app.data.jam?.template}
                  endsAt={app.data.jam?.endsAt ?? null}
                  milestoneAt={app.data.jam?.milestoneAt}
                />
                <div className="agent-stack">
                  {board.data?.onlineAgents
                    .filter(
                      (agent) =>
                        now * 1000 - Date.parse(agent.lastSeenAt ?? "") <
                        120000,
                    )
                    .map((agent) => (
                      <AgentStatus
                        key={agent.id}
                        member={agent}
                        pulse={!!pulse[agent.handle]}
                      />
                    ))}
                </div>
              </TopbarActions>
            )}
          />
        </header>
        <div className="brain-workspace-layout">
          <div className="brain-routed-content">
            <Outlet />
          </div>
          {dock.open && <BrainDock overlay={dock.overlay} />}
        </div>
      </div>
    </div>
  );
}
function BoardRoute() {
  const search = boardRoute.useSearch();
  const returnFocus = useBoardReturnFocus(search.task);
  const navigate = useNavigate();
  const open = useCallback(
    (task: string) => {
      void navigate({ to: "/board", search: { ...search, task } });
    },
    [navigate, search],
  );
  const close = useCallback(() => {
    void navigate({
      to: "/board",
      search: { ...search, task: undefined, taskView: undefined },
    });
  }, [navigate, search]);
  return (
    <>
      <BoardHeader />
      <EpicFilters
        value={search.epics?.split(",") ?? []}
        onChange={(keys) =>
          void navigate({
            to: "/board",
            search: { ...search, epics: keys.join(",") || undefined },
          })
        }
      />
      <Board open={open} epicKeys={search.epics?.split(",") ?? []} />
      {search.task && (
        <TaskDrawer
          taskKey={search.task}
          close={close}
          returnFocus={returnFocus}
        />
      )}
    </>
  );
}
function TableRoute() {
  const search = tableRoute.useSearch();
  const navigate = useNavigate();
  return (
    <>
      <LazyPageBoundary label="Table">
        <TaskTable
          search={search}
          change={(value) => {
            void navigate({ to: "/table", search: value });
          }}
          open={(task) => {
            void navigate({ to: "/table", search: { ...search, task } });
          }}
        />
      </LazyPageBoundary>
      {search.task && (
        <TaskDrawer
          taskKey={search.task}
          close={() => {
            void navigate({
              to: "/table",
              search: { ...search, task: undefined, taskView: undefined },
            });
          }}
        />
      )}
    </>
  );
}
function FeatureRoute({ name }: { name: string }) {
  const navigate = useNavigate();
  const search = useRouterState({ select: (s) => s.location.search }) as {
    task?: string;
    section?: string;
  };
  const path = `/${name.toLowerCase()}` as
    | "/assets"
    | "/team"
    | "/activity"
    | "/settings"
    | "/inbox";

  const openTask = (task: string) =>
    void navigate({ to: path, search: { section: search.section, task } });
  return (
    <>
      <LazyPageBoundary label={name}>
        {name === "References" ? (
          <ReferencesPage />
        ) : name === "Inbox" ? (
          <InboxPage />
        ) : name === "Assets" ? (
          <AssetsPage openTask={openTask} />
        ) : name === "Team" ? (
          <TeamPage
            openTask={openTask}
            connect={() =>
              void navigate({
                to: "/settings",
                search: { section: "MCP", task: undefined },
              })
            }
          />
        ) : name === "Activity" ? (
          <ActivityPage openTask={openTask} />
        ) : (
          <SettingsPage initialSection={search.section} />
        )}
      </LazyPageBoundary>
      {search.task && (
        <TaskDrawer
          taskKey={search.task}
          close={() =>
            void navigate({
              to: path,
              search: {
                section: search.section,
                task: undefined,
                taskView: undefined,
              },
            })
          }
        />
      )}
    </>
  );
}
function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const navigate = useNavigate();
  const container = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <section
      ref={container}
      className="toast-stack"
      aria-label="Notifications"
      tabIndex={-1}
      onFocusCapture={(event) => {
        if (
          event.relatedTarget instanceof HTMLElement &&
          !container.current?.contains(event.relatedTarget)
        )
          previousFocus.current = event.relatedTarget;
      }}
    >
      {toasts.map((toast) => (
        // biome-ignore lint/a11y/useSemanticElements: Notifications contain no form fields; fieldset would imply a form.
        <div
          className="toast"
          role="group"
          key={toast.id}
          onMouseEnter={() => useUiStore.getState().pauseToast(toast.id, true)}
          onMouseLeave={() => useUiStore.getState().pauseToast(toast.id, false)}
          onFocus={() => useUiStore.getState().pauseToast(toast.id, true)}
          onBlur={() => useUiStore.getState().pauseToast(toast.id, false)}
        >
          {toast.actor && <Avatar member={toast.actor} size={32} />}
          <div className="toast-content">
            <span role="status" aria-live="polite">
              {toast.text}
            </span>
            {toast.details && (
              <details className="toast-details" aria-live="off">
                <summary>File details ({toast.details.length})</summary>
                {toast.hint && <p>{toast.hint}</p>}
                {toast.persistent && (
                  <p>
                    Kept in this app session only, among the latest three
                    notices.
                  </p>
                )}
                <ol>
                  {toast.details.map((detail) => (
                    <li key={detail.id}>
                      <strong>{detail.label}</strong>:{" "}
                      <code>{detail.text}</code>
                      {detail.note && <p>{detail.note}</p>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
          {toast.persistent && (
            <Button
              variant="ghost"
              data-dismiss-receipt={toast.id}
              onClick={() => {
                const next = Array.from(
                  container.current?.querySelectorAll<HTMLButtonElement>(
                    "[data-dismiss-receipt]",
                  ) ?? [],
                ).find((button) => button.dataset.dismissReceipt !== toast.id);
                useUiStore.getState().dismissToast(toast.id);
                (
                  next ??
                  (previousFocus.current?.isConnected
                    ? previousFocus.current
                    : document.querySelector<HTMLElement>(
                        ".project-switcher",
                      )) ??
                  container.current
                )?.focus();
              }}
            >
              Dismiss receipt
            </Button>
          )}
          {(toast.taskKey || toast.href) && (
            <Button
              variant="ghost"
              onClick={() =>
                toast.href
                  ? void navigate({ to: "/inbox" })
                  : void navigate({
                      to: "/board",
                      search: { task: toast.taskKey },
                    })
              }
            >
              View
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <main className="center-page">
      <EmptyState image={errorImage} size={160} text="This page wandered off">
        <Link to="/board">Back to the board</Link>
      </EmptyState>
    </main>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
    const app = await client.ensureQueryData(appQuery);
    throw redirect({ to: app.hasJam ? "/board" : "/welcome" });
  },
});
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  component: Welcome,
});
function ProjectsRoute() {
  return (
    <LazyPageBoundary label="Projects">
      <ProjectsPage />
    </LazyPageBoundary>
  );
}
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsRoute,
});
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Shell,
});
const boardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/board",
  validateSearch: (
    search: Record<string, unknown>,
  ): { task?: string; taskView?: "modal"; epics?: string } => ({
    epics:
      typeof search.epics === "string"
        ? search.epics
            .split(",")
            .filter((k) => /^[A-Za-z0-9]+-E[0-9]+$/.test(k))
            .join(",") || undefined
        : undefined,
    task: typeof search.task === "string" ? search.task : undefined,
    taskView: taskViewSearch(search.taskView),
  }),
  component: BoardRoute,
});
const placeholders = navigation
  .filter(
    (item) =>
      item.path !== "/board" && item.path !== "/table" && item.path !== "/plan",
  )
  .map((item) =>
    createRoute({
      getParentRoute: () => shellRoute,
      path: item.path,
      validateSearch: (
        search: Record<string, unknown>,
      ): {
        task?: string;
        taskView?: "modal";
        section?: string;
        question?: string;
        status?: string;
      } => ({
        question:
          typeof search.question === "string" ? search.question : undefined,
        status: typeof search.status === "string" ? search.status : undefined,
        task: typeof search.task === "string" ? search.task : undefined,
        taskView: taskViewSearch(search.taskView),
        section:
          typeof search.section === "string" ? search.section : undefined,
      }),
      component: () => <FeatureRoute name={item.name} />,
    }),
  );
function PlanRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({
    select: (s) => s.location.search,
  }) as PlanSearch & { taskView?: "modal" };
  const navigate = useNavigate();
  const epicKey = pathname.split("/")[2];
  // Root Plan normally selects its first epic and clears search. A task deep link
  // supplies its own epic so that background selection cannot dismiss the task.
  const taskBackground = useQuery({
    queryKey: ["task", search.task],
    queryFn: () => api.getTask(search.task ?? ""),
    enabled: !epicKey && !!search.task,
  });
  const backgroundEpic =
    epicKey ?? (search.task ? taskBackground.data?.epic.key : undefined);
  const update = (patch: PlanSearch) => {
    void navigate({
      to: epicKey ? "/plan/$epicKey" : "/plan",
      params: { epicKey: epicKey ?? "" },
      search: { ...search, ...patch },
    });
  };
  return (
    <>
      <LazyPageBoundary label="Plan">
        {!epicKey && search.task && !backgroundEpic ? (
          <main className="feature-page">
            <h1>Plan</h1>
          </main>
        ) : (
          <PlanPage
            epicKey={backgroundEpic}
            search={search}
            openTask={(task) => update({ task })}
            openStory={(story) => update({ story })}
          />
        )}
      </LazyPageBoundary>
      {search.story && (
        <LazyDrawerBoundary
          title={search.story}
          kind="story"
          close={() => update({ story: undefined })}
        >
          <StoryDrawer
            storyKey={search.story}
            close={() => update({ story: undefined })}
            openTask={(task) => update({ task })}
          />
        </LazyDrawerBoundary>
      )}{" "}
      {search.task && (
        <TaskDrawer
          taskKey={search.task}
          close={() => {
            void navigate({
              to: epicKey ? "/plan/$epicKey" : "/plan",
              params: { epicKey: epicKey ?? "" },
              search: { ...search, task: undefined, taskView: undefined },
            });
          }}
        />
      )}
    </>
  );
}
const planSearch = (
  raw: Record<string, unknown>,
): PlanSearch & { taskView?: "modal" } => ({
  taskView: taskViewSearch(raw.taskView),
  tab:
    typeof raw.tab === "string" &&
    ["Overview", "Stories", "Journal", "Questions"].includes(raw.tab)
      ? raw.tab
      : undefined,
  story: typeof raw.story === "string" ? raw.story : undefined,
  task: typeof raw.task === "string" ? raw.task : undefined,
  create: typeof raw.create === "string" ? raw.create : undefined,
});
const planRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/plan",
  validateSearch: planSearch,
  component: PlanRoute,
});
const epicRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/plan/$epicKey",
  validateSearch: planSearch,
  component: PlanRoute,
});
const tableRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/table",
  validateSearch: validateTableSearch,
  component: TableRoute,
});
export const router = createRouter({
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search) => {
    const params = new URLSearchParams(
      Object.entries(search)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    );
    const value = params.toString();
    return value ? `?${value}` : "";
  },
  routeTree: rootRoute.addChildren([
    indexRoute,
    welcomeRoute,
    projectsRoute,
    shellRoute.addChildren([
      planRoute,
      epicRoute,
      boardRoute,
      tableRoute,
      ...placeholders,
    ]),
  ]),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
export function App() {
  return (
    <QueryClientProvider client={client}>
      <FileDropSessionProvider>
        <RouterProvider router={router} />
      </FileDropSessionProvider>
    </QueryClientProvider>
  );
}
