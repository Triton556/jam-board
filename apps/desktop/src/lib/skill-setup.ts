import type { SkillInput } from "../bindings";

/** Display only. The native installer resolves and validates the actual path. */
export function skillDestination(input: SkillInput) {
  if (!input.target) return null;
  const folder = input.client === "claude" ? ".claude" : ".agents";
  return `${input.target.replace(/[\\/]$/, "")}/${folder}/skills/jam-board`;
}
