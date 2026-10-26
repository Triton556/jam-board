import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentProfileInput,
  AgentProfileView,
} from "../../lib/agent-dock-api";
import { useUiStore } from "../../lib/ui-store";
import { BrainAgentSettings } from "./BrainAgentSettings";
import { BrainTools } from "./BrainTools";
import { profileGroups, profileStatus, profilesQuery } from "./brain-profiles";
import { optionCategory } from "./brain-settings";

class ConnectionFieldError extends Error {
  constructor(
    readonly field: "args" | "env",
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

export function BrainConnections() {
  const profiles = useQuery(profilesQuery);
  const client = useQueryClient();
  const [editing, setEditing] = useState<AgentProfileView | "new" | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const refresh = () =>
    client.invalidateQueries({ queryKey: profilesQuery.queryKey });
  return (
    <section
      className="brain-connections"
      id="brain-connections"
      aria-labelledby="brain-connections-title"
    >
      <h2 id="brain-connections-title">Brain dock</h2>
      <p className="muted">
        Chat or run a CLI inside Jam Board. Each session connects to this
        project.
      </p>
      {profiles.isPending && <p role="status">Checking connections…</p>}
      {profiles.error && (
        <p role="alert">
          Could not load connections.{" "}
          <button type="button" onClick={() => void profiles.refetch()}>
            Try again
          </button>
        </p>
      )}
      {[
        ...profileGroups(profiles.data ?? [], false),
        ...profileGroups(profiles.data ?? [], true),
      ].map((group) => (
        <div key={group.label} className="brain-connection-group">
          <h3>{group.label}</h3>
          {group.profiles.map((p) => (
            <div key={p.id} className="brain-connection-row">
              <div>
                <strong>{p.label}</strong>
                <small>
                  {profileStatus(p)}
                  {p.hidden ? " · Hidden" : ""}
                </small>
              </div>
              <button
                type="button"
                className="brain-visibility-action"
                title={p.hidden ? "Show in the dock" : "Hide from the dock"}
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  setError("");
                  try {
                    await agentDockApi.saveProfile({
                      id: p.id,
                      label: p.label,
                      kind: p.kind,
                      hidden: !p.hidden,
                    });
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {p.hidden ? "Show" : "Hide"}
              </button>
              <Button variant="secondary" onClick={() => setEditing(p)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <Button variant="secondary" onClick={() => setEditing("new")}>
        Add custom agent
      </Button>
      {editing && (
        <ConnectionEditor
          key={editing === "new" ? "new" : editing.id}
          profile={editing === "new" ? null : editing}
          close={() => setEditing(null)}
          refresh={refresh}
        />
      )}
      <BrainAgentSettings />
    </section>
  );
}
export function ConnectionEditor({
  profile,
  close,
  refresh,
  initialFocus = "key",
  setupWeb,
}: {
  profile: AgentProfileView | null;
  close(): void;
  refresh(): Promise<unknown>;
  initialFocus?: "key" | "model";
  setupWeb?: () => void;
}) {
  const keyInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const modelErrorId = useId();
  const endpointHintId = useId();
  const argsErrorId = useId();
  const envErrorId = useId();
  const argsInput = useRef<HTMLTextAreaElement>(null);
  const envInput = useRef<HTMLTextAreaElement>(null);
  const advanced = useRef<HTMLDetailsElement>(null);
  const [fieldError, setFieldError] = useState<ConnectionFieldError | null>(
    null,
  );
  useEffect(() => {
    if (fieldError)
      (fieldError.field === "args" ? argsInput : envInput).current?.focus();
  }, [fieldError]);
  const [modelError, setModelError] = useState("");
  const [simulateSignedOut, setSimulateSignedOut] = useState(false);
  useEffect(() => {
    let disposed = false;
    if (import.meta.env.VITE_MOCK_BRIDGE === "1" && profile?.id) {
      const id = profile.id;
      void import("../../lib/agent-dock-mock").then((mock) => {
        if (!disposed) setSimulateSignedOut(mock.getMockSignedOut(id));
      });
    }
    return () => {
      disposed = true;
    };
  }, [profile?.id]);
  useEffect(() => {
    (initialFocus === "key"
      ? (keyInput.current ?? modelInput.current)
      : modelInput.current
    )?.focus();
  }, [initialFocus]);
  const [input, setInput] = useState<AgentProfileInput>({
    id: profile?.id,
    label: profile?.label ?? "",
    kind: profile?.kind ?? "acp",
    agentName: profile?.agentName ?? "",
    command: profile?.command ?? "",
    args: profile?.args ?? [],
    baseUrl: profile?.baseUrl ?? "",
    model: profile?.model ?? "",
    effort: profile?.effort ?? "",
    effortStyle: profile?.effortStyle ?? "none",
    extraMcpServers: profile?.extraMcpServers ?? [],
  });
  const cachedOptions = useUiStore(
    (state) => state.brainPreferences[profile?.id ?? ""]?.options,
  );
  const cachedEffort = cachedOptions?.find(
    (option) => optionCategory(option) === "thought_level",
  );
  const efforts =
    input.kind === "api"
      ? input.effortStyle === "zai"
        ? [
            { value: "auto", name: "Auto" },
            { value: "enabled", name: "Thinking on" },
            { value: "disabled", name: "Thinking off" },
          ]
        : ["auto", "low", "medium", "high"].map((value) => ({
            value,
            name: value[0]?.toUpperCase() + value.slice(1),
          }))
      : (cachedEffort?.values ?? []);
  const [args, setArgs] = useState(JSON.stringify(profile?.args ?? []));
  const [env, setEnv] = useState(
    profile?.env.map((entry) => `${entry.name}=${entry.value}`).join("\n") ??
      "",
  );
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>(
    Object.fromEntries(
      profile?.secretKeys.map((key) => [key.key, key.isSet]) ?? [],
    ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const field = (name: keyof AgentProfileInput, value: string) =>
    setInput({ ...input, [name]: value });
  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError("");
    setFieldError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof ConnectionFieldError) {
        setFieldError(e);
        if (e.field === "env" && advanced.current) advanced.current.open = true;
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      title={profile ? `Edit ${profile.label}` : "Add custom agent"}
      busy={pending}
      onClose={close}
      className="brain-connection-dialog"
    >
      <form
        className="brain-connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.kind === "api" && !input.model?.trim()) {
            setModelError("Choose a model");
            modelInput.current?.focus();
            return;
          }
          setModelError("");
          void run(async () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(args);
            } catch (cause) {
              throw new ConnectionFieldError(
                "args",
                "Arguments must be a JSON array of strings.",
                String(cause),
              );
            }
            if (
              !Array.isArray(parsed) ||
              parsed.some((value) => typeof value !== "string")
            )
              throw new ConnectionFieldError(
                "args",
                "Arguments must be a JSON array of strings.",
                "Expected an array containing only strings.",
              );
            const entries = env
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => {
                const split = line.indexOf("=");
                if (split < 1)
                  throw new ConnectionFieldError(
                    "env",
                    "Use NAME=value for each environment line.",
                    "An environment line has no variable name or equals sign.",
                  );
                const name = line.slice(0, split).trim();
                if (
                  /(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTH)/i.test(name)
                )
                  throw new ConnectionFieldError(
                    "env",
                    "Extra environment is non-secret. Use the API key field for credentials.",
                    "Credential-like environment names belong in secret storage.",
                  );
                return { name, value: line.slice(split + 1) };
              });
            const entered = Object.entries(keys).filter(([, value]) =>
              value.trim(),
            );
            setKeys({});
            const savedProfile = await agentDockApi.saveProfile({
              ...input,
              agentName: input.agentName || `${input.label} · dock`,
              args: parsed,
              env: entries,
              baseUrl: input.baseUrl || null,
              model: input.model || null,
              effort: input.effort ?? "",
            });
            setInput((input) => ({ ...input, id: savedProfile.id }));
            if (savedProfile)
              for (const [key, value] of entered) {
                try {
                  await agentDockApi.setSecret(savedProfile.id, key, value);
                  setSaved((current) => ({ ...current, [key]: true }));
                } catch {
                  throw new Error(
                    "Connection saved, but the API key could not be saved. Enter it again to retry.",
                  );
                }
              }
            if (import.meta.env.VITE_MOCK_BRIDGE === "1") {
              const mock = await import("../../lib/agent-dock-mock");
              mock.setMockSignedOut(savedProfile.id, simulateSignedOut);
            }
            await refresh();
            close();
          });
        }}
      >
        {[
          ...(profile?.secretKeys ?? []),
          ...(input.extraMcpServers ?? []).flatMap((server) =>
            server.http?.bearerSecretKey &&
            !profile?.secretKeys.some(
              (key) => key.key === server.http?.bearerSecretKey,
            )
              ? [
                  {
                    key: server.http.bearerSecretKey,
                    label: `${server.name} bearer token`,
                    isSet: false,
                  },
                ]
              : [],
          ),
        ].map((secret) => (
          <div className="brain-secret brain-field" key={secret.key}>
            <label>
              {secret.key.startsWith("MCP_") ? secret.label : "API key"}
              <input
                ref={keyInput}
                type="password"
                autoComplete="new-password"
                value={keys[secret.key] ?? ""}
                disabled={pending}
                onChange={(event) =>
                  setKeys({ ...keys, [secret.key]: event.target.value })
                }
              />
            </label>
            <div className="brain-key-status">
              <small role="status">
                {saved[secret.key] ? "Key saved" : "No key"}
              </small>
              {saved[secret.key] && (
                <button
                  type="button"
                  className="brain-text-action"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      setKeys({});
                      try {
                        if (input.id)
                          await agentDockApi.clearSecret(input.id, secret.key);
                      } catch {
                        throw new Error(
                          "Could not remove the API key. Try again.",
                        );
                      }
                      setSaved((current) => ({
                        ...current,
                        [secret.key]: false,
                      }));
                      await refresh();
                    })
                  }
                >
                  Remove key
                </button>
              )}
            </div>
          </div>
        ))}
        {input.kind !== "terminal" && (
          <div className="brain-field">
            <label>
              Model
              <input
                ref={modelInput}
                placeholder={
                  input.kind === "api"
                    ? "provider/model-name"
                    : "Provider default"
                }
                aria-required={input.kind === "api" || undefined}
                aria-invalid={!!modelError || undefined}
                aria-describedby={modelError ? modelErrorId : undefined}
                value={input.model ?? ""}
                disabled={pending}
                onChange={(event) => {
                  field("model", event.target.value);
                  setModelError("");
                }}
              />
            </label>
            {modelError && (
              <span id={modelErrorId} role="alert" className="brain-failure">
                {modelError}
              </span>
            )}
          </div>
        )}
        {input.kind === "api" && (
          <div className="brain-field">
            <span>Effort style</span>
            <CustomSelect
              label="Effort style"
              value={input.effortStyle ?? "none"}
              disabled={pending}
              options={[
                { value: "openrouter", label: "OpenRouter" },
                { value: "openai", label: "OpenAI-style" },
                { value: "zai", label: "z.ai" },
                { value: "none", label: "None" },
              ]}
              onChange={(value) =>
                setInput({
                  ...input,
                  effortStyle: value as AgentProfileInput["effortStyle"],
                  effort: "auto",
                })
              }
            />
          </div>
        )}
        {input.kind !== "terminal" &&
          (input.kind !== "api" || input.effortStyle !== "none") && (
            <div className="brain-field">
              <span>Default effort</span>
              <CustomSelect
                label="Default effort"
                value={input.effort ?? ""}
                disabled={pending || !efforts.length}
                options={[
                  {
                    value: "",
                    label:
                      input.kind === "api"
                        ? "Provider default"
                        : "Agent default",
                  },
                  ...efforts.map((option) => ({
                    value: option.value,
                    label: option.name,
                  })),
                  ...(input.effort &&
                  !efforts.some((option) => option.value === input.effort)
                    ? [{ value: input.effort, label: input.effort }]
                    : []),
                ]}
                onChange={(value) => field("effort", value)}
              />
              {input.kind === "acp" && !efforts.length && (
                <small className="muted">
                  Start a chat with this connection to load its effort options.
                </small>
              )}
            </div>
          )}
        {input.kind === "api" && (
          <div className="brain-field">
            <label>
              Endpoint
              <input
                type="url"
                value={input.baseUrl ?? ""}
                disabled={pending}
                placeholder="https://api.example.com/v1"
                aria-describedby={
                  profile?.preset === "api-zai" ? endpointHintId : undefined
                }
                onChange={(event) => field("baseUrl", event.target.value)}
              />
            </label>
            {profile?.preset === "api-zai" && (
              <small id={endpointHintId} className="muted">
                GLM Coding Plan keys use https://api.z.ai/api/coding/paas/v4
              </small>
            )}
          </div>
        )}
        {!profile && (
          <div className="brain-field">
            <span>Connection</span>
            <CustomSelect
              label="Connection"
              value={input.kind}
              disabled={pending}
              onChange={(value) => field("kind", value)}
              options={[
                { value: "acp", label: "ACP command · Chat" },
                { value: "terminal", label: "Terminal command" },
              ]}
            />
          </div>
        )}
        {input.kind !== "api" &&
          (!profile?.builtIn || profile.kind === "terminal") && (
            <>
              <label>
                Command
                <input
                  required
                  value={input.command ?? ""}
                  disabled={pending}
                  onChange={(event) => field("command", event.target.value)}
                />
              </label>
              <div className="brain-field">
                <label>
                  Arguments (JSON array)
                  <textarea
                    ref={argsInput}
                    aria-invalid={fieldError?.field === "args" || undefined}
                    aria-describedby={
                      fieldError?.field === "args" ? argsErrorId : undefined
                    }
                    value={args}
                    disabled={pending}
                    onChange={(event) => {
                      setArgs(event.target.value);
                      if (fieldError?.field === "args") setFieldError(null);
                    }}
                  />
                </label>
                {fieldError?.field === "args" && (
                  <ConnectionError id={argsErrorId} error={fieldError} />
                )}
              </div>
            </>
          )}
        <BrainTools
          servers={input.extraMcpServers ?? []}
          change={(extraMcpServers) =>
            setInput((input) => ({ ...input, extraMcpServers }))
          }
          secret={(key, value) =>
            setKeys((keys) => ({ ...keys, [key]: value }))
          }
          disabled={pending}
          setupWeb={setupWeb ?? close}
        />
        <details
          ref={advanced}
          className="brain-advanced"
          open={!profile || undefined}
        >
          <summary>Advanced</summary>
          <div>
            {import.meta.env.VITE_MOCK_BRIDGE === "1" &&
              profile &&
              profile.kind !== "terminal" && (
                <label className="brain-mock-toggle">
                  <input
                    type="checkbox"
                    checked={simulateSignedOut}
                    disabled={pending}
                    onChange={(event) =>
                      setSimulateSignedOut(event.target.checked)
                    }
                  />
                  Simulate signed-out
                </label>
              )}
            <label>
              Label
              <input
                required
                value={input.label}
                disabled={pending}
                onChange={(event) => field("label", event.target.value)}
              />
            </label>
            <label>
              Agent name
              <input
                value={input.agentName ?? ""}
                disabled={pending}
                onChange={(event) => field("agentName", event.target.value)}
              />
            </label>
            {profile?.preset?.startsWith("claude") &&
              profile.kind !== "terminal" && (
                <label>
                  Base URL
                  <input
                    type="url"
                    value={input.baseUrl ?? ""}
                    disabled={pending}
                    onChange={(event) => field("baseUrl", event.target.value)}
                  />
                </label>
              )}
            <div className="brain-field">
              <label>
                Extra environment (non-secret)
                <textarea
                  ref={envInput}
                  aria-invalid={fieldError?.field === "env" || undefined}
                  aria-describedby={
                    fieldError?.field === "env" ? envErrorId : undefined
                  }
                  placeholder="NAME=value"
                  value={env}
                  disabled={pending}
                  onChange={(event) => {
                    setEnv(event.target.value);
                    if (fieldError?.field === "env") setFieldError(null);
                  }}
                />
              </label>
              {fieldError?.field === "env" && (
                <ConnectionError id={envErrorId} error={fieldError} />
              )}
            </div>
            {profile && !profile.builtIn && (
              <button
                type="button"
                className="brain-text-action"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await agentDockApi.deleteProfile(profile.id);
                    await refresh();
                    close();
                  })
                }
              >
                Delete connection
              </button>
            )}
          </div>
        </details>
        {error && (
          <ConnectionError
            error={{
              message:
                error.startsWith("Connection saved, but") ||
                error.startsWith("Could not remove the API key")
                  ? error
                  : "Could not update the connection. Check the connection settings and try again.",
              detail: error,
            }}
          />
        )}
        <div className="brain-connection-footer">
          <Button variant="ghost" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConnectionError({
  error,
  id,
}: {
  error: { message: string; detail: string };
  id?: string;
}) {
  return (
    <div className="brain-failure" role="alert">
      <p id={id}>{error.message}</p>
      <details>
        <summary>Details</summary>
        <pre>{error.detail}</pre>
      </details>
    </div>
  );
}
