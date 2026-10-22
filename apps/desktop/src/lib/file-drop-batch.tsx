import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { api } from "./api";
import { appQuery } from "./queries";
import type { NoticeDetail } from "./ui-store";
import { useUiStore } from "./ui-store";

type Session = { active: boolean; generation: number };
const FileDropSession = createContext<Session | null>(null);
export function FileDropSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState<Session>(() => ({ active: true, generation: 0 }));
  useEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
      session.generation++;
    };
  }, [session]);
  return (
    <FileDropSession.Provider value={session}>
      {children}
    </FileDropSession.Provider>
  );
}

type Progress = { project: string; total: number; current: number };
type AppState = Awaited<ReturnType<typeof api.appState>>;
/** UI continuation fence only: already dispatched commands are not cancelled or rolled back. */
export function useFileDropBatch(kind: "assets" | "references") {
  const client = useQueryClient(),
    app = useQuery(appQuery),
    session = useContext(FileDropSession);
  const origin = useRef(app.data?.jam),
    mounted = useRef(true),
    epoch = useRef(0),
    invalid = useRef(false),
    locked = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      const jam = client.getQueryData<AppState>(["app"])?.jam;
      if (!origin.current && jam) origin.current = jam;
      else if (
        origin.current &&
        jam?.id !== origin.current.id &&
        !invalid.current
      ) {
        invalid.current = true;
        epoch.current++;
        setProgress(null);
      }
    };
    check();
    const stop = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      mounted.current = false;
      epoch.current++;
      stop();
    };
  }, [client]);
  const run = useCallback(
    async (
      selection: readonly string[],
      perform: (path: string, index: number) => Promise<unknown>,
      refreshKeys: readonly (readonly string[])[],
    ) => {
      const paths = [...selection];
      if (!paths.length) return;
      const current = client.getQueryData<AppState>(["app"])?.jam;
      const project =
        current?.id === origin.current?.id ? current : origin.current;
      const projectLabel = project
        ? `${project.name} [${project.keyPrefix}]`
        : "Unknown project";
      const capturedEpoch = epoch.current,
        generation = session?.generation;
      const live = () =>
        session
          ? session.active && session.generation === generation
          : mounted.current;
      const eligible = () =>
        live() &&
        mounted.current &&
        !invalid.current &&
        epoch.current === capturedEpoch &&
        !!project &&
        client.getQueryData<AppState>(["app"])?.jam?.id === project.id;
      const details: NoticeDetail[] = [];
      let reason = "",
        confirmed = 0,
        unconfirmed = 0,
        dispatched = false,
        ownsLock = false;
      if (locked.current) reason = "another file drop is still settling";
      else if (!eligible())
        reason = "you left this page or the project context changed";
      else {
        locked.current = true;
        ownsLock = true;
      }
      try {
        if (ownsLock)
          for (const [index, path] of paths.entries()) {
            if (!eligible()) {
              reason = "you left this page or the project context changed";
              break;
            }
            setProgress({
              project: projectLabel,
              total: paths.length,
              current: index + 1,
            });
            dispatched = true;
            try {
              await perform(path, index);
              confirmed++;
              details.push({ label: "Confirmed", text: path });
            } catch (error) {
              unconfirmed++;
              details.push({
                label: "Unconfirmed request",
                text: path,
                note: String(error),
              });
              reason =
                "a dispatched request did not return confirmation; it may already have been saved";
              break;
            }
          }
      } finally {
        const unsent = paths.slice(confirmed + unconfirmed);
        details.push(
          ...unsent.map((path) => ({ label: "Not attempted", text: path })),
        );
        // Never refill B's unscoped cache with origin A's result. If only the page
        // closed, mark same-project data stale without starting an unseen refetch.
        if (
          dispatched &&
          live() &&
          project &&
          client.getQueryData<AppState>(["app"])?.jam?.id === project.id
        ) {
          try {
            await Promise.all(
              refreshKeys.map((queryKey) =>
                client.invalidateQueries(
                  { queryKey, refetchType: eligible() ? "active" : "none" },
                  { throwOnError: true },
                ),
              ),
            );
          } catch (error) {
            details.push({
              label: "Refresh not confirmed",
              text: String(error),
            });
            reason += `${reason ? "; " : ""}the list could not be refreshed`;
          }
        }
        if (ownsLock) locked.current = false;
        if (mounted.current && ownsLock) setProgress(null);
        if (live()) {
          const problem = unconfirmed > 0 || unsent.length > 0 || !!reason;
          const summary = `${projectLabel} · ${kind}: ${confirmed} confirmed${problem ? `; ${unconfirmed} unconfirmed request${unconfirmed === 1 ? "" : "s"}; ${unsent.length} not attempted` : ""}.${reason ? ` Stopped: ${reason}.` : ""}`;
          useUiStore.getState().notify(summary, {
            persistent: problem,
            details,
            hint: `${project ? `Project ID: ${project.id}. ` : ""}${problem ? `Open the captured project and use Refresh ${kind} before inspecting its results or re-dropping only the files still needed. Nothing was automatically retried or rolled back.` : "All listed requests returned confirmation."}`,
          });
        }
      }
    },
    [client, kind, session],
  );
  return { run, progress };
}
export function FileDropProgress({ progress }: { progress: Progress | null }) {
  if (!progress) return null;
  return (
    <p className="file-drop-progress" role="status">
      Sending file {progress.current} of {progress.total} to {progress.project}…
      <span className="small">
        {" "}
        Leaving stops files not yet sent, not the in-flight request.
      </span>
    </p>
  );
}
