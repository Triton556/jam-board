import { useEffect, useRef, useState } from "react";
import type { SkillCheck, SkillInput } from "../../bindings";
import { Button, Dialog, Select } from "../../components/ui";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import { skillDestination } from "../../lib/skill-setup";

export function SkillSetup({ disabled = false }: { disabled?: boolean }) {
  const [input, setInput] = useState<SkillInput>({
    target: "",
    client: "codex",
  });
  const [check, setCheck] = useState<SkillCheck | null>(null);
  const [phase, setPhase] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [log, setLog] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState(false);
  const mounted = useRef(true);
  const cancelled = useRef(false);
  const running = useRef(false);
  const busy = !!phase || disabled;
  useEffect(() => {
    mounted.current = true;
    const off = api.onSkillOutput((line) => {
      if (mounted.current) setLog((s) => `${s + line}\n`.slice(-150000));
    });
    return () => {
      mounted.current = false;
      cancelled.current = true;
      off();
      if (running.current) void api.cancelSkill();
    };
  }, []);
  const change = (patch: Partial<SkillInput>) => {
    setCheck(null);
    setNotice("");
    setError("");
    setInstalled(false);
    setLog("");
    setInput((i) => ({ ...i, ...patch }));
  };
  const pick = async () => {
    try {
      const target = await api.pickFolder();
      if (mounted.current && target) change({ target });
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  };
  const step = async (name: "plan" | "install" | "verify") => {
    if (cancelled.current || !mounted.current)
      throw Error("Operation cancelled");
    setPhase(
      {
        plan: "Checking installation…",
        install: "Installing skill…",
        verify: "Verifying files…",
      }[name],
    );
    setLog((s) => `${s}\n── ${name} ──\n`);
    const result = await api.runSkill(input, name);
    if (!mounted.current) return;
    setLog(
      (s) =>
        `${s}Exit: ${result.exitCode ?? "none"}${result.cancelled ? " · cancelled" : ""}${result.timedOut ? " · timed out" : ""}\n`,
    );
    if (cancelled.current || result.cancelled)
      throw Error("Operation cancelled. Review the log before trying again.");
    if (result.timedOut || result.exitCode !== 0)
      throw Error(
        `${name} ${result.timedOut ? "timed out" : `failed (exit ${result.exitCode})`}. Review the log; no successful installation is confirmed.`,
      );
  };
  const plan = async () => {
    if (running.current) return;
    running.current = true;
    cancelled.current = false;
    setPhase("Checking installation…");
    setLog("");
    setNotice("");
    setError("");
    setInstalled(false);
    try {
      const result = await api.skillCheck(input);
      if (!mounted.current) return;
      if (cancelled.current) {
        setNotice("Installation review cancelled. No files were written.");
        return;
      }
      setCheck(result);
      if (result.errors.length || result.status === "blocked") return;
      await step("plan");
      if (mounted.current && !cancelled.current) setConfirm(true);
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      running.current = false;
      if (mounted.current) setPhase("");
    }
  };
  const install = async () => {
    if (running.current) return;
    running.current = true;
    cancelled.current = false;
    setConfirm(false);
    setError("");
    try {
      await step("install");
      await step("verify");
      if (mounted.current && !cancelled.current) {
        setInstalled(true);
        setNotice("Jam Board skill installed · files verified");
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      running.current = false;
      if (mounted.current) setPhase("");
    }
  };
  const destination = check?.destination ?? skillDestination(input);
  return (
    <SettingsSection
      className="skill-setup"
      title="Optional · Jam Board skill"
      description="Board-specific guidance, bundled with this app. MCP works without installing this skill. No separate playbook, Python or universal brain skill is required."
    >
      <SettingsRow label="Agent client">
        <Select
          aria-label="Skill client"
          value={input.client}
          disabled={busy || confirm}
          onChange={(e) => change({ client: e.target.value })}
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude Code</option>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Project folder"
        hint="Install only in the project where your agent uses this board."
      >
        <code className="path-value">
          {input.target || "Choose a project folder"}
        </code>
        <Button disabled={busy || confirm} onClick={() => void pick()}>
          Choose project folder…
        </Button>
      </SettingsRow>
      {destination && (
        <SettingsRow
          label="Skill location"
          hint="Only the Jam Board skill is installed. Global settings stay unchanged."
        >
          <code className="path-value">{destination}</code>
          {check && <span>Bundled skill {check.version}</span>}
        </SettingsRow>
      )}
      <SettingsRow
        label="Install or update"
        hint="Review the destination before any files are written."
      >
        <p>
          Existing unowned or edited files are preserved. An older playbook copy
          needs a separate migration; this installer will not overwrite it.
        </p>
        <div className="button-row">
          <Button
            variant="primary"
            disabled={busy || !input.target || confirm}
            aria-busy={!!phase}
            onClick={() => void plan()}
          >
            {phase || "Review installation"}
          </Button>
          {!!phase && (
            <Button
              onClick={() => {
                cancelled.current = true;
                setNotice(
                  "Cancellation requested. Waiting for the current step to finish.",
                );
                void api.cancelSkill().catch((e) => setError(String(e)));
              }}
            >
              Cancel
            </Button>
          )}
        </div>
        {check?.errors.map((message) => (
          <p role="alert" key={message} className="field-error">
            {message}
          </p>
        ))}
      </SettingsRow>
      {error && (
        <SettingsRow label="Installation needs attention">
          <p role="alert" className="field-error">
            {error}
          </p>
        </SettingsRow>
      )}
      {notice && (
        <SettingsRow label="Result">
          <p role="status">{notice}</p>
          {installed && (
            <p>
              Start a new agent session in this project. Installing instructions
              does not connect MCP, appoint a brain or start work. Use the
              read-only connection check above to verify the intended board.
            </p>
          )}
        </SettingsRow>
      )}
      {log && (
        <SettingsRow label="Details">
          <details>
            <summary>Installation log</summary>
            <pre role="log" className="skill-log" aria-label="Installation log">
              {log}
            </pre>
          </details>
        </SettingsRow>
      )}
      {confirm && check && (
        <Dialog
          className="skill-confirm"
          title={
            check.status === "current"
              ? "Verify this installed skill?"
              : "Install Jam Board skill?"
          }
          onClose={() => setConfirm(false)}
        >
          <p>
            {input.client === "claude" ? "Claude Code" : "Codex"} · bundled
            skill {check.version}
          </p>
          <p className="path-value">{destination}</p>
          <p>
            {check.status === "upgrade"
              ? "The previous owned version will be backed up in the project’s .jam-board/skill-installations folder before updating. Edited files are not overwritten."
              : check.status === "current"
                ? "The current version is already installed. No replacement is needed; its files will be verified."
                : "This adds only the board skill to this project. Its ownership record stays in Jam Board’s data folder."}
          </p>
          <p>It does not change global agent settings or connect MCP.</p>
          <div className="dialog-actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void install()}>
              {check.status === "current" ? "Verify" : "Install"}
            </Button>
          </div>
        </Dialog>
      )}
    </SettingsSection>
  );
}
