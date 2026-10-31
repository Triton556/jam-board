import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  FolderKanban,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import type { ProjectFolderInfo, RegistryEntry } from "../../bindings";
import { Button, SegmentedControl, Stamp } from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { PageHeading } from "../../components/ui/m5";
import { api } from "../../lib/api";
import type { ProjectSummary } from "../../lib/project-api";
import {
  folderError,
  folderProjectName,
  projectFolders,
  selectProjectWithFolderContext,
  useFolderGuard,
} from "../../lib/project-folder-api";
import { acceptProjectSelection } from "../../lib/project-selection";
import { templateInfo } from "../../lib/project-template";
import { appQuery } from "../../lib/queries";
import { MoveToFolder } from "./MoveToFolder";
import { ProjectFolderDialog } from "./ProjectFolderDialog";

export function ProjectsPage() {
  const app = useQuery(appQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [folderDialog, setFolderDialog] = useState<"create" | "open" | null>(
    null,
  );
  const [locate, setLocate] = useState<string | undefined>();
  const [locating, setLocating] = useState<RegistryEntry | null>(null);
  const capture = useFolderGuard();
  const [moving, setMoving] = useState<ProjectSummary | null>(null);
  const [folderNotice, setFolderNotice] = useState("");
  const folders = useQuery({
    queryKey: ["project-folders"],
    queryFn: () => projectFolders.list(),
    retry: false,
  });
  const removeRecent = useMutation({
    mutationFn: async (id: string) => {
      const check = await capture();
      await check();
      await projectFolders.remove(id);
      await check();
    },
    onSuccess: async () => {
      await folders.refetch();
      setFolderNotice("Removed from list. Your project files are unchanged.");
    },
    onError: (error) => setFolderNotice(folderError(error)),
  });
  const folderOpened = async (info: ProjectFolderInfo) => {
    const state = await api.appState();
    const current = await projectFolders.selection();
    if (
      state.jam?.id !== info.projectId ||
      current?.instanceId !== info.context.instanceId ||
      current.selectionEpoch !== info.context.selectionEpoch
    )
      throw new Error("Project changed — reopen");
    await acceptProjectSelection(client, state);
    await folders.refetch();
    setFolderDialog(null);
    await navigate({ to: "/plan", search: {}, ignoreBlocker: true });
  };
  const projects = useQuery({
    queryKey: ["projects", true],
    queryFn: () => api.listProjects(true),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10000,
  });
  const pendingWrites = useIsMutating();
  const prepareMove = useMutation({
    mutationFn: async (project: ProjectSummary) => {
      if (!project.selected)
        await acceptProjectSelection(
          client,
          await selectProjectWithFolderContext(project.id),
        );
      return project;
    },
    onSuccess: (project) => setMoving(project),
    onError: (error) => setFolderNotice(folderError(error)),
  });
  const open = useMutation({
    onMutate: () => setRecovered(false),
    mutationFn: (project: ProjectSummary) =>
      selectProjectWithFolderContext(project.id, project.archived),
    onSuccess: async (state) => {
      await acceptProjectSelection(client, state);
      await navigate({ to: "/plan", search: {}, ignoreBlocker: true });
    },
    onError: async () => {
      // A lost response can follow a successful selection. Re-read the source
      // of truth instead of telling the user their old board is still selected.
      try {
        const state = await api.appState();
        await acceptProjectSelection(client, state);
        setRecovered(true);
      } catch {
        setRecovered(false);
      }
    },
  });
  useBlocker({
    shouldBlockFn: () => open.isPending,
    enableBeforeUnload: open.isPending,
  });
  const visible =
    projects.data?.filter((project) => project.archived === archived) ?? [];
  const cards = visible.map((project) => ({
    project,
    entry: folders.data?.find((entry) => entry.projectId === project.id),
    name: project.name,
    key: project.id,
  })) as {
    project?: ProjectSummary;
    entry?: RegistryEntry;
    name: string;
    key: string;
  }[];
  if (!archived)
    for (const entry of folders.data ?? []) {
      if (!projects.data?.some((project) => project.id === entry.projectId))
        cards.push({
          entry,
          name:
            entry.projectName ||
            folderProjectName(entry.projectId) ||
            (app.data?.jam?.id === entry.projectId
              ? app.data.jam.name
              : "Project folder"),
          key: entry.instanceId,
        });
    }
  return (
    <main className="projects-page feature-page">
      <header className="projects-navigation">
        <Button
          variant="ghost"
          disabled={open.isPending}
          onClick={() =>
            void navigate({ to: app.data?.hasJam ? "/plan" : "/welcome" })
          }
        >
          <ArrowLeft size={16} />{" "}
          {app.data?.hasJam ? "Back to current project" : "Back"}
        </Button>
        <Button
          variant="primary"
          disabled={pendingWrites > 0}
          onClick={() => {
            setLocate(undefined);
            setLocating(null);
            setFolderDialog("create");
          }}
        >
          <Plus size={16} /> New project
        </Button>
      </header>
      <PageHeading
        title="Your projects"
        note="a separate board for each idea"
      />
      <p className="projects-intro muted">
        Each project has its own plan, tasks, questions and references.
        Connected agents stay pinned to their project when you open another
        board.
      </p>
      <Button
        disabled={pendingWrites > 0}
        onClick={() => {
          setLocate(undefined);
          setLocating(null);
          setFolderDialog("open");
        }}
      >
        Open project folder…
      </Button>
      {folders.error && (
        <p role={open.error ? "status" : "alert"}>
          Could not read recent folders: {folders.error.message}
          <Button onClick={() => void folders.refetch()}>
            Retry recent folders
          </Button>
        </p>
      )}
      {folderNotice && <p role="status">{folderNotice}</p>}
      <div className="projects-tabs">
        <SegmentedControl
          label="Project lists"
          value={archived ? "archived" : "active"}
          onChange={(value) => setArchived(value === "archived")}
          options={[
            { value: "active", label: "Active projects" },
            { value: "archived", label: "Archived projects" },
          ]}
        />
      </div>
      {pendingWrites > 0 && !open.isPending && (
        <p role="status">
          Finishing your saved changes before switching projects…
        </p>
      )}
      {open.isPending && <p role="status">Opening {open.variables.name}…</p>}
      {open.error && (
        <p role="alert" className="field-error">
          Could not finish opening the project: {open.error.message}.{" "}
          {recovered
            ? "The current project has been refreshed. Check its label below before trying again."
            : "The current project could not be confirmed. Retry when the connection is available."}
        </p>
      )}
      {projects.isPending ? (
        <PaperSkeleton label="Loading projects" />
      ) : projects.error ? (
        <QueryError
          error={projects.error}
          retry={() => void projects.refetch()}
        />
      ) : (
        <section
          className="project-grid"
          aria-label={archived ? "Archived projects" : "Active projects"}
        >
          {cards.map(({ project, entry, name, key }) => {
            const path = entry?.displayFolder ?? project?.movedTo;
            const unavailable = !!entry && entry.availability !== "available";
            return (
              <article className="project-card" key={key}>
                <div className="project-card-meta">
                  <FolderKanban size={20} aria-hidden="true" />
                  {project && <code>{project.keyPrefix}</code>}
                  {project?.selected && <Stamp>Current project</Stamp>}
                  {unavailable && (
                    <span className="folder-warning-chip">
                      Folder not found
                    </span>
                  )}
                </div>
                <h2>{name}</h2>
                <div className="project-storage muted small">
                  {path ? (
                    <>
                      <span>Folder · </span>
                      <span className="folder-path-short" title={path}>
                        {middlePath(path)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Stored in app data · </span>
                      <Button
                        variant="ghost"
                        disabled={pendingWrites > 0}
                        onClick={() => project && prepareMove.mutate(project)}
                      >
                        Move to folder…<span className="sr-only"> {name}</span>
                      </Button>
                    </>
                  )}
                </div>
                {project && (
                  <p className="muted">
                    {templateInfo(project.template).label} · {project.taskCount}{" "}
                    tasks
                  </p>
                )}
                {!!project?.inProgressCount && (
                  <p className="small">
                    {project.inProgressCount} In progress (including archived
                    tasks) · switching boards does not pause work
                  </p>
                )}
                <div className="button-row">
                  {unavailable ? (
                    <>
                      <Button
                        disabled={pendingWrites > 0}
                        onClick={() => {
                          setLocate(undefined);
                          setLocating(entry);
                          setFolderDialog("open");
                        }}
                      >
                        Locate…
                      </Button>
                      <Button
                        disabled={pendingWrites > 0}
                        onClick={() => removeRecent.mutate(entry.instanceId)}
                      >
                        Remove from list
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant={project?.selected ? "primary" : "secondary"}
                      disabled={pendingWrites > 0}
                      onClick={() => {
                        const folder =
                          entry?.canonicalFolder ?? project?.movedTo;
                        if (folder) {
                          setLocate(folder);
                          setLocating(null);
                          setFolderDialog("open");
                        } else if (project?.selected)
                          void navigate({ to: "/plan", search: {} });
                        else if (project) open.mutate(project);
                      }}
                    >
                      {project?.archived ? (
                        <RotateCcw size={16} />
                      ) : (
                        <ArrowRight size={16} />
                      )}
                      {project?.archived ? "Restore & open" : "Open"}
                      <span className="sr-only">
                        {project?.archived ? " " : " project "}
                        {name}
                      </span>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
          {!cards.length && (
            <p className="projects-empty muted">
              {archived
                ? "No archived projects. Archiving keeps the work so you can restore it here."
                : "No active projects yet. Create one for your next idea, or restore a project from the archive."}
            </p>
          )}
        </section>
      )}
      {folderDialog && (
        <ProjectFolderDialog
          key={`${folderDialog}:${locating?.instanceId ?? locate ?? "new"}`}
          mode={folderDialog}
          draftKey={`projects:${app.data?.jam?.id ?? "none"}`}
          initialFolder={
            folders.data?.some((entry) => entry.canonicalFolder === locate) ||
            projects.data?.some((p) => p.movedTo === locate)
              ? locate
              : undefined
          }
          expectedProjectId={locating?.projectId}
          recentInstanceId={locating?.instanceId}
          onClose={() => setFolderDialog(null)}
          onOpened={folderOpened}
        />
      )}
      {moving && (
        <MoveToFolder
          projectId={moving.id}
          name={moving.name}
          taskCount={moving.taskCount}
          onClose={() => setMoving(null)}
          onMoved={async () => {
            await projects.refetch();
            await folders.refetch();
          }}
        />
      )}
    </main>
  );
}

function middlePath(path: string) {
  return path.length > 30 ? (
    <>
      <span className="folder-path-head">{path.slice(0, -18)}</span>
      <span className="folder-path-tail">{path.slice(-18)}</span>
    </>
  ) : (
    path
  );
}
