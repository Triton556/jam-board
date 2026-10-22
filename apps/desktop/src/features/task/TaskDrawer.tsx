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
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Markdown } from "../../components/Markdown";
import {
  Button,
  Combobox,
  DateTimeInput,
  Dialog,
  Drawer,
  IconButton,
  Kbd,
  type ModalFocusReturn,
  SegmentedControl,
  Select,
  Stamp,
  TabPanels,
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
import { AgentPlan } from "../plan/AgentPlan";
import { BrainHandoff } from "../plan/BrainHandoff";
import { ReferencesSection } from "../references/ReferencesSection";
import { BriefEditor } from "./BriefEditor";
import { historyText } from "./history-text";
import { announceReady, ReadinessStrip } from "./Readiness";
import { ReleaseClaim } from "./ReleaseClaim";
import { Rounds } from "./Rounds";
import { TaskComments } from "./TaskComments";
import { TaskConflictDialog } from "./TaskConflictDialog";
import type { TaskFields } from "./task-form";
import {
  briefSchema,
  equalValue,
  fieldNames,
  taskPatch,
  taskSchema,
  taskValues,
} from "./task-form";

export function TaskDrawer({
  taskKey,
  close,
  returnFocus,
}: {
  taskKey: string;
  close(): void;
  returnFocus?: ModalFocusReturn;
}) {
  const task = useQuery({
    queryKey: ["task", taskKey],
    queryFn: () => api.getTask(taskKey),
  });
  if (task.data)
    return (
      <TaskEditor
        key={taskKey}
        task={task.data}
        close={close}
        returnFocus={returnFocus}
      />
    );
  return (
    <Drawer onClose={close} title={taskKey} returnFocus={returnFocus}>
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
  returnFocus,
}: {
  task: TaskDetail;
  close(): void;
  returnFocus?: ModalFocusReturn;
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
  // A detached editor must not refill another project/entity view on completion.
  const saveOwner = useRef({ mounted: true, invalidated: false });
  useEffect(() => {
    saveOwner.current.mounted = true;
    const check = () => {
      const selected = client.getQueryData<
        Awaited<ReturnType<typeof api.appState>>
      >(["app"])?.jam?.id;
      if (selected && selected !== task.jamId)
        saveOwner.current.invalidated = true;
    };
    check();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      saveOwner.current.mounted = false;
      unsubscribe();
    };
  }, [client, task.jamId]);
  const ownsSave = () =>
    saveOwner.current.mounted &&
    !saveOwner.current.invalidated &&
    client.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])?.jam
      ?.id === task.jamId;
  const [base, setBase] = useState(task);
  const seenVersions = useRef(new Set([task.updatedAt]));
  const [latest, setLatest] = useState<TaskDetail | null>(null);
  const [review, setReview] = useState(false);
  const [reviewError, setReviewError] = useState<Error | null>(null);
  const [assetLink, setAssetLink] = useState(false);
  const [menu, setMenu] = useState(false);
  const [archive, setArchive] = useState(false);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState("Write");
  const notesTabs = useId();
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
    setReviewError(null);
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
  const conflictRead = useMutation({
    mutationFn: async () => {
      if (!ownsSave())
        throw new Error("The editor target changed before rereading.");
      const fresh = await api.getTask(task.key);
      if (fresh.id !== task.id || fresh.jamId !== task.jamId)
        throw new Error(
          "The project or task changed. Your draft was not retargeted.",
        );
      return fresh;
    },
    onSuccess: (fresh) => {
      if (!ownsSave()) return;
      client.setQueryData(["task", task.key], fresh);
      setLatest(fresh);
      setReviewError(null);
      setReview(true);
    },
  });
  const save = useMutation({
    mutationFn: (input: UpdateInput) => {
      if (!ownsSave())
        throw new Error("The editor target changed before this save was sent.");
      return api.updateTask(input);
    },
    onMutate: (input) => {
      setSaveNotice("");
      setReviewError(null);
      const values = structuredClone(getValues());
      const baseline = taskValues(base);
      return {
        values,
        fromReview: review,
        retained: fieldNames.filter(
          (field) =>
            !(field in input) && !equalValue(values[field], baseline[field]),
        ),
      };
    },
    onSuccess: (value, _input, submitted) => {
      if (!ownsSave()) return;
      const current = getValues();
      client.setQueryData(["task", task.key], value);
      resetTask(value);
      // A section autosave acknowledges only its submitted fields. Preserve
      // unrelated human drafts AND typing made while that save was in flight.
      for (const field of fieldNames) {
        if (
          submitted &&
          (submitted.retained.includes(field) ||
            !equalValue(current[field], submitted.values[field]))
        )
          form.setValue(field, current[field], {
            shouldDirty: true,
            shouldValidate: true,
          });
      }
      invalidate();
      if (submitted?.fromReview)
        useUiStore
          .getState()
          .notify("Edits saved against the reviewed version.");
    },
    onError: async (error, input, submitted) => {
      if (!ownsSave()) return;
      if (submitted?.fromReview) {
        setReviewError(error);
        if ("code" in error && error.code === "conflict") {
          try {
            const fresh = await api.getTask(task.key);
            if (ownsSave()) setLatest(fresh);
          } catch {
            /* The captured comparison and error remain; explicit reread can retry. */
          }
        }
        return;
      }
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
        conflictRead.mutate();
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
        if (!ownsSave()) return;
        checking = true;
        const check = await api.checkReady(captured.key);
        if (!ownsSave()) return;
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
  const saveBrief = (nextFocus?: EventTarget | null) => {
    // Do not preempt the explicit form Save with a competing blur autosave.
    if (
      nextFocus instanceof HTMLButtonElement &&
      nextFocus.type === "submit" &&
      nextFocus.form?.id === "task-form"
    )
      return;
    if (
      task.archivedAt ||
      save.isPending ||
      conflictRead.isPending ||
      markLock.current ||
      review ||
      !ownsSave()
    )
      return;
    const brief = structuredClone(getValues("brief"));
    if (equalValue(brief, taskValues(base).brief)) return;
    const parsed = briefSchema.safeParse(brief);
    if (!parsed.success) {
      void form.trigger("brief");
      return;
    }
    save.mutate({
      key: task.key,
      expectedUpdatedAt: base.updatedAt,
      brief: parsed.data,
    });
  };
  const submitRef = useRef(() => {});
  submitRef.current = () => {
    if (
      isDirty &&
      !task.archivedAt &&
      !save.isPending &&
      !conflictRead.isPending &&
      !markLock.current &&
      !review
    )
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
      returnFocus={returnFocus}
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
          Save your description before asking the brain to read it.
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
          <div className="section-heading">
            <h2>Description</h2>
            <Tabs
              id={notesTabs}
              label="Description editor mode"
              value={tab}
              onChange={setTab}
              items={["Write", "Preview"]}
            />
          </div>
          <p className="field-hint">
            Describe what you want in your own words. Add wishes, context or
            corrections; the brain can turn them into a plan.
          </p>
          <TabPanels id={notesTabs} value={tab} items={["Write", "Preview"]}>
            {tab === "Write" ? (
              <textarea
                aria-label="Description"
                className="description-input"
                placeholder="What should this task do, and what matters to you?"
                {...register("descriptionMd")}
              />
            ) : (
              <Markdown>
                {watch("descriptionMd") || "*No description yet.*"}
              </Markdown>
            )}
          </TabPanels>
          {!values.descriptionMd.trim() && values.brief.goalMd.trim() && (
            <section
              className="human-plan-preview"
              aria-label="Existing planned outcome"
            >
              <h3>From the agent plan</h3>
              <p className="small muted">
                Existing goal, shown for context. It has not been copied into
                your description.
              </p>
              <Markdown>{values.brief.goalMd}</Markdown>
            </section>
          )}
          <TaskComments
            task={task}
            members={members.data ?? []}
            changed={invalidate}
          />
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
        </fieldset>
        <AgentPlan
          summary={`${values.brief.changes.length} changes · ${values.brief.tests.length} checks`}
        >
          <fieldset disabled={readonly || save.isPending || markPending}>
            <Controller
              name="brief"
              control={control}
              render={({ field }) => (
                <BriefEditor
                  value={field.value}
                  onChange={field.onChange}
                  onSave={saveBrief}
                  disabled={readonly}
                />
              )}
            />
          </fieldset>
        </AgentPlan>
        {errors.brief && (
          <p role="alert">
            Open Agent plan and complete required Change and Test fields before
            saving.
          </p>
        )}
      </form>
      {saveNotice && (
        <p role="alert" className="notice">
          {saveNotice}
        </p>
      )}
      {conflictRead.isPending && (
        <p role="status">
          The task changed. Reading the latest saved version; your edits are
          kept…
        </p>
      )}
      {conflictRead.error && (
        <div className="notice">
          <p role="alert">
            The task changed, but its latest version could not be read:{" "}
            {conflictRead.error.message}. Your edits are kept.
          </p>
          <Button
            disabled={conflictRead.isPending}
            onClick={() => conflictRead.mutate()}
          >
            Read latest version
          </Button>
        </div>
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
            !isDirty ||
            !isValid ||
            save.isPending ||
            conflictRead.isPending ||
            markPending ||
            readonly
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
        <TaskConflictDialog
          base={base}
          latest={latest}
          yours={values}
          live={task}
          members={members.data ?? []}
          actor={actor}
          pending={save.isPending}
          error={reviewError}
          close={() => {
            setReview(false);
            setReviewError(null);
          }}
          read={(fresh) => {
            setLatest(fresh);
            setReviewError(null);
            client.setQueryData(["task", task.key], fresh);
          }}
          discard={(fresh) => {
            resetTask(fresh);
            useUiStore
              .getState()
              .notify(
                "Local edits discarded. Loaded the reviewed saved version.",
              );
          }}
          save={(snapshot) => {
            const patch = taskPatch(
              taskValues(snapshot.base),
              snapshot.yours,
              taskValues(snapshot.remote),
            );
            if (Object.keys(patch).length)
              save.mutate({
                key: snapshot.remote.key,
                expectedUpdatedAt: snapshot.remote.updatedAt,
                ...patch,
              });
            else resetTask(snapshot.remote);
          }}
        />
      )}
    </Drawer>
  );
}
