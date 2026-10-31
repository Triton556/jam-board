import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Maximize2, PanelRight } from "lucide-react";
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  lazy,
  Suspense,
  startTransition,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  Drawer,
  DrawerHeading,
  IconButton,
  type ModalFocusReturn,
} from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { api } from "../../lib/api";
import { TaskTitlePreview } from "./TaskTitle";
import type { TaskFilesSlotProps } from "./TaskView";
import type { TaskPresentation } from "./task-view-route";
import "./task-view.css";

const loadEditor = () =>
  import("./TaskView").then((m) => ({ default: m.TaskView }));
const initialEditor = lazy(loadEditor);
export function TaskDrawer({
  taskKey,
  ...props
}: {
  taskKey: string;
  close(): void;
  returnFocus?: ModalFocusReturn;
  Files?: ComponentType<TaskFilesSlotProps>;
  presentation?: TaskPresentation;
  onPresentationChange?(presentation: TaskPresentation): void;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <TaskSession
      key={taskKey}
      taskKey={taskKey}
      {...props}
      modal={!/^\/references(?:\/|$)/.test(pathname)}
    />
  );
}

function TaskSession({
  taskKey,
  close,
  returnFocus,
  modal,
  presentation = "drawer",
  onPresentationChange,
  Files,
}: {
  taskKey: string;
  close(): void;
  returnFocus?: ModalFocusReturn;
  modal: boolean;
  Files?: ComponentType<TaskFilesSlotProps>;
  presentation?: TaskPresentation;
  onPresentationChange?(presentation: TaskPresentation): void;
}) {
  const task = useQuery({
    queryKey: ["task", taskKey],
    queryFn: () => api.getTask(taskKey),
  });
  const [entered, setEntered] = useState(false);
  const [Editor, setEditor] = useState(() => initialEditor);
  const [retry, setRetry] = useState(0);
  const dismiss = useRef<(() => void) | null>(null);
  const modeAction = onPresentationChange && (
    <IconButton
      label={presentation === "drawer" ? "Open larger" : "Use side panel"}
      data-task-presentation-switch
      // Keeping pointer focus in the field also preserves selection and avoids a brief blur-save.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() =>
        onPresentationChange(presentation === "drawer" ? "modal" : "drawer")
      }
    >
      {presentation === "drawer" ? <Maximize2 /> : <PanelRight />}
    </IconButton>
  );
  const fallback = (
    <div className="task-drawer-skeleton" aria-busy={!task.error || undefined}>
      <TaskTitlePreview taskKey={taskKey} />
      {task.error ? (
        <QueryError error={task.error} retry={() => void task.refetch()} />
      ) : (
        <PaperSkeleton label="Loading task" />
      )}
    </div>
  );
  return (
    <TaskSurfaceContext.Provider value={{ dismiss, modeAction }}>
      <Drawer
        onClose={close}
        title={taskKey}
        returnFocus={returnFocus}
        presentation={presentation}
        modal={presentation === "modal" || modal}
        actions={modeAction}
        onEntered={() => startTransition(() => setEntered(true))}
        hideHeading={entered && !!task.data}
        onRequestClose={(finish) =>
          dismiss.current ? dismiss.current() : finish()
        }
      >
        {(finish) =>
          entered && task.data ? (
            <ErrorBoundary
              resetKey={retry}
              fallback={
                <>
                  <DrawerHeading
                    title={taskKey}
                    onClose={finish}
                    actions={modeAction}
                  />
                  <p role="alert">
                    Could not load task editor. Your task has not been changed.
                  </p>
                  <Button
                    onClick={() => {
                      setEditor(() => lazy(loadEditor));
                      setRetry((value) => value + 1);
                    }}
                  >
                    Retry task editor
                  </Button>
                </>
              }
            >
              <Suspense
                fallback={
                  <>
                    <DrawerHeading
                      title={taskKey}
                      onClose={finish}
                      actions={modeAction}
                    />
                    {fallback}
                  </>
                }
              >
                <Editor
                  task={task.data}
                  close={finish}
                  frame={TaskEditorSurface}
                  Files={Files}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            fallback
          )
        }
      </Drawer>
    </TaskSurfaceContext.Provider>
  );
}
const TaskSurfaceContext = createContext<{
  dismiss: React.RefObject<(() => void) | null>;
  modeAction: React.ReactNode;
} | null>(null);
function TaskEditorSurface({
  children,
  ...heading
}: ComponentProps<typeof Drawer>) {
  const surface = useContext(TaskSurfaceContext);
  const dismiss = surface?.dismiss;
  useLayoutEffect(() => {
    if (!dismiss) return;
    dismiss.current = heading.onClose;
    return () => {
      dismiss.current = null;
    };
  }, [dismiss, heading.onClose]);
  return (
    <>
      <DrawerHeading
        {...heading}
        actions={
          <>
            {surface?.modeAction}
            {heading.actions}
          </>
        }
      />
      {typeof children === "function" ? children(heading.onClose) : children}
    </>
  );
}
