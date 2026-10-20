import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
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
  LayoutDashboard,
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
  Kbd,
  SegmentedControl,
  Stamp,
  Tooltip,
} from "./components/ui";

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

import { Board } from "./features/board/Board";
import { CommandCenter } from "./features/command/CommandCenter";
import { Welcome } from "./features/onboarding/Welcome";
import { useBoardSettings } from "./lib/queries";

const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
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
    <Suspense fallback={null}>
      <LazyTaskDrawer {...props} />
    </Suspense>
  );
}
const TeamPage = lazy(() =>
  import("./features/team/TeamPage").then((m) => ({ default: m.TeamPage })),
);

import { api } from "./lib/api";
import { preparePaperGrain } from "./lib/grain";
import { appQuery, boardQuery, membersQuery, tasksQuery } from "./lib/queries";
import { paperRustle } from "./lib/sound";
import type { Theme } from "./lib/types";
import { useUiStore } from "./lib/ui-store";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
const navigation = [
  { path: "/board", name: "Board", icon: LayoutDashboard },
  { path: "/table", name: "Table", icon: Table2 },
  { path: "/assets", name: "Assets", icon: Boxes },
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
        if (event.action.startsWith("jam."))
          void queryClient.invalidateQueries({ queryKey: ["app"] });
        if (event.taskKey)
          void queryClient.invalidateQueries({
            queryKey: ["task", event.taskKey],
          });
        if (event.action === "member.joined")
          void queryClient.invalidateQueries({ queryKey: ["members"] });
      }
      for (const queryKey of [
        ["boardTasks"],
        ["board"],
        ["activity"],
        ["tableTasks"],
        ["tags"],
        ["assets"],
        ["members"],
      ])
        void queryClient.invalidateQueries({ queryKey });
      useUiStore.getState().receive(events);
      if (
        useUiStore.getState().soundEnabled &&
        events.some((e) => e.actor.kind === "agent")
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
      void new Promise<void>((resolve) => {
        const wait = () =>
          document.querySelector(
            ".board-columns, .welcome, .identity, .feature-page, .table-page, [role=alert]",
          )
            ? resolve()
            : requestAnimationFrame(wait);
        wait();
      })
        .then(() => document.fonts.ready)
        .then(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        )
        .then(() => getCurrentWindow().show())
        .then(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        )
        .then(() => api.appReady());
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
function Countdown({ endsAt }: { endsAt: string | null }) {
  const now = useUiStore((s) => Math.floor(s.now / 1000));
  if (!endsAt) return null;
  const left = Math.max(0, Math.floor(Date.parse(endsAt) / 1000 - now));
  const text = left
    ? `${Math.floor(left / 3600)
        .toString()
        .padStart(2, "0")}:${Math.floor((left / 60) % 60)
        .toString()
        .padStart(2, "0")}:${(left % 60).toString().padStart(2, "0")} left`
    : "Jam over";
  return (
    <span
      className={`countdown ${left < 10800 ? "ending" : ""}`}
      role="timer"
      aria-label="Jam time remaining"
    >
      {text}
    </span>
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
  const newTask = useCallback(() => {
    if (location === "/table") {
      window.dispatchEvent(new Event("table-new-task"));
      return;
    }
    useUiStore.getState().setQuickColumn("todo");
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
                className={`nav-link ${location === path ? "selected" : ""}`}
                aria-label={name}
              >
                <Icon size={20} />
                {expanded && <span>{name}</span>}
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
          <div className="jam-name">
            {board.data?.jam.name ?? app.data.jam?.name}
          </div>
          {board.data?.jam.theme && (
            <Stamp className="theme-stamp">{board.data.jam.theme}</Stamp>
          )}
          <div className="topbar-space" />
          <IconButton label="New task · N" onClick={newTask}>
            <Plus size={17} />
          </IconButton>
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
          <Countdown endsAt={app.data.jam?.endsAt ?? null} />
          <div className="agent-stack">
            {board.data?.onlineAgents
              .filter(
                (agent) =>
                  now * 1000 - Date.parse(agent.lastSeenAt ?? "") < 120000,
              )
              .map((agent) => (
                <Tooltip
                  key={agent.id}
                  text={`${agent.name}${agent.workingOn.length ? ` · working on ${agent.workingOn.join(", ")}` : " · online"}`}
                >
                  <span className="agent-presence">
                    <Avatar member={agent} size={30} />
                    {pulse[agent.handle] && <span className="pulse-dot" />}
                  </span>
                </Tooltip>
              ))}
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
function BoardRoute() {
  const { settings, update } = useBoardSettings();
  const search = boardRoute.useSearch();
  const navigate = useNavigate();
  const open = useCallback(
    (task: string) => {
      void navigate({ to: "/board", search: { task } });
    },
    [navigate],
  );
  const close = useCallback(() => {
    void navigate({ to: "/board", search: {} });
  }, [navigate]);
  return (
    <>
      <div className="board-intro">
        <div>
          <span className="eyebrow">MAKE SOMETHING SMALL & WONDERFUL</span>
          <h1>
            The jam board<span className="heading-star">✳</span>
          </h1>
        </div>
        <div className="board-actions">
          <span className="muted">Color by:</span>
          <SegmentedControl
            label="Color by"
            value={settings?.colorBy ?? "none"}
            onChange={(v) => update({ colorBy: v })}
            options={[
              { value: "none", label: "None" },
              { value: "assignee", label: "Assignee" },
            ]}
          />
          <Button
            variant="primary"
            onClick={() => useUiStore.getState().setQuickColumn("todo")}
          >
            <Plus size={17} />
            New task <Kbd>N</Kbd>
          </Button>
        </div>
      </div>
      <Board open={open} />
      {search.task && <TaskDrawer taskKey={search.task} close={close} />}
    </>
  );
}
function TableRoute() {
  const search = tableRoute.useSearch();
  const navigate = useNavigate();
  return (
    <>
      <TaskTable
        search={search}
        change={(value) => {
          void navigate({ to: "/table", search: value });
        }}
        open={(task) => {
          void navigate({ to: "/table", search: { ...search, task } });
        }}
      />
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
    | "/settings";
  const openTask = (task: string) =>
    void navigate({ to: path, search: { section: search.section, task } });
  return (
    <>
      {name === "Assets" ? (
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
  return (
    <div
      className="toast-stack"
      role="status"
      aria-label="Notifications"
      aria-live="polite"
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
          <span>{toast.text}</span>
          {toast.taskKey && (
            <Button
              variant="ghost"
              onClick={() =>
                void navigate({ to: "/board", search: { task: toast.taskKey } })
              }
            >
              View
            </Button>
          )}
        </div>
      ))}
    </div>
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
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Shell,
});
const boardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/board",
  validateSearch: (search: Record<string, unknown>): { task?: string } => ({
    task: typeof search.task === "string" ? search.task : undefined,
  }),
  component: BoardRoute,
});
const placeholders = navigation
  .filter((item) => item.path !== "/board" && item.path !== "/table")
  .map((item) =>
    createRoute({
      getParentRoute: () => shellRoute,
      path: item.path,
      validateSearch: (search: Record<string, unknown>) => ({
        task: typeof search.task === "string" ? search.task : undefined,
        section:
          typeof search.section === "string" ? search.section : undefined,
      }),
      component: () => <FeatureRoute name={item.name} />,
    }),
  );
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
    shellRoute.addChildren([boardRoute, tableRoute, ...placeholders]),
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
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
