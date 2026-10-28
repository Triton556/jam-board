import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button, Dialog, Tooltip } from "../../components/ui";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { Switch } from "../../components/ui/m5";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { agentDockApi } from "../../lib/agent-dock";
import type { UserConfigDefault } from "../../lib/agent-dock-api";
import { phase4Api, type WebProvider } from "../../lib/agent-dock-phase4";
import { BrainProgress } from "./BrainProgress";
import { BrainProviderKey } from "./BrainProviderKey";
import { globalConfigLabel } from "./BrainUserConfig";
import { useBrainState } from "./brain-store";
import "./brain-phase4.css";

export function BrainAgentSettings() {
  const client = useQueryClient();
  const config = useQuery({
    queryKey: ["agent-user-config-default"],
    queryFn: () => agentDockApi.launchOptions("claude-code"),
  });
  const projectId = useBrainState((s) => s.projectId);
  const history = useQuery({
    queryKey: ["agent-history-settings"],
    queryFn: () => phase4Api.historySettings(),
  });
  const web = useQuery({
    queryKey: ["web-search-settings"],
    queryFn: () => phase4Api.webSettings(),
  });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [testResult, setTestResult] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <SettingsSection
        className="brain-agent-config"
        title="Global agent config"
        description="Choose whether new agent sessions use your personal configuration."
      >
        <SettingsRow label={globalConfigLabel}>
          <div aria-busy={savingConfig}>
            <CustomSelect
              label={globalConfigLabel}
              value={config.data?.userConfigDefault ?? "ask"}
              disabled={busy || !config.data}
              options={[
                { value: "ask", label: "Ask every time" },
                { value: "include", label: "Always" },
                { value: "exclude", label: "Never" },
              ]}
              onChange={(value) =>
                void run(async () => {
                  setSavingConfig(true);
                  try {
                    await agentDockApi.saveUserConfigDefault(
                      value as UserConfigDefault,
                    );
                    await config.refetch();
                  } finally {
                    setSavingConfig(false);
                  }
                })
              }
            />
            {savingConfig && <BrainProgress>Saving…</BrainProgress>}
          </div>
          {config.error && (
            <p role="alert">
              Could not read global config preference.{" "}
              <Button onClick={() => void config.refetch()}>Retry</Button>
            </p>
          )}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title="Chat history"
        description="Save conversations and available terminal history on this computer."
      >
        {history.data ? (
          <>
            <SettingsRow label="Keep chat history">
              <Switch
                label="Keep chat history"
                checked={history.data.keepHistory}
                disabled={busy}
                onChange={(value) =>
                  void run(async () => {
                    await phase4Api.saveHistorySettings(value);
                    await history.refetch();
                  })
                }
              />
            </SettingsRow>
            <SettingsRow label="Clear history">
              <Button disabled={busy} onClick={() => setConfirm(true)}>
                Clear history for this project
              </Button>
            </SettingsRow>
          </>
        ) : (
          <p role={history.error ? "alert" : "status"}>
            {history.error ? (
              <>
                Could not read history settings.{" "}
                <Button onClick={() => void history.refetch()}>Retry</Button>
              </>
            ) : (
              "Reading history settings…"
            )}
          </p>
        )}
        {result && <p role="status">{result}</p>}
      </SettingsSection>
      <SettingsSection
        title="Web search"
        description="Choose a search provider for the Web tool. Reading pages and downloading images also work without search."
      >
        {web.data ? (
          <>
            <SettingsRow label="Provider">
              <CustomSelect
                label="Search provider"
                value={web.data.provider ?? "none"}
                disabled={busy}
                options={[
                  { value: "none", label: "None" },
                  { value: "brave", label: "Brave" },
                  { value: "tavily", label: "Tavily" },
                ]}
                onChange={(provider) => {
                  setTestResult("");
                  void run(async () => {
                    await phase4Api.saveWebSettings(
                      provider === "none" ? null : (provider as WebProvider),
                    );
                    await web.refetch();
                  });
                }}
              />
            </SettingsRow>
            {web.data.provider && (
              <SettingsRow label="API key">
                <BrainProviderKey
                  key={web.data.provider}
                  busy={busy}
                  keySet={web.data.keySet}
                  save={async (key) => {
                    setBusy(true);
                    try {
                      await phase4Api.setWebKey(
                        web.data.provider as WebProvider,
                        key,
                      );
                      await web.refetch();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  clear={async () => {
                    setBusy(true);
                    try {
                      await phase4Api.clearWebKey(
                        web.data.provider as WebProvider,
                      );
                      await web.refetch();
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </SettingsRow>
            )}
            <SettingsRow label="Test search">
              <Tooltip
                text={
                  !web.data.provider
                    ? "Choose a provider first"
                    : !web.data.keySet
                      ? "Add an API key first"
                      : busy
                        ? "Testing search"
                        : "Test search"
                }
              >
                <span
                  tabIndex={
                    !web.data.provider || !web.data.keySet ? 0 : undefined
                  }
                >
                  <Button
                    disabled={busy || !web.data.provider || !web.data.keySet}
                    onClick={() =>
                      void run(async () => {
                        setTestResult("Testing…");
                        try {
                          await phase4Api.testWeb();
                          setTestResult("Search is working.");
                        } catch (e) {
                          setTestResult(
                            e instanceof Error ? e.message : String(e),
                          );
                        }
                      })
                    }
                  >
                    Test
                  </Button>
                </span>
              </Tooltip>
              {testResult && <p role="status">{testResult}</p>}
            </SettingsRow>
          </>
        ) : (
          <p role={web.error ? "alert" : "status"}>
            {web.error ? (
              <>
                Could not read search settings.{" "}
                <Button onClick={() => void web.refetch()}>Retry</Button>
              </>
            ) : (
              "Reading search settings…"
            )}
          </p>
        )}
      </SettingsSection>
      {error && !confirm && <p role="alert">{error}</p>}
      {confirm && (
        <Dialog
          title="Clear chat history?"
          busy={busy}
          onClose={() => setConfirm(false)}
        >
          <p>
            This deletes saved conversations for this project. This cannot be
            undone.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="button-row brain-dialog-actions">
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await phase4Api.clearHistory();
                  await client.invalidateQueries({
                    queryKey: ["agent-history", projectId],
                  });
                  setResult("History cleared for this project.");
                  setConfirm(false);
                })
              }
            >
              Clear history
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
