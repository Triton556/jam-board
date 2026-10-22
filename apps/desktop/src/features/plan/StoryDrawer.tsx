import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Drawer, Stamp } from "../../components/ui";
import {
  PaperSkeleton,
  QueryError,
  QueryRefreshNotice,
} from "../../components/ui/AsyncState";
import { api } from "../../lib/api";
import {
  epicsQuery,
  invalidatePlanning,
  questionsQuery,
} from "../../lib/planning-queries";
import { ExecutionControls } from "../execution/ExecutionControls";
import { ReferencesSection } from "../references/ReferencesSection";
import { AcceptanceEditor } from "../task/BriefEditor";
import { BrainHandoff } from "./BrainHandoff";
import { NewPlanningDialog } from "./NewPlanningDialog";
import { PlanningStatus, SavedMarkdown } from "./PlanningControls";
import { PlanningInput } from "./PlanningInput";
import { usePlanningDraft } from "./planning-draft";
import { TaskRows } from "./TaskRows";
export const intentFields = [
  ["outcomeMd", "Outcome"],
  ["basisMd", "Whose material is the basis"],
  ["preserveMd", "What already works (keep)"],
  ["scaleMd", "Scale of change"],
  ["rejectionRisksMd", "How it could fail"],
  ["openDecisionsMd", "Open decisions"],
] as const;
export function StoryDrawer({
  storyKey,
  close,
  openTask,
}: {
  storyKey: string;
  close(): void;
  openTask(key: string): void;
}) {
  const query = useQuery({
      queryKey: ["story", storyKey],
      queryFn: () => api.getStory(storyKey),
    }),
    epics = useQuery(epicsQuery),
    questions = useQuery(questionsQuery);
  const client = useQueryClient(),
    navigate = useNavigate();
  const [newTask, setNewTask] = useState(false);
  const story = query.data?.story,
    epic = epics.data?.find((e) => e.id === story?.epicId);
  const save = useMutation({
    mutationFn: ({
      key,
      patch,
    }: {
      key: string;
      patch: Parameters<typeof api.updateStory>[1];
    }) => api.updateStory(key, patch),
    onSuccess: () => invalidatePlanning(client),
  });
  return (
    <Drawer title={storyKey} onClose={close}>
      {query.error && story && (
        <QueryRefreshNotice
          error={query.error}
          resource={`story ${story.key}`}
          busy={query.isFetching}
          retry={() => void query.refetch()}
        />
      )}
      {query.isPending ? (
        <PaperSkeleton label="Loading story" />
      ) : query.error && !query.data ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : (
        story && (
          <div className="story-editor">
            <Button
              variant="ghost"
              onClick={() => {
                if (epic)
                  void navigate({
                    to: "/plan/$epicKey",
                    params: { epicKey: epic.key },
                  });
              }}
            >
              {epic?.key} · {epic?.title}
            </Button>
            <div className="field">
              Story title
              <PlanningInput
                identity={`${story.id}:title`}
                label="Story title"
                save={(title) => api.updateStory(storyKey, { title })}
                className="planning-title"
                value={story.title}
                key={story.id}
                maxLength={140}
                disabled={story.status === "archived"}
              />
            </div>
            <PlanningStatus
              level="Story"
              entityKey={storyKey}
              value={story.status}
            />
            <div className="planning-tools">
              <BrainHandoff
                scope={{ type: "story", key: story.key }}
                disabled={story.status === "archived"}
              />
            </div>
            <ExecutionControls
              key={`execution:${story.id}`}
              scope={{ type: "story", id: story.id }}
            />
            {questions.data?.some(
              (q) =>
                q.status === "open" &&
                q.scopeType === "story" &&
                q.scopeId === story.id,
            ) && <Stamp className="needs-info">Needs info</Stamp>}
            {intentFields.map(([field, label]) => (
              <SavedMarkdown
                key={`${story.id}:${field}`}
                label={label}
                value={story[field]}
                save={(value) => api.updateStory(storyKey, { [field]: value })}
                disabled={story.status === "archived"}
              />
            ))}
            <AcceptanceDraft
              key={story.id}
              identity={`${story.id}:acceptance`}
              value={story.acceptance}
              disabled={story.status === "archived"}
              save={(acceptance) =>
                save.mutateAsync({ key: storyKey, patch: { acceptance } })
              }
            />
            {save.error && <p role="alert">{save.error.message}</p>}
            <div className="section-heading">
              <h2>Tasks</h2>
              <Button
                disabled={story.status === "archived"}
                onClick={() => setNewTask(true)}
              >
                + Task
              </Button>
            </div>
            <ReferencesSection
              targetKey={story.key}
              epicKey={epic?.key ?? ""}
              disabled={!!story.archivedAt}
            />
            <TaskRows rows={query.data?.tasks ?? []} openTask={openTask} />
            {newTask && (
              <NewPlanningDialog
                target={{ kind: "task", storyKey: story.key }}
                close={() => setNewTask(false)}
                created={openTask}
              />
            )}
          </div>
        )
      )}
    </Drawer>
  );
}
function AcceptanceDraft({
  identity,
  value,
  save,
  disabled,
}: {
  identity: string;
  value: Parameters<typeof AcceptanceEditor>[0]["value"];
  save(
    value: Parameters<typeof AcceptanceEditor>[0]["value"],
  ): Promise<unknown>;
  disabled?: boolean;
}) {
  const draft = usePlanningDraft(value, identity);
  const mutation = useMutation({
    scope: { id: identity },
    mutationFn: (submitted: typeof draft.snapshot & { save: typeof save }) =>
      submitted.save(submitted.draft),
    onSuccess: (_, submitted) => draft.saved(submitted),
  });
  return (
    <section>
      <h2>Acceptance criteria</h2>
      {draft.dirty && (
        <p role="status">
          Unsaved acceptance is kept while navigating. Save acceptance to apply
          it.
        </p>
      )}
      <AcceptanceEditor
        value={draft.value}
        onChange={(value) => draft.change(value, mutation.isPending)}
        disabled={disabled}
      />
      <Button
        variant="primary"
        disabled={
          disabled ||
          !draft.dirty ||
          draft.value.some((a) => !a.criterion.trim() || !a.check.trim())
        }
        onClick={() => mutation.mutate({ ...draft.snapshot, save })}
      >
        Save acceptance
      </Button>
    </section>
  );
}
