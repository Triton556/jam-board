import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, Dialog, Kbd } from "../../components/ui";
import { shortcutAction } from "../../lib/shortcuts";
import { CommandLoadBoundary, CommandLoading } from "./CommandLoadBoundary";

const CommandPalette = lazy(() =>
  import("./CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
export function CommandCenter({
  newTask,
  toggleTheme,
  renderTrigger,
}: {
  newTask(): void;
  toggleTheme(): void;
  renderTrigger?(trigger: ReactNode, open: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const prefix = useRef(0);
  const navigate = useNavigate();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const action = shortcutAction(e, prefix.current, Date.now());
      if (!action) return;
      e.preventDefault();
      prefix.current = action === "prefix" ? Date.now() : 0;
      if (action === "palette") setOpen(true);
      else if (action === "help") setHelp(true);
      else if (action === "new") newTask();
      else if (action !== "prefix") void navigate({ to: action });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate, newTask]);
  const openPalette = () => setOpen(true);
  const trigger = (
    <Button
      variant="ghost"
      className="palette-trigger"
      onClick={openPalette}
      aria-label="Search and commands"
    >
      <Search size={17} />
      <span>Search</span>
      <Kbd>Ctrl K</Kbd>
    </Button>
  );
  return (
    <>
      {renderTrigger ? renderTrigger(trigger, openPalette) : trigger}
      {open && (
        <CommandLoadBoundary close={() => setOpen(false)}>
          <Suspense fallback={<CommandLoading close={() => setOpen(false)} />}>
            <CommandPalette
              close={() => setOpen(false)}
              newTask={newTask}
              toggleTheme={toggleTheme}
            />
          </Suspense>
        </CommandLoadBoundary>
      )}{" "}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="shortcut-list">
            {[
              ["N", "New task"],
              ["/", "Search in table"],
              ["G P", "Plan"],
              ["G I", "Inbox"],
              ["G B", "Board"],
              ["G T", "Table"],
              ["G A", "Activity"],
              ["Ctrl K", "Command palette"],
              ["Esc", "Close"],
            ].map(([key, label]) => (
              <div key={key}>
                <dt>
                  <Kbd>{key}</Kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
    </>
  );
}
