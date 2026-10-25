import { useNavigate } from "@tanstack/react-router";
import {
  CircleAlert,
  Download,
  LoaderCircle,
  Mic,
  MicOff,
  Square,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../../components/ui";
import { Switch } from "../../components/ui/m5";
import { draftKey, useBrainState } from "./brain-store";
import {
  cancelVoiceInstall,
  installVoice,
  refreshVoice,
  saveVoice,
  useVoiceStatus,
  voiceModels,
  voiceStatusLine,
} from "./voice-store";
import { insertDictation, type TakeState, VoiceTake } from "./voice-take";
import "./brain-voice.css";

export function BrainVoiceInput({
  host,
  textarea,
  prompt,
  onActive,
}: {
  host: RefObject<HTMLElement | null>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  onActive(active: boolean): void;
}) {
  const { status, progress, error, busy } = useVoiceStatus();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [take, setTake] = useState<TakeState>({
    phase: "idle",
    seconds: 0,
    level: 0,
    error: "",
    permissionDenied: false,
  });
  const machine = useRef<VoiceTake | null>(null);
  if (!machine.current) machine.current = new VoiceTake(setTake);
  const active = ["starting", "recording", "transcribing"].includes(take.phase);
  const anchor = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const scope = draftKey();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    onActive(active);
  }, [active, onActive]);
  useEffect(() => {
    const off = useBrainState.subscribe((next, previous) => {
      if (
        next.projectId !== previous.projectId ||
        next.selected.chat !== previous.selected.chat ||
        next.tab !== previous.tab
      )
        machine.current?.cancel();
    });
    return () => {
      off();
      machine.current?.cancel();
      clearTimeout(closeTimer.current);
    };
  }, []);
  useEffect(() => {
    if (status?.enabled === false) machine.current?.cancel();
  }, [status?.enabled]);
  const install = () => {
    if (!status) return;
    void installVoice(status.model, status.device);
  };
  const toggle = () => {
    if (take.phase === "recording") {
      void machine.current?.finish();
      return;
    }
    if (!status || busy) return;
    if (active) return;
    if (
      !status.enabled ||
      !status.runtimeInstalled ||
      !status.installedModels.includes(status.model) ||
      status.state === "installing"
    ) {
      setOpen(true);
      return;
    }
    const origin = scopeRef.current;
    setOpen(false);
    void machine.current?.start(status.language, prompt, (text) => {
      if (origin !== scopeRef.current || draftKey() !== origin) return;
      const state = useBrainState.getState();
      const draft = state.drafts[origin] ?? { text: "", context: [] };
      const input = textarea.current;
      const insertion = insertDictation(
        draft.text,
        input?.selectionStart ?? draft.text.length,
        input?.selectionEnd ?? draft.text.length,
        text,
      );
      useBrainState.setState({
        drafts: {
          ...state.drafts,
          [origin]: { ...draft, text: insertion.text },
        },
      });
      requestAnimationFrame(() => {
        if (scopeRef.current !== origin) return;
        input?.focus();
        input?.setSelectionRange(insertion.caret, insertion.caret);
      });
    });
    void refreshVoice();
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        machine.current?.state.phase !== "idle"
      ) {
        event.preventDefault();
        event.stopPropagation();
        machine.current?.cancel();
        setOpen(false);
        return;
      }
      if (
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !host.current?.contains(event.target)
      )
        return;
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.code === "Space"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) toggleRef.current();
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        machine.current?.cancel();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [host, open]);
  const downloading = status?.state === "installing";
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : null;
  const label =
    take.phase === "recording"
      ? "Stop dictation"
      : take.phase === "transcribing"
        ? "Transcribing…"
        : take.phase === "starting"
          ? "Starting microphone…"
          : "Voice input";
  const spinner =
    take.phase === "starting" ||
    take.phase === "transcribing" ||
    status?.state === "loading";
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Hover/focus disclosure wraps independently focusable controls. */}
      <div
        ref={anchor}
        className="brain-voice-anchor"
        data-voice-take={active ? take.phase : undefined}
        onPointerEnter={() => {
          clearTimeout(closeTimer.current);
          setOpen(true);
        }}
        onPointerLeave={() => {
          closeTimer.current = setTimeout(() => {
            if (!anchor.current?.contains(document.activeElement))
              setOpen(false);
          }, 200);
        }}
        onFocus={() => {
          clearTimeout(closeTimer.current);
          setOpen(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        {/* Hover/focus already opens the voice disclosure. A second tooltip
            would cover that disclosure or the active take's timer. */}
        <span className="tooltip-wrap">
          <button
            type="button"
            className={`icon-button brain-voice-button ${take.phase === "recording" ? "recording" : ""}`}
            aria-label={label}
            aria-expanded={open}
            data-voice-state={
              take.phase !== "idle" ? take.phase : status?.state
            }
            onClick={toggle}
            disabled={
              !status || (busy && !downloading && take.phase !== "recording")
            }
          >
            {take.phase === "recording" ? (
              <Square size={14} />
            ) : downloading ? (
              <small className="brain-voice-percent">{percent ?? "…"}%</small>
            ) : spinner ? (
              <LoaderCircle className="brain-spinner" size={16} />
            ) : !status?.enabled ? (
              <MicOff size={16} />
            ) : status.state === "error" ? (
              <CircleAlert size={16} className="brain-failure" />
            ) : !status.runtimeInstalled ||
              !status.installedModels.includes(status.model) ? (
              <Download size={16} />
            ) : (
              <Mic size={16} />
            )}
            {downloading && (
              <svg
                className="brain-voice-progress"
                viewBox="0 0 28 28"
                aria-hidden="true"
              >
                <circle
                  cx="14"
                  cy="14"
                  r="12"
                  pathLength="100"
                  strokeDasharray={`${percent ?? 0} 100`}
                />
              </svg>
            )}
          </button>
        </span>
        {open && (
          <section
            className="brain-controls-popover brain-voice-popover"
            aria-label="Voice input controls"
          >
            <strong>Voice input</strong>
            <p role="status">
              {status
                ? downloading
                  ? `Downloading ${progress?.phase ?? "runtime"} · ${percent == null ? "…" : `${percent}%`}`
                  : voiceStatusLine(status)
                : error || "Reading voice status…"}
            </p>
            {!status && error && (
              <Button onClick={() => void refreshVoice()}>Retry</Button>
            )}
            {status && (
              <>
                <Switch
                  label="Enable voice input"
                  checked={status.enabled}
                  disabled={busy}
                  onChange={(enabled) => void saveVoice({ enabled })}
                />
                {downloading ? (
                  <Button onClick={() => void cancelVoiceInstall()}>
                    Cancel download
                  </Button>
                ) : status.enabled &&
                  (!status.runtimeInstalled ||
                    !status.installedModels.includes(status.model)) ? (
                  <Button variant="primary" disabled={busy} onClick={install}>
                    Download {voiceModels[status.model].size}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={
                      !status.enabled ||
                      busy ||
                      (active && take.phase !== "recording")
                    }
                    onClick={toggle}
                  >
                    {take.phase === "recording"
                      ? "Stop dictation"
                      : "Start dictation"}
                  </Button>
                )}
              </>
            )}
            {(error || status?.error) && (
              <p role="alert" className="brain-failure">
                {error || status?.error}
              </p>
            )}
            <small>Ctrl+Space · Escape cancels a take</small>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                void navigate({
                  to: "/settings",
                  search: { section: "Voice" },
                });
              }}
            >
              Voice settings…
            </Button>
          </section>
        )}
      </div>
      {host.current &&
        (active || take.phase === "error") &&
        createPortal(
          <div
            className={`brain-voice-take ${take.permissionDenied ? "brain-voice-permission" : ""}`}
            role="status"
          >
            {take.phase === "recording" ? (
              <>
                <span className="brain-voice-recording-dot" />
                <meter
                  aria-label="Microphone level"
                  min="0"
                  max="1"
                  value={Math.min(1, take.level * 4)}
                />
                <span>{`${Math.floor(take.seconds / 60)
                  .toString()
                  .padStart(
                    2,
                    "0",
                  )}:${(take.seconds % 60).toString().padStart(2, "0")}`}</span>
                {take.seconds >= 110 && (
                  <strong>{120 - take.seconds}s left</strong>
                )}
                <Button onClick={() => void machine.current?.finish()}>
                  Stop dictation
                </Button>
              </>
            ) : take.phase === "error" ? (
              <div role="alert">
                <strong>
                  {take.permissionDenied
                    ? "Allow microphone access"
                    : "Dictation failed"}
                </strong>
                <p>
                  {take.permissionDenied
                    ? "Allow microphone access for Jam Board in your system privacy settings or browser site permissions, then try again."
                    : take.error}
                </p>
                <Button onClick={toggle}>Try again</Button>
              </div>
            ) : (
              <>
                <LoaderCircle size={16} className="brain-spinner" />
                <span>
                  {take.phase === "transcribing"
                    ? "Transcribing… You can keep editing."
                    : "Starting microphone…"}
                </span>
              </>
            )}
            <IconButton
              label="Cancel dictation"
              onClick={() => machine.current?.cancel()}
            >
              <X size={14} />
            </IconButton>
          </div>,
          host.current,
        )}
    </>
  );
}
