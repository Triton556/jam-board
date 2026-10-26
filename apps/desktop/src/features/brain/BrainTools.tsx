import { useEffect, useState } from "react";
import { Button, Tooltip } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { Switch } from "../../components/ui/m5";
import { agentDockApi } from "../../lib/agent-dock";
import type { McpServer } from "../../lib/agent-dock-api";
import { phase4Api } from "../../lib/agent-dock-phase4";
import "./brain-phase4.css";

export function presetServer(preset: McpServer["preset"]): McpServer {
  return {
    name: preset === "web" ? "jam-web" : preset,
    preset,
    enabled: false,
    trustReadOnly: preset === "web",
    command: preset === "browser" ? "npx" : "",
    args: preset === "browser" ? ["-y", "@playwright/mcp@latest"] : [],
    env: [],
    http: null,
  };
}
export function BrainTools({
  servers,
  change,
  secret,
  disabled,
  setupWeb,
}: {
  servers: McpServer[];
  change(servers: McpServer[]): void;
  secret(key: string, value: string): void;
  disabled: boolean;
  setupWeb(): void;
}) {
  const [webUnset, setWebUnset] = useState(false);
  const [npxMissing, setNpxMissing] = useState(false);
  useEffect(() => {
    let disposed = false;
    void phase4Api
      .webSettings()
      .then((web) => {
        if (!disposed) setWebUnset(!web.provider);
      })
      .catch(() => {});
    void agentDockApi
      .profiles()
      .then((profiles) => {
        if (!disposed)
          setNpxMissing(
            profiles.some(
              (p) =>
                p.command === "npx" &&
                !p.available &&
                /npx.*not found/i.test(p.unavailableReason ?? ""),
            ),
          );
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  const [adding, setAdding] = useState(false);
  const [transport, setTransport] = useState("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [bearer, setBearer] = useState("");
  const [error, setError] = useState("");
  const update = (server: McpServer) =>
    change([...servers.filter((s) => s.name !== server.name), server]);
  const presets = (["web", "browser", "desktop"] as const).map(
    (preset) =>
      servers.find((s) => s.preset === preset) ?? presetServer(preset),
  );
  return (
    <fieldset className="brain-tools" disabled={disabled}>
      <legend>Tools</legend>
      <div className="brain-tool-row">
        <div className="brain-tool-heading">
          <div className="brain-tool-copy">
            <strong>jam-board</strong>
            <small>Read and update this project’s board.</small>
          </div>
          <Tooltip text="Always on for this project">
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Disabled switch needs a focusable explanation. */}
            <span tabIndex={0} className="brain-tool-toggle">
              <Switch
                label="jam-board · Always on"
                checked
                disabled
                onChange={() => {}}
              />
            </span>
          </Tooltip>
        </div>
      </div>
      {[...presets, ...servers.filter((s) => s.preset === "custom")].map(
        (server) => (
          <div className="brain-tool-row" key={server.name}>
            <div className="brain-tool-heading">
              <div className="brain-tool-copy">
                <strong>
                  {server.preset === "web"
                    ? "Web"
                    : server.preset === "browser"
                      ? "Browser"
                      : server.preset === "desktop"
                        ? "Desktop"
                        : server.name}
                </strong>
                <small>
                  {server.preset === "web"
                    ? "Search the web and read pages."
                    : server.preset === "browser"
                      ? npxMissing
                        ? "Browser needs npx, which is missing."
                        : "Open a separate browser. Requires npx."
                      : server.preset === "desktop"
                        ? "Give the agent control of your screen."
                        : (server.http?.url ??
                          [server.command, ...server.args].join(" "))}
                </small>
              </div>
              {server.preset === "web" && webUnset && (
                <Button className="brain-tool-setup" onClick={setupWeb}>
                  Set up web search
                </Button>
              )}
              <div className="brain-tool-toggle">
                <Switch
                  label={
                    server.preset === "web"
                      ? "Web (Jam Board)"
                      : server.preset === "browser"
                        ? "Browser"
                        : server.preset === "desktop"
                          ? "Desktop (advanced)"
                          : server.name
                  }
                  checked={server.enabled}
                  disabled={
                    disabled || (server.preset === "browser" && npxMissing)
                  }
                  onChange={(enabled) => update({ ...server, enabled })}
                />
              </div>
            </div>
            {server.preset === "desktop" && server.enabled && (
              <>
                <p className="brain-failure">
                  The agent can see and control your screen. Turn it on only
                  while you need it.
                </p>
                <label>
                  Desktop command
                  <input
                    value={server.command}
                    disabled={disabled}
                    onChange={(e) =>
                      update({ ...server, command: e.target.value })
                    }
                  />
                </label>
                <small>Supply your own desktop-control MCP command.</small>
              </>
            )}
            <details>
              <summary>Advanced · {server.name}</summary>
              <Switch
                label={`Trust read-only tools · ${server.name}`}
                checked={server.trustReadOnly ?? server.preset === "web"}
                disabled={disabled}
                onChange={(trustReadOnly) =>
                  update({ ...server, trustReadOnly })
                }
              />
              <small>Only tools marked read-only may run without asking.</small>
            </details>
            {server.preset === "custom" && (
              <Button
                onClick={() =>
                  change(servers.filter((s) => s.name !== server.name))
                }
              >
                Remove {server.name}
              </Button>
            )}
          </div>
        ),
      )}
      {!adding ? (
        <Button onClick={() => setAdding(true)}>Add custom</Button>
      ) : (
        <section className="brain-tool-form" aria-label="Custom tool server">
          <label>
            Server name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <CustomSelect
            label="Tool transport"
            value={transport}
            options={[
              { value: "stdio", label: "Stdio" },
              { value: "http", label: "HTTP" },
            ]}
            onChange={setTransport}
          />
          {transport === "stdio" ? (
            <>
              <label>
                Tool command
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </label>
              <label>
                Tool arguments (JSON array)
                <textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </label>
              <label>
                Tool environment (non-secret)
                <textarea
                  placeholder="NAME=value"
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Tool URL
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <label>
                Bearer token (optional)
                <input
                  type="password"
                  autoComplete="new-password"
                  value={bearer}
                  onChange={(e) => setBearer(e.target.value)}
                />
              </label>
              <small>
                Saved in the credential store when you save this connection.
              </small>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <Button
              onClick={() => {
                try {
                  if (
                    !/^[a-zA-Z0-9_-]+$/.test(name) ||
                    name === "jam-board" ||
                    servers.some((s) => s.name === name) ||
                    presets.some((s) => s.name === name)
                  )
                    throw Error(
                      "Use a unique server name with letters, numbers, underscores or dashes.",
                    );
                  const parsed: unknown = JSON.parse(args);
                  if (
                    !Array.isArray(parsed) ||
                    parsed.some((arg) => typeof arg !== "string")
                  )
                    throw Error(
                      "Tool arguments must be a JSON array of strings.",
                    );
                  const entries = env
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line) => {
                      const split = line.indexOf("=");
                      const name = line.slice(0, split).trim();
                      if (
                        split < 1 ||
                        /(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTH)/i.test(
                          name,
                        )
                      )
                        throw Error(
                          "Use non-secret NAME=value environment entries. Put credentials in the bearer field.",
                        );
                      return { name, value: line.slice(split + 1) };
                    });
                  if (transport === "stdio" && !command.trim())
                    throw Error("Enter a tool command.");
                  if (transport === "http" && !/^https?:\/\//i.test(url))
                    throw Error("Enter an HTTP or HTTPS URL.");
                  const bearerSecretKey = `MCP_${name.replace(/[_-]/g, (char) => `_${char.charCodeAt(0).toString(16)}_`)}_BEARER`;
                  update({
                    ...presetServer("custom"),
                    name,
                    enabled: true,
                    command: command.trim(),
                    args: parsed,
                    env: entries,
                    http:
                      transport === "http"
                        ? {
                            url,
                            bearerSecretKey: bearer ? bearerSecretKey : null,
                          }
                        : null,
                  });
                  if (transport === "http" && bearer)
                    secret(bearerSecretKey, bearer);
                  setBearer("");
                  setName("");
                  setCommand("");
                  setArgs("[]");
                  setEnv("");
                  setUrl("");
                  setError("");
                  setAdding(false);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Check the server settings.",
                  );
                }
              }}
            >
              Add server
            </Button>
            <Button
              onClick={() => {
                setBearer("");
                setAdding(false);
              }}
            >
              Cancel custom server
            </Button>
          </div>
        </section>
      )}
    </fieldset>
  );
}
