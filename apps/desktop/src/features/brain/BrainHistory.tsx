import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Button, Tooltip } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type { AgentDockEvent, HistoryEntry } from "../../lib/agent-dock-api";
import { phase4Api } from "../../lib/agent-dock-phase4";
import { useUiStore } from "../../lib/ui-store";
import { useBrainState } from "./brain-store";
import "./brain-phase4.css";
import { BrainProviderError } from "./BrainProviderError";
import { type ProviderErrorEvent, providerErrorTitle } from "./brain-retry";

const useDeletes = create<{
  pending: Record<
    string,
    { title: string; timer: ReturnType<typeof setTimeout>; expired?: boolean }
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
) {
  const projectId = useBrainState.getState().projectId;
  const epoch = scopeEpoch;
  if (entry.projectId !== projectId) return;
  const events = continueNew ? await phase4Api.events(entry.id) : [];
  if (epoch !== scopeEpoch) return;
  const session = continueNew
    ? await agentDockApi.startSession({
        profileId: entry.profileId,
        ...(entry.model ? { model: entry.model } : {}),
        ...(entry.effort ? { effort: entry.effort } : {}),
      })
    : await phase4Api.resume(entry.id);
  if (epoch !== scopeEpoch || session.projectId !== projectId) return;
  const replay = await agentDockApi.history(session.id);
  if (epoch !== scopeEpoch) return;
  useBrainState.setState((state) => ({
    sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)],
    selected: { ...state.selected, chat: session.id },
    tab: "chat",
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
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const menuButton = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (menu)
      menuButton.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);
  const [rename, setRename] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rename) renameInput.current?.focus();
  }, [rename]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useDeletes((s) => s.pending);
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    if (Object.keys(pending).length)
      list.current
        ?.querySelector<HTMLButtonElement>(".brain-history-undo button")
        ?.focus();
  }, [pending]);
  const client = useQueryClient();
  const history = useQuery({
    queryKey: ["agent-history", projectId, query],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => phase4Api.history({ query, limit: 100 }),
  });
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="brain-history" aria-label="History" ref={list}>
      <h3>History</h3>
      <input
        aria-label="Search history"
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
        !history.data.some((entry) => !pending[entry.id]?.expired) && (
          <p>No history found</p>
        )}
      {["Today", "This week", "Older"].map((group) => {
        const entries =
          history.data?.filter(
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
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    setMenu(null);
                }}
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
                            });
                        }}
                      >
                        <input
                          aria-label="History title"
                          ref={renameInput}
                          value={title}
                          maxLength={60}
                          disabled={busy}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                        <Button type="submit" disabled={busy || !title.trim()}>
                          Save title
                        </Button>
                        <Button disabled={busy} onClick={() => setRename(null)}>
                          Cancel rename
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="brain-history-open"
                        aria-label={`Open ${entry.title}`}
                        disabled={busy}
                        onClick={() => open(entry)}
                      >
                        <strong>{entry.title}</strong>
                        <small>
                          {entry.profileLabel}
                          {entry.model ? ` · ${entry.model}` : ""}
                        </small>
                        <small
                          title={new Date(entry.updatedAt).toLocaleString()}
                        >
                          {historyTime(entry.updatedAt)} ·{" "}
                          <span className="brain-history-badge">
                            {entry.resumable === "native"
                              ? "Native resume"
                              : entry.resumable === "transcript"
                                ? "From transcript"
                                : "Read only"}
                          </span>
                        </small>
                      </button>
                    )}
                    <div className="brain-history-actions">
                      {entry.resumable !== "none" && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await activateHistory(entry);
                              resumed();
                            })
                          }
                        >
                          Resume
                        </Button>
                      )}
                      <Tooltip text={`History actions for ${entry.title}`}>
                        <Button
                          variant="ghost"
                          aria-label={`History actions for ${entry.title}`}
                          aria-expanded={menu === entry.id}
                          disabled={busy}
                          onClick={() =>
                            setMenu(menu === entry.id ? null : entry.id)
                          }
                        >
                          ⋯
                        </Button>
                      </Tooltip>
                    </div>
                    {menu === entry.id && (
                      <fieldset
                        className="brain-history-menu"
                        ref={menuButton}
                        aria-label="History actions"
                        onKeyDownCapture={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setMenu(null);
                            event.currentTarget.parentElement
                              ?.querySelector<HTMLButtonElement>(
                                "[aria-expanded]",
                              )
                              ?.focus();
                          }
                        }}
                      >
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setMenu(null);
                            setRename(entry.id);
                            setTitle(entry.title);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
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
                                    { queryKey: ["agent-history", projectId] },
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
                                [entry.id]: { title: entry.title, timer },
                              },
                            }));
                          }}
                        >
                          Delete
                        </Button>
                      </fieldset>
                    )}
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
  const events = useQuery({
    queryKey: ["agent-history-events", entry.projectId, entry.id],
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
        <p>Read-only transcript · {entry.profileLabel}</p>
        <Button onClick={close}>Back to chat</Button>
      </header>
      {events.isPending && <p role="status">Loading transcript…</p>}
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
        disabled={busy || !events.data}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await activateHistory(entry, entry.resumable === "none");
            resumed();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
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
