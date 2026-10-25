import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
import { useProjectWrite } from "../../lib/use-project-write";

export function EdgeLabelDialog({
  edge,
  close,
  refresh,
  archived,
}: {
  edge: { id: string; label: string };
  close(): void;
  refresh(): Promise<unknown>;
  archived(): void;
}) {
  const client = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  // Let the child Dialog capture its real opener before focusing this editor.
  // Native autoFocus runs earlier and would make the removed input its return target.
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, []);
  const owner = useRef({
    mounted: true,
    invalidated: false,
    projectId: client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
      "app",
    ])?.jam?.id,
  });
  useEffect(() => {
    owner.current.mounted = true;
    const check = () => {
      const id = client.getQueryData<Awaited<ReturnType<typeof api.appState>>>([
        "app",
      ])?.jam?.id;
      if (!owner.current.projectId && id) owner.current.projectId = id;
      else if (id && owner.current.projectId !== id)
        owner.current.invalidated = true;
    };
    check();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "app") check();
    });
    return () => {
      owner.current.mounted = false;
      unsubscribe();
    };
  }, [client]);
  const [label, setLabel] = useState(edge.label);
  const write = useProjectWrite(`edge:${edge.id}`);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (refreshError) form.current?.querySelector("input")?.focus();
  }, [refreshError]);
  const dispatched = useRef(false);
  const submit = (archive = false) => {
    if (write.error || refreshError || write.isLocked()) return;
    dispatched.current = false;
    const id = edge.id,
      submitted = label;
    write.run(
      async () => {
        dispatched.current = true;
        if (archive)
          await api.canvasArchive({ kind: "edge", id, archived: true });
        else await api.updateRefEdge(id, submitted);
        if (!owner.current.mounted || owner.current.invalidated) return null;
        try {
          await refresh();
          return null;
        } catch (error) {
          return `Saved, but the canvas could not refresh: ${String(error)}. Retry refresh to check the canvas. This will not repeat the write.`;
        }
      },
      (error) => {
        if (archive) archived();
        if (error) setRefreshError(error);
        else close();
      },
    );
  };
  return (
    <Dialog
      title="Edge label"
      busy={write.pending || retrying}
      onClose={() => {
        if (!retrying) write.dismiss(close);
      }}
    >
      <form
        className="m5-form"
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          Label
          <input
            value={label}
            disabled={write.pending || write.checking}
            readOnly={!write.ready || !!write.error || !!refreshError}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <ProjectWriteFeedback
          write={write}
          form={form}
          action="Saving edge change"
        />
        {write.error && dispatched.current && (
          <p role="alert">
            Could not confirm whether the label was saved. Your text is kept.
            Close and check the canvas before trying again; this request will
            not be sent again automatically.
          </p>
        )}
        {refreshError && (
          <>
            <p role="alert">{refreshError}</p>
            <Button
              disabled={!write.ready || retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  await refresh();
                  if (owner.current.mounted && !owner.current.invalidated)
                    close();
                } catch (reason) {
                  if (owner.current.mounted)
                    setRefreshError(
                      `Saved, but the canvas could not refresh: ${String(reason)}. Your saved label is kept.`,
                    );
                } finally {
                  if (owner.current.mounted) setRetrying(false);
                }
              }}
            >
              {retrying ? "Refreshing…" : "Retry refresh"}
            </Button>
          </>
        )}
        <div className="dialog-actions">
          <Button
            disabled={write.pending || retrying}
            onClick={() => write.dismiss(close)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!write.ready || !!write.error || !!refreshError}
          >
            Save label
          </Button>
          <Button
            variant="danger"
            disabled={!write.ready || !!write.error || !!refreshError}
            onClick={() => submit(true)}
          >
            Archive edge
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
