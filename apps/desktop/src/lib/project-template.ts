export const templates = [
  {
    value: "game_jam",
    label: "Game jam",
    description: "A short sprint with a countdown.",
    detail: "Countdown timer · jam tags · 48 h default end",
    placeholder: "Cozy Jam 48",
    heading: "The jam board",
    note: "Make something small & wonderful",
    icon: "✳",
  },
  {
    value: "gamedev",
    label: "Gamedev",
    description: "A longer game project with milestones.",
    detail: "Optional milestone · gamedev tags",
    placeholder: "Lantern Quest",
    heading: "The project board",
    note: "One level at a time",
    icon: "◈",
  },
  {
    value: "webapp",
    label: "Web app",
    description: "A product with frontend and backend work.",
    detail: "Optional milestone · webapp tags",
    placeholder: "Ledger app",
    heading: "The product board",
    note: "Ship small, ship often",
    icon: "⌘",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Start blank.",
    detail: "No timer · no tag suggestions",
    placeholder: "My project",
    heading: "The board",
    note: "A place for every little idea",
    icon: "✎",
  },
] as const;
export type Template = (typeof templates)[number]["value"];
export function templateInfo(value?: string) {
  return templates.find((t) => t.value === value) ?? templates[0];
}
export function tagSuggestions(template: string) {
  return template === "custom"
    ? []
    : template === "webapp"
      ? ["frontend", "backend", "design", "api", "infra", "qa", "bug", "docs"]
      : template === "gamedev"
        ? [
            "gameplay",
            "level-design",
            "art",
            "audio",
            "ui",
            "tech",
            "narrative",
            "qa",
            "bug",
          ]
        : ["gameplay", "art", "audio", "ui", "tech", "polish", "bug"];
}
export function localDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
}
export function milestoneLabel(
  template: string | undefined,
  date: string | null | undefined,
) {
  return template !== "game_jam" && template !== "custom" && date
    ? `Milestone · ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(date))}`
    : null;
}
