import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Button, Tooltip } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type { AgentDockEvent } from "../../lib/agent-dock-api";
import { phase4Api } from "../../lib/agent-dock-phase4";
import { useUiStore } from "../../lib/ui-store";
import { useBrainState } from "./brain-store";
import "./brain-phase4.css";
import type { UserConfigChoice } from "../../lib/agent-dock-api";
import { BrainProgress } from "./BrainProgress";
import { BrainProviderError } from "./BrainProviderError";
import { ControlPopover } from "./BrainSessionControls";
import { useUserConfigLaunch } from "./BrainUserConfig";
import type { DockHistoryEntry as HistoryEntry } from "./brain-history-types";
import { type ProviderErrorEvent, providerErrorTitle } from "./brain-retry";
import { DisabledReason } from "./DisabledReason";

const useDeletes = create<{
  pending: Record<
    string,
    {
      title: string;
      timer: ReturnType<typeof setTimeout>;
      expired?: boolean;
      height?: number;
    }
  >;
}>(() => ({ pending: {} }));
let scopeEpoch = 0;
useBrainState.subscribe((next, previous) => {
  if (next.projectId !== previous.projectId) scopeEpoch++;
});
export function historyGroup(at: string, now = new Date()) {
  const date = new Date(at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date >= today) return "Today";
  const week = new Date(today);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  return date >= week ? "This week" : "Older";
}
export function historyTime(at: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(at)) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
export function summaryPrompt(events: AgentDockEvent[]) {
  const users = events
    .filter((e) => e.kind === "user_message")
    .slice(-3)
    .map((e) =>
      e.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n"),
    );
  const last = events.filter((e) => e.kind === "agent_message_delta").at(-1);
  const answer = last
    ? events
        .flatMap((e) =>
          e.kind === "agent_message_delta" && e.messageId === last.messageId
            ? [e.text]
            : [],
        )
        .join("")
    : "";
  return `Continue this earlier conversation. Review the summary before acting.\n\nRecent requests:\n${users.join("\n\n")}\n\nFinal answer:\n${answer}`;
}
export function historyTranscriptRows(events: AgentDockEvent[]) {
  const rows: {
    id: number;
    kind: string;
    text: string;
    error?: ProviderErrorEvent;
  }[] = [];
  const messages = new Map<string, (typeof rows)[number]>();
  for (const event of events) {
    if (event.kind === "error") {
      rows.push({
        id: event.seq,
        kind: event.kind,
        text: providerErrorTitle(event),
        error: event,
      });
      continue;
    }
    if (
      event.kind === "agent_message_delta" ||
      event.kind === "agent_thought_delta"
    ) {
      const key = `${event.kind}:${event.messageId}`;
      const row = messages.get(key);
      if (row) row.text += event.text;
      else {
        const next = { id: event.seq, kind: event.kind, text: event.text };
        messages.set(key, next);
        rows.push(next);
      }
      continue;
    }
    const text =
      event.kind === "user_message"
        ? [
            event.contextPreamble,
            ...event.content.map((part) =>
              part.type === "text" || part.type === "board_ref"
                ? part.text
                : part.type === "attachment"
                  ? `Attachment: ${part.attachmentId}`
                  : `Image (${part.mimeType})`,
            ),
          ]
            .filter(Boolean)
            .join("\n")
        : event.kind === "tool_call" || event.kind === "tool_call_update"
          ? `${event.title ?? "Tool"}: ${event.content ?? event.status ?? ""}`
          : event.kind === "status"
            ? event.message
            : event.kind === "plan"
              ? event.entries.map((e) => `${e.status}: ${e.content}`).join("\n")
              : "";
    if (text) rows.push({ id: event.seq, kind: event.kind, text });
  }
  return rows;
}
export async function activateHistory(
  entry: HistoryEntry,
  continueNew = false,
  userConfig?: UserConfigChoice,
) {
  const projectId = useBrainState.getState().projectId;
  const live = useBrainState
    .getState()
    .sessions.find(
      (session) =>
        session.id === entry.id &&
        session.projectId === projectId &&
        session.kind === "terminal" &&
        !["stopped", "failed"].includes(session.status),
    );
  if (entry.projectId === projectId && live) {
    useBrainState.setState((state) => ({
      selected: { ...state.selected, terminal: live.id },
      tab: "terminal",
    }));
    return;
  }
  const epoch = scopeEpoch;
  if (entry.projectId !== projectId) return;
  const events = continueNew ? await phase4Api.events(entry.id) : [];
  if (epoch !== scopeEpoch) return;
  const session = continueNew
    ? await agentDockApi.startSession({
        profileId: entry.profileId,
        userConfig,
        ...(entry.model ? { model: entry.model } : {}),
        ...(entry.effort ? { effort: entry.effort } : {}),
      })
    : await phase4Api.resume(entry.id, userConfig);
  if (epoch !== scopeEpoch || session.projectId !== projectId) return;
  const replay = await agentDockApi.history(session.id);
  if (epoch !== scopeEpoch) return;
  useBrainState.setState((state) => ({
    userConfigChoices: userConfig
      ? { ...state.userConfigChoices, [session.id]: userConfig }
      : state.userConfigChoices,
    sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)],
    selected: {
      ...state.selected,
      [session.kind === "terminal" ? "terminal" : "chat"]: session.id,
    },
    tab: session.kind === "terminal" ? "terminal" : "chat",
    events: { ...state.events, [session.id]: replay },
    drafts: continueNew
      ? {
          ...state.drafts,
          [`${projectId}:${session.id}`]: {
            text: summaryPrompt(events),
            context: [],
          },
        }
      : state.drafts,
  }));
}
export function BrainHistory({
  open,
  resumed,
}: {
  open(entry: HistoryEntry): void;
  resumed(): void;
}) {
  const projectId = useBrainState((s) => s.projectId);
  const sessions = useBrainState((s) => s.sessions);
  const configLaunch = useUserConfigLaunch();
  const terminalStatus = useBrainState((s) =>
    s.sessions
      .filter((v) => v.kind === "terminal")
      .map((v) => `${v.id}:${v.status}`)
      .join("|"),
  );
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [kind, setKind] = useState<"chat" | "terminal">("chat");
  const [rename, setRename] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rename) renameInput.current?.focus();
  }, [rename]);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const actionLock = useRef(false);
  const [error, setError] = useState("");
  const pending = useDeletes((s) => s.pending);
  const list = useRef<HTMLElement>(null);
  const focusAction = (id: string) =>
    requestAnimationFrame(() => {
      Array.from(
        list.current?.querySelectorAll<HTMLButtonElement>(
          "[data-history-action]",
        ) ?? [],
      )
        .find((button) => button.dataset.historyAction === id)
        ?.focus();
    });
  useEffect(() => {
    if (Object.keys(pending).length)
      list.current
        ?.querySelector<HTMLButtonElement>(".brain-history-undo button")
        ?.focus();
  }, [pending]);
  const client = useQueryClient();
  const history = useQuery({
    queryKey: ["agent-history", projectId, query, terminalStatus],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => phase4Api.history({ query, limit: 100 }),
  });
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
  const liveTerminals = sessions.filter(
    (session) =>
      session.projectId === projectId &&
      session.kind === "terminal" &&
      !["stopped", "failed"].includes(session.status),
  );
  const isLive = (entry: HistoryEntry) =>
    liveTerminals.some((session) => session.id === entry.id);
  // Include starting terminals before the persisted history query completes.
  const combined = [...(history.data ?? [])];
  for (const session of liveTerminals) {
    if (combined.some((entry) => entry.id === session.id)) continue;
    combined.unshift({
      id: session.id,
      projectId: session.projectId,
      profileId: session.profileId,
      profileLabel: session.profileId,
      kind: "terminal",
      provider: { label: session.profileId, agentKind: "terminal" },
      empty: true,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
      model: session.model ?? null,
      effort: session.effort ?? null,
      agentSessionId: null,
      resumable: "none",
      messageCount: 0,
    });
  }
  const entriesForKind = combined.filter(
    (entry) =>
      entry.projectId === projectId &&
      // Hide only ended terminals with no user-message transcript to resume.
      !(entry.kind === "terminal" && entry.empty && !isLive(entry)) &&
      entry.title.toLowerCase().includes(query.toLowerCase()) &&
      (entry.kind === "terminal") === (kind === "terminal"),
  );
  return (
    <section className="brain-history" aria-label="History" ref={list}>
      <h3>History</h3>
      {configLaunch.view}
      <div className="brain-tabs" role="tablist" aria-label="History kind">
        {(["chat", "terminal"] as const).map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            disabled={configLaunch.asking || configLaunch.busy}
            aria-selected={kind === value}
            tabIndex={kind === value ? 0 : -1}
            onClick={() => {
              setKind(value);
              setMenu(null);
              setRename(null);
            }}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "chat"
                    : event.key === "End"
                      ? "terminal"
                      : kind === "chat"
                        ? "terminal"
                        : "chat";
                setKind(next);
                setMenu(null);
                setRename(null);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [next === "chat" ? 0 : 1]?.focus();
              }
            }}
          >
            {value === "chat" ? "Chat" : "Terminal"}
          </button>
        ))}
      </div>
      <input
        aria-label="Search history"
        disabled={configLaunch.asking || configLaunch.busy}
        placeholder="Search history"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {history.isPending && <p role="status">Loading history…</p>}
      {history.error && (
        <p role="alert">
          Could not load history.{" "}
          <Button onClick={() => void history.refetch()}>Retry</Button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {history.data &&
        !entriesForKind?.some((entry) => !pending[entry.id]?.expired) && (
          <p>
            {kind === "terminal"
              ? "No terminal history yet. CLI transcripts will appear here when available."
              : "No chat history found"}
          </p>
        )}
      {["Today", "This week", "Older"].map((group) => {
        const entries =
          entriesForKind?.filter(
            (entry) =>
              !pending[entry.id]?.expired &&
              historyGroup(entry.updatedAt) === group,
          ) ?? [];
        return entries.length ? (
          <section key={group} aria-label={group}>
            <h4>{group}</h4>
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="brain-history-row"
                style={{ height: pending[entry.id]?.height }}
              >
                {pending[entry.id] ? (
                  <div
                    role="status"
                    className="brain-history-undo"
                    aria-label={`Deleted ${entry.title}`}
                  >
                    Deleted ·{" "}
                    <Button
                      onClick={() => {
                        clearTimeout(pending[entry.id]?.timer);
                        useDeletes.setState((state) => {
                          const pending = { ...state.pending };
                          delete pending[entry.id];
                          return { pending };
                        });
                        focusAction(entry.id);
                      }}
                    >
                      Undo
                    </Button>
                  </div>
                ) : (
                  <>
                    {rename === entry.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (title.trim())
                            void run(async () => {
                              await phase4Api.rename(entry.id, title.trim());
                              setRename(null);
                              await client.invalidateQueries({
                                queryKey: ["agent-history", projectId],
                              });
                              focusAction(entry.id);
                            });
                        }}
                      >
                        <input
                          aria-label="History title"
                          ref={renameInput}
                          value={title}
                          maxLength={60}
                          disabled={
                            busy || configLaunch.busy || configLaunch.asking
                          }
                          onChange={(e) => setTitle(e.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape" && !busy) {
                              event.preventDefault();
                              event.stopPropagation();
                              setRename(null);
                              focusAction(entry.id);
                            }
                          }}
                        />
                        <DisabledReason
                          label="Save title"
                          reason={
                            !title.trim() ? "Title can't be empty" : undefined
                          }
                        >
                          <Button
                            type="submit"
                            disabled={busy || !title.trim()}
                          >
                            Save title
                          </Button>
                        </DisabledReason>
                        <Button
                          disabled={
                            busy || configLaunch.busy || configLaunch.asking
                          }
                          onClick={() => {
                            setRename(null);
                            focusAction(entry.id);
                          }}
                        >
                          Cancel rename
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="brain-history-open"
                        aria-label={`Open ${entry.title}`}
                        disabled={
                          busy || configLaunch.busy || configLaunch.asking
                        }
                        onClick={() => {
                          if (isLive(entry)) {
                            void activateHistory(entry).then(resumed);
                          } else open(entry);
                        }}
                      >
                        <strong>{entry.title}</strong>
                        <small>
                          <span title={entry.provider.agentKind}>
                            {entry.provider.label || entry.profileLabel}
                          </span>
                          {` · ${entry.model || "Model unavailable"}`}
                        </small>
                        <small
                          title={new Date(entry.updatedAt).toLocaleString()}
                        >
                          {historyTime(entry.updatedAt)} ·{" "}
                          <span className="brain-history-badge">
                            {isLive(entry)
                              ? "Running"
                              : entry.resumable === "native"
                                ? "Native resume"
                                : entry.resumable === "transcript"
                                  ? "From transcript"
                                  : "Read only"}
                          </span>
                        </small>
                      </button>
                    )}
                    <div className="brain-history-actions">
                      {!isLive(entry) && entry.resumable !== "none" && (
                        <Button
                          variant="ghost"
                          aria-busy={resuming === entry.id}
                          aria-label={
                            resuming === entry.id ? "Resuming…" : undefined
                          }
                          disabled={
                            busy || configLaunch.busy || configLaunch.asking
                          }
                          onClick={() =>
                            void configLaunch.request(
                              entry.profileId,
                              entry.kind === "terminal"
                                ? "terminal"
                                : entry.provider.agentKind.startsWith("api")
                                  ? "api"
                                  : "acp",
                              (choice) => {
                                setResuming(entry.id);
                                return run(async () => {
                                  await activateHistory(entry, false, choice);
                                  resumed();
                                }).finally(() => setResuming(null));
                              },
                            )
                          }
                        >
                          {resuming === entry.id ? (
                            <BrainProgress>Resuming…</BrainProgress>
                          ) : (
                            "Resume"
                          )}
                        </Button>
                      )}
                      <Tooltip text={`History actions for ${entry.title}`}>
                        <Button
                          variant="ghost"
                          aria-label={`History actions for ${entry.title}`}
                          aria-expanded={menu === entry.id}
                          aria-haspopup="menu"
                          data-history-action={entry.id}
                          disabled={
                            busy || configLaunch.busy || configLaunch.asking
                          }
                          onClick={() =>
                            setMenu(menu === entry.id ? null : entry.id)
                          }
                        >
                          ⋯
                        </Button>
                      </Tooltip>
                      {menu === entry.id && (
                        <ControlPopover
                          className="brain-popover brain-history-menu right"
                          label="History actions"
                          role="menu"
                          close={() => setMenu(null)}
                        >
                          <Button
                            role="menuitem"
                            disabled={
                              busy || configLaunch.busy || configLaunch.asking
                            }
                            onClick={() => {
                              setMenu(null);
                              setRename(entry.id);
                              setTitle(entry.title);
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            role="menuitem"
                            disabled={
                              busy || configLaunch.busy || configLaunch.asking
                            }
                            onClick={(event) => {
                              const height = event.currentTarget
                                .closest(".brain-history-row")
                                ?.getBoundingClientRect().height;
                              setMenu(null);
                              const epoch = scopeEpoch;
                              const timer = setTimeout(() => {
                                if (epoch !== scopeEpoch) {
                                  useDeletes.setState((state) => {
                                    const pending = { ...state.pending };
                                    delete pending[entry.id];
                                    return { pending };
                                  });
                                  return;
                                }
                                useDeletes.setState((state) => ({
                                  pending: {
                                    ...state.pending,
                                    [entry.id]: {
                                      title: entry.title,
                                      timer,
                                      expired: true,
                                    },
                                  },
                                }));
                                void phase4Api
                                  .delete(entry.id)
                                  .then(() => {
                                    client.setQueriesData<HistoryEntry[]>(
                                      {
                                        queryKey: ["agent-history", projectId],
                                      },
                                      (entries) =>
                                        entries?.filter(
                                          (item) => item.id !== entry.id,
                                        ),
                                    );
                                  })
                                  .catch(() =>
                                    useUiStore
                                      .getState()
                                      .error(
                                        "Could not delete history. Open History to try again.",
                                      ),
                                  )
                                  .finally(() => {
                                    useDeletes.setState((state) => {
                                      const pending = { ...state.pending };
                                      delete pending[entry.id];
                                      return { pending };
                                    });
                                    void client.invalidateQueries({
                                      queryKey: ["agent-history", projectId],
                                    });
                                  });
                              }, 8000);
                              useDeletes.setState((s) => ({
                                pending: {
                                  ...s.pending,
                                  [entry.id]: {
                                    title: entry.title,
                                    timer,
                                    height,
                                  },
                                },
                              }));
                            }}
                          >
                            Delete
                          </Button>
                        </ControlPopover>
                      )}
                    </div>
                  </>
                )}
              </article>
            ))}
          </section>
        ) : null;
      })}
    </section>
  );
}
export function HistoryTranscript({
  entry,
  close,
  resumed,
}: {
  entry: HistoryEntry;
  close(): void;
  resumed(): void;
}) {
  const configLaunch = useUserConfigLaunch();
  const events = useQuery({
    queryKey: ["agent-history-events", entry.projectId, entry.id],
    enabled: entry.kind !== "terminal",
    queryFn: () => phase4Api.events(entry.id),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      className="brain-history-transcript"
      aria-label="Read-only transcript"
    >
      <header>
        <h3>{entry.title}</h3>
        <p>
          {entry.kind === "terminal"
            ? "Terminal history"
            : "Read-only transcript"}{" "}
          · {entry.provider.label} · {entry.model || "Model unavailable"}
        </p>
        <Button onClick={close}>Back to history</Button>
      </header>
      {configLaunch.view}
      {entry.kind === "terminal" && (
        <p>
          Resume this saved CLI conversation in a new terminal tab.{" "}
          {entry.messageCount} messages /{" "}
          {new Date(entry.updatedAt).toLocaleString()}
        </p>
      )}
      {entry.kind !== "terminal" && events.isPending && (
        <p role="status">Loading transcript…</p>
      )}
      {events.error && (
        <p role="alert">
          Could not load transcript.{" "}
          <Button onClick={() => void events.refetch()}>Retry</Button>
        </p>
      )}
      <div className="brain-history-messages">
        {historyTranscriptRows(events.data ?? []).map((row) =>
          row.error ? (
            <BrainProviderError key={row.id} event={row.error} />
          ) : row.kind === "agent_thought_delta" ? (
            <details key={row.id}>
              <summary>Thinking</summary>
              <p className="brain-history-message">{row.text}</p>
            </details>
          ) : (
            <div
              key={row.id}
              className={
                row.kind === "user_message"
                  ? "brain-user"
                  : "brain-history-message"
              }
            >
              {row.text}
            </div>
          ),
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="primary"
        disabled={
          busy ||
          configLaunch.busy ||
          configLaunch.asking ||
          (entry.kind !== "terminal" && !events.data) ||
          (entry.kind === "terminal" && entry.resumable === "none")
        }
        onClick={() =>
          void configLaunch.request(
            entry.profileId,
            entry.kind === "terminal"
              ? "terminal"
              : entry.provider.agentKind.startsWith("api")
                ? "api"
                : "acp",
            async (choice) => {
              setBusy(true);
              setError("");
              try {
                await activateHistory(
                  entry,
                  entry.resumable === "none",
                  choice,
                );
                resumed();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            },
          )
        }
      >
        {busy
          ? "Starting…"
          : entry.resumable === "none"
            ? "Continue in a new session"
            : "Resume"}
      </Button>
    </section>
  );
}
