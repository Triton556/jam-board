import { agentDockApi } from "../../lib/agent-dock";
import type { AgentDockEvent, ConfigOption } from "../../lib/agent-dock-api";
import { useUiStore } from "../../lib/ui-store";
import { useBrainState } from "./brain-store";

export const pendingSessionChoices = new Map<
  string,
  { model?: string; effort?: string }
>();
const cachedSeq = new Map<string, number>();
export function processSessionOptions(projectId: string) {
  const state = useBrainState.getState();
  if (state.projectId !== projectId) return;
  const latestByProfile = new Map(
    [...state.sessions]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((s) => [s.profileId, s.id]),
  );
  for (const session of state.sessions) {
    const config = state.events[session.id]
      ?.filter((e) => e.kind === "config_options")
      .at(-1);
    if (
      config &&
      latestByProfile.get(session.profileId) === session.id &&
      cachedSeq.get(session.id) !== config.seq
    ) {
      cachedSeq.set(session.id, config.seq);
      rememberConnection(session.profileId, { options: config.options });
    }
    const choice = pendingSessionChoices.get(session.id);
    if (choice && ["stopped", "failed"].includes(session.status)) {
      pendingSessionChoices.delete(session.id);
      useBrainState.setState((s) => ({
        configuring: { ...s.configuring, [session.id]: false },
      }));
      continue;
    }
    if (
      !choice ||
      session.status !== "ready" ||
      (!config && session.capabilities.configOptions)
    )
      continue;
    pendingSessionChoices.delete(session.id);
    void (async () => {
      for (const [category, value] of [
        ["model", choice.model],
        ["thought_level", choice.effort],
      ]) {
        if (useBrainState.getState().projectId !== projectId) return;
        const option = sessionOptions(
          useBrainState.getState().events[session.id] ?? [],
        ).find((o) => optionCategory(o) === category);
        if (
          value &&
          option &&
          option.value !== value &&
          (session.kind === "api" ||
            option.values.some((v) => v.value === value))
        )
          await agentDockApi.setConfigOption({
            sessionId: session.id,
            optionId: option.id,
            value,
          });
      }
    })()
      .catch((error) =>
        useUiStore
          .getState()
          .error(`Could not apply session choices: ${String(error)}`),
      )
      .finally(() =>
        useBrainState.setState((s) => ({
          configuring: { ...s.configuring, [session.id]: false },
        })),
      );
  }
}

const storageKey = "jam.brainPreferences";
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  if (saved && typeof saved === "object" && !Array.isArray(saved))
    useUiStore.setState({ brainPreferences: saved });
} catch {
  /* Preferences are optional. */
}

export function rememberConnection(
  id: string,
  patch: Partial<ReturnType<typeof connectionPreferences>>,
) {
  const brainPreferences = {
    ...useUiStore.getState().brainPreferences,
    [id]: { ...connectionPreferences(id), ...patch },
  };
  useUiStore.setState({ brainPreferences });
  try {
    localStorage.setItem(storageKey, JSON.stringify(brainPreferences));
  } catch {
    /* Keep the in-memory choice when storage is unavailable. */
  }
}
export function connectionPreferences(id: string) {
  return useUiStore.getState().brainPreferences[id] ?? {};
}
export function rememberModel(id: string, model: string) {
  const recent = [
    model,
    ...(connectionPreferences(id).recent ?? []).filter((x) => x !== model),
  ].slice(0, 8);
  rememberConnection(id, { model, recent });
}
export function sessionOptions(events: AgentDockEvent[]): ConfigOption[] {
  return (
    events.filter((e) => e.kind === "config_options").at(-1)?.options ?? []
  );
}
export function optionCategory(option: ConfigOption) {
  return option.category ?? "other";
}
export function optionLabel(option?: ConfigOption) {
  return (
    option?.values.find((v) => v.value === option.value)?.name ??
    option?.value ??
    ""
  );
}
export function sessionModel(events: AgentDockEvent[]) {
  return optionLabel(
    sessionOptions(events).find((o) => optionCategory(o) === "model"),
  );
}
const fullAutoCopy =
  "Runs commands and edits files without asking. Use only in a folder you can afford to lose.";
const accessCopy: Record<string, [string, string]> = {
  default: [
    "Ask first",
    "Asks before editing files, running commands or changing the board.",
  ],
  acceptEdits: [
    "Auto-edit files",
    "Edits files without asking; asks for everything else.",
  ],
  plan: ["Plan only", "Reads and proposes a plan; changes nothing."],
  bypassPermissions: ["Full auto", fullAutoCopy],
  "full-access": ["Full auto", fullAutoCopy],
  "read-only": ["Read only", "Reads files without changing them."],
};
export type AccessKind = "claude" | "codex" | "other";
export function connectionAccessKind(profile?: {
  preset: string | null;
  command: string | null;
  id: string;
}): AccessKind {
  const identity = [profile?.preset, profile?.command, profile?.id].join(" ");
  return /claude/i.test(identity)
    ? "claude"
    : /codex/i.test(identity)
      ? "codex"
      : "other";
}
export function accessLabel(
  value: ConfigOption["values"][number],
  kind: AccessKind = "other",
) {
  const copy =
    value.value === "auto"
      ? kind === "claude"
        ? [
            "Auto (Claude decides)",
            "Runs safe actions itself; asks or blocks risky ones.",
          ]
        : kind === "codex"
          ? [
              "Work in project",
              "Edits and runs commands inside the project folder; asks for network and anything outside.",
            ]
          : undefined
      : accessCopy[value.value];
  return {
    label: copy?.[0] ?? value.name,
    description: copy?.[1] ?? value.description ?? "",
    danger: ["bypassPermissions", "full-access"].includes(value.value),
  };
}
export function configDivider(
  events: AgentDockEvent[],
  index: number,
  kind: AccessKind = "other",
) {
  const event = events[index];
  if (
    event?.kind !== "config_options" ||
    !events.slice(0, index).some((e) => e.kind === "user_message")
  )
    return "";
  const previous = sessionOptions(events.slice(0, index));
  const changed = event.options.filter((o) =>
    previous.some((p) => p.id === o.id && p.value !== o.value),
  );
  const labels: string[] = [];
  for (const option of changed) {
    const category = optionCategory(option);
    if (category === "model" || category === "thought_level")
      labels.push(
        `${category === "model" ? "Model" : "Effort"} → ${optionLabel(option)}`,
      );
  }
  const access = changed.find((o) => optionCategory(o) === "mode");
  if (access)
    labels.push(
      `Access → ${accessLabel(access.values.find((v) => v.value === access.value) ?? { value: access.value, name: access.value }, kind).label}`,
    );
  return labels.join(" · ");
}
