import type { SkillInput } from "../bindings";

const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
export function skillCommands(input: SkillInput, python = "py -3") {
  const prefix =
    python === "py -3" ? "py -3" : python === "python3" ? "python3" : "python";
  const harness = input.playbook
    ? `${input.playbook.replace(/[\\/]$/, "")}/harness.py`
    : "<playbook>/harness.py";
  return ["plan", "install"]
    .map(
      (step) =>
        `& ${prefix} -B ${quote(harness)} ${step} --client ${input.client} --target ${quote(input.target || "<project>")} --profile ${input.profile}`,
    )
    .join("\n");
}
