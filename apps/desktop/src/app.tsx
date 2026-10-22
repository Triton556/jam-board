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
  Stamp,
  Tooltip,
} from "./components/ui";
import {
  LazyDrawerBoundary,
  LazyPageBoundary,
} from "./components/ui/LazyBoundary";
import { BoardHeader } from "./features/board/BoardHeader";
import { EpicFilters } from "./features/board/EpicFilters";
import { ProjectTiming } from "./features/onboarding/ProjectTiming";
import type { PlanSearch } from "./features/plan/PlanPage";
import { executionRequestsQuery } from "./lib/execution-queries";

const PlanPage = lazy(() =>
  import("./features/plan/PlanPage").then((m) => ({ default: m.PlanPage })),
);
const InboxPage = lazy(() =>
  import("./features/inbox/InboxPage").then((m) => ({ default: m.InboxPage })),
);
const StoryDrawer = lazy(() =>
  import("./features/plan/StoryDrawer").then((m) => ({
    default: m.StoryDrawer,
  })),
);

import { ReadinessDialog } from "./features/task/Readiness";
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
const ReferencesPage = lazy(() =>
  import("./features/references/ReferencesPage").then((m) => ({
    default: m.ReferencesPage,
  })),
);

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
const LazyTaskDrawer = lazy(() =>
  import("./features/task/TaskDrawer").then((m) => ({ default: m.TaskDrawer })),
);

function TaskDrawer(props: { taskKey: string; close(): void }) {
  return (
    <LazyDrawerBoundary title={props.taskKey} kind="task" close={props.close}>
      <LazyTaskDrawer {...props} />
    </LazyDrawerBoundary>
  );
}
const TeamPage = lazy(() =>
  import("./features/team/TeamPage").then((m) => ({ default: m.TeamPage })),
);

import { api } from "./lib/api";
import { FileDropSessionProvider } from "./lib/file-drop-batch";
import { preparePaperGrain } from "./lib/grain";
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
  const app = useQuery(appQuery);
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
  const shown = useRef(false);
  useEffect(() => {
    void preparePaperGrain();
    const timer = setInterval(
      () => useUiStore.getState().tick(Date.now()),
      100,
    );
    const stop = api.onBoardChanged((events) => {
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
  if (app.error)
    return (
      <main className="center-page">
        <EmptyState image={errorImage} text="The sketchbook couldn't open">
          <p role="alert">{app.error.message}</p>
          <Button onClick={() => void app.refetch()}>Try again</Button>
        </EmptyState>
      </main>
    );
  if (!app.data) return null;
  return (
    <AvatarMembersContext value={allMembers.data ?? []}>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Outlet />
      </Suspense>
      <Toasts />
      <ReadinessDialog />
    </AvatarMembersContext>
  );
}
function WhoAreYou() {
  const members = useQuery(membersQuery);
  const queryClient = useQueryClient();
  const select = useMutation({
    mutationFn: (id: string) => api.setCurrentMember(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app"] }),
  });
  const add = useMutation({
    mutationFn: (name: string) => api.addSelf(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app"] }),
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
            <Button key={m.id} onClick={() => select.mutate(m.id)}>
              <Avatar member={m} />
              {m.name}
            </Button>
          ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            add.mutate(String(data.get("name")));
          }}
        >
          <label>
            Your name
            <input name="name" required maxLength={40} />
          </label>
          <Button type="submit">Add myself</Button>
        </form>
        {(add.error || select.error) && (
          <p role="alert">{(add.error ?? select.error)?.message}</p>
        )}
      </div>
    </main>
  );
}
function Shell() {
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
    <div className={`app-shell ${expanded ? "expanded" : ""}`}>
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
            <label className="theme-control">
              <Sun size={18} />
              <select
                aria-label="Theme"
                value={app.data.theme}
                onChange={(e) => theme.mutate(e.target.value as Theme)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
              <Moon className="theme-moon" size={18} />
            </label>
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
          <IconButton label="New task · N" onClick={newTask}>
            <Plus size={17} />
          </IconButton>
          <button
            className="icon-button top-inbox"
            type="button"
            aria-label="Open inbox"
            onClick={() => void navigate({ to: "/inbox" })}
          >
            <Inbox size={18} />
            <InboxBadge count={questionCount} />
          </button>
          <CommandCenter
            newTask={newTask}
            toggleTheme={() =>
              theme.mutate(
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark",
              )
            }
          />
          <ProjectTiming
            template={app.data.jam?.template}
            endsAt={app.data.jam?.endsAt ?? null}
            milestoneAt={app.data.jam?.milestoneAt}
          />
          <div className="agent-stack">
            {board.data?.onlineAgents
              .filter(
                (agent) =>
                  now * 1000 - Date.parse(agent.lastSeenAt ?? "") < 120000,
              )
              .map((agent) => (
                <AgentStatus
                  key={agent.id}
                  member={agent}
                  pulse={!!pulse[agent.handle]}
                />
              ))}
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
function BoardRoute() {
  const search = boardRoute.useSearch();
  const navigate = useNavigate();
  const open = useCallback(
    (task: string) => {
      void navigate({ to: "/board", search: { ...search, task } });
    },
    [navigate, search],
  );
  const close = useCallback(() => {
    void navigate({ to: "/board", search: { ...search, task: undefined } });
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
      {search.task && <TaskDrawer taskKey={search.task} close={close} />}
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
              search: { ...search, task: undefined },
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
              search: { section: search.section, task: undefined },
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
  ): { task?: string; epics?: string } => ({
    epics:
      typeof search.epics === "string"
        ? search.epics
            .split(",")
            .filter((k) => /^[A-Za-z0-9]+-E[0-9]+$/.test(k))
            .join(",") || undefined
        : undefined,
    task: typeof search.task === "string" ? search.task : undefined,
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
      ): { task?: string; section?: string } => ({
        task: typeof search.task === "string" ? search.task : undefined,
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
  }) as PlanSearch;
  const navigate = useNavigate();
  const epicKey = pathname.split("/")[2];
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
        <PlanPage
          epicKey={epicKey}
          search={search}
          openTask={(task) => update({ task })}
          openStory={(story) => update({ story })}
        />
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
          close={() => update({ task: undefined })}
        />
      )}
    </>
  );
}
const planSearch = (raw: Record<string, unknown>): PlanSearch => ({
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
