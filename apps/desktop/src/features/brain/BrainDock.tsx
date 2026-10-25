import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, MoreHorizontal, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import laptop from "../../assets/chibi/danil-laptop-256.webp";
import { Button, IconButton } from "../../components/ui";
import { agentDockApi } from "../../lib/agent-dock";
import type { AgentProfileView } from "../../lib/agent-dock-api";
import { appQuery } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";
import { ConnectionEditor } from "./BrainConnections";
import { BrainLauncher, ControlPopover } from "./BrainSessionControls";
import {
  LazyBrainChat as BrainChat,
  LazyBrainTerminal as BrainTerminal,
} from "./BrainSurfaces";
import {
  profileGroups,
  profileStatus,
  profilesQuery,
  usesApiKey,
} from "./brain-profiles";
import { pendingSessionChoices, sessionModel } from "./brain-settings";
import { draftKey, useBrainState } from "./brain-store";
import "./brain-dock.css";
import "./brain-controls.css";

export function BrainDock({ overlay }: { overlay: boolean }) {
  const client = useQueryClient();
  const state = useBrainState();
  const profiles = useQuery(profilesQuery);
  const app = useQuery(appQuery);
  const width = useUiStore((s) => s.brainDockWidth);
  const [creating, setCreating] = useState(false);
  const [launcherProfile, setLauncherProfile] = useState<string>();
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [focusEpoch, setFocusEpoch] = useState(0);
  const [editingProfile, setEditingProfile] = useState<AgentProfileView | null>(
    null,
  );
  const [editorFocus, setEditorFocus] = useState<"key" | "model">("key");
  const editProfile = (
    profile: AgentProfileView,
    focus: "key" | "model" = "key",
  ) => {
    setEditorFocus(focus);
    setEditingProfile(profile);
  };
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const navigate = useNavigate();
  const terminal = state.tab === "terminal";
  const sessions = state.sessions
    .filter(
      (s) =>
        s.projectId === app.data?.jam?.id &&
        (s.kind === "terminal") === terminal,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const session = sessions.find((s) => s.id === state.selected[state.tab]);
  const close = () => useUiStore.getState().setBrainDockOpen(false);
  useEffect(() => {
    const previous = document.activeElement;
    if (overlay && !panel.current?.contains(document.activeElement))
      panel.current?.focus();
    return () => {
      if (overlay && previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [overlay]);
  useEffect(() => {
    const cancelResize = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      useUiStore.getState().setBrainDockWidth(drag.current.width);
      drag.current = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", cancelResize, true);
    return () => window.removeEventListener("keydown", cancelResize, true);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        if (picker || menu || creating) {
          setPicker(false);
          setMenu(false);
          setCreating(false);
        } else if (overlay) useUiStore.getState().setBrainDockOpen(false);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }
      if (overlay && event.key === "Tab") {
        const nodes = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),textarea,select,input,a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
    };
  }, [overlay, picker, menu, creating]);
  useEffect(() => {
    // An open task drawer captures keyboard events on document. The dock is a
    // separate sibling surface; keep its Tab and Escape within this surface.
    const siblingKeys = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        panel.current?.querySelector("[data-voice-take]")
      )
        return;
      if (
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        return;
      if (event.key === "Tab" && document.querySelector(".drawer-backdrop")) {
        if (overlay) {
          const nodes = panel.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled),textarea,select,input,a[href]",
          );
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        event.stopPropagation();
      }
      if (
        event.key === "Escape" &&
        document.querySelector(".drawer-backdrop")
      ) {
        // Let a composer suggestion consume Escape without closing either panel.
        const suggestion = panel.current.querySelector(".brain-mention-picker");
        if (suggestion) {
          window.dispatchEvent(new Event("brain-dismiss-suggestions"));
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (picker || menu || creating) {
          setPicker(false);
          setMenu(false);
          setCreating(false);
        } else if (overlay) useUiStore.getState().setBrainDockOpen(false);
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", siblingKeys, true);
    return () => window.removeEventListener("keydown", siblingKeys, true);
  }, [overlay, picker, menu, creating]);
  const connections = () => {
    setMenu(false);
    if (overlay) close();
    void navigate({
      to: "/settings",
      search: { section: "Agents" },
      hash: "brain-connections",
    });
  };
  const run = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const start = (
    profileId: string,
    choice?: { model?: string; effort?: string },
  ) =>
    run(async () => {
      const profile = profiles.data?.find((p) => p.id === profileId);
      const status =
        profile &&
        profileStatus({ ...profile, model: choice?.model || profile.model });
      if (profile && (status === "Add key" || status === "Choose a model")) {
        editProfile(
          { ...profile, model: choice?.model || profile.model },
          status === "Choose a model" ? "model" : "key",
        );
        return;
      }
      const targetTab =
        profiles.data?.find((p) => p.id === profileId)?.kind === "terminal"
          ? "terminal"
          : "chat";
      const before = draftKey();
      const next = await agentDockApi.startSession({ profileId, ...choice });
      if (useBrainState.getState().projectId !== next.projectId) return;
      if (choice) pendingSessionChoices.set(next.id, choice);
      useBrainState.setState((s) => ({
        sessions: [next, ...s.sessions.filter((old) => old.id !== next.id)],
        configuring: {
          ...s.configuring,
          [next.id]: !!(choice?.model || choice?.effort),
        },
        tab: targetTab,
        selected: { ...s.selected, [targetTab]: next.id },
        drafts: {
          ...s.drafts,
          [`${s.projectId}:${next.id}`]: (before.endsWith(":new")
            ? s.drafts[before]
            : undefined) ?? {
            text: "",
            context: [],
          },
        },
      }));
      for (const event of await agentDockApi.history(next.id))
        useBrainState.getState().ingest(event);
      setCreating(false);
      setFocusEpoch((value) => value + 1);
    });
  return (
    <>
      {overlay && (
        <button
          type="button"
          className="brain-backdrop"
          aria-label="Close brain dock"
          onClick={close}
        />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Overlay uses dialog role; docked mode uses complementary without aria-modal. */}
      <aside
        id="brain-dock"
        ref={panel}
        tabIndex={-1}
        className={`brain-dock ${overlay ? "overlay" : ""}`}
        style={{ width: overlay ? `min(${width}px, 100vw)` : width }}
        role={overlay ? "dialog" : "complementary"}
        aria-modal={overlay || undefined}
        aria-label="Brain dock"
      >
        {!overlay && (
          // biome-ignore lint/a11y/useSemanticElements: Interactive splitter requires pointer capture and keyboard resizing.
          <div
            className="brain-resize"
            role="separator"
            tabIndex={0}
            aria-label="Resize brain dock"
            aria-orientation="vertical"
            aria-valuemin={340}
            aria-valuemax={720}
            aria-valuenow={width}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                useUiStore
                  .getState()
                  .setBrainDockWidth(
                    e.key === "Home"
                      ? 340
                      : e.key === "End"
                        ? 720
                        : width + (e.key === "ArrowLeft" ? 20 : -20),
                  );
              }
            }}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, width };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current)
                useUiStore
                  .getState()
                  .setBrainDockWidth(
                    drag.current.width + drag.current.x - e.clientX,
                  );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              if (drag.current)
                useUiStore.getState().setBrainDockWidth(drag.current.width);
              drag.current = null;
            }}
          />
        )}
        <header className="brain-header">
          <div className="brain-tabs" role="tablist" aria-label="Brain mode">
            {(["chat", "terminal"] as const).map((tab) => (
              <button
                type="button"
                role="tab"
                key={tab}
                aria-selected={state.tab === tab}
                tabIndex={state.tab === tab ? 0 : -1}
                onKeyDown={(event) => {
                  if (
                    !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "chat"
                      : event.key === "End"
                        ? "terminal"
                        : tab === "chat"
                          ? "terminal"
                          : "chat";
                  useBrainState.setState({ tab: next });
                  setCreating(false);
                  setPicker(false);
                  setMenu(false);
                  setFocusEpoch(-1);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLElement>(`[data-brain-tab="${next}"]`)
                    ?.focus();
                }}
                data-brain-tab={tab}
                onClick={() => {
                  useBrainState.setState({ tab });
                  setCreating(false);
                  setPicker(false);
                  setFocusEpoch((value) => value + 1);
                }}
              >
                {tab === "chat" ? "Chat" : "Terminal"}
              </button>
            ))}
          </div>
          <div className="button-row">
            <IconButton
              label={terminal ? "New terminal" : "New chat"}
              onClick={() => {
                setLauncherProfile(session?.profileId);
                setCreating(true);
                setPicker(false);
                setMenu(false);
              }}
            >
              <Plus size={16} />
            </IconButton>
            <IconButton label="Close brain dock" onClick={close}>
              <X size={18} />
            </IconButton>
          </div>
        </header>
        <div className="brain-session-bar">
          <div className="brain-popover-anchor">
            <button
              type="button"
              className="brain-session-title"
              aria-expanded={picker}
              onClick={() => {
                setPicker(!picker);
                setMenu(false);
              }}
            >
              <span>
                {session
                  ? [
                      session.title,
                      sessionModel(state.events[session.id] ?? []),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "New session"}
              </span>
              <ChevronDown size={14} />
            </button>
            {picker && (
              <ControlPopover
                className="brain-popover"
                label="Sessions"
                close={() => setPicker(false)}
              >
                {sessions.length ? (
                  sessions.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => {
                        useBrainState.setState({
                          selected: { ...state.selected, [state.tab]: s.id },
                        });
                        setCreating(false);
                        setPicker(false);
                        setFocusEpoch((value) => value + 1);
                      }}
                    >
                      <span>
                        {[s.title, sessionModel(state.events[s.id] ?? [])]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <small>{s.status.replaceAll("_", " ")}</small>
                    </button>
                  ))
                ) : (
                  <p>No sessions yet</p>
                )}
              </ControlPopover>
            )}
          </div>
          <div className="brain-popover-anchor">
            <IconButton
              label="Session actions"
              onClick={() => {
                setMenu(!menu);
                setPicker(false);
              }}
            >
              <MoreHorizontal size={18} />
            </IconButton>
            {menu && (
              <ControlPopover
                className="brain-popover right"
                label="Session actions"
                close={() => setMenu(false)}
              >
                <button
                  type="button"
                  disabled={!session || pending || session.status === "stopped"}
                  onClick={() => {
                    if (session)
                      void run(() => agentDockApi.stopSession(session.id));
                    setMenu(false);
                  }}
                >
                  Stop session
                </button>
                {import.meta.env.VITE_MOCK_BRIDGE === "1" && (
                  <button
                    type="button"
                    disabled={
                      !session ||
                      pending ||
                      ["stopped", "failed"].includes(session.status)
                    }
                    onClick={() => {
                      if (session)
                        void run(async () => {
                          const mock = await import(
                            "../../lib/agent-dock-mock"
                          );
                          await mock.simulateMockCrash(session.id);
                        });
                      setMenu(false);
                    }}
                  >
                    Simulate crash
                  </button>
                )}
                <button type="button" onClick={connections}>
                  Connections…
                </button>
              </ControlPopover>
            )}
          </div>
        </div>
        {error && (
          <div className="brain-error" role="alert">
            {error}
            <button
              type="button"
              className="button secondary"
              onClick={connections}
            >
              Connections…
            </button>
          </div>
        )}
        {profiles.error && (
          <div role="alert" className="brain-error">
            Could not load connections.{" "}
            <button type="button" onClick={() => void profiles.refetch()}>
              Try again
            </button>
          </div>
        )}
        {creating && !terminal ? (
          <BrainLauncher
            profiles={profiles.data ?? []}
            initialProfileId={launcherProfile ?? session?.profileId}
            pending={pending}
            start={start}
            cancel={() => setCreating(false)}
            connections={connections}
          />
        ) : !session || creating ? (
          <ProfilePicker
            key={`${state.tab}:${creating}`}
            terminal={terminal}
            profiles={profiles.data ?? []}
            pending={pending}
            loading={profiles.isPending}
            start={
              terminal
                ? start
                : async (id) => {
                    setLauncherProfile(id);
                    setCreating(true);
                  }
            }
            connections={connections}
            editProfile={editProfile}
            cancel={session ? () => setCreating(false) : undefined}
          />
        ) : terminal ? (
          <BrainTerminal
            key={session.id}
            session={session}
            profile={profiles.data?.find((p) => p.id === session.profileId)}
            restart={() => start(session.profileId)}
            focusEpoch={focusEpoch}
          />
        ) : (
          <BrainChat
            key={`${app.data?.jam?.id}:${session.id}`}
            session={session}
            restart={() => start(session.profileId)}
            connections={connections}
            focusEpoch={focusEpoch}
            apiKeyAccess={usesApiKey(
              profiles.data?.find((p) => p.id === session.profileId) ?? {
                id: session.profileId,
                preset: session.profileId,
                kind: session.kind,
              },
            )}
            signIn={
              session.profileId.startsWith("claude") ||
              session.profileId === "codex"
                ? () =>
                    start(
                      session.profileId.startsWith("claude")
                        ? "claude-cli"
                        : "codex-cli",
                    )
                : undefined
            }
            editConnection={() => {
              const profile = profiles.data?.find(
                (p) => p.id === session.profileId,
              );
              if (profile) editProfile(profile);
            }}
          />
        )}
        {session && !creating && (
          <div className="brain-cwd" title={session.cwd}>
            Project workspace · {session.cwd}
          </div>
        )}
      </aside>
      {editingProfile && (
        <ConnectionEditor
          key={editingProfile.id}
          profile={editingProfile}
          initialFocus={editorFocus}
          close={() => setEditingProfile(null)}
          refresh={() =>
            client.invalidateQueries({ queryKey: profilesQuery.queryKey })
          }
        />
      )}
    </>
  );
}
function ProfilePicker({
  terminal,
  profiles,
  pending,
  loading,
  start,
  connections,
  cancel,
  editProfile,
}: {
  terminal: boolean;
  profiles: AgentProfileView[];
  pending: boolean;
  loading: boolean;
  start(id: string): Promise<void>;
  connections(): void;
  cancel?: () => void;
  editProfile(profile: AgentProfileView, focus?: "key" | "model"): void;
}) {
  const available = profiles.filter(
    (p) => !p.hidden && (p.kind === "terminal") === terminal,
  );
  const [selected, setSelected] = useState("");
  const chosen =
    available.find((p) => p.id === selected) ??
    available.find((p) => profileStatus(p) === "Ready");
  return (
    <div className="brain-empty">
      <img src={laptop} width={100} height={100} alt="" />
      <h2>
        {terminal ? "An agent at your command" : "Your brain, right here"}
      </h2>
      <p className="muted">
        {terminal
          ? "Run an agent CLI in this project’s workspace."
          : "Chat with Claude Code, Codex or another agent without leaving the board. It is connected to this project automatically."}
      </p>
      {loading && <p role="status">Checking connections…</p>}
      {profileGroups(available, terminal).map((group) => (
        <fieldset
          key={group.label}
          className="brain-profiles"
          aria-label={terminal ? "Terminal connections" : group.label}
        >
          {!terminal && (
            <>
              <legend className="brain-profile-heading">{group.label}</legend>
              <p className="brain-profile-subtitle">{group.subtitle}</p>
            </>
          )}
          {group.profiles.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`brain-profile ${chosen?.id === p.id ? "selected" : ""}`}
              aria-pressed={chosen?.id === p.id}
              disabled={!p.available || pending}
              onClick={() => {
                setSelected(p.id);
                const status = profileStatus(p);
                if (status === "Add key") editProfile(p, "key");
              }}
            >
              <span>{p.label}</span>
              <small>{profileStatus(p)}</small>
              {!p.available && (
                <small>Install {p.command} and reopen Jam Board.</small>
              )}
            </button>
          ))}
        </fieldset>
      ))}
      {chosen && profileStatus(chosen) === "Add key" ? (
        <Button
          variant="primary"
          onClick={() =>
            editProfile(
              chosen,
              profileStatus(chosen) === "Add key" ? "key" : "model",
            )
          }
        >
          {profileStatus(chosen) === "Add key"
            ? "Add API key"
            : "Choose a model"}
        </Button>
      ) : (
        <Button
          variant="primary"
          disabled={!chosen || pending}
          onClick={() => {
            if (chosen) void start(chosen.id);
          }}
        >
          {pending ? "Starting…" : terminal ? "Open terminal" : "Start chat"}
        </Button>
      )}
      {cancel && (
        <Button variant="ghost" onClick={cancel}>
          Back to session
        </Button>
      )}
      <button type="button" className="brain-text-action" onClick={connections}>
        Connections…
      </button>
    </div>
  );
}
