import { Component, type ReactNode } from "react";
import { Button, Dialog } from "../../components/ui";

export function CommandLoading({ close }: { close(): void }) {
  return (
    <Dialog title="Search and commands" onClose={close}>
      <p role="status">Loading search and commands…</p>
      <Button onClick={close}>Cancel</Button>
    </Dialog>
  );
}

// A rejected React.lazy import is cached. Closing remains useful; only a real
// app reload retries the chunk, and its draft-loss cost must be explicit.
export class CommandLoadBoundary extends Component<
  { children: ReactNode; close(): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Dialog
        title="Could not load search and commands"
        onClose={this.props.close}
      >
        <p role="alert">
          Close to keep working, or reload the app to try loading again. Unsaved
          drafts anywhere in the app will be lost on reload.
        </p>
        <div className="dialog-actions">
          <Button onClick={this.props.close}>Close</Button>
          <Button onClick={() => window.location.reload()}>Reload app</Button>
        </div>
      </Dialog>
    );
  }
}
