import type { AppState, ProjectSummary } from "../bindings";

export type { ProjectSummary } from "../bindings";

export interface ProjectsApi {
  listProjects(includeArchived?: boolean): Promise<ProjectSummary[]>;
  selectProject(projectId: string): Promise<AppState>;
  restoreProject(projectId: string): Promise<AppState>;
}
