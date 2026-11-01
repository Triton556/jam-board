import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type KeyboardEvent, useRef } from "react";
import { useDismissible } from "../../components/ui/useDismissible";
import {
  assertFileContext,
  type FileContext,
  useRefreshFiles,
} from "../../lib/file-viewer-api";
import { useProjectWrite } from "../../lib/use-project-write";

export function useFileMenu(open: boolean, close: () => void) {
  const dismiss = useDismissible(open, close);
  return {
    ...dismiss,
    onKeyDown(event: KeyboardEvent) {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        (
          dismiss.trigger.current ??
          dismiss.root.current?.querySelector("button")
        )?.focus();
        close();
      }
    },
  };
}

export function useOpenFileViewer() {
  const navigate = useNavigate();
  return (file: string | undefined) =>
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, file }) as typeof prev,
    });
}
export function useFileViewerRoute() {
  const search = useRouterState({
    select: (state) => state.location.search,
  }) as { file?: string };
  const openFileViewer = useOpenFileViewer();
  return {
    assetId: search.file,
    openFileViewer,
    closeFileViewer: () => openFileViewer(undefined),
  };
}
export function useFileAction(
  context: FileContext | undefined,
  identity: string,
) {
  const write = useProjectWrite(identity, context?.projectId),
    refresh = useRefreshFiles();
  const requests = useRef(new Map<string, string>());
  return {
    ...write,
    ready: write.ready && !!context,
    requestId(payload: unknown) {
      const signature = JSON.stringify(payload);
      let id = requests.current.get(signature);
      if (!id) {
        id = crypto.randomUUID();
        requests.current.set(signature, id);
      }
      return id;
    },
    run(
      action: (context: FileContext) => Promise<unknown>,
      done: () => void = () => {},
    ) {
      if (!context) return;
      write.run(
        async () => {
          await assertFileContext(context);
          return action(context);
        },
        () => {
          requests.current.clear();
          void refresh();
          done();
        },
      );
    },
  };
}
