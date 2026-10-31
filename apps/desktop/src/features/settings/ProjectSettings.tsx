import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Project, ProjectFolderInfo } from "../../bindings";
import { Button, Chip, Dialog, Select } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  type FolderGuard,
  folderContext,
  folderError,
  projectFolders,
  readFolderSettings,
  useFolderGuard,
  writeFolderSettings,
} from "../../lib/project-folder-api";
import {
  selectedContext,
  selectionIdentity,
} from "../../lib/project-selection";
import {
  localDate,
  type Template,
  templates,
} from "../../lib/project-template";
import { relativeTime } from "../../lib/time";
import { useProjectWrite } from "../../lib/use-project-write";
import { BoardRecovery } from "../projects/BoardRecovery";
import { MoveToFolder } from "../projects/MoveToFolder";
import "../projects/project-folders.css";

/** A save acknowledges only its submitted edit revision, never newer typing. */
function DraftField({
  label,
  value,
  type = "text",
  maxLength,
  canSave,
  disabled,
  save,
}: {
  label: string;
  value: string;
  type?: string;
  maxLength?: number;
  canSave: boolean;
  disabled: boolean;
  save(value: string, acknowledged: (normalized: string) => void): boolean;
}) {
  const [draft, setDraft] = useState(value),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const dirtyRef = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(value);
  }, [value]);
  const submit = () => {
    if (!dirtyRef.current || !canSave) return;
    const submittedRevision = revision.current;
    try {
      save(draft, (normalized) => {
        if (submittedRevision === revision.current) {
          dirtyRef.current = false;
          setDirty(false);
          setDraft(normalized);
        }
      });
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="settings-draft-field">
      <input
        aria-label={label}
        type={type}
        maxLength={maxLength}
        disabled={disabled}
        value={draft}
        onChange={(event) => {
          revision.current++;
          dirtyRef.current = true;
          setDirty(true);
          setDraft(event.target.value);
          setError("");
        }}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      {dirty && (
        <div className="settings-draft-actions">
          <small role="status">
            Unsaved changes
            {!canSave && !disabled
              ? " · wait for the current save, then Save"
              : ""}
          </small>
          <Button disabled={!canSave} onClick={submit}>
            Save {label.toLowerCase()}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function ProjectSettings() {
  const project = useQuery({
    queryKey: ["project"],
    queryFn: () => api.getProject(),
  });
  if (project.isPending) return <p role="status">Loading project…</p>;
  return (
    <>
      {project.error && (
        <p role="alert">
          {project.error.message}
          <Button
            disabled={project.isFetching}
            onClick={() => void project.refetch()}
          >
            Retry
          </Button>
        </p>
      )}
      {project.data && (
        <>
          <ProjectForm key={project.data.jam.id} project={project.data} />
          <ProjectFolderSettings
            key={`folder:${project.data.jam.id}`}
            projectId={project.data.jam.id}
            name={project.data.jam.name}
          />
        </>
      )}
    </>
  );
}

type FolderDraft = {
  rules: Record<string, string> | null;
  cwd: string | null;
  recent: number | null;
  daily: number | null;
};
const folderDrafts = new Map<string, FolderDraft>();
export function ProjectFolderSettings({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const capture = useFolderGuard();
  const folderClient = useQueryClient();
  const draftKey = `${selectionIdentity(selectedContext(folderClient))}:${projectId}`;
  const draft = folderDrafts.get(draftKey);
  const [moving, setMoving] = useState(false);
  const [rulesConflict, setRulesConflict] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [rules, setRules] = useState<Record<string, string> | null>(
    draft?.rules ?? null,
  );
  const [cwd, setCwd] = useState<string | null>(draft?.cwd ?? null);
  const [recent, setRecent] = useState<number | null>(draft?.recent ?? null);
  const [daily, setDaily] = useState<number | null>(draft?.daily ?? null);
  useEffect(() => {
    folderDrafts.set(draftKey, { rules, cwd, recent, daily });
  }, [draftKey, rules, cwd, recent, daily]);
  const info = useQuery({
    queryKey: ["project-folder", projectId],
    queryFn: async () => {
      const result = await projectFolders.info();
      if (result.projectId !== projectId)
        throw new Error("No folder project selected for this board");
      return result;
    },
    retry: false,
  });
  const settings = useQuery({
    queryKey: ["settings", projectId],
    queryFn: async () => {
      const result = await readFolderSettings(projectId);
      if (result.projectId !== projectId)
        throw new Error("Project changed — reopen");
      return result;
    },
  });
  const run = async (
    action: (check: FolderGuard, selected?: ProjectFolderInfo) => Promise<void>,
  ) => {
    if (busy) return;
    const selected = info.data;
    setBusy(true);
    setNotice("");
    try {
      const check = await capture();
      await check();
      await action(check, selected);
    } catch (error) {
      setNotice(folderError(error));
    } finally {
      setBusy(false);
    }
  };
  const local =
    /No folder project selected|No project folder selected|No selected project|not found/i.test(
      info.error?.message ?? "",
    );
  return (
    <SettingsSection
      title="Folder"
      description="Your board files and local preferences."
    >
      <div className="folder-settings">
        {info.isPending ? (
          <p role="status">Reading project folder…</p>
        ) : info.error ? (
          <>
            <p role={local ? "status" : "alert"}>
              {local
                ? "This project is stored in app data."
                : folderError(info.error)}
            </p>
            <Button disabled={busy} onClick={() => void info.refetch()}>
              Reload folder
            </Button>
            {local && (
              <Button onClick={() => setMoving(true)}>Move to folder…</Button>
            )}
          </>
        ) : (
          info.data && (
            <>
              <SettingsRow label="Project folder">
                <span className="folder-path">{info.data.folder}</span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async (check, selected) => {
                      if (!selected) return;
                      const context = folderContext(selected);
                      await check();
                      const current = await projectFolders.info();
                      await check();
                      if (
                        current.instanceId !== context.instanceId ||
                        current.selectionEpoch !== context.selectionEpoch
                      )
                        throw new Error("Stale selection epoch");
                      await api.showInFolder(selected.folder);
                      await check();
                    })
                  }
                >
                  Reveal
                </Button>
              </SettingsRow>
              <SettingsRow label="Repository" hint="Detected for this project.">
                <span className="folder-path">
                  {info.data.manifest.repository?.rootRelative ??
                    "No repository found"}
                </span>
              </SettingsRow>
              <SettingsRow
                label="Folder rules"
                hint="Where copied files go inside the project folder."
              >
                <div className="folder-rules">
                  {Object.entries(rules ?? info.data.manifest.folderRules).map(
                    ([kind, path]) => (
                      <label key={kind}>
                        {ruleLabels[kind] ?? kind}
                        <input
                          aria-label={`${ruleLabels[kind] ?? kind} folder`}
                          value={path}
                          disabled={busy}
                          onChange={(e) =>
                            setRules({
                              ...(rules ?? info.data?.manifest.folderRules),
                              [kind]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
                <div className="button-row">
                  <Button
                    disabled={busy || !rules}
                    onClick={() =>
                      void run(async (check, selected) => {
                        if (!selected || !rules) return;
                        const context = folderContext(selected);
                        await check();
                        let result: ProjectFolderInfo;
                        try {
                          result = await projectFolders.rules(
                            context,
                            rules,
                            selected.manifestRevision,
                          );
                        } catch (error) {
                          if (/revision|stale|conflict/i.test(String(error))) {
                            setRulesConflict(true);
                            throw new Error(
                              "Folder rules changed elsewhere. Reload them before saving; your edits are kept.",
                            );
                          }
                          throw error;
                        }
                        await check();
                        infoClient(result);
                        setRules(null);
                        setRulesConflict(false);
                        setNotice("Folder rules saved.");
                      })
                    }
                  >
                    Save folder rules
                  </Button>
                  {rulesConflict && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async (check) => {
                          const result = await info.refetch();
                          await check();
                          if (result.error) throw result.error;
                          setRules(null);
                          setRulesConflict(false);
                          setNotice(
                            "Folder rules reloaded. Reapply your edits before saving.",
                          );
                        })
                      }
                    >
                      Reload folder rules
                    </Button>
                  )}
                </div>
              </SettingsRow>
              <SettingsRow
                label="board.json"
                hint="A readable copy of the board for git. Saved automatically."
              >
                <p
                  title={
                    info.data.lastSnapshotAt
                      ? new Date(info.data.lastSnapshotAt).toLocaleString()
                      : undefined
                  }
                >
                  Last saved:{" "}
                  {info.data.lastSnapshotAt
                    ? relativeTime(info.data.lastSnapshotAt, now)
                    : "Not saved yet"}
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async (check, selected) => {
                      if (!selected) return;
                      const context = folderContext(selected);
                      await check();
                      await projectFolders.save(context);
                      await check();
                      const refreshed = await projectFolders.info();
                      await check();
                      infoClient(refreshed);
                      setNotice("board.json saved now.");
                    })
                  }
                >
                  Save now
                </Button>
              </SettingsRow>
              <BoardRecovery
                folder={info.data.folder}
                info={info.data}
                onRecovered={async () => {
                  await info.refetch();
                }}
              />
            </>
          )
        )}
        {settings.error && <p role="alert">{folderError(settings.error)}</p>}
        {settings.data && (
          <>
            <SettingsRow
              label="Working directory"
              hint="Where agents work, for example your Unity project."
            >
              <input
                aria-label="Working directory"
                value={cwd ?? settings.data.workingDirectory ?? ""}
                onChange={(e) => setCwd(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow
              label="Local backup retention"
              hint="Safety backups are kept separately."
            >
              <div className="folder-rules">
                <label>
                  Recent backups
                  <input
                    aria-label="Recent backups"
                    type="number"
                    min={1}
                    max={100}
                    value={recent ?? settings.data.backupRecentCount ?? 10}
                    onChange={(e) => setRecent(Number(e.target.value))}
                  />
                </label>
                <label>
                  Daily backups
                  <input
                    aria-label="Daily backups"
                    type="number"
                    min={1}
                    max={100}
                    value={daily ?? settings.data.backupDailyCount ?? 7}
                    onChange={(e) => setDaily(Number(e.target.value))}
                  />
                </label>
              </div>
            </SettingsRow>
            <Button
              disabled={busy || settings.isPending}
              onClick={() =>
                void run(async (check) => {
                  const r = recent ?? settings.data?.backupRecentCount ?? 10,
                    d = daily ?? settings.data?.backupDailyCount ?? 7;
                  if (
                    ![r, d].every(
                      (n) => Number.isInteger(n) && n > 0 && n <= 100,
                    )
                  )
                    throw new Error("Use backup counts from 1 to 100.");
                  await check();
                  await writeFolderSettings(
                    projectId,
                    {
                      workingDirectory: cwd ?? settings.data?.workingDirectory,
                      backupRecentCount: r,
                      backupDailyCount: d,
                    },
                    check.context,
                  );
                  await check();
                  await settings.refetch();
                  await check();
                  setNotice("Local folder settings saved.");
                })
              }
            >
              Save local settings
            </Button>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
        {moving && (
          <MoveToFolder
            projectId={projectId}
            name={name}
            onClose={() => setMoving(false)}
            onMoved={async () => {
              await info.refetch();
            }}
          />
        )}
      </div>
    </SettingsSection>
  );
  function infoClient(result: ProjectFolderInfo) {
    folderClient.setQueryData(["project-folder", projectId], result);
  }
}
function ProjectForm({ project }: { project: Project }) {
  const j = project.jam,
    client = useQueryClient();
  const write = useProjectWrite(`project-settings:${j.id}`, j.id);
  const [proposed, setProposed] = useState<Template | null>(null);
  const section = useRef<HTMLElement>(null),
    templateActions = useRef<HTMLDivElement>(null),
    restoreTemplate = useRef(false);
  useEffect(() => {
    if (!write.pending && !proposed && restoreTemplate.current) {
      restoreTemplate.current = false;
      section.current
        ?.querySelector<HTMLElement>(
          '[role="combobox"][aria-label="Project template"]',
        )
        ?.focus();
    }
  }, [write.pending, proposed]);
  const template = (j.template ?? "game_jam") as Template;
  const update = (
    patch: Partial<Parameters<typeof api.updateProject>[0]>,
    complete?: (result: Project) => void,
  ) => {
    const input = { template, milestoneAt: j.milestoneAt, ...patch };
    return write.run(
      () => api.updateProject(input),
      (result) => {
        client.setQueryData(["project"], result);
        for (const key of ["app", "board", "projects"])
          void client.invalidateQueries({ queryKey: [key] });
        complete?.(result);
      },
    );
  };
  const fieldState = {
    canSave: write.ready,
    disabled: write.changed || write.checking || !!write.contextError,
  };
  const date = (value: string, label: string) => {
    if (!value) throw new Error(`Choose a ${label} date and time.`);
    const result = new Date(value);
    if (Number.isNaN(result.getTime()))
      throw new Error(`Enter a valid ${label} date and time.`);
    return result.toISOString();
  };
  const switchTo = (t: Template) =>
    update(
      {
        template: t,
        milestoneAt: t === "game_jam" || t === "custom" ? null : j.milestoneAt,
        startsAt:
          t === "game_jam" ? (j.startsAt ?? new Date().toISOString()) : null,
        endsAt:
          t === "game_jam"
            ? (j.endsAt ?? new Date(Date.now() + 48 * 3600000).toISOString())
            : null,
      },
      () => {
        restoreTemplate.current = true;
        setProposed(null);
      },
    );
  return (
    <SettingsSection
      ref={section}
      title="Your project"
      description="Changes save on leaving a field. If another save is in progress, newer edits stay unsaved until you choose Save."
    >
      <SettingsRow label="Name">
        <DraftField
          {...fieldState}
          label="Project name"
          value={j.name}
          maxLength={60}
          save={(value, ack) => {
            if (!value.trim()) throw new Error("Enter a project name.");
            return update({ name: value }, (result) => ack(result.jam.name));
          }}
        />
      </SettingsRow>
      <SettingsRow
        label="Template"
        hint="Changes suggestions and dates. Existing work stays here."
      >
        <Select
          aria-label="Project template"
          disabled={!write.ready}
          value={template}
          onChange={(event) => setProposed(event.target.value as Template)}
        >
          {templates.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </SettingsRow>
      {template === "game_jam" ? (
        <>
          <SettingsRow label="Start">
            <DraftField
              {...fieldState}
              label="Project start"
              type="datetime-local"
              value={localDate(j.startsAt)}
              save={(value, ack) =>
                update({ startsAt: date(value, "start") }, (result) =>
                  ack(localDate(result.jam.startsAt)),
                )
              }
            />
          </SettingsRow>
          <SettingsRow label="End">
            <DraftField
              {...fieldState}
              label="Project end"
              type="datetime-local"
              value={localDate(j.endsAt)}
              save={(value, ack) =>
                update({ endsAt: date(value, "end") }, (result) =>
                  ack(localDate(result.jam.endsAt)),
                )
              }
            />
          </SettingsRow>
          <SettingsRow label="Timezone">
            <DraftField
              {...fieldState}
              label="Project timezone"
              value={j.timezone}
              save={(value, ack) =>
                update({ timezone: value }, (result) =>
                  ack(result.jam.timezone),
                )
              }
            />
          </SettingsRow>
        </>
      ) : template !== "custom" ? (
        <SettingsRow label="Milestone (optional)">
          <DraftField
            {...fieldState}
            label="Project milestone"
            type="datetime-local"
            value={localDate(j.milestoneAt)}
            save={(value, ack) =>
              update(
                { milestoneAt: value ? date(value, "milestone") : null },
                (result) => ack(localDate(result.jam.milestoneAt)),
              )
            }
          />
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Key prefix"
        hint="Chosen when the project is created. Existing keys never change."
      >
        <code>{j.keyPrefix}</code>
      </SettingsRow>
      <SettingsRow label="Tag suggestions">
        <div className="button-row">
          {project.tagSuggestions.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
          {template === "custom" && (
            <span className="muted">No suggestions · use your own tags</span>
          )}
        </div>
      </SettingsRow>
      {!proposed && (
        <ProjectWriteFeedback
          write={write}
          action="Saving project"
          focusPending={false}
        />
      )}
      {proposed && (
        <Dialog
          title="Switch template?"
          busy={write.pending}
          onClose={() => write.dismiss(() => setProposed(null))}
        >
          <p>Tags already used stay; suggestions and the timer change.</p>
          <ProjectWriteFeedback
            write={write}
            action="Switching template"
            form={templateActions}
          />
          <div className="dialog-actions" ref={templateActions}>
            <Button
              disabled={write.pending}
              onClick={() => write.dismiss(() => setProposed(null))}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              data-write-focus
              disabled={!write.ready}
              onClick={() => switchTo(proposed)}
            >
              Switch template
            </Button>
          </div>
        </Dialog>
      )}
    </SettingsSection>
  );
}

const ruleLabels: Record<string, string> = {
  sprite: "Sprites",
  audio: "Audio",
  model: "Models",
  document: "Documents",
  level: "Levels",
  font: "Fonts",
  other: "Other",
};
