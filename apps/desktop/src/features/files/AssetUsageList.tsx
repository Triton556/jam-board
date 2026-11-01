import type { AssetUsage } from "../../bindings";
import { Button } from "../../components/ui";

export type FileTarget = {
  type: "task" | "epic" | "story" | "project" | "canvas" | "asset";
  key?: string;
  id?: string;
};
export function AssetUsageList({
  usage,
  openTarget,
}: {
  usage: AssetUsage;
  openTarget?(target: FileTarget): void;
}) {
  const groups: {
    title: string;
    rows: { label: string; target: FileTarget }[];
  }[] = [
    {
      title: "Tasks",
      rows: [
        ...usage.tasks.map((t) => ({
          label: `${t.key} · ${t.title}`,
          target: { type: "task" as const, key: t.key },
        })),
        ...usage.covers.map((key) => ({
          label: `${key} · Cover`,
          target: { type: "task" as const, key },
        })),
      ],
    },
    ...(["epic", "story", "project"] as const).map((type) => ({
      title:
        type === "epic" ? "Epics" : type === "story" ? "Stories" : "Project",
      rows: usage.scopes
        .filter((s) => s.type === type)
        .map((s) => ({
          label:
            type === "project"
              ? "Project documents"
              : `${s.key ? `${s.key} · ` : ""}${s.title}`,
          target: { type, key: s.key ?? undefined },
        })),
    })),
    {
      title: "Canvas",
      rows: usage.canvas.map((c) => ({
        label: c.frameTitle?.trim() || "Canvas",
        target: { type: "canvas" as const, id: c.itemId },
      })),
    },
    {
      title: "Components",
      rows: usage.components.map((id) => ({
        label: id,
        target: { type: "asset" as const, id },
      })),
    },
  ];
  return (
    <div className="file-usage-list">
      {groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            {g.rows.map((row) =>
              openTarget ? (
                <Button
                  key={`${row.target.type}:${row.target.key ?? row.target.id}:${row.label}`}
                  onClick={() => openTarget(row.target)}
                >
                  {row.label}
                </Button>
              ) : (
                <p
                  key={`${row.target.type}:${row.target.key ?? row.target.id}:${row.label}`}
                >
                  {row.label}
                </p>
              ),
            )}
          </section>
        ))}
    </div>
  );
}
