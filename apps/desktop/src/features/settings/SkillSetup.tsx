import { useEffect, useRef, useState } from "react";
import type { SkillCheck, SkillInput } from "../../bindings";
import { Button, Dialog, SegmentedControl, Select } from "../../components/ui";
import { CodeBlock } from "../../components/ui/m5";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import { skillCommands } from "../../lib/skill-setup";
export const playbookRepository = "https://github.com/Triton556/agent-playbook";
export const playbookCloneCommand =
  "git clone -c core.longpaths=true https://github.com/Triton556/agent-playbook.git";
export function SkillSetup() {
  const [input, setInput] = useState<SkillInput>({
    playbook: "",
    target: "",
    client: "codex",
    profile: "jam-board",
  });
  const [check, setCheck] = useState<SkillCheck | null>(null),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [log, setLog] = useState(""),
    [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const cancelled = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void api
      .skillSavedPath()
      .then((playbook) => {
        if (mounted.current && playbook) setInput((i) => ({ ...i, playbook }));
      })
      .catch((e) => {
        if (mounted.current) setNotice(String(e));
      });
    const off = api.onSkillOutput((line) => {
      if (mounted.current) setLog((s) => `${s + line}\n`.slice(-150000));
    });
    return () => {
      mounted.current = false;
      cancelled.current = true;
      off();
      void api.cancelSkill();
    };
  }, []);
  const change = (patch: Partial<SkillInput>) => {
    setCheck(null);
    setNotice("");
    setInput((i) => ({ ...i, ...patch }));
  };
  const validate = async () => {
    setBusy(true);
    try {
      const value = await api.skillCheck(input);
      setCheck(value);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = async (field: "playbook" | "target") => {
    try {
      const path = await api.pickFolder();
      if (path) change({ [field]: path });
    } catch (e) {
      setNotice(String(e));
    }
  };
  const step = async (name: "plan" | "install" | "verify") => {
    if (cancelled.current || !mounted.current) throw Error(`${name} cancelled`);
    setLog((s) => `${s}\n── ${name} ──\n`);
    const r = await api.runSkill(input, name);
    setLog(
      (s) =>
        s +
        `Exit: ${r.exitCode ?? "none"}${r.cancelled ? " · cancelled" : ""}${r.timedOut ? " · timed out" : ""}\n`,
    );
    if (cancelled.current) throw Error(`${name} cancelled`);
    if (r.cancelled || r.timedOut || r.exitCode !== 0)
      throw Error(
        `${name} ${r.cancelled ? "cancelled" : r.timedOut ? "timed out" : `failed (exit ${r.exitCode})`}`,
      );
  };
  const plan = async () => {
    cancelled.current = false;
    setBusy(true);
    setLog("");
    setNotice("");
    try {
      await step("plan");
      if (mounted.current) setConfirm(true);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      await step("install");
      await step("verify");
      setNotice("Installed · verified");
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  const openInstructions = async () => {
    try {
      await api.openUrl(`${playbookRepository}#quick-start`);
      setNotice(
        "Opened the playbook instructions. Nothing was downloaded or installed by Jam Board.",
      );
    } catch {
      setNotice(
        `Could not open the browser. Open ${playbookRepository} manually; nothing was installed.`,
      );
    }
  };
  const copyClone = async () => {
    try {
      await navigator.clipboard.writeText(playbookCloneCommand);
      setNotice(
        "Clone command copied. Run it yourself in a chosen parent folder; then choose the downloaded agent-playbook folder below.",
      );
    } catch {
      setNotice(
        "Clipboard unavailable. Select and copy the clone command shown above.",
      );
    }
  };
  const commands = skillCommands(input, check?.python ?? "py -3");
  return (
    <SettingsSection
      className="skill-setup"
      title="Optional · Give your agent workflow guidance"
      description="MCP works without installing this skill. Installation adds instructions and helpers to a project folder; it does not connect MCP, appoint a brain or launch a model."
    >
      <SettingsRow
        label="Before installing"
        hint="The live MCP schema is the current calling contract."
      >
        <p>
          Older playbook examples target the legacy board contract and may omit
          project binding, Start permission and required task/review context.
          Installation verification checks files, not protocol compatibility.
        </p>
        <p>
          Use this app's connection and planning prompts. Restart or reconnect
          after an upgrade, refresh tool schemas, then reread and reconcile
          before writing. Never copy old mutation calls blindly.
        </p>
      </SettingsRow>
      <SettingsRow
        label="Get the optional playbook"
        hint="Already have a local checkout? Skip this step and choose its folder below."
      >
        <details className="connection-help">
          <summary>I don't have agent-playbook yet</summary>
          <p>
            Read the source and installation instructions before running its
            installer. Jam Board does not download anything automatically.
          </p>
          <Button disabled={busy} onClick={() => void openInstructions()}>
            Open playbook instructions ↗
          </Button>
          <p>
            With Git installed, run this in a parent folder you choose. It
            creates a new agent-playbook subfolder; it does not install the
            skill into your project.
          </p>
          <pre className="playbook-clone-command">
            <code>{playbookCloneCommand}</code>
          </pre>
          <Button disabled={busy} onClick={() => void copyClone()}>
            Copy clone command
          </Button>
          <p>
            Then choose that subfolder below. It must contain harness.py and
            manifest.json. Check setup, inspect the install plan, and confirm
            only the intended project folder. Global client settings stay
            unchanged.
          </p>
        </details>
      </SettingsRow>
      <SettingsRow
        label="What to install"
        hint="Jam Board skill includes the playbook procedures it uses."
      >
        <SegmentedControl
          label="Skill profile"
          value={input.profile}
          onChange={(profile) => change({ profile })}
          options={[
            { value: "jam-board", label: "Jam Board skill" },
            { value: "full", label: "Whole agent-playbook" },
          ]}
          disabled={busy}
        />
      </SettingsRow>
      <SettingsRow label="Client">
        <Select
          aria-label="Skill client"
          value={input.client}
          disabled={busy}
          onChange={(e) => change({ client: e.target.value })}
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude Code</option>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Project folder"
        hint="The project your agent will work in."
      >
        <code className="path-value">
          {input.target || "Choose a project folder"}
        </code>
        <Button disabled={busy} onClick={() => void pick("target")}>
          Choose project folder…
        </Button>
      </SettingsRow>
      <SettingsRow
        label="agent-playbook folder"
        hint="A local clone of github.com/Triton556/agent-playbook"
      >
        <code className="path-value">
          {input.playbook || "Choose a local clone"}
        </code>
        <Button disabled={busy} onClick={() => void pick("playbook")}>
          Choose playbook folder…
        </Button>
        <p className="muted small">
          Installing records a receipt in this playbook folder (.harness-state).
        </p>
        {check?.version && <span>Playbook {check.version}</span>}
      </SettingsRow>
      <SettingsRow label="Python" hint="Python 3.12 or newer is required.">
        <Button disabled={busy} onClick={() => void validate()}>
          Check setup
        </Button>
        {check?.pythonVersion && (
          <span>
            {check.pythonVersion} · {check.python}
          </span>
        )}
        {check?.errors.map((e) => (
          <p role="alert" key={e} className="field-error">
            {e}
          </p>
        ))}
        <Button
          variant="ghost"
          onClick={() => void api.openUrl("https://www.python.org/downloads/")}
        >
          Python installation information ↗
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Commands"
        hint="PowerShell · arguments are passed separately when run from this app."
      >
        <CodeBlock
          code={commands}
          onCopy={() => void navigator.clipboard.writeText(commands)}
        />
        <p className="muted small">
          Install writes files to your project and ownership receipts to the
          playbook’s .harness-state/receipts folder. Source files stay
          unchanged.
        </p>
        <div className="button-row">
          <Button
            variant="primary"
            disabled={busy || !check || check.errors.length > 0}
            onClick={() => void plan()}
          >
            Run install
          </Button>
          {busy && (
            <Button
              onClick={() => {
                cancelled.current = true;
                void api.cancelSkill();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </SettingsRow>
      {log && (
        <SettingsRow label="Installation log">
          <pre
            role="log"
            className="skill-log"
            aria-label="Installation log"
            aria-live="polite"
          >
            {log}
          </pre>
        </SettingsRow>
      )}
      {notice && (
        <SettingsRow label="Result">
          <p role="status">{notice}</p>
          {notice === "Installed · verified" && (
            <>
              <p>
                Files verified, not the MCP connection. Start a new agent
                session in {input.target}, refresh its tools, and use the
                project connection check above. Then appoint its Brain in Plan
                and prepare a planning prompt. This does not start work.
              </p>
              <Button
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `Start a new agent session in ${input.target}. Refresh its tool schemas. In Jam Board Settings > Agents, copy the intended project's read-only connection check. Confirm the exact project before writing, appoint a Brain for each epic in Plan, and use Prepare planning prompt. Installing the skill did not connect MCP or authorize execution.`,
                  )
                }
              >
                Copy next step
              </Button>
            </>
          )}
        </SettingsRow>
      )}
      {confirm && (
        <Dialog
          className="skill-confirm"
          title={`Install into ${input.target}?`}
          onClose={() => setConfirm(false)}
        >
          <p>This adds files to that project.</p>
          <p>
            The playbook also stores private ownership receipts in its
            .harness-state/receipts folder.
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void install()}>
              Install
            </Button>
          </div>
        </Dialog>
      )}
    </SettingsSection>
  );
}
