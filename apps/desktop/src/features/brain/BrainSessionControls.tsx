import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Shield, SlidersHorizontal } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button, IconButton, Tooltip } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { Switch } from "../../components/ui/m5";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentDockEvent,
  AgentProfileView,
  AgentSessionView,
  ConfigOption,
  ModelInfo,
} from "../../lib/agent-dock-api";
import { useUiStore } from "../../lib/ui-store";
import { BrainLaunchLogs, BrainLaunchSteps } from "./BrainLaunchLogs";
import { BrainProviderError } from "./BrainProviderError";
import { useBrainPopoverPlacement } from "./brain-popover-placement";
import { profilesQuery } from "./brain-profiles";
import {
  accessLabel,
  connectionAccessKind,
  connectionPreferences,
  optionCategory,
  optionLabel,
  rememberConnection,
  rememberModel,
  sessionOptions,
} from "./brain-settings";
import { useBrainState } from "./brain-store";
import { DisabledReason } from "./DisabledReason";
import "./BrainSessionControls.css";

type UsageEvent = Extract<AgentDockEvent, { kind: "usage" }>;
export function usageText(usage?: UsageEvent) {
  return usage
    ? `${usage.used.toLocaleString("en-US")} / ${usage.size.toLocaleString("en-US")} tokens${usage.cost?.amount != null ? ` · ${usage.cost.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${usage.cost.currency}` : ""}`
    : "Context usage not reported yet";
}
export function BrainStatusChip({
  events,
  open,
}: {
  events: AgentDockEvent[];
  open(): void;
}) {
  const usage = events.filter((e) => e.kind === "usage").at(-1);
  return (
    <button
      type="button"
      className="brain-control-chip"
      title={usageText(usage)}
      aria-label={`Session status: ${usage && usage.size > 0 ? `${Math.round((usage.used / usage.size) * 100)}% context` : "context unavailable"}`}
      onClick={open}
    >
      {usage && usage.size > 0
        ? `${Math.round((usage.used / usage.size) * 100)}% context`
        : "Context —"}
    </button>
  );
}
export function BrainSessionStatus({
  session,
  events,
  usageFocus = false,
  close,
}: {
  session: AgentSessionView;
  events: AgentDockEvent[];
  usageFocus?: boolean;
  close(): void;
}) {
  const profiles = useQuery(profilesQuery);
  const logs = useQuery({
    queryKey: ["brain", "status", session.id],
    queryFn: () => agentDockApi.launchLogs(session.id),
    refetchInterval: 15000,
  });
  const usageNode = useRef<HTMLElement>(null);
  useEffect(() => {
    if (usageFocus) {
      usageNode.current?.scrollIntoView?.({ block: "nearest" });
      usageNode.current?.focus();
    }
  }, [usageFocus]);
  const profile = profiles.data?.find((p) => p.id === session.profileId);
  const options = sessionOptions(events);
  const access = options.find((o) =>
    ["mode", "access", "permissions"].includes(optionCategory(o) ?? ""),
  );
  const all = [...(logs.data ?? []), ...events];
  const board = all
    .filter(
      (e) => e.kind === "launch_step" && e.step.startsWith("mcp:jam-board"),
    )
    .at(-1);
  const global = all
    .filter((e) => e.kind === "launch_step" && e.step === "user_config")
    .at(-1);
  const usage = events.filter((e) => e.kind === "usage").at(-1);
  const plan = logs.data?.filter((e) => e.kind === "plan_usage").at(-1);
  return (
    <ControlPopover
      label="Session status"
      className="brain-controls-popover brain-session-status"
      close={close}
    >
      <div>
        <div className="button-row">
          <strong>Session status</strong>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        </div>
        <dl>
          <dt>Connection</dt>
          <dd>{profile?.label ?? session.title}</dd>
          <dt>Model</dt>
          <dd>
            {options.find((o) => optionCategory(o) === "model")?.value ??
              session.model ??
              profile?.model ??
              "Agent default"}
          </dd>
          <dt>Access mode</dt>
          <dd>
            {access
              ? accessLabel(
                  access.values.find((v) => v.value === access.value) ?? {
                    value: access.value,
                    name: access.value,
                  },
                  connectionAccessKind(
                    profile ?? {
                      id: session.profileId,
                      preset: null,
                      command: null,
                    },
                  ),
                ).label
              : "Not reported"}
          </dd>
          <dt>Board MCP connected</dt>
          <dd>
            {board?.kind === "launch_step"
              ? `${board.state === "ok" ? "Yes" : board.state === "failed" ? "No" : "Not confirmed"} · ${board.step.slice(4)}`
              : "Not confirmed"}
          </dd>
          <dt>Global config</dt>
          <dd>
            {global?.kind === "launch_step"
              ? global.message === "User global configuration included"
                ? "On"
                : "Off"
              : "Not reported"}
          </dd>
        </dl>
        <section ref={usageNode} tabIndex={-1} aria-label="Session usage">
          <strong>Context usage</strong>
          <p>{usageText(usage)}</p>
          {connectionAccessKind(
            profile ?? { id: session.profileId, preset: null, command: null },
          ) === "claude" && <p>Plan limits: type /usage</p>}
          {connectionAccessKind(
            profile ?? { id: session.profileId, preset: null, command: null },
          ) === "codex" && (
            <>
              <strong>Plan usage</strong>
              {plan ? (
                (
                  [
                    ["Primary", plan.primary],
                    ["Secondary", plan.secondary],
                  ] as const
                ).map(([label, window]) => (
                  <p key={label}>
                    {label}:{" "}
                    {window?.used_percent != null
                      ? `${window.used_percent}% used${window.resets_at ? ` · resets ${new Date(window.resets_at * 1000).toLocaleString()}` : ""}`
                      : "Not reported"}
                  </p>
                ))
              ) : (
                <p>
                  {logs.isError
                    ? "Could not read local plan usage"
                    : "No plan usage reported for this session"}
                </p>
              )}
            </>
          )}
        </section>
        <dl>
          <dt>Session started</dt>
          <dd>{new Date(session.createdAt).toLocaleString()}</dd>
        </dl>
      </div>
    </ControlPopover>
  );
}

export function ControlPopover({
  label,
  children,
  close,
  className = "brain-controls-popover",
  role,
}: {
  label: string;
  children: ReactNode;
  close(): void;
  className?: string;
  role?: "menu";
}) {
  const node = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useBrainPopoverPlacement(node);
  useEffect(() => {
    const previous =
      node.current?.parentElement?.querySelector<HTMLElement>(
        '[aria-expanded="true"]',
      ) ?? document.activeElement;
    node.current
      ?.querySelector<HTMLElement>("input,button:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !node.current?.parentElement?.contains(event.target)
      )
        closeRef.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const nodes = [
          ...(node.current?.querySelectorAll<HTMLElement>(
            "input,button:not(:disabled),[tabindex='0']",
          ) ?? []),
        ];
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        nodes[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? nodes.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : nodes.length - 1)) %
                nodes.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    const element = node.current;
    element?.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      element?.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <section
      ref={node}
      role={role}
      className={className}
      aria-label={label}
      data-brain-popover
    >
      {children}
    </section>
  );
}

export function effortOptions(
  profile: AgentProfileView,
  model?: ModelInfo,
  cached?: ConfigOption,
) {
  if (profile.kind !== "api") return cached;
  if (
    !model?.reasoning ||
    !profile.effortStyle ||
    profile.effortStyle === "none"
  )
    return undefined;
  return {
    id: "thought_level",
    name: "Effort",
    category: "thought_level",
    value: "auto",
    values:
      profile.effortStyle === "zai"
        ? [
            { value: "auto", name: "Auto" },
            { value: "enabled", name: "Thinking on" },
            { value: "disabled", name: "Thinking off" },
          ]
        : ["auto", "low", "medium", "high"].map((value) => ({
            value,
            name: value[0]?.toUpperCase() + value.slice(1),
          })),
  };
}
export function EffortControl({
  option,
  value,
  change,
  disabled,
}: {
  option?: ConfigOption;
  value: string;
  change(value: string): void;
  disabled?: boolean;
}) {
  if (!option) return null;
  return (
    <fieldset className="brain-effort">
      <legend>Effort</legend>
      <div>
        {option.values.map((v) => (
          <button
            type="button"
            key={v.value}
            disabled={disabled}
            aria-pressed={v.value === value}
            onClick={() => change(v.value)}
          >
            {v.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function useModelCatalog(profile?: AgentProfileView) {
  return useQuery({
    queryKey: ["brain-model-catalog", profile?.id],
    enabled: profile?.kind === "api",
    queryFn: () =>
      agentDockApi.modelCatalog({
        profileId: profile?.id ?? "",
        refresh: false,
      }),
    staleTime: 86400000,
  });
}
export function ModelPicker({
  profile,
  value,
  change,
  option,
  models,
  error,
  refresh,
  disabled,
  allowCustom = false,
}: {
  profile: AgentProfileView;
  value: string;
  change(value: string): void;
  option?: ConfigOption;
  models?: ModelInfo[];
  error?: string | null;
  refresh?(): void;
  disabled?: boolean;
  allowCustom?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const preferences = useUiStore((s) => s.brainPreferences[profile.id]);
  const catalog =
    profile.kind === "api"
      ? (models ?? [])
          .filter(
            (m) => all || !profile.baseUrl?.includes("openrouter") || m.tools,
          )
          .map((m) => ({
            value: m.id,
            name: m.name,
            description: [
              m.inputImage && "Vision",
              m.reasoning && "Reasoning",
              !m.tools && "No board tools",
              m.contextLength && `${Math.round(m.contextLength / 1000)}K`,
              m.promptPricePerM != null &&
                m.completionPricePerM != null &&
                `$${m.promptPricePerM} / $${m.completionPricePerM} per 1M`,
            ]
              .filter(Boolean)
              .join(" · "),
          }))
      : (option?.values ?? []);
  const allowed = new Set(catalog.map((m) => m.value));
  const savedValues =
    profile.kind === "api" || allowCustom
      ? [
          ...new Set([
            value,
            ...(preferences?.recent ?? []),
            ...(preferences?.starred ?? []),
          ]),
        ]
          .filter(Boolean)
          .filter((id) => !allowed.has(id))
          .map((id) => ({ value: id, name: id, description: "" }))
      : [];
  const values = [...catalog, ...savedValues].filter((m) =>
    `${m.name} ${m.value}`.toLowerCase().includes(search.toLowerCase()),
  );
  const recent = preferences?.recent ?? [];
  const starred = preferences?.starred ?? [];
  const groups = [
    { label: "Recent", values: values.filter((m) => recent.includes(m.value)) },
    {
      label: "Starred ★",
      values: values.filter(
        (m) => starred.includes(m.value) && !recent.includes(m.value),
      ),
    },
    {
      label: "Models",
      values: values.filter(
        (m) => !recent.includes(m.value) && !starred.includes(m.value),
      ),
    },
  ];
  const freeText = profile.kind === "api" || allowCustom;
  return (
    <div className="brain-model-picker">
      <input
        aria-label="Search models"
        disabled={disabled}
        placeholder="Search models"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <p role="status">{error} You can still enter a model ID.</p>}
      <div className="brain-model-results">
        {!option && profile.kind === "acp" && (
          <button
            type="button"
            aria-pressed={!value}
            onClick={() => change("")}
          >
            Agent default
          </button>
        )}
        {groups.map(
          (group) =>
            group.values.length > 0 && (
              <section key={group.label} aria-label={group.label}>
                <h4>{group.label}</h4>
                {group.values.map((v) => (
                  <div key={v.value} className="brain-model-row">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={value === v.value}
                      onClick={() => {
                        rememberModel(profile.id, v.value);
                        change(v.value);
                      }}
                    >
                      <span>{v.name}</span>
                      {v.description && <small>{v.description}</small>}
                    </button>
                    <IconButton
                      label={`${starred.includes(v.value) ? "Unstar" : "Star"} ${v.name}`}
                      onClick={() =>
                        rememberConnection(profile.id, {
                          starred: starred.includes(v.value)
                            ? starred.filter((id) => id !== v.value)
                            : [...starred, v.value],
                        })
                      }
                    >
                      <span aria-hidden="true">
                        {starred.includes(v.value) ? "★" : "☆"}
                      </span>
                    </IconButton>
                  </div>
                ))}
              </section>
            ),
        )}
        {freeText &&
          search.trim() &&
          !values.some((v) => v.value === search.trim()) && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                rememberModel(profile.id, search.trim());
                change(search.trim());
              }}
            >
              Use “{search.trim()}”
            </button>
          )}
        {option && !values.length && <p>No matching models</p>}
      </div>
      {profile.kind === "api" && (
        <div className="brain-model-footer">
          {profile.baseUrl?.includes("openrouter") && (
            <Switch label="Show all models" checked={all} onChange={setAll} />
          )}
          <IconButton
            label="Refresh models"
            disabled={disabled}
            onClick={refresh}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

export function BrainLauncher({
  profiles,
  pending,
  start,
  cancel,
  connections,
  initialProfileId,
  launchEvents = [],
  blocked = false,
}: {
  profiles: AgentProfileView[];
  initialProfileId?: string;
  launchEvents?: AgentDockEvent[];
  pending: boolean;
  blocked?: boolean;
  start(id: string, choice: { model?: string; effort?: string }): Promise<void>;
  cancel(): void;
  connections(): void;
}) {
  const launcher = useRef<HTMLElement>(null);
  const [showLogs, setShowLogs] = useState(false);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    launcher.current?.querySelector<HTMLElement>("button,input")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  const available = profiles.filter((p) => !p.hidden && p.kind !== "terminal");
  const [id, setId] = useState(
    initialProfileId ?? available.find((p) => p.available)?.id ?? "",
  );
  const profile = available.find((p) => p.id === id);
  const [model, setModel] = useState(
    () => connectionPreferences(id).model ?? profile?.model ?? "",
  );
  const [effort, setEffort] = useState(
    () => connectionPreferences(id).effort ?? profile?.effort ?? "auto",
  );
  useEffect(() => {
    if (available.some((p) => p.id === id)) return;
    const next = available.find((p) => p.available);
    if (!next) return;
    setId(next.id);
    setModel(connectionPreferences(next.id).model ?? next.model ?? "");
    setEffort(connectionPreferences(next.id).effort ?? next.effort ?? "auto");
  }, [available, id]);
  const [catalogError, setCatalogError] = useState("");
  const catalog = useModelCatalog(profile);
  const cached = connectionPreferences(id).options ?? [];
  const effortOption =
    profile &&
    effortOptions(
      profile,
      catalog.data?.models.find((m) => m.id === model),
      cached.find((o) => optionCategory(o) === "thought_level"),
    );
  const startupError = launchEvents.filter((e) => e.kind === "error").at(-1);
  if (showLogs)
    return (
      <BrainLaunchLogs
        sessionId={launchEvents.at(-1)?.sessionId}
        title={profile?.label ?? "Session"}
        events={launchEvents}
        close={() => setShowLogs(false)}
      />
    );
  if (pending)
    return (
      <section ref={launcher} className="brain-launcher" aria-label="New chat">
        <h2>New chat</h2>
        <p>
          {profile?.label}
          {model ? ` · ${model}` : ""}
        </p>
        <Button variant="primary" disabled>
          Starting…
        </Button>
        <BrainLaunchSteps events={launchEvents} />
      </section>
    );
  return (
    <section ref={launcher} className="brain-launcher" aria-label="New chat">
      <h2>New chat</h2>
      {startupError?.message.includes("chat didn't start in time") && (
        <BrainProviderError
          active
          event={startupError}
          restart={() =>
            start(id, {
              model: model || undefined,
              effort: effortOption ? effort : undefined,
            })
          }
          showLogs={() => setShowLogs(true)}
        />
      )}
      <h3>Connection</h3>
      <CustomSelect
        label="Connection"
        value={id}
        disabled={pending || blocked}
        onChange={(value) => {
          const next = available.find((p) => p.id === value);
          setId(value);
          setModel(connectionPreferences(value).model ?? next?.model ?? "");
          setEffort(
            connectionPreferences(value).effort ?? next?.effort ?? "auto",
          );
        }}
        options={available.map((p) => ({
          value: p.id,
          label: p.label,
          disabled: !p.available,
        }))}
      />
      {profile && (
        <>
          <h3>Model</h3>
          <ModelPicker
            profile={profile}
            disabled={pending || blocked}
            value={model}
            change={setModel}
            option={cached.find((o) => optionCategory(o) === "model")}
            allowCustom={!!profile.baseUrl}
            models={catalog.data?.models}
            error={
              catalogError ||
              catalog.data?.error ||
              (catalog.error ? String(catalog.error) : "")
            }
            refresh={() => {
              void agentDockApi
                .modelCatalog({ profileId: id, refresh: true })
                .then((data) => {
                  catalogError && setCatalogError("");
                  catalog.refetch();
                  return data;
                })
                .catch((e) => setCatalogError(String(e)));
            }}
          />
          {catalog.isFetching && <p role="status">Loading models…</p>}
          <EffortControl
            option={effortOption}
            value={effort}
            change={setEffort}
            disabled={pending || blocked}
          />
        </>
      )}
      <div className="button-row">
        <Button variant="ghost" disabled={pending || blocked} onClick={cancel}>
          Cancel
        </Button>
        <DisabledReason
          label="Start"
          reason={
            !profile?.available
              ? "No chat connection available — install Claude CLI or Codex, or configure an API connection"
              : profile.kind === "api" && !model
                ? "Choose a model before starting"
                : undefined
          }
        >
          <Button
            variant="primary"
            disabled={
              !profile?.available ||
              pending ||
              blocked ||
              (profile.kind === "api" && !model)
            }
            onClick={() => {
              rememberConnection(id, { model, effort });
              if (model) rememberModel(id, model);
              void start(id, {
                model: model || undefined,
                effort: effortOption ? effort : undefined,
              });
            }}
          >
            {pending ? "Starting…" : "Start"}
          </Button>
        </DisabledReason>
      </div>
      {(pending || launchEvents.length > 0) && (
        <BrainLaunchSteps events={launchEvents} />
      )}
      <button
        type="button"
        className="brain-text-action"
        disabled={pending || blocked}
        onClick={connections}
      >
        Connections…
      </button>
    </section>
  );
}

function booleanValues(option: ConfigOption) {
  if (option.values.length !== 2) return;
  for (const [on, off] of [
    ["on", "off"],
    ["true", "false"],
  ]) {
    const enabled = option.values.find((v) => v.value.toLowerCase() === on);
    const disabled = option.values.find((v) => v.value.toLowerCase() === off);
    if (enabled && disabled) return { on: enabled.value, off: disabled.value };
  }
}

function MoreOption({
  option,
  disabled,
  change,
}: {
  option: ConfigOption;
  disabled: boolean;
  change(value: string): void;
}) {
  const id = useId();
  const pair = booleanValues(option);
  return (
    <div className={`brain-more-option ${pair ? "brain-more-switch" : ""}`}>
      <div className="brain-more-copy">
        <label id={`${id}-label`} htmlFor={id}>
          {option.name}
        </label>
        {option.description && (
          <small id={`${id}-description`}>{option.description}</small>
        )}
      </div>
      {pair ? (
        <button
          id={id}
          type="button"
          role="switch"
          className="switch"
          aria-labelledby={`${id}-label`}
          aria-describedby={
            option.description ? `${id}-description` : undefined
          }
          aria-checked={option.value === pair.on}
          disabled={disabled}
          onClick={() => change(option.value === pair.on ? pair.off : pair.on)}
        >
          <span />
        </button>
      ) : (
        <CustomSelect
          id={id}
          label={option.name}
          value={option.value}
          disabled={disabled}
          options={option.values.map((v) => ({
            value: v.value,
            label: v.name,
          }))}
          onChange={change}
        />
      )}
    </div>
  );
}

export function SessionControls({
  session,
  options,
  disabled,
  fail,
  openModelEpoch = 0,
}: {
  session: AgentSessionView;
  options: ConfigOption[];
  disabled: boolean;
  fail(error: string): void;
  openModelEpoch?: number;
}) {
  const profiles = useQuery({
    queryKey: ["agentDockProfiles"],
    queryFn: () => agentDockApi.profiles(),
  });
  const profile = profiles.data?.find((p) => p.id === session.profileId);
  const catalog = useModelCatalog(profile);
  const [open, setOpen] = useState<"model" | "access" | "more" | null>(null);
  const [busy, setBusy] = useState(false);
  const model = options.find((o) => optionCategory(o) === "model");
  const lastModelRequest = useRef(0);
  useEffect(() => {
    if (openModelEpoch > lastModelRequest.current && model && !disabled) {
      lastModelRequest.current = openModelEpoch;
      setOpen("model");
    }
  }, [openModelEpoch, model, disabled]);
  const effort = options.find((o) => optionCategory(o) === "thought_level");
  const access = options.find((o) => optionCategory(o) === "mode");
  const other = options.filter(
    (o) => !["model", "thought_level", "mode"].includes(optionCategory(o)),
  );
  // ACP does not advertise defaults: use Off for boolean pairs, otherwise the
  // first value advertised in this session (not the first selectable item).
  const defaults = useRef({
    sessionId: session.id,
    values: new Map<string, string>(),
  });
  if (defaults.current.sessionId !== session.id)
    defaults.current = { sessionId: session.id, values: new Map() };
  for (const option of other) {
    if (!defaults.current.values.has(option.id))
      defaults.current.values.set(
        option.id,
        booleanValues(option)?.off ?? option.value,
      );
  }
  const activeMore = other.filter(
    (o) => o.value !== defaults.current.values.get(o.id),
  ).length;
  const change = async (option: ConfigOption, value: string) => {
    if (busy || disabled) return;
    setBusy(true);
    useBrainState.setState((s) => ({
      configuring: { ...s.configuring, [session.id]: true },
    }));
    try {
      await agentDockApi.setConfigOption({
        sessionId: session.id,
        optionId: option.id,
        value,
      });
      if (option === model) rememberModel(session.profileId, value);
      if (option === effort)
        rememberConnection(session.profileId, { effort: value });
    } catch (e) {
      fail(String(e));
    } finally {
      setBusy(false);
      useBrainState.setState((s) => ({
        configuring: { ...s.configuring, [session.id]: false },
      }));
    }
  };
  const label = [optionLabel(model), optionLabel(effort)]
    .filter(Boolean)
    .join(" · ");
  const currentAccess =
    access &&
    accessLabel(
      access.values.find((v) => v.value === access.value) ?? {
        value: access.value,
        name: access.value,
      },
      connectionAccessKind(
        profile ?? { id: session.profileId, preset: null, command: null },
      ),
    );
  return (
    <div className="brain-session-controls">
      {(model || effort) && (
        <div className="brain-control-anchor brain-model-anchor">
          <Tooltip text={disabled ? "Available after this turn" : label}>
            <button
              type="button"
              className="brain-control-chip"
              disabled={disabled || busy}
              aria-label={`Model and effort: ${label}`}
              aria-expanded={open === "model"}
              onClick={() => setOpen(open === "model" ? null : "model")}
            >
              <span>{label}</span>
            </button>
          </Tooltip>
          {open === "model" && (
            <ControlPopover
              label="Model and effort"
              close={() => setOpen(null)}
            >
              {model && profile && (
                <ModelPicker
                  profile={profile}
                  option={model}
                  value={model.value}
                  change={(value) => void change(model, value)}
                  models={catalog.data?.models}
                  error={catalog.data?.error}
                  disabled={busy || disabled}
                  refresh={() =>
                    void agentDockApi
                      .modelCatalog({ profileId: profile.id, refresh: true })
                      .then(() => catalog.refetch())
                      .catch((e) => fail(String(e)))
                  }
                />
              )}
              <EffortControl
                option={effort}
                value={effort?.value ?? ""}
                disabled={busy || disabled}
                change={(value) => {
                  if (effort) void change(effort, value);
                }}
              />
            </ControlPopover>
          )}
        </div>
      )}
      {access && currentAccess && (
        <div className="brain-control-anchor brain-access-anchor">
          <Tooltip
            text={`${currentAccess.label} · ${currentAccess.description}${disabled ? " · Available after this turn" : ""}`}
          >
            <button
              type="button"
              disabled={disabled || busy}
              className={`brain-control-chip brain-access-chip ${currentAccess.danger ? "brain-failure" : ""}`}
              aria-label={`Access: ${currentAccess.label}`}
              aria-expanded={open === "access"}
              onClick={() => setOpen(open === "access" ? null : "access")}
            >
              <Shield size={14} />
              <span>{currentAccess.label}</span>
            </button>
          </Tooltip>
          {open === "access" && (
            <ControlPopover label="Access" close={() => setOpen(null)}>
              {access.values.map((v) => {
                const copy = accessLabel(
                  v,
                  connectionAccessKind(
                    profile ?? {
                      id: session.profileId,
                      preset: null,
                      command: null,
                    },
                  ),
                );
                return (
                  <button
                    type="button"
                    key={v.value}
                    disabled={busy || disabled}
                    className={copy.danger ? "brain-access-danger" : ""}
                    aria-pressed={v.value === access.value}
                    onClick={() => {
                      void change(access, v.value);
                      setOpen(null);
                    }}
                  >
                    <strong>{copy.label}</strong>
                    <small>{copy.description}</small>
                  </button>
                );
              })}
            </ControlPopover>
          )}
        </div>
      )}
      {!!other.length && (
        <div className="brain-control-anchor brain-more-anchor">
          <Tooltip text="More session options">
            <button
              type="button"
              className="brain-control-chip brain-more-chip"
              aria-label="More options"
              aria-expanded={open === "more"}
              onClick={() => setOpen(open === "more" ? null : "more")}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              {activeMore > 0 && (
                <span
                  className="brain-more-active"
                  role="status"
                  aria-label={`${activeMore} active session options`}
                />
              )}
            </button>
          </Tooltip>
          {open === "more" && (
            <ControlPopover label="More options" close={() => setOpen(null)}>
              <strong>More options</strong>
              {other.map((o) => (
                <MoreOption
                  key={o.id}
                  option={o}
                  disabled={disabled || busy}
                  change={(value) => void change(o, value)}
                />
              ))}
            </ControlPopover>
          )}
        </div>
      )}
    </div>
  );
}
