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
import { Button, SegmentedControl, Stamp } from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { PageHeading } from "../../components/ui/m5";
import { api } from "../../lib/api";
import type { ProjectSummary } from "../../lib/project-api";
import { acceptProjectSelection } from "../../lib/project-selection";
import { templateInfo } from "../../lib/project-template";
import { appQuery } from "../../lib/queries";

export function ProjectsPage() {
  const app = useQuery(appQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const projects = useQuery({
    queryKey: ["projects", true],
    queryFn: () => api.listProjects(true),
  });
  const pendingWrites = useIsMutating();
  const open = useMutation({
    onMutate: () => setRecovered(false),
    mutationFn: (project: ProjectSummary) =>
      project.archived
        ? api.restoreProject(project.id)
        : api.selectProject(project.id),
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
          onClick={() => void navigate({ to: "/welcome" })}
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
          {visible.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-card-meta">
                <FolderKanban size={20} aria-hidden="true" />
                <code>{project.keyPrefix}</code>
                {project.selected && <Stamp>Current project</Stamp>}
              </div>
              <h2>{project.name}</h2>
              <p className="muted">
                {templateInfo(project.template).label} · {project.taskCount}{" "}
                tasks
              </p>
              {project.inProgressCount > 0 && (
                <p className="small">
                  {project.inProgressCount} in progress · switching boards does
                  not pause work
                </p>
              )}
              <Button
                variant={project.selected ? "primary" : "secondary"}
                disabled={pendingWrites > 0}
                onClick={() =>
                  project.selected
                    ? void navigate({ to: "/plan", search: {} })
                    : open.mutate(project)
                }
              >
                {project.archived ? (
                  <RotateCcw size={16} />
                ) : (
                  <ArrowRight size={16} />
                )}
                {project.archived ? "Restore & open" : "Open project"}
                <span className="sr-only"> {project.name}</span>
              </Button>
            </article>
          ))}
          {!visible.length && (
            <p className="projects-empty muted">
              {archived
                ? "No archived projects. Archiving keeps the work so you can restore it here."
                : "No active projects yet. Create one for your next idea, or restore a project from the archive."}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
