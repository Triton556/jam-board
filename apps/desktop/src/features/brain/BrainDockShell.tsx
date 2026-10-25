import { type CSSProperties, useEffect, useState } from "react";
import { Tooltip } from "../../components/ui";
import { isBrainDockShortcut } from "../../lib/shortcuts";
import { useUiStore } from "../../lib/ui-store";
import { BrainGlyph } from "./BrainGlyph";
import { BrainLoadState, createBrainSurface } from "./BrainLazy";
import { loadDockPanel } from "./brain-panel-loader";
import { useBrainContext, useBrainState } from "./brain-store";
import "./brain-dock.css";

function DockPlaceholder({
  overlay,
  retry,
}: {
  overlay: boolean;
  retry?: () => void;
}) {
  const close = () => useUiStore.getState().setBrainDockOpen(false);
  return (
    <>
      {overlay && (
        <button
          type="button"
          className="brain-backdrop"
          aria-label="Close brain dock backdrop"
          onClick={close}
        />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Overlay uses dialog role; docked mode uses complementary without aria-modal. */}
      <aside
        id="brain-dock"
        className="brain-dock brain-dock-placeholder"
        role={overlay ? "dialog" : "complementary"}
        aria-label="Brain dock"
        aria-modal={overlay || undefined}
      >
        <BrainLoadState label="brain dock" retry={retry} close={close} />
      </aside>
    </>
  );
}
const DockPanel = createBrainSurface<{ overlay: boolean }>(
  loadDockPanel,
  "brain dock",
  (props, retry) => <DockPlaceholder overlay={props.overlay} retry={retry} />,
);
export function BrainDock({ overlay }: { overlay: boolean }) {
  const width = useUiStore((state) => state.brainDockWidth);
  return (
    <div
      className={`brain-dock-slot ${overlay ? "overlay" : ""}`}
      style={{ width: overlay ? `min(${width}px, 100vw)` : width }}
    >
      <DockPanel overlay={overlay} />
    </div>
  );
}
export function useDockLayout() {
  const open = useUiStore((s) => s.brainDockOpen);
  const width = useUiStore((s) => s.brainDockWidth);
  const [overlay, setOverlay] = useState(() => window.innerWidth < 1100);
  useEffect(() => {
    const resize = () => setOverlay(window.innerWidth < 1100);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    // Task drawers are portaled outside the shell and need the same offset.
    document.documentElement.style.setProperty(
      "--dock-width",
      open && !overlay ? `${width}px` : "0px",
    );
    document.documentElement.dataset.brainDocked = String(open && !overlay);
    return () => {
      document.documentElement.style.removeProperty("--dock-width");
      delete document.documentElement.dataset.brainDocked;
    };
  }, [open, overlay, width]);
  return {
    open,
    width,
    overlay,
    style: {
      "--dock-width": open && !overlay ? `${width}px` : "0px",
    } as CSSProperties,
  };
}
/** Lives with the shell, so closing the panel never stops a session or loses events. */
export function BrainDockController({ projectId }: { projectId: string }) {
  useEffect(() => {
    let disposed = false;
    const state = useBrainState.getState();
    if (state.projectId !== projectId) {
      useBrainContext.setState({ sources: {} });
      useBrainState.setState({
        projectId,
        sessions: [],
        activity: null,
        selected: { chat: null, terminal: null },
      });
    }
    let off: (() => void) | undefined;
    void import("./brain-controller")
      .then(({ connectBrain }) => {
        if (!disposed) off = connectBrain(projectId);
      })
      .catch((error) => {
        if (!disposed) useUiStore.getState().error(String(error));
      });
    const key = (event: KeyboardEvent) => {
      const toggle = isBrainDockShortcut(event);
      if (
        !event.defaultPrevented &&
        (toggle ||
          (event.key === "Escape" &&
            document.querySelector(".brain-dock-placeholder")))
      ) {
        event.preventDefault();
        useUiStore
          .getState()
          .setBrainDockOpen(toggle && !useUiStore.getState().brainDockOpen);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      off?.();
      window.removeEventListener("keydown", key);
    };
  }, [projectId]);
  return null;
}
export function BrainButton() {
  const activity = useBrainState((s) => s.activity);
  const open = useUiStore((s) => s.brainDockOpen);
  return (
    <Tooltip text={`Brain chat · Ctrl+J\n${activity?.tooltip ?? "Ready"}`}>
      <button
        type="button"
        className="button ghost brain-trigger"
        aria-label="Brain chat · Ctrl+J"
        aria-expanded={open}
        aria-controls="brain-dock"
        onClick={() => useUiStore.getState().setBrainDockOpen(!open)}
      >
        <BrainGlyph />
        <span>Brain</span>
        {activity && (
          <span
            className={`brain-dot ${activity.status}`}
            role="status"
            aria-label={activity.label}
          />
        )}
      </button>
    </Tooltip>
  );
}
