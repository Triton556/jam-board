import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { useProjectWrite } from "../../lib/use-project-write";
import { linkChoices, type ReferenceChoice } from "./linking";

const recentTargets = new Map<string, string[]>();
export function LinkTargetDialog({
  choices,
  targets,
  projectId,
  close,
  saved,
  link = linkChoices,
}: {
  choices: ReferenceChoice[];
  targets: { key: string; title: string; kind: string }[];
  projectId: string;
  close(): void;
  saved(): Promise<unknown>;
  link?(
    choices: ReferenceChoice[],
    key: string,
    projectId?: string,
  ): Promise<unknown>;
}) {
  const [key, setKey] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const write = useProjectWrite("canvas-link-selection", projectId);
  useEffect(() => {
    form.current
      ?.querySelector<HTMLButtonElement>('[role="combobox"]')
      ?.focus();
  }, []);
  const recent = recentTargets.get(projectId) ?? [];
  const sorted = [...targets].sort((a, b) => {
    const ai = recent.indexOf(a.key),
      bi = recent.indexOf(b.key);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
  });
  return (
    <Dialog
      title="Link to work"
      onClose={() => {
        write.dismiss(close);
      }}
      busy={write.pending}
    >
      <form
        className="m5-form"
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!key) return;
          write.run(
            () => link(choices, key, projectId),
            () => {
              recentTargets.set(
                projectId,
                [key, ...recent.filter((k) => k !== key)].slice(0, 8),
              );
              close();
              void saved();
            },
          );
        }}
      >
        <CustomSelect
          searchable
          label="Search by key or title"
          value={key}
          onChange={setKey}
          disabled={!write.ready}
          options={sorted.map((target) => ({
            value: target.key,
            label: `${target.key} · ${target.title}`,
            group: recent.includes(target.key)
              ? "Recent"
              : ({ epic: "Epics", story: "Stories", task: "Tasks" }[
                  target.kind
                ] ?? target.kind),
          }))}
        />
        <ProjectWriteFeedback
          write={write}
          form={form}
          action="Linking references"
        />
        <Button type="submit" variant="primary" disabled={!key || !write.ready}>
          {write.pending ? "Linking…" : `Link ${choices.length}`}
        </Button>
      </form>
    </Dialog>
  );
}
