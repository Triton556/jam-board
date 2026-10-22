import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  Copy,
  Image as ImageIcon,
  Map as MapIcon,
  MoreHorizontal,
  Music,
  Package,
  Type,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Markdown } from "../../components/Markdown";
import {
  Avatar,
  Button,
  Combobox,
  DateTimeInput,
  Dialog,
  Drawer,
  IconButton,
  Kbd,
  SegmentedControl,
  Select,
  Stamp,
  Tabs,
  TagInput,
} from "../../components/ui";
import { WorkingPill } from "../../components/ui/AgentWorking";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { Priority, priorities } from "../../components/ui/Priority";
import { RoughLine } from "../../components/ui/RoughLine";
import { useAgentWorking } from "../../lib/agent-working";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { appQuery, membersQuery, useBoardSettings } from "../../lib/queries";
import { relativeTime } from "../../lib/time";
import type { TaskDetail, UpdateInput } from "../../lib/types";
import { JamError, labels, statuses } from "../../lib/types";
import { useUiStore } from "../../lib/ui-store";
import { AssetLinkDialog } from "../assets/AssetLinkDialog";
import { TaskExecutionNotice } from "../execution/TaskExecutionNotice";
import { BrainHandoff } from "../plan/BrainHandoff";
import { ReferencesSection } from "../references/ReferencesSection";
import { BriefEditor } from "./BriefEditor";
import { historyText } from "./history-text";
import { announceReady, ReadinessStrip } from "./Readiness";
import { ReleaseClaim } from "./ReleaseClaim";
import { Rounds } from "./Rounds";
import type { TaskFields } from "./task-form";
import {
  equalValue,
  fieldNames,
  taskPatch,
  taskSchema,
  taskValues,
} from "./task-form";

export function TaskDrawer({
  taskKey,
  close,
}: {
  taskKey: string;
  close(): void;
}) {
  const task = useQuery({
    queryKey: ["task", taskKey],
    queryFn: () => api.getTask(taskKey),
  });
  if (task.data)
    return <TaskEditor key={taskKey} task={task.data} close={close} />;
  return (
    <Drawer onClose={close} title={taskKey}>
      {task.error ? (
        <QueryError error={task.error} retry={() => void task.refetch()} />
      ) : (
        <PaperSkeleton label="Loading task" />
      )}
    </Drawer>
  );
}
export function TaskEditor({
  task,
  close,
}: {
  task: TaskDetail;
  close(): void;
}) {
  const { settings } = useBoardSettings();
  const navigate = useNavigate();
  const readiness = useQuery({
    queryKey: ["readiness", task.key],
    queryFn: () => api.checkReady(task.key),
  });
  const members = useQuery(membersQuery);
  const working = useAgentWorking(
    task,
    members.data?.find((m) => m.id === task.assigneeId),
  );
  const app = useQuery(appQuery);
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  const client = useQueryClient();
  const [base, setBase] = useState(task);
  const seenVersions = useRef(new Set([task.updatedAt]));
  const [latest, setLatest] = useState<TaskDetail | null>(null);
  const [review, setReview] = useState(false);
  const [assetLink, setAssetLink] = useState(false);
  const [menu, setMenu] = useState(false);
  const [archive, setArchive] = useState(false);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState("Write");
  const [comment, setComment] = useState("");
  const [markPending, setMarkPending] = useState(false);
  const markLock = useRef(false);
  const [saveNotice, setSaveNotice] = useState("");
  const changes = useUiStore((s) => s.taskChanges[task.key]);
  const form = useForm<TaskFields>({
    resolver: zodResolver(taskSchema),
    mode: "onChange",
    defaultValues: taskValues(task),
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    getValues,
    formState: { isDirty, isValid, errors },
  } = form;
  const dirty = useRef(isDirty);
  dirty.current = isDirty;
  const blocker = useBlocker({
    shouldBlockFn: () => dirty.current,
    withResolver: true,
    enableBeforeUnload: isDirty,
  });
  const resetTask = (value: TaskDetail) => {
    seenVersions.current.add(value.updatedAt);
    setBase(value);
    reset(taskValues(value));
    setLatest(null);
    setReview(false);
  };
  const resetRef = useRef(resetTask);
  resetRef.current = resetTask;
  useEffect(() => {
    if (seenVersions.current.has(task.updatedAt)) return;
    seenVersions.current.add(task.updatedAt);
    if (!dirty.current) resetRef.current(task);
    else if (changes?.actor.id !== app.data?.currentMember?.id) setLatest(task);
    else if (
      ["comment.added", "asset.linked", "asset.unlinked"].includes(
        changes?.action ?? "",
      )
    )
      setBase(task);
  }, [task, changes, app.data?.currentMember?.id]);
  const invalidate = () => {
    invalidatePlanning(client);
    for (const queryKey of [
      ["task", task.key],
      ["boardTasks"],
      ["tableTasks"],
      ["board"],
      ["activity"],
      ["tags"],
    ])
      void client.invalidateQueries({ queryKey });
  };
  const save = useMutation({
    mutationFn: (input: UpdateInput) => api.updateTask(input),
    onMutate: () => {
      setSaveNotice("");
      return structuredClone(getValues());
    },
    onSuccess: (value, _input, submitted) => {
      const current = getValues();
      client.setQueryData(["task", task.key], value);
      resetTask(value);
      // Preserve typing made while the previous section's blur-save was in flight.
      for (const field of fieldNames) {
        if (submitted && !equalValue(current[field], submitted[field]))
          form.setValue(field, current[field], {
            shouldDirty: true,
            shouldValidate: true,
          });
      }
      invalidate();
    },
    onError: async (error, input) => {
      if ("code" in error && error.code === "not_ready") {
        form.setValue("status", base.status as TaskFields["status"], {
          shouldDirty: true,
        });
        const remaining = taskPatch(taskValues(base), getValues());
        if (Object.keys(remaining).some((field) => field !== "status"))
          setSaveNotice(
            "The brief is not ready. Your edits remain unsaved. Save them without changing status, then choose Mark ready to review the saved brief.",
          );
        else
          useUiStore.setState({
            readyRequest: {
              key: task.key,
              status: "ready",
              expectedUpdatedAt: input.expectedUpdatedAt,
            },
          });
      } else if ("code" in error && error.code === "conflict") {
        const fresh = await api.getTask(task.key);
        setLatest(fresh);
        setReview(true);
      } else useUiStore.getState().error(error.message);
    },
  });
  // Track the whole save/check/Ready operation so project switching waits for it.
  const markOperation = useMutation({
    mutationFn: async (capturedTask: TaskDetail) => {
      let captured = capturedTask;
      let checking = false;
      try {
        if (isDirty) {
          const parsed = taskSchema.safeParse(getValues());
          if (!parsed.success) return;
          const patch = taskPatch(taskValues(base), {
            ...parsed.data,
            status: base.status as TaskFields["status"],
          });
          if (Object.keys(patch).length)
            captured = await save.mutateAsync({
              key: captured.key,
              expectedUpdatedAt: base.updatedAt,
              ...patch,
            });
        }
        checking = true;
        const check = await api.checkReady(captured.key);
        if (check.ready) {
          await api.markReady({
            key: captured.key,
            expectedUpdatedAt: captured.updatedAt,
          });
          invalidate();
          announceReady(captured.key);
        } else
          useUiStore.setState({
            readyRequest: {
              key: captured.key,
              status: "ready",
              expectedUpdatedAt: captured.updatedAt,
            },
          });
      } catch (error) {
        if (checking && error instanceof JamError && error.code === "conflict")
          useUiStore.setState({
            readyRequest: {
              key: captured.key,
              status: "ready",
              expectedUpdatedAt: captured.updatedAt,
            },
          });
        else if (checking) useUiStore.getState().error(String(error));
        // Save failures already preserve the editor and show their own recovery.
      }
    },
    onSettled: () => {
      markLock.current = false;
      setMarkPending(false);
    },
  });
  const submit = (values: TaskFields, version = base.updatedAt) => {
    const patch = taskPatch(
      taskValues(base),
      values,
      latest && version === latest.updatedAt ? taskValues(latest) : undefined,
    );
    if (Object.keys(patch).length)
      save.mutate({ key: task.key, expectedUpdatedAt: version, ...patch });
    else resetTask(latest ?? base);
  };
  const submitRef = useRef(() => {});
  submitRef.current = () => {
    if (isDirty && !task.archivedAt && !save.isPending && !markLock.current)
      void handleSubmit((values) => submit(values))();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const commentMutation = useMutation({
    mutationFn: () => api.addComment({ key: task.key, bodyMd: comment }),
    onSuccess: () => {
      setComment("");
      invalidate();
    },
    onError: (error) => useUiStore.getState().error(error.message),
  });
  const archiveMutation = useMutation({
    mutationFn: () =>
      task.archivedAt
        ? api.unarchiveTask(task.key)
        : api.archiveTask(task.key, reason.trim() || undefined),
    onSuccess: async () => {
      const fresh = await api.getTask(task.key);
      client.setQueryData(["task", task.key], fresh);
      resetTask(fresh);
      setArchive(false);
      setReason("");
      invalidate();
    },
    onError: (error) => useUiStore.getState().error(error.message),
  });
  const attach = async (paths: string[]) => {
    for (const path of paths) await api.attachFile(task.key, path);
    invalidate();
    await client.invalidateQueries({ queryKey: ["assets"] });
  };
  const attachRef = useRef(attach);
  attachRef.current = attach;
  const [fileOver, setFileOver] = useState(false);
  useEffect(
    () =>
      api.onFileDrop((paths) => {
        if (!task.archivedAt)
          void attachRef
            .current(paths)
            .catch((e) => useUiStore.getState().error(String(e)));
      }, setFileOver),
    [task.archivedAt],
  );
  const title = watch("title");
  const titleInput = useRef<HTMLTextAreaElement | null>(null);
  const titleField = register("title");
  // biome-ignore lint/correctness/useExhaustiveDependencies: RHF updates the DOM value; every title change must resize the textarea, including reload and conflict resolution.
  useLayoutEffect(() => {
    const element = titleInput.current;
    if (element) {
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [title]);
  const due = watch("dueAt");
  const values = watch();
  const readonly = !!task.archivedAt;
  const actor =
    changes?.actor.name ??
    members.data?.find((m) => m.id === latest?.updatedBy)?.name ??
    "A teammate";
  const copy = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .catch((error) => useUiStore.getState().error(String(error)));
  };
  return (
    <Drawer
      onClose={close}
      title={task.key}
      leading={
        <IconButton label="Copy key" onClick={() => copy(task.key)}>
          <Copy size={16} />
        </IconButton>
      }
      actions={
        <div className="task-menu">
          <IconButton label="Task actions" onClick={() => setMenu(!menu)}>
            <MoreHorizontal />
          </IconButton>
          {menu && (
            <div className="menu-popup">
              <Button
                onClick={() => {
                  setArchive(true);
                  setMenu(false);
                }}
              >
                {readonly ? "Unarchive" : "Archive"}
              </Button>
              <Button
                onClick={() => {
                  copy(task.key);
                  setMenu(false);
                }}
              >
                Copy key
              </Button>
              <Button
                onClick={() => {
                  copy(`jam://task/${task.key}`);
                  setMenu(false);
                }}
              >
                Copy MCP reference
              </Button>
            </div>
          )}
        </div>
      }
    >
      {readonly && (
        <div className="notice">
          Archived ·{" "}
          <Button variant="ghost" onClick={() => archiveMutation.mutate()}>
            Unarchive
          </Button>
          <p className="small">
            Restoring this card only makes it visible. It does not start or
            resume its story; existing work can report or be released.
          </p>
        </div>
      )}
      {latest && (
        <div className="notice conflict-banner">
          {actor} updated this task while you were editing ·{" "}
          <button type="button" onClick={() => setReview(true)}>
            Review changes
          </button>
        </div>
      )}
      <div className="planning-tools">
        <BrainHandoff
          scope={{ type: "task", key: task.key }}
          disabled={readonly}
        />
        <span className="small muted">
          Save your notes before asking the brain to read them.
        </span>
      </div>
      {!readonly && <TaskExecutionNotice task={task} />}
      <ReleaseClaim task={task} hasUnsavedEdits={isDirty} />
      <form
        id="task-form"
        onSubmit={handleSubmit((value) => submit(value))}
        className="task-form"
      >
        <fieldset disabled={readonly || save.isPending || markPending}>
          <div className="task-breadcrumb">
            <Button
              variant="ghost"
              onClick={() =>
                void navigate({
                  to: "/plan/$epicKey",
                  params: { epicKey: task.epic.key },
                })
              }
            >
              <i style={{ background: `var(--${task.epic.color})` }} />
              {task.epic.key} · {task.epic.title}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void navigate({
                  to: "/plan/$epicKey",
                  params: { epicKey: task.epic.key },
                  search: { story: task.story.key },
                })
              }
            >
              {task.story.key} · {task.story.title}
            </Button>
          </div>
          <textarea
            className="task-title-input"
            aria-label="Task title"
            rows={2}
            {...titleField}
            ref={(element) => {
              titleField.ref(element);
              titleInput.current = element;
            }}
            onInput={(e) => {
              e.currentTarget.style.height = "0px";
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            }}
            aria-invalid={!!errors.title}
          />
          {title.length > 120 && (
            <small className="title-count">{title.length}/140</small>
          )}
          {errors.title && (
            <p className="field-error">{errors.title.message}</p>
          )}
          {readiness.data && (
            <ReadinessStrip
              readiness={readiness.data}
              status={task.status}
              pending={markPending}
              onMark={() => {
                if (markLock.current) return;
                markLock.current = true;
                setMarkPending(true);
                markOperation.mutate(task);
              }}
            />
          )}
          <div className="task-field-grid">
            <div className="field task-status-field">
              Status
              <div className="task-status-control">
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <Select {...field} aria-label="Status">
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {labels[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                />
                <WorkingPill state={working} />
              </div>
            </div>
            <div className="field">
              Priority
              <Controller
                name="priority"
                control={control}
                render={({ field }) => (
                  <SegmentedControl
                    label="Priority"
                    size="large"
                    value={field.value}
                    onChange={field.onChange}
                    options={priorities.map((p) => ({
                      value: p,
                      label: (
                        <>
                          <Priority value={p} />
                          <small>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </small>
                        </>
                      ),
                      title: p.charAt(0).toUpperCase() + p.slice(1),
                    }))}
                  />
                )}
              />
            </div>
            <div className="field">
              Assignee
              <Controller
                name="assigneeId"
                control={control}
                render={({ field }) => (
                  <Combobox
                    members={members.data ?? []}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={readonly}
                  />
                )}
              />
            </div>
            {settings?.estimatesEnabled && (
              <div className="field">
                Estimate
                <Controller
                  name="estimate"
                  control={control}
                  render={({ field }) => (
                    <SegmentedControl
                      label="Estimate"
                      size="large"
                      value={String(field.value ?? "")}
                      onChange={(v) => field.onChange(v ? Number(v) : null)}
                      options={["", "1", "2", "3", "5", "8"].map((v) => ({
                        value: v,
                        label: v || "–",
                      }))}
                    />
                  )}
                />
              </div>
            )}
            <div className="field wide">
              Due
              <Controller
                name="dueAt"
                control={control}
                render={({ field }) => (
                  <DateTimeInput
                    aria-label="Due"
                    value={field.value}
                    onChange={field.onChange}
                    disabled={readonly}
                  />
                )}
              />
              {due && Date.parse(due) < Date.now() && (
                <Stamp className="overdue">overdue</Stamp>
              )}
            </div>
            <div className="field wide">
              Tags
              <Controller
                name="tags"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    suggestions={tags.data?.map((t) => t.tag)}
                    disabled={readonly}
                  />
                )}
              />
            </div>
          </div>
          <Controller
            name="brief"
            control={control}
            render={({ field }) => (
              <BriefEditor
                value={field.value}
                onChange={field.onChange}
                onSave={() => submitRef.current()}
                disabled={readonly}
              />
            )}
          />
          {errors.brief && (
            <p role="alert">
              Complete required Change and Test fields before saving.
            </p>
          )}
          <div className="section-heading">
            <h2>Notes</h2>
            <Tabs value={tab} onChange={setTab} items={["Write", "Preview"]} />
          </div>
          {tab === "Write" ? (
            <textarea
              aria-label="Notes"
              className="description-input"
              {...register("descriptionMd")}
            />
          ) : (
            <Markdown>{watch("descriptionMd") || "*No notes yet.*"}</Markdown>
          )}
        </fieldset>
      </form>
      {saveNotice && (
        <p role="alert" className="notice">
          {saveNotice}
        </p>
      )}
      <Rounds
        task={task}
        members={members.data ?? []}
        hasUnsavedEdits={isDirty}
      />
      {(task.ancestorQuestions?.length ?? 0) > 0 && (
        <details className="task-section">
          <summary>Open questions above this task</summary>
          {(task.ancestorQuestions ?? []).map((q) => (
            <p key={q.id}>
              {q.scopeType} · {q.title}
            </p>
          ))}
        </details>
      )}
      <ReferencesSection
        targetKey={task.key}
        epicKey={task.epic.key}
        disabled={readonly}
      />
      <section className={`task-section ${fileOver ? "file-drop-active" : ""}`}>
        {fileOver && <RoughLine frame />}
        <h2>
          Linked assets <span className="muted">{task.assets.length}</span>
          {!readonly && (
            <Button variant="ghost" onClick={() => setAssetLink(true)}>
              Link existing…
            </Button>
          )}
        </h2>
        {!readonly && (
          <Button
            onClick={() =>
              void api
                .pickFiles()
                .then(attach)
                .catch((e) => useUiStore.getState().error(String(e)))
            }
          >
            Attach file…
          </Button>
        )}
        {assetLink && (
          <AssetLinkDialog
            taskKey={task.key}
            close={() => setAssetLink(false)}
          />
        )}
        {!task.assets.length && <p className="muted">No linked assets yet.</p>}
        {task.assets.map((asset) => (
          <div className="linked-asset" key={asset.id}>
            {asset.kind === "sprite" ? (
              <ImageIcon size={18} />
            ) : asset.kind === "audio" ? (
              <Music size={18} />
            ) : asset.kind === "level" ? (
              <MapIcon size={18} />
            ) : asset.kind === "font" ? (
              <Type size={18} />
            ) : (
              <Package size={18} />
            )}
            <div>
              <strong>{asset.name}</strong>
              <small className="mono">{asset.location}</small>
            </div>
            {!readonly && (
              <Button
                variant="ghost"
                aria-label={`Unlink ${asset.name}`}
                onClick={() =>
                  void api
                    .unlinkAsset({ assetId: asset.id, taskKey: task.key })
                    .then(() => {
                      invalidate();
                      void client.invalidateQueries({ queryKey: ["assets"] });
                    })
                    .catch((e) => useUiStore.getState().error(String(e)))
                }
              >
                ×
              </Button>
            )}
          </div>
        ))}
      </section>
      <section className="task-section">
        <h2>
          Comments <span className="muted">{task.comments.length}</span>
        </h2>
        {!task.comments.length && <p className="muted">No comments yet.</p>}
        {task.comments.map((item) => {
          const author = members.data?.find((m) => m.id === item.authorId);
          return (
            <article className="comment" key={item.id}>
              <div className="comment-author">
                {author && <Avatar member={author} />}
                <strong>{author?.name ?? "Teammate"}</strong>
                {author?.kind === "agent" && <Stamp>agent</Stamp>}
                <time dateTime={item.createdAt}>
                  {relativeTime(item.createdAt)}
                </time>
              </div>
              <Markdown>{item.bodyMd}</Markdown>
            </article>
          );
        })}
        {!readonly && (
          <div className="comment-compose">
            <textarea
              aria-label="Write a comment"
              placeholder="Leave a note for your teammates…"
              maxLength={4000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (comment.trim() && !commentMutation.isPending)
                    commentMutation.mutate();
                }
              }}
            />
            <Button
              disabled={!comment.trim() || commentMutation.isPending}
              onClick={() => commentMutation.mutate()}
            >
              Add comment <Kbd>Ctrl ↵</Kbd>
            </Button>
          </div>
        )}
      </section>
      <details className="task-section history">
        <summary>
          History <span className="muted">{task.history.length}</span>
        </summary>
        {task.history
          .slice()
          .reverse()
          .map((event) => (
            <p key={event.seq}>
              <strong>{event.actor.name}</strong> {historyText(event)} ·{" "}
              {relativeTime(event.createdAt)}
            </p>
          ))}
      </details>
      <div className="task-savebar">
        <span className="muted">
          {isDirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <Button onClick={close}>Cancel</Button>
        <Button
          type="submit"
          form="task-form"
          variant="primary"
          disabled={
            !isDirty || !isValid || save.isPending || markPending || readonly
          }
        >
          Save <Kbd>Ctrl+S</Kbd>
        </Button>
      </div>
      {blocker.status === "blocked" && (
        <Dialog title="Discard changes?" onClose={() => blocker.reset?.()}>
          <p>Your changes haven't been saved yet.</p>
          <div className="dialog-actions">
            <Button onClick={() => blocker.reset?.()}>Keep editing</Button>
            <Button
              variant="danger"
              onClick={() => {
                dirty.current = false;
                blocker.proceed?.();
              }}
            >
              Discard
            </Button>
          </div>
        </Dialog>
      )}
      {archive && (
        <Dialog
          title={readonly ? "Unarchive task" : "Archive task"}
          onClose={() => setArchive(false)}
        >
          {!readonly && (
            <>
              <p>Keep this task in the archive. You can bring it back later.</p>
              <label>
                Reason (optional)
                <textarea
                  aria-label="Archive reason"
                  maxLength={4000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {isDirty && (
                <p className="notice">
                  Unsaved edits will be discarded when archived.
                </p>
              )}
            </>
          )}
          <div className="dialog-actions">
            <Button onClick={() => setArchive(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                archiveMutation.mutate();
              }}
            >
              {readonly ? "Unarchive" : "Archive"}
            </Button>
          </div>
        </Dialog>
      )}
      {review && latest && (
        <Dialog
          title="Review changes"
          onClose={() => setReview(false)}
          className="review-dialog"
        >
          <p>{actor} saved a newer version. Compare it with your edits.</p>
          <div className="comparison">
            <div className="comparison-row comparison-head">
              <strong>Field</strong>
              <strong>Was</strong>
              <strong>Theirs</strong>
              <strong>Yours</strong>
            </div>
            {fieldNames
              .filter((field) => field !== "brief")
              .filter(
                (field) =>
                  !equalValue(
                    taskValues(base)[field],
                    taskValues(latest)[field],
                  ) || !equalValue(taskValues(base)[field], values[field]),
              )
              .map((field) => (
                <div className="comparison-row" key={field}>
                  <strong>{field}</strong>
                  {[
                    taskValues(base)[field],
                    taskValues(latest)[field],
                    values[field],
                  ].map((value, index) => (
                    <span key={["was", "theirs", "yours"][index]}>
                      {Array.isArray(value)
                        ? value.join(", ")
                        : String(value ?? "–")}
                    </span>
                  ))}
                </div>
              ))}
            {Object.keys(values.brief)
              .filter((key) => {
                const k = key as keyof typeof values.brief;
                return (
                  !equalValue(base.brief[k], latest.brief[k]) ||
                  !equalValue(base.brief[k], values.brief[k])
                );
              })
              .map((key) => (
                <div className="comparison-row" key={key}>
                  <strong>{key}</strong>
                  {[base.brief, latest.brief, values.brief].map((b, i) => (
                    <span key={["was", "theirs", "yours"][i]}>
                      {JSON.stringify(b[key as keyof typeof values.brief])}
                    </span>
                  ))}
                </div>
              ))}
          </div>
          <div className="dialog-actions">
            <Button onClick={() => resetTask(latest)}>Take theirs</Button>
            <Button
              variant="primary"
              onClick={() => {
                const parsed = taskSchema.safeParse(getValues());
                if (parsed.success) submit(parsed.data, latest.updatedAt);
              }}
            >
              Keep mine
            </Button>
          </div>
        </Dialog>
      )}
    </Drawer>
  );
}
