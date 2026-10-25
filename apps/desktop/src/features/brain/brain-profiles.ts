import { agentDockApi } from "../../lib/agent-dock";
import type { AgentProfileView } from "../../lib/agent-dock-api";

export const profilesQuery = {
  queryKey: ["agentDockProfiles"],
  queryFn: () => agentDockApi.profiles(),
};
export function profileStatus(profile: AgentProfileView) {
  return !profile.available
    ? (profile.unavailableReason ?? "Unavailable")
    : profile.kind === "api" && !profile.model?.trim()
      ? "Choose a model"
      : profile.preset !== "claude-code" &&
          profile.secretKeys.some((key) => !key.isSet)
        ? "Add key"
        : "Ready";
}
export function usesApiKey(
  profile?: Pick<AgentProfileView, "kind" | "preset" | "id">,
) {
  return (
    profile?.kind === "api" ||
    ["claude-zai", "claude-openrouter"].includes(
      profile?.preset ?? profile?.id ?? "",
    )
  );
}
export function profileGroups(profiles: AgentProfileView[], terminal: boolean) {
  return terminal
    ? [
        {
          label: "Terminal",
          subtitle: "",
          profiles: profiles.filter((p) => p.kind === "terminal"),
        },
      ]
    : [
        {
          label: "Agents",
          subtitle: "Claude Code, Codex and other agent CLIs",
          profiles: profiles.filter((p) => p.kind === "acp"),
        },
        {
          label: "API",
          subtitle:
            "Your own key — OpenRouter, z.ai or any OpenAI-compatible endpoint",
          profiles: profiles.filter((p) => p.kind === "api"),
        },
      ];
}
