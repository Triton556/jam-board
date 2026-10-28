import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentLaunchOptions,
  UserConfigChoice,
} from "../../lib/agent-dock-api";
import { useBrainState } from "./brain-store";
import { DisabledReason } from "./DisabledReason";

export const globalConfigLabel =
  "Use my global agent config (CLAUDE.md, hooks, personal MCP servers)";

/** Only the explicit answer dispatches a launch. Scope changes discard the request. */
export function useUserConfigLaunch() {
  const projectId = useBrainState((s) => s.projectId);
  const scope = useRef({ projectId });
  const lock = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState<{
    options: AgentLaunchOptions;
    launch(choice?: UserConfigChoice): Promise<void>;
  } | null>(null);
  useEffect(() => {
    scope.current = { projectId };
    setQuestion(null);
    setError("");
    lock.current = false;
    setBusy(false);
    return () => {
      scope.current = { projectId: null };
    };
  }, [projectId]);
  const request = async (
    profileId: string,
    kind: string,
    launch: (choice?: UserConfigChoice) => Promise<void>,
    override?: UserConfigChoice,
  ) => {
    if (lock.current || question) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const epoch = scope.current;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (kind === "api") {
        await launch();
        return;
      }
      const options = await agentDockApi.launchOptions(profileId);
      if (epoch !== scope.current) return;
      const choice =
        override ??
        (options.userConfigDefault === "ask"
          ? undefined
          : options.userConfigDefault);
      if (choice) await launch(choice);
      else
        setQuestion({
          options,
          launch: async (answer) => {
            if (epoch === scope.current) await launch(answer);
          },
        });
    } catch (e) {
      if (epoch === scope.current) setError(String(e));
    } finally {
      if (epoch === scope.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    setQuestion(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  };
  const answer = async (choice: UserConfigChoice) => {
    if (!question || lock.current) return;
    const epoch = scope.current;
    lock.current = true;
    setBusy(true);
    setQuestion(null);
    try {
      await question.launch(choice);
      if (epoch === scope.current) setQuestion(null);
    } catch (e) {
      if (epoch === scope.current) setError(String(e));
    } finally {
      if (epoch === scope.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const view = (
    <>
      {error && <p role="alert">{error}</p>}
      {question && (
        <section
          className="brain-config-question"
          aria-label="Global agent config"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <strong>{globalConfigLabel}?</strong>
          <p>{question.options.excludeDescription}</p>
          <div className="button-row">
            <Button disabled={busy} onClick={cancel}>
              Cancel
            </Button>
            <DisabledReason
              label="Don't use"
              reason={
                question.options.excludeSupported
                  ? undefined
                  : "This agent does not support excluding global config"
              }
            >
              <Button
                disabled={busy || !question.options.excludeSupported}
                onClick={() => void answer("exclude")}
              >
                Don't use
              </Button>
            </DisabledReason>
            <Button
              variant="primary"
              autoFocus
              disabled={busy}
              onClick={() => void answer("include")}
            >
              Use global config
            </Button>
          </div>
        </section>
      )}
    </>
  );
  return { request, cancel, view, busy, asking: !!question };
}

export function GlobalConfigChip({
  choice,
  next,
  change,
}: {
  choice?: UserConfigChoice;
  next?: UserConfigChoice;
  change(choice: UserConfigChoice): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  if (!choice) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Observes descendant Escape dismissal without adding a focus target.
    <div
      className="brain-global-config"
      ref={root}
      data-brain-popover={open ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <Tooltip text="Change global config for the next launch">
        <button
          type="button"
          className="brain-control-chip"
          aria-expanded={open}
          ref={trigger}
          onClick={() => setOpen(!open)}
        >
          Global config: {choice === "include" ? "on" : "off"}
        </button>
      </Tooltip>
      {open && (
        <CustomSelect
          label="Global config for next launch"
          value={next ?? choice}
          options={[
            { value: "include", label: "On" },
            { value: "exclude", label: "Off" },
          ]}
          onChange={(value) => {
            change(value as UserConfigChoice);
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
      {next && <small>Next launch: {next === "include" ? "on" : "off"}</small>}
    </div>
  );
}
