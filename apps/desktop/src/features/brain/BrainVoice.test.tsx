import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { VoiceInstallProgress, VoiceStatus } from "../../bindings";
import { voiceApi } from "../../lib/agent-dock-voice";
import { BrainVoiceInput } from "./BrainVoiceInput";
import { BrainVoiceSettings } from "./BrainVoiceSettings";
import { draftKey, updateDraft, useBrainState } from "./brain-store";
import { encodeVoiceWav, startVoiceCapture } from "./voice-capture";
import { refreshVoice, saveVoice, useVoiceState } from "./voice-store";

const f = vi.hoisted(() => ({
  status: null as VoiceStatus | null,
  progress: null as ((p: VoiceInstallProgress) => void) | null,
  navigate: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => f.navigate,
}));
vi.mock("../../lib/agent-dock-voice", () => ({
  voiceApi: {
    status: vi.fn(async () => structuredClone(f.status)),
    save: vi.fn(async (input) => {
      f.status = { ...f.status, ...input } as VoiceStatus;
      return f.status;
    }),
    install: vi.fn(async () => {}),
    cancelInstall: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ({ text: "Dictated text.", durationMs: 1 })),
    onProgress: (cb: typeof f.progress) => {
      f.progress = cb;
      return () => {
        f.progress = null;
      };
    },
  },
}));
vi.mock("./voice-capture", async (original) => ({
  ...(await original<typeof import("./voice-capture")>()),
  startVoiceCapture: vi.fn(),
}));
const ready = (): VoiceStatus => ({
  enabled: true,
  engine: "local-whisper",
  cloud: null,
  model: "balanced",
  installedModels: ["balanced"],
  runtimeInstalled: true,
  device: "auto",
  gpuAvailable: true,
  recommendedModel: "balanced",
  language: "auto",
  idleUnloadMinutes: 10,
  state: "ready",
  error: null,
  diskBytes: 574041195,
});
function Composer() {
  const host = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const key = draftKey();
  const text = useBrainState((state) => state.drafts[key]?.text ?? "");
  const project = useBrainState((state) => state.projectId);
  return (
    <>
      <input aria-label="Outside" />
      <div ref={host} data-project={project}>
        <textarea
          ref={textarea}
          aria-label="Message the brain"
          value={text}
          onChange={(event) => updateDraft({ text: event.target.value })}
        />
        <BrainVoiceInput
          host={host}
          textarea={textarea}
          prompt="Demo. JB-1 Layout"
          onActive={() => {}}
        />
      </div>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  f.status = ready();
  f.progress = null;
  useVoiceState.setState({
    status: null,
    progress: null,
    busy: false,
    error: "",
  });
  useBrainState.setState({
    projectId: "demo",
    selected: { chat: "chat", terminal: null },
    drafts: {},
  });
  vi.mocked(startVoiceCapture).mockResolvedValue({
    finish: async () => encodeVoiceWav([new Int16Array(16000)]),
    cancel: f.release,
  });
  vi.mocked(voiceApi.transcribe).mockResolvedValue({
    text: "Dictated text.",
    durationMs: 1,
  });
});
async function mount() {
  render(<Composer />);
  return await screen.findByRole("button", { name: "Voice input" });
}
it("H-BD18 hover and focus show status, switch, shortcut and settings without preparing/loading", async () => {
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.pointerEnter(mic.parentElement?.parentElement as HTMLElement);
  const popover = screen.getByRole("region", { name: "Voice input controls" });
  expect(
    within(popover).getByText("Local Whisper · Balanced · GPU · ready"),
  ).toBeVisible();
  expect(
    within(popover).getByRole("switch", { name: "Enable voice input" }),
  ).toBeChecked();
  expect(
    within(popover).getByText("Ctrl+Space · Escape cancels a take"),
  ).toBeVisible();
  fireEvent.focus(mic);
  expect(voiceApi.prepare).not.toHaveBeenCalled();
  expect(startVoiceCapture).not.toHaveBeenCalled();
  fireEvent.click(
    within(popover).getByRole("button", { name: "Voice settings…" }),
  );
  expect(f.navigate).toHaveBeenCalledWith({
    to: "/settings",
    search: { section: "Voice" },
  });
});
it("H-BD18 a failed voice-status read retries from the popover and never prepares a model", async () => {
  vi.mocked(voiceApi.status).mockRejectedValueOnce(
    Error("Voice status unavailable"),
  );
  const mic = await mount();
  fireEvent.pointerEnter(mic.parentElement?.parentElement as HTMLElement);
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mic).toBeEnabled());
  expect(screen.queryByText("Error: Voice status unavailable")).toBeNull();
  expect(voiceApi.prepare).not.toHaveBeenCalled();
});
it("voice disclosure replaces the mic tooltip without remounting the focused button", async () => {
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  const user = userEvent.setup();
  await user.hover(mic);
  mic.focus();
  expect(
    screen.getByRole("region", { name: "Voice input controls" }),
  ).toBeVisible();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByRole("button", { name: "Voice input" })).toBe(mic);
  expect(mic).toHaveFocus();
  expect(voiceApi.prepare).not.toHaveBeenCalled();
});
it.each(["starting", "recording", "transcribing"])(
  "mic tooltip stays absent during %s, including with its disclosure closed",
  async (phase) => {
    if (phase === "starting")
      vi.mocked(voiceApi.prepare).mockImplementationOnce(
        () => new Promise(() => {}),
      );
    if (phase === "transcribing")
      vi.mocked(voiceApi.transcribe).mockImplementationOnce(
        () => new Promise(() => {}),
      );
    const mic = await mount();
    await waitFor(() => expect(mic).toBeEnabled());
    const input = screen.getByRole("textbox", { name: "Message the brain" });
    fireEvent.keyDown(input, { code: "Space", ctrlKey: true });
    if (phase === "transcribing") {
      await waitFor(() => expect(mic.dataset.voiceState).toBe("recording"));
      fireEvent.keyDown(input, { code: "Space", ctrlKey: true });
    }
    await waitFor(() => expect(mic.dataset.voiceState).toBe(phase));
    expect(
      screen.queryByRole("region", { name: "Voice input controls" }),
    ).toBeNull();
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(mic.closest(".brain-voice-anchor") as HTMLElement);
    expect(
      screen.getByRole("region", { name: "Voice input controls" }),
    ).toBeVisible();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
  },
);
it("H-BD17 Ctrl+Space only in the composer, Esc cancels without changing text", async () => {
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Outside" }), {
    code: "Space",
    ctrlKey: true,
  });
  expect(voiceApi.prepare).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Keep my draft" } });
  fireEvent.keyDown(input, { code: "Space", ctrlKey: true });
  await screen.findByRole("meter", { name: "Microphone level" });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Outside" }), {
    key: "Escape",
  });
  expect(f.release).toHaveBeenCalledTimes(1);
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  expect(input).toHaveValue("Keep my draft");
});
it("H-BD17 transcribing keeps input editable, inserts at its caret, and never sends", async () => {
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  let answer!: (value: { text: string; durationMs: number }) => void;
  vi.mocked(voiceApi.transcribe).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const input = screen.getByRole("textbox", {
    name: "Message the brain",
  }) as HTMLTextAreaElement;
  fireEvent.click(mic);
  await screen.findByRole("meter");
  fireEvent.keyDown(input, { code: "Space", ctrlKey: true });
  await screen.findByText("Transcribing… You can keep editing.");
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: "Before after" } });
  input.setSelectionRange(6, 6);
  await act(async () => answer({ text: "dictated", durationMs: 1 }));
  expect(input).toHaveValue("Before dictated after");
  expect(voiceApi.transcribe).toHaveBeenCalledWith(
    expect.any(String),
    "auto",
    "Demo. JB-1 Layout",
  );
});
it("H-BD17 project/draft switch cancels recording and late transcription cannot cross scope", async () => {
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  await screen.findByRole("meter");
  act(() => useBrainState.setState({ projectId: "another" }));
  expect(f.release).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("meter")).toBeNull();
});
it("H-BD17 permission denial gives an inline allowance card with recovery", async () => {
  vi.mocked(startVoiceCapture).mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  expect(await screen.findByText("Allow microphone access")).toBeVisible();
  expect(
    screen.getByText(/system privacy settings or browser site permissions/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("meter");
});
it("H-BD17 A → B → A selection changes discard an in-flight transcription even within one render", async () => {
  let answer!: (result: { text: string; durationMs: number }) => void;
  vi.mocked(voiceApi.transcribe).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  await screen.findByRole("meter");
  fireEvent.keyDown(
    screen.getByRole("textbox", { name: "Message the brain" }),
    { code: "Space", ctrlKey: true },
  );
  await screen.findByText("Transcribing… You can keep editing.");
  act(() => {
    useBrainState.setState({ projectId: "other" });
    useBrainState.setState({ projectId: "demo" });
  });
  await act(async () => answer({ text: "Stale result", durationMs: 1 }));
  expect(
    screen.getByRole("textbox", { name: "Message the brain" }),
  ).toHaveValue("");
});
it("H-BD17 transcription error retains the draft and supports retry", async () => {
  vi.mocked(voiceApi.transcribe).mockRejectedValueOnce(
    Error("Server unavailable"),
  );
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  await screen.findByRole("meter");
  fireEvent.keyDown(
    screen.getByRole("textbox", { name: "Message the brain" }),
    { code: "Space", ctrlKey: true },
  );
  expect(await screen.findByText("Server unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
});
it.each([
  "off",
  "not_installed",
  "installing",
  "loading",
  "ready",
  "error",
] as const)(
  "H-BD17 microphone state %s is reachable without preparing on focus",
  async (state) => {
    f.status = {
      ...ready(),
      state,
      enabled: state !== "off",
      ...(state === "not_installed" ? { installedModels: [] } : {}),
      ...(state === "error" ? { error: "Runtime missing" } : {}),
    };
    const mic = await mount();
    await waitFor(() => expect(mic).toBeEnabled());
    fireEvent.focus(mic);
    if (state === "off")
      expect(mic.querySelector(".lucide-mic-off")).not.toBeNull();
    if (state === "not_installed")
      expect(
        screen.getByRole("button", { name: "Download 574 MB" }),
      ).toBeVisible();
    if (state === "installing") {
      act(() => f.progress?.({ phase: "model", received: 50, total: 100 }));
      expect(screen.getByText("Downloading model · 50%")).toBeVisible();
      expect(mic).toHaveTextContent("50%");
      fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
      expect(voiceApi.cancelInstall).toHaveBeenCalledTimes(1);
    }
    if (state === "loading")
      expect(mic.querySelector(".brain-spinner")).not.toBeNull();
    if (state === "error")
      expect(screen.getByText("Runtime missing")).toBeVisible();
    expect(voiceApi.prepare).not.toHaveBeenCalled();
  },
);
it("H-BD19 settings writes omit model for enable/device/language/unload and include only an explicit model pick", async () => {
  useVoiceState.setState({ status: ready() });
  for (const change of [
    { enabled: false },
    { device: "cpu" as const },
    { language: "ru" as const },
    { idleUnloadMinutes: null },
  ]) {
    await saveVoice(change);
    expect(voiceApi.save).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ model: expect.anything() }),
    );
    expect(
      Object.hasOwn(
        vi.mocked(voiceApi.save).mock.calls.at(-1)?.[0] ?? {},
        "model",
      ),
    ).toBe(false);
  }
  await saveVoice({ model: "fast" });
  expect(voiceApi.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ model: "fast" }),
  );
});
it("H-BD19 settings show recommendation, model sizes/disk, CPU warning and unavailable GPU reason", async () => {
  f.status = {
    ...ready(),
    device: "cpu",
    gpuAvailable: false,
    recommendedModel: "fast",
  };
  render(<BrainVoiceSettings />);
  expect(
    await screen.findByText("Recommended for this computer"),
  ).toBeVisible();
  expect(
    screen.getByText("Slow on this computer (about 3× the recording length)"),
  ).toBeVisible();
  expect(screen.getByText("Disk used: 574 MB")).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Voice device" }));
  expect(screen.getByRole("option", { name: "GPU" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(screen.getByText(/GPU unavailable:/)).toBeVisible();
  expect(voiceApi.prepare).not.toHaveBeenCalled();
});

it("H-BD19 settings select language/unload and model, and install/remove without preparing", async () => {
  render(<BrainVoiceSettings />);
  const user = userEvent.setup();
  await screen.findByText("Recommended for this computer");
  await user.click(screen.getByRole("combobox", { name: "Voice language" }));
  await user.click(screen.getByRole("option", { name: "Russian" }));
  expect(voiceApi.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ language: "ru" }),
  );
  expect(
    Object.hasOwn(
      vi.mocked(voiceApi.save).mock.calls.at(-1)?.[0] ?? {},
      "model",
    ),
  ).toBe(false);
  await user.click(
    screen.getByRole("combobox", { name: "Unload voice model after" }),
  );
  await user.click(screen.getByRole("option", { name: "Never" }));
  expect(voiceApi.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ idleUnloadMinutes: null }),
  );
  await user.click(screen.getByRole("button", { name: "Fast · 190 MB" }));
  expect(voiceApi.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ model: "fast" }),
  );
  await user.click(screen.getByRole("button", { name: "Install Fast" }));
  expect(voiceApi.install).toHaveBeenCalledWith("fast", "auto");
  await user.click(screen.getByRole("button", { name: "Remove Balanced" }));
  expect(voiceApi.remove).toHaveBeenCalledWith("balanced");
  expect(voiceApi.prepare).not.toHaveBeenCalled();
});
it("H-BD17 closing the dock releases a take; read failures offer Retry without loading", async () => {
  const view = render(<Composer />);
  const mic = await screen.findByRole("button", { name: "Voice input" });
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  await screen.findByRole("meter");
  view.unmount();
  expect(f.release).toHaveBeenCalledTimes(1);
  vi.mocked(voiceApi.status).mockRejectedValueOnce(Error("Bridge unavailable"));
  useVoiceState.setState({ status: null });
  render(<BrainVoiceSettings />);
  await screen.findByText(/Bridge unavailable/);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(useVoiceState.getState().status).not.toBeNull());
  await refreshVoice();
});
it("R6-V03 cloud mic shows its provider, bypasses local downloads and displays the 401 recovery message", async () => {
  f.status = {
    ...ready(),
    engine: "cloud",
    runtimeInstalled: false,
    installedModels: [],
    cloud: {
      provider: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
      keySet: true,
    },
  };
  vi.mocked(voiceApi.transcribe).mockRejectedValueOnce(
    Error("Check the API key"),
  );
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.focus(mic);
  expect(
    screen.getByText("Audio is sent to Groq for transcription."),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
  fireEvent.click(mic);
  await screen.findByRole("meter");
  fireEvent.keyDown(
    screen.getByRole("textbox", { name: "Message the brain" }),
    { code: "Space", ctrlKey: true },
  );
  expect(await screen.findByText("Check the API key")).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Message the brain" }),
  ).toHaveValue("");
});
it("R6-V04 changing the engine cancels a captured take before transcription", async () => {
  const mic = await mount();
  await waitFor(() => expect(mic).toBeEnabled());
  fireEvent.click(mic);
  await screen.findByRole("meter");
  f.status = {
    ...ready(),
    engine: "cloud",
    cloud: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini-transcribe",
      keySet: true,
    },
  };
  await act(() => refreshVoice());
  expect(f.release).toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
});
