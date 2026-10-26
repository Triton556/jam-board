import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BrainCircuit,
  Check,
  FilePenLine,
  FileSearch,
  Globe,
  LoaderCircle,
  Move,
  Search,
  Send,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, IconButton } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type {
  AgentDockEvent,
  AgentSessionView,
  PromptPart,
} from "../../lib/agent-dock-api";
import { epicsQuery, storiesQuery } from "../../lib/planning-queries";
import { appQuery, tasksQuery } from "../../lib/queries";
import {
  AttachmentComposer,
  attachmentRefusal,
  TranscriptAttachment,
} from "./BrainAttachments";
import { BrainProviderError, BrainRetryStatus } from "./BrainProviderError";
import { SessionControls, useModelCatalog } from "./BrainSessionControls";
import { BrainVoiceInput } from "./BrainVoiceInput";
import { profilesQuery } from "./brain-profiles";
import { activeRetry, latestTurnError } from "./brain-retry";
import {
  configDivider,
  optionCategory,
  sessionOptions,
} from "./brain-settings";
import {
  type BrainContextItem,
  type DraftAttachment,
  draftKey,
  updateDraft,
  useBrainContext,
  useBrainState,
} from "./brain-store";
import { voicePrompt } from "./voice-take";

type EventOf<K extends AgentDockEvent["kind"]> = Extract<
  AgentDockEvent,
  { kind: K }
>;
type Message = EventOf<"agent_message_delta"> | EventOf<"agent_thought_delta">;
const emptyEvents: AgentDockEvent[] = [];
const emptyDraft = {
  text: "",
  context: [] as BrainContextItem[],
  attachments: [] as DraftAttachment[],
};
export function brainItem(
  type: "task" | "epic" | "story",
  key: string,
  title: string,
  status = "",
  description = "",
  parent = "",
): BrainContextItem {
  return {
    type: "board_ref",
    uri: `jam://${type}/${key}`,
    label: `${key} · ${title}`,
    text: `${title}\nStatus: ${status}${parent ? `\n${parent}` : ""}\n${description.replace(/[#*_`>]/g, "").slice(0, 600)}`,
  };
}
export function BoardKeyText({ text }: { text: string }) {
  const app = useQuery(appQuery);
  const navigate = useNavigate();
  const prefix = app.data?.jam?.keyPrefix;
  if (!prefix) return text;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?<![\\w-])(${escaped}-(?:E|S)?\\d+)(?![\\w-])`,
    "g",
  );
  return text.split(pattern).map((part, index) =>
    index % 2 ? (
      <button
        type="button"
        className="brain-board-key"
        // biome-ignore lint/suspicious/noArrayIndexKey: Stateless text fragments retain their position while deltas append.
        key={`${index}-${part}`}
        onClick={() => {
          if (part.startsWith(`${prefix}-E`))
            void navigate({ to: "/plan/$epicKey", params: { epicKey: part } });
          else if (part.startsWith(`${prefix}-S`))
            void navigate({ to: "/plan", search: { story: part } });
          else void navigate({ to: "/board", search: { task: part } });
        }}
      >
        {part}
      </button>
    ) : (
      part
    ),
  );
}
function linkKeys(children: ReactNode): ReactNode {
  if (typeof children === "string") return <BoardKeyText text={children} />;
  if (Array.isArray(children))
    return children.map((child, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: Stateless markdown fragments have no mutable identity.
      <span key={index}>{linkKeys(child)}</span>
    ));
  return children;
}
type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  url?: string;
  value?: string;
  data?: { hProperties?: Record<string, unknown> };
};
function appendCaret({ active }: { active: boolean }) {
  return (tree: MarkdownNode) => {
    if (!active) return;
    const append = (node: MarkdownNode): boolean => {
      if (node.type === "code") {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            "data-brain-streaming": true,
          },
        };
        return true;
      }
      if (["paragraph", "heading", "tableCell"].includes(node.type)) {
        node.children?.push({
          type: "link",
          url: "#brain-streaming-caret",
          children: [{ type: "text", value: "\u200b" }],
        });
        return true;
      }
      return [...(node.children ?? [])].reverse().some(append);
    };
    append(tree);
  };
}
function InlineTitle({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      allowedElements={["code", "strong", "em"]}
      unwrapDisallowed
    >
      {text}
    </ReactMarkdown>
  );
}
function BrainMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="markdown brain-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, [appendCaret, { active: streaming }]]}
        components={{
          p: ({ children }) => <p>{linkKeys(children)}</p>,
          li: ({ children }) => <li>{linkKeys(children)}</li>,
          strong: ({ children }) => <strong>{linkKeys(children)}</strong>,
          em: ({ children }) => <em>{linkKeys(children)}</em>,
          h1: ({ children }) => <h1>{linkKeys(children)}</h1>,
          h2: ({ children }) => <h2>{linkKeys(children)}</h2>,
          h3: ({ children }) => <h3>{linkKeys(children)}</h3>,
          h4: ({ children }) => <h4>{linkKeys(children)}</h4>,
          h5: ({ children }) => <h5>{linkKeys(children)}</h5>,
          h6: ({ children }) => <h6>{linkKeys(children)}</h6>,
          th: ({ children }) => <th>{linkKeys(children)}</th>,
          td: ({ children }) => <td>{linkKeys(children)}</td>,
          code: ({ children, className, node }) => (
            <code className={className}>
              {linkKeys(children)}
              {node?.properties["data-brain-streaming"] === true && (
                <span
                  className="brain-caret"
                  role="status"
                  aria-label="Streaming"
                />
              )}
            </code>
          ),
          a: ({ href, children }) =>
            href === "#brain-streaming-caret" ? (
              <span
                className="brain-caret"
                role="status"
                aria-label="Streaming"
              />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
function ToolRow({
  event,
  updates,
}: {
  event: EventOf<"tool_call">;
  updates: EventOf<"tool_call_update">[];
}) {
  const merged = Object.assign({}, event, ...updates);
  const content = [
    merged.content,
    typeof merged.output === "string"
      ? merged.output
      : merged.output
        ? JSON.stringify(merged.output, null, 2)
        : "",
  ]
    .filter(Boolean)
    .join("\n");
  const board =
    event.title.includes("jam-board") ||
    JSON.stringify(event.input ?? "").includes("jam-board");
  const created =
    board && /creat/i.test(event.title) && /[A-Z][\w]*-\d+/.exec(content)?.[0];
  const icons = {
    read: FileSearch,
    edit: FilePenLine,
    delete: Trash2,
    move: Move,
    search: Search,
    execute: Terminal,
    think: BrainCircuit,
    fetch: Globe,
    other: Wrench,
  };
  const Icon = icons[event.toolKind as keyof typeof icons] ?? Wrench;
  const done = ["completed", "success"].includes(merged.status);
  const failed = ["failed", "error"].includes(merged.status);
  return (
    <details className="brain-tool">
      <summary>
        <Icon size={15} />
        <span>
          <BoardKeyText
            text={created ? `Created task ${created}` : merged.title}
          />
        </span>
        <span
          className={
            done ? "brain-success" : failed ? "brain-failure" : "brain-spinner"
          }
        >
          {done ? (
            <Check size={15} />
          ) : failed ? (
            <X size={15} />
          ) : (
            <LoaderCircle size={15} />
          )}
        </span>
        <small>{merged.status.replaceAll("_", " ")}</small>
      </summary>
      {event.input !== undefined && (
        <pre>{JSON.stringify(event.input, null, 2)}</pre>
      )}
      {content && (
        <pre>
          <BoardKeyText text={content} />
        </pre>
      )}
    </details>
  );
}
function Permission({
  event,
  resolution,
  agent,
}: {
  event: EventOf<"permission_request">;
  resolution?: EventOf<"permission_resolved">;
  agent: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const chosen = event.options.find((o) => o.optionId === resolution?.optionId);
  if (resolution)
    return (
      <p className="brain-permission-done muted">
        {chosen?.kind === "allow_once"
          ? "Allowed once"
          : chosen?.kind === "allow_always"
            ? "Always allowed"
            : "Rejected"}{" "}
        · <InlineTitle text={event.title} />
      </p>
    );
  return (
    <div className="brain-permission">
      <strong>
        {agent} wants to: <InlineTitle text={event.title} />
      </strong>
      <div className="button-row">
        {[...event.options]
          .sort(
            (a, b) =>
              Number(a.kind.startsWith("reject")) -
              Number(b.kind.startsWith("reject")),
          )
          .map((option) => (
            <Button
              key={option.optionId}
              variant={option.kind === "allow_once" ? "primary" : "secondary"}
              disabled={pending}
              onClick={async () => {
                if (pending) return;
                setPending(true);
                setError("");
                try {
                  await agentDockApi.resolvePermission({
                    sessionId: event.sessionId,
                    requestId: event.requestId,
                    optionId: option.optionId,
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setPending(false);
                }
              }}
            >
              {option.name}
            </Button>
          ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function BrainChat({
  session,
  restart,
  connections,
  focusEpoch = 0,
  signIn,
  editConnection,
  apiKeyAccess = false,
}: {
  session: AgentSessionView;
  restart(): Promise<void>;
  connections(): void;
  focusEpoch?: number;
  signIn?(): Promise<void>;
  editConnection?(): void;
  apiKeyAccess?: boolean;
}) {
  const events = useBrainState((s) => s.events[session.id] ?? emptyEvents);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const lastUser = useRef<number | null>(null);
  const pinned = useRef(true);
  const [jump, setJump] = useState(false);
  const [limit, setLimit] = useState(350);
  const [streamingSeq, setStreamingSeq] = useState<number | null>(null);
  const [modelRequest, setModelRequest] = useState(0);
  const failed = latestTurnError(events);
  const modelOffered = sessionOptions(events).some(
    (option) => optionCategory(option) === "model",
  );
  const latest = events.at(-1);
  const auth = events
    .filter((event): event is EventOf<"auth"> => event.kind === "auth")
    .at(-1);
  const authError =
    failed?.error.code === "auth" &&
    (!auth || auth.seq < failed.error.seq || auth.state !== "ok");
  useEffect(() => {
    if (latest?.kind !== "agent_message_delta") {
      setStreamingSeq(null);
      return;
    }
    setStreamingSeq(latest.seq);
    const timer = setTimeout(() => setStreamingSeq(null), 1000);
    return () => clearTimeout(timer);
  }, [latest]);
  // Collapse delta/update events into stable rows; history stays available in memory.
  const rows = events.filter((event, index) => {
    if (event.kind === "status")
      return (
        !!event.message && /^(Resumed |History truncated)/.test(event.message)
      );
    if (event.kind === "config_options") return !!configDivider(events, index);
    if (
      event.kind === "agent_message_delta" ||
      event.kind === "agent_thought_delta"
    )
      return !events
        .slice(0, index)
        .some(
          (e) =>
            e.kind === event.kind &&
            "messageId" in e &&
            e.messageId === event.messageId,
        );
    return ![
      "status",
      "tool_call_update",
      "permission_resolved",
      "available_commands",
      "config_options",
      "auth",
      "retrying",
    ].includes(event.kind);
  });
  useLayoutEffect(() => {
    const user = events.filter((event) => event.kind === "user_message").at(-1);
    if (user && lastUser.current !== user.seq) {
      lastUser.current = user.seq;
      pinned.current = true;
    }
    if (pinned.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
      setJump(false);
    } else setJump(true);
  }, [events]);
  useEffect(() => {
    if (!content.current || !scroller.current) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current && scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight;
      else setJump(true);
    });
    observer.observe(content.current);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div
        className="brain-transcript"
        ref={scroller}
        role="log"
        aria-label="Brain conversation"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const node = e.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 70;
          setJump(!pinned.current);
        }}
      >
        <div className="brain-transcript-content" ref={content}>
          {(auth?.state === "required" || authError) && (
            <div className="brain-auth">
              <strong>{session.title} isn't signed in</strong>
              <p>
                {auth?.state === "required"
                  ? auth.label
                  : "Check the API key or sign in"}
              </p>
              <div className="button-row">
                {apiKeyAccess ? (
                  <Button variant="primary" onClick={editConnection}>
                    Add API key
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      disabled={!signIn}
                      onClick={() => void signIn?.()}
                    >
                      Sign in with the CLI
                    </Button>
                    <button
                      type="button"
                      className="brain-text-action"
                      onClick={editConnection}
                    >
                      Use an API key
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {rows.length > limit && (
            <button
              type="button"
              className="button ghost"
              onClick={() => setLimit(limit + 350)}
            >
              Show earlier messages
            </button>
          )}
          {!rows.length && (
            <p className="brain-greeting muted">
              What would you like to work through?
            </p>
          )}
          {rows.slice(-limit).map((event) => {
            const key = `${event.sessionId}:${event.seq}`;
            if (event.kind === "status")
              return (
                <div key={key} className="brain-config-divider">
                  {event.message}
                </div>
              );
            if (event.kind === "config_options")
              return (
                <div key={key} className="brain-config-divider">
                  {configDivider(events, events.indexOf(event))}
                </div>
              );
            if (event.kind === "user_message")
              return (
                <article key={key} className="brain-user">
                  {event.contextPreamble && (
                    <details className="brain-session-context">
                      <summary>Session context</summary>
                      <pre>{event.contextPreamble}</pre>
                    </details>
                  )}
                  <div className="brain-context-chips">
                    {event.content
                      .filter((p) => p.type === "board_ref")
                      .map((part) => (
                        <span className="brain-chip" key={part.uri}>
                          {part.label}
                        </span>
                      ))}
                  </div>
                  <div>
                    {event.content
                      .filter((p) => p.type === "text")
                      .map((p) => p.text)
                      .join("\n")}
                  </div>
                  <div className="brain-attachment-row">
                    {event.content
                      .filter((p) => p.type === "attachment")
                      .map((p) => (
                        <TranscriptAttachment
                          key={p.attachmentId}
                          id={p.attachmentId}
                          projectId={session.projectId}
                        />
                      ))}
                  </div>
                </article>
              );
            if (
              event.kind === "agent_message_delta" ||
              event.kind === "agent_thought_delta"
            ) {
              const text = events
                .filter(
                  (e): e is Message =>
                    e.kind === event.kind &&
                    "messageId" in e &&
                    e.messageId === event.messageId,
                )
                .map((e) => e.text)
                .join("");
              if (event.kind === "agent_thought_delta")
                return (
                  <details key={key} className="brain-thought">
                    <summary>Thinking…</summary>
                    <em>{text}</em>
                  </details>
                );
              return (
                <article key={key} className="brain-agent">
                  <small className="brain-agent-label">
                    <BrainCircuit size={14} />
                    {session.title}
                  </small>
                  <BrainMarkdown
                    text={text}
                    streaming={
                      session.status === "running" &&
                      latest?.kind === "agent_message_delta" &&
                      streamingSeq === latest.seq &&
                      latest.messageId === event.messageId
                    }
                  />
                </article>
              );
            }
            if (event.kind === "tool_call")
              return (
                <ToolRow
                  key={key}
                  event={event}
                  updates={events.filter(
                    (e): e is EventOf<"tool_call_update"> =>
                      e.kind === "tool_call_update" &&
                      e.toolCallId === event.toolCallId,
                  )}
                />
              );
            if (event.kind === "permission_request")
              return (
                <Permission
                  key={key}
                  event={event}
                  agent={session.title}
                  resolution={events.find(
                    (e): e is EventOf<"permission_resolved"> =>
                      e.kind === "permission_resolved" &&
                      e.requestId === event.requestId,
                  )}
                />
              );
            if (event.kind === "plan")
              return (
                <div key={key} className="brain-plan">
                  <strong>Plan</strong>
                  {event.entries.map((entry) => (
                    <div key={entry.content}>
                      <span
                        role="img"
                        aria-label={entry.status.replaceAll("_", " ")}
                      >
                        {entry.status === "completed"
                          ? "✓"
                          : entry.status === "in_progress"
                            ? "◐"
                            : "○"}
                      </span>
                      {entry.content}
                    </div>
                  ))}
                </div>
              );
            if (event.kind === "turn_end")
              return ["end_turn", "error"].includes(event.stopReason) ? null : (
                <p key={key} className="muted">
                  {(
                    {
                      cancelled: "Stopped",
                      max_tokens: "Reached the token limit",
                      refused: "Refused",
                      refusal: "Refused",
                    } as Record<string, string>
                  )[event.stopReason] ?? event.stopReason}
                </p>
              );
            if (event.kind === "error")
              return (
                <BrainProviderError
                  key={key}
                  event={event}
                  active={failed?.error.seq === event.seq}
                  failedTurn={
                    failed?.error.seq === event.seq && failed.failedTurn
                  }
                  ready={session.status === "ready"}
                  switchModel={
                    modelOffered
                      ? () => setModelRequest((value) => value + 1)
                      : undefined
                  }
                  restart={restart}
                  connections={connections}
                />
              );
            return null;
          })}
        </div>
      </div>
      {jump && (
        <button
          type="button"
          className="brain-jump button secondary"
          onClick={() => {
            pinned.current = true;
            setJump(false);
            if (scroller.current)
              scroller.current.scrollTop = scroller.current.scrollHeight;
          }}
        >
          Jump to latest ↓
        </button>
      )}
      <BrainComposer
        session={session}
        events={events}
        restart={restart}
        focusEpoch={focusEpoch}
        modelRequest={modelRequest}
      />
    </>
  );
}
export function BrainComposer({
  session,
  events,
  restart,
  focusEpoch = 0,
  modelRequest = 0,
}: {
  session: AgentSessionView;
  events: AgentDockEvent[];
  restart(): Promise<void>;
  focusEpoch?: number;
  modelRequest?: number;
}) {
  const tasks = useQuery(tasksQuery);
  const epics = useQuery(epicsQuery);
  const stories = useQuery(storiesQuery);
  const app = useQuery(appQuery);
  const location = useRouterState({ select: (s) => s.location });
  const sources = useBrainContext((s) => s.sources);
  const key = draftKey();
  const draft = useBrainState((s) => s.drafts[key] ?? emptyDraft);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const lock = useRef(false);
  const configuring = useBrainState(
    (s) => s.configuring?.[session.id] ?? false,
  );
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<"mention" | "command" | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const [boardOver, setBoardOver] = useState(false);
  useEffect(() => {
    const drop = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          target: string;
          refs: { uri: string; label: string; text: string }[];
        }>
      ).detail;
      if (detail?.target !== "brain-composer" || !Array.isArray(detail.refs))
        return;
      const refs = detail.refs
        .filter(
          (r) =>
            typeof r.uri === "string" &&
            typeof r.label === "string" &&
            typeof r.text === "string",
        )
        .map((r) => ({ ...r, type: "board_ref" as const }));
      const current =
        useBrainState.getState().drafts[draftKey()]?.context ?? [];
      updateDraft({
        context: [
          ...new Map([...current, ...refs].map((r) => [r.uri, r])).values(),
        ],
      });
      setRemoved((previous) =>
        previous.filter((uri) => !refs.some((r) => r.uri === uri)),
      );
      setBoardOver(false);
    };
    window.addEventListener("jam:board-ref-drop", drop);
    const hover = (event: PointerEvent) => {
      const rect = composer.current?.getBoundingClientRect();
      setBoardOver(
        !!rect &&
          event.buttons === 1 &&
          !!document.querySelector(".react-flow__node.dragging") &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      );
    };
    const leave = () => setBoardOver(false);
    window.addEventListener("pointermove", hover);
    window.addEventListener("pointerup", leave);
    window.addEventListener("pointercancel", leave);
    return () => {
      window.removeEventListener("jam:board-ref-drop", drop);
      window.removeEventListener("pointermove", hover);
      window.removeEventListener("pointerup", leave);
      window.removeEventListener("pointercancel", leave);
    };
  }, []);
  useLayoutEffect(() => {
    if (focusEpoch >= 0) textarea.current?.focus();
  }, [focusEpoch]);
  useEffect(() => {
    const dismiss = () => setPicker(null);
    window.addEventListener("brain-dismiss-suggestions", dismiss);
    return () =>
      window.removeEventListener("brain-dismiss-suggestions", dismiss);
  }, []);
  const retrying = activeRetry(events, session.status);
  const running =
    !!retrying ||
    ["running", "awaiting_permission", "starting"].includes(session.status);
  const items = [
    ...Object.values(tasks.data ?? {})
      .flat()
      .map((t) =>
        brainItem(
          "task",
          t.key,
          t.title,
          t.status,
          t.descriptionMd,
          [t.epicKey, t.storyKey].filter(Boolean).join(" · "),
        ),
      ),
    ...(epics.data ?? []).map((e) =>
      brainItem("epic", e.key, e.title, e.status, e.goalMd),
    ),
    ...(stories.data ?? []).map((s) =>
      brainItem(
        "story",
        s.key,
        s.title,
        s.status,
        s.outcomeMd,
        epics.data?.find((e) => e.id === s.epicId)?.key,
      ),
    ),
  ];
  const lastView = useRef("");
  const taskKey = (location.search as { task?: string }).task;
  const epicKey = location.pathname.startsWith("/plan/")
    ? decodeURIComponent(location.pathname.split("/")[2] ?? "")
    : null;
  const view = taskKey
    ? (items.find((item) => item.uri === `jam://task/${taskKey}`) ??
      brainItem("task", taskKey, "Current task"))
    : epicKey
      ? (items.find((item) => item.uri === `jam://epic/${epicKey}`) ??
        brainItem("epic", epicKey, "Current epic"))
      : null;
  const context = [
    ...new Map(
      [
        ...(view ? [view] : []),
        ...Object.values(sources).flat(),
        ...draft.context,
      ]
        .filter((item) => !removed.includes(item.uri))
        .map((item) => [item.uri, item]),
    ).values(),
  ];
  const commandEvent = events
    .filter(
      (e): e is EventOf<"available_commands"> =>
        e.kind === "available_commands",
    )
    .at(-1);
  const options = sessionOptions(events);
  const matchingCommands = commandEvent?.commands.filter((command) =>
    command.name.includes(draft.text.slice(1)),
  );
  const profiles = useQuery(profilesQuery);
  const profile = profiles.data?.find((p) => p.id === session.profileId);
  const catalog = useModelCatalog(profile);
  const vision =
    catalog.data?.models.find(
      (m) => m.id === options.find((o) => optionCategory(o) === "model")?.value,
    )?.inputImage ?? false;
  const attachments = draft.attachments ?? [];
  const blockedAttachments =
    configuring ||
    attachments.some(
      (a) =>
        a.status !== "ready" ||
        (a.view && attachmentRefusal(a.view, session.kind, vision)),
    );
  const mention = /@([^@\n]*)$/.exec(draft.text);
  const matches = items
    .filter((item) =>
      item.label.toLowerCase().includes((mention?.[1] ?? "").toLowerCase()),
    )
    .slice(0, 12);
  useEffect(() => {
    const view = taskKey || epicKey || "";
    if (lastView.current !== view) {
      lastView.current = view;
      setRemoved([]);
    }
  }, [taskKey, epicKey]);
  useLayoutEffect(() => {
    const node = textarea.current;
    if (node) {
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight || Math.max(50, draft.text.split("\n").length * 20), 192)}px`;
    }
  }, [draft.text]);
  const send = async () => {
    if (
      lock.current ||
      voiceActive ||
      running ||
      session.status !== "ready" ||
      (!draft.text.trim() && !attachments.length && !context.length) ||
      blockedAttachments
    )
      return;
    lock.current = true;
    setPending(true);
    setError("");
    const text = draft.text;
    const content: PromptPart[] = [
      ...context,
      ...attachments.flatMap((a) =>
        a.view
          ? [{ type: "attachment" as const, attachmentId: a.view.id }]
          : [],
      ),
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
    ];
    try {
      await agentDockApi.sendPrompt({ sessionId: session.id, content });
      // Do not erase text typed while the send was in flight.
      useBrainState.setState((s) => ({
        drafts: {
          ...s.drafts,
          [key]: {
            text:
              s.drafts[key]?.text === text ? "" : (s.drafts[key]?.text ?? ""),
            context:
              s.drafts[key]?.context.filter(
                (item) => !context.some((sent) => sent.uri === item.uri),
              ) ?? [],
            attachments: s.drafts[key]?.attachments?.filter(
              (a) => !attachments.some((sent) => sent.id === a.id),
            ),
          },
        },
      }));
      setPicker(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: Composer is a drop region containing independently focusable controls. */
    <div
      ref={composer}
      className={`brain-composer ${boardOver ? "brain-board-over" : ""}`}
      data-board-ref-drop="brain-composer"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setBoardOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (
          !(e.relatedTarget instanceof Node) ||
          !e.currentTarget.contains(e.relatedTarget)
        )
          setBoardOver(false);
      }}
      onDrop={() => setBoardOver(false)}
    >
      {retrying && <BrainRetryStatus key={retrying.seq} event={retrying} />}
      <div className="brain-context-chips">
        {context.map((item) => (
          <span className="brain-chip" key={item.uri}>
            {item.label}
            <IconButton
              label={`Remove ${item.label}`}
              onClick={() => {
                setRemoved([...removed, item.uri]);
                updateDraft({
                  context: draft.context.filter((c) => c.uri !== item.uri),
                });
              }}
            >
              <X size={12} />
            </IconButton>
          </span>
        ))}
      </div>
      {picker === "mention" && (
        <section
          className="brain-mention-picker"
          aria-label="Mention a board item"
        >
          {matches.map((item) => (
            <button
              type="button"
              key={item.uri}
              onClick={() => {
                setRemoved(removed.filter((uri) => uri !== item.uri));
                updateDraft({
                  context: [
                    ...draft.context.filter((c) => c.uri !== item.uri),
                    item,
                  ],
                  text: draft.text.replace(/@[^@\n]*$/, ""),
                });
                setPicker(null);
                textarea.current?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
          {!matches.length && <p>No matching board items</p>}
        </section>
      )}
      {picker === "command" && (
        <section className="brain-mention-picker" aria-label="Agent commands">
          {matchingCommands?.map((command) => (
            <button
              type="button"
              key={command.name}
              onClick={() => {
                updateDraft({ text: `/${command.name} ` });
                setPicker(null);
                textarea.current?.focus();
              }}
            >
              <strong>/{command.name}</strong>
              <small>{command.description}</small>
            </button>
          ))}
          {!matchingCommands?.length && (
            <p>
              {commandEvent?.commands.length
                ? "No matching commands"
                : "No commands available"}
            </p>
          )}
        </section>
      )}
      <textarea
        ref={textarea}
        aria-label="Message the brain"
        placeholder="Ask the brain… (@ to mention, / for commands)"
        value={draft.text}
        rows={2}
        onChange={(e) => {
          updateDraft({ text: e.target.value });
          setPicker(
            /@[^@\n]*$/.test(e.target.value)
              ? "mention"
              : /^\/\S*$/.test(e.target.value)
                ? "command"
                : null,
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && picker) {
            e.preventDefault();
            e.stopPropagation();
            setPicker(null);
          }
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            if (!picker) void send();
          }
        }}
      />
      {error && (
        <p role="alert" className="brain-failure">
          {error}
        </p>
      )}
      <div className="brain-composer-actions">
        <AttachmentComposer
          session={session}
          options={options}
          host={composer}
          disabled={
            pending ||
            session.status === "stopped" ||
            session.status === "failed"
          }
        />
        <BrainVoiceInput
          host={composer}
          textarea={textarea}
          prompt={voicePrompt(
            app.data?.jam?.name ?? "",
            [
              ...Object.values(tasks.data ?? {}).flat(),
              ...(epics.data ?? []),
              ...(stories.data ?? []),
            ]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((item) => ({ label: `${item.key} · ${item.title}` })),
          )}
          onActive={setVoiceActive}
        />
        <div className="brain-toolbar-gap" />
        <SessionControls
          session={session}
          options={options}
          disabled={pending || running || configuring}
          fail={setError}
          openModelEpoch={modelRequest}
        />
        {running ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await agentDockApi.cancelTurn(session.id);
              } catch (e) {
                setError(String(e));
              } finally {
                setPending(false);
              }
            }}
          >
            <Square size={14} />
            Stop
          </Button>
        ) : ["stopped", "failed"].includes(session.status) ? (
          <Button onClick={() => void restart()}>Restart session</Button>
        ) : (
          <Button
            disabled={
              pending ||
              voiceActive ||
              (!draft.text.trim() && !attachments.length && !context.length) ||
              blockedAttachments ||
              session.status !== "ready"
            }
            onClick={() => void send()}
          >
            <Send size={14} />
            {pending ? "Sending…" : "Send"}
          </Button>
        )}
      </div>
      {configuring && <small role="status">Applying session choices…</small>}
    </div>
  );
}
