import type {
  Acceptance,
  AnswerQuestion,
  AskUser,
  BriefPatch_Serialize,
  Epic,
  EpicPatch_Serialize,
  EpicTree,
  NewEpic,
  NewStory,
  Question,
  Readiness,
  Review,
  ReviewTask,
  Scope,
  Story,
  StoryPatch_Serialize,
  StoryTree,
  TaskDetail,
  TaskSummary,
} from "../bindings";
import type { ActivityEvent } from "./types";

export type {
  Acceptance,
  Epic,
  EpicTree,
  Question,
  Readiness,
  Story,
  StoryTree,
};
export type EpicInput = Pick<NewEpic, "title"> &
  Partial<Omit<NewEpic, "title">>;
export type StoryInput = Pick<NewStory, "title" | "epicKey"> &
  Partial<Omit<NewStory, "title" | "epicKey">>;
export type ReadyTaskInput = {
  key: string;
  expectedUpdatedAt: string;
  overrideReason?: string;
};
export interface PlanningApi {
  listEpics(): Promise<Epic[]>;
  listStories(): Promise<Story[]>;
  getEpic(key: string): Promise<EpicTree>;
  createEpic(input: EpicInput): Promise<Epic>;
  updateEpic(key: string, patch: EpicPatch_Serialize): Promise<Epic>;
  setEpicStatus(
    key: string,
    status: string,
    overrideReason?: string,
  ): Promise<Epic>;
  setBrain(epicKey: string, handle: string | null): Promise<Epic>;
  getStory(key: string): Promise<StoryTree>;
  createStory(input: StoryInput): Promise<Story>;
  updateStory(key: string, patch: StoryPatch_Serialize): Promise<Story>;
  setStoryStatus(
    key: string,
    status: string,
    overrideReason?: string,
  ): Promise<Story>;
  reorderStory(key: string, beforeKey?: string): Promise<Story>;
  updateTaskBrief(
    key: string,
    patch: BriefPatch_Serialize,
  ): Promise<TaskDetail>;
  checkReady(key: string): Promise<Readiness>;
  markReady(input: ReadyTaskInput): Promise<TaskSummary>;
  listQuestions(status?: string, scope?: Scope): Promise<Question[]>;
  answerQuestion(input: AnswerQuestion): Promise<Question>;
  withdrawQuestion(id: string): Promise<Question>;
  askUser(input: AskUser): Promise<Question>;
  reviewTask(input: ReviewTask): Promise<Review>;
  epicJournal(epicKey: string): Promise<ActivityEvent[]>;
  listChangesSince(cursor: number, epicKey?: string): Promise<ActivityEvent[]>;
}
