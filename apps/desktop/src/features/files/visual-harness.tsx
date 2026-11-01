// Isolated hosted component fixture. This is not an application entry point.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/pt-serif/400.css";
import "@fontsource/pt-serif/700.css";
import "../../styles/fonts.css";
import "../../styles/tokens.css";
import "../../styles/app.css";
import "../../styles/m5.css";
import "../../styles/v22.css";
import "../../styles/v24b.css";
import "../../styles/type-fit.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../../lib/api";
import { scopeInput } from "../../lib/file-viewer-api";
import { mockApi } from "../../lib/mock-bridge";
import { mockFilesV2 } from "../../lib/mock-files-v2";
import { mockTaskFiles } from "../../lib/mock-task-files";
import { registration, taskFilesApi } from "../../lib/task-files-api";
import { AssetsPage } from "../assets/AssetsPage";
import { ProjectDocuments } from "../plan/ProjectDocuments";
import { FileViewer } from "./FileViewer";
import { useFileViewerRoute } from "./file-hooks";

document.documentElement.dataset.ready = "true";
await mockApi.resetDemo();
mockApi.setLatency(0);
mockTaskFiles.reset();
mockTaskFiles.copyDelay = 0;
mockFilesV2.reset();
const app = await api.appState(),
  context = await taskFilesApi.capture(app.jam?.id ?? "");
async function add(name: string) {
  const asset = (
    await taskFilesApi.register(
      context,
      registration("board_file", `C:/fixture/${name}`, crypto.randomUUID()),
    )
  ).asset;
  if (!asset) throw new Error("Fixture registration failed");
  await mockFilesV2.link(
    context,
    scopeInput({ type: "project", key: null }, asset.id),
  );
  return asset;
}
const plan = await add("Project-plan.md"),
  image = await add("Landscape.png");
await mockFilesV2.link(
  context,
  scopeInput({ type: "epic", key: "JB-E1" }, plan.id),
);
await mockFilesV2.link(
  context,
  scopeInput({ type: "story", key: "JB-S1" }, plan.id),
);
const archived = await add("Archived-design.md");
await mockFilesV2.archive(
  context,
  { assetId: archived.id, requestId: "archive-fixture" },
  true,
);
api.pickFiles = async () => ["C:/fixture/Project-plan-v2.md"];
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
client.setQueryData(["app"], app);

function Harness() {
  const route = useFileViewerRoute(),
    location = useRouterState({ select: (s) => s.location }),
    [opened, setOpened] = useState("");
  const scene = (location.search as { scene?: string }).scene;
  const file =
    route.assetId ??
    (scene === "viewer-markdown" || scene === "delete-used"
      ? plan.id
      : scene === "viewer-image"
        ? image.id
        : undefined);
  const [initialClosed, setClosed] = useState(false);
  return (
    <QueryClientProvider client={client}>
      <div
        style={{
          minHeight: "100dvh",
          padding: "24px",
          background: "var(--paper)",
        }}
      >
        {scene === "assets-filters" || location.pathname === "/assets" ? (
          <AssetsPage openTask={(key) => setOpened(key)} />
        ) : (
          <main>
            <h1>Plan</h1>
            <p className="muted">Project planning and documents</p>
            <ProjectDocuments />
          </main>
        )}
        {opened && <p role="status">Opened {opened}</p>}
        {file && (!initialClosed || route.assetId) && (
          <FileViewer
            assetId={file}
            onClose={() => {
              setClosed(true);
              route.closeFileViewer();
            }}
            openTarget={(target) =>
              setOpened(target.key ?? target.id ?? target.type)
            }
          />
        )}
      </div>
    </QueryClientProvider>
  );
}
const root = createRootRoute({
  component: Outlet,
  validateSearch: (search: Record<string, unknown>) => search,
});
const fixtureRoute = createRoute({
  getParentRoute: () => root,
  path: "/src/features/files/visual-harness.html",
  component: Harness,
});
const assetsRoute = createRoute({
  getParentRoute: () => root,
  path: "/assets",
  component: Harness,
});
const router = createRouter({
  routeTree: root.addChildren([fixtureRoute, assetsRoute]),
});
const element = document.getElementById("root");
if (element) createRoot(element).render(<RouterProvider router={router} />);
