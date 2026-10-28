import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Shield } from "lucide-react";
import {
  type ReactNode,
  useEffect,
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
import { BrainLaunchSteps } from "./BrainLaunchLogs";
import { useBrainPopoverPlacement } from "./brain-popover-placement";
import {
  accessLabel,
  connectionAccessKind,
  connectionPreferences,
  optionCategory,
  optionLabel,
  rememberConnection,
  rememberModel,
} from "./brain-settings";
import { useBrainState } from "./brain-store";
import { DisabledReason } from "./DisabledReason";

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
        <div className="brain-control-anchor">
          <Button
            variant="ghost"
            onClick={() => setOpen(open === "more" ? null : "more")}
          >
            More
          </Button>
          {open === "more" && (
            <ControlPopover label="More options" close={() => setOpen(null)}>
              {other.map((o) => (
                <CustomSelect
                  key={o.id}
                  label={o.name}
                  value={o.value}
                  disabled={disabled || busy}
                  options={o.values.map((v) => ({
                    value: v.value,
                    label: v.name,
                  }))}
                  onChange={(value) => void change(o, value)}
                />
              ))}
            </ControlPopover>
          )}
        </div>
      )}
    </div>
  );
}
