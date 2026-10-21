import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Chip, Dialog, Select } from "../../components/ui";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  localDate,
  type Template,
  templates,
} from "../../lib/project-template";
export function ProjectSettings() {
  const client = useQueryClient();
  const project = useQuery({
    queryKey: ["project"],
    queryFn: () => api.getProject(),
  });
  const j = project.data?.jam;
  const [proposed, setProposed] = useState<Template | null>(null);
  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.updateProject>[0]) =>
      api.updateProject(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["project"] });
      await client.invalidateQueries({ queryKey: ["app"] });
      await client.invalidateQueries({ queryKey: ["board"] });
    },
  });
  if (project.isPending) return <p role="status">Loading project…</p>;
  if (project.error)
    return (
      <p role="alert">
        {project.error.message}
        <Button onClick={() => void project.refetch()}>Retry</Button>
      </p>
    );
  if (!j) return null;
  const template = (j.template ?? "game_jam") as Template;
  const update = (patch: Partial<Parameters<typeof api.updateProject>[0]>) =>
    save.mutate({ template, milestoneAt: j.milestoneAt, ...patch });
  const switchTo = (t: Template) => {
    update({
      template: t,
      milestoneAt: t === "game_jam" || t === "custom" ? null : j.milestoneAt,
      startsAt:
        t === "game_jam" ? (j.startsAt ?? new Date().toISOString()) : null,
      endsAt:
        t === "game_jam"
          ? (j.endsAt ?? new Date(Date.now() + 48 * 3600000).toISOString())
          : null,
    });
    setProposed(null);
  };
  return (
    <SettingsSection
      title="Your project"
      description="A template changes suggestions and dates. Your work stays here."
    >
      <SettingsRow label="Name">
        <input
          aria-label="Project name"
          key={j.name}
          defaultValue={j.name}
          maxLength={60}
          onBlur={(e) => {
            if (e.target.value.trim() !== j.name)
              update({ name: e.target.value });
          }}
        />
      </SettingsRow>
      <SettingsRow label="Template">
        <Select
          aria-label="Project template"
          value={template}
          onChange={(e) => setProposed(e.target.value as Template)}
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
            <input
              aria-label="Project start"
              type="datetime-local"
              key={j.startsAt}
              defaultValue={localDate(j.startsAt)}
              onBlur={(e) => {
                if (e.target.value)
                  update({ startsAt: new Date(e.target.value).toISOString() });
              }}
            />
          </SettingsRow>
          <SettingsRow label="End">
            <input
              aria-label="Project end"
              type="datetime-local"
              key={j.endsAt}
              defaultValue={localDate(j.endsAt)}
              onBlur={(e) => {
                if (e.target.value)
                  update({ endsAt: new Date(e.target.value).toISOString() });
              }}
            />
          </SettingsRow>
          <SettingsRow label="Timezone">
            <input
              aria-label="Project timezone"
              key={j.timezone}
              defaultValue={j.timezone}
              onBlur={(e) => update({ timezone: e.target.value })}
            />
          </SettingsRow>
        </>
      ) : template !== "custom" ? (
        <SettingsRow label="Milestone (optional)">
          <input
            aria-label="Project milestone"
            type="datetime-local"
            key={j.milestoneAt}
            defaultValue={localDate(j.milestoneAt)}
            onBlur={(e) =>
              update({
                milestoneAt: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null,
              })
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
          {project.data.tagSuggestions.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
          {template === "custom" && (
            <span className="muted">No suggestions · use your own tags</span>
          )}
        </div>
      </SettingsRow>
      {save.error && (
        <p role="alert" className="field-error">
          {save.error.message}
        </p>
      )}
      {proposed && (
        <Dialog title="Switch template?" onClose={() => setProposed(null)}>
          <p>Tags already used stay; suggestions and the timer change.</p>
          <div className="dialog-actions">
            <Button onClick={() => setProposed(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => switchTo(proposed)}>
              Switch template
            </Button>
          </div>
        </Dialog>
      )}
    </SettingsSection>
  );
}
