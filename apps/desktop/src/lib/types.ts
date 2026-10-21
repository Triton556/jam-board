import type {
  ActivityEvent,
  AppState,
  BoardSummary,
  Comment,
  Member,
  NewJamInput,
  RuntimeInfo,
  TagCount,
  TaskDetail,
  TaskEditInput_Deserialize,
  TaskListPage,
  TaskSummary,
  TaskQuery as WireTaskQuery,
} from "../bindings";

export type {
  ActivityEvent,
  AppState,
  BoardSummary,
  Comment,
  Member,
  NewJamInput,
  RuntimeInfo,
  TagCount,
  TaskDetail,
  TaskListPage,
  TaskSummary,
};
export type UpdateInput = TaskEditInput_Deserialize;
export type TaskQuery = Partial<WireTaskQuery>;
export const statuses = [
  "backlog",
  "ready",
  "in_progress",
  "review",
  "done",
] as const;
export type Status = (typeof statuses)[number];
export const labels: Record<Status, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};
export type BoardTasks = Record<Status, TaskSummary[]>;
export type Theme = "system" | "light" | "dark";
export type CreateInput = {
  title: string;
  status: Status;
  description?: string;
  priority?: string;
  tags?: string[];
  estimate?: number;
  dueAt?: string;
  storyKey?: string;
  brief?: import("../bindings").TaskBrief;
};
export type MoveInput = {
  key: string;
  status: Status;
  beforeKey?: string;
  afterKey?: string;
  overrideReason?: string;
};
export const emptyBoard = (): BoardTasks => ({
  backlog: [],
  ready: [],
  in_progress: [],
  review: [],
  done: [],
});
export class JamError extends Error {
  constructor(
    public code: string,
    message: string,
    public field?: string | null,
  ) {
    super(message);
  }
}

export type {
  ActivityQuery,
  Asset,
  AssetLink,
  AssetWithTasks,
  ConfigSnippets,
  McpStatus,
  MemberWithStats,
  Settings,
} from "../bindings";

import type {
  AssetEdit as WireAssetEdit,
  MemberEdit as WireMemberEdit,
  NewAsset as WireNewAsset,
  NewMember as WireNewMember,
  SettingsPatch as WireSettingsPatch,
} from "../bindings";
export type AssetEdit = Pick<WireAssetEdit, "id"> &
  Partial<Omit<WireAssetEdit, "id">>;
export type MemberEdit = Pick<WireMemberEdit, "id"> &
  Partial<Omit<WireMemberEdit, "id">>;
export type NewAsset = Omit<WireNewAsset, "notes"> & { notes?: string | null };
export type NewMember = Omit<WireNewMember, "avatar"> & {
  avatar?: string | null;
};
export type SettingsPatch = Partial<WireSettingsPatch>;
export type ColorBy = "none" | "assignee" | "epic";
