import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../../bindings";
import { Button, Chip, Dialog, Select } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  localDate,
  type Template,
  templates,
} from "../../lib/project-template";
import { useProjectWrite } from "../../lib/use-project-write";

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
        <ProjectForm key={project.data.jam.id} project={project.data} />
      )}
    </>
  );
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
